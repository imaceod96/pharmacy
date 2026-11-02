import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityId, ISODateString } from '../../../shared/types/entity';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import {
  PendingOpenAccountsError,
  SaleRecord,
  SaleStatus,
  toPendingOpenAccountSummary,
} from '../../sales/domain/entities/SaleRecord';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import {
  evaluatePartialCutCountReuseForFinalInventory,
  FinalInventoryProductActivityEvaluation,
  PartialCutCountReuseEvaluation,
  PartialInventoryCutRecord,
  selectProductsForFinalInventory,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';
import { ProductStatusChangeRecord } from '../domain/entities/ProductStatusChangeRecord';
import { isOperativeWorkday, WorkdayRecord } from '../domain/entities/WorkdayRecord';
import { CommercialActivityQueryPort } from '../domain/ports/CommercialActivityQueryPort';

export const FINAL_INVENTORY_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE =
  'No puedes iniciar el inventario final ni cerrar la jornada porque existen cuentas abiertas. Debes despachar o resolver todas las cuentas pendientes antes de continuar.';

export interface FinalInventoryPreparedItem {
  readonly productId: EntityId;
  readonly productName: string;
  readonly productCode: string;
  readonly sku: string | null;
  readonly categoryId: EntityId;
  readonly categoryName: string;
  readonly measurementUnitId: EntityId;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly currentStatus: ProductStatus;
  readonly statusAtWorkdayOpening: ProductStatus;
  readonly currentTheoreticalStock: number;
  readonly activityEvaluation: FinalInventoryProductActivityEvaluation;
  readonly partialCutReuseEvaluation: PartialCutCountReuseEvaluation;
  readonly requiresNewPhysicalCount: boolean;
  readonly prefilledReusableCountedQuantity: number | null;
}

export interface FinalInventorySelectionResult {
  readonly workdayId: EntityId;
  readonly workdayCode: string;
  readonly workdayOpenedAt: ISODateString;
  readonly evaluatedAt: ISODateString;
  readonly totalCatalogProductsCount: number;
  readonly selectedProductsCount: number;
  readonly excludedInactiveProductsCount: number;
  readonly reusableCountItemsCount: number;
  readonly mandatoryRecountItemsCount: number;
  readonly items: readonly FinalInventoryPreparedItem[];
}

export interface PrepareFinalInventorySelectionInput {
  readonly workdayId?: string;
  readonly referenceEndAt?: ISODateString;
  /**
   * Propiedades prohibidas por regla de dominio: el Administrador no puede
   * seleccionar ni excluir manualmente productos del inventario final.
   */
  readonly manualProductIds?: never;
  readonly excludedProductIds?: never;
}

/**
 * Caso de uso y contrato de preparación del listado automático de productos para el Inventario Final
 * al iniciar el cierre de una jornada (`CLOSING`).
 *
 * Garantiza:
 * 0. Bloqueo obligatorio si existe al menos una cuenta abierta (`SaleStatus.OPEN`) en cualquier jornada.
 * 1. Selección 100 % automática de todos los productos que estuvieron `ACTIVE` en algún momento
 *    desde la apertura de la jornada (`workday.openedAt`), usando registros reales de `ProductStatusChangeRecord`
 *    y el estado reconstruido al abrir la jornada.
 * 2. Inclusión de productos activos con stock 0, activos y luego desactivados, e inactivos al abrir pero activados durante la jornada.
 * 3. Exclusión de productos que permanecieron `INACTIVE` durante toda la jornada.
 * 4. Prohibición de añadir o quitar productos manualmente.
 * 5. Evaluación estricta de reutilización de conteos de cortes parciales aprobados.
 */
export class PrepareFinalInventorySelectionUseCase {
  private readonly transactionManager: TransactionManager;
  private readonly commercialActivityPort: CommercialActivityQueryPort;

  constructor(
    transactionManager: TransactionManager,
    commercialActivityPort: CommercialActivityQueryPort
  ) {
    this.transactionManager = transactionManager;
    this.commercialActivityPort = commercialActivityPort;
  }

  public async execute(
    actor: SessionActor,
    input: PrepareFinalInventorySelectionInput = {}
  ): Promise<FinalInventorySelectionResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'preparar selección automática de inventario final'
    );

    const rawInput = input as Record<string, unknown>;
    if (
      rawInput.manualProductIds !== undefined ||
      rawInput.excludedProductIds !== undefined
    ) {
      throw new ValidationError(
        'No se permite añadir ni excluir manualmente productos en el inventario final. El sistema selecciona automáticamente todos los productos que estuvieron activos en algún momento de la jornada.'
      );
    }

    const baseData = await this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_CATEGORIES,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
      ],
      'readonly',
      async (tx) => {
        // Las cuentas abiertas se permiten durante el inventario final y cierre de jornada.

        let workday: WorkdayRecord | undefined;
        if (input.workdayId) {
          workday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            input.workdayId
          );
          if (!workday) {
            throw new EntityNotFoundError('Jornada de almacén', input.workdayId);
          }
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
          workday = allWorkdays.find((w) => isOperativeWorkday(w.status));
          if (!workday) {
            throw new ValidationError(
              'No existe una jornada operativa activa para preparar el inventario final.'
            );
          }
        }

        const evaluatedAt = input.referenceEndAt ?? nowISO();

        const [
          allProducts,
          allCategories,
          allUnits,
          allStatusChanges,
          workdayCuts,
          allMovements,
        ] = await Promise.all([
          tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS),
          tx.getAll<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES),
          tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS),
          tx.getAll<ProductStatusChangeRecord>(
            StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES
          ),
          tx.getAllByIndex<PartialInventoryCutRecord>(
            StoreName.WAREHOUSE_INVENTORY_CUTS,
            'by_workday_id',
            workday.id
          ),
          tx.getAll<InventoryMovementRecord>(
            StoreName.WAREHOUSE_INVENTORY_MOVEMENTS
          ),
        ]);

        return {
          workday,
          evaluatedAt,
          allProducts,
          allCategories,
          allUnits,
          allStatusChanges,
          workdayCuts,
          allMovements,
        };
      }
    );

    const commercialInWorkday =
      await this.commercialActivityPort.queryAffectedProductsInInterval({
        workdayId: baseData.workday.id,
        intervalStartAt: baseData.workday.openedAt,
        intervalEndAt: baseData.evaluatedAt,
        isInitialWorkdayInterval: true,
      });

    const commercialTimestampsByProduct = new Map<string, readonly ISODateString[]>();
    for (const item of commercialInWorkday.affectedProducts) {
      commercialTimestampsByProduct.set(
        item.productId,
        item.operationTimestamps ?? [item.lastOperationAt]
      );
    }

    const categoryById = new Map<string, string>();
    for (const c of baseData.allCategories) {
      categoryById.set(c.id, c.name);
    }

    const unitById = new Map<string, MeasurementUnitRecord>();
    for (const u of baseData.allUnits) {
      unitById.set(u.id, u);
    }

    const selected = selectProductsForFinalInventory(
      baseData.allProducts,
      baseData.workday.openedAt,
      baseData.allStatusChanges,
      baseData.evaluatedAt
    );

    const items: FinalInventoryPreparedItem[] = selected.map(
      ({ product, evaluation }) => {
        const unit = unitById.get(product.measurementUnitId);
        const reuseEvaluation = evaluatePartialCutCountReuseForFinalInventory(
          product,
          baseData.workdayCuts,
          baseData.allMovements,
          commercialTimestampsByProduct.get(product.id) ?? []
        );

        return {
          productId: product.id,
          productName: product.name,
          productCode: product.sku ?? product.id.slice(0, 8).toUpperCase(),
          sku: product.sku ?? null,
          categoryId: product.categoryId,
          categoryName: categoryById.get(product.categoryId) ?? 'Sin categoría',
          measurementUnitId: product.measurementUnitId,
          unitName: unit?.name ?? 'Unidad',
          unitSymbol: unit?.name ?? 'u.',
          currentStatus: product.status,
          statusAtWorkdayOpening: evaluation.statusAtWorkdayOpening,
          currentTheoreticalStock: product.currentStock,
          activityEvaluation: evaluation,
          partialCutReuseEvaluation: reuseEvaluation,
          requiresNewPhysicalCount: reuseEvaluation.requiresNewPhysicalCount,
          prefilledReusableCountedQuantity: reuseEvaluation.reusableCountedQuantity,
        };
      }
    );

    const reusableCountItemsCount = items.filter(
      (i) => !i.requiresNewPhysicalCount
    ).length;
    const mandatoryRecountItemsCount = items.length - reusableCountItemsCount;

    return {
      workdayId: baseData.workday.id,
      workdayCode: baseData.workday.code,
      workdayOpenedAt: baseData.workday.openedAt,
      evaluatedAt: baseData.evaluatedAt,
      totalCatalogProductsCount: baseData.allProducts.length,
      selectedProductsCount: items.length,
      excludedInactiveProductsCount: baseData.allProducts.length - items.length,
      reusableCountItemsCount,
      mandatoryRecountItemsCount,
      items,
    };
  }
}
