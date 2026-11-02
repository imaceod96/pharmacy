import * as XLSX from 'xlsx';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { normalizeName } from '../../../shared/utils/string';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { CategoryRecord } from '../domain/entities/CategoryRecord';
import {
  InventoryMovementRecord,
  InventoryMovementType,
} from '../domain/entities/InventoryMovementRecord';
import { MeasurementUnitRecord } from '../domain/entities/MeasurementUnitRecord';
import { MerchandiseEntryRecord } from '../domain/entities/MerchandiseEntryRecord';
import { ProductCostLayer } from '../domain/entities/ProductCostLayer';
import {
  calculateProductAvailability,
  ProductAvailability,
  ProductCatalogViewItem,
  ProductRecord,
  ProductStatus,
} from '../domain/entities/ProductRecord';

export interface ExcelImportSummary {
  readonly totalRows: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly categoriesCreated: number;
  readonly unitsCreated: number;
  readonly errors: readonly string[];
}

interface ParsedExcelRow {
  readonly sku: string | null;
  readonly name: string;
  readonly categoryName: string;
  readonly unitName: string;
  readonly currentStock: number;
  readonly lastCost: number;
  readonly marginPercentage: number;
  readonly salePrice: number;
  readonly status: ProductStatus;
}

export class ExcelInventoryService {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  /**
   * Exporta el catálogo completo de productos a un archivo Excel (.xlsx)
   * estructurado con todas las columnas requeridas para su posterior importación.
   */
  public exportToExcel(
    actor: SessionActor,
    products: readonly ProductCatalogViewItem[]
  ): { fileName: string; rowCount: number } {
    assertPermission(actor, Permission.VIEW_PRODUCTS, 'exportar catálogo de inventario a Excel');

    const headers = [
      'Código / SKU',
      'Producto',
      'Categoría',
      'Unidad de Medida',
      'Existencia Actual',
      'Último Costo',
      'Margen (%)',
      'Precio de Venta',
      'Disponibilidad',
      'Estado',
    ];

    const dataRows = products.map((item) => {
      const codeOrSku = item.sku || item.code || '';
      const availabilityText =
        item.availability === ProductAvailability.AVAILABLE
          ? 'Disponible'
          : item.availability === ProductAvailability.OUT_OF_STOCK
          ? 'Agotado'
          : 'Inactivo';
      const statusText = item.status === ProductStatus.ACTIVE ? 'Activo' : 'Inactivo';
      const marginVal =
        item.marginPercentage !== undefined ? Number(item.marginPercentage.toFixed(2)) : 0;
      const costVal = item.purchaseCost !== undefined ? Number(item.purchaseCost.toFixed(2)) : 0;

      return [
        codeOrSku,
        item.name,
        item.categoryLabel,
        item.unitLabel,
        item.stockQuantity,
        costVal,
        marginVal,
        item.salePrice,
        availabilityText,
        statusText,
      ];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);

    // Anchos visuales para que las columnas no queden comprimidas
    worksheet['!cols'] = [
      { wch: 18 }, // Código / SKU
      { wch: 34 }, // Producto
      { wch: 22 }, // Categoría
      { wch: 18 }, // Unidad de Medida
      { wch: 18 }, // Existencia Actual
      { wch: 16 }, // Último Costo
      { wch: 14 }, // Margen (%)
      { wch: 16 }, // Precio de Venta
      { wch: 16 }, // Disponibilidad
      { wch: 14 }, // Estado
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');

    const safeDate = nowISO().slice(0, 10);
    const fileName = `Inventario_Establecimiento_${safeDate}.xlsx`;

    // Generar buffer binario y descargar en navegador
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    return { fileName, rowCount: dataRows.length };
  }

  /**
   * Lee e importa un archivo Excel (.xlsx o .xls) con el catálogo de inventario.
   * Resuelve de forma atómica:
   * - Creación dinámica de categorías y unidades de medida inexistentes.
   * - Alta de nuevos productos con sus respectivas capas FIFO iniciales y movimientos.
   * - Actualización de productos existentes (por SKU o nombre normalizado) con ajuste de existencias.
   * - Auditoría en el historial de operaciones.
   */
  public async importFromExcel(
    actor: SessionActor,
    file: File | ArrayBuffer
  ): Promise<ExcelImportSummary> {
    assertPermission(actor, Permission.MANAGE_PRODUCTS, 'importar catálogo de inventario desde Excel');

    let buffer: ArrayBuffer;
    if (file instanceof File) {
      buffer = await file.arrayBuffer();
    } else {
      buffer = file;
    }

    const workbook = XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('El archivo de Excel no contiene ninguna hoja de cálculo.');
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) {
      throw new Error('No fue posible leer la hoja de cálculo del archivo Excel.');
    }

    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!rawRows || rawRows.length === 0) {
      throw new Error('El archivo de Excel está vacío.');
    }

    const parsedRows = this.parseSheetRows(rawRows);
    if (parsedRows.length === 0) {
      throw new Error('No se encontraron registros de productos válidos en el archivo Excel.');
    }

    const timestamp = nowISO();

    let createdCount = 0;
    let updatedCount = 0;
    let categoriesCreated = 0;
    let unitsCreated = 0;
    const errors: string[] = [];

    await this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_PRODUCTS,
        StoreName.WAREHOUSE_CATEGORIES,
        StoreName.WAREHOUSE_UNITS,
        StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
        StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        StoreName.WAREHOUSE_COST_LAYERS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Cargar mapa de categorías existentes
        const existingCategories = await tx.getAll<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES);
        const categoryMap = new Map<string, CategoryRecord>();
        for (const cat of existingCategories) {
          categoryMap.set(cat.normalizedName, cat);
        }

        // 2. Cargar mapa de unidades existentes
        const existingUnits = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
        const unitMap = new Map<string, MeasurementUnitRecord>();
        for (const unit of existingUnits) {
          unitMap.set(unit.normalizedName, unit);
        }

        // 3. Cargar mapa de productos existentes
        const existingProducts = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
        const productBySku = new Map<string, ProductRecord>();
        const productByNormName = new Map<string, ProductRecord>();
        for (const prod of existingProducts) {
          if (prod.sku) {
            productBySku.set(prod.sku.toLowerCase().trim(), prod);
          }
          productByNormName.set(prod.normalizedName, prod);
        }

        // 4. Procesar cada fila del Excel
        for (const row of parsedRows) {
          try {
            // A. Resolver categoría
            const normCat = normalizeName(row.categoryName || 'General');
            let categoryRecord = categoryMap.get(normCat);
            if (!categoryRecord) {
              const newCatId = generateEntityId();
              const createdCategory: CategoryRecord = {
                id: newCatId,
                name: (row.categoryName || 'General').trim(),
                normalizedName: normCat,
                createdAt: timestamp,
              };
              await tx.upsert(StoreName.WAREHOUSE_CATEGORIES, createdCategory);
              categoryMap.set(normCat, createdCategory);
              categoryRecord = createdCategory;
              categoriesCreated++;
            }

            // B. Resolver unidad de medida
            const normUnit = normalizeName(row.unitName || 'Pieza');
            let unitRecord = unitMap.get(normUnit);
            if (!unitRecord) {
              const newUnitId = generateEntityId();
              const createdUnit: MeasurementUnitRecord = {
                id: newUnitId,
                name: (row.unitName || 'Pieza').trim(),
                normalizedName: normUnit,
                createdAt: timestamp,
              };
              await tx.upsert(StoreName.WAREHOUSE_UNITS, createdUnit);
              unitMap.set(normUnit, createdUnit);
              unitRecord = createdUnit;
              unitsCreated++;
            }

            // C. Determinar si el producto ya existe (por SKU o por nombre normalizado)
            const normProdName = normalizeName(row.name);
            let existing: ProductRecord | undefined;
            if (row.sku) {
              existing = productBySku.get(row.sku.toLowerCase().trim());
            }
            if (!existing) {
              existing = productByNormName.get(normProdName);
            }

            if (existing) {
              // Actualizar producto existente
              const prevStock = existing.currentStock;
              const newStock = Math.max(0, row.currentStock);
              const stockDiff = Math.round((newStock - prevStock) * 1000) / 1000;

              const updatedProd: ProductRecord = {
                ...existing,
                name: row.name,
                normalizedName: normProdName,
                sku: row.sku || existing.sku || null,
                categoryId: categoryRecord.id,
                measurementUnitId: unitRecord.id,
                currentStock: newStock,
                lastPurchasePrice: row.lastCost > 0 ? row.lastCost : existing.lastPurchasePrice,
                currentSalePrice: row.salePrice > 0 ? row.salePrice : existing.currentSalePrice,
                status: row.status,
                availability: calculateProductAvailability(row.status, newStock),
                updatedAt: timestamp,
              };

              await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, updatedProd);

              // Manejar cambio de existencias y capas FIFO
              if (stockDiff !== 0) {
                const movement: InventoryMovementRecord = {
                  id: generateEntityId(),
                  productId: existing.id,
                  movementType:
                    stockDiff > 0
                      ? InventoryMovementType.ENTRY
                      : InventoryMovementType.CORRECTION_NEGATIVE,
                  quantity: Math.abs(stockDiff),
                  previousStock: prevStock,
                  resultingStock: newStock,
                  timestamp,
                  responsibleUserId: actor.label,
                  originOperationId: 'EXCEL_IMPORT_UPDATE',
                };
                await tx.upsert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);

                if (stockDiff > 0) {
                  // Agregar capa FIFO por las unidades añadidas
                  const cost = row.lastCost > 0 ? row.lastCost : existing.lastPurchasePrice;
                  const newLayer: ProductCostLayer = {
                    id: generateEntityId(),
                    productId: existing.id,
                    originEntryId: null,
                    originalQuantity: stockDiff,
                    remainingQuantity: stockDiff,
                    unitPurchaseCost: cost,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    auditRef: 'IMPORTACION_EXCEL_AJUSTE_POSITIVO',
                  };
                  await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, newLayer);
                } else {
                  // Reducción de existencias: descontar de capas FIFO disponibles
                  const layers = (
                    await tx.getAllByIndex<ProductCostLayer>(
                      StoreName.WAREHOUSE_COST_LAYERS,
                      'by_product_id',
                      existing.id
                    )
                  ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

                  let toDeduct = Math.abs(stockDiff);
                  for (const layer of layers) {
                    if (toDeduct <= 0) break;
                    if (layer.remainingQuantity <= 0) continue;
                    const take = Math.min(toDeduct, layer.remainingQuantity);
                    layer.remainingQuantity =
                      Math.round((layer.remainingQuantity - take) * 1000) / 1000;
                    await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, layer);
                    toDeduct = Math.round((toDeduct - take) * 1000) / 1000;
                  }
                }
              }

              updatedCount++;
            } else {
              // Crear nuevo producto
              const productId = generateEntityId();
              const newStock = Math.max(0, row.currentStock);
              const cost = Math.max(0, row.lastCost);
              const price = row.salePrice > 0 ? row.salePrice : cost;

              const newProd: ProductRecord = {
                id: productId,
                name: row.name,
                normalizedName: normProdName,
                sku: row.sku || null,
                categoryId: categoryRecord.id,
                measurementUnitId: unitRecord.id,
                currentStock: newStock,
                lastPurchasePrice: cost,
                currentSalePrice: price,
                status: row.status,
                availability: calculateProductAvailability(row.status, newStock),
                createdAt: timestamp,
                updatedAt: timestamp,
              };

              await tx.upsert(StoreName.WAREHOUSE_PRODUCTS, newProd);

              // Si tiene existencias iniciales, crear entrada, movimiento y capa FIFO
              if (newStock > 0) {
                const entryId = generateEntityId();
                const entry: MerchandiseEntryRecord = {
                  id: entryId,
                  productId,
                  quantity: newStock,
                  unitPurchasePrice: cost,
                  declaredSalePrice: price,
                  totalEntryCost: Math.round(newStock * cost * 100) / 100,
                  declaredEntryDate: timestamp.slice(0, 10),
                  registeredAt: timestamp,
                  responsibleUserId: actor.label,
                };
                await tx.upsert(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, entry);

                const movement: InventoryMovementRecord = {
                  id: generateEntityId(),
                  productId,
                  movementType: InventoryMovementType.ENTRY,
                  quantity: newStock,
                  previousStock: 0,
                  resultingStock: newStock,
                  timestamp,
                  responsibleUserId: actor.label,
                  originOperationId: entryId,
                };
                await tx.upsert(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, movement);

                const costLayer: ProductCostLayer = {
                  id: generateEntityId(),
                  productId,
                  originEntryId: entryId,
                  originalQuantity: newStock,
                  remainingQuantity: newStock,
                  unitPurchaseCost: cost,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                  auditRef: 'IMPORTACION_EXCEL_INICIAL',
                };
                await tx.upsert(StoreName.WAREHOUSE_COST_LAYERS, costLayer);
              }

              // Registrar en cachés en memoria para evitar colisiones con filas subsecuentes
              if (newProd.sku) {
                productBySku.set(newProd.sku.toLowerCase().trim(), newProd);
              }
              productByNormName.set(newProd.normalizedName, newProd);

              createdCount++;
            }
          } catch (rowErr) {
            errors.push(
              `Error en producto «${row.name}»: ${
                rowErr instanceof Error ? rowErr.message : 'Error desconocido'
              }`
            );
          }
        }

        // 5. Registro en el historial de operaciones
        const auditLog: OperationLogEntry = {
          id: generateEntityId(),
          module: OperationModule.WAREHOUSE,
          action: 'IMPORT_INVENTORY_EXCEL',
          entityType: 'Product',
          entityId: null,
          actorRole: actor.role,
          description: `Importación de inventario desde archivo Excel: ${createdCount} productos creados, ${updatedCount} actualizados, ${categoriesCreated} nuevas categorías, ${unitsCreated} nuevas unidades.`,
          createdAt: timestamp,
        };
        await tx.upsert(StoreName.OPERATION_HISTORY, auditLog);
      }
    );

    return {
      totalRows: parsedRows.length,
      createdCount,
      updatedCount,
      categoriesCreated,
      unitsCreated,
      errors,
    };
  }

  /**
   * Identifica los encabezados de columnas con tolerancia a mayúsculas, acentos o sinónimos.
   */
  private parseSheetRows(rawRows: unknown[][]): ParsedExcelRow[] {
    if (rawRows.length === 0) return [];

    let headerRowIndex = 0;
    let skuCol = -1;
    let nameCol = -1;
    let catCol = -1;
    let unitCol = -1;
    let stockCol = -1;
    let costCol = -1;
    let marginCol = -1;
    let priceCol = -1;
    let statusCol = -1;

    // Buscar la fila de encabezados en las primeras 5 filas
    for (let r = 0; r < Math.min(rawRows.length, 5); r++) {
      const row = rawRows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] ?? '').trim().toLowerCase();
        if (/c[oó]digo|sku/i.test(val) && skuCol === -1) skuCol = c;
        if (/producto|nombre/i.test(val) && nameCol === -1) nameCol = c;
        if (/categor[ií]a/i.test(val) && catCol === -1) catCol = c;
        if (/unidad/i.test(val) && unitCol === -1) unitCol = c;
        if (/existencia|stock|cantidad/i.test(val) && stockCol === -1) stockCol = c;
        if (/costo|compra/i.test(val) && costCol === -1) costCol = c;
        if (/margen/i.test(val) && marginCol === -1) marginCol = c;
        if (/precio/i.test(val) && !/costo|compra/i.test(val) && priceCol === -1) priceCol = c;
        if (/estado|status/i.test(val) && statusCol === -1) statusCol = c;
      }
      if (nameCol !== -1) {
        headerRowIndex = r;
        break;
      }
    }

    // Si no se detectaron encabezados por nombre, recurrir al mapeo posicional estándar
    if (nameCol === -1) {
      skuCol = 0;
      nameCol = 1;
      catCol = 2;
      unitCol = 3;
      stockCol = 4;
      costCol = 5;
      marginCol = 6;
      priceCol = 7;
      statusCol = 9;
      headerRowIndex = -1;
    }

    const results: ParsedExcelRow[] = [];
    const startRow = headerRowIndex + 1;

    for (let r = startRow; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      const rawName = String(nameCol >= 0 ? row[nameCol] ?? '' : '').trim();
      if (!rawName) continue; // Fila vacía o sin nombre

      const rawSku = skuCol >= 0 && row[skuCol] ? String(row[skuCol]).trim() : null;
      const rawCategory = catCol >= 0 && row[catCol] ? String(row[catCol]).trim() : 'General';
      const rawUnit = unitCol >= 0 && row[unitCol] ? String(row[unitCol]).trim() : 'Pieza';

      const rawStock = stockCol >= 0 ? parseFloat(String(row[stockCol])) : 0;
      const stock = isNaN(rawStock) ? 0 : Math.max(0, Math.round(rawStock * 1000) / 1000);

      const rawCost = costCol >= 0 ? parseFloat(String(row[costCol])) : 0;
      const lastCost = isNaN(rawCost) ? 0 : Math.max(0, Math.round(rawCost * 100) / 100);

      const rawMargin = marginCol >= 0 ? parseFloat(String(row[marginCol])) : 0;
      const margin = isNaN(rawMargin) ? 0 : Math.round(rawMargin * 100) / 100;

      let salePrice = priceCol >= 0 ? parseFloat(String(row[priceCol])) : 0;
      if (isNaN(salePrice) || salePrice <= 0) {
        salePrice = lastCost > 0 ? lastCost : 0;
      }
      salePrice = Math.round(salePrice * 100) / 100;

      const rawStatus = statusCol >= 0 ? String(row[statusCol] ?? '').trim().toLowerCase() : '';
      const status =
        rawStatus.includes('inactiv') || rawStatus.includes('desactiv')
          ? ProductStatus.INACTIVE
          : ProductStatus.ACTIVE;

      results.push({
        sku: rawSku || null,
        name: rawName,
        categoryName: rawCategory || 'General',
        unitName: rawUnit || 'Pieza',
        currentStock: stock,
        lastCost,
        marginPercentage: margin,
        salePrice,
        status,
      });
    }

    return results;
  }
}
