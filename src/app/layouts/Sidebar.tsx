import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Home,
  Package,
  Plus,
  ReceiptText,
  Settings,
  Store,
  TrendingDown,
  X,
} from 'lucide-react';
import { formatSaleDisplayLabel } from '../../modules/sales/domain/entities/SaleRecord';
import { validateActiveWorkdayForSales } from '../../modules/warehouse/domain/entities/WorkdayRecord';
import { OutOfStockAlertModal } from '../../modules/warehouse/presentation/components/OutOfStockAlertModal';
import { useAsyncQuery } from '../../shared/hooks/useAsyncQuery';
import { ROLE_LABELS } from '../../shared/lib/permissions/rolePolicy';
import { Permission, UserRole } from '../../shared/types/permissions';
import { useApplication } from '../providers/ApplicationProvider';
import { useSession } from '../providers/SessionProvider';
import { AppRouteKey, ROUTES } from '../router/routes';
import { useRouter } from '../router/RouterProvider';

export interface SidebarProps {
  readonly isMobileOpen: boolean;
  readonly onCloseMobile: () => void;
}

export function Sidebar({ isMobileOpen, onCloseMobile }: SidebarProps) {
  const { currentPath, route, navigate, openNewSaleModal } = useRouter();
  const { actor, setRole, can } = useSession();
  const { useCases, dataRevision } = useApplication();

  const [isOutOfStockModalOpen, setIsOutOfStockModalOpen] = useState<boolean>(false);

  const isWarehouseActive =
    route.key === AppRouteKey.WAREHOUSE_PRODUCTS ||
    route.key === AppRouteKey.WAREHOUSE_PRODUCT_HISTORY ||
    route.key === AppRouteKey.WAREHOUSE_INVENTORY_CUTS ||
    route.key === AppRouteKey.WAREHOUSE_WORKDAY_DETAIL;

  const [isWarehouseExpanded, setIsWarehouseExpanded] = useState<boolean>(true);

  useEffect(() => {
    if (isWarehouseActive) {
      setIsWarehouseExpanded(true);
    }
  }, [isWarehouseActive]);

  const { data: openSales } = useAsyncQuery(
    () =>
      can(Permission.VIEW_OPEN_SALES)
        ? useCases.sales.getOpenSales.execute(actor)
        : Promise.resolve([]),
    [useCases.sales.getOpenSales, actor, can, dataRevision]
  );

  const { data: activeWorkday } = useAsyncQuery(
    () =>
      can(Permission.VIEW_INVENTORY_CUTS)
        ? useCases.warehouse.getActiveWorkday.execute(actor)
        : Promise.resolve(null),
    [useCases.warehouse.getActiveWorkday, actor, can, dataRevision]
  );

  const salesValidation = validateActiveWorkdayForSales(activeWorkday);

  const { data: outOfStockProducts } = useAsyncQuery(
    () =>
      can(Permission.VIEW_PRODUCTS)
        ? useCases.warehouse.getOutOfStockProducts.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.getOutOfStockProducts, actor, can, dataRevision]
  );

  const handleNav = (path: string) => {
    navigate(path);
    onCloseMobile();
  };

  const handleNewSale = () => {
    openNewSaleModal();
    onCloseMobile();
  };

  const openAccountsCount = openSales?.length ?? 0;

  const navItemClass = (isActive: boolean) =>
    [
      'flex w-full items-center gap-3 rounded-lg px-3.5 h-10 text-sm font-medium transition-colors duration-150 cursor-pointer',
      'whitespace-nowrap tracking-[0.01em]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F49D37]',
      isActive
        ? 'bg-[#1A5F7A] text-white'
        : 'text-slate-200 hover:bg-[#1A5F7A]/60 hover:text-white',
    ].join(' ');

  const subNavItemClass = (isActive: boolean) =>
    [
      'flex w-full items-center gap-2.5 rounded-lg pl-9 pr-3.5 h-9 text-xs font-medium transition-colors duration-150 cursor-pointer',
      'whitespace-nowrap tracking-[0.01em]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F49D37]',
      isActive
        ? 'bg-[#287C99] text-white'
        : 'text-slate-300 hover:bg-[#1A5F7A]/50 hover:text-white',
    ].join(' ');

  const sidebarContent = (
    <aside
      aria-label="Menú principal"
      className="flex h-dvh w-64 max-w-[85vw] flex-col overflow-hidden bg-[#123F55] text-white select-none"
    >
      {/* Cabecera de marca (fija arriba) */}
      <div className="flex h-14 sm:h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-5">
        <button
          type="button"
          onClick={() => handleNav(ROUTES.home)}
          className="flex min-w-0 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F49D37] rounded-md cursor-pointer"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#1A5F7A] text-[#F49D37]">
            <Store className="h-4 w-4" />
          </span>
          <span className="truncate text-base font-semibold tracking-tight text-white">
            Gestión Comercial
          </span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Cerrar menú lateral"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white lg:hidden cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navegación principal (desplazable inteligente) */}
      <nav className="flex-1 min-h-0 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-3">
        {/* 1. Inicio */}
        <button
          type="button"
          onClick={() => handleNav(ROUTES.home)}
          className={navItemClass(
            route.key === AppRouteKey.HOME || route.key === AppRouteKey.SALES_HISTORY
          )}
        >
          <Home className="h-4 w-4 shrink-0 text-slate-300" />
          <span className="truncate">Inicio</span>
        </button>

        {/* 2. Sección dinámica: Cuentas abiertas (N) y acceso a Nueva venta */}
        {can(Permission.VIEW_OPEN_SALES) && (
          <div className="space-y-1 pt-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleNav(ROUTES.openSales)}
                className={navItemClass(route.key === AppRouteKey.OPEN_SALES)}
              >
                <ReceiptText className="h-4 w-4 shrink-0 text-slate-300" />
                <span className="flex-1 truncate text-left">
                  Cuentas abiertas ({openAccountsCount})
                </span>
              </button>

              {can(Permission.CREATE_SALE) && salesValidation.canOperateSales && (
                <button
                  type="button"
                  onClick={handleNewSale}
                  title="Preparar nueva venta"
                  aria-label="Preparar nueva venta"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F49D37] text-slate-950 hover:bg-[#f6ad55] transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>

            {openSales && openSales.length > 0 ? (
              <div
                aria-label="Lista de cuentas abiertas"
                className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain pt-0.5 pr-1"
              >
                {openSales.map((sale) => {
                  const detailPath = ROUTES.openSaleDetail(sale.id);
                  const isSaleSelected = currentPath === detailPath;
                  const displayLabel = formatSaleDisplayLabel(sale);
                  return (
                    <button
                      key={sale.id}
                      type="button"
                      onClick={() => handleNav(detailPath)}
                      title={displayLabel}
                      className={subNavItemClass(isSaleSelected)}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F49D37]" />
                      <span className="flex-1 truncate text-left">{displayLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="pl-9 pr-3 py-1 text-[11px] text-slate-400">
                Sin cuentas abiertas
              </div>
            )}
          </div>
        )}

        {/* 3. Gastos (justo encima de Almacén) */}
        {can(Permission.VIEW_EXPENSES) && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => handleNav(ROUTES.expenses)}
              className={navItemClass(route.key === AppRouteKey.EXPENSES)}
            >
              <TrendingDown className="h-4 w-4 shrink-0 text-slate-300" />
              <span className="truncate">Gastos</span>
            </button>
          </div>
        )}

        {/* 4. Almacén */}
        {can(Permission.VIEW_PRODUCTS) && (
          <div className="space-y-1 pt-1">
            <button
              type="button"
              aria-expanded={isWarehouseExpanded}
              onClick={() => setIsWarehouseExpanded((prev) => !prev)}
              className={navItemClass(isWarehouseActive && !isWarehouseExpanded)}
            >
              <Boxes className="h-4 w-4 shrink-0 text-slate-300" />
              <span className="flex-1 truncate text-left">Almacén</span>
              <ChevronDown
                className={[
                  'h-4 w-4 shrink-0 text-slate-300 transition-transform duration-150',
                  isWarehouseExpanded ? 'rotate-180' : '',
                ].join(' ')}
              />
            </button>

            {isWarehouseExpanded && (
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => handleNav(ROUTES.warehouseProducts)}
                  className={subNavItemClass(
                    route.key === AppRouteKey.WAREHOUSE_PRODUCTS
                  )}
                >
                  <Package className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  <span className="truncate">Productos</span>
                </button>

                {can(Permission.VIEW_INVENTORY_CUTS) && (
                  <button
                    type="button"
                    onClick={() => handleNav(ROUTES.warehouseInventoryCuts)}
                    className={subNavItemClass(
                      route.key === AppRouteKey.WAREHOUSE_INVENTORY_CUTS
                    )}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                    <span className="truncate">Inventarios / Corte</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 4. Ajustes */}
        {can(Permission.VIEW_SETTINGS) && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => handleNav(ROUTES.settings)}
              className={navItemClass(route.key === AppRouteKey.SETTINGS)}
            >
              <Settings className="h-4 w-4 shrink-0 text-slate-300" />
              <span className="truncate">Ajustes</span>
            </button>
          </div>
        )}
      </nav>

      {/* Alerta dinámica de productos agotados (fija en bloque inferior) */}
      {can(Permission.VIEW_PRODUCTS) && (
        <div className="shrink-0 border-t border-white/10 px-3 py-2">
          {outOfStockProducts && outOfStockProducts.length > 0 ? (
            <button
              type="button"
              onClick={() => setIsOutOfStockModalOpen(true)}
              className="flex w-full items-center justify-between rounded-lg bg-amber-500/20 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors cursor-pointer shadow-sm"
              title="Ver detalle de artículos agotados"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="truncate">Productos agotados</span>
              </div>
              <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-slate-950 font-mono">
                {outOfStockProducts.length}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsOutOfStockModalOpen(true)}
              className="flex w-full items-center justify-between rounded-lg bg-[#1A5F7A]/30 border border-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-[#1A5F7A]/60 hover:text-white transition-colors cursor-pointer"
              title="No hay productos agotados"
            >
              <div className="flex min-w-0 items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="truncate text-[11px]">Sin agotados</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">0</span>
            </button>
          )}
        </div>
      )}

      {/* Pie lateral: selector de rol operativo previo a autenticación definitiva (fijo abajo) */}
      <div className="shrink-0 border-t border-white/10 p-3 sm:p-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-300">
          <span>Rol activo</span>
          <span className="text-slate-400">Sesión local</span>
        </div>

        <div
          role="group"
          aria-label="Seleccionar rol operativo"
          className="grid grid-cols-2 gap-1 rounded-lg bg-[#0d2f40] p-1"
        >
          {([UserRole.ADMIN, UserRole.CASHIER] as const).map((roleOption) => {
            const selected = actor.role === roleOption;
            return (
              <button
                key={roleOption}
                type="button"
                onClick={() => setRole(roleOption)}
                className={[
                  'h-8 rounded-md px-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F49D37]',
                  selected
                    ? 'bg-[#287C99] text-white'
                    : 'text-slate-300 hover:text-white',
                ].join(' ')}
              >
                {ROLE_LABELS[roleOption]}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );


  return (
    <>
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex">
        {sidebarContent}
      </div>

      {isMobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#123F55]/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{sidebarContent}</div>
        </div>
      )}

      <OutOfStockAlertModal
        isOpen={isOutOfStockModalOpen}
        onClose={() => setIsOutOfStockModalOpen(false)}
        products={outOfStockProducts ?? []}
        onSelectProduct={(productId) => {
          setIsOutOfStockModalOpen(false);
          handleNav(ROUTES.warehouseProductHistory(productId));
        }}
      />
    </>
  );
}
