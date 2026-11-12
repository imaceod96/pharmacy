import { EntityId, ISODateString } from '../../../../shared/types/entity';

export interface MerchandiseEntryRecord {
  readonly id: EntityId;
  readonly productId: EntityId;
  readonly quantity: number;
  readonly unitPurchasePrice: number;
  readonly declaredSalePrice: number;
  readonly totalEntryCost: number;
  readonly declaredEntryDate: string;
  readonly expirationDate?: string | null;
  readonly registeredAt: ISODateString;
  readonly responsibleUserId: string;
}
