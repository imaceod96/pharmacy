import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  History,
  PlayCircle,
  Plus,
  ReceiptText,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { Button } from '../../../../shared/components/Button';
import { Card, CardBody, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime, getExpirationStatus, nowISO } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import {
  formatSaleDisplayLabel,
  PendingOpenAccountsError,
  PendingOpenAccountSummary,
  SaleBaseRecord,
  SALE_STATUS_LABELS,
  SaleStatus,
} from '../../../sales/domain/entities/SaleRecord';
import {
  validateActiveWorkdayForSales,
  WORKDAY_STATUS_LABELS,
  WorkdayStatus,
} from '../../../warehouse/domain/entities/WorkdayRecord';

export function HomePage() {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate, openNewSaleModal } = useRouter();

  // Estados locales para diálogos de control de jornada
  const [isStartWorkdayModalOpen, setIsStartWorkdayModalOpen] = useState<boolean>(false);
  const [openingNotes, setOpeningNotes] = useState<string>('');
  const [isSubmittingWorkday, setIsSubmittingWorkday] = useState<boolean>(false);
  const [workdayError, setWorkdayError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Modal de bloqueo o preparación para el cierre de jornada e inventario final
  const [closingBlockModal, setClosingBlockModal] = useState<{
    isOpen: boolean;
    message: string;
    pendingAccounts: readonly PendingOpenAccountSummary[];
  }>({
    isOpen: false,
    message: '',
    pendingAccounts: [],
  });

  // Modal informativo para inventario final cuando no existen bloqueos
  const [noticeModal, setNoticeModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    content: string;
  }>({
    isOpen: false,
    title: '',
    description: '',
    content: '',
  });

  const canManageWorkdays = can(Permission.MANAGE_INVENTORY_CUTS);
  const canViewCuts = can(Permission.VIEW_INVENTORY_CUTS);

  // 1. Consulta de la jornada operativa actual
  const {
    data: activeWorkday,
    isLoading: isLoadingWorkday,
    reload: reloadWorkday,
  } = useAsyncQuery(
    () =>
      canViewCuts
        ? useCases.warehouse.getActiveWorkday.execute(actor)
        : Promise.resolve(null),
    [useCases.warehouse.getActiveWorkday, actor, canViewCuts, dataRevision]
  );

  // 2. Consulta de resumen del dashboard de ventas para la jornada activa
  const activeWorkdayId =
    activeWorkday && activeWorkday.status !== WorkdayStatus.CLOSED
      ? activeWorkday.id
      : null;

  const { data: summary, isLoading: isLoadingSummary } = useAsyncQuery(
    () => useCases.sales.getDashboardSummary.execute(actor, activeWorkdayId),
    [useCases.sales.getDashboardSummary, actor, activeWorkdayId, dataRevision]
  );

  const { data: allProducts } = useAsyncQuery(
    () =>
      can(Permission.VIEW_PRODUCTS)
        ? useCases.warehouse.listProducts.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listProducts, actor, can, dataRevision]
  );

  const expiringProducts = useMemo(() => {
    return (allProducts ?? []).filter(
      (p) => p.expirationDate && getExpirationStatus(p.expirationDate).isAlert
    );
  }, [allProducts]);

  // 3. Regla obligatoria: validación de jornada para ventas
  const salesValidation = validateActiveWorkdayForSales(activeWorkday);

  const openSalesCount = summary?.openSales.length ?? 0;
  const recentSales = summary?.recentSales ?? [];

  const handleStartWorkday = async () => {
    setIsSubmittingWorkday(true);
    setWorkdayError(null);
    try {
      const result = await useCases.warehouse.openWorkday.execute(actor, {
        notes: openingNotes.trim() || undefined,
      });

      setIsStartWorkdayModalOpen(false);
      setOpeningNotes('');
      notifyDataChanged();
      void reloadWorkday();
      setSuccessBanner(
        `Jornada #${result.workday.consecutiveNumber} (${result.workday.code}) iniciada exitosamente. Se ha creado automáticamente su expediente digital.`
      );
    } catch (err: unknown) {
      setWorkdayError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al intentar iniciar la jornada.'
      );
    } finally {
      setIsSubmittingWorkday(false);
    }
  };

  // Validación obligatoria al intentar iniciar el cierre de jornada / inventario final
  const handleAttemptCloseWorkday = async () => {
    if (!activeWorkday) return;
    try {
      await useCases.warehouse.startWorkdayClosing.execute(actor, {
        workdayId: activeWorkday.id,
      });
      notifyDataChanged();
      navigate(ROUTES.warehouseWorkdayDetail(activeWorkday.id));
    } catch (err: unknown) {
      if (err instanceof PendingOpenAccountsError) {
        setClosingBlockModal({
          isOpen: true,
          message: err.message,
          pendingAccounts: err.pendingAccounts,
        });
        return;
      }
      setNoticeModal({
        isOpen: true,
        title: 'No es posible iniciar el cierre de jornada',
        description: 'Restricción operativa de control interno',
        content:
          err instanceof Error
            ? err.message
            : 'No fue posible iniciar el proceso de cierre de jornada.',
      });
    }
  };

  const recentColumns: readonly TableColumn<SaleBaseRecord>[] = [
    {
      key: 'folio',
      header: 'Folio / Cuenta',
      tabular: true,
      render: (sale) => (
        <span className="font-semibold text-[#123F55]">
          {formatSaleDisplayLabel(sale)}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Partidas / Total',
      tabular: true,
      render: (sale) => (
        <span className="font-mono text-xs text-slate-700">
          {sale.items?.length ?? 0} prod. ·{' '}
          <strong className="text-slate-900">
            {formatCurrency(sale.totalAmount ?? 0)}
          </strong>
        </span>
      ),
    },
    {
      key: 'closedAt',
      header: 'Fecha y hora',
      tabular: true,
      render: (sale) =>
        formatDateTime(sale.dispatchedAt ?? sale.cancelledAt ?? sale.closedAt ?? sale.updatedAt),
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'right',
      render: (sale) => (
        <span className="text-xs font-medium text-slate-600">
          {SALE_STATUS_LABELS[sale.status] ?? 'Despachada'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inicio"
        subtitle="Control operativo del establecimiento, estado de jornada y acceso rápido a cuentas abiertas y despachos."
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

      {expiringProducts.length > 0 && (
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
                Alerta de Almacén: {expiringProducts.length}{' '}
                {expiringProducts.length === 1 ? 'producto próximo' : 'productos próximos'} a vencer (≤ 1 año)
              </h4>
              <p className="mt-0.5 text-amber-800">
                Se detectaron artículos con fecha de caducidad en 1 año o menos (o ya vencidos). Verifique el inventario para priorizar su rotación.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            onClick={() => navigate(ROUTES.warehouseProducts)}
          >
            Ver productos en Almacén
          </Button>
        </div>
      )}

      {/* ============================================================ */}
      {/* PARTE 1 — CONTROL DE JORNADA EN INICIO (ZONA SUPERIOR)       */}
      {/* ============================================================ */}

      {/* CASO A: Administrador gestiona el control de jornada */}
      {canManageWorkdays && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          {isLoadingWorkday ? (
            <div className="text-xs text-slate-500 py-2">Consultando estado de jornada…</div>
          ) : !activeWorkday ? (
            /* 1.2 Sin jornada abierta */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                  <PlayCircle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    No hay una jornada abierta
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500 max-w-xl">
                    Inicie la jornada operativa para habilitar la preparación de cuentas abiertas,
                    el despacho de mercancía y crear el expediente digital diario.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="md"
                  icon={<PlayCircle className="h-4 w-4" />}
                  onClick={() => {
                    setWorkdayError(null);
                    setOpeningNotes('');
                    setIsStartWorkdayModalOpen(true);
                  }}
                >
                  Iniciar jornada
                </Button>
              </div>
            </div>
          ) : activeWorkday.status === WorkdayStatus.OPEN ? (
            /* 1.3 Jornada abierta (OPEN) */
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-base font-bold text-[#123F55]">
                    Jornada #{activeWorkday.consecutiveNumber}
                  </span>
                  <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded">
                    {activeWorkday.code}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {WORKDAY_STATUS_LABELS[activeWorkday.status]}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>
                      Apertura: <strong>{formatDateTime(activeWorkday.openedAt)}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span>
                      Responsable: <strong>{activeWorkday.openedByUserLabel}</strong>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  onClick={() => navigate(ROUTES.warehouseWorkdayDetail(activeWorkday.id))}
                >
                  Ver expediente
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  onClick={handleAttemptCloseWorkday}
                >
                  Cerrar jornada
                </Button>
              </div>
            </div>
          ) : activeWorkday.status === WorkdayStatus.CLOSING ? (
            /* 1.4 Jornada en proceso de cierre (CLOSING) */
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[#123F55]">
                    Jornada #{activeWorkday.consecutiveNumber} ({activeWorkday.code})
                  </span>
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                    {WORKDAY_STATUS_LABELS[activeWorkday.status]}
                  </span>
                </div>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Inventario físico final en progreso. Las ventas se encuentran temporalmente
                  suspendidas hasta concluir o suspender el cierre.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  onClick={() => navigate(ROUTES.warehouseWorkdayDetail(activeWorkday.id))}
                >
                  Ver expediente
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAttemptCloseWorkday}
                >
                  Continuar cierre
                </Button>
              </div>
            </div>
          ) : (
            /* 1.4 Jornada con cierre suspendido (CLOSING_SUSPENDED) */
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[#123F55]">
                    Jornada #{activeWorkday.consecutiveNumber} ({activeWorkday.code})
                  </span>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-800 border border-blue-200">
                    {WORKDAY_STATUS_LABELS[activeWorkday.status]}
                  </span>
                </div>
                <p className="text-xs text-blue-900 leading-relaxed">
                  Cierre suspendido temporalmente. Las ventas continúan habilitadas y asociadas al
                  mismo expediente.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  onClick={() => navigate(ROUTES.warehouseWorkdayDetail(activeWorkday.id))}
                >
                  Ver expediente
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAttemptCloseWorkday}
                >
                  Reanudar cierre
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CASO B: Cajero no ve botones administrativos, pero ve el estado y alertas de venta */}
      {!canManageWorkdays && (
        <>
          {!salesValidation.canOperateSales ? (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900"
            >
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-950">Ventas no habilitadas</p>
                <p className="mt-0.5">{salesValidation.message}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  Jornada operativa en curso:{' '}
                  <strong className="text-slate-900">
                    #{activeWorkday?.consecutiveNumber} ({activeWorkday?.code})
                  </strong>
                </span>
              </div>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
                Ventas autorizadas
              </span>
            </div>
          )}
        </>
      )}

      {/* Espacios superiores: Nueva Venta, Cuentas abiertas y Resumen de despachos */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {/* 1. Nueva Venta */}
        <Card className="flex flex-col justify-between">
          <CardBody className="flex h-full flex-col justify-between gap-5">
            <div>
              <p className="text-xs font-medium text-slate-500">Módulo de ventas</p>
              <h2 className="mt-1 text-lg font-semibold text-[#123F55]">Nueva venta</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                Prepare una cuenta abierta con nombre y consecutivo o realice un despacho directo
                de mercancía.
              </p>
            </div>

            {can(Permission.CREATE_SALE) && (
              <div>
                {salesValidation.canOperateSales ? (
                  <Button
                    variant="accent"
                    size="md"
                    icon={<Plus className="h-4 w-4" />}
                    onClick={openNewSaleModal}
                  >
                    Iniciar nueva venta
                  </Button>
                ) : (
                  <div className="space-y-1.5">
                    <Button
                      variant="secondary"
                      size="md"
                      icon={<Plus className="h-4 w-4" />}
                      disabled={true}
                      title={salesValidation.message}
                    >
                      Iniciar nueva venta
                    </Button>
                    <p className="text-[11px] text-amber-700 font-medium leading-tight">
                      {salesValidation.message}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* 2. Cuentas abiertas */}
        <Card className="flex flex-col justify-between">
          <CardBody className="flex h-full flex-col justify-between gap-5">
            <div>
              <p className="text-xs font-medium text-slate-500">Cuentas pendientes de despacho</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-[#123F55]">
                  {isLoadingSummary ? '—' : openSalesCount}
                </span>
                <span className="text-xs text-slate-500">
                  {openSalesCount === 1 ? 'cuenta abierta' : 'cuentas abiertas'}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {openSalesCount === 0
                  ? 'No existen cuentas abiertas en este momento.'
                  : 'Seleccione una cuenta para editar sus partidas o confirmar su despacho.'}
              </p>
            </div>
            <div>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowRight className="h-3.5 w-3.5" />}
                onClick={() => navigate(ROUTES.openSales)}
              >
                Abrir mesa de ventas
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* 3. Despachos de la jornada */}
        <Card className="flex flex-col justify-between">
          <CardBody className="flex h-full flex-col justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Control comercial</p>
              <h2 className="mt-1 text-lg font-semibold text-[#123F55]">
                Despachos de la jornada
              </h2>
              {summary?.canViewDailyIncome === false ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Información acumulada reservada para el rol Administrador.
                </p>
              ) : !summary?.hasActiveWorkday ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 space-y-1">
                  <span className="font-bold text-amber-900 block text-xs">
                    Sin jornada activa
                  </span>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Inicia una jornada para consultar sus despachos.
                  </p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                      TOTAL VENDIDO
                    </span>
                    <strong className="font-mono text-xl font-bold text-[#123F55] block mt-0.5">
                      {formatCurrency(summary?.dispatchedAmount ?? 0)}
                    </strong>
                  </div>

                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                      PRODUCTOS DESPACHADOS
                    </span>
                    <strong className="font-mono text-lg font-bold text-slate-800 block mt-0.5">
                      {summary?.workdayPerformance?.totalDispatchedUnits ?? 0} unidades
                    </strong>
                  </div>
                </div>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              Actividad vinculada estrictamente al expediente de la jornada activa
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Cuentas abiertas en seguimiento directo */}
      <Card>
        <CardHeader
          title="Cuentas abiertas en curso"
          description="Acceso directo a las cuentas que permanecen abiertas en el establecimiento."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(ROUTES.openSales)}
            >
              Abrir sección
            </Button>
          }
        />
        {summary && summary.openSales.length > 0 ? (
          <div className="divide-y divide-slate-200">
            {summary.openSales.map((openSale) => (
              <div
                key={openSale.id}
                className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#123F55]">
                    {formatSaleDisplayLabel(openSale)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                    Abierta: {formatDateTime(openSale.openedAt)} ·{' '}
                    {openSale.items?.length ?? 0} partida(s) ·{' '}
                    <strong className="font-mono text-slate-800">
                      {formatCurrency(openSale.totalAmount ?? 0)}
                    </strong>
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(ROUTES.openSaleDetail(openSale.id))}
                >
                  Atender cuenta
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={<ReceiptText className="h-5 w-5" />}
            title="No hay cuentas abiertas actualmente"
            description="Cuando se registre una cuenta abierta, podrá retomarla desde este espacio o directamente desde el menú lateral."
          />
        )}
      </Card>

      {/* Últimas ventas */}
      <Card>
        <CardHeader
          title="Últimos despachos y operaciones"
          description="Operaciones despachadas o canceladas recientemente en el establecimiento."
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<History className="h-3.5 w-3.5" />}
              onClick={() => navigate(ROUTES.salesHistory)}
            >
              Historial de ventas
            </Button>
          }
        />
        <DataTable
          columns={recentColumns}
          rows={recentSales}
          getRowKey={(row) => row.id}
          isLoading={isLoadingSummary}
          emptyTitle="Aún no se han registrado despachos"
          emptyDescription="Las operaciones despachadas aparecerán en esta tabla conforme se realicen."
        />
      </Card>

      {/* Modal 1: Apertura manual de jornada por el Administrador */}
      <Modal
        isOpen={isStartWorkdayModalOpen}
        onClose={() => !isSubmittingWorkday && setIsStartWorkdayModalOpen(false)}
        title="Iniciar jornada de inventario"
        description="Se creará automáticamente el expediente digital para registrar las operaciones del día."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={isSubmittingWorkday}
              onClick={() => setIsStartWorkdayModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={isSubmittingWorkday}
              icon={<PlayCircle className="h-4 w-4" />}
              onClick={handleStartWorkday}
            >
              {isSubmittingWorkday ? 'Iniciando jornada…' : 'Confirmar e iniciar jornada'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {workdayError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900"
            >
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-700 mt-0.5" />
              <span>{workdayError}</span>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Fecha y hora actual:</span>
              <strong className="font-semibold text-slate-900">{formatDateTime(nowISO())}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Usuario responsable:</span>
              <strong className="font-semibold text-slate-900">{actor.label} ({actor.role})</strong>
            </div>
          </div>

          <div>
            <label
              htmlFor="opening-notes-home"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Observaciones iniciales o notas de apertura (opcional)
            </label>
            <textarea
              id="opening-notes-home"
              rows={3}
              value={openingNotes}
              onChange={(e) => setOpeningNotes(e.target.value)}
              placeholder="Ej. Apertura de turno matutino, personal asignado a almacén y caja…"
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#1A5F7A] focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Modal 2: Bloqueo obligatorio de cierre de jornada por cuentas abiertas */}
      <Modal
        isOpen={closingBlockModal.isOpen}
        onClose={() =>
          setClosingBlockModal({ isOpen: false, message: '', pendingAccounts: [] })
        }
        title="Cierre de jornada bloqueado por cuentas abiertas"
        description={`Existen ${closingBlockModal.pendingAccounts.length} cuenta(s) abierta(s) pendiente(s) de despacho o cancelación.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setClosingBlockModal({ isOpen: false, message: '', pendingAccounts: [] })
              }
            >
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setClosingBlockModal({ isOpen: false, message: '', pendingAccounts: [] });
                navigate(ROUTES.openSales);
              }}
            >
              Ir a Cuentas abiertas
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 p-3.5 text-red-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-700 mt-0.5" />
            <div>
              <p className="font-semibold">{closingBlockModal.message}</p>
              <p className="mt-1 text-[11px] text-red-800">
                La jornada permanece en su estado actual sin pasar a proceso de cierre hasta que
                todas las cuentas abiertas sean resueltas.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block font-semibold text-slate-700">
              Cuentas abiertas que impiden el cierre ({closingBlockModal.pendingAccounts.length}):
            </span>
            <div className="max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200">
              {closingBlockModal.pendingAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between gap-3 bg-white px-3.5 py-2.5 hover:bg-slate-50"
                >
                  <div>
                    <div className="font-semibold text-[#123F55]">{acc.displayLabel}</div>
                    <div className="text-[11px] text-slate-500">
                      {acc.itemsCount} partida(s) ·{' '}
                      <strong className="font-mono text-slate-800">
                        {formatCurrency(acc.totalAmount)}
                      </strong>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setClosingBlockModal({
                        isOpen: false,
                        message: '',
                        pendingAccounts: [],
                      });
                      navigate(ROUTES.openSaleDetail(acc.id));
                    }}
                  >
                    Atender cuenta
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal 3: Aviso informativo para cierre y estados pendientes */}
      <Modal
        isOpen={noticeModal.isOpen}
        onClose={() => setNoticeModal((prev) => ({ ...prev, isOpen: false }))}
        title={noticeModal.title}
        description={noticeModal.description}
        footer={
          <Button
            variant="primary"
            size="md"
            onClick={() => setNoticeModal((prev) => ({ ...prev, isOpen: false }))}
          >
            Entendido
          </Button>
        }
      >
        <p className="text-xs leading-relaxed text-slate-600">{noticeModal.content}</p>
      </Modal>
    </div>
  );
}
