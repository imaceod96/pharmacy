import {
  adminActor,
  assertEquals,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { CreatePartialCutUseCase } from '../src/modules/warehouse/application/CreatePartialCutUseCase';
import { RecordPartialCutCountUseCase } from '../src/modules/warehouse/application/RecordPartialCutCountUseCase';
import { ProceedToPartialCutReviewUseCase } from '../src/modules/warehouse/application/ProceedToPartialCutReviewUseCase';
import { ApprovePartialCutUseCase } from '../src/modules/warehouse/application/ApprovePartialCutUseCase';
import { PrepareFinalInventorySelectionUseCase } from '../src/modules/warehouse/application/PrepareFinalInventorySelectionUseCase';
import { StartWorkdayClosingUseCase } from '../src/modules/warehouse/application/StartWorkdayClosingUseCase';
import { ApproveWorkdayClosingUseCase } from '../src/modules/warehouse/application/ApproveWorkdayClosingUseCase';
import { RectifyWorkdayClosingUseCase } from '../src/modules/warehouse/application/RectifyWorkdayClosingUseCase';
import { MorningStockVerificationUseCase } from '../src/modules/warehouse/application/MorningStockVerificationUseCase';
import { IndexedDbCommercialActivityAdapter } from '../src/modules/warehouse/infrastructure/IndexedDbCommercialActivityAdapter';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { sessionElevationService } from '../src/shared/lib/security/SessionElevationService';

export async function runCutsAndInventoryTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Corte parcial, conteo ciego, conciliación y ajuste de stock
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const openWorkday = new OpenWorkdayUseCase(engine);
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    const commercialAdapter = new IndexedDbCommercialActivityAdapter(engine);
    const createCut = new CreatePartialCutUseCase(engine, commercialAdapter);
    const recordCount = new RecordPartialCutCountUseCase(engine);
    const proceedReview = new ProceedToPartialCutReviewUseCase(engine);
    const approveCut = new ApprovePartialCutUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const prod = await registerProduct.execute(adminActor, {
      name: 'Galletas de Avena',
      sku: 'SKU-GAL-AVENA',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 40,
      unitPurchasePrice: 15,
      declaredSalePrice: 25,
    });

    await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 10 }],
    }); // Stock teórico en sistema = 30

    // Crear corte parcial (selección automática por actividad comercial)
    const cutRecord = await createCut.execute(adminActor, {
      notes: 'Corte parcial de mediodía',
    });

    const targetProductId = cutRecord.items[0].productId;

    // Registrar conteo ciego (se contaron 28 físicas -> Faltante de 2)
    await recordCount.execute(adminActor, {
      cutId: cutRecord.id,
      productId: targetProductId,
      countedQuantity: 28,
    });

    await proceedReview.execute(adminActor, { cutId: cutRecord.id });

    // Aprobar corte parcial (se envía motivo obligatorio por diferencia de -2)
    const approvedCutResult = await approveCut.execute(adminActor, {
      cutId: cutRecord.id,
      differenceReasons: { [targetProductId]: 'Faltante detectado en anaquel' },
    });
    assertEquals(approvedCutResult.cut.status as string, 'APPROVED');

    // Verificar que el stock actual en almacén se ajustó a 28
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, targetProductId);
      assertEquals(p.currentStock, 28, 'Stock actualizado a 28 tras aprobar el corte');
    });

    tests.push({ name: 'Corte parcial, conteo ciego, conciliación y ajuste por diferencia', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Corte parcial, conteo ciego, conciliación y ajuste por diferencia', passed: false, durationMs: 0, error: err.message });
  }

  // Test 2: Inventario final y rectificación de jornada cerrada con conservación de versiones
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const openWorkday = new OpenWorkdayUseCase(engine);
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    const commercialAdapter = new IndexedDbCommercialActivityAdapter(engine);
    const prepareFinalInv = new PrepareFinalInventorySelectionUseCase(engine, commercialAdapter);
    const startClosing = new StartWorkdayClosingUseCase(engine, prepareFinalInv);
    const approveClosing = new ApproveWorkdayClosingUseCase(engine);
    const rectifyClosing = new RectifyWorkdayClosingUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const w1 = await openWorkday.execute(adminActor, {});

    const prod = await registerProduct.execute(adminActor, {
      name: 'Atún en Agua 140g',
      sku: 'SKU-ATUN',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 100,
      unitPurchasePrice: 18,
      declaredSalePrice: 28,
    });

    await dispatchSale.execute(adminActor, {
      items: [{ productId: prod.id, quantity: 20 }],
    }); // Stock esperado = 80

    await startClosing.execute(adminActor, { workdayId: w1.workday.id });

    // Cierre inicial con conteo físico 80
    await approveClosing.execute(adminActor, {
      workdayId: w1.workday.id,
      counts: { [prod.id]: 80 },
      differenceReasons: {},
      notes: 'Cierre inicial',
    });

    // Rectificación de la jornada cerrada (conteo corregido a 78 por lata dañada)
    const rectRes = await rectifyClosing.execute(adminActor, {
      workdayId: w1.workday.id,
      counts: { [prod.id]: 78 },
      differenceReasons: { [prod.id]: 'Lata dañada en estante posterior' },
      reason: 'Rectificación por lata dañada en estante posterior',
      criticalToken: sessionElevationService.issueCriticalToken(adminActor, 'RECTIFY_WORKDAY'),
    });

    assertEquals(rectRes.rectification.versionNumber, 1);
    assertEquals(rectRes.rectification.workdayId, w1.workday.id);

    // Verificar que el stock final en almacén se actualizó a 78
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS, StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, prod.id);
      assertEquals(p.currentStock, 78, 'Stock actualizado a 78 tras rectificación');

      const rects = await tx.getAllByIndex(StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS, 'by_workday_id', w1.workday.id);
      assertEquals(rects.length, 1, 'Registro de versión de rectificación almacenado');
    });

    tests.push({ name: 'Inventario final y rectificación de jornada cerrada con auditoría de versiones', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Inventario final y rectificación de jornada cerrada con auditoría de versiones', passed: false, durationMs: 0, error: err.message });
  }

  // Test 3: Verificación Matutina de Existencias (antes de abrir jornada, modalidad auditoría y ajuste de stock)
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const morningVerification = new MorningStockVerificationUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Snacks', normalizedName: 'SNACKS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const prodA = await registerProduct.execute(adminActor, {
      name: 'Galletas Chocolate',
      sku: 'SKU-GAL-01',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 25,
      unitPurchasePrice: 8,
      declaredSalePrice: 15,
    });

    // 1. Conteo matutino en modo AUDIT_ONLY sin jornada iniciada
    const auditRecord = await morningVerification.execute(adminActor, {
      mode: 'AUDIT_ONLY',
      counts: [{ productId: prodA.id, countedStock: 23 }],
      notes: 'Conteo matutino previo a turno',
    });

    assertEquals(auditRecord.mode, 'AUDIT_ONLY');
    assertEquals(auditRecord.differencesCount, 1);
    assertEquals(auditRecord.items[0].systemStock, 25);
    assertEquals(auditRecord.items[0].countedStock, 23);
    assertEquals(auditRecord.items[0].difference, -2);
    assertEquals(auditRecord.items[0].isAdjusted, false);

    // En modo AUDIT_ONLY el stock permanece intacto en 25
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, prodA.id);
      assertEquals(p.currentStock, 25, 'Stock no modificado en modo AUDIT_ONLY');
    });

    // 2. Conteo matutino en modo ADJUST_STOCK con aplicación de diferencias
    const adjustRecord = await morningVerification.execute(adminActor, {
      mode: 'ADJUST_STOCK',
      counts: [{ productId: prodA.id, countedStock: 23, differenceReason: 'Paquetes rotos retirados de vitrina' }],
      notes: 'Ajuste matutino aprobado',
    });

    assertEquals(adjustRecord.mode, 'ADJUST_STOCK');
    assertEquals(adjustRecord.items[0].isAdjusted, true);

    // En modo ADJUST_STOCK el stock se actualiza a 23 y se genera movimiento de Kardex
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS, StoreName.WAREHOUSE_INVENTORY_MOVEMENTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, prodA.id);
      assertEquals(p.currentStock, 23, 'Stock ajustado correctamente a 23');

      const movs = await tx.getAll<any>(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS);
      const adjMov = movs.find((m) => m.productId === prodA.id && m.movementType === 'MORNING_VERIFICATION_ADJUSTMENT');
      assertEquals(Boolean(adjMov), true, 'Movimiento de Kardex registrado por verificación matutina');
      assertEquals(adjMov?.quantity, 2);
      assertEquals(adjMov?.signedQuantity, -2);
    });

    tests.push({ name: 'Verificación matutina de existencias: modo auditoría y ajuste con Kardex', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Verificación matutina de existencias: modo auditoría y ajuste con Kardex', passed: false, durationMs: 0, error: err.message });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE CORTES E INVENTARIOS',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
