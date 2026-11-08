import { ReferentialIntegrityRule } from '../../types/repository';

export const DATABASE_NAME = 'establecimiento_comercial_local_db';
export const DATABASE_VERSION = 11;

export enum StoreName {
  SYSTEM_METADATA = 'system_metadata',
  OPERATION_HISTORY = 'operation_history',
  WAREHOUSE_PRODUCTS = 'warehouse_products',
  WAREHOUSE_CATEGORIES = 'warehouse_categories',
  WAREHOUSE_UNITS = 'warehouse_units',
  WAREHOUSE_MERCHANDISE_ENTRIES = 'warehouse_merchandise_entries',
  WAREHOUSE_INVENTORY_MOVEMENTS = 'warehouse_inventory_movements',
  WAREHOUSE_INVENTORY_CUTS = 'warehouse_inventory_cuts',
  WAREHOUSE_PRICE_CHANGES = 'warehouse_price_changes',
  WAREHOUSE_PRODUCT_STATUS_CHANGES = 'warehouse_product_status_changes',
  WAREHOUSE_WORKDAYS = 'warehouse_workdays',
  WAREHOUSE_COST_LAYERS = 'warehouse_cost_layers',
  WAREHOUSE_CLOSING_RECTIFICATIONS = 'warehouse_closing_rectifications',
  SALES_RECORDS = 'sales_records',
  EXPENSES = 'expenses',
}

export const ALL_BUSINESS_STORES: readonly StoreName[] = [
  StoreName.SYSTEM_METADATA,
  StoreName.OPERATION_HISTORY,
  StoreName.WAREHOUSE_CATEGORIES,
  StoreName.WAREHOUSE_UNITS,
  StoreName.WAREHOUSE_WORKDAYS,
  StoreName.WAREHOUSE_PRODUCTS,
  StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
  StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
  StoreName.WAREHOUSE_INVENTORY_CUTS,
  StoreName.WAREHOUSE_PRICE_CHANGES,
  StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
  StoreName.WAREHOUSE_COST_LAYERS,
  StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS,
  StoreName.SALES_RECORDS,
  StoreName.EXPENSES,
];

export interface DatabaseMigration {
  readonly version: number;
  readonly description: string;
  upgrade: (db: IDBDatabase, transaction: IDBTransaction) => void;
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    description: 'Estructura fundacional con metadatos, historial de operaciones y almacenes base.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.SYSTEM_METADATA)) {
        db.createObjectStore(StoreName.SYSTEM_METADATA, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(StoreName.OPERATION_HISTORY)) {
        const historyStore = db.createObjectStore(StoreName.OPERATION_HISTORY, { keyPath: 'id' });
        historyStore.createIndex('by_created_at', 'createdAt', { unique: false });
        historyStore.createIndex('by_module', 'module', { unique: false });
      }

      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_PRODUCTS)) {
        const productsStore = db.createObjectStore(StoreName.WAREHOUSE_PRODUCTS, { keyPath: 'id' });
        productsStore.createIndex('by_code', 'code', { unique: false });
        productsStore.createIndex('by_name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_INVENTORY_CUTS)) {
        const cutsStore = db.createObjectStore(StoreName.WAREHOUSE_INVENTORY_CUTS, { keyPath: 'id' });
        cutsStore.createIndex('by_reference', 'reference', { unique: true });
        cutsStore.createIndex('by_opened_at', 'openedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(StoreName.SALES_RECORDS)) {
        const salesStore = db.createObjectStore(StoreName.SALES_RECORDS, { keyPath: 'id' });
        salesStore.createIndex('by_folio', 'folio', { unique: true });
        salesStore.createIndex('by_status', 'status', { unique: false });
        salesStore.createIndex('by_opened_at', 'openedAt', { unique: false });
      }
    },
  },
  {
    version: 2,
    description:
      'Fase 2 Almacén: Categorías, unidades de medida, entradas de mercancía, movimientos de inventario e índices únicos normalizados.',
    upgrade: (db: IDBDatabase, transaction: IDBTransaction) => {
      // 1. Almacén de Categorías
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_CATEGORIES)) {
        const catStore = db.createObjectStore(StoreName.WAREHOUSE_CATEGORIES, { keyPath: 'id' });
        catStore.createIndex('by_normalized_name', 'normalizedName', { unique: true });
      }

      // 2. Almacén de Unidades de medida
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_UNITS)) {
        const unitStore = db.createObjectStore(StoreName.WAREHOUSE_UNITS, { keyPath: 'id' });
        unitStore.createIndex('by_normalized_name', 'normalizedName', { unique: true });
      }

      // 3. Almacén de Entradas de mercancía
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES)) {
        const entryStore = db.createObjectStore(StoreName.WAREHOUSE_MERCHANDISE_ENTRIES, {
          keyPath: 'id',
        });
        entryStore.createIndex('by_product_id', 'productId', { unique: false });
        entryStore.createIndex('by_registered_at', 'registeredAt', { unique: false });
      }

      // 4. Almacén de Movimientos de inventario
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS)) {
        const movementStore = db.createObjectStore(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS, {
          keyPath: 'id',
        });
        movementStore.createIndex('by_product_id', 'productId', { unique: false });
        movementStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        movementStore.createIndex('by_origin_operation_id', 'originOperationId', { unique: false });
      }

      // 5. Ajustar índices en almacén existente de Productos
      if (db.objectStoreNames.contains(StoreName.WAREHOUSE_PRODUCTS)) {
        const productStore = transaction.objectStore(StoreName.WAREHOUSE_PRODUCTS);
        if (!productStore.indexNames.contains('by_normalized_name')) {
          productStore.createIndex('by_normalized_name', 'normalizedName', { unique: true });
        }
        if (!productStore.indexNames.contains('by_sku')) {
          productStore.createIndex('by_sku', 'sku', { unique: true });
        }
        if (!productStore.indexNames.contains('by_category_id')) {
          productStore.createIndex('by_category_id', 'categoryId', { unique: false });
        }
        if (!productStore.indexNames.contains('by_status')) {
          productStore.createIndex('by_status', 'status', { unique: false });
        }
      }
    },
  },
  {
    version: 3,
    description:
      'Fase 4 Almacén: Historial de cambios de precios asociados a productos y nuevas entradas de mercancía.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_PRICE_CHANGES)) {
        const priceStore = db.createObjectStore(StoreName.WAREHOUSE_PRICE_CHANGES, {
          keyPath: 'id',
        });
        priceStore.createIndex('by_product_id', 'productId', { unique: false });
        priceStore.createIndex('by_changed_at', 'changedAt', { unique: false });
      }
    },
  },
  {
    version: 4,
    description:
      'Fase 5 Almacén: Historial de cambios de estado administrativo (activación y desactivación) de productos.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES)) {
        const statusStore = db.createObjectStore(StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES, {
          keyPath: 'id',
        });
        statusStore.createIndex('by_product_id', 'productId', { unique: false });
        statusStore.createIndex('by_changed_at', 'changedAt', { unique: false });
      }
    },
  },
  {
    version: 5,
    description:
      'Fase 8 Bloque 1 Almacén: Almacén de jornadas de inventario y estado operativo.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_WORKDAYS)) {
        const workdayStore = db.createObjectStore(StoreName.WAREHOUSE_WORKDAYS, {
          keyPath: 'id',
        });
        workdayStore.createIndex('by_status', 'status', { unique: false });
        workdayStore.createIndex('by_opened_at', 'openedAt', { unique: false });
        workdayStore.createIndex('by_code', 'code', { unique: true });
      }
    },
  },
  {
    version: 6,
    description:
      'Fase 8 Bloque 2 Almacén: Índices de cortes parciales de inventario por jornada, estado y fecha de creación.',
    upgrade: (db: IDBDatabase, transaction: IDBTransaction) => {
      let cutsStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_INVENTORY_CUTS)) {
        cutsStore = db.createObjectStore(StoreName.WAREHOUSE_INVENTORY_CUTS, { keyPath: 'id' });
      } else {
        cutsStore = transaction.objectStore(StoreName.WAREHOUSE_INVENTORY_CUTS);
      }

      if (!cutsStore.indexNames.contains('by_reference')) {
        cutsStore.createIndex('by_reference', 'reference', { unique: true });
      }
      if (!cutsStore.indexNames.contains('by_opened_at')) {
        cutsStore.createIndex('by_opened_at', 'openedAt', { unique: false });
      }
      if (!cutsStore.indexNames.contains('by_workday_id')) {
        cutsStore.createIndex('by_workday_id', 'workdayId', { unique: false });
      }
      if (!cutsStore.indexNames.contains('by_status')) {
        cutsStore.createIndex('by_status', 'status', { unique: false });
      }
      if (!cutsStore.indexNames.contains('by_created_at')) {
        cutsStore.createIndex('by_created_at', 'createdAt', { unique: false });
      }
    },
  },
  {
    version: 7,
    description:
      'Módulo de Ventas Bloque 1: Índices de cuentas abiertas, despachos por jornada y numeración consecutiva.',
    upgrade: (db: IDBDatabase, transaction: IDBTransaction) => {
      let salesStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(StoreName.SALES_RECORDS)) {
        salesStore = db.createObjectStore(StoreName.SALES_RECORDS, { keyPath: 'id' });
      } else {
        salesStore = transaction.objectStore(StoreName.SALES_RECORDS);
      }

      if (!salesStore.indexNames.contains('by_folio')) {
        salesStore.createIndex('by_folio', 'folio', { unique: true });
      }
      if (!salesStore.indexNames.contains('by_status')) {
        salesStore.createIndex('by_status', 'status', { unique: false });
      }
      if (!salesStore.indexNames.contains('by_opened_at')) {
        salesStore.createIndex('by_opened_at', 'openedAt', { unique: false });
      }
      if (!salesStore.indexNames.contains('by_workday_id')) {
        salesStore.createIndex('by_workday_id', 'workdayId', { unique: false });
      }
      if (!salesStore.indexNames.contains('by_dispatched_workday_id')) {
        salesStore.createIndex('by_dispatched_workday_id', 'dispatchedWorkdayId', {
          unique: false,
        });
      }
      if (!salesStore.indexNames.contains('by_dispatched_at')) {
        salesStore.createIndex('by_dispatched_at', 'dispatchedAt', { unique: false });
      }
      if (!salesStore.indexNames.contains('by_consecutive_number')) {
        salesStore.createIndex('by_consecutive_number', 'consecutiveNumber', { unique: false });
      }
    },
  },
  {
    version: 8,
    description:
      'Fase 8 Bloque 3 Almacén: Índices de movimientos de inventario por corte parcial y jornada para conciliación y ajustes aprobados.',
    upgrade: (db: IDBDatabase, transaction: IDBTransaction) => {
      if (db.objectStoreNames.contains(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS)) {
        const movementStore = transaction.objectStore(StoreName.WAREHOUSE_INVENTORY_MOVEMENTS);
        if (!movementStore.indexNames.contains('by_partial_cut_id')) {
          movementStore.createIndex('by_partial_cut_id', 'partialCutId', { unique: false });
        }
        if (!movementStore.indexNames.contains('by_workday_id')) {
          movementStore.createIndex('by_workday_id', 'workdayId', { unique: false });
        }
      }
    },
  },
  {
    version: 9,
    description:
      'Fase 8 Bloque 4 Almacén: Almacén de capas de costo de adquisición (ProductCostLayer) para cálculo FIFO de costo de mercancía despachada y ganancia bruta.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_COST_LAYERS)) {
        const costLayersStore = db.createObjectStore(StoreName.WAREHOUSE_COST_LAYERS, { keyPath: 'id' });
        costLayersStore.createIndex('by_product_id', 'productId', { unique: false });
        costLayersStore.createIndex('by_created_at', 'createdAt', { unique: false });
      }
    },
  },
  {
    version: 10,
    description:
      'Fase 8 Ampliación: Almacén de rectificaciones de inventario final para jornadas cerradas (warehouse_closing_rectifications).',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS)) {
        const rectStore = db.createObjectStore(StoreName.WAREHOUSE_CLOSING_RECTIFICATIONS, { keyPath: 'id' });
        rectStore.createIndex('by_workday_id', 'workdayId', { unique: false });
        rectStore.createIndex('by_created_at', 'createdAt', { unique: false });
      }
    },
  },
  {
    version: 11,
    description:
      'Módulo de Gastos Operativos (expenses). Registro de gastos manuales y autoconsumo de productos con deducción diaria.',
    upgrade: (db: IDBDatabase) => {
      if (!db.objectStoreNames.contains(StoreName.EXPENSES)) {
        const expensesStore = db.createObjectStore(StoreName.EXPENSES, { keyPath: 'id' });
        expensesStore.createIndex('by_workday_id', 'workdayId', { unique: false });
        expensesStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        expensesStore.createIndex('by_type', 'type', { unique: false });
      }
    },
  },
];

/**
 * Reglas declarativas de integridad referencial entre almacenes locales.
 * Se validan automáticamente en inserciones, modificaciones, eliminaciones y restauración de respaldos.
 */
export const REFERENTIAL_INTEGRITY_RULES: readonly ReferentialIntegrityRule[] = [
  {
    name: 'Producto -> Categoría',
    sourceStore: StoreName.WAREHOUSE_PRODUCTS,
    foreignKeyField: 'categoryId',
    targetStore: StoreName.WAREHOUSE_CATEGORIES,
    preventTargetDeletion: true,
  },
  {
    name: 'Producto -> Unidad de medida',
    sourceStore: StoreName.WAREHOUSE_PRODUCTS,
    foreignKeyField: 'measurementUnitId',
    targetStore: StoreName.WAREHOUSE_UNITS,
    preventTargetDeletion: true,
  },
  {
    name: 'Entrada de mercancía -> Producto',
    sourceStore: StoreName.WAREHOUSE_MERCHANDISE_ENTRIES,
    foreignKeyField: 'productId',
    targetStore: StoreName.WAREHOUSE_PRODUCTS,
    preventTargetDeletion: true,
  },
  {
    name: 'Movimiento de inventario -> Producto',
    sourceStore: StoreName.WAREHOUSE_INVENTORY_MOVEMENTS,
    foreignKeyField: 'productId',
    targetStore: StoreName.WAREHOUSE_PRODUCTS,
    preventTargetDeletion: true,
  },
  {
    name: 'Cambio de precio -> Producto',
    sourceStore: StoreName.WAREHOUSE_PRICE_CHANGES,
    foreignKeyField: 'productId',
    targetStore: StoreName.WAREHOUSE_PRODUCTS,
    preventTargetDeletion: true,
  },
  {
    name: 'Cambio de estado -> Producto',
    sourceStore: StoreName.WAREHOUSE_PRODUCT_STATUS_CHANGES,
    foreignKeyField: 'productId',
    targetStore: StoreName.WAREHOUSE_PRODUCTS,
    preventTargetDeletion: true,
  },
  {
    name: 'Corte parcial -> Jornada',
    sourceStore: StoreName.WAREHOUSE_INVENTORY_CUTS,
    foreignKeyField: 'workdayId',
    targetStore: StoreName.WAREHOUSE_WORKDAYS,
    preventTargetDeletion: true,
  },
  {
    name: 'Capa de costo -> Producto',
    sourceStore: StoreName.WAREHOUSE_COST_LAYERS,
    foreignKeyField: 'productId',
    targetStore: StoreName.WAREHOUSE_PRODUCTS,
    preventTargetDeletion: true,
  },
];
