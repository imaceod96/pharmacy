import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityId, ISODateString } from '../../../shared/types/entity';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { PendingOpenAccountsError, SaleRecord, SaleStatus, toPendingOpenAccountSummary } from '../../sales/domain/entities/SaleRecord';
import { FINAL_INVENTORY_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE } from './PrepareFinalInventorySelectionUseCase';
import { ProductCostLayer } from '../domain/entities/ProductCostLayer';
import { InventoryMovementRecord, InventoryMovementType } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';
import {
  calculateWorkdayCommercialPerformance,
  WorkdayCommercialPerformanceResult,
} from '../domain/entities/WorkdayCommercialPerformance';

export interface FinalInventoryProductInput {
  readonly productId: EntityId;
  readonly countedQuantity: number;
  readonly differenceReason?: string;
}

export interface ApproveWorkdayClosingInput {
  readonly workdayId?: string;
  readonly counts: Record<string, number>; // productId -> countedQuantity
  readonly differenceReasons: Record<string, string>; // productId -> reason
  readonly notes?: string;
}



export interface ApproveWorkdayClosingResult {
  readonly workday: WorkdayRecord;
  readonly commercialPerformance: WorkdayCommercialPerformanceResult;
  readonly inventoryAdjustmentMovements: readonly InventoryMovementRecord[];
}

export class ApproveWorkdayClosingUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: ApproveWorkdayClosingInput
  ): Promise<ApproveWorkdayClosingResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'aprobar el inventario final y cerrar definitivamente la jornada'
    );

    const timestamp = nowISO();
    const operationId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Las cuentas abiertas se permiten al aprobar el cierre de jornada.
        // Sus cantidades físicas ya fueron descontadas y no suman ingresos hasta su posterior liquidación.

        // 2. Obtener jornada
        let workday: WorkdayRecord | undefined;
        if (input.workdayId) {
          workday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            input.workdayId
          );
          if (!workday) {
            throw new EntityNotFoundError('warehouse_workdays', input.workdayId);
          }
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
          workday = allWorkdays.find((w) => w.status === WorkdayStatus.CLOSING);
          if (!workday) {
            throw new ValidationError('No existe ninguna jornada en proceso de cierre (CLOSING) para aprobar.');
          }
        }

        if (workday.status !== WorkdayStatus.CLOSING) {
          throw new ValidationError(
            `La jornada debe estar en estado CLOSING para aprobar el inventario final (estado actual: ${workday.status}).`
          );
        }

        // 3. Obtener todos los productos y cambios de estado para reconstruir selección automática del inventario final
        const products = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const statusChanges = await tx.getAll(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES);

        // Seleccionar productos activos en cualquier momento de la jornada
        const activeProductIds = new Set<string>();
        for (const p of products) {
          let wasActive = p.status === 'ACTIVE';
          // Evaluar cambios de estado desde openedAt
          const pChanges = statusChanges
            .filter((sc: any) => sc.productId === p.id)
            .sort((a: any, b: any) => a.changedAt.localeCompare(b.changedAt));

          // Estado inicial aproximado o verificación simplificada: si currentStock > 0 o tuvo actividad en jornada
          if (wasActive || pChanges.length > 0) {
            activeProductIds.add(p.id);
          }
        }

        // Para cada producto seleccionado, verificar que se haya proporcionado el conteo físico
        const inventoryMovements: InventoryMovementRecord[] = [];
        const costLayers = await tx.getAll<ProductCostLayer>(StoreName.WAREHOUSE_COST_LAYERS);
        const costLayersMap = new Map<string, ProductCostLayer>();
        for (const cl of costLayers) {
          costLayersMap.set(cl.id, { ...cl });
        }

        for (const product of products) {
          const countedQtyRaw = input.counts[product.id];
          if (countedQtyRaw === undefined || countedQtyRaw === null || Number.isNaN(countedQtyRaw)) {
            throw new ValidationError(
              `Falta capturar la cantidad física final para el producto "${product.name}".`
            );
          }

          const countedQty = roundQuantity(Number(countedQtyRaw));
          if (countedQty < 0) {
            throw new ValidationError(
              `La cantidad física no puede ser negativa para "${product.name}".`
            );
          }

          const theoreticalStock = product.currentStock;
          const diff = roundQuantity(countedQty - theoreticalStock);

          if (Math.abs(diff) > 0.0001) {
            const reason = (input.differenceReasons[product.id] || '').trim();
            if (!reason) {
              throw new ValidationError(
                `El producto "${product.name}" presenta una diferencia de ${diff > 0 ? `+${diff}` : diff}. Se requiere un motivo obligatorio de diferencia.`
              );
            }
          }

          // Aplicar ajuste si hay diferencia
          if (Math.abs(diff) > 0.0001) {
            const newStock = countedQty;
            const updatedProduct: ProductRecord = {
              ...product,
              currentStock: newStock,
              updatedAt: timestamp,
            };
            await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

            if (diff < 0) {
              // Faltante: consumir capas de costo FIFO
              let remainingShortage = Math.abs(diff);
              const productLayers = Array.from(costLayersMap.values())
                .filter((l) => l.productId === product.id && l.remainingQuantity > 0)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

              for (const layer of productLayers) {
                if (remainingShortage <= 0) break;
                const take = Math.min(remainingShortage, layer.remainingQuantity);
                layer.remainingQuantity = roundQuantity(layer.remainingQuantity - take);
                costLayersMap.set(layer.id, layer);
                remainingShortage = roundQuantity(remainingShortage - take);
              }
            } else {
              // Sobrante: crear una nueva capa con costo 0 o último costo de compra
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
                auditRef: 'FINAL_INVENTORY_SURPLUS_ADJUSTMENT',
              };
              costLayersMap.set(newLayerId, newLayer);
            }

            const movementId = generateEntityId();
            const movement: InventoryMovementRecord = {
              id: movementId,
              productId: product.id,
              movementType: InventoryMovementType.FINAL_INVENTORY_ADJUSTMENT,
              quantity: Math.abs(diff),
              previousStock: theoreticalStock,
              resultingStock: newStock,
              timestamp,
              responsibleUserId: actor.label,
              originOperationId: workday.id,
              reason: input.differenceReasons[product.id] || 'Ajuste por inventario final',
              workdayId: workday.id,
            };
            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
            inventoryMovements.push(movement);
          }
        }

        // Guardar capas de costo actualizadas
        for (const cl of costLayersMap.values()) {
          await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, cl);
        }

        // 4. Calcular rendimiento comercial de la jornada a partir de ventas despachadas
        const allSales = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
        const commercialPerformance = calculateWorkdayCommercialPerformance(workday.id, allSales);

        // 5. Cerrar definitivamente la jornada
        const closedWorkday: WorkdayRecord = {
          ...workday,
          status: WorkdayStatus.CLOSED,
          closedAt: timestamp,
          closedByUserId: actor.role,
          closedByUserLabel: actor.label,
          notes: input.notes ? `${workday.notes || ''} [Cierre: ${input.notes}]`.trim() : workday.notes,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_WORKDAYS, closedWorkday);

        // 6. Auditoría
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'APPROVE_WORKDAY_CLOSING',
          entityType: 'Workday',
          entityId: workday.id,
          actorRole: actor.role,
          description: `Aprobación de inventario final y cierre definitivo de la Jornada #${workday.consecutiveNumber} (${workday.code}). Valor comercial: $${commercialPerformance.totalCommercialValue.toFixed(2)}, Costo: $${commercialPerformance.totalCostOfGoodsDispatched.toFixed(2)}, Ganancia bruta: $${commercialPerformance.grossProfit.toFixed(2)} (${commercialPerformance.grossMarginPercentage}%).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          workday: closedWorkday,
          commercialPerformance,
          inventoryAdjustmentMovements: inventoryMovements,
        };
      }
    );
  }
}
