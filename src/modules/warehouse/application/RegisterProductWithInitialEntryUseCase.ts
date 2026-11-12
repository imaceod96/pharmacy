import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { DuplicateRecordError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import {
  calculateTotalEntryCost,
  resolveSalePrice,
  validatePurchasePrice,
  validateQuantity,
} from '../../../shared/utils/money';
import { normalizeName } from '../../../shared/utils/string';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { ProductCostLayer } from '../domain/entities/ProductCostLayer';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { MerchandiseEntryRecord } from '../domain/entities/MerchandiseEntryRecord';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';

export interface RegisterProductWithInitialEntryInput {
  readonly name: string;
  readonly sku?: string | null;
  readonly categoryId: string;
  readonly measurementUnitId: string;
  readonly initialQuantity: number;
  readonly unitPurchasePrice: number;
  readonly declaredSalePrice: number;
  readonly declaredEntryDate?: string;
  readonly expirationDate?: string | null;
}

export class RegisterProductWithInitialEntryUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: RegisterProductWithInitialEntryInput
  ): Promise<ProductRecord> {
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'registrar producto con entrada inicial');

    // 1. Validar nombre del producto
    const trimmedName = (input.name || '').trim();
    if (!trimmedName) {
      throw new ValidationError('El nombre del producto es obligatorio.');
    }
    const normalizedName = normalizeName(trimmedName);

    // 2. Validar SKU si está informado
    const trimmedSku = input.sku ? input.sku.trim() : null;
    const expirationDate = input.expirationDate ? input.expirationDate.trim() : null;

    // 3. Validar cantidades y precios con reglas seguras
    validateQuantity(input.initialQuantity, 'La cantidad de entrada inicial');
    validatePurchasePrice(input.unitPurchasePrice);
    const salePrice = resolveSalePrice(input.declaredSalePrice, input.unitPurchasePrice);
    const totalEntryCost = calculateTotalEntryCost(input.initialQuantity, input.unitPurchasePrice);

    const timestamp = nowISO();
    const declaredEntryDate = input.declaredEntryDate || timestamp.slice(0, 10);

    const productId = generateEntityId();
    const entryId = generateEntityId();
    const movementId = generateEntityId();

    const product: ProductRecord = {
      id: productId,
      name: trimmedName,
      normalizedName,
      sku: trimmedSku || null,
      categoryId: input.categoryId,
      measurementUnitId: input.measurementUnitId,
      currentStock: input.initialQuantity,
      lastPurchasePrice: input.unitPurchasePrice,
      currentSalePrice: salePrice,
      status: ProductStatus.ACTIVE,
      expirationDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const merchandiseEntry: MerchandiseEntryRecord = {
      id: entryId,
      productId,
      quantity: input.initialQuantity,
      unitPurchasePrice: input.unitPurchasePrice,
      declaredSalePrice: salePrice,
      totalEntryCost,
      declaredEntryDate,
      expirationDate,
      registeredAt: timestamp,
      responsibleUserId: actor.label,
    };

    const inventoryMovement: InventoryMovementRecord = {
      id: movementId,
      productId,
      movementType: InventoryMovementType.ENTRY,
      quantity: input.initialQuantity,
      previousStock: 0,
      resultingStock: input.initialQuantity,
      timestamp,
      responsibleUserId: actor.label,
      originOperationId: entryId,
    };

    const auditEntry: OperationLogEntry = {
      id: generateEntityId(),
      module: OperationModule.WAREHOUSE,
      action: 'REGISTER_PRODUCT_INITIAL_ENTRY',
      entityType: 'Product',
      entityId: productId,
      actorRole: actor.role,
      description: `Alta de producto "${trimmedName}" con entrada inicial de ${input.initialQuantity} unidades a $${input.unitPurchasePrice.toFixed(2)} c/u (Precio de venta: $${salePrice}).`,
      createdAt: timestamp,
    };

    // Operación atómica multi-almacén
    await this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.WAREHOUSE_CATEGORIES,
        StoreName.WAREHOUSE_UNITS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // Verificar unicidad de nombre de producto
        const productsWithSameName = await tx.getAllByIndex<ProductRecord>(
          StoreName.WAREHOUSE_PRODUCTS,
          'by_normalized_name',
          normalizedName
        );
        if (productsWithSameName.length > 0) {
          throw new DuplicateRecordError('warehouse_products', `nombre: "${trimmedName}"`);
        }

        // Verificar unicidad de SKU si se proporcionó
        if (trimmedSku) {
          const productsWithSameSku = await tx.getAllByIndex<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            'by_sku',
            trimmedSku
          );
          if (productsWithSameSku.length > 0) {
            throw new DuplicateRecordError('warehouse_products', `SKU: "${trimmedSku}"`);
          }
        }

        // Verificar existencia de la categoría
        const category = await tx.get<CategoryRecord>(
          StoreName.WAREHOUSE_CATEGORIES,
          input.categoryId
        );
        if (!category) {
          throw new ValidationError('La categoría seleccionada no existe en el catálogo.');
        }

        // Verificar existencia de la unidad de medida
        const unit = await tx.get<MeasurementUnitRecord>(
          StoreName.WAREHOUSE_UNITS,
          input.measurementUnitId
        );
        if (!unit) {
          throw new ValidationError('La unidad de medida seleccionada no existe en el catálogo.');
        }

        const costLayerId = generateEntityId();
        const costLayer: ProductCostLayer = {
          id: costLayerId,
          productId,
          originEntryId: entryId,
          originalQuantity: input.initialQuantity,
          remainingQuantity: input.initialQuantity,
          unitPurchaseCost: input.unitPurchasePrice,
          expirationDate,
          createdAt: timestamp,
          updatedAt: timestamp,
          auditRef: 'INITIAL_ENTRY',
        };

        // Insertar entidades relacionadas
        await tx.insert(StoreName.WAREHOUSE_PRODUCTS, product);
        await tx.insert(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, merchandiseEntry);
        await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, inventoryMovement);
        await tx.insert(StoreName.WAREHOUSE_COST_LAYERS, costLayer);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);
      }
    );

    return product;
  }
}
