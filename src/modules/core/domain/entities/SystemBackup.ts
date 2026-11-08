import { ISODateString } from '../../../../shared/types/entity';

export interface StoreRecordCounts {
  readonly products: number;
  readonly categories: number;
  readonly units: number;
  readonly merchandiseEntries: number;
  readonly inventoryMovements: number;
  readonly inventoryCuts: number;
  readonly workdays?: number;
  readonly costLayers?: number;
  readonly closingRectifications?: number;
  readonly sales: number;
  readonly operationHistory: number;
  readonly priceChanges?: number;
  readonly productStatusChanges?: number;
  readonly expenses?: number;
}

export interface SystemStorageSummary {
  readonly schemaVersion: number;
  readonly isDurableStorage: boolean;
  readonly initializedAt: ISODateString | null;
  readonly lastBackupAt: ISODateString | null;
  readonly counts: StoreRecordCounts;
}

export interface SystemBackupEnvelope {
  readonly format: 'ESTABLECIMIENTO_BACKUP_V1';
  readonly schemaVersion: number;
  readonly exportedAt: ISODateString;
  readonly checksum: string;
  readonly stores: Record<string, unknown[]>;
}
