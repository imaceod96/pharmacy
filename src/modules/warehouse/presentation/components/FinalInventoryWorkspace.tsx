import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  History,
  Info,
  Lock,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { Button } from '../../../../shared/components/Button';
import { Card, CardHeader } from '../../../../shared/components/Card';
import { Modal } from '../../../../shared/components/Modal';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import { PendingOpenAccountsError, PendingOpenAccountSummary } from '../../../sales/domain/entities/SaleRecord';
import { WorkdayRecord, WorkdayStatus, WORKDAY_STATUS_LABELS } from '../../domain/entities/WorkdayRecord';
import { FinalInventorySelectionResult } from '../../application/PrepareFinalInventorySelectionUseCase';
import { ApproveWorkdayClosingResult } from '../../application/ApproveWorkdayClosingUseCase';
import { WorkdayCommercialPerformanceResult } from '../../domain/entities/WorkdayCommercialPerformance';
import { WorkdayCommercialPerformanceSummary } from './WorkdayCommercialPerformanceSummary';
import { RectifyFinalInventoryModal } from './RectifyFinalInventoryModal';
import { WorkdayDispatchedSaleItem } from '../../application/GetWorkdayDetailUseCase';
import { WarehouseClosingRectification } from '../../domain/entities/WarehouseClosingRectification';

export interface FinalInventoryWorkspaceProps {
  readonly workday: WorkdayRecord;
  readonly onReturn: () => void;
  readonly commercialPerformance?: WorkdayCommercialPerformanceResult;
  readonly dispatchedSales?: readonly WorkdayDispatchedSaleItem[];
  readonly rectifications?: readonly WarehouseClosingRectification[];
}

export function FinalInventoryWorkspace({
  workday,
  onReturn,
  commercialPerformance,
  dispatchedSales = [],
  rectifications = [],
}: FinalInventoryWorkspaceProps) {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();

  const canManageCuts = can(Permission.MANAGE_INVENTORY_CUTS);
  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);

  const [selectionResult, setSelectionResult] = useState<FinalInventorySelectionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [blockedAccounts, setBlockedAccounts] = useState<readonly PendingOpenAccountSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [differenceReasons, setDifferenceReasons] = useState<Record<string, string>>({});
  const [closingNotes, setClosingNotes] = useState<string>('');

  // Modal de suspensión
  const [isSuspendModalOpen, setIsSuspendModalOpen] = useState<boolean>(false);
  const [suspendReason, setSuspendReason] = useState<string>('');
  const [isSuspending, setIsSuspending] = useState<boolean>(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  // Modal de aprobación definitiva
  const [isApproveModalOpen, setIsApproveModalOpen] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvalResult, setApprovalResult] = useState<ApproveWorkdayClosingResult | null>(null);

  // Modal de rectificación
  const [isRectifyModalOpen, setIsRectifyModalOpen] = useState<boolean>(false);

  const loadReadinessOrSelection = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (workday.status === WorkdayStatus.OPEN) {
        const result = await useCases.warehouse.prepareFinalInventorySelection.execute(actor, {
          workdayId: workday.id,
        });
        setSelectionResult(result);
      } else if (
        workday.status === WorkdayStatus.CLOSING ||
        workday.status === WorkdayStatus.CLOSING_SUSPENDED
      ) {
        const result = await useCases.warehouse.prepareFinalInventorySelection.execute(actor, {
          workdayId: workday.id,
        });
        setSelectionResult(result);
        const initialCounts: Record<string, string> = {};
        for (const item of result.items) {
          initialCounts[item.productId] = String(item.currentTheoreticalStock);
        }
        setCounts((prev) => ({ ...initialCounts, ...prev }));
      }
    } catch (err) {
      if (err instanceof PendingOpenAccountsError) {
        setBlockedAccounts(err.pendingAccounts);
      }
      setError(
        err instanceof Error ? err.message : 'Error al preparar la selección de inventario final.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReadinessOrSelection();
  }, [workday.id, workday.status, dataRevision]);

  const handleStartClosing = async () => {
    setError(null);
    setBlockedAccounts([]);
    try {
      await useCases.warehouse.startWorkdayClosing.execute(actor, {
        workdayId: workday.id,
      });
      notifyDataChanged();
      await loadReadinessOrSelection();
    } catch (err) {
      if (err instanceof PendingOpenAccountsError) {
        setBlockedAccounts(err.pendingAccounts);
      }
      setError(
        err instanceof Error ? err.message : 'No fue posible iniciar el cierre de jornada.'
      );
    }
  };

  const handleSuspendClosing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendReason.trim()) {
      setSuspendError('El motivo de suspensión es obligatorio.');
      return;
    }
    setSuspendError(null);
    setIsSuspending(true);
    try {
      await useCases.warehouse.suspendWorkdayClosing.execute(actor, {
        workdayId: workday.id,
        reason: suspendReason.trim(),
      });
      setIsSuspendModalOpen(false);
      setSuspendReason('');
      notifyDataChanged();
    } catch (err) {
      setSuspendError(
        err instanceof Error ? err.message : 'No fue posible suspender el cierre de jornada.'
      );
    } finally {
      setIsSuspending(false);
    }
  };

  const handleResumeClosing = async () => {
    setError(null);
    try {
      await useCases.warehouse.resumeWorkdayClosing.execute(actor, {
        workdayId: workday.id,
      });
      notifyDataChanged();
      await loadReadinessOrSelection();
    } catch (err) {
      if (err instanceof PendingOpenAccountsError) {
        setBlockedAccounts(err.pendingAccounts);
      }
      setError(
        err instanceof Error ? err.message : 'No fue posible reanudar el cierre de jornada.'
      );
    }
  };

  const handleApproveClosing = async () => {
    setApproveError(null);
    setIsApproving(true);
    try {
      const parsedCounts: Record<string, number> = {};
      const parsedReasons: Record<string, string> = {};

      if (selectionResult) {
        for (const item of selectionResult.items) {
          const rawCount = counts[item.productId];
          parsedCounts[item.productId] = rawCount !== undefined && rawCount !== '' ? Number(rawCount) : item.currentTheoreticalStock;
          parsedReasons[item.productId] = differenceReasons[item.productId] ?? '';
        }
      }

      const result = await useCases.warehouse.approveWorkdayClosing.execute(actor, {
        workdayId: workday.id,
        counts: parsedCounts,
        differenceReasons: parsedReasons,
        notes: closingNotes.trim() || undefined,
      });

      setApprovalResult(result);
      setIsApproveModalOpen(false);
      notifyDataChanged();
    } catch (err) {
      if (err instanceof PendingOpenAccountsError) {
        setBlockedAccounts(err.pendingAccounts);
      }
      setApproveError(
        err instanceof Error ? err.message : 'No fue posible aprobar el cierre de jornada.'
      );
    } finally {
      setIsApproving(false);
    }
  };

  const perfToRender = approvalResult?.commercialPerformance || commercialPerformance;

  if (workday.status === WorkdayStatus.CLOSED || approvalResult) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={onReturn}
          >
            Volver a jornadas
          </Button>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
              Jornada Cerrada (CLOSED)
            </span>
            {canManageCuts && (
              <Button
                variant="primary"
                size="sm"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => setIsRectifyModalOpen(true)}
              >
                Rectificar inventario final
              </Button>
            )}
          </div>
        </div>

        {perfToRender ? (
          <WorkdayCommercialPerformanceSummary
            performance={perfToRender}
            dispatchedSales={dispatchedSales}
            canViewCosts={canViewCosts}
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
            No hay información comercial disponible para esta jornada.
          </div>
        )}

        {/* Historial de rectificaciones */}
        {rectifications && rectifications.length > 0 && (
          <Card>
            <CardHeader
              title={`Historial de Rectificaciones del Inventario Final (${rectifications.length})`}
              description="Ajustes compensatorios aplicados al cierre de jornada en versiones inmutables auditoras."
            />
            <div className="p-6 pt-0 space-y-4 text-xs">
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {rectifications.map((r) => (
                  <div key={r.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 font-mono font-bold text-amber-900 text-xs">
                          Versión {r.versionNumber}
                        </span>
                        <span className="font-semibold text-slate-800">
                          {formatDateTime(r.rectifiedAt)}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Responsable: <strong className="text-slate-700">{r.rectifiedByUserLabel}</strong>
                      </div>
                    </div>

                    <div className="text-slate-700">
                      <span className="font-semibold block text-slate-800">Motivo de la rectificación:</span>
                      <p className="italic bg-slate-50 p-2.5 rounded border border-slate-200 mt-1">
                        «{r.reason}»
                      </p>
                    </div>

                    {r.items.length > 0 && (
                      <div className="space-y-1">
                        <span className="font-semibold text-slate-800 block">Partidas rectificadas:</span>
                        <div className="overflow-x-auto rounded border border-slate-200">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                              <tr>
                                <th className="p-2">Producto</th>
                                <th className="p-2 text-right">Conteo Original</th>
                                <th className="p-2 text-right">Conteo Rectificado</th>
                                <th className="p-2 text-right">Diferencia (Compensatoria)</th>
                                <th className="p-2">Motivo Detallado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {r.items.map((item) => (
                                <tr key={item.productId}>
                                  <td className="p-2">
                                    <span className="font-medium text-slate-900">{item.productName}</span>{' '}
                                    <span className="font-mono text-slate-500">({item.productCode})</span>
                                  </td>
                                  <td className="p-2 text-right font-mono text-slate-600">
                                    {item.originalCount.toFixed(2)}
                                  </td>
                                  <td className="p-2 text-right font-mono text-slate-900 font-bold">
                                    {item.rectifiedCount.toFixed(2)}
                                  </td>
                                  <td
                                    className={`p-2 text-right font-mono font-bold ${
                                      item.difference < 0
                                        ? 'text-red-700'
                                        : item.difference > 0
                                          ? 'text-blue-700'
                                          : 'text-slate-700'
                                    }`}
                                  >
                                    {item.difference > 0 ? `+${item.difference.toFixed(2)}` : item.difference.toFixed(2)}
                                  </td>
                                  <td className="p-2 text-slate-600 italic">
                                    {item.differenceReason || r.reason}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Modal de Rectificación */}
        <RectifyFinalInventoryModal
          isOpen={isRectifyModalOpen}
          onClose={() => setIsRectifyModalOpen(false)}
          workday={workday}
          onSuccess={() => {
            notifyDataChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowLeft className="h-3.5 w-3.5" />}
          onClick={onReturn}
        >
          Volver a jornadas
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">Estado de jornada:</span>
          <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
            {WORKDAY_STATUS_LABELS[workday.status]}
          </span>
        </div>
      </div>

      {/* Resumen Comercial si ya hay información acumulada de la jornada */}
      {commercialPerformance && (
        <WorkdayCommercialPerformanceSummary
          performance={commercialPerformance}
          dispatchedSales={dispatchedSales}
          canViewCosts={canViewCosts}
        />
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-2">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0" />
            <span>Atención requerida para cierre de jornada</span>
          </div>
          <p>{error}</p>
        </div>
      )}

      {blockedAccounts.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900 space-y-3">
          <div className="font-semibold flex items-center gap-1.5">
            <Info className="h-4 w-4 text-blue-700 shrink-0" />
            <span>Cuentas abiertas en curso ({blockedAccounts.length}) · Mercancía ya descontada</span>
          </div>
          <p className="text-xs leading-relaxed text-blue-800">
            Existen {blockedAccounts.length} cuenta(s) abiertas. El cierre de jornada se puede realizar con normalidad.
            Las existencias de estas cuentas ya fueron descontadas del almacén físico. No aumentarán el valor de ventas del día
            hasta que sean despachadas manualmente en una próxima jornada abierta.
          </p>
          <div className="divide-y divide-blue-200/60 rounded border border-blue-200 bg-white">
            {blockedAccounts.map((acc) => (
              <div key={acc.id} className="p-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-[#123F55]">{acc.displayLabel}</span>
                  <span className="text-slate-500 ml-2">({acc.folio})</span>
                </div>
                <span className="font-mono font-bold text-blue-900">
                  {formatCurrency(acc.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {workday.status === WorkdayStatus.OPEN && (
        <Card>
          <CardHeader
            title="Inicio de Cierre de Jornada e Inventario Final"
            description="Preparación y validación transaccional previa al cierre definitivo."
          />
          <div className="p-6 space-y-4 text-xs text-slate-700">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-blue-900 space-y-2">
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-blue-700 shrink-0" />
                <span>Protocolo de cierre de jornada y FIFO</span>
              </div>
              <p className="leading-relaxed text-blue-800">
                Al iniciar el cierre, la jornada pasará a estado <strong>CLOSING</strong>. El sistema
                bloqueará la creación de nuevas cuentas abiertas y preparará la selección 100% automática
                de todos los productos con existencias o actividad comercial reciente, aplicando atribución
                de costos FIFO por lotes de adquisición.
              </p>
            </div>

            {canManageCuts && (
              <div className="pt-2">
                <Button
                  variant="primary"
                  size="md"
                  icon={<FileCheck2 className="h-4 w-4" />}
                  onClick={handleStartClosing}
                >
                  Iniciar proceso de cierre de jornada
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {(workday.status === WorkdayStatus.CLOSING ||
        workday.status === WorkdayStatus.CLOSING_SUSPENDED) && (
        <Card>
          <CardHeader
            title="Conteo Físico Final y Conciliación"
            description="Captura ciega de existencias físicas, diferencias y aprobación definitiva."
          />
          <div className="p-6 space-y-6 text-xs text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-50 border border-slate-200 p-4">
              <div>
                <span className="font-semibold text-slate-900 block text-sm">
                  {selectionResult?.items.length ?? 0} producto(s) en inventario final
                </span>
                <span className="text-slate-500 text-[11px]">
                  Selección automática basada en existencias y actividad de la jornada.
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {workday.status === WorkdayStatus.CLOSING ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PauseCircle className="h-4 w-4" />}
                    onClick={() => {
                      setSuspendReason('');
                      setSuspendError(null);
                      setIsSuspendModalOpen(true);
                    }}
                  >
                    Suspender cierre
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PlayCircle className="h-4 w-4 text-emerald-700" />}
                    onClick={handleResumeClosing}
                  >
                    Reanudar cierre
                  </Button>
                )}

                {canManageCuts && workday.status === WorkdayStatus.CLOSING && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={() => setIsApproveModalOpen(true)}
                  >
                    Aprobar cierre y finalizar jornada
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-slate-800">
                Partidas de inventario final ({selectionResult?.items.length ?? 0})
              </h4>
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {selectionResult?.items.map((item) => {
                  const rawCount = counts[item.productId] ?? '';
                  const countedNum = rawCount !== '' ? Number(rawCount) : item.currentTheoreticalStock;
                  const diff = countedNum - item.currentTheoreticalStock;
                  return (
                    <div key={item.productId} className="p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-[#123F55]">{item.productName}</span>{' '}
                          <span className="font-mono text-[11px] text-slate-500">
                            ({item.productCode} · {item.unitSymbol})
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-600">
                          Stock teórico: <strong>{item.currentTheoreticalStock.toFixed(2)}</strong>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Cantidad física contada ({item.unitSymbol}):
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={rawCount}
                            onChange={(e) =>
                              setCounts((prev) => ({ ...prev, [item.productId]: e.target.value }))
                            }
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Motivo de diferencia (si aplica):
                          </label>
                          <input
                            type="text"
                            placeholder="Ej. Merma, daño, diferencia de recepción..."
                            value={differenceReasons[item.productId] ?? ''}
                            onChange={(e) =>
                              setDifferenceReasons((prev) => ({
                                ...prev,
                                [item.productId]: e.target.value,
                              }))
                            }
                            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 pt-1">
                        <span>
                          Diferencia:{' '}
                          <strong
                            className={
                              diff < 0
                                ? 'text-red-700'
                                : diff > 0
                                  ? 'text-blue-700'
                                  : 'text-emerald-700'
                            }
                          >
                            {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                          </strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 block">
                Notas y observaciones finales de la jornada:
              </label>
              <textarea
                rows={3}
                placeholder="Observaciones de cierre o incidencias operativas..."
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Modal de Suspensión */}
      <Modal
        isOpen={isSuspendModalOpen}
        onClose={() => setIsSuspendModalOpen(false)}
        title="Suspender Cierre de Jornada"
        description="El cierre quedará pausado temporalmente en estado CLOSING_SUSPENDED."
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsSuspendModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isSuspending}
              onClick={handleSuspendClosing}
            >
              {isSuspending ? 'Suspendiendo...' : 'Confirmar suspensión'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSuspendClosing} className="space-y-4 text-xs">
          {suspendError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-900">
              {suspendError}
            </div>
          )}
          <div className="space-y-1">
            <label className="font-semibold text-slate-700 block">
              Motivo de suspensión <span className="text-red-600">*</span>:
            </label>
            <textarea
              required
              rows={3}
              placeholder="Explique la causa de la suspensión del cierre..."
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      {/* Modal de Aprobación Definitiva */}
      <Modal
        isOpen={isApproveModalOpen}
        onClose={() => setIsApproveModalOpen(false)}
        title="Aprobación Definitiva y Cierre de Jornada"
        description="Esta acción aplicará automáticamente los ajustes de inventario, generará los movimientos en Kardex y marcará la jornada como CERRADA (CLOSED)."
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsApproveModalOpen(false)}
            >
              Revisar de nuevo
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isApproving}
              onClick={handleApproveClosing}
            >
              {isApproving ? 'Procesando cierre...' : 'Aprobar y cerrar jornada definitivamente'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          {approveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-900">
              {approveError}
            </div>
          )}
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-amber-700 shrink-0" />
              <span>Aviso de inmutabilidad y cálculo FIFO</span>
            </div>
            <p className="leading-relaxed text-amber-800">
              Una vez aprobado el cierre, la jornada quedará cerrada permanentemente. El sistema calculará
              la rentabilidad bruta utilizando atribución FIFO sobre las capas de costo de adquisición y
              actualizará las existencias en almacén.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
