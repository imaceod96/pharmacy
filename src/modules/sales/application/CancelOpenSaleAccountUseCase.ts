import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../../warehouse/domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../../warehouse/domain/entities/ProductRecord';
import {
  formatSaleDisplayLabel,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';

export interface CancelOpenSaleAccountInput {
  readonly saleId: string;
  readonly reason: string;
  readonly expectedUpdatedAt?: string;
  readonly operationId?: string;
}

export interface CancelOpenSaleAccountResult {
  readonly sale: SaleRecord;
  readonly isDuplicate?: boolean;
}

export class CancelOpenSaleAccountUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: CancelOpenSaleAccountInput
  ): Promise<CancelOpenSaleAccountResult> {
    assertPermission(actor, Permission.CREATE_SALE, 'cancelar una cuenta abierta');

    const saleId = (input.saleId || '').trim();
    if (!saleId) {
      throw new ValidationError('El identificador de la cuenta abierta es obligatorio.');
    }

    const reason = (input.reason || '').trim();
    if (!reason) {
      throw new ValidationError(
        'El motivo de cancelación de la cuenta abierta es obligatorio.'
      );
    }

    if (reason.length > 300) {
      throw new ValidationError(
        'El motivo de cancelación no puede exceder 300 caracteres.'
      );
    }

    const timestamp = nowISO();
    const auditId = input.operationId || generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Idempotencia por auditId
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          auditId
        );
        if (existingOp && existingOp.entityId) {
          const existingSale = await tx.get<SaleRecord>(
            StoreName.SALES_RECORDS,
            existingOp.entityId
          );
          if (existingSale && existingSale.status === SaleStatus.CANCELLED) {
            return {
              sale: existingSale,
              isDuplicate: true,
            };
          }
        }

        const existingSale = await tx.get<SaleRecord>(
          StoreName.SALES_RECORDS,
          saleId
        );
        if (!existingSale) {
          throw new EntityNotFoundError('sales_records', saleId);
        }

        if (
          existingSale.status === SaleStatus.DISPATCHED ||
          (existingSale.status as string) === 'COMPLETED'
        ) {
          throw new ValidationError(
            `No se permite cancelar la cuenta ${formatSaleDisplayLabel(existingSale)} porque ya fue despachada.`
          );
        }

        if (existingSale.status === SaleStatus.CANCELLED) {
          throw new ValidationError(
            `La cuenta ${formatSaleDisplayLabel(existingSale)} ya se encuentra cancelada.`
          );
        }

        if (
          input.expectedUpdatedAt &&
          existingSale.updatedAt !== input.expectedUpdatedAt
        ) {
          throw new ValidationError(
            'La cuenta abierta fue modificada recientemente. Recarga los datos antes de cancelarla.'
          );
        }

        // Reintegrar todas las existencias de los productos de la cuenta al almacén
        const inventoryMovementIds = [...(existingSale.inventoryMovementIds ?? [])];

        for (const item of existingSale.items ?? []) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            item.productId
          );
          if (!product) continue;

          const previousStock = product.currentStock;
          const resultingStock = Math.round((previousStock + item.quantity) * 1000) / 1000;

          await tx.upsert<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, {
            ...product,
            currentStock: resultingStock,
            updatedAt: timestamp,
          });

          const movementId = generateEntityId();
          const movement: InventoryMovementRecord = {
            id: movementId,
            productId: product.id,
            movementType: InventoryMovementType.CORRECTION_POSITIVE,
            quantity: item.quantity,
            signedQuantity: item.quantity,
            previousStock,
            resultingStock,
            timestamp,
            responsibleUserId: actor.role,
            originOperationId: existingSale.id,
            reason: `Reintegro por cancelación de cuenta abierta ${formatSaleDisplayLabel(existingSale)}: ${reason}`,
            workdayId: existingSale.createdWorkdayId ?? null,
          };
          await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
          inventoryMovementIds.push(movementId);
        }

        const cancelledSale: SaleRecord = {
          ...existingSale,
          status: SaleStatus.CANCELLED,
          closedAt: timestamp,
          cancelledAt: timestamp,
          cancelledByUserId: actor.role,
          cancelledByUserLabel: actor.label,
          cancellationReason: reason,
          hasStockMovement: false,
          inventoryMovementIds,
          updatedAt: timestamp,
        };

        await tx.upsert(StoreName.SALES_RECORDS, cancelledSale);

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.SALES,
          action: 'CANCEL_OPEN_SALE_ACCOUNT',
          entityType: 'Sale',
          entityId: cancelledSale.id,
          actorRole: actor.role,
          description: `Cancelación auditada de cuenta abierta ${formatSaleDisplayLabel(cancelledSale)}. Motivo: ${reason}`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          sale: cancelledSale,
        };
      }
    );
  }
}
