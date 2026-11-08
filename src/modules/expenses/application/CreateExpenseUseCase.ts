import { generateEntityId } from '../../../shared/utils/id';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionContext, TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { OperationModule } from '../../core/domain/entities/OperationLog';
import { InventoryMovementRecord, InventoryMovementType } from '../../warehouse/domain/entities/InventoryMovementRecord';
import { ProductCostLayer } from '../../warehouse/domain/entities/ProductCostLayer';
import { calculateProductAvailability, ProductRecord } from '../../warehouse/domain/entities/ProductRecord';
import { WorkdayRecord, WorkdayStatus } from '../../warehouse/domain/entities/WorkdayRecord';
import { ExpenseRecord, ExpenseType } from '../domain/entities/ExpenseRecord';

export interface CreateManualExpensePayload {
  readonly type: ExpenseType.MANUAL;
  readonly description: string;
  readonly amount: number;
}

export interface CreateProductExpensePayload {
  readonly type: ExpenseType.INVENTORY_PRODUCT;
  readonly productId: string;
  readonly quantity: number;
  readonly description?: string;
}

export type CreateExpensePayload = CreateManualExpensePayload | CreateProductExpensePayload;

export class CreateExpenseUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    payload: CreateExpensePayload
  ): Promise<ExpenseRecord> {
    assertPermission(actor, Permission.CREATE_EXPENSE, 'registrar gasto operativo');

    const timestamp = nowISO();
    const expenseId = generateEntityId();

    return this.transactionManager.runTransaction<ExpenseRecord>(
      [
        StoreName.EXPENSES,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx: TransactionContext) => {
        // Obtener jornada activa (si existe)
        const workdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday = workdays.find((w: WorkdayRecord) => w.status === WorkdayStatus.OPEN || w.status === WorkdayStatus.CLOSING_SUSPENDED) ?? null;
        const activeWorkdayId = activeWorkday?.id ?? null;

        if (payload.type === ExpenseType.MANUAL) {
          const cleanDesc = payload.description.trim();
          if (!cleanDesc) {
            throw new ValidationError('El gasto manual requiere un concepto o descripción explicativa.');
          }
          if (typeof payload.amount !== 'number' || payload.amount <= 0 || !Number.isFinite(payload.amount)) {
            throw new ValidationError('El monto del gasto manual debe ser un número mayor a cero.');
          }

          const expense: ExpenseRecord = {
            id: expenseId,
            workdayId: activeWorkdayId,
            type: ExpenseType.MANUAL,
            description: cleanDesc,
            amount: Math.round(payload.amount * 100) / 100,
            timestamp,
            responsibleUserId: actor.role,
            responsibleUserLabel: actor.label,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          await tx.upsert(StoreName.EXPENSES, expense);
          await tx.insert(StoreName.OPERATION_HISTORY, {
            id: generateEntityId(),
            module: OperationModule.SALES,
            actorRole: actor.role,
            description: `Registro de gasto manual "${cleanDesc}" por $${expense.amount.toFixed(2)}`,
            createdAt: timestamp,
            entityId: expenseId,
          });

          return expense;
        }

        // Tipo: INVENTORY_PRODUCT (Autoconsumo)
        if (typeof payload.quantity !== 'number' || payload.quantity <= 0 || !Number.isFinite(payload.quantity)) {
          throw new ValidationError('La cantidad de producto a registrar como gasto debe ser mayor a cero.');
        }

        const product = await tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, payload.productId);
        if (!product) {
          throw new EntityNotFoundError('Producto', payload.productId);
        }

        if (product.currentStock < payload.quantity) {
          throw new ValidationError(
            `Existencias insuficientes de "${product.name}". Disponibles: ${product.currentStock}, Solicitadas: ${payload.quantity}.`
          );
        }

        const prevStock = product.currentStock;
        const newStock = Math.round((prevStock - payload.quantity) * 1000) / 1000;

        // Atribuir costo FIFO
        const costLayers = (
          await tx.getAllByIndex<ProductCostLayer>(
            StoreName.WAREHOUSE_COST_LAYERS,
            'by_product_id',
            product.id
          )
        ).sort((a: ProductCostLayer, b: ProductCostLayer) => a.createdAt.localeCompare(b.createdAt));

        let remainingToDeduct = payload.quantity;
        let totalAllocatedCost = 0;

        for (const layer of costLayers) {
          if (remainingToDeduct <= 0) break;
          if (layer.remainingQuantity <= 0) continue;

          const take = Math.min(remainingToDeduct, layer.remainingQuantity);
          const layerCost = take * layer.unitPurchaseCost;
          totalAllocatedCost += layerCost;

          const updatedLayer: ProductCostLayer = {
            ...layer,
            remainingQuantity: Math.round((layer.remainingQuantity - take) * 1000) / 1000,
            updatedAt: timestamp,
          };
          await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, updatedLayer);

          remainingToDeduct = Math.round((remainingToDeduct - take) * 1000) / 1000;
        }

        // Si faltó por cubrir en capas FIFO, usar lastPurchasePrice del catálogo
        if (remainingToDeduct > 0) {
          const fallbackCost = (product.lastPurchasePrice || 0) * remainingToDeduct;
          totalAllocatedCost += fallbackCost;
        }

        const roundedTotalCost = Math.round(totalAllocatedCost * 100) / 100;
        const unitCost = payload.quantity > 0 ? Math.round((roundedTotalCost / payload.quantity) * 100) / 100 : 0;

        // Actualizar stock del producto
        const updatedProduct: ProductRecord = {
          ...product,
          currentStock: newStock,
          availability: calculateProductAvailability(product.status, newStock),
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

        // Registrar movimiento de salida Kardex
        const movement: InventoryMovementRecord = {
          id: generateEntityId(),
          productId: product.id,
          movementType: InventoryMovementType.CORRECTION_NEGATIVE,
          quantity: payload.quantity,
          previousStock: prevStock,
          resultingStock: newStock,
          timestamp,
          responsibleUserId: actor.label,
          originOperationId: expenseId,
          reason: 'GASTO_AUTOCONSUMO',
          workdayId: activeWorkdayId,
          workdayFolio: activeWorkday?.code,
        };
        await tx.upsert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);

        const customDesc = payload.description?.trim();
        const finalDescription = customDesc || `Autoconsumo / Gasto de producto: ${payload.quantity} ${product.name}`;

        const expense: ExpenseRecord = {
          id: expenseId,
          workdayId: activeWorkdayId,
          type: ExpenseType.INVENTORY_PRODUCT,
          productId: product.id,
          productName: product.name,
          productCode: product.sku || product.id,
          quantity: payload.quantity,
          description: finalDescription,
          amount: roundedTotalCost,
          unitCost,
          timestamp,
          responsibleUserId: actor.role,
          responsibleUserLabel: actor.label,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.EXPENSES, expense);

        await tx.insert(StoreName.OPERATION_HISTORY, {
          id: generateEntityId(),
          module: OperationModule.SALES,
          actorRole: actor.role,
          description: `Gasto de producto (Autoconsumo): ${payload.quantity} x "${product.name}" por costo total de $${roundedTotalCost.toFixed(2)}`,
          createdAt: timestamp,
          entityId: expenseId,
        });

        return expense;
      }
    );
  }
}
