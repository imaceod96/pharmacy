import {
  adminActor,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { RegisterMerchandiseEntryUseCase } from '../src/modules/warehouse/application/RegisterMerchandiseEntryUseCase';
import { CorrectProductStockUseCase } from '../src/modules/warehouse/application/CorrectProductStockUseCase';
import { GetProductHistoryUseCase } from '../src/modules/warehouse/application/GetProductHistoryUseCase';
import { ActivateProductUseCase } from '../src/modules/warehouse/application/ActivateProductUseCase';
import { DeactivateProductUseCase } from '../src/modules/warehouse/application/DeactivateProductUseCase';
import { IndexedDbProductRepository } from '../src/modules/warehouse/infrastructure/IndexedDbProductRepository';
import { IndexedDbCategoryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbMeasurementUnitRepository } from '../src/modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbMerchandiseEntryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbMerchandiseEntryRepository';
import { IndexedDbInventoryMovementRepository } from '../src/modules/warehouse/infrastructure/IndexedDbInventoryMovementRepository';
import { IndexedDbPriceChangeRepository } from '../src/modules/warehouse/infrastructure/IndexedDbPriceChangeRepository';
import { IndexedDbProductStatusChangeRepository } from '../src/modules/warehouse/infrastructure/IndexedDbProductStatusChangeRepository';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { DuplicateRecordError } from '../src/shared/types/errors';
import { ProductStatus } from '../src/modules/warehouse/domain/entities/ProductRecord';

export async function runInventoryTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Creación de producto con entrada inicial
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Bebidas', normalizedName: 'BEBIDAS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const product = await registerProduct.execute(adminActor, {
      name: 'Refresco Cola 600ml',
      sku: 'SKU-COLA-600',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 20,
      unitPurchasePrice: 15,
      declaredSalePrice: 25,
    });

    assertEquals(product.name, 'Refresco Cola 600ml');
    assertEquals(product.currentStock, 20);
    assertEquals(product.lastPurchasePrice, 15);
    assertEquals(product.currentSalePrice, 25);

    tests.push({ name: 'Creación de producto con entrada inicial', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Creación de producto con entrada inicial', passed: false, durationMs: 0, error: err.message });
  }

  // Test 2: Unicidad de nombre y SKU
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Bebidas', normalizedName: 'BEBIDAS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await registerProduct.execute(adminActor, {
      name: 'Agua Natural 1L',
      sku: 'SKU-AGUA-1L',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 10,
      unitPurchasePrice: 8,
      declaredSalePrice: 15,
    });

    // Intentar mismo nombre con diferente SKU
    await assertRejects(
      () => registerProduct.execute(adminActor, {
        name: 'Agua Natural 1L',
        sku: 'SKU-OTRO',
        categoryId: 'cat-1',
        measurementUnitId: 'unit-1',
        initialQuantity: 5,
        unitPurchasePrice: 8,
        declaredSalePrice: 15,
      }),
      DuplicateRecordError,
      'Rechazar nombre duplicado'
    );

    // Intentar mismo SKU con diferente nombre
    await assertRejects(
      () => registerProduct.execute(adminActor, {
        name: 'Agua Mineral 1L',
        sku: 'SKU-AGUA-1L',
        categoryId: 'cat-1',
        measurementUnitId: 'unit-1',
        initialQuantity: 5,
        unitPurchasePrice: 8,
        declaredSalePrice: 15,
      }),
      DuplicateRecordError,
      'Rechazar SKU duplicado'
    );

    tests.push({ name: 'Unicidad de nombre y SKU', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Unicidad de nombre y SKU', passed: false, durationMs: 0, error: err.message });
  }

  // Test 3: Entradas de mercancía
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const registerEntry = new RegisterMerchandiseEntryUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Abarrotes', normalizedName: 'ABARROTES', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Kilo', symbol: 'kg', normalizedName: 'KILO', precisionDigits: 2, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const product = await registerProduct.execute(adminActor, {
      name: 'Arroz Blanco 1kg',
      sku: 'SKU-ARROZ',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 10,
      unitPurchasePrice: 18,
      declaredSalePrice: 28,
    });

    const entryRes = await registerEntry.execute(adminActor, {
      productId: product.id,
      receivedQuantity: 15,
      unitPurchasePrice: 20,
      declaredSalePrice: 28,
      declaredEntryDate: '2026-10-28',
    });

    assertEquals(entryRes.product.currentStock, 25);
    assertEquals(entryRes.product.lastPurchasePrice, 20); // Actualiza costo
    assertEquals(entryRes.entry.quantity, 15);

    tests.push({ name: 'Entradas de mercancía y actualización de costo', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Entradas de mercancía y actualización de costo', passed: false, durationMs: 0, error: err.message });
  }

  // Test 4: Corrección de existencias y Kardex
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const correctStock = new CorrectProductStockUseCase(engine);

    const productRepo = new IndexedDbProductRepository(engine);
    const catRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const entryRepo = new IndexedDbMerchandiseEntryRepository(engine);
    const movRepo = new IndexedDbInventoryMovementRepository(engine);
    const priceRepo = new IndexedDbPriceChangeRepository(engine);
    const statusRepo = new IndexedDbProductStatusChangeRepository(engine);

    const getHistory = new GetProductHistoryUseCase(productRepo, catRepo, unitRepo, entryRepo, movRepo, priceRepo, statusRepo);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Abarrotes', normalizedName: 'ABARROTES', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const product = await registerProduct.execute(adminActor, {
      name: 'Aceite Vegetal 1L',
      sku: 'SKU-ACEITE',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 30,
      unitPurchasePrice: 35,
      declaredSalePrice: 50,
    });

    // Ajustar stock
    const corrRes = await correctStock.execute(adminActor, {
      productId: product.id,
      realPhysicalStock: 25,
      reason: 'Ajuste por merma en almacén',
    });

    assertEquals(corrRes.product.currentStock, 25);

    // Consultar Kardex
    const history = await getHistory.execute(adminActor, { productId: product.id });
    assertEquals(history.summary.currentStock, 25);
    assertEquals(history.kardexMovements.length, 2);

    const lastMov = history.kardexMovements[0];
    assertEquals(lastMov.previousStock, 30);
    assertEquals(lastMov.resultingStock, 25);

    tests.push({ name: 'Corrección de existencias y consulta de Kardex', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Corrección de existencias y consulta de Kardex', passed: false, durationMs: 0, error: err.message });
  }

  // Test 5: Activación y desactivación de productos
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const deactivateProduct = new DeactivateProductUseCase(engine);
    const activateProduct = new ActivateProductUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Abarrotes', normalizedName: 'ABARROTES', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const product = await registerProduct.execute(adminActor, {
      name: 'Galletas de Chispas',
      sku: 'SKU-GALLETAS',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 10,
      unitPurchasePrice: 12,
      declaredSalePrice: 20,
    });

    assertEquals(product.status, ProductStatus.ACTIVE);

    // Desactivar
    const deactRes = await deactivateProduct.execute(adminActor, {
      productId: product.id,
      reason: 'Temporante fuera de catálogo',
    });
    assertEquals(deactRes.product.status, ProductStatus.INACTIVE);

    // Activar
    const actRes = await activateProduct.execute(adminActor, {
      productId: product.id,
      reason: 'Reincorporado a venta',
    });
    assertEquals(actRes.product.status, ProductStatus.ACTIVE);

    tests.push({ name: 'Activación y desactivación de productos', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Activación y desactivación de productos', passed: false, durationMs: 0, error: err.message });
  }

  // Test 7: Registro con fecha de vencimiento y cálculo de alerta preventiva (≤ 1 año)
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const registerEntry = new RegisterMerchandiseEntryUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-farmacia', name: 'Farmacia', normalizedName: 'FARMACIA', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-caja', name: 'Caja', symbol: 'caja', normalizedName: 'CAJA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    // Fecha a 6 meses en formato Mes/Año YYYY-MM (debe generar alerta preventiva)
    const inSixMonths = new Date();
    inSixMonths.setMonth(inSixMonths.getMonth() + 6);
    const expDateSixMonths = inSixMonths.toISOString().slice(0, 7);

    const productWithExp = await registerProduct.execute(adminActor, {
      name: 'Amoxicilina 500mg',
      sku: 'MED-AMOX-500',
      categoryId: 'cat-farmacia',
      measurementUnitId: 'unit-caja',
      initialQuantity: 30,
      unitPurchasePrice: 40,
      declaredSalePrice: 70,
      expirationDate: expDateSixMonths,
    });

    assertEquals(productWithExp.expirationDate, expDateSixMonths);

    // Entrada de mercancía actualizando lote con fecha a 2 años en formato Mes/Año (sin alerta)
    const inTwoYears = new Date();
    inTwoYears.setFullYear(inTwoYears.getFullYear() + 2);
    const expDateTwoYears = inTwoYears.toISOString().slice(0, 7);

    const entryRes = await registerEntry.execute(adminActor, {
      productId: productWithExp.id,
      receivedQuantity: 20,
      unitPurchasePrice: 42,
      declaredSalePrice: 75,
      declaredEntryDate: new Date().toISOString().slice(0, 10),
      expirationDate: expDateTwoYears,
    });

    assertEquals(entryRes.product.expirationDate, expDateTwoYears);
    assertEquals(entryRes.entry.expirationDate, expDateTwoYears);

    tests.push({ name: 'Fecha de vencimiento en entradas y alerta preventiva', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Fecha de vencimiento en entradas y alerta preventiva', passed: false, durationMs: 0, error: err.message });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE INVENTARIO',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
