import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionContext, TransactionManager } from '../../../shared/types/repository';
import { ExpenseDailySummary, ExpenseRecord, ExpenseType } from '../domain/entities/ExpenseRecord';
import { WorkdayRecord, WorkdayStatus } from '../../warehouse/domain/entities/WorkdayRecord';

export interface ExpensesViewData {
  readonly expenses: readonly ExpenseRecord[];
  readonly summary: ExpenseDailySummary;
  readonly activeWorkday: WorkdayRecord | null;
}

export class ListExpensesUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    workdayId?: string | null
  ): Promise<ExpensesViewData> {
    assertPermission(actor, Permission.VIEW_EXPENSES, 'consultar catálogo y resumen de gastos');

    return this.transactionManager.runTransaction<ExpensesViewData>(
      [StoreName.EXPENSES, StoreName.WAREHOUSE_WORKDAYS],
      'readonly',
      async (tx: TransactionContext) => {
        const workdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
        const activeWorkday = workdays.find((w: WorkdayRecord) => w.status === WorkdayStatus.OPEN || w.status === WorkdayStatus.CLOSING_SUSPENDED) ?? null;

        const targetWorkdayId = workdayId !== undefined ? workdayId : activeWorkday?.id ?? null;

        let allExpenses = await tx.getAll<ExpenseRecord>(StoreName.EXPENSES);

        if (targetWorkdayId !== null) {
          allExpenses = allExpenses.filter((e: ExpenseRecord) => e.workdayId === targetWorkdayId);
        }

        const sortedExpenses = allExpenses.slice().sort((a: ExpenseRecord, b: ExpenseRecord) => b.timestamp.localeCompare(a.timestamp));

        let totalAmount = 0;
        let totalProductExpenseAmount = 0;
        let totalManualExpenseAmount = 0;

        for (const exp of sortedExpenses) {
          totalAmount = Math.round((totalAmount + exp.amount) * 100) / 100;
          if (exp.type === ExpenseType.INVENTORY_PRODUCT) {
            totalProductExpenseAmount = Math.round((totalProductExpenseAmount + exp.amount) * 100) / 100;
          } else {
            totalManualExpenseAmount = Math.round((totalManualExpenseAmount + exp.amount) * 100) / 100;
          }
        }

        return {
          expenses: sortedExpenses,
          summary: {
            totalAmount,
            totalProductExpenseAmount,
            totalManualExpenseAmount,
            count: sortedExpenses.length,
          },
          activeWorkday,
        };
      }
    );
  }
}
