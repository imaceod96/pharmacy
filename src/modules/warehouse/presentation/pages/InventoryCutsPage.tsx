import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  Filter,
  History,
  Info,
  Play,
  Plus,
  Scissors,
  Search,
  XCircle,
} from 'lucide-react';
import { MorningStockVerificationModal } from '../components/MorningStockVerificationModal';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { AccessDeniedState } from '../../../../shared/components/AccessDeniedState';
import { Button } from '../../../../shared/components/Button';
import { Card, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { TextInput } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  PendingOpenAccountsError,
  PendingOpenAccountSummary,
} from '../../../sales/domain/entities/SaleRecord';
import {
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutStatus,
  PartialInventoryCutRecord,
} from '../../domain/entities/InventoryCutRecord';
import {
  WORKDAY_STATUS_LABELS,
  WorkdayRecord,
  WorkdayStatus,
} from '../../domain/entities/WorkdayRecord';
import { PartialCutWorkspace } from '../components/PartialCutWorkspace';

export function InventoryCutsPage() {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate } = useRouter();

  // Corte parcial actualmente abierto en la mesa de trabajo (Conteo ciego / Revisión)
  const [selectedCutId, setSelectedCutId] = useState<string | null>(null);

  // Modal de nuevo corte parcial (selección de productos 100 % automática)
  const [isCreateCutModalOpen, setIsCreateCutModalOpen] = useState<boolean>(false);
  const [cutNotes, setCutNotes] = useState<string>('');
  const [isCreatingCut, setIsCreatingCut] = useState<boolean>(false);
  const [createCutError, setCreateCutError] = useState<string | null>(null);
  const [blockedOpenAccounts, setBlockedOpenAccounts] = useState<
    readonly PendingOpenAccountSummary[]
  >([]);
  const [isMorningVerificationOpen, setIsMorningVerificationOpen] = useState<boolean>(false);

  // Filtros del historial de jornadas
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');

  const hasAccess = can(Permission.VIEW_INVENTORY_CUTS);
  const canManageCuts = can(Permission.MANAGE_INVENTORY_CUTS);

  // 1. Consulta de la jornada operativa actual
  const { data: activeWorkday, isLoading: isLoadingActive } = useAsyncQuery(
    () =>
      hasAccess
        ? useCases.warehouse.getActiveWorkday.execute(actor)
        : Promise.resolve(null),
    [useCases.warehouse.getActiveWorkday, actor, hasAccess, dataRevision]
  );

  // 2. Consulta de cortes parciales de la jornada actual
  const { data: workdayCutsSummary, isLoading: isLoadingWorkdayCuts } = useAsyncQuery(
    () =>
      hasAccess && activeWorkday
        ? useCases.warehouse.listWorkdayPartialCuts.execute(actor, activeWorkday.id)
        : Promise.resolve(null),
    [
      useCases.warehouse.listWorkdayPartialCuts,
      actor,
      hasAccess,
      activeWorkday?.id,
      dataRevision,
    ]
  );

  // 3. Consulta del historial de jornadas
  const { data: workdays, isLoading: isLoadingWorkdays } = useAsyncQuery(
    () =>
      hasAccess
        ? useCases.warehouse.listWorkdays.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listWorkdays, actor, hasAccess, dataRevision]
  );

  const statusBadge = (status: WorkdayStatus) => {
    switch (status) {
      case WorkdayStatus.OPEN:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
      case WorkdayStatus.CLOSING:
      case WorkdayStatus.CLOSING_SUSPENDED:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
      case WorkdayStatus.CLOSED:
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  const partialCutStatusBadge = (status: PartialCutStatus) => {
    switch (status) {
      case PartialCutStatus.DRAFT:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
            <Clock className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.READY_FOR_REVIEW:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <ClipboardList className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.APPROVED:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.CANCELLED:
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
            <XCircle className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  // Filtrado de jornadas en memoria
  const filteredWorkdays = useMemo(() => {
    const list = workdays ?? [];
    return list.filter((w) => {
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        const matchesCode = w.code.toLowerCase().includes(query);
        const matchesUser = w.openedByUserLabel.toLowerCase().includes(query);
        const matchesConsecutive = `#${w.consecutiveNumber}`.includes(query);
        const matchesNotes = (w.notes || '').toLowerCase().includes(query);
        if (!matchesCode && !matchesUser && !matchesConsecutive && !matchesNotes) {
          return false;
        }
      }

      if (selectedStatus !== 'ALL') {
        if (w.status !== selectedStatus) {
          return false;
        }
      }

      if (selectedDate) {
        if (!w.openedAt.startsWith(selectedDate)) {
          return false;
        }
      }

      return true;
    });
  }, [workdays, searchTerm, selectedStatus, selectedDate]);

  const handleOpenCreateCutModal = () => {
    setCutNotes('');
    setCreateCutError(null);
    setBlockedOpenAccounts(workdayCutsSummary?.pendingOpenAccounts ?? []);
    setIsCreateCutModalOpen(true);
  };

  const handleCreatePartialCut = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateCutError(null);
    setIsCreatingCut(true);

    try {
      const created = await useCases.warehouse.createPartialCut.execute(actor, {
        workdayId: activeWorkday?.id,
        notes: cutNotes,
      });
      setIsCreateCutModalOpen(false);
      notifyDataChanged();
      setSelectedCutId(created.id);
    } catch (err) {
      if (err instanceof PendingOpenAccountsError) {
        setBlockedOpenAccounts(err.pendingAccounts);
      }
      setCreateCutError(
        err instanceof Error
          ? err.message
          : 'No fue posible crear el borrador del corte parcial.'
      );
    } finally {
      setIsCreatingCut(false);
    }
  };

  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventarios / Corte"
          subtitle="Control físico de existencias, jornadas y expedientes de almacén."
        />
        <AccessDeniedState
          sectionName="Inventarios / Corte"
          activeRoleLabel={actor.label}
          onReturnHome={() => navigate(ROUTES.home)}
        />
      </div>
    );
  }

  // Si el Administrador tiene abierto un corte parcial específico en la mesa de trabajo
  if (selectedCutId && canManageCuts) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Inventarios / Corte — Mesa de Conteo Ciego y Revisión"
          subtitle="Captura física sin exposición de existencias teóricas y conciliación auditada de movimientos posteriores."
        />
        <PartialCutWorkspace
          cutId={selectedCutId}
          onClose={() => setSelectedCutId(null)}
        />
      </div>
    );
  }

  const partialCutColumns: readonly TableColumn<PartialInventoryCutRecord>[] = [
    {
      key: 'consecutiveNumber',
      header: 'Corte',
      tabular: true,
      render: (c) => (
        <span className="font-bold text-[#123F55]">#{c.consecutiveNumber}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Folio',
      tabular: true,
      render: (c) => (
        <span className="font-mono text-xs font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
          {c.reference}
        </span>
      ),
    },
    {
      key: 'interval',
      header: 'Intervalo de referencia',
      tabular: true,
      render: (c) => (
        <div className="text-xs text-slate-700">
          <div>Desde: {formatDateTime(c.intervalStartAt)}</div>
          <div className="text-slate-500">Hasta: {formatDateTime(c.intervalEndAt)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => partialCutStatusBadge(c.status),
    },
    {
      key: 'countedProgress',
      header: 'Productos contados',
      align: 'right',
      tabular: true,
      render: (c) => {
        const counted = c.items.filter(
          (i) => i.countedPhysicalQuantity !== null
        ).length;
        return (
          <span className="font-mono text-xs font-semibold text-emerald-700">
            {counted} / {c.items.length}
          </span>
        );
      },
    },
    {
      key: 'commercialActivity',
      header: 'Actividad comercial',
      render: (c) => {
        if (!c.commercialActivity) {
          return <span className="text-xs text-slate-400 italic">—</span>;
        }
        return (
          <div className="text-xs space-y-0.5">
            <div className="text-slate-700 font-medium">
              {c.commercialActivity.totalDispatchesCount} despacho(s) ·{' '}
              {c.commercialActivity.distinctProductsCount} prod.
            </div>
            <div className="text-[11px] font-mono text-[#123F55] font-bold">
              Despachado: {formatCurrency(c.commercialActivity.totalCommercialValue)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'summaryBalance',
      header: 'Balance de inventario',
      render: (c) => {
        if (c.status === PartialCutStatus.DRAFT) {
          return <span className="text-xs text-slate-400 italic">Conteo ciego</span>;
        }
        if (c.status === PartialCutStatus.CANCELLED) {
          return <span className="text-xs text-slate-400 italic">Cancelado</span>;
        }
        if (!c.summary) {
          return <span className="text-xs text-slate-500">—</span>;
        }
        return (
          <div className="text-xs space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-emerald-700 font-medium">
                {c.summary.productsWithoutDifference} exactos
              </span>
              {c.summary.productsWithShortage > 0 && (
                <span className="text-red-700 font-semibold">
                  · {c.summary.productsWithShortage} faltante(s)
                </span>
              )}
              {c.summary.productsWithSurplus > 0 && (
                <span className="text-blue-700 font-semibold">
                  · {c.summary.productsWithSurplus} sobrante(s)
                </span>
              )}
            </div>
            {canManageCuts && (
              <div className="text-[11px] font-mono text-slate-600">
                Neto P.V.:{' '}
                <strong
                  className={
                    c.summary.netSaleBalance < 0
                      ? 'text-red-700'
                      : c.summary.netSaleBalance > 0
                        ? 'text-blue-700'
                        : 'text-slate-700'
                  }
                >
                  {formatCurrency(c.summary.netSaleBalance)}
                </strong>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (c) => {
        if (!canManageCuts) {
          return (
            <span className="text-xs text-slate-400 italic">Solo Administrador</span>
          );
        }
        return (
          <Button
            variant={
              c.status === PartialCutStatus.DRAFT ||
              c.status === PartialCutStatus.READY_FOR_REVIEW
                ? 'primary'
                : 'secondary'
            }
            size="sm"
            icon={
              c.status === PartialCutStatus.DRAFT ? (
                <Play className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )
            }
            onClick={() => setSelectedCutId(c.id)}
          >
            {c.status === PartialCutStatus.DRAFT
              ? 'Continuar conteo'
              : c.status === PartialCutStatus.READY_FOR_REVIEW
                ? 'Revisar corte'
                : 'Consultar corte'}
          </Button>
        );
      },
    },
  ];

  const workdayColumns: readonly TableColumn<WorkdayRecord>[] = [
    {
      key: 'consecutiveNumber',
      header: 'Jornada',
      tabular: true,
      render: (w) => (
        <span className="font-bold text-[#123F55]">#{w.consecutiveNumber}</span>
      ),
    },
    {
      key: 'code',
      header: 'Folio',
      tabular: true,
      render: (w) => (
        <span className="font-mono text-xs font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
          {w.code}
        </span>
      ),
    },
    {
      key: 'openedAtDate',
      header: 'Fecha apertura',
      tabular: true,
      render: (w) => w.openedAt.substring(0, 10),
    },
    {
      key: 'openedAtTime',
      header: 'Hora apertura',
      tabular: true,
      render: (w) => w.openedAt.substring(11, 16),
    },
    {
      key: 'closedAt',
      header: 'Hora cierre',
      tabular: true,
      render: (w) =>
        w.closedAt ? (
          w.closedAt.substring(11, 16)
        ) : (
          <span className="text-emerald-600 font-medium">En curso</span>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (w) => statusBadge(w.status),
    },
    {
      key: 'responsible',
      header: 'Responsable',
      render: (w) => (
        <span className="text-xs text-slate-700">{w.openedByUserLabel}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      align: 'right',
      render: (w) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="h-3 w-3" />}
          onClick={() => navigate(ROUTES.warehouseWorkdayDetail(w.id))}
          title="Consultar expediente digital"
        >
          Ver expediente
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventarios / Corte"
        subtitle="Control de jornadas operativas, cortes parciales con conteo ciego y expedientes digitales."
        actions={
          <Button
            variant="secondary"
            size="md"
            icon={<ClipboardCheck className="h-4 w-4 text-[#1A5F7A]" />}
            onClick={() => setIsMorningVerificationOpen(true)}
          >
            Conteo matutino
          </Button>
        }
      />

      {/* BLOQUE A: ESTADO DE LA JORNADA OPERATIVA ACTUAL */}
      {isLoadingActive ? (
        <Card>
          <div className="p-6 text-center text-xs text-slate-500">
            Consultando estado operativo de almacén…
          </div>
        </Card>
      ) : activeWorkday ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-base font-bold text-[#123F55]">
                  Jornada #{activeWorkday.consecutiveNumber}
                </span>
                <span className="font-mono text-xs font-semibold bg-white border border-emerald-300 text-emerald-900 px-2 py-0.5 rounded">
                  {activeWorkday.code}
                </span>
                {statusBadge(activeWorkday.status)}
              </div>
              <p className="text-xs text-slate-600">
                Expediente digital activo en ejecución. Las operaciones, cortes parciales y
                movimientos de almacén quedan vinculados a este identificador.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canManageCuts && activeWorkday.status === WorkdayStatus.OPEN && (
                <>
                  {workdayCutsSummary?.activeDraftOrReviewCut ? (
                    <Button
                      variant="primary"
                      size="md"
                      icon={<Play className="h-4 w-4" />}
                      onClick={() =>
                        setSelectedCutId(workdayCutsSummary.activeDraftOrReviewCut!.id)
                      }
                    >
                      Continuar corte parcial ({workdayCutsSummary.activeDraftOrReviewCut.reference})
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      icon={<Scissors className="h-4 w-4" />}
                      onClick={handleOpenCreateCutModal}
                    >
                      Iniciar corte parcial
                    </Button>
                  )}
                </>
              )}

              <Button
                variant="secondary"
                size="md"
                icon={<FileText className="h-4 w-4" />}
                onClick={() => navigate(ROUTES.warehouseWorkdayDetail(activeWorkday.id))}
              >
                Ver expediente
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 border-t border-emerald-200/60 pt-4 text-xs text-slate-700">
            <div>
              <span className="text-slate-500 block text-[11px]">Fecha y hora de apertura</span>
              <strong className="font-semibold">{formatDateTime(activeWorkday.openedAt)}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Responsable de apertura</span>
              <strong className="font-semibold">{activeWorkday.openedByUserLabel}</strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">
                Próximo inicio de intervalo de corte
              </span>
              <strong className="font-semibold text-[#123F55]">
                {workdayCutsSummary?.nextIntervalStartAt
                  ? formatDateTime(workdayCutsSummary.nextIntervalStartAt)
                  : formatDateTime(activeWorkday.openedAt)}
              </strong>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Cortes en la jornada</span>
              <strong className="font-semibold text-emerald-800">
                {workdayCutsSummary?.cuts.length ?? 0} registrado(s)
              </strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  No hay ninguna jornada abierta
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 max-w-2xl">
                  Las operaciones de corte parcial, conteo ciego y trazabilidad compartida con
                  ventas requieren una jornada operativa activa. El inicio y control de jornada
                  se gestiona exclusivamente desde Inicio.
                </p>
              </div>
            </div>

            <div className="shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(ROUTES.home)}
              >
                Ir a Inicio
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* BLOQUE B: CORTES PARCIALES DE LA JORNADA ACTUAL */}
      {activeWorkday && (
        <Card>
          <CardHeader
            title={`Cortes parciales de la Jornada #${activeWorkday.consecutiveNumber} (${activeWorkday.code})`}
            description="Verificaciones intermedias de inventario por intervalos sin solapamientos. Los cortes cancelados se conservan en el historial sin cubrir su intervalo."
            action={
              canManageCuts &&
              activeWorkday.status === WorkdayStatus.OPEN &&
              !workdayCutsSummary?.activeDraftOrReviewCut ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={handleOpenCreateCutModal}
                >
                  Nuevo corte parcial
                </Button>
              ) : undefined
            }
          />

          {workdayCutsSummary?.cannotCreateReason && canManageCuts && (
            <div className="mx-6 mb-3 space-y-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{workdayCutsSummary.cannotCreateReason}</p>
                  {workdayCutsSummary.pendingOpenAccounts.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-800">
                      Cuentas abiertas detectadas ({workdayCutsSummary.pendingOpenAccounts.length}):
                      selecciona una cuenta para despacharla o cancelarla antes de iniciar el corte parcial.
                    </p>
                  )}
                </div>
              </div>

              {workdayCutsSummary.pendingOpenAccounts.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {workdayCutsSummary.pendingOpenAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => navigate(ROUTES.openSaleDetail(acc.id))}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-[#123F55] hover:bg-amber-100/60 transition-colors cursor-pointer"
                    >
                      <span>{acc.displayLabel}</span>
                      <span className="text-[10px] text-amber-700 underline">
                        Resolver cuenta →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <DataTable
            columns={partialCutColumns}
            rows={workdayCutsSummary?.cuts ?? []}
            getRowKey={(row) => row.id}
            isLoading={isLoadingWorkdayCuts}
            emptyIcon={<Scissors className="h-5 w-5" />}
            emptyTitle="Aún no se han iniciado cortes parciales en esta jornada"
            emptyDescription={
              canManageCuts
                ? 'Haz clic en «Iniciar corte parcial» para abrir un borrador de conteo ciego sobre el intervalo actual.'
                : 'El Administrador aún no ha registrado cortes parciales durante esta jornada.'
            }
          />
        </Card>
      )}

      {/* BLOQUE C: HISTORIAL DE JORNADAS (EXPEDIENTES DIGITALES) */}
      <Card>
        <CardHeader
          title="Historial de jornadas"
          description="Expedientes históricos conservados indefinidamente en la base de datos local."
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3.5 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
            <div className="w-full max-w-xs">
              <TextInput
                aria-label="Buscar jornada por folio, responsable o notas"
                placeholder="Buscar por folio, responsable…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                leadingIcon={<Search className="h-4 w-4" />}
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                aria-label="Filtrar por estado de jornada"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:border-[#1A5F7A] focus:outline-none"
              >
                <option value="ALL">Todos los estados</option>
                <option value={WorkdayStatus.OPEN}>Abierta</option>
                <option value={WorkdayStatus.CLOSING}>En proceso de cierre</option>
                <option value={WorkdayStatus.CLOSING_SUSPENDED}>Cierre suspendido</option>
                <option value={WorkdayStatus.CLOSED}>Cerrada</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <input
                type="date"
                aria-label="Filtrar por fecha de apertura"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:border-[#1A5F7A] focus:outline-none"
              />
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-500">
            <span className="tabular-nums">
              {filteredWorkdays.length} {filteredWorkdays.length === 1 ? 'jornada' : 'jornadas'}
            </span>
          </div>
        </div>

        <DataTable
          columns={workdayColumns}
          rows={filteredWorkdays}
          getRowKey={(row) => row.id}
          isLoading={isLoadingWorkdays}
          emptyIcon={<History className="h-5 w-5" />}
          emptyTitle="No hay jornadas registradas"
          emptyDescription="Cuando se abran y gestionen jornadas, sus expedientes históricos quedarán listados cronológicamente aquí."
        />
      </Card>

      {/* Modal para iniciar nuevo corte parcial */}
      <Modal
        isOpen={isCreateCutModalOpen}
        onClose={() => {
          if (!isCreatingCut) setIsCreateCutModalOpen(false);
        }}
        title="Iniciar nuevo corte parcial de inventario"
        description={
          activeWorkday
            ? `Se creará un borrador de corte parcial vinculado a la Jornada #${activeWorkday.consecutiveNumber} (${activeWorkday.code}).`
            : 'Iniciando corte parcial'
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isCreatingCut}
              onClick={() => setIsCreateCutModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form="create-partial-cut-form"
              variant="primary"
              size="sm"
              disabled={isCreatingCut}
            >
              {isCreatingCut ? 'Creando borrador…' : 'Crear borrador de corte'}
            </Button>
          </>
        }
      >
        <form id="create-partial-cut-form" onSubmit={handleCreatePartialCut} className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Inicio del intervalo cubierto:</span>
              <strong className="text-slate-900">
                {workdayCutsSummary?.nextIntervalStartAt
                  ? formatDateTime(workdayCutsSummary.nextIntervalStartAt)
                  : activeWorkday
                    ? formatDateTime(activeWorkday.openedAt)
                    : '—'}
              </strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cierre de referencia del intervalo:</span>
              <strong className="text-emerald-700">Instante actual de creación</strong>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5">
              <Info className="h-4 w-4 text-blue-700 shrink-0" />
              <span>Selección 100 % automática de productos</span>
            </div>
            <p className="text-[11px] leading-relaxed text-blue-800">
              El sistema consultará automáticamente las ventas reales despachadas y las
              devoluciones o anulaciones con movimiento de existencias durante el intervalo. Se
              incluirán todos los productos con actividad comercial (incluyendo agotados y
              productos que hayan tenido ventas y luego fueran desactivados), sin duplicados.
            </p>
            <p className="text-[11px] leading-relaxed font-medium text-blue-900">
              Por regla de control interno no se permite añadir ni eliminar manualmente productos
              del listado. El Administrador únicamente introducirá las cantidades físicas
              encontradas.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observaciones del corte (opcional)
            </label>
            <input
              type="text"
              value={cutNotes}
              onChange={(e) => setCutNotes(e.target.value)}
              placeholder="Ej. Verificación intermedia de vitrina principal…"
              className="w-full h-8 rounded-md border border-slate-300 px-2.5 text-xs text-slate-800 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>

          {createCutError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              <p className="font-semibold">{createCutError}</p>
            </div>
          )}
        </form>
      </Modal>

      <MorningStockVerificationModal
        isOpen={isMorningVerificationOpen}
        onClose={() => setIsMorningVerificationOpen(false)}
        onSuccess={() => {
          notifyDataChanged();
        }}
      />
    </div>
  );
}

