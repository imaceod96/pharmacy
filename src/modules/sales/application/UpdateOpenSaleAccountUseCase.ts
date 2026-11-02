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
  SaleLineDraftInput,
  SaleLineItemRecord,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';

export interface UpdateOpenSaleAccountInput {
  readonly saleId: string;
  readonly accountName?: string;
  readonly items: readonly SaleLineDraftInput[];
  readonly expectedUpdatedAt?: string;
  readonly syncToCatalogPrices?: boolean;
  readonly operationId?: string;
}

export interface UpdateOpenSaleAccountResult {
  readonly sale: SaleRecord;
  readonly isDuplicate?: boolean;
}

export class UpdateOpenSaleAccountUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: UpdateOpenSaleAccountInput
  ): Promise<UpdateOpenSaleAccountResult> {
    assertPermission(actor, Permission.CREATE_SALE, 'editar una cuenta abierta');

    const saleId = (input.saleId || '').trim();
    if (!saleId) {
      throw new ValidationError('El identificador de la cuenta abierta es obligatorio.');
    }

    const consolidatedLines = consolidateSaleLineInputs(input.items);
    const timestamp = nowISO();
    const auditId = input.operationId || generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_UNITS,
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
          if (existingSale) {
            return {
              sale: existingSale,
              isDuplicate: true,
            };
          }
        }

        // 1. Validar jornada activa
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday =
          allWorkdays.find((w) => isOperativeWorkday(w.status)) ?? null;
        const salesValidation = validateActiveWorkdayForSales(activeWorkday);

        if (!salesValidation.canOperateSales || !salesValidation.activeWorkday) {
          throw new ValidationError(
            salesValidation.message ||
              'No hay una jornada abierta habilitada para modificar cuentas abiertas.'
          );
        }

        // 2. Obtener y verificar estado de la cuenta abierta
        const existingSale = await tx.get<SaleRecord>(StoreName.SALES_RECORDS, saleId);
        if (!existingSale) {
          throw new EntityNotFoundError('sales_records', saleId);
        }

        if (existingSale.status !== SaleStatus.OPEN) {
          throw new ValidationError(
            existingSale.status === SaleStatus.DISPATCHED
              ? 'No es posible editar una cuenta que ya fue despachada.'
              : 'No es posible editar una cuenta que fue cancelada.'
          );
        }

        // 3. Control de concurrencia optimista
        if (
          input.expectedUpdatedAt &&
          existingSale.updatedAt !== input.expectedUpdatedAt
        ) {
          throw new ValidationError(
            'La cuenta abierta fue modificada recientemente por otra operación. Actualiza la vista antes de guardar los cambios.'
          );
        }

        // 4. Validar nombre de la cuenta
        const nextAccountName =
          input.accountName !== undefined
            ? input.accountName.trim()
            : (existingSale.accountName ?? existingSale.customerOrTableLabel ?? '').trim();

        if (!nextAccountName) {
          throw new ValidationError(
            'El nombre de la cuenta abierta no puede quedar vacío.'
          );
        }

        if (nextAccountName.length > 80) {
          throw new ValidationError(
            'El nombre de la cuenta abierta no puede exceder 80 caracteres.'
          );
        }

        // 5. Validar productos, calcular deltas de existencias y registrar movimientos en Kardex
        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitMap.set(u.id, u);
        }

        const existingPriceByProduct = new Map<string, number>();
        const previousQtyByProduct = new Map<string, number>();
        for (const item of existingSale.items ?? []) {
          existingPriceByProduct.set(item.productId, item.unitSalePrice);
          previousQtyByProduct.set(item.productId, item.quantity);
        }

        const newQtyByProduct = new Map<string, number>();
        for (const line of consolidatedLines) {
          newQtyByProduct.set(line.productId, line.quantity);
        }

        const allProductIds = new Set<string>([
          ...previousQtyByProduct.keys(),
          ...newQtyByProduct.keys(),
        ]);

        const inventoryMovementIds = [...(existingSale.inventoryMovementIds ?? [])];

        for (const prodId of allProductIds) {
          const prevQty = previousQtyByProduct.get(prodId) ?? 0;
          const newQty = newQtyByProduct.get(prodId) ?? 0;
          const delta = Math.round((newQty - prevQty) * 1000) / 1000;

          if (delta === 0) continue;

          const product = await tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, prodId);
          if (!product) {
            throw new EntityNotFoundError('warehouse_products', prodId);
          }

          if (delta > 0) {
            if (product.status !== ProductStatus.ACTIVE) {
              throw new ValidationError(
                `El producto "${product.name}" se encuentra inactivo y no se pueden agregar más unidades.`
              );
            }
            if (delta > product.currentStock) {
              throw new ValidationError(
                `La cantidad adicional solicitada para "${product.name}" (${delta}) supera las existencias disponibles (${product.currentStock}).`
              );
            }

            const previousStock = product.currentStock;
            const resultingStock = Math.round((previousStock - delta) * 1000) / 1000;

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
              quantity: delta,
              signedQuantity: -delta,
              previousStock,
              resultingStock,
              timestamp,
              responsibleUserId: actor.role,
              originOperationId: existingSale.id,
              reason: `Adición a cuenta abierta ${existingSale.folio} (${nextAccountName})`,
              workdayId: existingSale.createdWorkdayId ?? null,
            };
            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
            inventoryMovementIds.push(movementId);
          } else {
            // delta < 0: Reintegro de existencias al almacén
            const restoreQty = Math.abs(delta);
            const previousStock = product.currentStock;
            const resultingStock = Math.round((previousStock + restoreQty) * 1000) / 1000;

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
              quantity: restoreQty,
              signedQuantity: restoreQty,
              previousStock,
              resultingStock,
              timestamp,
              responsibleUserId: actor.role,
              originOperationId: existingSale.id,
              reason: `Reintegro por reducción en cuenta abierta ${existingSale.folio} (${nextAccountName})`,
              workdayId: existingSale.createdWorkdayId ?? null,
            };
            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
            inventoryMovementIds.push(movementId);
          }
        }

        const lineItems: SaleLineItemRecord[] = [];
        let totalAmount = 0;

        for (const draftLine of consolidatedLines) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            draftLine.productId
          );
          if (!product) continue;

          const unit = unitMap.get(product.measurementUnitId);
          const unitSalePrice =
            input.syncToCatalogPrices !== false
              ? product.currentSalePrice
              : (draftLine.customUnitSalePrice ??
                existingPriceByProduct.get(product.id) ??
                product.currentSalePrice);

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

        const updatedSale: SaleRecord = {
          ...existingSale,
          accountName: nextAccountName,
          customerOrTableLabel: nextAccountName,
          items: lineItems,
          totalAmount,
          hasStockMovement: inventoryMovementIds.length > 0,
          inventoryMovementIds,
          updatedAt: timestamp,
        };

        await tx.upsert(StoreName.SALES_RECORDS, updatedSale);

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.SALES,
          action: 'UPDATE_OPEN_SALE_ACCOUNT',
          entityType: 'Sale',
          entityId: updatedSale.id,
          actorRole: actor.role,
          description: `Actualización de cuenta abierta ${updatedSale.folio} — ${nextAccountName} (${lineItems.length} partida(s), importe actualizado $${totalAmount.toFixed(2)}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          sale: updatedSale,
        };
      }
    );
  }
}
