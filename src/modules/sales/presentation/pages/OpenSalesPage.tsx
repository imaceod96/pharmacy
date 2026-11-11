import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  CheckCircle2,
  Edit3,
  History,
  Minus,
  PackageCheck,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { DispatchReceiptModal } from '../components/DispatchReceiptModal';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { Button } from '../../../../shared/components/Button';
import { Card, CardBody, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { generateEntityId } from '../../../../shared/utils/id';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  ProductAvailability,
  ProductCatalogViewItem,
  ProductStatus,
} from '../../../warehouse/domain/entities/ProductRecord';
import { validateActiveWorkdayForSales } from '../../../warehouse/domain/entities/WorkdayRecord';
import {
  formatSaleDisplayLabel,
  SaleRecord,
  validateSaleLineQuantity,
} from '../../domain/entities/SaleRecord';

export interface OpenSalesPageProps {
  readonly selectedSaleId?: string;
}

interface WorkspaceDraftLine {
  readonly productId: string;
  readonly productCode: string;
  readonly sku: string | null;
  readonly productName: string;
  readonly unitLabel: string;
  readonly quantity: number;
  readonly quantityInput: string;
  readonly unitSalePrice: number;
}

export function OpenSalesPage({ selectedSaleId }: OpenSalesPageProps) {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate, newSaleTriggerCount, setNavigationGuard } = useRouter();

  const canCreateSale = can(Permission.CREATE_SALE);

  // Sub-modo cuando no hay selectedSaleId: 'NEW_SALE' (preparación de venta) o 'DIRECTORY' (tabla de cuentas abiertas)
  const [unselectedMode, setUnselectedMode] = useState<'NEW_SALE' | 'DIRECTORY'>('NEW_SALE');

  // Estado aislado para "Nueva venta"
  const [newSaleLines, setNewSaleLines] = useState<WorkspaceDraftLine[]>([]);

  // Estado aislado para la cuenta abierta seleccionada actualmente
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [openAccountName, setOpenAccountName] = useState<string>('');
  const [openAccountLines, setOpenAccountLines] = useState<WorkspaceDraftLine[]>([]);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);
  const [isOpenAccountDirty, setIsOpenAccountDirty] = useState<boolean>(false);

  // Buscador de productos y cantidades rápidas para agregar
  const [productSearch, setProductSearch] = useState<string>('');
  const [quickAddQuantities, setQuickAddQuantities] = useState<Record<string, string>>({});

  // Mensajes de estado y error
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceSuccess, setWorkspaceSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Modal 1: Dejar cuenta abierta (solicita nombre obligatorio)
  const [isLeaveOpenModalOpen, setIsLeaveOpenModalOpen] = useState<boolean>(false);
  const [newAccountNameInput, setNewAccountNameInput] = useState<string>('');
  const [leaveOpenError, setLeaveOpenError] = useState<string | null>(null);

  // Modal 2: Confirmación de despacho (directo o desde cuenta abierta)
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState<boolean>(false);
  const [dispatchOperationId, setDispatchOperationId] = useState<string>('');
  const [dispatchTransferAmountInput, setDispatchTransferAmountInput] = useState<string>('');
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchedReceiptSale, setDispatchedReceiptSale] = useState<SaleRecord | null>(null);

  // Modal 3: Cancelación auditada de cuenta abierta
  const [isCancelAccountModalOpen, setIsCancelAccountModalOpen] = useState<boolean>(false);
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('');
  const [cancelAccountError, setCancelAccountError] = useState<string | null>(null);

  // Modal 4: Advertencia por cambios sin guardar antes de cambiar de cuenta
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    isOpen: boolean;
    nextAction: (() => void) | null;
  }>({
    isOpen: false,
    nextAction: null,
  });

  // 1. Consulta de jornada operativa activa
  const { data: activeWorkday } = useAsyncQuery(
    () =>
      can(Permission.VIEW_INVENTORY_CUTS)
        ? useCases.warehouse.getActiveWorkday.execute(actor)
        : Promise.resolve(null),
    [useCases.warehouse.getActiveWorkday, actor, can, dataRevision]
  );

  const salesValidation = validateActiveWorkdayForSales(activeWorkday);

  // 2. Consulta del catálogo de productos para el buscador y verificación en tiempo real
  const { data: catalogProducts, isLoading: isLoadingProducts } = useAsyncQuery(
    () =>
      can(Permission.VIEW_PRODUCTS)
        ? useCases.warehouse.listProducts.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listProducts, actor, can, dataRevision]
  );

  const productById = useMemo(() => {
    const map = new Map<string, ProductCatalogViewItem>();
    for (const p of catalogProducts ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [catalogProducts]);

  // 3. Consulta de todas las cuentas abiertas reales (para barra superior y directorio)
  const { data: openSalesList, isLoading: isLoadingOpenSales } = useAsyncQuery(
    () => useCases.sales.getOpenSales.execute(actor),
    [useCases.sales.getOpenSales, actor, dataRevision]
  );

  // 4. Consulta de la cuenta abierta seleccionada con sincronización de catálogo
  const selectedSaleQuery = useAsyncQuery(
    () =>
      selectedSaleId
        ? useCases.sales.getOpenSaleDetail.executeWithCatalogSync(actor, selectedSaleId)
        : Promise.resolve(undefined),
    [useCases.sales.getOpenSaleDetail, actor, selectedSaleId, dataRevision]
  );

  // Cuando se pulsa "Nueva venta" en cabecera o menú lateral, activar modo Nueva venta
  useEffect(() => {
    if (newSaleTriggerCount > 0 && !selectedSaleId) {
      setUnselectedMode('NEW_SALE');
      setWorkspaceError(null);
    }
  }, [newSaleTriggerCount, selectedSaleId]);

  // Cargar datos aislados cuando cambia la cuenta abierta seleccionada
  useEffect(() => {
    if (!selectedSaleId) {
      setEditingSaleId(null);
      setIsOpenAccountDirty(false);
      return;
    }

    const detail = selectedSaleQuery.data;
    if (!detail) return;

    // Si cambiamos de cuenta abierta o si la cuenta no tiene cambios locales pendientes, sincronizar estado local
    if (editingSaleId !== detail.sale.id || !isOpenAccountDirty) {
      setEditingSaleId(detail.sale.id);
      setOpenAccountName(
        (detail.sale.accountName ?? detail.sale.customerOrTableLabel ?? '').trim()
      );
      setExpectedUpdatedAt(detail.sale.updatedAt);
      setOpenAccountLines(
        (detail.sale.items ?? []).map((item) => ({
          productId: item.productId,
          productCode: item.productCode,
          sku: item.sku,
          productName: item.productName,
          unitLabel: item.unitSymbol || item.unitName || 'u.',
          quantity: item.quantity,
          quantityInput: String(item.quantity),
          unitSalePrice: item.unitSalePrice,
        }))
      );
      setIsOpenAccountDirty(false);
      setWorkspaceError(null);
    }
  }, [selectedSaleId, selectedSaleQuery.data, editingSaleId, isOpenAccountDirty]);

  // Guardia de navegación para proteger modificaciones sin guardar en una cuenta abierta
  const hasUnsavedChanges = selectedSaleId ? isOpenAccountDirty : false;

  useEffect(() => {
    if (!hasUnsavedChanges) {
      setNavigationGuard(null);
      return;
    }

    const guard = (_nextPath: string, proceed: () => void) => {
      setUnsavedPrompt({
        isOpen: true,
        nextAction: () => {
          setIsOpenAccountDirty(false);
          proceed();
        },
      });
      return false;
    };

    setNavigationGuard(guard);
    return () => setNavigationGuard(null);
  }, [hasUnsavedChanges, setNavigationGuard]);

  const isEditingOpenAccount = Boolean(selectedSaleId);
  const selectedSaleRecord = selectedSaleQuery.data?.sale;

  const savedQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    if (selectedSaleRecord?.items) {
      for (const item of selectedSaleRecord.items) {
        map.set(item.productId, item.quantity);
      }
    }
    return map;
  }, [selectedSaleRecord]);

  const activeLines = isEditingOpenAccount ? openAccountLines : newSaleLines;

  const updateActiveLines = useCallback(
    (updater: (prev: WorkspaceDraftLine[]) => WorkspaceDraftLine[]) => {
      if (isEditingOpenAccount) {
        setOpenAccountLines(updater);
        setIsOpenAccountDirty(true);
      } else {
        setNewSaleLines(updater);
      }
      setWorkspaceError(null);
    },
    [isEditingOpenAccount]
  );

  // Filtrado de productos para el buscador (por nombre, código o SKU)
  // Muestra todos los productos activos en el almacén (sin límite arbitrario)
  const filteredProducts = useMemo(() => {
    const list = catalogProducts ?? [];
    const query = productSearch.trim().toLowerCase();

    return list.filter((p) => {
      if (p.status !== ProductStatus.ACTIVE) return false;
      if (!query) {
        return true;
      }
      const matchName = p.name.toLowerCase().includes(query);
      const matchCode = p.code.toLowerCase().includes(query);
      const matchSku = (p.sku ?? '').toLowerCase().includes(query);
      return matchName || matchCode || matchSku;
    });
  }, [catalogProducts, productSearch]);

  // Evaluación en tiempo real de cada partida activa frente al catálogo (existencias, estado activo y precio vigente)
  const evaluatedLines = useMemo(() => {
    return activeLines.map((line) => {
      const liveProduct = productById.get(line.productId);
      const isProductMissing = !liveProduct;
      const isProductInactive =
        !liveProduct || liveProduct.status !== ProductStatus.ACTIVE;
      const warehouseStock = liveProduct?.stockQuantity ?? 0;
      const savedAccountQty = isEditingOpenAccount
        ? (savedQtyByProductId.get(line.productId) ?? 0)
        : 0;

      // Capacidad máxima permitida para esta partida: lo que ya tenía reservado en la cuenta + lo disponible en almacén
      const maxAllowedQuantity = Math.round((savedAccountQty + warehouseStock) * 100) / 100;

      // Insuficiencia SOLO si se solicita una cantidad superior a la capacidad máxima (lo que ya se tiene + lo que hay en almacén)
      const isInsufficientStock = line.quantity > maxAllowedQuantity;

      // Para una venta nueva (sin cuenta previa), si no hay stock en almacén está agotado
      // Para una cuenta abierta existente, lo que ya está en la cuenta ya fue apartado físicamente del almacén
      const isOutOfStock = !isEditingOpenAccount && warehouseStock <= 0;

      const currentCatalogPrice = liveProduct?.salePrice ?? line.unitSalePrice;
      const hasPriceChanged =
        Math.abs(currentCatalogPrice - line.unitSalePrice) > 0.001;

      // Bloquea el despacho SOLO si el producto no existe, está inactivo o si la cantidad excede la capacidad permitida
      const blocksDispatch =
        isProductMissing || isProductInactive || isInsufficientStock;

      let issueText: string | null = null;
      if (isProductMissing) {
        issueText = 'Producto no encontrado en el catálogo.';
      } else if (isProductInactive) {
        issueText =
          'Producto inactivo en almacén. Debes retirarlo de la cuenta para poder despachar.';
      } else if (isInsufficientStock) {
        if (isEditingOpenAccount) {
          issueText = `Existencias insuficientes para la adición: en cuenta hay ${savedAccountQty} ${line.unitLabel}, en almacén quedan ${warehouseStock} ${line.unitLabel} (máximo disponible: ${maxAllowedQuantity} ${line.unitLabel}).`;
        } else {
          issueText = `Existencia insuficiente en almacén: disponible ${warehouseStock} ${line.unitLabel}, solicitado ${line.quantity} ${line.unitLabel}.`;
        }
      }

      const lineSubtotal =
        Math.round(line.quantity * line.unitSalePrice * 100) / 100;
      const catalogSubtotal =
        Math.round(line.quantity * currentCatalogPrice * 100) / 100;

      return {
        ...line,
        availableStock: warehouseStock,
        savedAccountQty,
        maxAllowedQuantity,
        isProductInactive,
        isOutOfStock,
        isInsufficientStock,
        hasPriceChanged,
        currentCatalogPrice,
        blocksDispatch,
        issueText,
        lineSubtotal,
        catalogSubtotal,
      };
    });
  }, [activeLines, productById, isEditingOpenAccount, savedQtyByProductId]);

  const hasBlockingLineIssues = useMemo(
    () => evaluatedLines.some((l) => l.blocksDispatch),
    [evaluatedLines]
  );

  const hasCatalogPriceDifferences = useMemo(
    () => evaluatedLines.some((l) => l.hasPriceChanged),
    [evaluatedLines]
  );

  const currentTotalAmount = useMemo(
    () =>
      Math.round(
        evaluatedLines.reduce((sum, l) => sum + l.lineSubtotal, 0) * 100
      ) / 100,
    [evaluatedLines]
  );

  const catalogSyncedTotalAmount = useMemo(
    () =>
      Math.round(
        evaluatedLines.reduce((sum, l) => sum + l.catalogSubtotal, 0) * 100
      ) / 100,
    [evaluatedLines]
  );

  // Añadir producto consolidando en una sola línea si ya existe
  const handleAddProductToSale = (product: ProductCatalogViewItem) => {
    setWorkspaceError(null);
    setWorkspaceSuccess(null);

    if (!salesValidation.canOperateSales) {
      setWorkspaceError(
        salesValidation.message || 'No hay una jornada abierta habilitada para ventas.'
      );
      return;
    }

    if (product.status !== ProductStatus.ACTIVE) {
      setWorkspaceError(
        `El producto "${product.name}" está inactivo y no puede agregarse a la venta.`
      );
      return;
    }

    if (product.stockQuantity <= 0) {
      setWorkspaceError(
        `El producto "${product.name}" se encuentra agotado en almacén.`
      );
      return;
    }

    const rawQtyStr = quickAddQuantities[product.id] ?? '1';
    const parsedQty = Number(rawQtyStr);

    let validQtyToAdd: number;
    try {
      validQtyToAdd = validateSaleLineQuantity(parsedQty, `"${product.name}"`);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Cantidad inválida.'
      );
      return;
    }

    const existingLine = activeLines.find((l) => l.productId === product.id);
    const currentQtyInDraft = existingLine?.quantity ?? 0;
    const savedQty = isEditingOpenAccount
      ? (savedQtyByProductId.get(product.id) ?? 0)
      : 0;
    const warehouseStock = product.stockQuantity;
    const maxAllowed = Math.round((savedQty + warehouseStock) * 100) / 100;
    const nextTotalQuantity = Math.round((currentQtyInDraft + validQtyToAdd) * 100) / 100;

    if (nextTotalQuantity > maxAllowed) {
      setWorkspaceError(
        isEditingOpenAccount
          ? `No puedes agregar ${validQtyToAdd} ${product.unitLabel} de "${product.name}". En almacén solo quedan ${warehouseStock} ${product.unitLabel} disponibles para agregar (en la cuenta ya hay ${savedQty} ${product.unitLabel}).`
          : `No puedes agregar ${validQtyToAdd} ${product.unitLabel} de "${product.name}". Cantidad solicitada (${nextTotalQuantity}) supera la existencia disponible (${warehouseStock}).`
      );
      return;
    }

    updateActiveLines((prev) => {
      const idx = prev.findIndex((item) => item.productId === product.id);
      if (idx === -1) {
        return [
          ...prev,
          {
            productId: product.id,
            productCode: product.code,
            sku: product.sku,
            productName: product.name,
            unitLabel: product.unitLabel,
            quantity: nextTotalQuantity,
            quantityInput: String(nextTotalQuantity),
            unitSalePrice: product.salePrice,
          },
        ];
      }
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        quantity: nextTotalQuantity,
        quantityInput: String(nextTotalQuantity),
        unitSalePrice: product.salePrice,
      };
      return copy;
    });

    setQuickAddQuantities((prev) => ({ ...prev, [product.id]: '1' }));
  };

  // Cambiar cantidad de una partida existente
  const handleLineQuantityInputChange = (productId: string, rawValue: string) => {
    setWorkspaceError(null);
    const numValue = Number(rawValue);
    updateActiveLines((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        if (
          rawValue.trim() !== '' &&
          Number.isFinite(numValue) &&
          numValue > 0
        ) {
          const decimals = (rawValue.split('.')[1] || '').length;
          const rounded =
            decimals <= 2 ? Math.round(numValue * 100) / 100 : line.quantity;
          return {
            ...line,
            quantityInput: rawValue,
            quantity: rounded,
          };
        }
        return {
          ...line,
          quantityInput: rawValue,
        };
      })
    );
  };

  const handleStepLineQuantity = (productId: string, delta: number) => {
    setWorkspaceError(null);
    const liveProduct = productById.get(productId);
    const warehouseStock = liveProduct?.stockQuantity ?? 0;
    const savedQty = isEditingOpenAccount
      ? (savedQtyByProductId.get(productId) ?? 0)
      : 0;
    const maxAllowed = Math.round((savedQty + warehouseStock) * 100) / 100;

    updateActiveLines((prev) =>
      prev.map((line) => {
        if (line.productId !== productId) return line;
        const nextQty = Math.round((line.quantity + delta) * 100) / 100;
        if (nextQty <= 0) return line;
        if (nextQty > maxAllowed) {
          setWorkspaceError(
            `No es posible aumentar más la cantidad para "${line.productName}". Existencias en almacén disponibles para agregar: ${warehouseStock} ${line.unitLabel}.`
          );
          return line;
        }
        return {
          ...line,
          quantity: nextQty,
          quantityInput: String(nextQty),
        };
      })
    );
  };

  const handleRemoveLine = (productId: string) => {
    updateActiveLines((prev) => prev.filter((l) => l.productId !== productId));
  };

  const handleSyncCatalogPrices = () => {
    updateActiveLines((prev) =>
      prev.map((line) => {
        const live = productById.get(line.productId);
        if (!live) return line;
        return {
          ...line,
          unitSalePrice: live.salePrice,
        };
      })
    );
    setWorkspaceSuccess(
      'Se han sincronizado los precios unitarios con el catálogo vigente.'
    );
  };

  // Validar todas las líneas antes de guardar cuenta abierta o abrir confirmación de despacho
  const validateCurrentDraftLines = (): boolean => {
    if (activeLines.length === 0) {
      setWorkspaceError('Debes agregar al menos un producto válido a la cuenta.');
      return false;
    }

    for (const line of activeLines) {
      const parsed = Number(line.quantityInput);
      try {
        validateSaleLineQuantity(parsed, `"${line.productName}"`);
      } catch (err) {
        setWorkspaceError(
          err instanceof Error ? err.message : 'Cantidad inválida en la cuenta.'
        );
        return false;
      }

      const live = productById.get(line.productId);
      if (!live || live.status !== ProductStatus.ACTIVE) {
        setWorkspaceError(
          `El producto "${line.productName}" se encuentra inactivo. Retíralo de la cuenta antes de continuar.`
        );
        return false;
      }

      const warehouseStock = live.stockQuantity;
      const savedQty = isEditingOpenAccount
        ? (savedQtyByProductId.get(line.productId) ?? 0)
        : 0;
      const maxAllowed = Math.round((savedQty + warehouseStock) * 100) / 100;

      if (parsed > maxAllowed) {
        setWorkspaceError(
          isEditingOpenAccount
            ? `Existencias insuficientes para "${line.productName}": en la cuenta ya hay ${savedQty} y en almacén quedan ${warehouseStock} (máximo permitido: ${maxAllowed}).`
            : `Existencias insuficientes para "${line.productName}": disponible en almacén ${warehouseStock}, solicitado ${parsed}.`
        );
        return false;
      }
    }

    return true;
  };

  // Flujo 2: Dejar nueva cuenta abierta
  const handleOpenLeaveAccountModal = () => {
    setWorkspaceError(null);
    if (!validateCurrentDraftLines()) return;
    setNewAccountNameInput('');
    setLeaveOpenError(null);
    setIsLeaveOpenModalOpen(true);
  };

  const handleConfirmLeaveOpenAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveOpenError(null);

    const trimmedName = newAccountNameInput.trim();
    if (!trimmedName) {
      setLeaveOpenError(
        'Ingresa un nombre para identificar la cuenta abierta (ej. Mesa 1, Pedro, Pedido oficina).'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await useCases.sales.createOpenSaleAccount.execute(actor, {
        accountName: trimmedName,
        items: activeLines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantityInput),
          unitSalePrice: l.unitSalePrice,
        })),
      });

      setIsLeaveOpenModalOpen(false);
      setNewSaleLines([]);
      setNewAccountNameInput('');
      notifyDataChanged();
      setWorkspaceSuccess(
        `Cuenta abierta creada como ${formatSaleDisplayLabel(result.sale)}. Puedes seguir creando nuevas ventas o seleccionar cualquier cuenta en el menú lateral.`
      );
    } catch (err) {
      setLeaveOpenError(
        err instanceof Error
          ? err.message
          : 'No fue posible guardar la cuenta abierta.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Flujo 5: Guardar cambios en una cuenta abierta existente
  const handleSaveOpenAccountChanges = async () => {
    if (!selectedSaleId) return;
    setWorkspaceError(null);
    setWorkspaceSuccess(null);

    if (!openAccountName.trim()) {
      setWorkspaceError('El nombre de la cuenta abierta es obligatorio.');
      return;
    }

    if (!validateCurrentDraftLines()) return;

    setIsSubmitting(true);
    try {
      const result = await useCases.sales.updateOpenSaleAccount.execute(actor, {
        saleId: selectedSaleId,
        accountName: openAccountName.trim(),
        items: openAccountLines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantityInput),
          unitSalePrice: l.unitSalePrice,
        })),
        expectedUpdatedAt,
        syncToCatalogPrices: true,
      });

      setExpectedUpdatedAt(result.sale.updatedAt);
      setIsOpenAccountDirty(false);
      notifyDataChanged();
      setWorkspaceSuccess(
        `Cambios guardados en ${formatSaleDisplayLabel(result.sale)}. Las existencias fueron descontadas de almacén; los ingresos se computarán al liquidar la cuenta.`
      );
    } catch (err) {
      setWorkspaceError(
        err instanceof Error
          ? err.message
          : 'No fue posible actualizar la cuenta abierta.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Flujo 6 y 7: Preparar y confirmar Despacho (Directo o de Cuenta Abierta)
  const handleOpenDispatchModal = () => {
    setWorkspaceError(null);
    setWorkspaceSuccess(null);

    if (isEditingOpenAccount && !openAccountName.trim()) {
      setWorkspaceError('El nombre de la cuenta abierta no puede estar vacío.');
      return;
    }

    if (!validateCurrentDraftLines()) return;

    setDispatchOperationId(generateEntityId());
    setDispatchTransferAmountInput('');
    setDispatchError(null);
    setIsDispatchModalOpen(true);
  };

  const handleConfirmDispatch = async () => {
    setDispatchError(null);

    const parsedTransfer = Number(dispatchTransferAmountInput.trim());
    const transferAmountToPass =
      !isNaN(parsedTransfer) && parsedTransfer > 0 ? parsedTransfer : 0;

    if (transferAmountToPass > catalogSyncedTotalAmount) {
      setDispatchError(
        `El monto por transferencia (${formatCurrency(transferAmountToPass)}) no puede ser mayor al total a despachar (${formatCurrency(catalogSyncedTotalAmount)}).`
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await useCases.sales.dispatchSale.execute(actor, {
        saleId: isEditingOpenAccount ? selectedSaleId : undefined,
        accountName: isEditingOpenAccount ? openAccountName.trim() : undefined,
        items: activeLines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantityInput),
        })),
        expectedUpdatedAt: isEditingOpenAccount ? expectedUpdatedAt : undefined,
        requirePriceSyncConfirmation: true,
        confirmCatalogPriceUpdates: true,
        transferAmount: transferAmountToPass,
        operationId: dispatchOperationId,
      });

      setIsDispatchModalOpen(false);
      setIsOpenAccountDirty(false);
      if (isEditingOpenAccount) {
        setEditingSaleId(null);
      } else {
        setNewSaleLines([]);
      }
      notifyDataChanged();

      const label = formatSaleDisplayLabel(result.sale);
      setWorkspaceSuccess(
        `Mercancía despachada correctamente (${label} · Total ${formatCurrency(result.sale.totalAmount ?? 0)}). Se descontaron las existencias en almacén y se registraron ${result.movements.length} movimiento(s) de salida en Kardex.`
      );
      setDispatchedReceiptSale(result.sale);

      if (isEditingOpenAccount) {
        navigate(ROUTES.openSales);
      }
    } catch (err) {
      setDispatchError(
        err instanceof Error
          ? err.message
          : 'No fue posible completar el despacho de mercancía.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Flujo 12: Cancelación controlada de una cuenta abierta
  const handleOpenCancelAccountModal = () => {
    setCancelReasonInput('');
    setCancelAccountError(null);
    setIsCancelAccountModalOpen(true);
  };

  const handleConfirmCancelAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaleId) return;
    setCancelAccountError(null);

    const reason = cancelReasonInput.trim();
    if (!reason) {
      setCancelAccountError(
        'Debes indicar el motivo obligatorio de cancelación de la cuenta abierta.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await useCases.sales.cancelOpenSaleAccount.execute(actor, {
        saleId: selectedSaleId,
        reason,
        expectedUpdatedAt,
      });

      setIsCancelAccountModalOpen(false);
      setIsOpenAccountDirty(false);
      setEditingSaleId(null);
      notifyDataChanged();
      setWorkspaceSuccess(
        `La cuenta abierta ${formatSaleDisplayLabel(result.sale)} fue cancelada con registro de auditoría. No se descontaron existencias.`
      );
      navigate(ROUTES.openSales);
    } catch (err) {
      setCancelAccountError(
        err instanceof Error
          ? err.message
          : 'No fue posible cancelar la cuenta abierta.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAccountsCount = openSalesList?.length ?? 0;

  const directoryColumns: readonly TableColumn<SaleRecord>[] = [
    {
      key: 'folio',
      header: 'Cuenta (#Consecutivo — Nombre)',
      render: (row) => (
        <span className="font-semibold text-[#123F55]">
          {formatSaleDisplayLabel(row)}
        </span>
      ),
    },
    {
      key: 'itemsCount',
      header: 'Partidas',
      align: 'right',
      tabular: true,
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-slate-700">
          {row.items?.length ?? 0}
        </span>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Importe estimado',
      align: 'right',
      tabular: true,
      render: (row) => (
        <span className="font-mono text-xs font-bold text-slate-900">
          {formatCurrency(row.totalAmount ?? 0)}
        </span>
      ),
    },
    {
      key: 'openedAt',
      header: 'Apertura / Responsable',
      tabular: true,
      render: (row) => (
        <div className="text-xs text-slate-600">
          <div>{formatDateTime(row.openedAt)}</div>
          <div className="text-[11px] text-slate-400">
            {row.openedByUserLabel ?? 'Sesión local'}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Acción',
      align: 'right',
      render: (row) => (
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(ROUTES.openSaleDetail(row.id))}
        >
          Abrir y editar
        </Button>
      ),
    },
  ];

  // Si se solicitó un ID de cuenta abierta que ya no existe o ya fue despachada/cancelada
  if (selectedSaleId && !selectedSaleQuery.isLoading && !selectedSaleRecord) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Cuenta no disponible en cuentas abiertas"
          subtitle="La cuenta solicitada ya fue despachada, cancelada o no existe en el almacenamiento local."
          actions={
            <Button
              variant="secondary"
              size="md"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate(ROUTES.openSales)}
            >
              Ir a mesa de ventas
            </Button>
          }
        />

        {workspaceSuccess && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>{workspaceSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setWorkspaceSuccess(null)}
              className="text-xs text-emerald-800 underline cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}

        <Card>
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title="La cuenta ya no permanece abierta"
            description="Selecciona otra cuenta abierta en el menú lateral o inicia una nueva venta."
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate(ROUTES.openSales)}
                >
                  Preparar nueva venta
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(ROUTES.salesHistory)}
                >
                  Consultar historial de ventas
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          isEditingOpenAccount && selectedSaleRecord
            ? `Cuenta abierta · ${formatSaleDisplayLabel(selectedSaleRecord)}`
            : 'Ventas y Despacho de Mercancía'
        }
        subtitle={
          isEditingOpenAccount
            ? 'Edición de partidas, sincronización de existencias en tiempo real y confirmación de despacho físico.'
            : 'Preparación de cuentas abiertas simultáneas y despacho físico de mercancía.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isEditingOpenAccount ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => navigate(ROUTES.openSales)}
              >
                Ir a Nueva venta
              </Button>
            ) : (
              <div
                role="group"
                aria-label="Cambiar vista de ventas"
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"
              >
                <button
                  type="button"
                  onClick={() => setUnselectedMode('NEW_SALE')}
                  className={[
                    'h-8 rounded-md px-3 text-xs font-semibold transition-colors cursor-pointer',
                    unselectedMode === 'NEW_SALE'
                      ? 'bg-[#123F55] text-white'
                      : 'text-slate-600 hover:text-slate-900',
                  ].join(' ')}
                >
                  Nueva venta
                </button>
                <button
                  type="button"
                  onClick={() => setUnselectedMode('DIRECTORY')}
                  className={[
                    'h-8 rounded-md px-3 text-xs font-semibold transition-colors cursor-pointer',
                    unselectedMode === 'DIRECTORY'
                      ? 'bg-[#123F55] text-white'
                      : 'text-slate-600 hover:text-slate-900',
                  ].join(' ')}
                >
                  Cuentas abiertas ({openAccountsCount})
                </button>
              </div>
            )}

            <Button
              variant="secondary"
              size="sm"
              icon={<History className="h-3.5 w-3.5" />}
              onClick={() => navigate(ROUTES.salesHistory)}
            >
              Historial
            </Button>
          </div>
        }
      />

      {/* Barra rápida de alternancia entre Nueva Venta y Cuentas Abiertas simultáneas */}
      {openSalesList && openSalesList.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-2xs">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Cuentas activas ({openSalesList.length}):
          </span>
          <button
            type="button"
            onClick={() => {
              if (isEditingOpenAccount) {
                navigate(ROUTES.openSales);
              } else {
                setUnselectedMode('NEW_SALE');
              }
            }}
            className={[
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
              !isEditingOpenAccount && unselectedMode === 'NEW_SALE'
                ? 'bg-[#F49D37] text-slate-950'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ].join(' ')}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nueva venta</span>
          </button>

          {openSalesList.map((openAcc) => {
            const isSelected = selectedSaleId === openAcc.id;
            const label = formatSaleDisplayLabel(openAcc);
            return (
              <button
                key={openAcc.id}
                type="button"
                onClick={() => navigate(ROUTES.openSaleDetail(openAcc.id))}
                className={[
                  'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-[#123F55] text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100',
                ].join(' ')}
              >
                <span>{label}</span>
                <span
                  className={[
                    'font-mono text-[11px]',
                    isSelected ? 'text-[#F49D37]' : 'text-slate-500',
                  ].join(' ')}
                >
                  {formatCurrency(openAcc.totalAmount ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Aviso de bloqueo si no hay jornada abierta o está en proceso de cierre */}
      {!salesValidation.canOperateSales && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
        >
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-950">
              Operaciones de venta bloqueadas por estado de jornada
            </p>
            <p className="mt-0.5">{salesValidation.message}</p>
            {isEditingOpenAccount && (
              <p className="mt-1 text-[11px] text-amber-800">
                Esta cuenta permanece guardada con sus existencias ya descontadas del almacén. No se le pueden añadir más productos hasta que se abra una nueva jornada. Su despacho y liquidación se realizará de forma manual una vez iniciada la nueva jornada.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Banners de éxito y error */}
      {workspaceSuccess && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{workspaceSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceSuccess(null)}
            className="text-xs text-emerald-800 underline cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {workspaceError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs font-medium text-red-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" />
            <span>{workspaceError}</span>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceError(null)}
            className="text-xs text-red-800 underline cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Vista Directorio de cuentas abiertas cuando el usuario elige ver la tabla completa */}
      {!isEditingOpenAccount && unselectedMode === 'DIRECTORY' ? (
        <Card>
          <CardHeader
            title={`Cuentas abiertas en curso (${openAccountsCount})`}
            description="Selecciona cualquier cuenta abierta para agregar o quitar productos, renombrarla, cancelarla con motivo o confirmar el despacho de mercancía."
            action={
              canCreateSale && salesValidation.canOperateSales ? (
                <Button
                  variant="accent"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setUnselectedMode('NEW_SALE')}
                >
                  Preparar nueva venta
                </Button>
              ) : undefined
            }
          />
          <DataTable
            columns={directoryColumns}
            rows={openSalesList ?? []}
            getRowKey={(row) => row.id}
            isLoading={isLoadingOpenSales}
            emptyIcon={<ReceiptText className="h-5 w-5" />}
            emptyTitle="No existen cuentas abiertas"
            emptyDescription="Actualmente no hay cuentas pendientes de despacho en el establecimiento."
            emptyAction={
              canCreateSale && salesValidation.canOperateSales ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setUnselectedMode('NEW_SALE')}
                >
                  Preparar nueva venta
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        /* Mesa de trabajo principal: Buscador de productos + Partidas de la venta o cuenta abierta */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* COLUMNA IZQUIERDA (5 cols): Buscador y selección de productos */}
          <div className="space-y-4 lg:col-span-5">
            <Card>
              <CardHeader
                title={`Catálogo de productos para venta (${filteredProducts.length})`}
                description="Busca por nombre, código o SKU. Todos los productos activos del almacén."
              />
              <CardBody className="space-y-4 pt-0">
                <TextInput
                  aria-label="Buscar producto por nombre, código o SKU"
                  placeholder="Buscar por nombre, código o SKU…"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  leadingIcon={<Search className="h-4 w-4" />}
                />

                {isLoadingProducts ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    Cargando catálogo de productos…
                  </p>
                ) : filteredProducts.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                    {productSearch.trim()
                      ? 'Sin coincidencias en el catálogo para el criterio buscado.'
                      : 'No hay productos activos con existencias disponibles para la venta.'}
                  </div>
                ) : (
                  <div className="max-h-[460px] divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200">
                    {filteredProducts.map((product) => {
                      const isSelectable =
                        product.availability === ProductAvailability.AVAILABLE &&
                        salesValidation.canOperateSales &&
                        canCreateSale;

                      const qtyInCart =
                        activeLines.find((l) => l.productId === product.id)
                          ?.quantity ?? 0;

                      return (
                        <div
                          key={product.id}
                          className={[
                            'flex items-center justify-between gap-3 p-3 transition-colors',
                            isSelectable
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-slate-50/70 opacity-75',
                          ].join(' ')}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-semibold text-slate-900 truncate">
                                {product.name}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                {product.sku || product.code}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                              <span className="font-mono font-bold text-[#123F55]">
                                {formatCurrency(product.salePrice)} / {product.unitLabel}
                              </span>
                              <span>
                                Stock:{' '}
                                <strong
                                  className={
                                    product.stockQuantity > 0
                                      ? 'font-mono text-emerald-700'
                                      : 'font-mono text-red-600'
                                  }
                                >
                                  {product.stockQuantity} {product.unitLabel}
                                </strong>
                              </span>
                              {qtyInCart > 0 && (
                                <span className="rounded bg-[#1A5F7A]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#1A5F7A]">
                                  En cuenta: {qtyInCart}
                                </span>
                              )}
                            </div>

                            {product.status === ProductStatus.INACTIVE && (
                              <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                                Producto inactivo (no habilitado para venta)
                              </span>
                            )}
                            {product.status === ProductStatus.ACTIVE &&
                              product.stockQuantity <= 0 && (
                                <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                  Agotado en almacén
                                </span>
                              )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              max={product.stockQuantity}
                              disabled={!isSelectable}
                              aria-label={`Cantidad a agregar de ${product.name}`}
                              value={quickAddQuantities[product.id] ?? '1'}
                              onChange={(e) =>
                                setQuickAddQuantities((prev) => ({
                                  ...prev,
                                  [product.id]: e.target.value,
                                }))
                              }
                              className="h-8 w-16 rounded-md border border-slate-300 bg-white px-2 text-right font-mono text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none disabled:bg-slate-100"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!isSelectable}
                              icon={<Plus className="h-3.5 w-3.5" />}
                              onClick={() => handleAddProductToSale(product)}
                            >
                              Añadir
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* COLUMNA DERECHA (7 cols): Detalle de la cuenta / Partidas y Acciones principales */}
          <div className="space-y-4 lg:col-span-7">
            <Card>
              <CardHeader
                title={
                  isEditingOpenAccount && selectedSaleRecord
                    ? `${selectedSaleRecord.folio} — ${openAccountName || 'Sin nombre'}`
                    : 'Nueva venta en preparación'
                }
                description={
                  isEditingOpenAccount && selectedSaleRecord
                    ? `Cuenta abierta el ${formatDateTime(selectedSaleRecord.openedAt)} · Responsable: ${selectedSaleRecord.openedByUserLabel ?? actor.label}`
                    : 'Agrega productos del catálogo para dejar una cuenta abierta o realizar un despacho directo.'
                }
                action={
                  isEditingOpenAccount && isOpenAccountDirty ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-300 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Cambios sin guardar
                    </span>
                  ) : undefined
                }
              />

              <CardBody className="space-y-4 pt-0">
                {/* Campo para renombrar la cuenta cuando se edita una cuenta abierta */}
                {isEditingOpenAccount && selectedSaleRecord && (
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex-1">
                      <label
                        htmlFor="open-account-name-input"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Nombre o referencia de la cuenta abierta ({selectedSaleRecord.folio})
                      </label>
                      <div className="relative">
                        <input
                          id="open-account-name-input"
                          type="text"
                          value={openAccountName}
                          onChange={(e) => {
                            setOpenAccountName(e.target.value);
                            setIsOpenAccountDirty(true);
                          }}
                          placeholder="Ej. Mesa 1, Pedro, Mostrador 2, Pedido oficina…"
                          className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Etiqueta visible:{' '}
                      <strong className="text-[#123F55]">
                        {selectedSaleRecord.folio} — {openAccountName.trim() || '…'}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Alertas de sincronización en tiempo real con el catálogo (stock / inactividad / cambio de precio) */}
                {hasBlockingLineIssues && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3.5 text-xs text-red-900"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-700 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        Despacho bloqueado por disponibilidad o estado de productos
                      </p>
                      <p className="mt-0.5 text-red-800">
                        Uno o más productos de esta cuenta quedaron sin existencias suficientes o
                        fueron desactivados en almacén. Ajusta la cantidad o retira el producto
                        señalado antes de confirmar el despacho.
                      </p>
                    </div>
                  </div>
                )}

                {hasCatalogPriceDifferences && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"
                  >
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 shrink-0 text-blue-700" />
                      <span>
                        El precio de venta de uno o más productos se actualizó en el catálogo
                        mientras la cuenta estaba abierta (Total con precios vigentes:{' '}
                        <strong>{formatCurrency(catalogSyncedTotalAmount)}</strong>).
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSyncCatalogPrices}
                    >
                      Aplicar precios vigentes
                    </Button>
                  </div>
                )}

                {/* Tabla de partidas de la cuenta / venta */}
                {evaluatedLines.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-10 text-center">
                    <ReceiptText className="mx-auto h-6 w-6 text-slate-400" />
                    <p className="mt-2 text-xs font-semibold text-slate-700">
                      Aún no se han agregado productos
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Selecciona productos del panel izquierdo para armar la cuenta.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-x-auto overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          <th className="px-3 py-2.5 bg-slate-50">Producto</th>
                          <th className="px-3 py-2.5 text-center bg-slate-50">Cantidad</th>
                          <th className="px-3 py-2.5 text-right bg-slate-50">Precio unit.</th>
                          <th className="px-3 py-2.5 text-right bg-slate-50">Subtotal</th>
                          <th className="px-3 py-2.5 text-right bg-slate-50">Quitar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {evaluatedLines.map((line) => (
                          <tr
                            key={line.productId}
                            className={
                              line.blocksDispatch ? 'bg-red-50/60' : 'hover:bg-slate-50/70'
                            }
                          >
                            <td className="px-3 py-2.5">
                              <div className="font-semibold text-slate-900">
                                {line.productName}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                <span className="font-mono">
                                  {line.sku || line.productCode}
                                </span>
                                <span>·</span>
                                <span>Unidad: {line.unitLabel}</span>
                                <span>·</span>
                                <span>
                                  Almacén:{' '}
                                  <strong className="font-mono text-slate-700">
                                    {line.availableStock}
                                  </strong>
                                </span>
                                {isEditingOpenAccount && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      En cuenta:{' '}
                                      <strong className="font-mono text-[#1A5F7A]">
                                        {line.savedAccountQty}
                                      </strong>
                                    </span>
                                  </>
                                )}
                              </div>
                              {line.issueText && (
                                <div className="mt-1 rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                                  {line.issueText}
                                </div>
                              )}
                              {line.hasPriceChanged && (
                                <div className="mt-1 rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-900">
                                  Precio vigente en catálogo:{' '}
                                  <strong>
                                    {formatCurrency(line.currentCatalogPrice)}
                                  </strong>{' '}
                                  (guardado: {formatCurrency(line.unitSalePrice)})
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-2.5">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`Disminuir cantidad de ${line.productName}`}
                                  onClick={() =>
                                    handleStepLineQuantity(line.productId, -1)
                                  }
                                  disabled={line.quantity <= 1}
                                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  aria-label={`Cantidad de ${line.productName}`}
                                  value={line.quantityInput}
                                  onChange={(e) =>
                                    handleLineQuantityInputChange(
                                      line.productId,
                                      e.target.value
                                    )
                                  }
                                  className="h-7 w-16 rounded border border-slate-300 bg-white px-1.5 text-center font-mono text-xs font-semibold text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  aria-label={`Aumentar cantidad de ${line.productName}`}
                                  onClick={() =>
                                    handleStepLineQuantity(line.productId, 1)
                                  }
                                  disabled={line.quantity >= line.maxAllowedQuantity}
                                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </td>

                            <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums">
                              {formatCurrency(line.unitSalePrice)}
                            </td>

                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 tabular-nums">
                              {formatCurrency(line.lineSubtotal)}
                            </td>

                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(line.productId)}
                                title="Quitar producto de la cuenta"
                                aria-label={`Quitar ${line.productName}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Resumen económico e importe total */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <div>
                      Partidas en la cuenta:{' '}
                      <strong className="font-mono text-slate-900">
                        {evaluatedLines.length}
                      </strong>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      El stock se descuenta exclusivamente al confirmar el despacho de mercancía.
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Importe total de la venta
                    </span>
                    <span className="font-mono text-2xl font-bold tabular-nums text-[#123F55]">
                      {formatCurrency(currentTotalAmount)}
                    </span>
                  </div>
                </div>

                {/* Botonera de acciones principales (Dejar abierta / Guardar cambios / Cancelar / Despachar) */}
                {canCreateSale && (
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    {isEditingOpenAccount ? (
                      <>
                        <Button
                          variant="secondary"
                          size="md"
                          icon={<XCircle className="h-4 w-4 text-red-600" />}
                          disabled={isSubmitting}
                          onClick={handleOpenCancelAccountModal}
                        >
                          Cancelar cuenta
                        </Button>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            size="md"
                            icon={<Save className="h-4 w-4" />}
                            disabled={
                              isSubmitting ||
                              !salesValidation.canOperateSales ||
                              evaluatedLines.length === 0
                            }
                            onClick={handleSaveOpenAccountChanges}
                          >
                            Guardar cambios
                          </Button>

                          <Button
                            variant="accent"
                            size="md"
                            icon={<PackageCheck className="h-4 w-4" />}
                            disabled={
                              isSubmitting ||
                              !salesValidation.canOperateSales ||
                              evaluatedLines.length === 0 ||
                              hasBlockingLineIssues
                            }
                            onClick={handleOpenDispatchModal}
                          >
                            Despachar
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSubmitting || evaluatedLines.length === 0}
                          onClick={() => {
                            setNewSaleLines([]);
                            setWorkspaceError(null);
                          }}
                        >
                          Limpiar partidas
                        </Button>

                        <div className="flex flex-wrap items-center gap-2.5">
                          <Button
                            variant="secondary"
                            size="md"
                            icon={<BookmarkPlus className="h-4 w-4" />}
                            disabled={
                              isSubmitting ||
                              !salesValidation.canOperateSales ||
                              evaluatedLines.length === 0 ||
                              hasBlockingLineIssues
                            }
                            onClick={handleOpenLeaveAccountModal}
                          >
                            Dejar abierta
                          </Button>

                          <Button
                            variant="accent"
                            size="md"
                            icon={<PackageCheck className="h-4 w-4" />}
                            disabled={
                              isSubmitting ||
                              !salesValidation.canOperateSales ||
                              evaluatedLines.length === 0 ||
                              hasBlockingLineIssues
                            }
                            onClick={handleOpenDispatchModal}
                          >
                            Despachar
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: DEJAR CUENTA ABIERTA (SOLICITA NOMBRE OBLIGATORIO)           */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isLeaveOpenModalOpen}
        onClose={() => !isSubmitting && setIsLeaveOpenModalOpen(false)}
        title="Dejar cuenta abierta"
        description="El sistema asignará automáticamente el siguiente número consecutivo único (#001, #002…) y conservará la cuenta en el menú lateral."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsLeaveOpenModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="leave-open-account-form"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
              icon={<BookmarkPlus className="h-4 w-4" />}
            >
              {isSubmitting ? 'Guardando cuenta…' : 'Guardar cuenta abierta'}
            </Button>
          </>
        }
      >
        <form id="leave-open-account-form" onSubmit={handleConfirmLeaveOpenAccount} className="space-y-4">
          {leaveOpenError && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900"
            >
              {leaveOpenError}
            </div>
          )}

          <div>
            <label
              htmlFor="leave-open-account-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Nombre de la cuenta abierta (obligatorio)
            </label>
            <input
              id="leave-open-account-name"
              type="text"
              autoFocus
              value={newAccountNameInput}
              onChange={(e) => setNewAccountNameInput(e.target.value)}
              placeholder="Ej. Mesa 1, Pedro, Mostrador 2, Terraza, Pedido oficina…"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Texto libre para identificar la cuenta rápidamente. No requiere ficha de cliente.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Partidas a conservar:</span>
              <strong className="font-mono text-slate-900">
                {evaluatedLines.length} producto(s)
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Importe acumulado:</span>
              <strong className="font-mono text-[#123F55]">
                {formatCurrency(currentTotalAmount)}
              </strong>
            </div>
            <p className="pt-1 text-[11px] text-slate-500">
              Al dejar la cuenta abierta no se descuentan existencias ni se generan movimientos en
              Kardex hasta su despacho.
            </p>
          </div>
        </form>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 2: CONFIRMACIÓN DE DESPACHO DE MERCANCÍA                        */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isDispatchModalOpen}
        onClose={() => !isSubmitting && setIsDispatchModalOpen(false)}
        title={
          isEditingOpenAccount && selectedSaleRecord
            ? `Confirmar despacho · ${selectedSaleRecord.folio} — ${openAccountName}`
            : 'Confirmar despacho directo de mercancía'
        }
        description="Revisa el resumen de partidas e importes. Al confirmar se descontarán las existencias reales y se registrará la salida en Kardex."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsDispatchModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="accent"
              size="sm"
              disabled={isSubmitting}
              icon={<PackageCheck className="h-4 w-4" />}
              onClick={handleConfirmDispatch}
            >
              {isSubmitting ? 'Procesando despacho…' : 'Confirmar despacho'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dispatchError && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900"
            >
              {dispatchError}
            </div>
          )}

          {hasCatalogPriceDifferences && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
              <strong>Actualización de precio detectada:</strong> Uno o más productos cambiaron su
              precio en el catálogo mientras la cuenta permaneció abierta. El resumen muestra el
              precio vigente que quedará congelado al confirmar el despacho.
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="px-3 py-2 bg-slate-50">Producto</th>
                  <th className="px-3 py-2 text-right bg-slate-50">Cant.</th>
                  <th className="px-3 py-2 text-right bg-slate-50">Precio unit.</th>
                  <th className="px-3 py-2 text-right bg-slate-50">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {evaluatedLines.map((line) => (
                  <tr key={line.productId}>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {line.productName}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {line.quantity} {line.unitLabel}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {formatCurrency(line.currentCatalogPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                      {formatCurrency(line.catalogSubtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-xs font-semibold text-slate-700">
              Importe total a despachar:
            </span>
            <span className="font-mono text-lg font-bold text-[#123F55]">
              {formatCurrency(catalogSyncedTotalAmount)}
            </span>
          </div>

          {/* Desglose de Forma de Pago: Transferencia vs. Efectivo */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 space-y-3">
            <h4 className="text-xs font-bold text-[#123F55]">
              Forma de Pago (Transferencia / Efectivo)
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="dispatch-transfer-input"
                  className="block text-[11px] font-semibold text-slate-700 mb-1"
                >
                  Monto por transferencia ($)
                </label>
                <input
                  id="dispatch-transfer-input"
                  type="number"
                  step="any"
                  min="0"
                  max={catalogSyncedTotalAmount}
                  placeholder="0.00 (Si se omite, 100% efectivo)"
                  value={dispatchTransferAmountInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    const num = Number(val);
                    if (num > catalogSyncedTotalAmount) {
                      setDispatchTransferAmountInput(String(catalogSyncedTotalAmount));
                    } else {
                      setDispatchTransferAmountInput(val);
                    }
                  }}
                  className="w-full h-8 rounded border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-slate-500">
                  Si no ingresas un valor, el sistema asumirá pago 100% en efectivo.
                </p>
              </div>

              <div>
                <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Efectivo en caja (calculado automáticamente)
                </span>
                {(() => {
                  const parsed = Number(dispatchTransferAmountInput.trim());
                  const transferVal = !isNaN(parsed) && parsed > 0 ? Math.min(parsed, catalogSyncedTotalAmount) : 0;
                  const cashVal = Math.max(0, Math.round((catalogSyncedTotalAmount - transferVal) * 100) / 100);
                  return (
                    <div className="h-8 flex items-center justify-between rounded border border-slate-200 bg-emerald-50/70 px-3 font-mono text-xs font-bold text-emerald-900">
                      <span>{formatCurrency(cashVal)}</span>
                      {transferVal > 0 && (
                        <span className="text-[10px] text-emerald-700 font-medium">
                          (Transf: {formatCurrency(transferVal)})
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 3: CANCELACIÓN AUDITADA DE CUENTA ABIERTA                       */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isCancelAccountModalOpen}
        onClose={() => !isSubmitting && setIsCancelAccountModalOpen(false)}
        title="Cancelar cuenta abierta"
        description={
          selectedSaleRecord
            ? `Se cancelará la cuenta ${formatSaleDisplayLabel(selectedSaleRecord)} sin descontar existencias y conservando el registro para auditoría.`
            : 'Cancelación de cuenta abierta'
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setIsCancelAccountModalOpen(false)}
            >
              Volver
            </Button>
            <Button
              type="submit"
              form="cancel-open-account-form"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
              icon={<XCircle className="h-4 w-4" />}
            >
              {isSubmitting ? 'Cancelando…' : 'Confirmar cancelación'}
            </Button>
          </>
        }
      >
        <form id="cancel-open-account-form" onSubmit={handleConfirmCancelAccount} className="space-y-4">
          {cancelAccountError && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900"
            >
              {cancelAccountError}
            </div>
          )}

          <div>
            <label
              htmlFor="cancel-open-account-reason"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Motivo de cancelación (obligatorio)
            </label>
            <textarea
              id="cancel-open-account-reason"
              rows={3}
              value={cancelReasonInput}
              onChange={(e) => setCancelReasonInput(e.target.value)}
              placeholder="Ej. El cliente desistió del pedido antes de despachar la mercancía…"
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 4: ADVERTENCIA DE CAMBIOS SIN GUARDAR AL CAMBIAR DE CUENTA      */}
      {/* ===================================================================== */}
      <Modal
        isOpen={unsavedPrompt.isOpen}
        onClose={() => setUnsavedPrompt({ isOpen: false, nextAction: null })}
        title="Cambios sin guardar en la cuenta abierta"
        description="Has realizado modificaciones en las partidas o en el nombre de esta cuenta que aún no se han guardado."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Edit3 className="h-3.5 w-3.5" />}
              onClick={() => setUnsavedPrompt({ isOpen: false, nextAction: null })}
            >
              Permanecer en la cuenta
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                const action = unsavedPrompt.nextAction;
                setUnsavedPrompt({ isOpen: false, nextAction: null });
                if (action) action();
              }}
            >
              Descartar cambios y salir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-slate-600">
            ¿Deseas descartar los cambios no guardados y cambiar de vista, o permanecer en la
            cuenta actual para guardar tus modificaciones?
          </p>
        </div>
      </Modal>

      <DispatchReceiptModal
        isOpen={Boolean(dispatchedReceiptSale)}
        onClose={() => setDispatchedReceiptSale(null)}
        sale={dispatchedReceiptSale}
      />
    </div>
  );
}

