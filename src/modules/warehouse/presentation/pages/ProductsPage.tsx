import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  DollarSign,
  Download,
  FileSpreadsheet,
  History,
  MoreVertical,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { Card } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { TextInput } from '../../../../shared/components/FormField';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatSimpleDate, getExpirationStatus } from '../../../../shared/utils/date';
import {
  ProductAvailability,
  ProductCatalogViewItem,
  ProductRecord,
  ProductStatus,
} from '../../domain/entities/ProductRecord';
import { useRouter } from '../../../../app/router/RouterProvider';
import { ROUTES } from '../../../../app/router/routes';
import { CorrectProductStockModal } from '../components/CorrectProductStockModal';
import { EditProductSalePriceModal } from '../components/EditProductSalePriceModal';
import { NewProductEntryModal } from '../components/NewProductEntryModal';
import { ProductStatusChangeModal } from '../components/ProductStatusChangeModal';
import { RegisterMerchandiseEntryModal } from '../components/RegisterMerchandiseEntryModal';
import { ExcelImportModal } from '../components/ExcelImportModal';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export function ProductsPage() {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate } = useRouter();

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<PageSizeOption>(25);
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'OUT_OF_STOCK' | 'NEAR_EXPIRATION'>('ALL');
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState<boolean>(false);
  const [selectedProductForEntry, setSelectedProductForEntry] = useState<ProductCatalogViewItem | null>(null);
  const [selectedProductForPriceEdit, setSelectedProductForPriceEdit] = useState<ProductCatalogViewItem | null>(null);
  const [selectedProductForStockCorrection, setSelectedProductForStockCorrection] = useState<ProductCatalogViewItem | null>(null);
  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    product: ProductCatalogViewItem;
    targetStatus: ProductStatus;
  } | null>(null);

  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState<boolean>(false);

  const [activeMenuProductId, setActiveMenuProductId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const canManageProducts = can(Permission.MANAGE_PRODUCTS);
  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  // Cerrar menú contextual al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setActiveMenuProductId(null);
      }
    }
    if (activeMenuProductId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeMenuProductId]);

  const { data: products, isLoading, reload } = useAsyncQuery(
    () => useCases.warehouse.listProducts.execute(actor),
    [useCases.warehouse.listProducts, actor, dataRevision]
  );

  const productsWithExpirationAlert = useMemo(() => {
    return (products ?? []).filter((item) => {
      if (!item.expirationDate) return false;
      return getExpirationStatus(item.expirationDate).isAlert;
    });
  }, [products]);

  const filteredProducts = useMemo(() => {
    const items = products ?? [];
    const query = searchTerm.trim().toLowerCase();
    let result = items;
    if (query) {
      result = items.filter(
        (item) =>
          item.code.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          (item.sku && item.sku.toLowerCase().includes(query)) ||
          item.categoryLabel.toLowerCase().includes(query)
      );
    }

    if (filterTab === 'ACTIVE') {
      result = result.filter((item) => item.status === ProductStatus.ACTIVE);
    } else if (filterTab === 'OUT_OF_STOCK') {
      result = result.filter((item) => item.stockQuantity <= 0);
    } else if (filterTab === 'NEAR_EXPIRATION') {
      result = result.filter((item) => {
        if (!item.expirationDate) return false;
        return getExpirationStatus(item.expirationDate).isAlert;
      });
    }

    // Garantizar que los productos inactivos siempre se ubiquen al final
    return result.slice().sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === ProductStatus.ACTIVE ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'es');
    });
  }, [products, searchTerm, filterTab]);

  // Paginación dinámica según selección de usuario [10, 25, 50, 100]
  const totalItems = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedProducts = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * itemsPerPage;
    return filteredProducts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredProducts, safeCurrentPage, itemsPerPage]);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
    if (successBanner) setSuccessBanner(null);
  };

  const handleProductCreated = (product: ProductRecord) => {
    setSuccessBanner(
      `Producto «${product.name}» registrado exitosamente con una entrada inicial de ${product.currentStock} unidades.`
    );
    notifyDataChanged();
    void reload();
  };

  const handleEntryRegistered = (product: ProductRecord, message: string) => {
    setSuccessBanner(message);
    notifyDataChanged();
    void reload();
  };

  const handlePriceUpdated = (product: ProductRecord, message: string) => {
    setSuccessBanner(message);
    notifyDataChanged();
    void reload();
  };

  const handleStockCorrected = (product: ProductRecord, message: string) => {
    setSuccessBanner(message);
    notifyDataChanged();
    void reload();
  };

  const handleStatusChanged = (product: ProductRecord, message: string) => {
    setSuccessBanner(message);
    notifyDataChanged();
    void reload();
  };

  const handleExportExcel = () => {
    if (!products || products.length === 0) {
      setSuccessBanner('No hay productos disponibles para exportar.');
      return;
    }
    setIsExportingExcel(true);
    try {
      const { fileName, rowCount } = useCases.warehouse.excelInventory.exportToExcel(
        actor,
        products
      );
      setSuccessBanner(
        `Catálogo de inventario exportado exitosamente a Excel (${fileName}) con ${rowCount} productos.`
      );
    } catch (err) {
      setSuccessBanner(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al exportar el inventario a Excel.'
      );
    } finally {
      setIsExportingExcel(false);
    }
  };

  const columns = useMemo<readonly TableColumn<ProductCatalogViewItem>[]>(() => {
    const cols: TableColumn<ProductCatalogViewItem>[] = [
      {
        key: 'name',
        header: 'Producto',
        render: (item) => (
          <div>
            <div className={`font-medium ${item.status === ProductStatus.INACTIVE ? 'text-slate-500' : 'text-slate-900'}`}>
              {item.name}
            </div>
            <div className="text-[11px] text-slate-500">
              {item.code} {item.sku ? `· SKU: ${item.sku}` : ''}
            </div>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Categoría',
        render: (item) => (
          <span className="text-xs text-slate-700">{item.categoryLabel}</span>
        ),
      },
      {
        key: 'unit',
        header: 'Unidad',
        render: (item) => (
          <span className="text-xs text-slate-600">{item.unitLabel}</span>
        ),
      },
      {
        key: 'stock',
        header: 'Existencia',
        align: 'right',
        tabular: true,
        render: (item) => (
          <span
            className={`font-semibold ${
              item.status === ProductStatus.INACTIVE
                ? 'text-slate-400'
                : item.stockQuantity <= 0
                ? 'text-amber-700'
                : 'text-slate-900'
            }`}
          >
            {item.stockQuantity.toFixed(2)}
          </span>
        ),
      },
      {
        key: 'expirationDate',
        header: 'Vencimiento',
        align: 'left',
        render: (item) => {
          if (!item.expirationDate) {
            return <span className="text-xs text-slate-400 font-mono">—</span>;
          }
          const exp = getExpirationStatus(item.expirationDate);
          return (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-slate-800">
                <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <span>{formatSimpleDate(item.expirationDate)}</span>
              </div>
              {exp.isAlert ? (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    exp.status === 'EXPIRED'
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                  title={exp.status === 'EXPIRED' ? 'Producto vencido' : 'Queda 1 año o menos para vencer'}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {exp.label}
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 font-medium">
                  {exp.label}
                </span>
              )}
            </div>
          );
        },
      },
    ];

    if (canViewCosts) {
      cols.push(
        {
          key: 'purchaseCost',
          header: 'Último costo',
          align: 'right',
          tabular: true,
          render: (item) =>
            item.purchaseCost !== undefined ? `$${item.purchaseCost.toFixed(2)}` : '—',
        },
        {
          key: 'margin',
          header: 'Margen',
          align: 'right',
          tabular: true,
          render: (item) =>
            item.marginPercentage !== undefined ? (
              <span className="text-emerald-700 font-medium">
                +{item.marginPercentage.toFixed(2)}%
              </span>
            ) : (
              '—'
            ),
        }
      );
    }

    cols.push({
      key: 'salePrice',
      header: 'Precio venta',
      align: 'right',
      tabular: true,
      render: (item) => (
        <span
          className={`font-semibold ${
            item.status === ProductStatus.INACTIVE ? 'text-slate-400' : 'text-[#123F55]'
          }`}
        >
          ${item.salePrice}
        </span>
      ),
    });

    // Columna 1: Disponibilidad operativa
    cols.push({
      key: 'availability',
      header: 'Disponibilidad',
      align: 'right',
      render: (item) => {
        if (item.availability === ProductAvailability.INACTIVE) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
              Inactivo
            </span>
          );
        }
        if (item.availability === ProductAvailability.OUT_OF_STOCK) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
              Agotado
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
            Disponible
          </span>
        );
      },
    });

    // Columna 2: Estado administrativo
    cols.push({
      key: 'status',
      header: 'Estado',
      align: 'right',
      render: (item) => {
        if (item.status === ProductStatus.INACTIVE) {
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
              Inactivo
            </span>
          );
        }
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            Activo
          </span>
        );
      },
    });

    // Columna 3: Menú de acciones contextual o acceso a historial
    cols.push({
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (item) => {
        if (!canManageProducts) {
          return (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => navigate(ROUTES.warehouseProductHistory(item.id))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 transition-colors cursor-pointer"
                title={`Ver historial y trazabilidad de ${item.name}`}
              >
                <History className="w-3.5 h-3.5 text-slate-500" />
                <span>Historial</span>
              </button>
            </div>
          );
        }

        const isMenuOpen = activeMenuProductId === item.id;
        const isActive = item.status === ProductStatus.ACTIVE;

        return (
          <div className="relative inline-block text-left" ref={isMenuOpen ? menuContainerRef : null}>
            <div className="flex items-center justify-end gap-1">
              {/* Botón de acceso rápido a nueva entrada si está activo */}
              {isActive && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveMenuProductId(null);
                    setSelectedProductForEntry(item);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#123F55] bg-sky-50 hover:bg-sky-100 active:bg-sky-200 rounded border border-sky-200 transition-colors cursor-pointer"
                  title={`Nueva entrada de mercancía para ${item.name}`}
                >
                  <PackagePlus className="w-3.5 h-3.5 text-[#1A5F7A]" />
                  <span className="hidden sm:inline">Entrada</span>
                </button>
              )}

              {/* Botón disparador del menú desplegable contextual */}
              <button
                type="button"
                onClick={() =>
                  setActiveMenuProductId((current) => (current === item.id ? null : item.id))
                }
                className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                title={`Más acciones para ${item.name}`}
                aria-haspopup="true"
                aria-expanded={isMenuOpen}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>

            {/* Panel del menú contextual */}
            {isMenuOpen && (
              <div
                role="menu"
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute right-0 z-30 mt-1 w-52 origin-top-right rounded-lg bg-white shadow-lg ring-1 ring-black/10 focus:outline-none divide-y divide-slate-100 py-1"
              >
                {/* Opción 1: Nueva entrada de mercancía */}
                <div className="py-1">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!isActive}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveMenuProductId(null);
                      setSelectedProductForEntry(item);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left ${
                      isActive
                        ? 'text-slate-700 hover:bg-slate-50 cursor-pointer'
                        : 'text-slate-300 cursor-not-allowed'
                    }`}
                    title={
                      isActive
                        ? 'Registrar nueva entrada de mercancía'
                        : 'Operación no permitida en productos inactivos'
                    }
                  >
                    <PackagePlus className="w-3.5 h-3.5 text-[#1A5F7A] shrink-0" />
                    <span>Nueva entrada</span>
                  </button>

                  {/* Opción: Corregir existencias */}
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveMenuProductId(null);
                      setSelectedProductForStockCorrection(item);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                    title="Corregir existencias de inventario físico"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Corregir existencias</span>
                  </button>

                  {/* Opción 2: Modificar precio de venta */}
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveMenuProductId(null);
                      setSelectedProductForPriceEdit(item);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                  >
                    <Pencil className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Editar precio de venta</span>
                  </button>
                </div>

                {/* Opción 3: Activar / Desactivar */}
                <div className="py-1">
                  {isActive ? (
                    <button
                      type="button"
                      role="menuitem"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveMenuProductId(null);
                        setStatusChangeTarget({
                          product: item,
                          targetStatus: ProductStatus.INACTIVE,
                        });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 cursor-pointer text-left"
                    >
                      <PowerOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>Desactivar producto</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveMenuProductId(null);
                        setStatusChangeTarget({
                          product: item,
                          targetStatus: ProductStatus.ACTIVE,
                        });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-emerald-800 hover:bg-emerald-50 cursor-pointer text-left"
                    >
                      <Power className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Activar producto</span>
                    </button>
                  )}
                </div>

                {/* Opción 4: Ver historial (Fase 7 habilitada) */}
                <div className="py-1">
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveMenuProductId(null);
                      navigate(ROUTES.warehouseProductHistory(item.id));
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer text-left"
                    title={`Ver historial completo y Kardex de ${item.name}`}
                  >
                    <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>Ver historial</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      },
    });

    return cols;
  }, [canManageProducts, canViewCosts, activeMenuProductId]);

  const showingStart = totalItems === 0 ? 0 : (safeCurrentPage - 1) * itemsPerPage + 1;
  const showingEnd = Math.min(safeCurrentPage * itemsPerPage, totalItems);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        subtitle={
          canViewCosts
            ? 'Catálogo general de productos, existencias, costos de compra y precios de venta.'
            : 'Consulta de productos autorizada para operaciones en mostrador.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={<FileSpreadsheet className="h-4 w-4" />}
              onClick={handleExportExcel}
              disabled={isExportingExcel || !products || products.length === 0}
            >
              {isExportingExcel ? 'Exportando…' : 'Exportar Excel'}
            </Button>
            {canManageProducts && (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Upload className="h-4 w-4" />}
                  onClick={() => setIsExcelImportModalOpen(true)}
                >
                  Importar Excel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => setIsNewEntryModalOpen(true)}
                >
                  + Nueva Mercancía
                </Button>
              </>
            )}
          </div>
        }
      />

      {successBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            className="text-xs text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
            onClick={() => setSuccessBanner(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      {productsWithExpirationAlert.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/95 p-4 text-xs text-amber-950 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 border border-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-bold text-amber-900 text-sm">
                Alerta de Vencimiento Preventiva: {productsWithExpirationAlert.length}{' '}
                {productsWithExpirationAlert.length === 1 ? 'producto tiene' : 'productos tienen'} 1 año o menos para vencer (o ya vencidos)
              </h4>
              <p className="mt-0.5 text-amber-800">
                Se detectaron artículos con proximidad de vencimiento en almacén. Revise la lista para priorizar su venta o coordinar devoluciones.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={filterTab === 'NEAR_EXPIRATION' ? 'primary' : 'secondary'}
              size="sm"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              onClick={() => {
                setFilterTab((curr) => (curr === 'NEAR_EXPIRATION' ? 'ALL' : 'NEAR_EXPIRATION'));
                setCurrentPage(1);
              }}
            >
              {filterTab === 'NEAR_EXPIRATION'
                ? 'Ver todo el catálogo'
                : `Ver artículos con alerta (${productsWithExpirationAlert.length})`}
            </Button>
          </div>
        </div>
      )}

      <Card>
        {/* Barra de Filtros y Búsqueda */}
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="w-full max-w-sm">
              <TextInput
                aria-label="Buscar producto por código, SKU o nombre"
                placeholder="Buscar por código, SKU o nombre…"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                leadingIcon={<Search className="h-4 w-4" />}
              />
            </div>

            {/* Selector de cantidad de productos a ver a la vez [10, 25, 50, 100] */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-600 font-medium">Ver a la vez:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label="Cantidad de productos por página">
                {PAGE_SIZE_OPTIONS.map((size) => {
                  const isSelected = itemsPerPage === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setItemsPerPage(size);
                        setCurrentPage(1);
                      }}
                      className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#123F55] text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                      }`}
                      aria-label={`Ver ${size} productos a la vez`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Filtros rápidos: Todos, Activos, Agotados, Próximos a vencer */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setFilterTab('ALL');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterTab === 'ALL'
                  ? 'bg-[#1A5F7A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Todos ({products?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('ACTIVE');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterTab === 'ACTIVE'
                  ? 'bg-[#1A5F7A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Activos ({products?.filter((p) => p.status === ProductStatus.ACTIVE).length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterTab('OUT_OF_STOCK');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filterTab === 'OUT_OF_STOCK'
                  ? 'bg-[#1A5F7A] text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Agotados ({products?.filter((p) => p.stockQuantity <= 0).length ?? 0})
            </button>
            {productsWithExpirationAlert.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFilterTab('NEAR_EXPIRATION');
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer ${
                  filterTab === 'NEAR_EXPIRATION'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Alerta Vencimiento ≤ 1 año ({productsWithExpirationAlert.length})</span>
              </button>
            )}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={paginatedProducts}
          getRowKey={(row) => row.id}
          isLoading={isLoading}
          emptyIcon={<Package className="h-5 w-5" />}
          emptyTitle={
            searchTerm.trim()
              ? 'No se encontraron productos con ese criterio'
              : filterTab === 'NEAR_EXPIRATION'
              ? 'No hay productos con alerta de vencimiento (≤ 1 año)'
              : 'No hay productos registrados en el almacén'
          }
          emptyDescription={
            searchTerm.trim()
              ? 'Intente con otro código o nombre de artículo.'
              : filterTab === 'NEAR_EXPIRATION'
              ? 'Todos los productos con fecha de vencimiento registrada tienen más de 1 año de vigencia.'
              : 'El catálogo se encuentra vacío. Registre el primer producto mediante el botón "+ Nueva Mercancía".'
          }
          emptyAction={
            !searchTerm.trim() && filterTab !== 'NEAR_EXPIRATION' && canManageProducts ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setIsNewEntryModalOpen(true)}
              >
                + Nueva Mercancía
              </Button>
            ) : undefined
          }
        />

        {/* Paginación dinámica según itemsPerPage [10, 25, 50, 100] */}
        {totalItems > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3.5 text-xs text-slate-600">
            <div className="flex items-center gap-3">
              <div>
                Mostrando <strong className="font-semibold text-slate-800 tabular-nums">{showingStart}</strong> -{' '}
                <strong className="font-semibold text-slate-800 tabular-nums">{showingEnd}</strong> de{' '}
                <strong className="font-semibold text-slate-800 tabular-nums">{totalItems}</strong> productos
              </div>
              <div className="hidden sm:flex items-center gap-1.5 pl-3 border-l border-slate-200 text-slate-500">
                <span>Por página:</span>
                <span className="font-bold text-[#123F55]">{itemsPerPage}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                Página {safeCurrentPage} de {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  icon={<ChevronLeft className="h-3.5 w-3.5" />}
                  aria-label="Página anterior"
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  icon={<ChevronRight className="h-3.5 w-3.5" />}
                  aria-label="Página siguiente"
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Modal 1: Alta de producto con entrada inicial */}
      {canManageProducts && (
        <NewProductEntryModal
          isOpen={isNewEntryModalOpen}
          onClose={() => setIsNewEntryModalOpen(false)}
          onSuccess={handleProductCreated}
        />
      )}

      {/* Modal 2: Nueva entrada de mercancía para producto existente */}
      {canManageProducts && (
        <RegisterMerchandiseEntryModal
          isOpen={selectedProductForEntry !== null}
          product={selectedProductForEntry}
          onClose={() => setSelectedProductForEntry(null)}
          onSuccess={handleEntryRegistered}
        />
      )}

      {/* Modal 3: Modificación independiente del precio de venta */}
      {canManageProducts && selectedProductForPriceEdit !== null && (
        <EditProductSalePriceModal
          isOpen={selectedProductForPriceEdit !== null}
          product={selectedProductForPriceEdit}
          onClose={() => setSelectedProductForPriceEdit(null)}
          onSuccess={handlePriceUpdated}
        />
      )}

      {/* Modal 4: Activación y Desactivación de producto */}
      {canManageProducts && statusChangeTarget !== null && (
        <ProductStatusChangeModal
          isOpen={statusChangeTarget !== null}
          product={statusChangeTarget.product}
          targetStatus={statusChangeTarget.targetStatus}
          onClose={() => setStatusChangeTarget(null)}
          onSuccess={handleStatusChanged}
        />
      )}

      {/* Modal 5: Corrección manual de existencias físicas */}
      {canManageProducts && selectedProductForStockCorrection !== null && (
        <CorrectProductStockModal
          isOpen={selectedProductForStockCorrection !== null}
          product={selectedProductForStockCorrection}
          onClose={() => setSelectedProductForStockCorrection(null)}
          onSuccess={handleStockCorrected}
        />
      )}

      {/* Modal 6: Importación masiva de inventario desde Excel */}
      {canManageProducts && (
        <ExcelImportModal
          isOpen={isExcelImportModalOpen}
          onClose={() => setIsExcelImportModalOpen(false)}
          onImport={(file) => useCases.warehouse.excelInventory.importFromExcel(actor, file)}
          onCompleted={() => {
            setSuccessBanner('Inventario sincronizado e importado exitosamente desde Excel.');
            notifyDataChanged();
            void reload();
          }}
        />
      )}
    </div>
  );
}
