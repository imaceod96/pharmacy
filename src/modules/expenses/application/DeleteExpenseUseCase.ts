import { generateEntityId } from '../../../shared/utils/id';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionContext, TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { OperationModule } from '../../core/domain/entities/OperationLog';
import { InventoryMovementRecord, InventoryMovementType } from '../../warehouse/domain/entities/InventoryMovementRecord';
import { ProductCostLayer } from '../../warehouse/domain/entities/ProductCostLayer';
import { calculateProductAvailability, ProductRecord } from '../../warehouse/domain/entities/ProductRecord';
import { ExpenseRecord, ExpenseType } from '../domain/entities/ExpenseRecord';

export class DeleteExpenseUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    expenseId: string
  ): Promise<void> {
    assertPermission(actor, Permission.CREATE_EXPENSE, 'eliminar o anular registro de gasto');

    const timestamp = nowISO();

    return this.transactionManager.runTransaction<void>(
      [
        StoreName.EXPENSES,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx: TransactionContext) => {
        const expense = await tx.get<ExpenseRecord>(StoreName.EXPENSES, expenseId);
        if (!expense) {
          throw new EntityNotFoundError('Registro de gasto', expenseId);
        }

        // Si fue un gasto por autoconsumo de producto, restituir existencias y crear movimiento positivo
        if (expense.type === ExpenseType.INVENTORY_PRODUCT && expense.productId && expense.quantity && expense.quantity > 0) {
          const product = await tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, expense.productId);
          if (product) {
            const prevStock = product.currentStock;
            const newStock = Math.round((prevStock + expense.quantity) * 1000) / 1000;

            const updatedProduct: ProductRecord = {
              ...product,
              currentStock: newStock,
              availability: calculateProductAvailability(product.status, newStock),
              updatedAt: timestamp,
            };
            await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

            // Recrear capa FIFO restituida por el costo unitario
            const unitCost = expense.unitCost || product.lastPurchasePrice || 0;
            const restoredLayer: ProductCostLayer = {
              id: generateEntityId(),
              productId: product.id,
              originEntryId: null,
              originalQuantity: expense.quantity,
              remainingQuantity: expense.quantity,
              unitPurchaseCost: unitCost,
              createdAt: timestamp,
              updatedAt: timestamp,
              auditRef: 'ANULACION_GASTO_AUTOCONSUMO',
            };
            await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, restoredLayer);

            const movement: InventoryMovementRecord = {
              id: generateEntityId(),
              productId: product.id,
              movementType: InventoryMovementType.CORRECTION_POSITIVE,
              quantity: expense.quantity,
              previousStock: prevStock,
              resultingStock: newStock,
              timestamp,
              responsibleUserId: actor.label,
              originOperationId: expenseId,
              reason: 'ANULACION_GASTO_AUTOCONSUMO',
              workdayId: expense.workdayId,
            };
            await tx.upsert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
          }
        }

        // Eliminar el gasto
        await tx.remove(StoreName.EXPENSES, expenseId);

        await tx.insert(StoreName.OPERATION_HISTORY, {
          id: generateEntityId(),
          module: OperationModule.SALES,
          actorRole: actor.role,
          description: `Anulación de gasto por $${expense.amount.toFixed(2)} (${expense.description})`,
          createdAt: timestamp,
          entityId: expenseId,
        });
      }
    );
  }
}
