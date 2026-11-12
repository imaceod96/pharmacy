import { BaseEntity, ISODateString } from '../../../../shared/types/entity';

export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ProductAvailability {
  AVAILABLE = 'AVAILABLE',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  INACTIVE = 'INACTIVE',
}

export interface ProductRecord extends BaseEntity {
  readonly name: string;
  readonly normalizedName: string;
  readonly sku: string | null;
  readonly categoryId: string;
  readonly measurementUnitId: string;
  readonly currentStock: number;
  readonly lastPurchasePrice: number;
  readonly currentSalePrice: number;
  readonly status: ProductStatus;
  readonly availability?: ProductAvailability;
  readonly expirationDate?: string | null;
}

/**
 * Calcula la disponibilidad operativa del producto en función
 * de su estado administrativo y su existencia actual en almacén.
 */
export function calculateProductAvailability(
  status: ProductStatus,
  currentStock: number
): ProductAvailability {
  if (status === ProductStatus.INACTIVE) {
    return ProductAvailability.INACTIVE;
  }
  if (currentStock <= 0) {
    return ProductAvailability.OUT_OF_STOCK;
  }
  return ProductAvailability.AVAILABLE;
}

export interface ProductCatalogViewItem {
  readonly id: string;
  readonly code: string;
  readonly sku: string | null;
  readonly name: string;
  readonly unitLabel: string;
  readonly categoryLabel: string;
  readonly stockQuantity: number;
  readonly salePrice: number;
  readonly purchaseCost?: number;
  readonly marginPercentage?: number;
  readonly status: ProductStatus;
  readonly availability: ProductAvailability;
  readonly expirationDate?: string | null;
  readonly updatedAt: ISODateString;
}
