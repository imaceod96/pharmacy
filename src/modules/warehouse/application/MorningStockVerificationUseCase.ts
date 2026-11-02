import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { InventoryMovementRecord, InventoryMovementType } from '../domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import {
  MorningVerificationItem,
  MorningStockVerificationRecord,
  MorningVerificationMode,
} from '../domain/entities/MorningStockVerification';
import { ProductCostLayer } from '../domain/entities/ProductCostLayer';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';
import { isOperativeWorkday, WorkdayRecord } from '../domain/entities/WorkdayRecord';

export interface MorningVerificationCountInput {
  readonly productId: string;
  readonly countedStock: number;
  readonly differenceReason?: string;
}

export interface MorningStockVerificationInput {
  readonly mode?: MorningVerificationMode;
  readonly counts: readonly MorningVerificationCountInput[];
  readonly notes?: string;
}

function roundQty(val: number): number {
  return Math.round(val * 100) / 100;
}

export class MorningStockVerificationUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: MorningStockVerificationInput
  ): Promise<MorningStockVerificationRecord> {
    assertPermission(
      actor,
      Permission.VIEW_INVENTORY_CUTS,
      'realizar verificación matutina de existencias'
    );

    const mode = input.mode ?? 'ADJUST_STOCK';

    const timestamp = nowISO();
    const dateStr = timestamp.substring(0, 10).replace(/-/g, '');
    const operationId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.SYSTEM_METADATA,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Consultar jornada si existiese (opcional, pues se permite antes de abrir)
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday = allWorkdays.find((w) => isOperativeWorkday(w.status)) ?? null;

        // Generar folio consecutivo
        const counterKey = `morning_verification_seq_${dateStr}`;
        const seqRecord = await tx.get<{ id: string; lastSeq: number }>(
          StoreName.SYSTEM_METADATA,
          counterKey
        );
        const nextSeq = (seqRecord?.lastSeq ?? 0) + 1;
        await tx.upsert(StoreName.SYSTEM_METADATA, {
          id: counterKey,
          lastSeq: nextSeq,
          updatedAt: timestamp,
        });

        const folio = `CM-${dateStr}-${String(nextSeq).padStart(3, '0')}`;

        // Obtener productos y unidades
        const allProducts = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const productMap = new Map<string, ProductRecord>();
        for (const p of allProducts) {
          productMap.set(p.id, p);
        }

        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitMap.set(u.id, u);
        }

        // Obtener capas de costos si se va a ajustar stock
        const allCostLayers = await tx.getAll<ProductCostLayer>(StoreName.WAREHOUSE_COST_LAYERS);
        const costLayersMap = new Map<string, ProductCostLayer>();
        for (const cl of allCostLayers) {
          costLayersMap.set(cl.id, { ...cl });
        }

        const verificationItems: MorningVerificationItem[] = [];
        let differencesCount = 0;

        for (const countItem of input.counts) {
          const product = productMap.get(countItem.productId);
          if (!product) {
            throw new EntityNotFoundError('warehouse_products', countItem.productId);
          }

          const counted = roundQty(countItem.countedStock);
          if (counted < 0) {
            throw new ValidationError(
              `La cantidad física no puede ser negativa para "${product.name}".`
            );
          }

          const systemStock = product.currentStock;
          const diff = roundQty(counted - systemStock);
          const hasDiff = Math.abs(diff) > 0.0001;

          if (hasDiff) {
            differencesCount += 1;
            if (mode === 'ADJUST_STOCK' && (!countItem.differenceReason || !countItem.differenceReason.trim())) {
              throw new ValidationError(
                `El producto "${product.name}" tiene una diferencia de ${diff > 0 ? `+${diff}` : diff}. Se requiere un motivo obligatorio de ajuste.`
              );
            }
          }

          const isAdjusted = mode === 'ADJUST_STOCK' && hasDiff;
          const unit = unitMap.get(product.measurementUnitId);

          if (isAdjusted) {
            // Actualizar stock del producto
            const updatedProduct: ProductRecord = {
              ...product,
              currentStock: counted,
              updatedAt: timestamp,
            };
            await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);
            productMap.set(product.id, updatedProduct);

            // Ajustar capas de costo FIFO
            if (diff < 0) {
              let remainingToDeduct = Math.abs(diff);
              const productLayers = Array.from(costLayersMap.values())
                .filter((l) => l.productId === product.id && l.remainingQuantity > 0)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

              for (const layer of productLayers) {
                if (remainingToDeduct <= 0) break;
                const deduct = Math.min(remainingToDeduct, layer.remainingQuantity);
                layer.remainingQuantity = roundQty(layer.remainingQuantity - deduct);
                costLayersMap.set(layer.id, layer);
                remainingToDeduct = roundQty(remainingToDeduct - deduct);
              }
            } else {
              const newLayerId = generateEntityId();
              const newLayer: ProductCostLayer = {
                id: newLayerId,
                productId: product.id,
                originEntryId: null,
                originalQuantity: diff,
                remainingQuantity: diff,
                unitPurchaseCost: product.lastPurchasePrice || 0,
                createdAt: timestamp,
                updatedAt: timestamp,
                auditRef: `MORNING_VERIFICATION_SURPLUS_${folio}`,
              };
              costLayersMap.set(newLayerId, newLayer);
            }

            // Registrar movimiento en Kardex
            const movement: InventoryMovementRecord = {
              id: generateEntityId(),
              productId: product.id,
              movementType: InventoryMovementType.MORNING_VERIFICATION_ADJUSTMENT,
              quantity: Math.abs(diff),
              signedQuantity: diff,
              previousStock: systemStock,
              resultingStock: counted,
              timestamp,
              responsibleUserId: actor.label,
              originOperationId: operationId,
              reason: `Conteo matutino (${folio}): ${countItem.differenceReason || 'Ajuste de inventario'}`,
              workdayId: activeWorkday?.id ?? null,
              workdayFolio: activeWorkday?.code ?? null,
            };
            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
          }

          verificationItems.push({
            productId: product.id,
            productCode: product.sku ?? `PRD-${product.id.slice(0, 8).toUpperCase()}`,
            productName: product.name,
            sku: product.sku ?? null,
            measurementUnitId: product.measurementUnitId,
            unitName: unit?.name ?? 'Unidad',
            unitSymbol: unit?.name ?? 'u.',
            systemStock,
            countedStock: counted,
            difference: diff,
            differenceReason: countItem.differenceReason?.trim() || null,
            isAdjusted,
          });
        }

        // Persistir capas de costos si se modificaron
        if (mode === 'ADJUST_STOCK') {
          for (const layer of costLayersMap.values()) {
            await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, layer);
          }
        }

        const verificationRecord: MorningStockVerificationRecord = {
          id: operationId,
          folio,
          date: timestamp.substring(0, 10),
          timestamp,
          mode,
          actorRole: actor.role,
          actorLabel: actor.label,
          totalProductsCounted: verificationItems.length,
          differencesCount,
          notes: input.notes?.trim() || null,
          items: verificationItems,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        // Guardar en SYSTEM_METADATA lista histórica de actas matutinas
        const historyKey = 'morning_verification_history_records';
        const existingHistory = await tx.get<{ id: string; records: MorningStockVerificationRecord[] }>(
          StoreName.SYSTEM_METADATA,
          historyKey
        );
        const updatedList = [verificationRecord, ...(existingHistory?.records || [])];
        await tx.upsert(StoreName.SYSTEM_METADATA, {
          id: historyKey,
          records: updatedList.slice(0, 50), // Conservar las 50 actas más recientes
          updatedAt: timestamp,
        });

        // Registrar en OPERATION_HISTORY
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'MORNING_STOCK_VERIFICATION',
          entityType: 'InventoryVerification',
          entityId: operationId,
          actorRole: actor.role,
          description: `Conteo matutino ${folio} (${mode === 'ADJUST_STOCK' ? 'Ajuste de inventario aplicado' : 'Solo acta de auditoría'}): ${verificationItems.length} productos verificados, ${differencesCount} con diferencias.`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return verificationRecord;
      }
    );
  }
}
