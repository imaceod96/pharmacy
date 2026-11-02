import { BaseEntity, EntityId, ISODateString } from '../../../../shared/types/entity';

export type MorningVerificationMode = 'AUDIT_ONLY' | 'ADJUST_STOCK';

export interface MorningVerificationItem {
  readonly productId: EntityId;
  readonly productCode: string;
  readonly productName: string;
  readonly sku: string | null;
  readonly measurementUnitId: EntityId;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly systemStock: number;
  readonly countedStock: number;
  readonly difference: number;
  readonly differenceReason?: string | null;
  readonly isAdjusted: boolean;
}

export interface MorningStockVerificationRecord extends BaseEntity {
  readonly folio: string;
  readonly date: string;
  readonly timestamp: ISODateString;
  readonly mode: MorningVerificationMode;
  readonly actorRole: string;
  readonly actorLabel: string;
  readonly totalProductsCounted: number;
  readonly differencesCount: number;
  readonly notes?: string | null;
  readonly items: readonly MorningVerificationItem[];
}
