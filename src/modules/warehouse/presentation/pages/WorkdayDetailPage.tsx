import React, { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Package,
  PackageCheck,
  Receipt,
  Scissors,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { AccessDeniedState } from '../../../../shared/components/AccessDeniedState';
import { Button } from '../../../../shared/components/Button';
import { Card, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { formatCurrency } from '../../../../shared/utils/money';
import { OperationLogEntry } from '../../../core/domain/entities/OperationLog';
import {
  WorkdayDispatchedSaleItem,
  WorkdayMovementItem,
} from '../../application/GetWorkdayDetailUseCase';
import {
  PARTIAL_CUT_DIFFERENCE_TYPE_LABELS,
  PARTIAL_CUT_STATUS_LABELS,
  PartialCutStatus,
  PartialInventoryCutRecord,
} from '../../domain/entities/InventoryCutRecord';
import { WORKDAY_STATUS_LABELS, WorkdayStatus } from '../../domain/entities/WorkdayRecord';
import { FinalInventoryWorkspace } from '../components/FinalInventoryWorkspace';
import { PartialCutCommercialAndBalanceSummary } from '../components/PartialCutCommercialAndBalanceSummary';
import { WorkdayCommercialPerformanceSummary } from '../components/WorkdayCommercialPerformanceSummary';

export interface WorkdayDetailPageProps {
  readonly workdayId: string;
}

type DossierTab =
  | 'summary'
  | 'sales'
  | 'partialCuts'
  | 'finalInventory'
  | 'movements'
  | 'audit';

export function WorkdayDetailPage({ workdayId }: WorkdayDetailPageProps) {
  const { actor, can } = useSession();
  const { useCases, dataRevision } = useApplication();
  const { navigate } = useRouter();

  const [activeTab, setActiveTab] = useState<DossierTab>('summary');
  const [selectedCutForModal, setSelectedCutForModal] =
    useState<PartialInventoryCutRecord | null>(null);

  const hasAccess = can(Permission.VIEW_INVENTORY_CUTS);
  const canViewCosts = can(Permission.VIEW_PRODUCT_COSTS);
  const canManageCuts = can(Permission.MANAGE_INVENTORY_CUTS);

  const { data: dossier, isLoading, error } = useAsyncQuery(
    () =>
      hasAccess
        ? useCases.warehouse.getWorkdayDetail.execute(actor, workdayId)
        : Promise.reject(new Error('Acceso no autorizado')),
    [useCases.warehouse.getWorkdayDetail, actor, workdayId, hasAccess, dataRevision]
  );

  React.useEffect(() => {
    if (dossier?.workday) {
      if (
        dossier.workday.status === WorkdayStatus.CLOSING ||
        dossier.workday.status === WorkdayStatus.CLOSING_SUSPENDED
      ) {
        setActiveTab('finalInventory');
      }
    }
  }, [dossier?.workday?.status]);

  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Expediente de jornada"
          subtitle="Consulta histórica y trazabilidad operativa de almacén."
        />
        <AccessDeniedState
          sectionName="Expediente de jornada"
          activeRoleLabel={actor.label}
          onReturnHome={() => navigate(ROUTES.warehouseInventoryCuts)}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center text-xs font-medium text-slate-500">
        Cargando expediente de la jornada…
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Expediente de jornada"
          subtitle="Detalle del expediente digital"
        />
        <Card>
          <div className="p-8 text-center">
            <h3 className="text-sm font-semibold text-slate-800">
              Expediente no encontrado
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {error || 'No se localizó la jornada especificada.'}
            </p>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft className="h-3.5 w-3.5" />}
                onClick={() => navigate(ROUTES.warehouseInventoryCuts)}
              >
                Volver a Inventarios / Corte
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const { workday, movements, auditEntries, partialCuts, sales } = dossier;

  const statusBadge = (status: WorkdayStatus) => {
    switch (status) {
      case WorkdayStatus.OPEN:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
      case WorkdayStatus.CLOSING:
      case WorkdayStatus.CLOSING_SUSPENDED:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
      case WorkdayStatus.CLOSED:
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
            {WORKDAY_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  const partialCutStatusBadge = (status: PartialCutStatus) => {
    switch (status) {
      case PartialCutStatus.DRAFT:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
            <Clock className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.READY_FOR_REVIEW:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <ClipboardList className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.APPROVED:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
      case PartialCutStatus.CANCELLED:
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
            <XCircle className="h-3 w-3" />
            {PARTIAL_CUT_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  const tabs: readonly { id: DossierTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'summary', label: 'Resumen', icon: <FileText className="h-4 w-4" /> },
    {
      id: 'sales',
      label: 'Ventas y despachos',
      icon: <Receipt className="h-4 w-4" />,
      badge: sales.length,
    },
    {
      id: 'partialCuts',
      label: 'Cortes parciales',
      icon: <Scissors className="h-4 w-4" />,
      badge: partialCuts.length,
    },
    { id: 'finalInventory', label: 'Inventario final', icon: <FileSpreadsheet className="h-4 w-4" />, badge: 0 },
    {
      id: 'movements',
      label: 'Movimientos',
      icon: <Package className="h-4 w-4" />,
      badge: movements.length,
    },
    {
      id: 'audit',
      label: 'Auditoría',
      icon: <History className="h-4 w-4" />,
      badge: auditEntries.length,
    },
  ];

  const dispatchedSalesColumns: readonly TableColumn<WorkdayDispatchedSaleItem>[] = [
    {
      key: 'displayLabel',
      header: 'Cuenta / Folio',
      render: (s) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#123F55]">{s.displayLabel}</span>
            {s.isPriorWorkdayAccount && (
              <span className="text-[10px] bg-amber-100 text-amber-800 font-medium px-1.5 py-0.5 rounded border border-amber-300">
                Mesa de jornada previa {s.priorWorkdayCode ? `(${s.priorWorkdayCode})` : ''}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500">
            {s.originType === 'DIRECT_DISPATCH' ? 'Despacho directo' : 'Cuenta abierta'}
          </div>
        </div>
      ),
    },
    {
      key: 'dispatchedAt',
      header: 'Fecha y hora de despacho',
      tabular: true,
      render: (s) => (
        <div className="text-xs text-slate-700">
          <div>{formatDateTime(s.dispatchedAt)}</div>
          <div className="text-[11px] text-slate-500">
            Responsable: {s.dispatchedByUserLabel}
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Productos despachados',
      render: (s) => (
        <div className="space-y-1 text-xs">
          {s.items.map((item) => (
            <div key={item.productId} className="flex items-center justify-between gap-3">
              <span className="text-slate-800">
                {item.productName}{' '}
                <strong className="font-mono text-slate-600">
                  ({item.quantity} {item.unitSymbol || item.unitName})
                </strong>
              </span>
              <span className="font-mono text-slate-600">
                {formatCurrency(item.unitSalePrice)} c/u →{' '}
                <strong className="text-slate-900">
                  {formatCurrency(item.lineSubtotal)}
                </strong>
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'totalAmount',
      header: 'Importe total',
      align: 'right',
      tabular: true,
      render: (s) => (
        <span className="font-mono text-xs font-bold text-[#123F55]">
          {formatCurrency(s.totalAmount)}
        </span>
      ),
    },
    {
      key: 'movements',
      header: 'Ref. Movimientos Kardex',
      align: 'right',
      render: (s) => (
        <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
          {s.inventoryMovementIds.length} mov. salida
        </span>
      ),
    },
  ];

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
          <div>Inicio: {formatDateTime(c.intervalStartAt)}</div>
          <div className="text-slate-500">Fin: {formatDateTime(c.intervalEndAt)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => partialCutStatusBadge(c.status),
    },
    {
      key: 'commercialActivity',
      header: 'Actividad comercial',
      render: (c) => {
        const activity = c.commercialActivity;
        if (!activity) {
          return <span className="text-xs text-slate-400 italic">—</span>;
        }
        return (
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-slate-800">
              {activity.totalDispatchesCount} despacho(s) ({activity.distinctProductsCount} prod.)
            </div>
            <div className="font-mono text-[11px] font-bold text-[#123F55]">
              Valor despachado: {formatCurrency(activity.totalCommercialValue)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'products',
      header: 'Productos / Diferencias',
      render: (c) => {
        const counted = c.items.filter((i) => i.countedPhysicalQuantity !== null).length;
        if (c.status === PartialCutStatus.DRAFT || !c.summary) {
          return (
            <span className="font-mono text-xs font-semibold text-slate-800">
              {counted} / {c.items.length} contados
            </span>
          );
        }
        return (
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-slate-800">
              {c.summary.totalProductsAudited} auditados ({c.summary.productsWithoutDifference} exactos)
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-red-700">
                Faltantes: <strong>{c.summary.productsWithShortage}</strong>
              </span>
              <span className="text-blue-700">
                Sobrantes: <strong>{c.summary.productsWithSurplus}</strong>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'valuation',
      header: 'Balance neto del inventario',
      render: (c) => {
        if (
          c.status === PartialCutStatus.DRAFT ||
          c.status === PartialCutStatus.CANCELLED ||
          !c.summary ||
          !canManageCuts
        ) {
          return <span className="text-xs text-slate-400 italic">—</span>;
        }
        return (
          <div className="text-[11px] font-mono space-y-0.5">
            <div>
              Neto P.V.:{' '}
              <strong
                className={
                  c.summary.netSaleBalance < 0
                    ? 'text-red-700'
                    : c.summary.netSaleBalance > 0
                      ? 'text-blue-700'
                      : 'text-slate-800'
                }
              >
                {formatCurrency(c.summary.netSaleBalance)}
              </strong>
            </div>
            {canViewCosts && (
              <div className="text-slate-600">
                Neto Costo:{' '}
                <strong>{formatCurrency(c.summary.netPurchaseBalance)}</strong>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'responsible',
      header: 'Responsable / Aprobación',
      render: (c) => (
        <div className="text-xs text-slate-700">
          <div>{c.approvedByUserLabel || c.responsibleUserLabel}</div>
          {c.status === PartialCutStatus.APPROVED && c.approvedAt && (
            <div className="text-[11px] text-emerald-700 font-medium">
              Aprobado: {formatDateTime(c.approvedAt)}
            </div>
          )}
          {c.status === PartialCutStatus.CANCELLED && c.cancellationReason && (
            <div className="text-[11px] text-red-600 italic">
              Cancelado: {c.cancellationReason}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Detalle',
      align: 'right',
      render: (c) => (
        <Button
          variant="secondary"
          size="sm"
          icon={<Eye className="h-3 w-3" />}
          onClick={() => setSelectedCutForModal(c)}
        >
          Ver detalle
        </Button>
      ),
    },
  ];

  const movementColumns: readonly TableColumn<WorkdayMovementItem>[] = [
    {
      key: 'timestamp',
      header: 'Fecha y hora',
      tabular: true,
      render: (m) => formatDateTime(m.timestamp),
    },
    {
      key: 'productName',
      header: 'Producto',
      render: (m) => <span className="font-medium text-slate-900">{m.productName}</span>,
    },
    {
      key: 'movementType',
      header: 'Tipo',
      render: (m) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
            {m.movementType}
          </span>
          {m.partialCutFolio && (
            <span className="font-mono text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
              {m.partialCutFolio}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      align: 'right',
      tabular: true,
      render: (m) => {
        const signedDelta =
          m.signedQuantity !== undefined
            ? m.signedQuantity
            : m.resultingStock - m.previousStock;
        const isNegative =
          m.movementType === 'SALE' ||
          m.movementType === 'CORRECTION_NEGATIVE' ||
          (m.movementType === 'PARTIAL_CUT_ADJUSTMENT' && signedDelta < 0);
        const absVal = Math.abs(
          m.movementType === 'PARTIAL_CUT_ADJUSTMENT' ? signedDelta : m.quantity
        );
        return (
          <span
            className={`font-mono font-semibold ${
              isNegative ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {isNegative ? `-${absVal.toFixed(2)}` : `+${absVal.toFixed(2)}`}
          </span>
        );
      },
    },
    {
      key: 'resultingStock',
      header: 'Existencia resultante',
      align: 'right',
      tabular: true,
      render: (m) => (
        <span className="font-mono text-slate-700">{m.resultingStock.toFixed(2)}</span>
      ),
    },
    {
      key: 'reason',
      header: 'Motivo / Referencia',
      render: (m) => (
        <span className="text-xs text-slate-600 italic">
          {m.reason || 'Sin motivo especificado'}
        </span>
      ),
    },
  ];

  const auditColumns: readonly TableColumn<OperationLogEntry>[] = [
    {
      key: 'createdAt',
      header: 'Fecha y hora',
      tabular: true,
      render: (op) => formatDateTime(op.createdAt),
    },
    {
      key: 'action',
      header: 'Acción',
      render: (op) => (
        <span className="font-mono text-xs font-semibold text-[#1A5F7A]">
          {op.action}
        </span>
      ),
    },
    {
      key: 'actorRole',
      header: 'Rol de usuario',
      render: (op) => (
        <span className="text-xs text-slate-700">
          {op.actorRole}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Descripción del evento',
      render: (op) => (
        <span className="text-xs text-slate-600">
          {op.description}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowLeft className="h-3.5 w-3.5" />}
          onClick={() => navigate(ROUTES.warehouseInventoryCuts)}
        >
          Volver a Inventarios / Corte
        </Button>
      </div>

      {/* Cabecera del Expediente */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-[#123F55]">
                Jornada #{workday.consecutiveNumber}
              </h1>
              <span className="font-mono text-sm font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                {workday.code}
              </span>
              {statusBadge(workday.status)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Expediente digital único de jornada · Persistencia offline en IndexedDB
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>Apertura: <strong>{formatDateTime(workday.openedAt)}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-slate-400" />
              <span>Responsable: <strong>{workday.openedByUserLabel}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Pestañas de navegación interna del expediente */}
      <div className="flex border-b border-slate-200 space-x-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer',
                isActive
                  ? 'border-[#1A5F7A] text-[#1A5F7A] font-semibold'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300',
              ].join(' ')}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={[
                    'ml-1 rounded-full px-1.5 py-0.2 text-[10px] font-mono tabular-nums',
                    isActive ? 'bg-[#1A5F7A]/10 text-[#1A5F7A]' : 'bg-slate-100 text-slate-600',
                  ].join(' ')}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Contenido según pestaña activa */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {dossier.commercialPerformance && (
            <WorkdayCommercialPerformanceSummary
              performance={dossier.commercialPerformance}
              dispatchedSales={sales}
              canViewCosts={canViewCosts}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader
              title="Ficha técnica de la jornada"
              description="Metadatos e identificadores estables del expediente."
            />
            <div className="p-6 pt-0 space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Identificador inmutable:</span>
                <span className="font-mono text-slate-800">{workday.id}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Número consecutivo:</span>
                <span className="font-bold text-[#123F55]">#{workday.consecutiveNumber}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Folio visible:</span>
                <span className="font-mono font-medium text-slate-800">{workday.code}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Estado operativo:</span>
                <div>{statusBadge(workday.status)}</div>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Fecha y hora de apertura:</span>
                <span className="font-medium text-slate-800">{formatDateTime(workday.openedAt)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Responsable de apertura:</span>
                <span className="font-medium text-slate-800">{workday.openedByUserLabel}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Despachos registrados en la jornada:</span>
                <span className="font-semibold text-emerald-700">{sales.length}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Cortes parciales asociados:</span>
                <span className="font-semibold text-slate-800">{partialCuts.length}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-500">Fecha y hora de cierre:</span>
                <span className="text-slate-800">
                  {workday.closedAt ? formatDateTime(workday.closedAt) : 'En curso (jornada activa)'}
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">Responsable de cierre:</span>
                <span className="text-slate-800">
                  {workday.closedByUserLabel || 'Pendiente de cierre'}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Observaciones y control operativo"
              description="Notas registradas y reglas de integridad."
            />
            <div className="p-6 pt-0 space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Notas de apertura:
                </label>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-700 italic">
                  {workday.notes || 'Sin observaciones registradas al momento de apertura.'}
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-blue-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-blue-700 shrink-0" />
                  <span>Criterio de medianoche e integridad</span>
                </div>
                <p className="text-[11px] leading-relaxed text-blue-800">
                  La jornada pertenece a su fecha de apertura ({workday.openedAt.substring(0, 10)}), pero
                  abarca todas las operaciones hasta su cierre manual definitivo, aun cruzando la
                  medianoche sin segmentar registros.
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-slate-700 space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-slate-800">
                  <ShieldCheck className="h-4 w-4 text-[#1A5F7A] shrink-0" />
                  <span>Auditoría inmutable</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  El expediente conserva un historial inalterable. Los despachos de mercancía,
                  cortes parciales, recuentos y auditorías permanecen asociados a esta jornada.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Resumen de Cuentas / Mesas Abiertas */}
        {dossier.openAccountsStockBreakdown && dossier.openAccountsStockBreakdown.length > 0 && (
          <Card>
            <CardHeader
              title={`Mercancía en Cuentas Abiertas (${dossier.openAccountsCount ?? 0} cuenta(s) en curso)`}
              description="Productos ya descontados físicamente del almacén. No forman parte del dinero de ventas de la jornada hasta ser despachados o liquidados manualmente."
            />
            <div className="p-6 pt-0 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                  <span className="text-slate-600 block text-[11px]">Unidades en mesas/cuentas:</span>
                  <span className="text-lg font-bold font-mono text-amber-900">
                    {dossier.openAccountsTotalUnits ?? 0} unidades
                  </span>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                  <span className="text-slate-600 block text-[11px]">Valor comercial pendiente de liquidar:</span>
                  <span className="text-lg font-bold font-mono text-blue-900">
                    {formatCurrency(dossier.openAccountsTotalValue ?? 0)}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Producto</th>
                      <th className="p-2.5 text-right">Cantidad en Mesas</th>
                      <th className="p-2.5 text-right">Importe Valorizado</th>
                      <th className="p-2.5 text-right">Mesas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dossier.openAccountsStockBreakdown.map((item) => (
                      <tr key={item.productId} className="hover:bg-slate-50">
                        <td className="p-2.5 font-medium text-slate-900">{item.productName}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-slate-800">
                          {item.quantity} {item.unitName}
                        </td>
                        <td className="p-2.5 text-right font-mono font-semibold text-emerald-700">
                          {formatCurrency(item.totalValue)}
                        </td>
                        <td className="p-2.5 text-right text-slate-500 font-mono">
                          {item.accountCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        )}
      </div>
    )}

      {activeTab === 'sales' && (
        <Card>
          <CardHeader
            title={`Despachos de mercancía registrados en la jornada (${sales.length})`}
            description="Operaciones comerciales despachadas dentro de este expediente digital con precios congelados y referencia a movimientos de inventario."
          />
          {sales.length > 0 ? (
            <DataTable
              columns={dispatchedSalesColumns}
              rows={sales}
              getRowKey={(row) => row.id}
              emptyTitle="Sin despachos registrados en esta jornada"
              emptyDescription="Cuando se confirmen despachos directos o de cuentas abiertas dentro de esta jornada, quedarán detallados aquí."
            />
          ) : (
            <EmptyState
              icon={<PackageCheck className="h-5 w-5" />}
              title="Sin despachos registrados en esta jornada"
              description="Cuando se confirmen despachos directos o de cuentas abiertas dentro de esta jornada, quedarán detallados aquí con sus partidas y movimientos de inventario."
            />
          )}
        </Card>
      )}

      {activeTab === 'partialCuts' && (
        <Card>
          <CardHeader
            title="Cortes parciales de inventario"
            description="Cortes parciales reales asociados a este expediente digital (incluyendo borradores, revisiones y cortes cancelados)."
          />
          <DataTable
            columns={partialCutColumns}
            rows={partialCuts}
            getRowKey={(row) => row.id}
            emptyIcon={<Scissors className="h-5 w-5" />}
            emptyTitle="Sin cortes parciales registrados en esta jornada"
            emptyDescription="Cuando se creen cortes parciales dentro de esta jornada, quedarán registrados cronológicamente aquí."
          />
        </Card>
      )}

      {activeTab === 'finalInventory' && (
        <FinalInventoryWorkspace
          workday={workday}
          commercialPerformance={dossier.commercialPerformance}
          dispatchedSales={sales}
          rectifications={dossier.rectifications}
          onReturn={() => setActiveTab('summary')}
        />
      )}

      {activeTab === 'movements' && (
        <Card>
          <CardHeader
            title="Movimientos de mercancía vinculados"
            description="Entradas, salidas por despacho y correcciones de almacén registradas durante esta jornada."
          />
          <DataTable
            columns={movementColumns}
            rows={movements}
            getRowKey={(row) => row.id}
            emptyIcon={<Package className="h-5 w-5" />}
            emptyTitle="Sin movimientos vinculados a esta jornada"
            emptyDescription="Cuando se registren entradas, salidas por despacho o correcciones asociadas a este expediente, aparecerán cronológicamente aquí."
          />
        </Card>
      )}

      {activeTab === 'audit' && (
        <Card>
          <CardHeader
            title="Trazabilidad y auditoría de la jornada"
            description="Registro histórico inmutable de eventos operados en este expediente."
          />
          <DataTable
            columns={auditColumns}
            rows={auditEntries}
            getRowKey={(row) => row.id}
            emptyIcon={<History className="h-5 w-5" />}
            emptyTitle="Sin registros de auditoría"
            emptyDescription="No se registran eventos adicionales de auditoría para este expediente."
          />
        </Card>
      )}

      {/* Modal de detalle inmutable de corte parcial */}
      <Modal
        isOpen={Boolean(selectedCutForModal)}
        onClose={() => setSelectedCutForModal(null)}
        maxWidthClassName="max-w-4xl"
        title={
          selectedCutForModal
            ? `Detalle de Corte Parcial #${selectedCutForModal.consecutiveNumber} (${selectedCutForModal.reference})`
            : 'Detalle de Corte Parcial'
        }
        description={
          selectedCutForModal
            ? `Intervalo cubierto: ${formatDateTime(selectedCutForModal.intervalStartAt)} a ${formatDateTime(selectedCutForModal.intervalEndAt)}`
            : ''
        }
        footer={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelectedCutForModal(null)}
          >
            Cerrar
          </Button>
        }
      >
        {selectedCutForModal && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div>
                <span className="text-slate-500 block text-[11px]">Estado:</span>
                <div className="mt-0.5">{partialCutStatusBadge(selectedCutForModal.status)}</div>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Responsable / Aprobador:</span>
                <strong className="text-slate-800">
                  {selectedCutForModal.approvedByUserLabel ||
                    selectedCutForModal.responsibleUserLabel}
                </strong>
                {selectedCutForModal.approvedAt && (
                  <span className="block text-[10px] text-emerald-700">
                    Aprobado: {formatDateTime(selectedCutForModal.approvedAt)}
                  </span>
                )}
              </div>
            </div>

            {selectedCutForModal.status !== PartialCutStatus.DRAFT &&
              selectedCutForModal.commercialActivity &&
              selectedCutForModal.summary && (
                <PartialCutCommercialAndBalanceSummary
                  commercialActivity={selectedCutForModal.commercialActivity}
                  summary={selectedCutForModal.summary}
                  countedProductsCount={
                    selectedCutForModal.items.filter(
                      (i) => i.countedPhysicalQuantity !== null
                    ).length
                  }
                  canViewCosts={canViewCosts}
                  canViewInventoryBalances={canManageCuts}
                  compact
                />
              )}

            {selectedCutForModal.status === PartialCutStatus.DRAFT ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Este corte se encuentra en etapa de conteo ciego. Por regla de control interno no se
                muestran existencias teóricas ni diferencias mientras permanezca en borrador.
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-800">
                  Partidas auditadas en el corte ({selectedCutForModal.items.length})
                </h4>
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {selectedCutForModal.items.map((item) => {
                    const diffQty = item.differenceQuantity ?? 0;
                    const diffType =
                      item.differenceType ??
                      (diffQty < 0 ? 'SHORTAGE' : diffQty > 0 ? 'SURPLUS' : 'NONE');
                    return (
                      <div key={item.productId} className="p-2.5 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-[#123F55]">{item.productName}</span>{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              ({item.productCode} · {item.unitOfMeasureLabel})
                            </span>
                          </div>
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold ${
                              diffType === 'SHORTAGE'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : diffType === 'SURPLUS'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {PARTIAL_CUT_DIFFERENCE_TYPE_LABELS[diffType]}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-600">
                          <span>
                            Físico: <strong>{item.countedPhysicalQuantity ?? '—'}</strong>
                          </span>
                          <span>
                            Teórico:{' '}
                            <strong>
                              {item.reconciledTheoreticalStock ??
                                item.theoreticalStockAtCutEnd}
                            </strong>
                          </span>
                          <span>
                            Dif.:{' '}
                            <strong
                              className={
                                diffQty < 0
                                  ? 'text-red-700'
                                  : diffQty > 0
                                    ? 'text-blue-700'
                                    : 'text-emerald-700'
                              }
                            >
                              {diffQty > 0 ? `+${diffQty}` : diffQty}
                            </strong>
                          </span>
                          {item.stockAfterApproval !== undefined && (
                            <span>
                              Stock post-ajuste: <strong>{item.stockAfterApproval}</strong>
                            </span>
                          )}
                          {canManageCuts &&
                            item.differenceSaleValuation !== undefined &&
                            diffQty !== 0 && (
                              <span>
                                Val. P.V.:{' '}
                                <strong>{formatCurrency(item.differenceSaleValuation)}</strong>
                              </span>
                            )}
                          {canViewCosts &&
                            item.differencePurchaseValuation !== undefined &&
                            diffQty !== 0 && (
                              <span>
                                Val. Costo:{' '}
                                <strong>{formatCurrency(item.differencePurchaseValuation)}</strong>
                              </span>
                            )}
                        </div>
                        {item.differenceReason && (
                          <div className="text-[11px] text-slate-700 italic">
                            Motivo: «{item.differenceReason}»
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

