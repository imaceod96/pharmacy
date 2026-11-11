import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityId } from '../../../shared/types/entity';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { ProductRecord, ProductStatus } from '../../warehouse/domain/entities/ProductRecord';
import {
  SaleLineCatalogSyncStatus,
  SaleRecord,
  SaleStatus,
} from '../domain/entities/SaleRecord';
import { SaleRepository } from '../domain/repositories/SaleRepository';

export interface OpenSaleDetailWithSync {
  readonly sale: SaleRecord;
  readonly lineSyncStatuses: readonly SaleLineCatalogSyncStatus[];
  readonly hasBlockingIssues: boolean;
  readonly hasPriceChanges: boolean;
  readonly currentCatalogTotalAmount: number;
}

export class GetOpenSaleDetailUseCase {
  private readonly saleRepository: SaleRepository;
  private readonly transactionManager?: TransactionManager;

  constructor(saleRepository: SaleRepository, transactionManager?: TransactionManager) {
    this.saleRepository = saleRepository;
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    saleId: EntityId
  ): Promise<SaleRecord | undefined> {
    assertPermission(actor, Permission.VIEW_OPEN_SALES, 'consultar detalle de venta abierta');
    return this.saleRepository.findOpenSaleById(saleId);
  }

  /**
   * Consulta una cuenta abierta y verifica en tiempo real el estado administrativo,
   * existencias disponibles y precios actuales de cada producto en el catálogo.
   */
  public async executeWithCatalogSync(
    actor: SessionActor,
    saleId: EntityId
  ): Promise<OpenSaleDetailWithSync | undefined> {
    assertPermission(actor, Permission.VIEW_OPEN_SALES, 'consultar detalle de venta abierta');

    if (!this.transactionManager) {
      const sale = await this.saleRepository.findOpenSaleById(saleId);
      if (!sale) return undefined;
      return {
        sale,
        lineSyncStatuses: [],
        hasBlockingIssues: false,
        hasPriceChanges: false,
        currentCatalogTotalAmount: sale.totalAmount ?? 0,
      };
    }

    return this.transactionManager.runTransaction(
      [StoreName.SALES_RECORDS, StoreName.WAREHOUSE_PRODUCTS],
      'readonly',
      async (tx) => {
        const sale = await tx.get<SaleRecord>(StoreName.SALES_RECORDS, saleId);
        if (!sale || sale.status !== SaleStatus.OPEN) {
          return undefined;
        }

        const lineSyncStatuses: SaleLineCatalogSyncStatus[] = [];
        let hasBlockingIssues = false;
        let hasPriceChanges = false;
        let currentCatalogTotalAmount = 0;

        for (const item of sale.items ?? []) {
          const product = await tx.get<ProductRecord>(
            StoreName.WAREHOUSE_PRODUCTS,
            item.productId
          );

          if (!product) {
            hasBlockingIssues = true;
            lineSyncStatuses.push({
              productId: item.productId,
              productName: item.productName,
              isProductMissing: true,
              isProductInactive: true,
              isOutOfStock: true,
              isInsufficientStock: true,
              availableStock: 0,
              requestedQuantity: item.quantity,
              hasPriceChanged: false,
              savedUnitSalePrice: item.unitSalePrice,
              currentCatalogSalePrice: item.unitSalePrice,
              blocksDispatch: true,
              statusMessage: 'El producto ya no existe en el catálogo de almacén.',
            });
            continue;
          }

          const isProductInactive = product.status !== ProductStatus.ACTIVE;
          // Las existencias de una cuenta abierta ya fueron apartadas del almacén físico.
          // Por tanto, tener 0 en almacén no bloquea el despacho de lo que ya está en la cuenta.
          const isOutOfStock = false;
          const isInsufficientStock = false;
          const hasPriceChanged =
            Math.abs(product.currentSalePrice - item.unitSalePrice) > 0.001;
          const blocksDispatch = isProductInactive;

          if (blocksDispatch) {
            hasBlockingIssues = true;
          }
          if (hasPriceChanged) {
            hasPriceChanges = true;
          }

          let statusMessage: string | null = null;
          if (isProductInactive) {
            statusMessage =
              'Producto desactivado en almacén. Retíralo de la cuenta para poder despachar.';
          } else if (hasPriceChanged) {
            statusMessage = `El precio en catálogo cambió de $${item.unitSalePrice.toFixed(2)} a $${product.currentSalePrice.toFixed(2)}.`;
          }

          const lineCurrentSubtotal =
            Math.round(item.quantity * product.currentSalePrice * 100) / 100;
          currentCatalogTotalAmount =
            Math.round((currentCatalogTotalAmount + lineCurrentSubtotal) * 100) /
            100;

          lineSyncStatuses.push({
            productId: item.productId,
            productName: product.name,
            isProductMissing: false,
            isProductInactive,
            isOutOfStock,
            isInsufficientStock,
            availableStock: product.currentStock,
            requestedQuantity: item.quantity,
            hasPriceChanged,
            savedUnitSalePrice: item.unitSalePrice,
            currentCatalogSalePrice: product.currentSalePrice,
            blocksDispatch,
            statusMessage,
          });
        }

        return {
          sale,
          lineSyncStatuses,
          hasBlockingIssues,
          hasPriceChanges,
          currentCatalogTotalAmount,
        };
      }
    );
  }
}
