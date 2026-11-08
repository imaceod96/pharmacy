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
import { ProductCostLayer, allocateCostLayersFIFO } from '../../warehouse/domain/entities/ProductCostLayer';
import { MeasurementUnitRecord } from '../../warehouse/domain/entities/MeasurementUnitRecord';
import { ProductRecord, ProductStatus } from '../../warehouse/domain/entities/ProductRecord';
import {
  isOperativeWorkday,
  validateActiveWorkdayForSales,
  WorkdayRecord,
} from '../../warehouse/domain/entities/WorkdayRecord';
import {
  consolidateSaleLineInputs,
  formatDirectDispatchFolio,
  formatSaleDisplayLabel,
  SaleLineDraftInput,
  SaleLineItemRecord,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';

export interface DirectDispatchCounterMetadata {
  readonly id: 'direct_dispatch_sequence_counter';
  readonly lastSequence: number;
  readonly updatedAt: string;
}

export interface DispatchSaleInput {
  /**
   * Si se proporciona, despacha una cuenta abierta existente.
   * Si se omite, realiza un despacho directo sin crear cuenta abierta previa.
   */
  readonly saleId?: string;
  /**
   * Partidas a despachar. Para una cuenta abierta, permite despachar las partidas
   * actuales o editadas; si se omite cuando saleId está presente, usa las partidas guardadas en la cuenta.
   */
  readonly items?: readonly SaleLineDraftInput[];
  /**
   * Nombre opcional cuando se despacha una cuenta abierta y se renombró antes de despachar.
   */
  readonly accountName?: string;
  /**
   * Control de concurrencia optimista para cuentas abiertas.
   */
  readonly expectedUpdatedAt?: string;
  /**
   * Si es true, exige que los precios guardados coincidan con el catálogo actual,
   * o que el usuario haya confirmado expresamente la actualización de precios (`confirmCatalogPriceUpdates: true`).
   */
  readonly requirePriceSyncConfirmation?: boolean;
  readonly confirmCatalogPriceUpdates?: boolean;
  /**
   * Monto opcional pagado mediante transferencia bancaria / QR.
   * Si no se especifica o es 0, se asume que el 100% de la venta es en efectivo.
   */
  readonly transferAmount?: number;
  /**
   * Identificador de operación para garantizar idempotencia.
   */
  readonly operationId?: string;
}

export interface DispatchSaleResult {
  readonly sale: SaleRecord;
  readonly movements: readonly InventoryMovementRecord[];
  readonly updatedProducts: readonly ProductRecord[];
  readonly isDuplicate?: boolean;
}

export class DispatchSaleUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: DispatchSaleInput
  ): Promise<DispatchSaleResult> {
    assertPermission(
      actor,
      Permission.CREATE_SALE,
      'confirmar despacho de mercancía'
    );

    const timestamp = nowISO();
    const operationId = input.operationId || generateEntityId();

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.SALES_RECORDS,
        StoreName.SYSTEM_METADATA,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Idempotencia por operationId
        const existingOp = await tx.get<OperationLogEntry>(
          StoreName.OPERATION_HISTORY,
          operationId
        );
        if (existingOp && existingOp.entityId) {
          const existingSale = await tx.get<SaleRecord>(
            StoreName.SALES_RECORDS,
            existingOp.entityId
          );
          if (existingSale && existingSale.status === SaleStatus.DISPATCHED) {
            const allMoves = await tx.getAllByIndex<InventoryMovementRecord>(
              StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
              'by_origin_operation_id',
              existingSale.id
            );
            return {
              sale: existingSale,
              movements: allMoves,
              updatedProducts: [],
              isDuplicate: true,
            };
          }
        }

        // 2. Validar estado de la jornada dentro de la transacción
        const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday =
          allWorkdays.find((w) => isOperativeWorkday(w.status)) ?? null;
        const salesValidation = validateActiveWorkdayForSales(activeWorkday);

        if (!salesValidation.canOperateSales || !salesValidation.activeWorkday) {
          throw new ValidationError(
            salesValidation.message ||
              'No hay una jornada abierta habilitada para despachar mercancía.'
          );
        }

        const dispatchWorkday = salesValidation.activeWorkday;

        // 3. Si es despacho de una cuenta abierta, cargar y validar la cuenta
        let existingOpenSale: SaleRecord | undefined;
        if (input.saleId) {
          existingOpenSale = await tx.get<SaleRecord>(
            StoreName.SALES_RECORDS,
            input.saleId
          );
          if (!existingOpenSale) {
            throw new EntityNotFoundError('sales_records', input.saleId);
          }

          if (existingOpenSale.status === SaleStatus.DISPATCHED) {
            if (
              input.operationId &&
              existingOpenSale.operationId === input.operationId
            ) {
              const allMoves = await tx.getAllByIndex<InventoryMovementRecord>(
                StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
                'by_origin_operation_id',
                existingOpenSale.id
              );
              return {
                sale: existingOpenSale,
                movements: allMoves,
                updatedProducts: [],
                isDuplicate: true,
              };
            }
            throw new ValidationError(
              `La cuenta ${formatSaleDisplayLabel(existingOpenSale)} ya fue despachada anteriormente.`
            );
          }

          if (existingOpenSale.status === SaleStatus.CANCELLED) {
            throw new ValidationError(
              `No es posible despachar la cuenta ${formatSaleDisplayLabel(existingOpenSale)} porque fue cancelada.`
            );
          }

          if (
            input.expectedUpdatedAt &&
            existingOpenSale.updatedAt !== input.expectedUpdatedAt
          ) {
            throw new ValidationError(
              'La cuenta abierta fue modificada recientemente. Verifica el resumen actualizado antes de confirmar el despacho.'
            );
          }
        }

        // 4. Resolver y consolidar partidas
        const rawDraftLines: readonly SaleLineDraftInput[] =
          input.items && input.items.length > 0
            ? input.items
            : (existingOpenSale?.items ?? []).map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitSalePrice: item.unitSalePrice,
              }));

        const consolidatedLines = consolidateSaleLineInputs(rawDraftLines);

        // Mapa de precios guardados previamente en la cuenta abierta para detectar cambios de precio
        const savedPriceByProductId = new Map<string, number>();
        if (existingOpenSale?.items) {
          for (const prevItem of existingOpenSale.items) {
            savedPriceByProductId.set(prevItem.productId, prevItem.unitSalePrice);
          }
        }

        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitMap.set(u.id, u);
        }

        // 5. Revalidar productos activos, existencias reales y sincronización de precios dentro de la transacción
        const validatedProducts: {
          product: ProductRecord;
          quantity: number;
          unitSalePrice: number;
          lineSubtotal: number;
          unitName: string;
          unitSymbol: string;
        }[] = [];

        for (const line of consolidatedLines) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            line.productId
          );
          if (!product) {
            throw new EntityNotFoundError('warehouse_products', line.productId);
          }

          if (product.status !== ProductStatus.ACTIVE) {
            throw new ValidationError(
              `No es posible despachar porque el producto "${product.name}" se encuentra inactivo. Retíralo de la cuenta antes de despachar.`
            );
          }

          if (!existingOpenSale) {
            if (product.currentStock <= 0) {
              throw new ValidationError(
                `No es posible despachar porque el producto "${product.name}" se encuentra agotado en almacén (existencia disponible: 0).`
              );
            }

            const resultingStock =
              Math.round((product.currentStock - line.quantity) * 100) / 100;
            if (line.quantity > product.currentStock || resultingStock < 0) {
              throw new ValidationError(
                `Existencias insuficientes para "${product.name}": disponible ${product.currentStock}, solicitado ${line.quantity}. Ajusta la cantidad antes de despachar.`
              );
            }
          }

          const previousSavedPrice = savedPriceByProductId.get(product.id);
          if (
            existingOpenSale &&
            input.requirePriceSyncConfirmation &&
            !input.confirmCatalogPriceUpdates &&
            previousSavedPrice !== undefined &&
            Math.abs(previousSavedPrice - product.currentSalePrice) > 0.001
          ) {
            throw new ValidationError(
              `El precio de venta de "${product.name}" cambió en el catálogo ($${previousSavedPrice.toFixed(2)} -> $${product.currentSalePrice.toFixed(2)}). Revisa y confirma el precio actualizado antes de despachar.`
            );
          }

          const unit = unitMap.get(product.measurementUnitId);
          // Al confirmar el despacho se aplica y congela el precio vigente del catálogo
          const unitSalePrice = product.currentSalePrice;
          const lineSubtotal =
            Math.round(line.quantity * unitSalePrice * 100) / 100;

          validatedProducts.push({
            product,
            quantity: line.quantity,
            unitSalePrice,
            lineSubtotal,
            unitName: unit?.name ?? 'Unidad',
            unitSymbol: unit?.name ?? 'u.',
          });
        }

        // 6. Determinar identidad y folio del registro de despacho
        let saleId: string;
        let folio: string;
        let consecutiveNumber: number | null;
        let accountName: string | null;
        let originType: 'OPEN_ACCOUNT' | 'DIRECT_DISPATCH';
        let openedAt: string;
        let openedByUserId: string;
        let openedByUserLabel: string;
        let createdWorkdayId: string;
        let createdAt: string;

        if (existingOpenSale) {
          saleId = existingOpenSale.id;
          folio = existingOpenSale.folio;
          consecutiveNumber = existingOpenSale.consecutiveNumber ?? null;
          const resolvedName =
            input.accountName !== undefined
              ? input.accountName.trim()
              : (
                  existingOpenSale.accountName ??
                  existingOpenSale.customerOrTableLabel ??
                  ''
                ).trim();
          if (!resolvedName) {
            throw new ValidationError(
              'El nombre de la cuenta abierta no puede quedar vacío.'
            );
          }
          accountName = resolvedName;
          originType = 'OPEN_ACCOUNT';
          openedAt = existingOpenSale.openedAt;
          openedByUserId = existingOpenSale.openedByUserId ?? actor.role;
          openedByUserLabel = existingOpenSale.openedByUserLabel ?? actor.label;
          createdWorkdayId =
            existingOpenSale.createdWorkdayId ??
            existingOpenSale.workdayId ??
            dispatchWorkday.id;
          createdAt = existingOpenSale.createdAt;
        } else {
          saleId = generateEntityId();
          const directCounter = await tx.get<DirectDispatchCounterMetadata>(
            StoreName.SYSTEM_METADATA,
            'direct_dispatch_sequence_counter'
          );
          const nextSequence = (directCounter?.lastSequence ?? 0) + 1;
          await tx.upsert<DirectDispatchCounterMetadata>(
            StoreName.SYSTEM_METADATA,
            {
              id: 'direct_dispatch_sequence_counter',
              lastSequence: nextSequence,
              updatedAt: timestamp,
            }
          );
          folio = formatDirectDispatchFolio(nextSequence);
          consecutiveNumber = null;
          accountName = null;
          originType = 'DIRECT_DISPATCH';
          openedAt = timestamp;
          openedByUserId = actor.role;
          openedByUserLabel = actor.label;
          createdWorkdayId = dispatchWorkday.id;
          createdAt = timestamp;
        }

        const displayReference = accountName
          ? `${folio} — ${accountName}`
          : `${folio} (Despacho directo)`;

        // 7. Descontar existencias, atribuir costos FIFO y generar movimientos de salida en Kardex atómicamente
        let allCostLayers = await tx.getAll<ProductCostLayer>(StoreName.WAREHOUSE_COST_LAYERS);
        const finalLineItems: SaleLineItemRecord[] = [];
        const createdMovements: InventoryMovementRecord[] = [];
        const updatedProducts: ProductRecord[] = [];
        const movementIds: string[] = [];
        const modifiedCostLayersMap = new Map<string, ProductCostLayer>();
        let totalAmount = 0;
        let totalCostAmount = 0;

        for (const item of validatedProducts) {
          if (!existingOpenSale) {
            const previousStock = item.product.currentStock;
            const resultingStock =
              Math.round((previousStock - item.quantity) * 100) / 100;

            const updatedProduct: ProductRecord = {
              ...item.product,
              currentStock: resultingStock,
              updatedAt: timestamp,
            };
            await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProduct);
            updatedProducts.push(updatedProduct);

            const movementId = generateEntityId();
            movementIds.push(movementId);

            const movement: InventoryMovementRecord = {
              id: movementId,
              productId: item.product.id,
              movementType: InventoryMovementType.SALE,
              quantity: item.quantity,
              previousStock,
              resultingStock,
              timestamp,
              responsibleUserId: actor.label,
              originOperationId: saleId,
              reason: `Despacho de mercancía · ${displayReference}`,
              workdayId: dispatchWorkday.id,
            };
            await tx.insert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);
            createdMovements.push(movement);
          } else {
            // En cuentas abiertas, las existencias físicas ya fueron descontadas de almacén al agregar productos a la mesa.
            // Conservamos los IDs de movimientos generados previamente en la apertura/modificación.
            if (existingOpenSale.inventoryMovementIds) {
              for (const mId of existingOpenSale.inventoryMovementIds) {
                if (!movementIds.includes(mId)) {
                  movementIds.push(mId);
                }
              }
            }
          }

          // Asignar costos FIFO sobre las capas de costo disponibles (atribuido a la jornada en que se liquida/despacha)
          const fifoResult = allocateCostLayersFIFO(item.product.id, item.quantity, allCostLayers);
          allCostLayers = fifoResult.updatedLayers as ProductCostLayer[];

          // Identificar explícitamente cuáles capas sufrieron modificaciones
          for (const attr of fifoResult.costAttribution) {
            if (attr.layerId !== 'fallback-legacy-layer' && attr.quantity > 0) {
              const updatedLayer = allCostLayers.find((l) => l.id === attr.layerId);
              if (updatedLayer) {
                modifiedCostLayersMap.set(updatedLayer.id, updatedLayer);
              }
            }
          }

          const lineCostAmount = Math.round(fifoResult.totalCostAmount * 100) / 100;
          totalCostAmount = Math.round((totalCostAmount + lineCostAmount) * 100) / 100;

          finalLineItems.push({
            productId: item.product.id,
            productCode:
              item.product.sku ??
              `PRD-${item.product.id.slice(0, 8).toUpperCase()}`,
            sku: item.product.sku ?? null,
            productName: item.product.name,
            measurementUnitId: item.product.measurementUnitId,
            unitName: item.unitName,
            unitSymbol: item.unitSymbol,
            quantity: item.quantity,
            unitSalePrice: item.unitSalePrice,
            lineSubtotal: item.lineSubtotal,
            costAttribution: fifoResult.costAttribution,
            totalCostAmount: lineCostAmount,
          } as any);

          totalAmount = Math.round((totalAmount + item.lineSubtotal) * 100) / 100;
        }

        // Persistir únicamente las capas que sufrieron consumo o modificación
        for (const layer of modifiedCostLayersMap.values()) {
          await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, layer);
        }

        const isFromPriorWorkday = Boolean(
          existingOpenSale &&
          existingOpenSale.createdWorkdayId &&
          existingOpenSale.createdWorkdayId !== dispatchWorkday.id
        );
        const priorWorkday = isFromPriorWorkday
          ? allWorkdays.find((w) => w.id === existingOpenSale?.createdWorkdayId)
          : null;

        // Validar desglose de forma de pago (Transferencia vs. Efectivo)
        const rawTransfer = input.transferAmount;
        let transferAmount = 0;
        if (rawTransfer !== undefined && rawTransfer !== null) {
          if (typeof rawTransfer !== 'number' || !Number.isFinite(rawTransfer) || rawTransfer < 0) {
            throw new ValidationError(
              'El monto de pago por transferencia debe ser un valor numérico mayor o igual a cero.'
            );
          }
          if (rawTransfer > totalAmount) {
            throw new ValidationError(
              `El monto por transferencia ($${rawTransfer.toFixed(2)}) no puede ser mayor al importe total a despachar ($${totalAmount.toFixed(2)}).`
            );
          }
          transferAmount = Math.round(rawTransfer * 100) / 100;
        }
        const cashAmount = Math.round((totalAmount - transferAmount) * 100) / 100;

        // 8. Guardar o actualizar el registro de venta como DISPATCHED con precios e importes congelados
        // Nota: workdayId apunta a la jornada en que se despachó para integrarse con el expediente y cortes parciales
        // de la jornada de despacho, mientras createdWorkdayId conserva la jornada de apertura original.
        const dispatchedSale: SaleRecord = {
          id: saleId,
          folio,
          consecutiveNumber,
          accountName,
          customerOrTableLabel: accountName ?? 'Despacho directo',
          originType,
          status: SaleStatus.DISPATCHED,
          items: finalLineItems,
          totalAmount,
          totalCostAmount,
          transferAmount,
          cashAmount,
          openedAt,
          openedByUserId,
          openedByUserLabel,
          createdWorkdayId,
          workdayId: dispatchWorkday.id,
          dispatchedWorkdayId: dispatchWorkday.id,
          dispatchedAt: timestamp,
          dispatchedByUserId: actor.role,
          dispatchedByUserLabel: actor.label,
          closedAt: timestamp,
          cancelledAt: null,
          cancelledByUserId: null,
          cancelledByUserLabel: null,
          cancellationReason: null,
          hasStockMovement: true,
          inventoryMovementIds: movementIds,
          operationId,
          isPriorWorkdayAccount: isFromPriorWorkday,
          priorWorkdayCode: priorWorkday?.code ?? null,
          createdAt,
          updatedAt: timestamp,
        };

        await tx.upsert(StoreName.SALES_RECORDS, dispatchedSale);

        // 9. Registrar evento en el historial de auditoría
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.SALES,
          action: existingOpenSale
            ? 'DISPATCH_OPEN_SALE_ACCOUNT'
            : 'DISPATCH_DIRECT_SALE',
          entityType: 'Sale',
          entityId: dispatchedSale.id,
          actorRole: actor.role,
          description: `Despacho confirmado de ${displayReference} en Jornada ${dispatchWorkday.code} (${finalLineItems.length} partida(s), importe total $${totalAmount.toFixed(2)}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return {
          sale: dispatchedSale,
          movements: createdMovements,
          updatedProducts,
        };
      }
    );
  }
}
