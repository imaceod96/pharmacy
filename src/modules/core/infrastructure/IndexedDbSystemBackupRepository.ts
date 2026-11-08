import {
  IndexedDbEngine,
  SystemMetadataRecord,
} from '../../../shared/lib/indexeddb/IndexedDbEngine';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import {
  BackupValidationError,
  ReferentialIntegrityError,
} from '../../../shared/types/errors';
import { computeChecksum } from '../../../shared/utils/checksum';
import { nowISO } from '../../../shared/utils/date';
import { OperationLogEntry } from '../domain/entities/OperationLog';
import {
  SystemBackupEnvelope,
  SystemStorageSummary,
} from '../domain/entities/SystemBackup';
import { SystemBackupRepository } from '../domain/repositories/SystemBackupRepository';

export class IndexedDbSystemBackupRepository implements SystemBackupRepository {
  private readonly engine: IndexedDbEngine;

  constructor(engine: IndexedDbEngine) {
    this.engine = engine;
  }

  public async getStorageSummary(): Promise<SystemStorageSummary> {
    const stores = this.engine.getManagedStores();
    return this.engine.runTransaction(stores, 'readonly', async (tx) => {
      const metadata = await tx.get<SystemMetadataRecord>(
        StoreName.SYSTEM_METADATA,
        'installation'
      );
      const [
        products,
        categories,
        units,
        merchandiseEntries,
        inventoryMovements,
        inventoryCuts,
        workdays,
        costLayers,
        closingRectifications,
        sales,
        operationHistory,
        priceChanges,
        productStatusChanges,
        expenses,
      ] = await Promise.all([
        tx.count(StoreName.WAREHOUSE_PRODUCTS),
        tx.count(StoreName.WAREHOUSE_CATEGORIES),
        tx.count(StoreName.WAREHOUSE_UNITS),
        tx.count(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES),
        tx.count(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS),
        tx.count(StoreName.WAREHOUSE_INVENTORY_CUTS),
        tx.count(StoreName.WAREHOUSE_WORKDAYS),
        tx.count(StoreName.WAREHOUSE_COST_LAYERS),
        tx.count(StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS),
        tx.count(StoreName.SALES_RECORDS),
        tx.count(StoreName.OPERATION_HISTORY),
        tx.count(StoreName.WAREHOUSE_PRICE_CHANGES),
        tx.count(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES),
        tx.count(StoreName.EXPENSES),
      ]);

      return {
        schemaVersion: metadata?.schemaVersion ?? this.engine.getSchemaVersion(),
        isDurableStorage: this.engine.getDurabilityStatus(),
        initializedAt: metadata?.initializedAt ?? null,
        lastBackupAt: metadata?.lastBackupAt ?? null,
        counts: {
          products,
          categories,
          units,
          merchandiseEntries,
          inventoryMovements,
          inventoryCuts,
          workdays,
          costLayers,
          closingRectifications,
          sales,
          operationHistory,
          priceChanges,
          productStatusChanges,
          expenses,
        },
      };
    });
  }

  public async createBackupSnapshot(
    auditEntry: OperationLogEntry
  ): Promise<SystemBackupEnvelope> {
    const managedStores = this.engine.getManagedStores();
    const exportedAt = auditEntry.createdAt;

    const storesSnapshot = await this.engine.runTransaction(
      managedStores,
      'readwrite',
      async (tx) => {
        const existingMeta = await tx.get<SystemMetadataRecord>(
          StoreName.SYSTEM_METADATA,
          'installation'
        );

        const updatedMeta: SystemMetadataRecord = {
          id: 'installation',
          schemaVersion: this.engine.getSchemaVersion(),
          initializedAt: existingMeta?.initializedAt ?? exportedAt,
          lastBackupAt: exportedAt,
          updatedAt: exportedAt,
        };

        await tx.upsert(StoreName.SYSTEM_METADATA, updatedMeta);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        const data: Record<string, unknown[]> = {};
        for (const storeName of managedStores) {
          const rawRecords = await tx.getAll<Record<string, unknown>>(storeName);
          if (storeName === StoreName.SYSTEM_METADATA) {
            // Un respaldo NO debe exportar ni incluir credenciales de PIN ni bloqueos de PIN
            data[storeName] = rawRecords.filter(
              (r) => r.id !== 'admin_pin_credentials' && r.id !== 'admin_pin_lockout'
            );
          } else {
            data[storeName] = rawRecords;
          }
        }
        return data;
      }
    );

    const checksum = await computeChecksum(JSON.stringify(storesSnapshot));

    return {
      format: 'ESTABLECIMIENTO_BACKUP_V1',
      schemaVersion: this.engine.getSchemaVersion(),
      exportedAt,
      checksum,
      stores: storesSnapshot,
    };
  }

  public async restoreBackupSnapshot(
    envelope: SystemBackupEnvelope,
    auditEntry: OperationLogEntry
  ): Promise<void> {
    if (envelope.schemaVersion > this.engine.getSchemaVersion()) {
      throw new BackupValidationError(
        `El respaldo pertenece a una versión de base de datos más reciente (v${envelope.schemaVersion}) que la instalada actualmente (v${this.engine.getSchemaVersion()}).`
      );
    }

    if (envelope.checksum) {
      const expectedChecksum = await computeChecksum(JSON.stringify(envelope.stores));
      if (expectedChecksum !== envelope.checksum) {
        throw new BackupValidationError(
          'La suma de verificación del respaldo no coincide; el archivo podría haber sido alterado o estar incompleto.'
        );
      }
    }

    const managedStores = this.engine.getManagedStores();

    for (const storeName of managedStores) {
      const records = envelope.stores[storeName];
      if (records !== undefined && !Array.isArray(records)) {
        throw new BackupValidationError(
          `El almacén "${storeName}" en el respaldo no contiene una lista válida de registros.`
        );
      }

      if (Array.isArray(records)) {
        const seenIds = new Set<string>();
        for (const rec of records) {
          if (!rec || typeof rec !== 'object' || typeof (rec as { id?: unknown }).id !== 'string') {
            throw new BackupValidationError(
              `Se detectó un registro sin identificador único válido en "${storeName}".`
            );
          }
          const recId = (rec as { id: string }).id;
          if (seenIds.has(recId)) {
            throw new BackupValidationError(
              `Se detectó un identificador duplicado (${recId}) dentro de "${storeName}".`
            );
          }
          seenIds.add(recId);
        }
      }
    }

    for (const rule of this.engine.getIntegrityRules()) {
      const sourceRecords = (envelope.stores[rule.sourceStore] ?? []) as Record<string, unknown>[];
      const targetRecords = (envelope.stores[rule.targetStore] ?? []) as { id: string }[];
      const targetIds = new Set(targetRecords.map((t) => t.id));

      for (const source of sourceRecords) {
        const fk = source[rule.foreignKeyField];
        if (typeof fk === 'string' && fk.length > 0 && !targetIds.has(fk)) {
          throw new ReferentialIntegrityError(
            `El respaldo incumple la integridad referencial (${rule.name}): referencia huérfana "${fk}".`
          );
        }
      }
    }

    // Obtener y preservar credenciales/bloqueos de PIN administrativo local del dispositivo receptor
    let localPinCredentials: ({ id: string; [key: string]: unknown }) | undefined;
    let localPinLockout: ({ id: string; [key: string]: unknown }) | undefined;

    await this.engine.runTransaction([StoreName.SYSTEM_METADATA], 'readonly', async (tx) => {
      localPinCredentials = await tx.get<{ id: string; [key: string]: unknown }>(
        StoreName.SYSTEM_METADATA,
        'admin_pin_credentials'
      );
      localPinLockout = await tx.get<{ id: string; [key: string]: unknown }>(
        StoreName.SYSTEM_METADATA,
        'admin_pin_lockout'
      );
    });

    if (!localPinCredentials) {
      throw new BackupValidationError(
        'Debe configurar un PIN administrativo inicial de 6 dígitos en este dispositivo antes de restaurar una copia de seguridad.'
      );
    }

    await this.engine.runTransaction(managedStores, 'readwrite', async (tx) => {
      const reverseStores = [...managedStores].reverse();
      for (const storeName of reverseStores) {
        await tx.clear(storeName);
      }

      for (const storeName of managedStores) {
        const records = (envelope.stores[storeName] ?? []) as { id: string }[];
        for (const record of records) {
          // Omitir cualquier registro de PIN que viniera erróneamente en el paquete de respaldo
          if (
            storeName === StoreName.SYSTEM_METADATA &&
            (record.id === 'admin_pin_credentials' || record.id === 'admin_pin_lockout')
          ) {
            continue;
          }
          await tx.insert(storeName, record);
        }
      }

      // Preservar obligatoriamente las credenciales y el estado de bloqueo de PIN local del dispositivo
      if (localPinCredentials) {
        await tx.upsert(StoreName.SYSTEM_METADATA, localPinCredentials);
      }
      if (localPinLockout) {
        await tx.upsert(StoreName.SYSTEM_METADATA, localPinLockout);
      }

      const restoredMeta = await tx.get<SystemMetadataRecord>(
        StoreName.SYSTEM_METADATA,
        'installation'
      );
      const timestamp = nowISO();

      await tx.upsert<SystemMetadataRecord>(StoreName.SYSTEM_METADATA, {
        id: 'installation',
        schemaVersion: this.engine.getSchemaVersion(),
        initializedAt: restoredMeta?.initializedAt ?? timestamp,
        lastBackupAt: restoredMeta?.lastBackupAt ?? envelope.exportedAt,
        updatedAt: timestamp,
      });

      await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);
    });
  }
}
