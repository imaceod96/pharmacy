import { CreateExpenseUseCase } from '../src/modules/expenses/application/CreateExpenseUseCase';
import { DeleteExpenseUseCase } from '../src/modules/expenses/application/DeleteExpenseUseCase';
import { ListExpensesUseCase } from '../src/modules/expenses/application/ListExpensesUseCase';
import { ExpenseType } from '../src/modules/expenses/domain/entities/ExpenseRecord';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { CreateCategoryUseCase } from '../src/modules/warehouse/application/CreateCategoryUseCase';
import { CreateMeasurementUnitUseCase } from '../src/modules/warehouse/application/CreateMeasurementUnitUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { GetWorkdayDetailUseCase } from '../src/modules/warehouse/application/GetWorkdayDetailUseCase';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { ProductRecord } from '../src/modules/warehouse/domain/entities/ProductRecord';
import { InventoryMovementRecord } from '../src/modules/warehouse/domain/entities/InventoryMovementRecord';
import { IndexedDbCategoryRepository } from '../src/modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbMeasurementUnitRepository } from '../src/modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbOperationLogRepository } from '../src/modules/core/infrastructure/IndexedDbOperationLogRepository';
import {
  adminActor,
  assert,
  assertEquals,
  cashierActor,
  createTestEngine,
  TestSuiteResult,
} from './testUtils';

export async function runExpensesTests(): Promise<TestSuiteResult> {
  const tests: { name: string; fn: () => Promise<void> }[] = [];
  const startSuite = Date.now();

  // Test 1: Registrar gasto manual operativo
  tests.push({
    name: '1. Registro de gasto manual operativo y cálculo de resumen acumulado',
    fn: async () => {
      const engine = await createTestEngine();
      const createExpense = new CreateExpenseUseCase(engine);
      const listExpenses = new ListExpensesUseCase(engine);

      const exp1 = await createExpense.execute(cashierActor, {
        type: ExpenseType.MANUAL,
        description: 'Pago de alquiler del local comercial',
        amount: 2500,
      });

      assertEquals(exp1.type, ExpenseType.MANUAL);
      assertEquals(exp1.amount, 2500);

      const exp2 = await createExpense.execute(adminActor, {
        type: ExpenseType.MANUAL,
        description: 'Pago de servicios públicos (electricidad)',
        amount: 450,
      });

      assertEquals(exp2.amount, 450);

      const data = await listExpenses.execute(adminActor);
      assertEquals(data.expenses.length, 2);
      assertEquals(data.summary.totalAmount, 2950);
      assertEquals(data.summary.totalManualExpenseAmount, 2950);
      assertEquals(data.summary.totalProductExpenseAmount, 0);
    },
  });

  // Test 2: Registrar autoconsumo de producto de inventario con descuento en almacén y Kardex
  tests.push({
    name: '2. Autoconsumo de mercancía: descuenta stock de almacén, atribuye costo FIFO y registra salida en Kardex',
    fn: async () => {
      const engine = await createTestEngine();
      const catRepo = new IndexedDbCategoryRepository(engine);
      const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
      const logRepo = new IndexedDbOperationLogRepository(engine);

      const createCategory = new CreateCategoryUseCase(catRepo, logRepo);
      const createUnit = new CreateMeasurementUnitUseCase(unitRepo, logRepo);
      const registerProd = new RegisterProductWithInitialEntryUseCase(engine);
      const createExpense = new CreateExpenseUseCase(engine);
      const listExpenses = new ListExpensesUseCase(engine);

      const cat = await createCategory.execute(adminActor, { name: 'Bebidas' });
      const unit = await createUnit.execute(adminActor, { name: 'Pieza' });

      // Crear producto con 20 unidades a $15 de costo de compra
      const product = await registerProd.execute(adminActor, {
        name: 'Agua Embotellada 500ml',
        categoryId: cat.id,
        measurementUnitId: unit.id,
        initialQuantity: 20,
        unitPurchasePrice: 15,
        declaredSalePrice: 25,
      });

      assertEquals(product.currentStock, 20);

      // Consumir 3 unidades como gasto/autoconsumo
      const exp = await createExpense.execute(cashierActor, {
        type: ExpenseType.INVENTORY_PRODUCT,
        productId: product.id,
        quantity: 3,
        description: 'Consumo propio en mostrador',
      });

      assertEquals(exp.type, ExpenseType.INVENTORY_PRODUCT);
      assertEquals(exp.quantity, 3);
      assertEquals(exp.amount, 45); // 3 * $15 = $45
      assertEquals(exp.unitCost, 15);

      // Verificar que las existencias del almacén disminuyeron a 17
      const updatedProd = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
        tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, product.id)
      );
      assertEquals(updatedProd?.currentStock, 17);

      // Verificar que existe movimiento en Kardex
      const movements = await engine.runTransaction([StoreName.WAREHOUSE_INVENTORY_MOVEMENTS], 'readonly', (tx) =>
        tx.getAll<InventoryMovementRecord>(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS)
      );
      const expenseMov = movements.find((m) => m.productId === product.id && m.reason === 'GASTO_AUTOCONSUMO');
      assert(Boolean(expenseMov), 'Debe existir un movimiento Kardex con motivo GASTO_AUTOCONSUMO');
      assertEquals(expenseMov?.resultingStock, 17);

      const listData = await listExpenses.execute(adminActor);
      assertEquals(listData.summary.totalProductExpenseAmount, 45);
      assertEquals(listData.summary.totalAmount, 45);
    },
  });

  // Test 3: Permisos de acceso (ADMIN y CASHIER pueden registrar gastos)
  tests.push({
    name: '3. Control de acceso: Tanto Administrador como Cajero pueden registrar gastos',
    fn: async () => {
      const engine = await createTestEngine();
      const createExpense = new CreateExpenseUseCase(engine);

      const expCashier = await createExpense.execute(cashierActor, {
        type: ExpenseType.MANUAL,
        description: 'Compra de bolsas de empaque',
        amount: 80,
      });
      assert(Boolean(expCashier.id), 'Cajero debe poder registrar gastos');

      const expAdmin = await createExpense.execute(adminActor, {
        type: ExpenseType.MANUAL,
        description: 'Mantenimiento de caja',
        amount: 150,
      });
      assert(Boolean(expAdmin.id), 'ADMIN debe poder registrar gastos');
    },
  });

  // Test 4: Anulación de gasto de producto con restitución de existencias
  tests.push({
    name: '4. Anulación de gasto por mercancía: restituye existencias en almacén',
    fn: async () => {
      const engine = await createTestEngine();
      const catRepo = new IndexedDbCategoryRepository(engine);
      const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
      const logRepo = new IndexedDbOperationLogRepository(engine);

      const createCategory = new CreateCategoryUseCase(catRepo, logRepo);
      const createUnit = new CreateMeasurementUnitUseCase(unitRepo, logRepo);
      const registerProd = new RegisterProductWithInitialEntryUseCase(engine);
      const createExpense = new CreateExpenseUseCase(engine);
      const deleteExpense = new DeleteExpenseUseCase(engine);

      const cat = await createCategory.execute(adminActor, { name: 'Abarrotes' });
      const unit = await createUnit.execute(adminActor, { name: 'Pieza' });

      const product = await registerProd.execute(adminActor, {
        name: 'Snack de Papas 100g',
        categoryId: cat.id,
        measurementUnitId: unit.id,
        initialQuantity: 10,
        unitPurchasePrice: 12,
        declaredSalePrice: 20,
      });

      const exp = await createExpense.execute(adminActor, {
        type: ExpenseType.INVENTORY_PRODUCT,
        productId: product.id,
        quantity: 2,
      });

      let prodCheck = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
        tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, product.id)
      );
      assertEquals(prodCheck?.currentStock, 8);

      // Anular gasto
      await deleteExpense.execute(adminActor, exp.id);

      prodCheck = await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', (tx) =>
        tx.get<ProductRecord>(StoreName.WAREHOUSE_PRODUCTS, product.id)
      );
      assertEquals(prodCheck?.currentStock, 10);
    },
  });

  // Test 5: Integración en expediente de jornada e impacto en Ganancia Neta Ajustada
  tests.push({
    name: '5. Expediente de jornada: descuenta gastos del resultado financiero (Ganancia Neta Ajustada)',
    fn: async () => {
      const engine = await createTestEngine();
      const openWorkday = new OpenWorkdayUseCase(engine);
      const createExpense = new CreateExpenseUseCase(engine);
      const getWorkdayDetail = new GetWorkdayDetailUseCase(engine);

      const openRes = await openWorkday.execute(adminActor, { notes: 'Jornada de prueba gastos' });

      await createExpense.execute(cashierActor, {
        type: ExpenseType.MANUAL,
        description: 'Limpieza e insumos',
        amount: 200,
      });

      const detail = await getWorkdayDetail.execute(adminActor, openRes.workday.id);
      assert(Boolean(detail.expensesSummary), 'El expediente debe incluir resumen de gastos');
      assertEquals(detail.expensesSummary?.totalAmount, 200);
      assertEquals(detail.adjustedNetProfit, -200); // 0 ventas - 200 gastos = -200
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
    name: 'PRUEBAS DEL MÓDULO DE GASTOS Y DEDUCCIÓN DIARIA',
    tests: suiteResults,
    total: tests.length,
    passed: passedCount,
    failed: failedCount,
    durationMs: Date.now() - startSuite,
  };
}
