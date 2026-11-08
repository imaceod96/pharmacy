import { BaseEntity, ISODateString } from '../../../../shared/types/entity';

export enum ExpenseType {
  INVENTORY_PRODUCT = 'INVENTORY_PRODUCT',
  MANUAL = 'MANUAL',
}

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  [ExpenseType.INVENTORY_PRODUCT]: 'Mercancía (Autoconsumo)',
  [ExpenseType.MANUAL]: 'Gasto Manual Operativo',
};

export interface ExpenseRecord extends BaseEntity {
  readonly workdayId: string | null;
  readonly type: ExpenseType;
  readonly productId?: string | null;
  readonly productName?: string | null;
  readonly productCode?: string | null;
  readonly unitSymbol?: string | null;
  readonly quantity?: number | null;
  readonly description: string;
  readonly amount: number; // Costo total del gasto en dinero
  readonly unitCost?: number | null;
  readonly timestamp: ISODateString;
  readonly responsibleUserId: string;
  readonly responsibleUserLabel: string;
}

export interface ExpenseDailySummary {
  readonly totalAmount: number;
  readonly totalProductExpenseAmount: number;
  readonly totalManualExpenseAmount: number;
  readonly count: number;
}
