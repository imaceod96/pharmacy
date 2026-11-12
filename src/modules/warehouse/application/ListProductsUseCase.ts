import {
  assertPermission,
  hasPermission,
} from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { calculateProfitMarginPercentage } from '../../../shared/utils/money';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import {
  calculateProductAvailability,
  ProductCatalogViewItem,
  ProductRecord,
  ProductStatus,
} from '../domain/entities/ProductRecord';
import { CategoryRepository } from '../domain/repositories/CategoryRepository';
import { MeasurementUnitRepository } from '../domain/repositories/MeasurementUnitRepository';
import { ProductRepository } from '../domain/repositories/ProductRepository';

export class ListProductsUseCase {
  private readonly productRepository: ProductRepository;
  private readonly categoryRepository: CategoryRepository;
  private readonly unitRepository: MeasurementUnitRepository;

  constructor(
    productRepository: ProductRepository,
    categoryRepository: CategoryRepository,
    unitRepository: MeasurementUnitRepository
  ) {
    this.productRepository = productRepository;
    this.categoryRepository = categoryRepository;
    this.unitRepository = unitRepository;
  }

  public async execute(actor: SessionActor): Promise<ProductCatalogViewItem[]> {
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'consultar catálogo de productos');

    const canSeeCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);

    const [products, categories, units] = await Promise.all([
      this.productRepository.findAll(),
      this.categoryRepository.findAll(),
      this.unitRepository.findAll(),
    ]);

    const categoryMap = new Map<string, CategoryRecord>(categories.map((c) => [c.id, c]));
    const unitMap = new Map<string, MeasurementUnitRecord>(units.map((u) => [u.id, u]));

    // Los productos inactivos deben aparecer al final
    const sortedProducts = [...products].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === ProductStatus.ACTIVE ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'es');
    });

    return sortedProducts.map((product) => {
      const category = categoryMap.get(product.categoryId);
      const unit = unitMap.get(product.measurementUnitId);

      const baseItem: ProductCatalogViewItem = {
        id: product.id,
        code: product.sku || product.id.slice(0, 8).toUpperCase(),
        sku: product.sku,
        name: product.name,
        unitLabel: unit ? unit.name : 'Unidad',
        categoryLabel: category ? category.name : 'General',
        stockQuantity: product.currentStock,
        salePrice: product.currentSalePrice,
        status: product.status,
        availability: calculateProductAvailability(product.status, product.currentStock),
        expirationDate: product.expirationDate ?? null,
        updatedAt: product.updatedAt,
      };

      if (canSeeCosts) {
        return {
          ...baseItem,
          purchaseCost: product.lastPurchasePrice,
          marginPercentage: calculateProfitMarginPercentage(
            product.currentSalePrice,
            product.lastPurchasePrice
          ),
        };
      }

      return baseItem;
    });
  }
}
