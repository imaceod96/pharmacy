import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileCheck,
  Search,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { Modal } from '../../../../shared/components/Modal';
import { formatDateTime } from '../../../../shared/utils/date';
import {
  MorningStockVerificationRecord,
  MorningVerificationMode,
} from '../../domain/entities/MorningStockVerification';
import { ProductCatalogViewItem, ProductStatus } from '../../domain/entities/ProductRecord';

export interface MorningStockVerificationModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: (record: MorningStockVerificationRecord) => void;
}

export function MorningStockVerificationModal({
  isOpen,
  onClose,
  onSuccess,
}: MorningStockVerificationModalProps) {
  const { actor } = useSession();
  const { useCases, notifyDataChanged } = useApplication();

  const [products, setProducts] = useState<ProductCatalogViewItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resultRecord, setResultRecord] = useState<MorningStockVerificationRecord | null>(null);

  // Modo unificado: siempre genera acta y ajusta de inmediato sólo si hay faltantes/excedentes
  const mode: MorningVerificationMode = 'ADJUST_STOCK';

  // Cargar todos los productos activos
  useEffect(() => {
    if (!isOpen) {
      setResultRecord(null);
      setError(null);
      setCounts({});
      setReasons({});
      setNotes('');
      setSearchQuery('');
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    useCases.warehouse.listProducts
      .execute(actor)
      .then((all) => {
        if (!active) return;
        const activeProds = all
          .filter((p) => p.status === ProductStatus.ACTIVE)
          .sort((a, b) => a.name.localeCompare(b.name));
        setProducts(activeProds);

        // Pre-cargar valores iniciales con la existencia del sistema
        const initial: Record<string, string> = {};
        for (const p of activeProds) {
          initial[p.id] = String(p.stockQuantity);
        }
        setCounts(initial);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Error al cargar productos para verificación.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, actor, useCases.warehouse.listProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const summaryMetrics = useMemo(() => {
    let diffCount = 0;
    let surplusCount = 0;
    let shortageCount = 0;

    for (const p of products) {
      const valStr = counts[p.id];
      if (valStr !== undefined && valStr !== '') {
        const counted = parseFloat(valStr);
        if (!isNaN(counted)) {
          const diff = Math.round((counted - p.stockQuantity) * 100) / 100;
          if (Math.abs(diff) > 0.0001) {
            diffCount += 1;
            if (diff > 0) surplusCount += 1;
            else shortageCount += 1;
          }
        }
      }
    }

    return { diffCount, surplusCount, shortageCount };
  }, [products, counts]);

  const handleCopyCurrentStock = () => {
    const next: Record<string, string> = {};
    for (const p of products) {
      next[p.id] = String(p.stockQuantity);
    }
    setCounts(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validar que todos los productos tengan conteo ingresado
    const payloadCounts: { productId: string; countedStock: number; differenceReason?: string }[] = [];

    for (const p of products) {
      const raw = counts[p.id];
      if (raw === undefined || raw === '' || isNaN(parseFloat(raw))) {
        setError(`Falta ingresar el conteo físico para el producto "${p.name}".`);
        return;
      }

      const counted = parseFloat(raw);
      if (counted < 0) {
        setError(`La cantidad física para "${p.name}" no puede ser negativa.`);
        return;
      }

      const diff = Math.round((counted - p.stockQuantity) * 100) / 100;
      const reason = (reasons[p.id] || '').trim();

      // Si existe discrepancia, el motivo de diferencia es estrictamente obligatorio
      if (Math.abs(diff) > 0.0001 && !reason) {
        setError(
          `El producto "${p.name}" presenta una diferencia de ${
            diff > 0 ? `+${diff}` : diff
          }. Se requiere ingresar el motivo de la diferencia para aplicar el ajuste.`
        );
        return;
      }

      payloadCounts.push({
        productId: p.id,
        countedStock: counted,
        differenceReason: reason || undefined,
      });
    }

    setIsSubmitting(true);
    try {
      const record = await useCases.warehouse.morningStockVerification.execute(actor, {
        mode,
        counts: payloadCounts,
        notes: notes.trim() || undefined,
      });

      setResultRecord(record);
      notifyDataChanged();
      if (onSuccess) {
        onSuccess(record);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar la verificación matutina.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (resultRecord) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Acta de Verificación Matutina Registrada"
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-5 text-xs">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <h3 className="text-sm font-bold">
                Acta {resultRecord.folio} registrada exitosamente
              </h3>
            </div>
            <p className="text-xs text-emerald-800">
              {resultRecord.differencesCount > 0
                ? `Se registraron las existencias verificadas y se corrigieron de inmediato las existencias en almacén y Kardex (${resultRecord.differencesCount} diferencia${
                    resultRecord.differencesCount > 1 ? 's' : ''
                  } ajustada${resultRecord.differencesCount > 1 ? 's' : ''}).`
                : 'Todas las existencias físicas coinciden exactamente con el sistema. Se registró el acta conforme sin necesidad de ajustes.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-500 block text-[11px]">Folio del acta:</span>
              <span className="font-mono font-bold text-slate-800">{resultRecord.folio}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-500 block text-[11px]">Fecha y hora:</span>
              <span className="font-medium text-slate-800">{formatDateTime(resultRecord.timestamp)}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-500 block text-[11px]">Productos revisados:</span>
              <span className="font-bold text-[#123F55]">{resultRecord.totalProductsCounted}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-500 block text-[11px]">Con diferencias:</span>
              <span className={`font-bold ${resultRecord.differencesCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {resultRecord.differencesCount}
              </span>
            </div>
          </div>

          {resultRecord.differencesCount > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-800">Detalle de discrepancias corregidas:</h4>
              <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2">Producto</th>
                      <th className="p-2 text-right">Sistema</th>
                      <th className="p-2 text-right">Físico</th>
                      <th className="p-2 text-right">Diferencia</th>
                      <th className="p-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resultRecord.items
                      .filter((it) => Math.abs(it.difference) > 0.0001)
                      .map((it) => (
                        <tr key={it.productId}>
                          <td className="p-2 font-medium text-slate-900">{it.productName}</td>
                          <td className="p-2 text-right font-mono text-slate-600">{it.systemStock}</td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900">{it.countedStock}</td>
                          <td className={`p-2 text-right font-mono font-bold ${it.difference < 0 ? 'text-red-700' : 'text-blue-700'}`}>
                            {it.difference > 0 ? `+${it.difference}` : it.difference}
                          </td>
                          <td className="p-2 text-slate-600 italic">{it.differenceReason || 'Sin motivo'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <Button variant="primary" size="md" onClick={onClose}>
              Finalizar y volver
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Verificación Matutina de Existencias"
      maxWidthClassName="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-xs">
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-blue-900 space-y-1.5">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-blue-700 shrink-0" />
            <h3 className="font-semibold text-xs">Conteo físico previo a la jornada con ajuste automático</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-blue-800">
            Realice la verificación física matutina antes de iniciar la jornada. Si las existencias físicas coinciden exactamente con el sistema, se registrará el acta conforme sin modificar nada. Si se detecta algún faltante o excedente, el sistema solicitará el motivo y corregirá inmediatamente las existencias de almacén y el Kardex.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Barra de herramientas y filtros */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar producto por nombre o SKU…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={handleCopyCurrentStock}
            >
              Restablecer a existencia actual
            </Button>
          </div>
        </div>

        {/* Resumen de diferencias */}
        {summaryMetrics.diffCount > 0 && (
          <div className="flex flex-wrap items-center gap-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              Se detectaron <strong>{summaryMetrics.diffCount} producto(s)</strong> con discrepancias:
              {summaryMetrics.surplusCount > 0 && ` ${summaryMetrics.surplusCount} sobrante(s)`}
              {summaryMetrics.shortageCount > 0 && ` ${summaryMetrics.shortageCount} faltante(s)`}.
              Requieren motivo para aplicar el ajuste automático.
            </span>
          </div>
        )}

        {/* Tabla de conteo de productos */}
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Cargando catálogo de productos…</div>
        ) : (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-3">Producto</th>
                  <th className="p-3 text-right">Existencia Actual</th>
                  <th className="p-3 text-center w-36">Conteo Físico</th>
                  <th className="p-3 text-right">Diferencia</th>
                  <th className="p-3 min-w-[200px]">Motivo de Diferencia (en caso de ajuste)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const valStr = counts[p.id] ?? '';
                  const counted = parseFloat(valStr);
                  const isValid = !isNaN(counted) && counted >= 0;
                  const diff = isValid ? Math.round((counted - p.stockQuantity) * 100) / 100 : 0;
                  const hasDiff = isValid && Math.abs(diff) > 0.0001;

                  return (
                    <tr key={p.id} className={hasDiff ? 'bg-amber-50/40' : undefined}>
                      <td className="p-3">
                        <span className="font-semibold text-slate-900 block">{p.name}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {p.sku || `PRD-${p.id.slice(0, 8).toUpperCase()}`}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-slate-700 font-medium">
                        {p.stockQuantity.toFixed(2)}
                      </td>
                      <td className="p-3 text-center">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={valStr}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCounts((prev) => ({ ...prev, [p.id]: val }));
                          }}
                          className={`w-28 text-center font-mono font-bold py-1.5 px-2 rounded border text-xs ${
                            hasDiff
                              ? 'border-amber-400 bg-amber-50 text-amber-900 focus:border-amber-600'
                              : 'border-slate-200 bg-white text-slate-900 focus:border-[#1A5F7A]'
                          } focus:outline-none`}
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        {isValid ? (
                          hasDiff ? (
                            <span className={diff > 0 ? 'text-blue-700' : 'text-red-700'}>
                              {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-emerald-700">0.00</span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {hasDiff ? (
                          <input
                            type="text"
                            placeholder="Motivo obligatorio de diferencia…"
                            value={reasons[p.id] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setReasons((prev) => ({ ...prev, [p.id]: val }));
                            }}
                            className="w-full text-xs py-1 px-2 rounded border border-amber-300 bg-white text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none"
                          />
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">Existencia conforme (sin ajuste)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Observaciones generales */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-700 block text-xs">
            Observaciones o notas del conteo matutino (opcional):
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ejemplo: Conteo previo al inicio de turno matutino, bodega principal verificada..."
            className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#1A5F7A] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isSubmitting || isLoading}
            icon={<FileCheck className="h-4 w-4" />}
          >
            {isSubmitting
              ? 'Procesando conteo…'
              : summaryMetrics.diffCount > 0
              ? `Guardar Acta y Ajustar Existencias (${summaryMetrics.diffCount})`
              : 'Guardar Acta Conforme'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
