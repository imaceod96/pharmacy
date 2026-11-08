import React, { useState } from 'react';
import { Package, Receipt, Search } from 'lucide-react';
import { Button } from '../../../../shared/components/Button';
import { FormField } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { ProductCatalogViewItem, ProductRecord } from '../../../warehouse/domain/entities/ProductRecord';
import { ExpenseType } from '../../domain/entities/ExpenseRecord';
import { CreateExpensePayload } from '../../application/CreateExpenseUseCase';

export type ProductSelectableItem = ProductCatalogViewItem | ProductRecord;

export interface CreateExpenseModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly products: readonly ProductSelectableItem[];
  readonly onSubmit: (payload: CreateExpensePayload) => Promise<void>;
}

export function CreateExpenseModal({
  isOpen,
  onClose,
  products,
  onSubmit,
}: CreateExpenseModalProps) {
  const [activeTab, setActiveTab] = useState<ExpenseType>(ExpenseType.INVENTORY_PRODUCT);

  // Estado para gasto de producto
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1');
  const [productNote, setProductNote] = useState<string>('');

  // Estado para gasto manual
  const [manualDescription, setManualDescription] = useState<string>('');
  const [manualAmount, setManualAmount] = useState<string>('');

  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const resetForm = () => {
    setSelectedProductId('');
    setProductSearch('');
    setQuantity('1');
    setProductNote('');
    setManualDescription('');
    setManualAmount('');
    setErrorText(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const getProductStock = (p: ProductSelectableItem): number => {
    return 'stockQuantity' in p ? p.stockQuantity : p.currentStock;
  };

  const getProductCost = (p: ProductSelectableItem): number => {
    if ('purchaseCost' in p && typeof p.purchaseCost === 'number') return p.purchaseCost;
    if ('lastPurchasePrice' in p && typeof p.lastPurchasePrice === 'number') return p.lastPurchasePrice;
    return 0;
  };

  const getProductCode = (p: ProductSelectableItem): string => {
    if ('code' in p && p.code) return p.code;
    if ('sku' in p && p.sku) return p.sku;
    return 'N/A';
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  // Filtrar productos disponibles por búsqueda
  const filteredProducts = products.filter((p) => {
    const stock = getProductStock(p);
    if (stock <= 0) return false;
    const term = productSearch.trim().toLowerCase();
    if (!term) return true;
    const codeStr = getProductCode(p).toLowerCase();
    return (
      p.name.toLowerCase().includes(term) ||
      codeStr.includes(term)
    );
  });

  const parsedQuantity = parseFloat(quantity);
  const estimatedCost = selectedProduct
    ? Math.round(getProductCost(selectedProduct) * (parsedQuantity > 0 ? parsedQuantity : 0) * 100) / 100
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (activeTab === ExpenseType.INVENTORY_PRODUCT) {
      if (!selectedProductId || !selectedProduct) {
        setErrorText('Seleccione un producto del inventario.');
        return;
      }
      const qty = parseFloat(quantity);
      if (isNaN(qty) || qty <= 0) {
        setErrorText('Ingrese una cantidad válida mayor a cero.');
        return;
      }
      const availStock = getProductStock(selectedProduct);
      if (qty > availStock) {
        setErrorText(`Existencias insuficientes. Stock disponible: ${availStock}`);
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit({
          type: ExpenseType.INVENTORY_PRODUCT,
          productId: selectedProductId,
          quantity: qty,
          description: productNote.trim() || undefined,
        });
        resetForm();
        onClose();
      } catch (err: any) {
        setErrorText(err?.message || 'Error al registrar el gasto de producto.');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Gasto Manual
      const desc = manualDescription.trim();
      if (!desc) {
        setErrorText('Ingrese la descripción o concepto del gasto (ej. Alquiler, Salario).');
        return;
      }
      const amt = parseFloat(manualAmount);
      if (isNaN(amt) || amt <= 0) {
        setErrorText('Ingrese un monto en dinero válido mayor a cero.');
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit({
          type: ExpenseType.MANUAL,
          description: desc,
          amount: amt,
        });
        resetForm();
        onClose();
      } catch (err: any) {
        setErrorText(err?.message || 'Error al registrar el gasto manual.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Registrar Gasto Operativo"
      description="Seleccione si es un producto retirado del inventario (autoconsumo) o un gasto operativo manual (alquiler, salarios, servicios)."
      maxWidthClassName="max-w-xl"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            disabled={isSubmitting}
            onClick={handleClose}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={isSubmitting}
            onClick={(e) => void handleSubmit(e)}
          >
            {isSubmitting ? 'Guardando...' : 'Guardar Gasto'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {errorText && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {errorText}
          </div>
        )}

        {/* Pestañas de tipo de gasto */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setActiveTab(ExpenseType.INVENTORY_PRODUCT);
              setErrorText(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === ExpenseType.INVENTORY_PRODUCT
                ? 'bg-white text-[#123F55] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Package className="h-3.5 w-3.5 text-[#1A5F7A]" />
            <span>Mercancía de Inventario</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab(ExpenseType.MANUAL);
              setErrorText(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === ExpenseType.MANUAL
                ? 'bg-white text-[#123F55] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Receipt className="h-3.5 w-3.5 text-[#1A5F7A]" />
            <span>Gasto Manual / Pago</span>
          </button>
        </div>

        {/* Formulario 1: Mercancía de inventario */}
        {activeTab === ExpenseType.INVENTORY_PRODUCT ? (
          <div className="space-y-4 pt-1">
            <p className="text-xs text-slate-500 leading-relaxed">
              El producto seleccionado se cobrará a su costo de compra FIFO y sus existencias se descontarán de forma inmediata del almacén con registro en Kardex.
            </p>

            <FormField
              id="expense-product-search"
              label="Seleccionar producto del inventario"
              helperText="Busque por código, SKU o nombre comercial."
            >
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Filtrar producto..."
                    className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-[#123F55] focus:outline-none"
                  />
                </div>

                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#123F55] focus:outline-none bg-white"
                >
                  <option value="">-- Seleccionar producto --</option>
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({getProductCode(p)}) — Stock: {getProductStock(p)} | Costo: ${getProductCost(p).toFixed(2)}
                    </option>
                  ))}
                </select>
              </div>
            </FormField>

            {selectedProduct && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Stock disponible:</span>
                  <strong className="font-mono text-slate-900 font-semibold">{getProductStock(selectedProduct)} unidades</strong>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>Costo unitario de catálogo:</span>
                  <strong className="font-mono text-slate-900 font-semibold">${getProductCost(selectedProduct).toFixed(2)}</strong>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="expense-product-qty"
                label="Cantidad a retirar"
                helperText="Número de unidades consumidas."
              >
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="1"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-[#123F55] focus:outline-none"
                />
              </FormField>

              <FormField
                id="expense-estimated-cost"
                label="Costo total estimado"
                helperText="Valor de costo a deducir."
              >
                <div className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-mono font-semibold text-[#123F55] tabular-nums">
                  ${estimatedCost.toFixed(2)}
                </div>
              </FormField>
            </div>

            <FormField
              id="expense-product-note"
              label="Nota / Observaciones (Opcional)"
              helperText="Ej. Uso personal del propietario, merma operativa o atención al cliente."
            >
              <input
                type="text"
                value={productNote}
                onChange={(e) => setProductNote(e.target.value)}
                placeholder="Consumo interno..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#123F55] focus:outline-none"
              />
            </FormField>
          </div>
        ) : (
          /* Formulario 2: Gasto manual */
          <div className="space-y-4 pt-1">
            <p className="text-xs text-slate-500 leading-relaxed">
              Registre pagos u obligaciones ejecutadas con efectivo o fondos de caja durante el día.
            </p>

            <FormField
              id="expense-manual-desc"
              label="Descripción o concepto del gasto"
              helperText="Texto libre explicando el motivo del gasto."
            >
              <input
                type="text"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
                placeholder="Ej. Alquiler del local, Salario de empleado, Pago de agua..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-[#123F55] focus:outline-none"
              />
            </FormField>

            <FormField
              id="expense-manual-amount"
              label="Monto del gasto ($)"
              helperText="Valor monetario desembolsado."
            >
              <div className="relative">
                <span className="absolute left-3 top-2 text-sm font-semibold text-slate-500">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2 text-sm font-mono text-slate-900 focus:border-[#123F55] focus:outline-none"
                />
              </div>
            </FormField>
          </div>
        )}
      </form>
    </Modal>
  );
}
