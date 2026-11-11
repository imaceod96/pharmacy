import {
  adminActor,
  assertEquals,
  assertRejects,
  createTestEngine,
  TestResult,
  TestSuiteResult,
} from './testUtils';
import { CreateOpenSaleAccountUseCase } from '../src/modules/sales/application/CreateOpenSaleAccountUseCase';
import { UpdateOpenSaleAccountUseCase } from '../src/modules/sales/application/UpdateOpenSaleAccountUseCase';
import { CancelOpenSaleAccountUseCase } from '../src/modules/sales/application/CancelOpenSaleAccountUseCase';
import { DispatchSaleUseCase } from '../src/modules/sales/application/DispatchSaleUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../src/modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { OpenWorkdayUseCase } from '../src/modules/warehouse/application/OpenWorkdayUseCase';
import { UpdateProductSalePriceUseCase } from '../src/modules/warehouse/application/UpdateProductSalePriceUseCase';
import { RegisterMerchandiseEntryUseCase } from '../src/modules/warehouse/application/RegisterMerchandiseEntryUseCase';
import { GetOpenSaleDetailUseCase } from '../src/modules/sales/application/GetOpenSaleDetailUseCase';
import { IndexedDbSaleRepository } from '../src/modules/sales/infrastructure/IndexedDbSaleRepository';
import { StoreName } from '../src/shared/lib/indexeddb/schema';
import { SaleStatus } from '../src/modules/sales/domain/entities/SaleRecord';

export async function runSalesTests(): Promise<TestSuiteResult> {
  const tests: TestResult[] = [];
  const startSuiteTime = Date.now();

  // Test 1: Cuentas OPEN, partidas, cancelación y ausencia de movimientos de stock
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const updateAccount = new UpdateOpenSaleAccountUseCase(engine);
    const cancelAccount = new CancelOpenSaleAccountUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Alimentos', normalizedName: 'ALIMENTOS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Sabritas Sal 100g',
      sku: 'SKU-SAB-100',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 50,
      unitPurchasePrice: 12,
      declaredSalePrice: 20,
    });

    // 1. Crear cuenta OPEN
    const createdAccount = await createAccount.execute(adminActor, {
      accountName: 'Mesa 1',
      items: [{ productId: p1.id, quantity: 2 }],
    });

    assertEquals(createdAccount.sale.status, SaleStatus.OPEN);
    assertEquals(createdAccount.sale.totalAmount, 40);

    // Verificar que SÍ hay descuento inmediato de existencias y movimiento de stock al crear la cuenta OPEN
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS, StoreName.WAREHOUSE_INVENTORY_MOVEMENTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p1.id);
      assertEquals(p.currentStock, 48, 'Descuento inmediato de stock al agregar a cuenta OPEN (50 - 2 = 48)');
      const movs = await tx.getAll(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS);
      const saleMovs = movs.filter((m: any) => m.originOperationId === createdAccount.sale.id);
      assertEquals(saleMovs.length, 1, 'Movimiento de salida generado al crear cuenta OPEN');
    });

    // 2. Modificar partidas de la cuenta (aumentar a 5 piezas -> stock baja a 45)
    const updatedAccount = await updateAccount.execute(adminActor, {
      saleId: createdAccount.sale.id,
      accountName: 'Mesa 1 Especial',
      items: [{ productId: p1.id, quantity: 5 }],
    });
    assertEquals(updatedAccount.sale.totalAmount, 100);

    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p1.id);
      assertEquals(p.currentStock, 45, 'Stock actualizado tras modificar cuenta OPEN (50 - 5 = 45)');
    });

    // 3. Cancelar cuenta con motivo -> las existencias se devuelven al almacén
    const cancelledAccount = await cancelAccount.execute(adminActor, {
      saleId: createdAccount.sale.id,
      reason: 'Cliente se retiró',
    });
    assertEquals(cancelledAccount.sale.status, SaleStatus.CANCELLED);

    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p1.id);
      assertEquals(p.currentStock, 50, 'Restauración completa de existencias en almacén al cancelar cuenta abierta');
    });

    tests.push({ name: 'Cuentas OPEN: descuento inmediato, actualización y restitución al cancelar', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Cuentas OPEN: descuento inmediato, actualización y restitución al cancelar', passed: false, durationMs: 0, error: err.message });
  }

  // Test 2: Despacho directo, despacho de cuenta abierta, asociación con workdayId e idempotencia
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Bebidas', normalizedName: 'BEBIDAS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const workday = await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Jugo de Naranja 500ml',
      sku: 'SKU-JUGO-500',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 20,
      unitPurchasePrice: 15,
      declaredSalePrice: 30,
    });

    // 1. Despacho directo
    const directDispatch = await dispatchSale.execute(adminActor, {
      items: [{ productId: p1.id, quantity: 4 }],
    });

    assertEquals(directDispatch.sale.status, SaleStatus.DISPATCHED);
    assertEquals(directDispatch.sale.dispatchedWorkdayId, workday.workday.id);
    assertEquals(directDispatch.updatedProducts[0].currentStock, 16); // 20 - 4 = 16

    // 2. Despacho de cuenta abierta
    const openAcc = await createAccount.execute(adminActor, {
      accountName: 'Barra',
      items: [{ productId: p1.id, quantity: 6 }],
    });

    const dispatchedAcc = await dispatchSale.execute(adminActor, {
      saleId: openAcc.sale.id,
      items: [{ productId: p1.id, quantity: 6 }],
    });

    assertEquals(dispatchedAcc.sale.status, SaleStatus.DISPATCHED);
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const p = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p1.id);
      assertEquals(p.currentStock, 10, 'Existencia correcta tras despacho de cuenta (16 - 6 = 10)');
    });

    // 3. Prevención de doble despacho (cuenta ya despachada)
    await assertRejects(
      () => dispatchSale.execute(adminActor, {
        saleId: openAcc.sale.id,
        items: [{ productId: p1.id, quantity: 6 }],
      }),
      'ya fue despachada',
      'Rechazar re-despacho'
    );

    tests.push({ name: 'Despacho directo, despacho de cuenta OPEN, asociación con jornada e idempotencia', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Despacho directo, despacho de cuenta OPEN, asociación con jornada e idempotencia', passed: false, durationMs: 0, error: err.message });
  }

  // Test 3: Rechazo por stock insuficiente
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Bebidas', normalizedName: 'BEBIDAS', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Cerveza Artesanal 355ml',
      sku: 'SKU-CERV',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 3,
      unitPurchasePrice: 25,
      declaredSalePrice: 60,
    });

    await assertRejects(
      () => dispatchSale.execute(adminActor, {
        items: [{ productId: p1.id, quantity: 10 }],
      }),
      'insuficientes',
      'Rechazar despacho por exceder stock disponible'
    );

    tests.push({ name: 'Rechazo por stock insuficiente', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Rechazo por stock insuficiente', passed: false, durationMs: 0, error: err.message });
  }

  // Test 4: REGLA ESPECIAL DE PRECIOS
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);
    const updateSalePrice = new UpdateProductSalePriceUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'Generales', normalizedName: 'GENERALES', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Producto A - Bloqueado',
      sku: 'SKU-PROD-A',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 100,
      unitPurchasePrice: 10,
      declaredSalePrice: 20,
    });

    const p2 = await registerProduct.execute(adminActor, {
      name: 'Producto B - Libre',
      sku: 'SKU-PROD-B',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 100,
      unitPurchasePrice: 15,
      declaredSalePrice: 30,
    });

    // Crear cuenta OPEN que contiene p1
    const openAcc = await createAccount.execute(adminActor, {
      accountName: 'Cuenta con Producto A',
      items: [{ productId: p1.id, quantity: 2 }],
    });

    // 1. p2 NO está en cuentas OPEN => Debe poder cambiar de precio normalmente
    const updateP2Res = await updateSalePrice.execute(adminActor, {
      productId: p2.id,
      newSalePrice: 35,
      reason: 'Ajuste de precio para Producto B',
    });
    assertEquals(updateP2Res.product.currentSalePrice, 35);

    // 2. p1 SÍ está en cuenta OPEN => Intentar cambiar su precio DEBE fallar con ValidationError de cuenta abierta
    await assertRejects(
      () => updateSalePrice.execute(adminActor, {
        productId: p1.id,
        newSalePrice: 25,
        reason: 'Intento de cambio de precio bloqueado',
      }),
      'no puede modificarse porque está incluido en las cuentas abiertas',
      'Bloqueo individual de precio por presencia en cuenta OPEN'
    );

    // 3. Despachar la cuenta OPEN que contiene p1
    await dispatchSale.execute(adminActor, {
      saleId: openAcc.sale.id,
      items: [{ productId: p1.id, quantity: 2 }],
    });

    // 4. Ahora que p1 ya no está en ninguna cuenta OPEN => Su precio DEBE poder cambiar normalmente
    const updateP1Res = await updateSalePrice.execute(adminActor, {
      productId: p1.id,
      newSalePrice: 25,
      reason: 'Ajuste de precio para Producto A tras cerrar cuenta OPEN',
    });
    assertEquals(updateP1Res.product.currentSalePrice, 25);

    tests.push({ name: 'REGLA ESPECIAL DE PRECIOS: Bloqueo de precio individual por cuentas OPEN', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'REGLA ESPECIAL DE PRECIOS: Bloqueo de precio individual por cuentas OPEN', passed: false, durationMs: 0, error: err.message });
  }

  // Test 5: Auditoría Central de Ventas y Reintentos Idempotentes (HALLAZGO-03)
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const updateAccount = new UpdateOpenSaleAccountUseCase(engine);
    const cancelAccount = new CancelOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Papas Fritas 150g',
      sku: 'SKU-PAPAS',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 50,
      unitPurchasePrice: 15,
      declaredSalePrice: 25,
    });

    // 1. Crear cuenta con operationId explícito
    const opId1 = 'op-create-123';
    const acc1 = await createAccount.execute(adminActor, {
      accountName: 'Mesa Auditoría',
      items: [{ productId: p1.id, quantity: 2 }],
      operationId: opId1,
    });

    // 2. Modificar cuenta con operationId explícito
    const opId2 = 'op-update-456';
    const updated1 = await updateAccount.execute(adminActor, {
      saleId: acc1.sale.id,
      items: [{ productId: p1.id, quantity: 3 }],
      operationId: opId2,
    });

    // Reintento idempotente de actualización con opId2
    const retryUpdate = await updateAccount.execute(adminActor, {
      saleId: acc1.sale.id,
      items: [{ productId: p1.id, quantity: 3 }],
      operationId: opId2,
    });
    assertEquals(retryUpdate.isDuplicate, true, 'Reintento de actualización es marcado como duplicado');

    // 3. Cancelar cuenta con operationId explícito
    const opId3 = 'op-cancel-789';
    await cancelAccount.execute(adminActor, {
      saleId: acc1.sale.id,
      reason: 'Cancelado para prueba de auditoría',
      operationId: opId3,
    });

    // Reintento idempotente de cancelación con opId3
    const retryCancel = await cancelAccount.execute(adminActor, {
      saleId: acc1.sale.id,
      reason: 'Cancelado para prueba de auditoría',
      operationId: opId3,
    });
    assertEquals(retryCancel.isDuplicate, true, 'Reintento de cancelación es marcado como duplicado');

    // 4. Despacho directo con operationId explícito
    const opId4 = 'op-dispatch-101';
    await dispatchSale.execute(adminActor, {
      items: [{ productId: p1.id, quantity: 1 }],
      operationId: opId4,
    });

    // Comprobar que en OPERATION_HISTORY figuran los registros atómicos correspondientes
    let auditLogs: any[] = [];
    await engine.runTransaction([StoreName.OPERATION_HISTORY], 'readonly', async (tx) => {
      auditLogs = await tx.getAll(StoreName.OPERATION_HISTORY);
    });

    const createAudit = auditLogs.find((l: any) => l.id === opId1);
    const updateAudit = auditLogs.find((l: any) => l.id === opId2);
    const cancelAudit = auditLogs.find((l: any) => l.id === opId3);
    const dispatchAudit = auditLogs.find((l: any) => l.id === opId4);

    assertEquals(Boolean(createAudit), true, 'Registro de auditoría para creación existente');
    assertEquals(createAudit.action, 'CREATE_OPEN_SALE_ACCOUNT');

    assertEquals(Boolean(updateAudit), true, 'Registro de auditoría para actualización existente');
    assertEquals(updateAudit.action, 'UPDATE_OPEN_SALE_ACCOUNT');

    assertEquals(Boolean(cancelAudit), true, 'Registro de auditoría para cancelación existente');
    assertEquals(cancelAudit.action, 'CANCEL_OPEN_SALE_ACCOUNT');

    assertEquals(Boolean(dispatchAudit), true, 'Registro de auditoría para despacho directo existente');
    assertEquals(dispatchAudit.action, 'DISPATCH_DIRECT_SALE');

    // Comprobar que no hay duplicados de auditoría para opId2 y opId3
    const countOp2 = auditLogs.filter((l: any) => l.id === opId2).length;
    assertEquals(countOp2, 1, 'Exactamente 1 registro de auditoría para opId2');

    tests.push({ name: 'Auditoría Central de Ventas e Idempotencia (HALLAZGO-03)', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Auditoría Central de Ventas e Idempotencia (HALLAZGO-03)', passed: false, durationMs: 0, error: err.message });
  }

  // Test 6: Desglose de forma de pago (Transferencia vs. Efectivo) y cálculo de Efectivo Esperado en Caja
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);
    const getWorkdayDetail = new (await import('../src/modules/warehouse/application/GetWorkdayDetailUseCase')).GetWorkdayDetailUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    const wRes = await openWorkday.execute(adminActor, {});

    const p1 = await registerProduct.execute(adminActor, {
      name: 'Refresco 600ml',
      sku: 'SKU-REFR-600',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 100,
      unitPurchasePrice: 10,
      declaredSalePrice: 25,
    });

    // 1. Rechazo de transferencia mayor al total ($100 total vs $150 transferencia)
    await assertRejects(
      () => dispatchSale.execute(adminActor, {
        items: [{ productId: p1.id, quantity: 4 }], // total = 100
        transferAmount: 150,
      }),
      'no puede ser mayor al importe total',
      'Rechazar monto por transferencia mayor al total'
    );

    // 2. Despacho exitoso con transferencia parcial ($100 total: $40 transferencia, $60 efectivo)
    const dispatch1 = await dispatchSale.execute(adminActor, {
      items: [{ productId: p1.id, quantity: 4 }], // total = 100
      transferAmount: 40,
    });
    assertEquals(dispatch1.sale.transferAmount, 40);
    assertEquals(dispatch1.sale.cashAmount, 60);

    // 3. Despacho 100% efectivo sin transferAmount especificado ($50 total: $0 transferencia, $50 efectivo)
    const dispatch2 = await dispatchSale.execute(adminActor, {
      items: [{ productId: p1.id, quantity: 2 }], // total = 50
    });
    assertEquals(dispatch2.sale.transferAmount, 0);
    assertEquals(dispatch2.sale.cashAmount, 50);

    // 4. Verificar métricas en GetWorkdayDetail
    const detail = await getWorkdayDetail.execute(adminActor, wRes.workday.id);
    assertEquals(detail.totalTransferSalesAmount, 40, 'Monto acumulado por transferencia en la jornada');
    assertEquals(detail.totalCashSalesAmount, 110, 'Monto acumulado en efectivo en la jornada (60 + 50 = 110)');
    assertEquals(detail.expectedCashInDrawer, 110, 'Efectivo esperado en caja (sin gastos manuales = 110)');

    tests.push({ name: 'Desglose de pago por Transferencia vs. Efectivo y Arqueo de Caja', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Desglose de pago por Transferencia vs. Efectivo y Arqueo de Caja', passed: false, durationMs: 0, error: err.message });
  }

  // Test 7: Cuenta abierta con stock 0 en almacén no bloquea despacho y reconoce nueva entrada de mercancía
  try {
    const start = Date.now();
    const engine = await createTestEngine();
    const registerProduct = new RegisterProductWithInitialEntryUseCase(engine);
    const openWorkday = new OpenWorkdayUseCase(engine);
    const createAccount = new CreateOpenSaleAccountUseCase(engine);
    const updateAccount = new UpdateOpenSaleAccountUseCase(engine);
    const dispatchSale = new DispatchSaleUseCase(engine);
    const saleRepo = new IndexedDbSaleRepository(engine);
    const getOpenSaleDetail = new GetOpenSaleDetailUseCase(saleRepo, engine);
    const registerEntry = new RegisterMerchandiseEntryUseCase(engine);

    await engine.runTransaction([StoreName.WAREHOUSE_CATEGORIES, StoreName.WAREHOUSE_UNITS], 'readwrite', async (tx) => {
      await tx.insert(StoreName.WAREHOUSE_CATEGORIES, { id: 'cat-1', name: 'General', normalizedName: 'GENERAL', isSystemCategory: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await tx.insert(StoreName.WAREHOUSE_UNITS, { id: 'unit-1', name: 'Pieza', symbol: 'pza', normalizedName: 'PIEZA', precisionDigits: 0, isSystemUnit: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });

    await openWorkday.execute(adminActor, {});

    const p = await registerProduct.execute(adminActor, {
      name: 'Galletas Chocochips',
      sku: 'SKU-GAL-001',
      categoryId: 'cat-1',
      measurementUnitId: 'unit-1',
      initialQuantity: 5,
      unitPurchasePrice: 15,
      declaredSalePrice: 30,
    });

    // 1. Abrir cuenta con los 5 productos disponibles (el stock del almacén baja a 0)
    const openAcc = await createAccount.execute(adminActor, {
      accountName: 'Mesa 10',
      items: [{ productId: p.id, quantity: 5 }],
    });

    // Verificar que en almacén el stock es 0
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const liveProd = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p.id);
      assertEquals(liveProd.currentStock, 0, 'El stock en almacén debe ser 0 tras abrir la cuenta');
    });

    // 2. Comprobar que GetOpenSaleDetail con sincronización NO bloquea el despacho de la cuenta
    const detail = await getOpenSaleDetail.executeWithCatalogSync(adminActor, openAcc.sale.id);
    assertEquals(detail?.hasBlockingIssues, false, 'No debe tener issues que bloqueen el despacho');
    assertEquals(detail?.lineSyncStatuses[0].blocksDispatch, false, 'La partida no debe bloquear el despacho');
    assertEquals(detail?.lineSyncStatuses[0].isOutOfStock, false, 'No debe marcarse como agotado para la cuenta');
    assertEquals(detail?.lineSyncStatuses[0].isInsufficientStock, false, 'No debe marcarse como insuficiente');

    // 3. Despachar la cuenta abierta con stock 0 en almacén debe funcionar perfectamente
    const dispatchRes = await dispatchSale.execute(adminActor, {
      saleId: openAcc.sale.id,
      items: (openAcc.sale.items ?? []).map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
    assertEquals(dispatchRes.sale.status, SaleStatus.DISPATCHED, 'La cuenta debe quedar despachada');

    // 4. Probar adición tras entrada de nueva mercancía
    // Ingresar 10 unidades nuevas de galletas al almacén
    await registerEntry.execute(adminActor, {
      productId: p.id,
      receivedQuantity: 10,
      unitPurchasePrice: 15,
      declaredSalePrice: 30,
      declaredEntryDate: new Date().toISOString().slice(0, 10),
    });

    // Crear cuenta con 4 unidades de las 10 recién ingresadas
    const openAcc2 = await createAccount.execute(adminActor, {
      accountName: 'Mesa 11',
      items: [{ productId: p.id, quantity: 4 }],
    });

    // El almacén debe reflejar 6 unidades restantes
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const liveProd = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p.id);
      assertEquals(liveProd.currentStock, 6, 'El stock en almacén debe ser 6 tras tomar 4');
    });

    // Actualizar la cuenta abierta aumentando de 4 a 6 (adición de 2 unidades)
    const updated = await updateAccount.execute(adminActor, {
      saleId: openAcc2.sale.id,
      items: [{ productId: p.id, quantity: 6 }],
    });
    assertEquals(updated.sale.items?.[0]?.quantity, 6, 'La cuenta debe tener 6 unidades');

    // El almacén debe reflejar 4 unidades restantes
    await engine.runTransaction([StoreName.WAREHOUSE_PRODUCTS], 'readonly', async (tx) => {
      const liveProd = await tx.get<any>(StoreName.WAREHOUSE_PRODUCTS, p.id);
      assertEquals(liveProd.currentStock, 4, 'El stock en almacén debe ser 4');
    });

    // Intentar pedir 20 (más de lo que hay en almacén disponible: en cuenta 6 + almacén 4 = 10 max) debe rechazarse
    await assertRejects(
      () => updateAccount.execute(adminActor, {
        saleId: openAcc2.sale.id,
        items: [{ productId: p.id, quantity: 20 }],
      }),
      'supera las existencias disponibles',
      'Rechazar cantidad superior al stock disponible para adición'
    );

    tests.push({ name: 'Cuenta abierta con stock 0 en almacén no bloquea despacho y reconoce nueva entrada de mercancía', passed: true, durationMs: Date.now() - start });
  } catch (err: any) {
    tests.push({ name: 'Cuenta abierta con stock 0 en almacén no bloquea despacho y reconoce nueva entrada de mercancía', passed: false, durationMs: 0, error: err.message });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  return {
    name: 'PRUEBAS DE CUENTAS Y DESPACHOS',
    tests,
    total: tests.length,
    passed: passedCount,
    failed: tests.length - passedCount,
    durationMs: Date.now() - startSuiteTime,
  };
}
