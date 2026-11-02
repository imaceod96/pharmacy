import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  PendingOpenAccountsError,
  SaleRecord,
  SaleStatus,
  toPendingOpenAccountSummary,
} from '../../sales/domain/entities/SaleRecord';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import {
  computeCommercialActivitySummaryFromSales,
  computeNextPartialCutIntervalStart,
  computePartialCutSummaryMetrics,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutProductItem,
  PartialCutSelectionSource,
  PartialCutStatus,
  PartialInventoryCutRecord,
  reconstructTheoreticalStockAtTimestamp,
  validateNoOverlappingPartialCuts,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { ProductRecord, ProductStatus } from '../domain/entities/ProductRecord';
import {
  isOperativeWorkday,
  WORKDAY_STATUS_LABELS,
  WorkdayRecord,
  WorkdayStatus,
} from '../domain/entities/WorkdayRecord';
import { CommercialActivityQueryPort } from '../domain/ports/CommercialActivityQueryPort';

export const PARTIAL_CUT_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE =
  'No puedes iniciar un corte parcial porque existen cuentas abiertas. Debes despachar o resolver todas las cuentas pendientes antes de continuar';

export interface CreatePartialCutInput {
  readonly workdayId?: string;
  readonly customIntervalStartAt?: string;
  readonly referenceEndAt?: string;
  readonly notes?: string;
  /**
   * Propiedad rechazada por regla de dominio: el Administrador no puede seleccionar,
   * añadir ni eliminar manualmente productos para un corte parcial.
   */
  readonly manualProductIds?: never;
  readonly productIds?: never;
}

export class CreatePartialCutUseCase {
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
    input: CreatePartialCutInput = {}
  ): Promise<PartialInventoryCutRecord> {
    // 1. Autorización estricta: exclusivo de Administrador
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'crear corte parcial de inventario'
    );

    // 2. Prohibición estricta de selección manual de productos
    const rawInput = input as Record<string, unknown>;
    if (
      rawInput.manualProductIds !== undefined ||
      rawInput.productIds !== undefined
    ) {
      throw new ValidationError(
        'No se permite añadir ni eliminar manualmente productos en un corte parcial. El sistema selecciona automáticamente los productos con actividad comercial real en el intervalo.'
      );
    }

    // 3. Obtener la jornada activa, verificar cuentas abiertas y calcular intervalos
    const preCheck = await this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.SALES_RECORDS,
      ],
      'readonly',
      async (tx) => {
        let workday: WorkdayRecord | undefined;
        if (input.workdayId) {
          workday = await tx.get<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS, input.workdayId);
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
          workday = allWorkdays.find((w) => isOperativeWorkday(w.status));
        }

        if (!workday) {
          throw new ValidationError(
            'No existe una jornada abierta. Solo es posible iniciar un corte parcial dentro de una jornada activa en estado Abierta.'
          );
        }

        if (workday.status !== WorkdayStatus.OPEN) {
          throw new ValidationError(
            `La jornada ${workday.code} se encuentra en estado "${WORKDAY_STATUS_LABELS[workday.status]}". No se admiten nuevos cortes parciales fuera del estado Abierta.`
          );
        }

        // En la nueva regla de negocio, los cortes parciales son permitidos aunque existan cuentas abiertas.
        // Las existencias de las cuentas abiertas ya fueron descontadas físicamente de almacén.

        const existingCuts = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_workday_id',
          workday.id
        );

        const hasApprovedCuts = existingCuts.some(
          (c) => c.status === PartialCutStatus.APPROVED
        );

        const computedStartAt = computeNextPartialCutIntervalStart(
          workday.openedAt,
          existingCuts
        );
        const intervalStartAt = input.customIntervalStartAt ?? computedStartAt;

        let intervalEndAt = input.referenceEndAt ?? nowISO();
        if (!input.referenceEndAt && intervalEndAt <= intervalStartAt) {
          const baseMs = new Date(intervalStartAt).getTime();
          intervalEndAt = new Date(baseMs + 1).toISOString();
        }

        validateNoOverlappingPartialCuts(
          workday.openedAt,
          intervalStartAt,
          intervalEndAt,
          existingCuts
        );

        return {
          workday,
          existingCuts,
          hasApprovedCuts,
          intervalStartAt,
          intervalEndAt,
        };
      }
    );

    // 4. Consultar automáticamente actividad comercial real confirmada en el intervalo
    const commercialActivity = await this.commercialActivityPort.queryAffectedProductsInInterval({
      workdayId: preCheck.workday.id,
      intervalStartAt: preCheck.intervalStartAt,
      intervalEndAt: preCheck.intervalEndAt,
      isInitialWorkdayInterval:
        !preCheck.hasApprovedCuts &&
        preCheck.intervalStartAt === preCheck.workday.openedAt,
    });

    // 5. Ejecutar transacción de creación del borrador con revalidación transaccional de cuentas abiertas
    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_CATEGORIES,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        const workday = await tx.get<WorkdayRecord>(
          StoreName.WAREHOUSE_WORKDAYS,
          preCheck.workday.id
        );
        if (!workday || workday.status !== WorkdayStatus.OPEN) {
          throw new ValidationError(
            'El estado de la jornada cambió durante la operación. La jornada debe permanecer Abierta.'
          );
        }

        // Revalidar dentro de la transacción de escritura que no existan cuentas abiertas (OPEN)
        const openSales = await tx.getAllByIndex<SaleRecord>(
          StoreName.SALES_RECORDS,
          'by_status',
          SaleStatus.OPEN
        );
        if (openSales.length > 0) {
          const sortedOpen = openSales.slice().sort((a, b) => {
            const numA = a.consecutiveNumber ?? Number.MAX_SAFE_INTEGER;
            const numB = b.consecutiveNumber ?? Number.MAX_SAFE_INTEGER;
            if (numA !== numB) return numA - numB;
            return a.openedAt.localeCompare(b.openedAt);
          });
          throw new PendingOpenAccountsError(
            PARTIAL_CUT_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE,
            sortedOpen.map(toPendingOpenAccountSummary)
          );
        }

        const existingCuts = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_workday_id',
          workday.id
        );

        validateNoOverlappingPartialCuts(
          workday.openedAt,
          preCheck.intervalStartAt,
          preCheck.intervalEndAt,
          existingCuts
        );

        const allProducts = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const productById = new Map<string, ProductRecord>();
        for (const p of allProducts) {
          productById.set(p.id, p);
        }

        const allCategories = await tx.getAll<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES);
        const categoryById = new Map<string, string>();
        for (const c of allCategories) {
          categoryById.set(c.id, c.name);
        }

        const allUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitById = new Map<string, MeasurementUnitRecord>();
        for (const u of allUnits) {
          unitById.set(u.id, u);
        }

        const allMovements = await tx.getAll<InventoryMovementRecord>(
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS
        );

        const deduplicatedCommercialProducts = new Map<string, Set<string>>();

        for (const affected of commercialActivity.affectedProducts) {
          if (!productById.has(affected.productId)) {
            continue;
          }
          let refs = deduplicatedCommercialProducts.get(affected.productId);
          if (!refs) {
            refs = new Set<string>();
            deduplicatedCommercialProducts.set(affected.productId, refs);
          }
          for (const opId of affected.operationIds) {
            refs.add(opId);
          }
        }

        const items: PartialCutProductItem[] = [];
        for (const [productId, refSet] of deduplicatedCommercialProducts.entries()) {
          const prod = productById.get(productId)!;
          const unit = unitById.get(prod.measurementUnitId);
          const prodMovements = allMovements
            .filter((m) => m.productId === prod.id)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

          const stockAtCutReference = reconstructTheoreticalStockAtTimestamp(
            prod.currentStock,
            preCheck.intervalEndAt,
            prodMovements
          );

          items.push({
            productId: prod.id,
            productName: prod.name,
            productCode: prod.sku ?? prod.id.slice(0, 8).toUpperCase(),
            sku: prod.sku ?? null,
            categoryId: prod.categoryId,
            categoryName: categoryById.get(prod.categoryId) ?? 'Sin categoría',
            measurementUnitId: prod.measurementUnitId,
            unitName: unit?.name ?? 'Unidad',
            unitSymbol: unit?.name ?? 'u.',
            measurementUnitName: unit?.name ?? 'Unidad',
            unitOfMeasureLabel: unit?.name ?? 'Unidad',
            productStatusAtCutCreation: prod.status,
            productStatusAtCutReference: prod.status,
            isCurrentlyActive: prod.status === ProductStatus.ACTIVE,
            currentAvailability:
              prod.status === ProductStatus.INACTIVE
                ? 'INACTIVE'
                : prod.currentStock <= 0
                  ? 'OUT_OF_STOCK'
                  : 'AVAILABLE',
            lastPurchasePriceSnapshot: prod.lastPurchasePrice,
            salePriceSnapshot: prod.currentSalePrice,
            theoreticalStockAtCutCreation: stockAtCutReference,
            theoreticalStockAtCutReference: stockAtCutReference,
            theoreticalStockAtCutEnd: stockAtCutReference,
            reconciledTheoreticalStock: null,
            lastMovementIdAtCreation: prodMovements[0]?.id ?? null,
            captureStatus: 'PENDING',
            countedPhysicalQuantity: null,
            physicalCountQuantity: null,
            countedAt: null,
            countedByUserId: null,
            theoreticalStockAtCountTime: null,
            differenceQuantity: null,
            differenceType: null,
            differenceReason: null,
            differencePurchaseValuation: 0,
            differenceSaleValuation: 0,
            shortagePurchaseValue: 0,
            shortageSaleValue: 0,
            surplusPurchaseValue: 0,
            surplusSaleValue: 0,
            netPurchaseImpact: 0,
            netSaleImpact: 0,
            stockBeforeApproval: null,
            stockAfterApproval: null,
            appliedAdjustmentMovementId: null,
            countHistory: [],
            commercialActivityRefIds: Array.from(refSet),
            salesCountInInterval: refSet.size,
            inclusionOrigin: 'COMMERCIAL_OPERATION',
          });
        }

        items.sort((a, b) => a.productName.localeCompare(b.productName));

        const consecutiveNumber = existingCuts.length + 1;
        const reference = `${workday.code}-CP${String(consecutiveNumber).padStart(2, '0')}`;
        const createdAt = nowISO();
        const cutId = generateEntityId();
        const auditId = generateEntityId();

        const selectionSource: PartialCutSelectionSource =
          items.length > 0
            ? 'CONFIRMED_COMMERCIAL_OPERATIONS'
            : 'AUTOMATIC_WITHOUT_COMMERCIAL_ACTIVITY';

        const hasGuaranteedSalesCoverage =
          commercialActivity.isSalesConfirmationModuleOperational && items.length > 0;

        const summary = computePartialCutSummaryMetrics(items);
        const allSalesInStore = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);
        const priorApprovedEndTimestamps = existingCuts
          .filter((c) => c.status === PartialCutStatus.APPROVED)
          .map((c) => c.intervalEndAt);

        const commercialActivitySummary =
          commercialActivity.commercialActivity ??
          computeCommercialActivitySummaryFromSales({
            workdayId: workday.id,
            intervalStartAt: preCheck.intervalStartAt,
            intervalEndAt: preCheck.intervalEndAt,
            sales: allSalesInStore,
            isInitialWorkdayInterval:
              !preCheck.hasApprovedCuts &&
              preCheck.intervalStartAt === workday.openedAt,
            priorApprovedCutEndTimestamps: priorApprovedEndTimestamps,
            fallbackCutItems: items,
            productsById: productById,
            unitsById: unitById,
          });

        const auditEntry: OperationLogEntry = {
          id: auditId,
          module: OperationModule.WAREHOUSE,
          action: 'CREATE_PARTIAL_CUT',
          entityType: 'PartialInventoryCut',
          entityId: cutId,
          actorRole: actor.role,
          description: `Creación de borrador de corte parcial ${reference} con selección automática (Jornada ${workday.code}, intervalo ${preCheck.intervalStartAt} a ${preCheck.intervalEndAt}, ${items.length} productos con actividad comercial incluidos).`,
          createdAt,
        };

        const cutRecord: PartialInventoryCutRecord = {
          id: cutId,
          reference,
          folio: reference,
          workdayId: workday.id,
          workdayCode: workday.code,
          workdayFolio: workday.code,
          consecutiveNumber,
          createdAt,
          openedAt: createdAt,
          closedAt: null,
          updatedAt: createdAt,
          intervalStartAt: preCheck.intervalStartAt,
          intervalEndAt: preCheck.intervalEndAt,
          intervalStartTimestamp: preCheck.intervalStartAt,
          intervalEndTimestamp: preCheck.intervalEndAt,
          cutReferenceTimestamp: preCheck.intervalEndAt,
          responsibleUserId: actor.role,
          responsibleUserLabel: actor.label,
          createdByUserId: actor.role,
          createdByUserRole: actor.role,
          status: PartialCutStatus.DRAFT,
          statusLabel: PARTIAL_CUT_STATUS_LABELS[PartialCutStatus.DRAFT],
          selectionSource,
          hasGuaranteedSalesCoverage,
          salesModuleDependencyNotice: commercialActivity.dependencyNotice,
          items,
          summary,
          commercialActivity: commercialActivitySummary,
          generatedMovementIds: [],
          readyForReviewAt: null,
          cancelledAt: null,
          cancelledByUserId: null,
          cancelledByUserRole: null,
          cancelledByUserLabel: null,
          cancellationReason: null,
          approvedAt: null,
          approvedByUserId: null,
          approvedByUserRole: null,
          approvedByUserLabel: null,
          notes: input.notes?.trim() || null,
          auditLogIds: [auditId],
        };

        await tx.insert(StoreName.WAREHOUSE_INVENTORY_CUTS, cutRecord);
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return cutRecord;
      }
    );
  }
}
