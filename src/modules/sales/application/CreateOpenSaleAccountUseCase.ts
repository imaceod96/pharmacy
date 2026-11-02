import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../../warehouse/domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../../warehouse/domain/entities/MeasurementUnitRecord';
import { ProductRecord, ProductStatus } from '../../warehouse/domain/entities/ProductRecord';
import {
  isOperativeWorkday,
  validateActiveWorkdayForSales,
  WorkdayRecord,
} from '../../warehouse/domain/entities/WorkdayRecord';
import {
  consolidateSaleLineInputs,
  formatOpenAccountConsecutive,
  SaleLineDraftInput,
  SaleLineItemRecord,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';

export interface OpenSalesCounterMetadata {
  readonly id: 'open_sales_consecutive_counter';
  readonly lastConsecutive: number;
  readonly updatedAt: string;
}

export interface CreateOpenSaleAccountInput {
  readonly accountName: string;
  readonly items: readonly SaleLineDraftInput[];
  readonly operationId?: string;
}

export interface CreateOpenSaleAccountResult {
  readonly sale: SaleRecord;
  readonly isDuplicate?: boolean;
}

export class CreateOpenSaleAccountUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: CreateOpenSaleAccountInput
  ): Promise<CreateOpenSaleAccountResult> {
    assertPermission(actor, Permission.CREATE_SALE, 'dejar una cuenta abierta');

    const accountName = (input.accountName || '').trim();
    if (!accountName) {
      throw new ValidationError(
        'El nombre de la cuenta abierta es obligatorio (por ejemplo: Mesa 1, Pedro, Mostrador 2).'
      );
    }

    if (accountName.length > 80) {
      throw new ValidationError(
        'El nombre de la cuenta abierta no puede exceder 80 caracteres.'
      );
    }

    const consolidatedLines = consolidateSaleLineInputs(input.items);
    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();
    const saleId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
        StoreName.SYSTEM_METADATA,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Idempotencia
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          operationId
        );
        if (existingOp && existingOp.entityId) {
          const existingSale = await tx.get<SaleRecord>(
            StoreName.SALES_RECORDS,
            existingOp.entityId
          );
          if (existingSale) {
            return {
              sale: existingSale,
              isDuplicate: true,
            };
          }
        }

        // 2. Validar jornada operativa activa dentro de la transacción
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday =
          allWorkdays.find((w) => isOperativeWorkday(w.status)) ?? null;
        const salesValidation = validateActiveWorkdayForSales(activeWorkday);

        if (!salesValidation.canOperateSales || !salesValidation.activeWorkday) {
          throw new ValidationError(
            salesValidation.message ||
              'No hay una jornada abierta habilitada para registrar cuentas abiertas.'
          );
        }

        const workday = salesValidation.activeWorkday;

        // 3. Cargar unidades de medida y validar cada producto y cantidad contra existencias reales
        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitMap.set(u.id, u);
        }

        const lineItems: SaleLineItemRecord[] = [];
        let totalAmount = 0;

        for (const draftLine of consolidatedLines) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            draftLine.productId
          );
          if (!product) {
            throw new EntityNotFoundError('warehouse_products', draftLine.productId);
          }

          if (product.status !== ProductStatus.ACTIVE) {
            throw new ValidationError(
              `El producto "${product.name}" se encuentra inactivo y no está habilitado para la venta.`
            );
          }

          if (product.currentStock <= 0) {
            throw new ValidationError(
              `El producto "${product.name}" no tiene existencias disponibles en almacén.`
            );
          }

          if (draftLine.quantity > product.currentStock) {
            throw new ValidationError(
              `La cantidad solicitada para "${product.name}" (${draftLine.quantity}) supera las existencias disponibles (${product.currentStock}).`
            );
          }

          const unit = unitMap.get(product.measurementUnitId);
          const unitSalePrice = product.currentSalePrice;
          const lineSubtotal =
            Math.round(draftLine.quantity * unitSalePrice * 100) / 100;

          lineItems.push({
            productId: product.id,
            productCode: product.sku ?? `PRD-${product.id.slice(0, 8).toUpperCase()}`,
            sku: product.sku ?? null,
            productName: product.name,
            measurementUnitId: product.measurementUnitId,
            unitName: unit?.name ?? 'Unidad',
            unitSymbol: unit?.name ?? 'u.',
            quantity: draftLine.quantity,
            unitSalePrice,
            lineSubtotal,
          });

          totalAmount = Math.round((totalAmount + lineSubtotal) * 100) / 100;
        }

        // 4. Generar número consecutivo único, persistente y nunca reutilizado
        const counterMeta = await tx.get<OpenSalesCounterMetadata>(
          StoreName.SYSTEM_METADATA,
          'open_sales_consecutive_counter'
        );
        const allSales = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
        let maxRecordedConsecutive = 0;
        for (const s of allSales) {
          if (
            typeof s.consecutiveNumber === 'number' &&
            s.consecutiveNumber > maxRecordedConsecutive
          ) {
            maxRecordedConsecutive = s.consecutiveNumber;
          }
        }

        const nextConsecutive =
          Math.max(counterMeta?.lastConsecutive ?? 0, maxRecordedConsecutive) + 1;

        await tx.upsert<OpenSalesCounterMetadata>(StoreName.SYSTEM_METADATA, {
          id: 'open_sales_consecutive_counter',
          lastConsecutive: nextConsecutive,
          updatedAt: timestamp,
        });

        const folio = formatOpenAccountConsecutive(nextConsecutive);

        // 5. Descontar existencias físicas en almacén y registrar movimientos de Kardex para las partidas de la cuenta
        const inventoryMovementIds: string[] = [];

        for (const draftLine of consolidatedLines) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            draftLine.productId
          );
          if (!product) continue;

          const previousStock = product.currentStock;
          const resultingStock = Math.round((previousStock - draftLine.quantity) * 1000) / 1000;

          await tx.upsert<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, {
            ...product,
            currentStock: resultingStock,
            updatedAt: timestamp,
          });

          const movementId = generateEntityId();
          const movement: InventoryMovementRecord = {
            id: movementId,
            productId: product.id,
            movementType: InventoryMovementType.SALE,
            quantity: draftLine.quantity,
            signedQuantity: -draftLine.quantity,
            previousStock,
            resultingStock,
            timestamp,
            responsibleUserId: actor.role,
            originOperationId: saleId,
            reason: `Consumo en cuenta abierta ${folio} (${accountName})`,
            workdayId: workday.id,
            workdayFolio: workday.code,
          };

          await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
          inventoryMovementIds.push(movementId);
        }

        // 6. Persistir cuenta abierta (con existencias descontadas físicamente)
        const saleRecord: SaleRecord = {
          id: saleId,
          folio,
          consecutiveNumber: nextConsecutive,
          accountName,
          customerOrTableLabel: accountName,
          originType: 'OPEN_ACCOUNT',
          status: SaleStatus.OPEN,
          items: lineItems,
          totalAmount,
          openedAt: timestamp,
          openedByUserId: actor.role,
          openedByUserLabel: actor.label,
          createdWorkdayId: workday.id,
          workdayId: workday.id,
          dispatchedWorkdayId: null,
          dispatchedAt: null,
          dispatchedByUserId: null,
          dispatchedByUserLabel: null,
          closedAt: null,
          cancelledAt: null,
          cancelledByUserId: null,
          cancelledByUserLabel: null,
          cancellationReason: null,
          hasStockMovement: inventoryMovementIds.length > 0,
          inventoryMovementIds,
          operationId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await tx.insert(StoreName.SALES_RECORDS, saleRecord);

        // 6. Registrar auditoría
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.SALES,
          action: 'CREATE_OPEN_SALE_ACCOUNT',
          entityType: 'Sale',
          entityId: saleRecord.id,
          actorRole: actor.role,
          description: `Apertura de cuenta ${folio} — ${accountName} en Jornada ${workday.code} (${lineItems.length} partida(s), importe estimado $${totalAmount.toFixed(2)}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          sale: saleRecord,
        };
      }
    );
  }
}
