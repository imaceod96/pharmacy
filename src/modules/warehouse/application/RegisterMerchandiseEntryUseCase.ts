import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { isFutureDate, nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import {
  calculateTotalEntryCost,
  resolveSalePrice,
  validatePurchasePrice,
  validateQuantity,
} from '../../../shared/utils/money';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../domain/entities/InventoryMovementRecord';
import { ProductCostLayer } from '../domain/entities/ProductCostLayer';
import { MerchandiseEntryRecord } from '../domain/entities/MerchandiseEntryRecord';
import { PriceChangeRecord } from '../domain/entities/ProductHistoryRecords';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';

export interface RegisterMerchandiseEntryInput {
  readonly operationId?: string;
  readonly productId: string;
  readonly receivedQuantity: number;
  readonly unitPurchasePrice: number;
  readonly declaredSalePrice: number;
  readonly declaredEntryDate: string; // YYYY-MM-DD
  readonly expirationDate?: string | null;
}

export interface RegisterMerchandiseEntryResult {
  readonly product: ProductRecord;
  readonly entry: MerchandiseEntryRecord;
  readonly movement: InventoryMovementRecord;
  readonly priceChange: PriceChangeRecord | null;
  readonly isDuplicate?: boolean;
}

export class RegisterMerchandiseEntryUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: RegisterMerchandiseEntryInput
  ): Promise<RegisterMerchandiseEntryResult> {
    // 1. Autorización: solo Administrador con permiso MANAGE_PRODUCTS
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'registrar nueva entrada de mercancía');

    // 2. Validación de fecha declarada (permite pasado y hoy; prohíbe futuro)
    const declaredEntryDate = (input.declaredEntryDate || '').trim();
    if (!declaredEntryDate) {
      throw new ValidationError('La fecha de entrada de mercancía es obligatoria.');
    }
    if (isFutureDate(declaredEntryDate)) {
      throw new ValidationError('La fecha declarada de la entrada no puede ser futura.');
    }

    // 3. Validación numérica de cantidad y precios con reglas del dominio
    validateQuantity(input.receivedQuantity, 'La cantidad recibida');
    validatePurchasePrice(input.unitPurchasePrice);
    const resolvedSalePrice = resolveSalePrice(input.declaredSalePrice, input.unitPurchasePrice);
    const totalEntryCost = calculateTotalEntryCost(input.receivedQuantity, input.unitPurchasePrice);

    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();
    const entryId = generateEntityId();
    const movementId = generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.WAREHOUSE_PRICE_CHANGES,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Idempotencia: si la operación ya se registró bajo este operationId, no duplicar
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          operationId
        );
        if (existingOp) {
          const currentProd = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            input.productId
          );
          if (currentProd) {
            // Retorna producto existente sin re-aplicar stock
            const entries = await tx.getAllByIndex<MerchandiseEntryRecord>(
              StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
              'by_product_id',
              input.productId
            );
            const latestEntry = entries[entries.length - 1];
            return {
              product: currentProd,
              entry: latestEntry,
              movement: null as unknown as InventoryMovementRecord,
              priceChange: null,
              isDuplicate: true,
            };
          }
        }

        // Obtener y validar producto existente
        const product = await tx.get<ProductRecord>(
          StoreName.WAREHOUSE_PRODUCTS,
          input.productId
        );
        if (!product) {
          throw new EntityNotFoundError('warehouse_products', input.productId);
        }

        // Regla estricta: producto debe estar ACTIVO
        if (product.status === ProductStatus.INACTIVE) {
          throw new ValidationError(
            `No se pueden registrar entradas de mercancía para el producto "${product.name}" porque se encuentra inactivo.`
          );
        }

        // Cálculo de existencias con redondeo seguro
        const previousStock = product.currentStock;
        const newStock = Math.round((previousStock + input.receivedQuantity) * 100) / 100;

        // Detección de cambio en precio de venta
        const previousSalePrice = product.currentSalePrice;
        const hasPriceChanged = Math.abs(resolvedSalePrice - previousSalePrice) > 0.0001;

        let priceChangeRecord: PriceChangeRecord | null = null;
        if (hasPriceChanged) {
          priceChangeRecord = {
            id: generateEntityId(),
            productId: product.id,
            previousSalePrice,
            newSalePrice: resolvedSalePrice,
            lastPurchasePrice: input.unitPurchasePrice,
            changedAt: timestamp,
            responsibleUserId: actor.label,
            reason: `Actualización por nueva entrada de mercancía (+${input.receivedQuantity} unidades a $${input.unitPurchasePrice.toFixed(2)})`,
          };
          await tx.insert(StoreName.WAREHOUSE_PRICE_CHANGES, priceChangeRecord);
        }

        const newExpirationDate = input.expirationDate !== undefined && input.expirationDate !== null && input.expirationDate.trim() !== ''
          ? input.expirationDate.trim()
          : (product.expirationDate ?? null);

        // Actualización inmutable del producto
        const updatedProduct: ProductRecord = {
          ...product,
          currentStock: newStock,
          lastPurchasePrice: input.unitPurchasePrice,
          currentSalePrice: resolvedSalePrice,
          expirationDate: newExpirationDate,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);

        // Registro inmutable de entrada de mercancía
        const merchandiseEntry: MerchandiseEntryRecord = {
          id: entryId,
          productId: product.id,
          quantity: input.receivedQuantity,
          unitPurchasePrice: input.unitPurchasePrice,
          declaredSalePrice: resolvedSalePrice,
          totalEntryCost,
          declaredEntryDate,
          expirationDate: input.expirationDate ? input.expirationDate.trim() : null,
          registeredAt: timestamp,
          responsibleUserId: actor.label,
        };
        await tx.insert(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, merchandiseEntry);

        // Registro de movimiento en kardex de inventario
        const movement: InventoryMovementRecord = {
          id: movementId,
          productId: product.id,
          movementType: InventoryMovementType.ENTRY,
          quantity: input.receivedQuantity,
          previousStock,
          resultingStock: newStock,
          timestamp,
          responsibleUserId: actor.label,
          originOperationId: entryId,
        };
        await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);

        const costLayerId = generateEntityId();
        const costLayer: ProductCostLayer = {
          id: costLayerId,
          productId: product.id,
          originEntryId: entryId,
          originalQuantity: input.receivedQuantity,
          remainingQuantity: input.receivedQuantity,
          unitPurchaseCost: input.unitPurchasePrice,
          expirationDate: input.expirationDate ? input.expirationDate.trim() : null,
          createdAt: timestamp,
          updatedAt: timestamp,
          auditRef: 'MERCHANDISE_ENTRY',
        };
        await tx.insert(StoreName.WAREHOUSE_COST_LAYERS, costLayer);

        // Registro de auditoría administrativa
        const auditDescription = hasPriceChanged
          ? `Nueva entrada de ${input.receivedQuantity} unidades para "${product.name}". Existencia: ${previousStock} -> ${newStock}. Costo unitario: $${input.unitPurchasePrice.toFixed(2)}. Precio venta actualizado: $${previousSalePrice} -> $${resolvedSalePrice}.`
          : `Nueva entrada de ${input.receivedQuantity} unidades para "${product.name}". Existencia: ${previousStock} -> ${newStock}. Costo unitario: $${input.unitPurchasePrice.toFixed(2)}. Precio venta sin cambios ($${resolvedSalePrice}).`;

        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'REGISTER_MERCHANDISE_ENTRY',
          entityType: 'Product',
          entityId: product.id,
          actorRole: actor.role,
          description: auditDescription,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          product: updatedProduct,
          entry: merchandiseEntry,
          movement,
          priceChange: priceChangeRecord,
        };
      }
    );
  }
}
