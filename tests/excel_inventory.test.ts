import * as XLSX from 'xlsx';
import { ExcelInventoryService } from '../src/modules/warehouse/application/ExcelInventoryService';
import {
  ProductAvailability,
  ProductCatalogViewItem,
  ProductRecord,
  ProductStatus,
} from '../src/modules/warehouse/domain/entities/ProductRecord';
import { ProductCostLayer } from '../src/modules/warehouse/domain/entities/ProductCostLayer';
import { CategoryRecord } from '../src/modules/warehouse/domain/entities/CategoryRecord';
import { MeasurementUnitRecord } from '../src/modules/warehouse/domain/entities/MeasurementUnitRecord';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { UnauthorizedOperationError } from '../src/shared/types/errors';
import {
  adminActor,
  assert,
  assertEquals,
  assertRejects,
  cashierActor,
  createTestEngine,
  TestSuiteResult,
} from './testUtils';

export async function runExcelInventoryTests(): Promise<TestSuiteResult> {
  const tests: { name: string; fn: () => Promise<void> }[] = [];
  const startSuite = Date.now();

  // Test 1: Exportar catálogo a Excel con las columnas requeridas
  tests.push({
    name: '1. Exportación de catálogo de productos a Excel (.xlsx) con columnas exactas',
    fn: async () => {
      const engine = await createTestEngine();
      const service = new ExcelInventoryService(engine);

      const mockProducts: ProductCatalogViewItem[] = [
        {
          id: 'prod-001',
          code: 'BEB-001',
          sku: 'SKU-BEB-001',
          name: 'Cerveza Modelo Especial 355ml',
          categoryLabel: 'Cervezas',
          unitLabel: 'Botella',
          stockQuantity: 48,
          purchaseCost: 15.5,
          marginPercentage: 61.29,
          salePrice: 25.0,
          status: ProductStatus.ACTIVE,
          availability: ProductAvailability.AVAILABLE,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'prod-002',
          code: 'AGU-001',
          sku: null,
          name: 'Agua Mineral 600ml',
          categoryLabel: 'Aguas',
          unitLabel: 'Pieza',
          stockQuantity: 0,
          purchaseCost: 8.0,
          marginPercentage: 50.0,
          salePrice: 12.0,
          status: ProductStatus.INACTIVE,
          availability: ProductAvailability.INACTIVE,
          updatedAt: new Date().toISOString(),
        },
      ];

      const { fileName, rowCount } = service.exportToExcel(adminActor, mockProducts);

      assert(fileName.startsWith('Inventario_Establecimiento_'), 'Nombre de archivo debe ser válido');
      assert(fileName.endsWith('.xlsx'), 'Debe tener extensión .xlsx');
      assertEquals(rowCount, 2, 'Deben exportarse 2 filas de datos');
    },
  });

  // Test 2: Importar Excel en terminal limpia (sin catálogos previos)
  tests.push({
    name: '2. Importación en terminal limpia: crea categorías, unidades, existencias y capas FIFO',
    fn: async () => {
      const engine = await createTestEngine();
      const service = new ExcelInventoryService(engine);

      // Crear un workbook binario simulando un archivo Excel exportado
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

      const rows = [
        [
          'SKU-RON-01',
          'Ron Añejo Especial 750ml',
          'Licores',
          'Botella',
          24,
          120.0,
          50.0,
          180.0,
          'Disponible',
          'Activo',
        ],
        [
          'SKU-REF-02',
          'Refresco Cola 2L',
          'Bebidas',
          'Pieza',
          50,
          20.0,
          40.0,
          28.0,
          'Disponible',
          'Activo',
        ],
      ];

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      // Ejecutar importación
      const summary = await service.importFromExcel(adminActor, buffer);

      assertEquals(summary.totalRows, 2, 'Total filas leídas');
      assertEquals(summary.createdCount, 2, 'Productos creados');
      assertEquals(summary.updatedCount, 0, 'Productos actualizados');
      assertEquals(summary.categoriesCreated, 2, 'Nuevas categorías creadas');
      assertEquals(summary.unitsCreated, 2, 'Nuevas unidades creadas');
      assertEquals(summary.errors.length, 0, 'Sin errores');

      // Verificar persistencia en IndexedDB
      await engine.runTransaction(
        [
          StoreName.WAREHOUSE_PRODUCTS,
          StoreName.WAREHOUSE_CATEGORIES,
          StoreName.WAREHOUSE_UNITS,
          StoreName.WAREHOUSE_COST_LAYERS,
          StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
          StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
        ],
        'readonly',
        async (tx) => {
          const products = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
          assertEquals(products.length, 2, 'Debe haber 2 productos guardados');

          const ron = products.find((p) => p.sku === 'SKU-RON-01')!;
          assert(Boolean(ron), 'Producto ron debe existir');
          assertEquals(ron.currentStock, 24, 'Existencia inicial de ron');
          assertEquals(ron.lastPurchasePrice, 120.0, 'Último costo de compra');
          assertEquals(ron.currentSalePrice, 180.0, 'Precio de venta');
          assertEquals(ron.status, ProductStatus.ACTIVE, 'Estado del producto');

          // Validar que se creó la capa FIFO correspondiente
          const layers = await tx.getAllByIndex<ProductCostLayer>(
            StoreName.WAREHOUSE_COST_LAYERS,
            'by_product_id',
            ron.id
          );
          assertEquals(layers.length, 1, 'Debe tener 1 capa de costo FIFO');
          assertEquals(layers[0].originalQuantity, 24, 'Cantidad original capa FIFO');
          assertEquals(layers[0].remainingQuantity, 24, 'Cantidad remanente capa FIFO');
          assertEquals(layers[0].unitPurchaseCost, 120.0, 'Costo unitario capa FIFO');

          // Validar categorías
          const categories = await tx.getAll<CategoryRecord>(StoreName.WAREHOUSE_CATEGORIES);
          assertEquals(categories.length, 2, 'Categorías creadas en BD');

          // Validar unidades
          const units = await tx.getAll<MeasurementUnitRecord>(StoreName.WAREHOUSE_UNITS);
          assertEquals(units.length, 2, 'Unidades creadas en BD');
        }
      );
    },
  });

  // Test 3: Importar archivo actualizando productos existentes y sincronizando stock
  tests.push({
    name: '3. Actualización de catálogo existente: actualiza precios y ajusta capas FIFO en inventario',
    fn: async () => {
      const engine = await createTestEngine();
      const service = new ExcelInventoryService(engine);

      // 1. Primera importación: Crear producto con 10 unidades a $100
      const ws1 = XLSX.utils.aoa_to_sheet([
        [
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
        ],
        [
          'SKU-VINO-01',
          'Vino Tinto Reserva',
          'Vinos',
          'Botella',
          10,
          100.0,
          50.0,
          150.0,
          'Disponible',
          'Activo',
        ],
      ]);
      const wb1 = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb1, ws1, 'Inventario');
      await service.importFromExcel(adminActor, XLSX.write(wb1, { bookType: 'xlsx', type: 'array' }));

      // 2. Segunda importación: Actualizar el mismo producto a 15 unidades a $110 y precio $165
      const ws2 = XLSX.utils.aoa_to_sheet([
        [
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
        ],
        [
          'SKU-VINO-01',
          'Vino Tinto Reserva',
          'Vinos',
          'Botella',
          15,
          110.0,
          50.0,
          165.0,
          'Disponible',
          'Activo',
        ],
      ]);
      const wb2 = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb2, ws2, 'Inventario');
      const summary2 = await service.importFromExcel(
        adminActor,
        XLSX.write(wb2, { bookType: 'xlsx', type: 'array' })
      );

      assertEquals(summary2.createdCount, 0, 'No debe crear productos nuevos');
      assertEquals(summary2.updatedCount, 1, 'Debe actualizar 1 producto existente');

      // Verificar capas FIFO y stock resultante
      await engine.runTransaction(
        [StoreName.WAREHOUSE_PRODUCTS, StoreName.WAREHOUSE_COST_LAYERS],
        'readonly',
        async (tx) => {
          const products = await tx.getAll<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS);
          assertEquals(products.length, 1, 'Mantiene 1 producto único');
          assertEquals(products[0].currentStock, 15, 'Existencia actualizada a 15');
          assertEquals(products[0].lastPurchasePrice, 110.0, 'Último costo actualizado a 110');
          assertEquals(products[0].currentSalePrice, 165.0, 'Precio de venta actualizado a 165');

          const layers = await tx.getAllByIndex<ProductCostLayer>(
            StoreName.WAREHOUSE_COST_LAYERS,
            'by_product_id',
            products[0].id
          );
          // Debe tener la capa inicial (10u @ 100) y la capa por las 5u adicionales @ 110
          assertEquals(layers.length, 2, 'Debe tener 2 capas FIFO acumuladas');
          const totalQty = layers.reduce((acc, l) => acc + l.remainingQuantity, 0);
          assertEquals(totalQty, 15, 'Total en capas FIFO coincide exactamente con stock');
        }
      );
    },
  });

  // Test 4: Control de acceso y seguridad: Cashier sin permiso no puede importar
  tests.push({
    name: '4. Control de acceso: Deniega importación a rol CASHIER',
    fn: async () => {
      const engine = await createTestEngine();
      const service = new ExcelInventoryService(engine);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['Producto'], ['Test']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      await assertRejects(
        () => service.importFromExcel(cashierActor, buffer),
        UnauthorizedOperationError
      );
    },
  });

  const suiteResults = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const t of tests) {
    const tStart = Date.now();
    try {
      await t.fn();
      passedCount++;
      suiteResults.push({
        name: t.name,
        passed: true,
        durationMs: Date.now() - tStart,
      });
    } catch (err: any) {
      failedCount++;
      suiteResults.push({
        name: t.name,
        passed: false,
        durationMs: Date.now() - tStart,
        error: err?.message,
      });
    }
  }

  return {
    name: 'PRUEBAS DE IMPORTACIÓN Y EXPORTACIÓN EXCEL DE INVENTARIO',
    tests: suiteResults,
    total: tests.length,
    passed: passedCount,
    failed: failedCount,
    durationMs: Date.now() - startSuite,
  };
}
