import { EntityId, ISODateString } from '../../../../shared/types/entity';

export enum InventoryMovementType {
  ENTRY = 'ENTRY',
  CORRECTION_POSITIVE = 'CORRECTION_POSITIVE',
  CORRECTION_NEGATIVE = 'CORRECTION_NEGATIVE',
  SALE = 'SALE',
  PARTIAL_CUT_ADJUSTMENT = 'PARTIAL_CUT_ADJUSTMENT',
  FINAL_INVENTORY_ADJUSTMENT = 'FINAL_INVENTORY_ADJUSTMENT',
  MORNING_VERIFICATION_ADJUSTMENT = 'MORNING_VERIFICATION_ADJUSTMENT',
}

export interface InventoryMovementRecord {
  readonly id: EntityId;
  readonly productId: EntityId;
  readonly movementType: InventoryMovementType;
  readonly quantity: number;
  readonly signedQuantity?: number;
  readonly previousStock: number;
  readonly resultingStock: number;
  readonly timestamp: ISODateString;
  readonly responsibleUserId: string;
  readonly originOperationId: EntityId;
  readonly reason?: string | null;
  readonly workdayId?: string | null;
  readonly workdayFolio?: string | null;
  readonly partialCutId?: string | null;
  readonly partialCutFolio?: string | null;
}
