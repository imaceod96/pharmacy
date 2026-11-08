import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission, hasPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { OperationLogEntry } from '../../core/domain/entities/OperationLog';
import {
  formatSaleDisplayLabel,
  SaleLineItemRecord,
  SaleOriginType,
  SaleRecord,
  SaleStatus,
} from '../../sales/domain/entities/SaleRecord';
import {
  PartialInventoryCutRecord,
  resolveCutCommercialActivityProjection,
  sanitizePartialCutForActor,
} from '../domain/entities/InventoryCutRecord';
import { InventoryMovementRecord } from '../domain/entities/InventoryMovementRecord';
import { ProductRecord } from '../domain/entities/ProductRecord';
import { WorkdayRecord } from '../domain/entities/WorkdayRecord';
import {
  calculateWorkdayCommercialPerformance,
  WorkdayCommercialPerformanceResult,
} from '../domain/entities/WorkdayCommercialPerformance';
import { WarehouseClosingRectification } from '../domain/entities/WarehouseClosingRectification';

import { ExpenseDailySummary, ExpenseRecord, ExpenseType } from '../../expenses/domain/entities/ExpenseRecord';

export interface WorkdayMovementItem {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly movementType: string;
  readonly quantity: number;
  readonly signedQuantity?: number;
  readonly previousStock: number;
  readonly resultingStock: number;
  readonly timestamp: string;
  readonly responsibleUserId: string;
  readonly reason?: string | null;
  readonly workdayId?: string | null;
  readonly workdayFolio?: string | null;
  readonly partialCutId?: string | null;
  readonly partialCutFolio?: string | null;
}

export interface WorkdayDispatchedSaleItem {
  readonly id: string;
  readonly folio: string;
  readonly consecutiveNumber: number | null;
  readonly accountName: string | null;
  readonly displayLabel: string;
  readonly originType: SaleOriginType;
  readonly openedAt: string;
  readonly dispatchedAt: string;
  readonly dispatchedByUserLabel: string;
  readonly createdWorkdayId: string;
  readonly dispatchedWorkdayId: string;
  readonly items: readonly SaleLineItemRecord[];
  readonly totalAmount: number;
  readonly transferAmount?: number;
  readonly cashAmount?: number;
  readonly inventoryMovementIds: readonly string[];
  readonly isPriorWorkdayAccount?: boolean;
  readonly priorWorkdayCode?: string | null;
}

export interface OpenAccountProductSummaryItem {
  readonly productId: string;
  readonly productName: string;
  readonly unitName: string;
  readonly quantity: number;
  readonly totalValue: number;
  readonly accountCount: number;
}

export interface WorkdayDossierDetailView {
  readonly workday: WorkdayRecord;
  readonly movements: readonly WorkdayMovementItem[];
  readonly auditEntries: readonly OperationLogEntry[];
  readonly sales: readonly WorkdayDispatchedSaleItem[];
  readonly partialCuts: readonly PartialInventoryCutRecord[];
  readonly physicalCounts: readonly never[];
  readonly closureVersions: readonly never[];
  readonly commercialPerformance?: WorkdayCommercialPerformanceResult;
  readonly rectifications: readonly WarehouseClosingRectification[];
  readonly openAccountsStockBreakdown?: readonly OpenAccountProductSummaryItem[];
  readonly openAccountsTotalValue?: number;
  readonly openAccountsTotalUnits?: number;
  readonly openAccountsCount?: number;
  readonly expenses?: readonly ExpenseRecord[];
  readonly expensesSummary?: ExpenseDailySummary;
  readonly adjustedNetProfit?: number;
  readonly totalTransferSalesAmount?: number;
  readonly totalCashSalesAmount?: number;
  readonly expectedCashInDrawer?: number;
}

export class GetWorkdayDetailUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    workdayId: string
  ): Promise<WorkdayDossierDetailView> {
    assertPermission(actor, Permission.VIEW_INVENTORY_CUTS, 'consultar expediente de jornada');

    const canViewCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);
    const canManageCuts = hasPermission(actor.role, Permission.MANAGE_INVENTORY_CUTS);

    return this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.SALES_RECORDS,
        StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS,
        StoreName.OPERATION_HISTORY,
        StoreName.EXPENSES,
      ],
      'readonly',
      async (tx) => {
        const workday = await tx.get<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS, workdayId);
        if (!workday) {
          throw new EntityNotFoundError('Jornada de inventario', workdayId);
        }

        // Obtener productos para resolución de nombres y metadatos
        const allProducts = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const productMap = new Map<string, string>();
        const productById = new Map<string, ProductRecord>();
        for (const p of allProducts) {
          productMap.set(p.id, p.name);
          productById.set(p.id, p);
        }

        // Obtener cortes parciales vinculados a esta jornada
        const allCuts = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_workday_id',
          workday.id
        );

        // Obtener despachos de ventas vinculados a esta jornada
        const allSales = await tx.getAll<SaleRecord>(StoreName.SALES_RECORDS);

        // Obtener rectificaciones vinculadas a esta jornada
        const rectifications = await tx.getAllByIndex<WarehouseClosingRectification>(
          StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS,
          'by_workday_id',
          workday.id
        );

        const partialCuts: PartialInventoryCutRecord[] = allCuts
          .slice()
          .sort((a, b) => b.consecutiveNumber - a.consecutiveNumber)
          .map((cut) => {
            const commercialActivity = resolveCutCommercialActivityProjection({
              cut,
              allSales,
              allCutsInWorkday: allCuts,
              workdayOpenedAt: workday.openedAt,
              productsById: productById,
            });
            return sanitizePartialCutForActor(
              cut,
              commercialActivity,
              canViewCosts,
              canManageCuts
            );
          });

        const cutIds = new Set(partialCuts.map((c) => c.id));

        const workdaySales: WorkdayDispatchedSaleItem[] = allSales
          .filter(
            (s) =>
              (s.status === SaleStatus.DISPATCHED ||
                (s.status as string) === 'COMPLETED') &&
              (s.dispatchedWorkdayId === workday.id || s.workdayId === workday.id)
          )
          .sort((a, b) =>
            (b.dispatchedAt ?? b.closedAt ?? b.updatedAt).localeCompare(
              a.dispatchedAt ?? a.closedAt ?? a.updatedAt
            )
          )
          .map((s) => ({
            id: s.id,
            folio: s.folio,
            consecutiveNumber: s.consecutiveNumber ?? null,
            accountName: s.accountName ?? null,
            displayLabel: formatSaleDisplayLabel(s),
            originType: s.originType ?? 'DIRECT_DISPATCH',
            openedAt: s.openedAt,
            dispatchedAt: s.dispatchedAt ?? s.closedAt ?? s.updatedAt,
            dispatchedByUserLabel: s.dispatchedByUserLabel || s.openedByUserLabel || 'Sistema',
            createdWorkdayId: s.createdWorkdayId ?? workday.id,
            dispatchedWorkdayId: s.dispatchedWorkdayId ?? workday.id,
            items: s.items || [],
            totalAmount: s.totalAmount || 0,
            transferAmount: s.transferAmount ?? 0,
            cashAmount: s.cashAmount ?? (s.totalAmount || 0),
            inventoryMovementIds: s.inventoryMovementIds || [],
            isPriorWorkdayAccount: s.isPriorWorkdayAccount ?? Boolean(s.createdWorkdayId && s.createdWorkdayId !== workday.id),
            priorWorkdayCode: s.priorWorkdayCode ?? null,
          }));

        const saleIds = new Set(workdaySales.map((s) => s.id));

        // Calcular desglose de mercancía en cuentas abiertas (descontada de almacén pero aún no liquidada)
        const openSales = allSales.filter((s) => s.status === SaleStatus.OPEN);
        let openAccountsTotalValue = 0;
        let openAccountsTotalUnits = 0;
        const openAccountsProductsMap = new Map<string, {
          productId: string;
          productName: string;
          unitName: string;
          quantity: number;
          totalValue: number;
          accountCount: number;
        }>();

        for (const os of openSales) {
          for (const item of (os.items || [])) {
            openAccountsTotalUnits = Math.round((openAccountsTotalUnits + item.quantity) * 100) / 100;
            openAccountsTotalValue = Math.round((openAccountsTotalValue + item.lineSubtotal) * 100) / 100;
            const existing = openAccountsProductsMap.get(item.productId);
            if (existing) {
              existing.quantity = Math.round((existing.quantity + item.quantity) * 100) / 100;
              existing.totalValue = Math.round((existing.totalValue + item.lineSubtotal) * 100) / 100;
              existing.accountCount += 1;
            } else {
              openAccountsProductsMap.set(item.productId, {
                productId: item.productId,
                productName: item.productName || productMap.get(item.productId) || 'Producto',
                unitName: item.unitName || 'u.',
                quantity: item.quantity,
                totalValue: item.lineSubtotal,
                accountCount: 1,
              });
            }
          }
        }

        const openAccountsStockBreakdown: OpenAccountProductSummaryItem[] = Array.from(
          openAccountsProductsMap.values()
        ).sort((a, b) => b.totalValue - a.totalValue);

        // Obtener movimientos vinculados estrictamente a esta jornada
        const allMovements = await tx.getAll<InventoryMovementRecord>(
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS
        );
        const workdayMovements: WorkdayMovementItem[] = allMovements
          .filter(
            (m) =>
              m.workdayId === workday.id ||
              (m.partialCutId !== undefined &&
                m.partialCutId !== null &&
                cutIds.has(m.partialCutId)) ||
              cutIds.has(m.originOperationId) ||
              rectifications.some((r) => r.compensatoryMovements.includes(m.id))
          )
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .map((m) => ({
            id: m.id,
            productId: m.productId,
            productName: productMap.get(m.productId) || 'Producto no identificado',
            movementType: m.movementType,
            quantity: m.quantity,
            signedQuantity: m.signedQuantity,
            previousStock: m.previousStock,
            resultingStock: m.resultingStock,
            timestamp: m.timestamp,
            responsibleUserId: m.responsibleUserId,
            reason: m.reason,
            workdayId: m.workdayId ?? workday.id,
            workdayFolio: m.workdayFolio ?? workday.code,
            partialCutId: m.partialCutId ?? (cutIds.has(m.originOperationId) ? m.originOperationId : null),
            partialCutFolio: m.partialCutFolio ?? null,
          }));

        // Obtener auditoría vinculada a esta jornada, sus cortes parciales y sus despachos
        const allAudit = await tx.getAll<OperationLogEntry>(StoreName.OPERATION_HISTORY);
        const workdayAudit = allAudit
          .filter(
            (op) =>
              op.entityId === workday.id ||
              (op.entityId !== null && cutIds.has(op.entityId)) ||
              (op.entityId !== null && saleIds.has(op.entityId)) ||
              op.description.includes(workday.code) ||
              op.description.includes(workday.id)
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const commercialPerformance = calculateWorkdayCommercialPerformance(workday.id, allSales, allProducts);

        // Obtener gastos vinculados a esta jornada
        const allExpenses = await tx.getAll<ExpenseRecord>(StoreName.EXPENSES);
        const workdayExpenses = allExpenses
          .filter((e) => e.workdayId === workday.id)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        let totalExpenseAmount = 0;
        let totalProductExpenseAmount = 0;
        let totalManualExpenseAmount = 0;

        for (const exp of workdayExpenses) {
          totalExpenseAmount = Math.round((totalExpenseAmount + exp.amount) * 100) / 100;
          if (exp.type === ExpenseType.INVENTORY_PRODUCT) {
            totalProductExpenseAmount = Math.round((totalProductExpenseAmount + exp.amount) * 100) / 100;
          } else {
            totalManualExpenseAmount = Math.round((totalManualExpenseAmount + exp.amount) * 100) / 100;
          }
        }

        const expensesSummary: ExpenseDailySummary = {
          totalAmount: totalExpenseAmount,
          totalProductExpenseAmount,
          totalManualExpenseAmount,
          count: workdayExpenses.length,
        };

        const grossProfit = commercialPerformance?.grossProfit ?? 0;
        const adjustedNetProfit = Math.round((grossProfit - totalExpenseAmount) * 100) / 100;

        let totalTransferSalesAmount = 0;
        let totalCashSalesAmount = 0;
        for (const s of workdaySales) {
          totalTransferSalesAmount = Math.round((totalTransferSalesAmount + (s.transferAmount ?? 0)) * 100) / 100;
          totalCashSalesAmount = Math.round((totalCashSalesAmount + (s.cashAmount ?? s.totalAmount ?? 0)) * 100) / 100;
        }
        const expectedCashInDrawer = Math.round((totalCashSalesAmount - totalManualExpenseAmount) * 100) / 100;

        return {
          workday,
          movements: workdayMovements,
          auditEntries: workdayAudit,
          sales: workdaySales,
          partialCuts,
          physicalCounts: [],
          closureVersions: [],
          commercialPerformance,
          rectifications: rectifications.slice().sort((a, b) => b.versionNumber - a.versionNumber),
          openAccountsStockBreakdown,
          openAccountsTotalValue,
          openAccountsTotalUnits,
          openAccountsCount: openSales.length,
          expenses: workdayExpenses,
          expensesSummary,
          adjustedNetProfit,
          totalTransferSalesAmount,
          totalCashSalesAmount,
          expectedCashInDrawer,
        };
      }
    );
  }
}
