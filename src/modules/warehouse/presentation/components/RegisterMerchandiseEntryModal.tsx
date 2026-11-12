import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Calendar, DollarSign, Layers, Package, TrendingUp } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { FormField, TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { Permission } from '../../../../shared/types/permissions';
import { getExpirationStatus, getTodayLocalDateString, isFutureDate } from '../../../../shared/utils/date';
import { generateEntityId } from '../../../../shared/utils/id';
import {
  calculateProfitMarginPercentage,
  calculateTotalEntryCost,
  resolveSalePrice,
} from '../../../../shared/utils/money';
import { ProductCatalogViewItem, ProductRecord } from '../../domain/entities/ProductRecord';

export interface RegisterMerchandiseEntryModalProps {
  readonly isOpen: boolean;
  readonly product: ProductCatalogViewItem | null;
  readonly onClose: () => void;
  readonly onSuccess: (updatedProduct: ProductRecord, message: string) => void;
}

export function RegisterMerchandiseEntryModal({
  isOpen,
  product,
  onClose,
  onSuccess,
}: RegisterMerchandiseEntryModalProps) {
  const { actor, can } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  // Form Fields - initially clean and empty, never pre-filled
  const [receivedQuantity, setReceivedQuantity] = useState<string>('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState<string>('');
  const [declaredSalePrice, setDeclaredSalePrice] = useState<string>('');
  const [declaredEntryDate, setDeclaredEntryDate] = useState<string>(getTodayLocalDateString());
  const [expirationDate, setExpirationDate] = useState<string>('');

  // Idempotency token generated upon opening the modal
  const [operationId, setOperationId] = useState<string>(() => generateEntityId());

  // Submission & validation state
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Reset form whenever modal opens or active product changes
  useEffect(() => {
    if (isOpen) {
      setReceivedQuantity('');
      setUnitPurchasePrice('');
      setDeclaredSalePrice('');
      setDeclaredEntryDate(getTodayLocalDateString());
      setExpirationDate(product?.expirationDate || '');
      setFormError(null);
      setOperationId(generateEntityId());
    }
  }, [isOpen, product?.id, product?.expirationDate]);

  const expirationStatus = useMemo(
    () => getExpirationStatus(expirationDate),
    [expirationDate]
  );

  const handleClose = () => {
    if (isSubmitting) return;
    setFormError(null);
    onClose();
  };

  // Parsed numerical values for live reactive calculation
  const parsedQuantity = parseFloat(receivedQuantity);
  const parsedPurchasePrice = parseFloat(unitPurchasePrice);
  const parsedSalePrice = parseFloat(declaredSalePrice);

  const isQuantityValid = !Number.isNaN(parsedQuantity) && parsedQuantity > 0;
  const isPurchasePriceValid = !Number.isNaN(parsedPurchasePrice) && parsedPurchasePrice > 0;
  const isSalePriceValid = !Number.isNaN(parsedSalePrice) && parsedSalePrice > 0;

  // Real-time economic summary using domain rules
  const summary = useMemo(() => {
    if (!product) {
      return {
        resultingStock: null,
        totalCost: null,
        resolvedSale: null,
        marginPct: null,
        isSaleUnderCost: false,
        isPriceChanged: false,
      };
    }

    const resultingStock = isQuantityValid
      ? Math.round((product.stockQuantity + parsedQuantity) * 100) / 100
      : null;

    let totalCost: number | null = null;
    if (isQuantityValid && isPurchasePriceValid) {
      try {
        totalCost = calculateTotalEntryCost(parsedQuantity, parsedPurchasePrice);
      } catch {
        totalCost = null;
      }
    }

    let resolvedSale: number | null = null;
    let marginPct: number | null = null;
    let isSaleUnderCost = false;

    if (isSalePriceValid && isPurchasePriceValid) {
      try {
        resolvedSale = resolveSalePrice(parsedSalePrice, parsedPurchasePrice);
        marginPct = calculateProfitMarginPercentage(resolvedSale, parsedPurchasePrice);
      } catch {
        resolvedSale = Math.ceil(parsedSalePrice);
        if (resolvedSale < parsedPurchasePrice) {
          isSaleUnderCost = true;
        }
      }
    } else if (isSalePriceValid) {
      resolvedSale = Math.ceil(parsedSalePrice);
    }

    const isPriceChanged =
      resolvedSale !== null && Math.abs(resolvedSale - product.salePrice) > 0.0001;

    return {
      resultingStock,
      totalCost,
      resolvedSale,
      marginPct,
      isSaleUnderCost,
      isPriceChanged,
    };
  }, [product, isQuantityValid, isPurchasePriceValid, isSalePriceValid, parsedQuantity, parsedPurchasePrice, parsedSalePrice]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!product) return;

    setFormError(null);

    // Validations
    if (!receivedQuantity.trim() || !isQuantityValid) {
      setFormError('Introduce una cantidad recibida válida y mayor que cero.');
      return;
    }

    if (!unitPurchasePrice.trim() || !isPurchasePriceValid) {
      setFormError('Introduce un precio unitario de compra válido y mayor que cero.');
      return;
    }

    if (!declaredSalePrice.trim() || !isSalePriceValid) {
      setFormError('Introduce el precio de venta propuesto.');
      return;
    }

    if (summary.resolvedSale !== null && summary.resolvedSale < parsedPurchasePrice) {
      setFormError(
        `El precio de venta ($${summary.resolvedSale}) no puede ser inferior al precio de compra ($${parsedPurchasePrice.toFixed(2)}).`
      );
      return;
    }

    if (!declaredEntryDate.trim()) {
      setFormError('La fecha de entrada es obligatoria.');
      return;
    }

    if (isFutureDate(declaredEntryDate)) {
      setFormError('La fecha declarada de la entrada no puede ser futura.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await useCases.warehouse.registerMerchandiseEntry.execute(actor, {
        operationId,
        productId: product.id,
        receivedQuantity: parsedQuantity,
        unitPurchasePrice: parsedPurchasePrice,
        declaredSalePrice: parsedSalePrice,
        declaredEntryDate,
        expirationDate: expirationDate.trim() || null,
      });

      notifyDataChanged();

      const priceMsg = result.priceChange
        ? ` Nuevo precio de venta: $${result.product.currentSalePrice} (anterior: $${result.priceChange.previousSalePrice}).`
        : ` Precio de venta mantenido en $${result.product.currentSalePrice}.`;

      onSuccess(
        result.product,
        `Entrada de ${result.entry.quantity} unidades registrada exitosamente para «${result.product.name}». Existencia total: ${result.product.currentStock} ${product.unitLabel}.${priceMsg}`
      );
      onClose();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error inesperado al registrar la entrada de mercancía.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!product) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Nueva entrada de mercancía"
      description="Registra la recepción de existencias para un producto existente y actualiza costos y precios de venta."
      maxWidthClassName="max-w-2xl"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="register-entry-form"
            variant="primary"
            disabled={
              isSubmitting ||
              !isQuantityValid ||
              !isPurchasePriceValid ||
              !isSalePriceValid ||
              summary.isSaleUnderCost
            }
          >
            {isSubmitting ? 'Registrando...' : 'Registrar entrada'}
          </Button>
        </>
      }
    >
      <form id="register-entry-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Ficha técnica del producto (Solo lectura) */}
        <div className="rounded-lg border border-slate-200 bg-[#F8F9FA] p-4 text-xs">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                Producto a ingresar
              </span>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">{product.name}</h3>
              <div className="text-slate-500 text-[11px] mt-0.5">
                {product.code} {product.sku ? `· SKU: ${product.sku}` : '· Sin SKU'}
              </div>
            </div>
            <div className="text-right">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                Existencia actual
              </span>
              <div className="text-base font-bold text-[#123F55] mt-0.5">
                {product.stockQuantity.toFixed(2)}{' '}
                <span className="text-xs font-normal text-slate-600">{product.unitLabel}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            <div>
              <span className="text-slate-500 block">Categoría:</span>
              <span className="font-medium text-slate-800">{product.categoryLabel}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Unidad de medida:</span>
              <span className="font-medium text-slate-800">{product.unitLabel}</span>
            </div>
            {canViewCosts && (
              <div>
                <span className="text-slate-500 block">Último costo compra:</span>
                <span className="font-medium text-slate-800">
                  {product.purchaseCost !== undefined ? `$${product.purchaseCost.toFixed(2)}` : '—'}
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-500 block">Precio venta actual:</span>
              <span className="font-semibold text-[#123F55]">${product.salePrice}</span>
            </div>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
            <span>{formError}</span>
          </div>
        )}

        {/* Inputs obligatorios para la nueva entrada */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="received-quantity"
            label={`Cantidad recibida (${product.unitLabel}) *`}
            helperText="Mayor que cero, hasta dos decimales."
          >
            <TextInput
              id="received-quantity"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={receivedQuantity}
              onChange={(e) => setReceivedQuantity(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              required
            />
          </FormField>

          <FormField
            id="declared-entry-date"
            label="Fecha de entrada declarada *"
            helperText="Permite fechas pasadas. No permite fechas futuras."
          >
            <TextInput
              id="declared-entry-date"
              type="date"
              max={getTodayLocalDateString()}
              value={declaredEntryDate}
              onChange={(e) => setDeclaredEntryDate(e.target.value)}
              disabled={isSubmitting}
              leadingIcon={<Calendar className="h-4 w-4" />}
              required
            />
          </FormField>

          <FormField
            id="unit-purchase-price"
            label="Precio de compra unitario *"
            helperText="Costo de adquisición de este lote (sin autocompletar)."
          >
            <TextInput
              id="unit-purchase-price"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={unitPurchasePrice}
              onChange={(e) => setUnitPurchasePrice(e.target.value)}
              disabled={isSubmitting}
              leadingIcon={<DollarSign className="h-4 w-4" />}
              required
            />
          </FormField>

          <FormField
            id="declared-sale-price"
            label="Precio de venta propuesto *"
            helperText="Pesos enteros. Debe ser mayor o igual al costo."
          >
            <TextInput
              id="declared-sale-price"
              type="number"
              step="1"
              min="1"
              placeholder="0"
              value={declaredSalePrice}
              onChange={(e) => setDeclaredSalePrice(e.target.value)}
              disabled={isSubmitting}
              leadingIcon={<DollarSign className="h-4 w-4" />}
              required
            />
          </FormField>

          <FormField
            id="entry-expiration-date"
            label="Fecha de vencimiento (Mes y Año)"
            helperText="Solo mes y año (sin día). Alerta preventiva automática con 1 año o menos."
          >
            <TextInput
              id="entry-expiration-date"
              type="month"
              placeholder="AAAA-MM"
              value={expirationDate ? expirationDate.slice(0, 7) : ''}
              onChange={(e) => setExpirationDate(e.target.value)}
              disabled={isSubmitting}
              leadingIcon={<Calendar className="h-4 w-4" />}
            />
          </FormField>
        </div>

        {expirationDate && (
          <div
            className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
              expirationStatus.status === 'EXPIRED'
                ? 'border-red-300 bg-red-50 text-red-900'
                : expirationStatus.isAlert
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {expirationStatus.status === 'EXPIRED' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            ) : expirationStatus.isAlert ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            ) : (
              <Calendar className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            )}
            <div>
              <span className="font-semibold">
                {expirationStatus.status === 'EXPIRED'
                  ? '¡Atención: Producto vencido!'
                  : expirationStatus.isAlert
                  ? '⚠️ Alerta preventiva de vencimiento (≤ 1 año):'
                  : 'Fecha de vencimiento registrada:'}
              </span>{' '}
              {expirationStatus.status === 'EXPIRED'
                ? 'La fecha seleccionada ya caducó. Verifique el lote ingresado.'
                : expirationStatus.isAlert
                ? `A este lote le quedan ${expirationStatus.daysRemaining} días (${expirationStatus.label}) para vencer. El producto se marcará con alerta preventiva en el listado.`
                : `${expirationStatus.label}. Vencimiento seguro a más de 1 año.`}
            </div>
          </div>
        )}

        {/* Resumen económico en tiempo real */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-[#123F55]" />
              Resumen económico y de existencias
            </h4>
            {summary.isPriceChanged && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                Cambio de precio: ${product.salePrice} → ${summary.resolvedSale}
              </span>
            )}
            {summary.resolvedSale !== null && !summary.isPriceChanged && (
              <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                Precio de venta sin cambios (${product.salePrice})
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white p-2.5 rounded-md border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Existencia resultante</span>
              <span className="font-bold text-slate-900 text-sm">
                {summary.resultingStock !== null
                  ? `${summary.resultingStock.toFixed(2)} ${product.unitLabel}`
                  : '—'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {product.stockQuantity.toFixed(2)} + {isQuantityValid ? parsedQuantity.toFixed(2) : '0'}
              </span>
            </div>

            <div className="bg-white p-2.5 rounded-md border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Costo total entrada</span>
              <span className="font-bold text-slate-900 text-sm">
                {summary.totalCost !== null ? `$${summary.totalCost.toFixed(2)}` : '—'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Inversión en este lote
              </span>
            </div>

            <div className="bg-white p-2.5 rounded-md border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Precio venta final</span>
              <span className="font-bold text-[#123F55] text-sm">
                {summary.resolvedSale !== null ? `$${summary.resolvedSale}` : '—'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Entero garantizado
              </span>
            </div>

            <div className="bg-white p-2.5 rounded-md border border-slate-200">
              <span className="text-slate-500 block text-[11px]">Margen de ganancia</span>
              <span
                className={`font-bold text-sm ${
                  summary.isSaleUnderCost
                    ? 'text-red-600'
                    : summary.marginPct !== null
                    ? 'text-emerald-700'
                    : 'text-slate-900'
                }`}
              >
                {summary.isSaleUnderCost
                  ? 'Bajo costo'
                  : summary.marginPct !== null
                  ? `+${summary.marginPct.toFixed(2)}%`
                  : '—'}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                ((Venta / Costo) - 1) × 100
              </span>
            </div>
          </div>

          {summary.isSaleUnderCost && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>
                El precio de venta no puede ser inferior al precio de compra ($
                {parsedPurchasePrice.toFixed(2)}).
              </span>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
