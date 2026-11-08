export enum AppRouteKey {
  HOME = 'HOME',
  OPEN_SALES = 'OPEN_SALES',
  OPEN_SALE_DETAIL = 'OPEN_SALE_DETAIL',
  SALES_HISTORY = 'SALES_HISTORY',
  EXPENSES = 'EXPENSES',
  WAREHOUSE_PRODUCTS = 'WAREHOUSE_PRODUCTS',
  WAREHOUSE_PRODUCT_HISTORY = 'WAREHOUSE_PRODUCT_HISTORY',
  WAREHOUSE_INVENTORY_CUTS = 'WAREHOUSE_INVENTORY_CUTS',
  WAREHOUSE_WORKDAY_DETAIL = 'WAREHOUSE_WORKDAY_DETAIL',
  SETTINGS = 'SETTINGS',
}

export const ROUTES = {
  home: '/',
  openSales: '/ventas-abiertas',
  openSaleDetail: (saleId: string) => `/ventas-abiertas/${encodeURIComponent(saleId)}`,
  salesHistory: '/historial-ventas',
  expenses: '/gastos',
  warehouseProducts: '/almacen/productos',
  warehouseProductHistory: (productId: string) =>
    `/almacen/productos/${encodeURIComponent(productId)}/historial`,
  warehouseInventoryCuts: '/almacen/inventarios',
  warehouseWorkdayDetail: (workdayId: string) =>
    `/almacen/inventarios/jornada/${encodeURIComponent(workdayId)}`,
  settings: '/ajustes',
} as const;

export interface BreadcrumbItem {
  readonly label: string;
  readonly path?: string;
}

export type MatchedRoute =
  | { readonly key: AppRouteKey.HOME; readonly breadcrumbs: readonly BreadcrumbItem[] }
  | { readonly key: AppRouteKey.OPEN_SALES; readonly breadcrumbs: readonly BreadcrumbItem[] }
  | {
      readonly key: AppRouteKey.OPEN_SALE_DETAIL;
      readonly saleId: string;
      readonly breadcrumbs: readonly BreadcrumbItem[];
    }
  | { readonly key: AppRouteKey.SALES_HISTORY; readonly breadcrumbs: readonly BreadcrumbItem[] }
  | { readonly key: AppRouteKey.EXPENSES; readonly breadcrumbs: readonly BreadcrumbItem[] }
  | {
      readonly key: AppRouteKey.WAREHOUSE_PRODUCTS;
      readonly breadcrumbs: readonly BreadcrumbItem[];
    }
  | {
      readonly key: AppRouteKey.WAREHOUSE_PRODUCT_HISTORY;
      readonly productId: string;
      readonly breadcrumbs: readonly BreadcrumbItem[];
    }
  | {
      readonly key: AppRouteKey.WAREHOUSE_INVENTORY_CUTS;
      readonly breadcrumbs: readonly BreadcrumbItem[];
    }
  | {
      readonly key: AppRouteKey.WAREHOUSE_WORKDAY_DETAIL;
      readonly workdayId: string;
      readonly breadcrumbs: readonly BreadcrumbItem[];
    }
  | { readonly key: AppRouteKey.SETTINGS; readonly breadcrumbs: readonly BreadcrumbItem[] };

export function normalizeHashPath(rawHash: string): string {
  const withoutHash = rawHash.replace(/^#/, '').trim();
  if (!withoutHash || withoutHash === '/') return '/';
  const clean = withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

export function resolveRoute(path: string): MatchedRoute {
  if (path === ROUTES.home) {
    return {
      key: AppRouteKey.HOME,
      breadcrumbs: [{ label: 'Inicio' }],
    };
  }

  if (path === ROUTES.openSales) {
    return {
      key: AppRouteKey.OPEN_SALES,
      breadcrumbs: [{ label: 'Ventas abiertas' }],
    };
  }

  if (path.startsWith(`${ROUTES.openSales}/`)) {
    const rawSegment = path.slice(`${ROUTES.openSales}/`.length);
    const saleId = decodeURIComponent(rawSegment);
    return {
      key: AppRouteKey.OPEN_SALE_DETAIL,
      saleId,
      breadcrumbs: [
        { label: 'Ventas abiertas', path: ROUTES.openSales },
        { label: `Cuenta ${saleId}` },
      ],
    };
  }

  if (path === ROUTES.salesHistory) {
    return {
      key: AppRouteKey.SALES_HISTORY,
      breadcrumbs: [
        { label: 'Inicio', path: ROUTES.home },
        { label: 'Historial de ventas' },
      ],
    };
  }

  if (path === ROUTES.expenses) {
    return {
      key: AppRouteKey.EXPENSES,
      breadcrumbs: [{ label: 'Gastos' }],
    };
  }

  const productHistoryMatch = path.match(/^\/almacen\/productos\/([^/]+)\/historial$/);
  if (productHistoryMatch) {
    const productId = decodeURIComponent(productHistoryMatch[1]);
    return {
      key: AppRouteKey.WAREHOUSE_PRODUCT_HISTORY,
      productId,
      breadcrumbs: [
        { label: 'Almacén' },
        { label: 'Productos', path: ROUTES.warehouseProducts },
        { label: 'Historial del producto' },
      ],
    };
  }

  const workdayDetailMatch = path.match(/^\/almacen\/inventarios\/jornada\/([^/]+)$/);
  if (workdayDetailMatch) {
    const workdayId = decodeURIComponent(workdayDetailMatch[1]);
    return {
      key: AppRouteKey.WAREHOUSE_WORKDAY_DETAIL,
      workdayId,
      breadcrumbs: [
        { label: 'Almacén' },
        { label: 'Inventarios / Corte', path: ROUTES.warehouseInventoryCuts },
        { label: 'Expediente de jornada' },
      ],
    };
  }

  if (path === ROUTES.warehouseProducts) {
    return {
      key: AppRouteKey.WAREHOUSE_PRODUCTS,
      breadcrumbs: [{ label: 'Almacén' }, { label: 'Productos' }],
    };
  }

  if (path === ROUTES.warehouseInventoryCuts) {
    return {
      key: AppRouteKey.WAREHOUSE_INVENTORY_CUTS,
      breadcrumbs: [{ label: 'Almacén' }, { label: 'Inventarios / Corte' }],
    };
  }

  if (path === ROUTES.settings) {
    return {
      key: AppRouteKey.SETTINGS,
      breadcrumbs: [{ label: 'Ajustes' }],
    };
  }

  return {
    key: AppRouteKey.HOME,
    breadcrumbs: [{ label: 'Inicio' }],
  };
}
