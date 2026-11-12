import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Calendar, Plus } from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { FormField, SelectInput, TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { getExpirationStatus, getTodayLocalDateString, isFutureDate } from '../../../../shared/utils/date';
import {
  calculateProfitMarginPercentage,
  calculateTotalEntryCost,
  resolveSalePrice,
} from '../../../../shared/utils/money';
import { CategoryRecord } from '../../domain/entities/CategoryRecord';
import { MeasurementUnitRecord } from '../../domain/entities/MeasurementUnitRecord';
import { ProductRecord } from '../../domain/entities/ProductRecord';
import { CreateCategoryModal } from './CreateCategoryModal';
import { CreateMeasurementUnitModal } from './CreateMeasurementUnitModal';

export interface NewProductEntryModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess: (product: ProductRecord) => void;
}

export function NewProductEntryModal({
  isOpen,
  onClose,
  onSuccess,
}: NewProductEntryModalProps) {
  const { actor } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();

  // Queries for categories and units
  const { data: categories, reload: reloadCategories } = useAsyncQuery(
    () => useCases.warehouse.listCategories.execute(actor),
    [useCases.warehouse.listCategories, actor, dataRevision]
  );

  const { data: units, reload: reloadUnits } = useAsyncQuery(
    () => useCases.warehouse.listMeasurementUnits.execute(actor),
    [useCases.warehouse.listMeasurementUnits, actor, dataRevision]
  );


  // Form Fields
  const [name, setName] = useState<string>('');
  const [sku, setSku] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [measurementUnitId, setMeasurementUnitId] = useState<string>('');
  const [initialQuantity, setInitialQuantity] = useState<string>('');
  const [unitPurchasePrice, setUnitPurchasePrice] = useState<string>('');
  const [declaredSalePrice, setDeclaredSalePrice] = useState<string>('');
  const [declaredEntryDate, setDeclaredEntryDate] = useState<string>(
    getTodayLocalDateString()
  );
  const [expirationDate, setExpirationDate] = useState<string>('');

  // Modals for sub-catalogs
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState<boolean>(false);

  // Submission & validation state
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const resetForm = () => {
    setName('');
    setSku('');
    setCategoryId('');
    setMeasurementUnitId('');
    setInitialQuantity('');
    setUnitPurchasePrice('');
    setDeclaredSalePrice('');
    setDeclaredEntryDate(getTodayLocalDateString());
    setExpirationDate('');
    setFormError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  // Safe parsed numbers for live computation
  const parsedQuantity = parseFloat(initialQuantity);
  const parsedPurchasePrice = parseFloat(unitPurchasePrice);
  const parsedSalePrice = parseFloat(declaredSalePrice);

  const isQuantityValid = !Number.isNaN(parsedQuantity) && parsedQuantity > 0;
  const isPurchasePriceValid = !Number.isNaN(parsedPurchasePrice) && parsedPurchasePrice > 0;
  const isSalePriceValid = !Number.isNaN(parsedSalePrice) && parsedSalePrice > 0;

  // Live calculations
  const economicSummary = useMemo(() => {
    let totalCost: number | null = null;
    let resolvedSale: number | null = null;
    let marginPct: number | null = null;
    let isSaleUnderCost = false;

    if (isQuantityValid && isPurchasePriceValid) {
      try {
        totalCost = calculateTotalEntryCost(parsedQuantity, parsedPurchasePrice);
      } catch {
        totalCost = null;
      }
    }

    if (isSalePriceValid && isPurchasePriceValid) {
      try {
        resolvedSale = resolveSalePrice(parsedSalePrice, parsedPurchasePrice);
        marginPct = calculateProfitMarginPercentage(resolvedSale, parsedPurchasePrice);
      } catch {
        // May fail if sale price < purchase price
        resolvedSale = Math.ceil(parsedSalePrice);
        if (resolvedSale < parsedPurchasePrice) {
          isSaleUnderCost = true;
        }
      }
    } else if (isSalePriceValid) {
      resolvedSale = Math.ceil(parsedSalePrice);
    }

    return {
      totalCost,
      resolvedSale,
      marginPct,
      isSaleUnderCost,
    };
  }, [
    isQuantityValid,
    isPurchasePriceValid,
    isSalePriceValid,
    parsedQuantity,
    parsedPurchasePrice,
    parsedSalePrice,
  ]);

  const expirationStatus = useMemo(
    () => getExpirationStatus(expirationDate),
    [expirationDate]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    // Front-end Validations
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('El nombre del producto es obligatorio.');
      return;
    }

    if (!categoryId) {
      setFormError('Debe seleccionar una categoría para el producto.');
      return;
    }

    if (!measurementUnitId) {
      setFormError('Debe seleccionar una unidad de medida para el producto.');
      return;
    }

    if (!isQuantityValid) {
      setFormError('La cantidad recibida debe ser un número positivo mayor que cero.');
      return;
    }

    // Decimal count check on quantity (max 2)
    const qtyDecimals = (initialQuantity.split('.')[1] || '').length;
    if (qtyDecimals > 2) {
      setFormError('La cantidad de entrada admite como máximo dos decimales.');
      return;
    }

    if (!isPurchasePriceValid) {
      setFormError('El precio de compra debe ser un número positivo mayor que cero.');
      return;
    }

    const purchaseDecimals = (unitPurchasePrice.split('.')[1] || '').length;
    if (purchaseDecimals > 2) {
      setFormError('El precio de compra admite como máximo dos decimales.');
      return;
    }

    if (!isSalePriceValid) {
      setFormError('El precio de venta debe ser un número positivo mayor que cero.');
      return;
    }

    const resolvedSale = Math.ceil(parsedSalePrice);
    if (resolvedSale < parsedPurchasePrice) {
      setFormError(
        `El precio de venta ($${resolvedSale}) no puede ser menor que el costo de compra ($${parsedPurchasePrice.toFixed(2)}).`
      );
      return;
    }

    if (!declaredEntryDate) {
      setFormError('La fecha de entrada es obligatoria.');
      return;
    }

    if (isFutureDate(declaredEntryDate)) {
      setFormError('La fecha de entrada no puede ser una fecha futura.');
      return;
    }

    setIsSubmitting(true);

    try {
      const createdProduct = await useCases.warehouse.registerProductWithInitialEntry.execute(
        actor,
        {
          name: trimmedName,
          sku: sku.trim() || null,
          categoryId,
          measurementUnitId,
          initialQuantity: parsedQuantity,
          unitPurchasePrice: parsedPurchasePrice,
          declaredSalePrice: parsedSalePrice,
          declaredEntryDate,
          expirationDate: expirationDate.trim() || null,
        }
      );

      notifyDataChanged();
      resetForm();
      onSuccess(createdProduct);
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error inesperado al registrar la mercancía.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Nueva Mercancía"
        description="Registra un producto nuevo junto con su primera entrada de inventario."
        maxWidthClassName="max-w-3xl"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isSubmitting}
              onClick={handleClose}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="new-product-entry-form"
              variant="primary"
              size="md"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Guardando mercancía…' : 'Guardar y registrar entrada'}
            </Button>
          </>
        }
      >
        <form
          id="new-product-entry-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 sm:space-y-5"
        >
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div className="flex-1 font-medium">{formError}</div>
            </div>
          )}

          {/* SECCIÓN 1: DATOS DEL PRODUCTO */}
          <div className="space-y-3">
            <div className="border-b border-slate-200 pb-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#123F55]">
                1. Información del Producto
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
              <FormField
                id="product-name"
                label="Nombre del producto *"
                helperText="Nombre oficial identificativo. No podrá ser editado posteriormente."
              >
                <TextInput
                  id="product-name"
                  placeholder="Ej. Arroz Grano Grueso 1kg"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                id="product-sku"
                label="SKU o Código de Barras (opcional)"
                helperText="Identificador único de fabricante o código interno."
              >
                <TextInput
                  id="product-sku"
                  placeholder="Ej. 7501000123456"
                  value={sku}
                  onChange={(e) => {
                    setSku(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
              <FormField
                id="product-category"
                label="Categoría *"
                helperText="Clasificación general en almacén."
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SelectInput
                      id="product-category"
                      value={categoryId}
                      onChange={(e) => {
                        setCategoryId(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      disabled={isSubmitting}
                    >
                      <option value="">— Seleccionar categoría —</option>
                      {(categories ?? []).map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    title="Crear nueva categoría"
                    disabled={isSubmitting}
                    onClick={() => setIsCategoryModalOpen(true)}
                  >
                    Nueva
                  </Button>
                </div>
              </FormField>

              <FormField
                id="product-unit"
                label="Unidad de medida *"
                helperText="Unidad con la que se contabiliza el stock."
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SelectInput
                      id="product-unit"
                      value={measurementUnitId}
                      onChange={(e) => {
                        setMeasurementUnitId(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      disabled={isSubmitting}
                    >
                      <option value="">— Seleccionar unidad —</option>
                      {(units ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </SelectInput>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    title="Crear nueva unidad de medida"
                    disabled={isSubmitting}
                    onClick={() => setIsUnitModalOpen(true)}
                  >
                    Nueva
                  </Button>
                </div>
              </FormField>
            </div>
          </div>


          {/* SECCIÓN 2: ENTRADA INICIAL DE MERCANCÍA */}
          <div className="space-y-3">
            <div className="border-b border-slate-200 pb-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#123F55]">
                2. Entrada Inicial de Mercancía
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="product-quantity"
                label="Cantidad recibida *"
                helperText="Existencia física inicial. Mayor a cero, máx. 2 decimales."
              >
                <TextInput
                  id="product-quantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Ej. 50"
                  value={initialQuantity}
                  onChange={(e) => {
                    setInitialQuantity(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                id="product-entry-date"
                label="Fecha de entrada *"
                helperText="Fecha de recepción física. No se admiten fechas futuras."
              >
                <TextInput
                  id="product-entry-date"
                  type="date"
                  max={getTodayLocalDateString()}
                  value={declaredEntryDate}
                  onChange={(e) => {
                    setDeclaredEntryDate(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="product-purchase-price"
                label="Precio de compra unitario ($) *"
                helperText="Costo pagado por cada unidad recibida (máx. 2 decimales)."
              >
                <TextInput
                  id="product-purchase-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Ej. 18.50"
                  value={unitPurchasePrice}
                  onChange={(e) => {
                    setUnitPurchasePrice(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField
                id="product-sale-price"
                label="Precio de venta al público ($) *"
                helperText="Pesos enteros. Se redondea hacia arriba y debe ser >= costo de compra."
              >
                <TextInput
                  id="product-sale-price"
                  type="number"
                  step="1"
                  min="1"
                  placeholder="Ej. 25"
                  value={declaredSalePrice}
                  onChange={(e) => {
                    setDeclaredSalePrice(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  disabled={isSubmitting}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="product-expiration-date"
                label="Fecha de vencimiento (Mes y Año)"
                helperText="Solo mes y año (sin día). Alerta preventiva automática con 1 año o menos."
              >
                <TextInput
                  id="product-expiration-date"
                  type="month"
                  placeholder="AAAA-MM"
                  value={expirationDate ? expirationDate.slice(0, 7) : ''}
                  onChange={(e) => {
                    setExpirationDate(e.target.value);
                    if (formError) setFormError(null);
                  }}
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
          </div>

          {/* SECCIÓN 3: RESUMEN ECONÓMICO EN VIVO */}
          <div className="rounded-lg border border-slate-200 bg-[#F8F9FA] p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#123F55]">
              3. Resumen Económico de la Operación
            </h4>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div>
                <span className="text-slate-500">Cantidad:</span>
                <p className="mt-0.5 font-medium tabular-nums text-slate-800">
                  {isQuantityValid ? parsedQuantity.toFixed(2) : '—'}
                </p>
              </div>

              <div>
                <span className="text-slate-500">Costo unitario:</span>
                <p className="mt-0.5 font-medium tabular-nums text-slate-800">
                  {isPurchasePriceValid ? `$${parsedPurchasePrice.toFixed(2)}` : '—'}
                </p>
              </div>

              <div>
                <span className="text-slate-500">Costo total lote:</span>
                <p className="mt-0.5 font-semibold tabular-nums text-[#123F55]">
                  {economicSummary.totalCost !== null
                    ? `$${economicSummary.totalCost.toFixed(2)}`
                    : '—'}
                </p>
              </div>

              <div>
                <span className="text-slate-500">Precio de venta:</span>
                <p className="mt-0.5 font-semibold tabular-nums text-[#123F55]">
                  {economicSummary.resolvedSale !== null
                    ? `$${economicSummary.resolvedSale}`
                    : '—'}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2.5 text-xs">
              <span className="text-slate-600">Margen de ganancia estimado:</span>
              {economicSummary.isSaleUnderCost ? (
                <span className="font-semibold text-red-600">
                  Inválido (Precio de venta menor al costo)
                </span>
              ) : economicSummary.marginPct !== null ? (
                <span className="font-semibold tabular-nums text-emerald-700">
                  +{economicSummary.marginPct.toFixed(2)}%
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal secundario: Crear Categoría */}
      <CreateCategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onCreated={(newCat) => {
          void reloadCategories();
          setCategoryId(newCat.id);
        }}
      />

      {/* Modal secundario: Crear Unidad de Medida */}
      <CreateMeasurementUnitModal
        isOpen={isUnitModalOpen}
        onClose={() => setIsUnitModalOpen(false)}
        onCreated={(newUnit) => {
          void reloadUnits();
          setMeasurementUnitId(newUnit.id);
        }}
      />
    </>
  );
}
