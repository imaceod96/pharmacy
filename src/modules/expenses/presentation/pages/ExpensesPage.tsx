import { useState } from 'react';
import {
  DollarSign,
  Package,
  Plus,
  Receipt,
  Trash2,
  TrendingDown,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { AccessDeniedState } from '../../../../shared/components/AccessDeniedState';
import { Button } from '../../../../shared/components/Button';
import { Card, CardBody, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import { ExpenseRecord, ExpenseType, EXPENSE_TYPE_LABELS } from '../../domain/entities/ExpenseRecord';
import { CreateExpenseModal } from '../components/CreateExpenseModal';

export function ExpensesPage() {
  const { actor, can } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate } = useRouter();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    readonly tone: 'success' | 'error';
    readonly text: string;
  } | null>(null);

  const canViewExpenses = can(Permission.VIEW_EXPENSES);
  const canCreateExpense = can(Permission.CREATE_EXPENSE);

  const {
    data: viewData,
    isLoading,
    reload,
  } = useAsyncQuery(
    () =>
      canViewExpenses
        ? useCases.expenses.listExpenses.execute(actor)
        : Promise.resolve(null),
    [useCases.expenses.listExpenses, actor, canViewExpenses, dataRevision]
  );

  const { data: products } = useAsyncQuery(
    () =>
      can(Permission.VIEW_PRODUCTS)
        ? useCases.warehouse.listProducts.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listProducts, actor, can, dataRevision]
  );

  if (!canViewExpenses) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Gastos Operativos"
          subtitle="Registro de autoconsumo de mercancías y desembolsos operativos."
        />
        <AccessDeniedState
          sectionName="Gastos Operativos"
          activeRoleLabel={actor.label}
          onReturnHome={() => navigate(ROUTES.home)}
        />
      </div>
    );
  }

  const handleDeleteExpense = async (expense: ExpenseRecord) => {
    if (
      !window.confirm(
        `¿Está seguro de anular el gasto "${expense.description}" por $${expense.amount.toFixed(2)}?${
          expense.type === ExpenseType.INVENTORY_PRODUCT
            ? ' Se restituirán las existencias en almacén.'
            : ''
        }`
      )
    ) {
      return;
    }

    setDeletingId(expense.id);
    setFeedbackMessage(null);

    try {
      await useCases.expenses.deleteExpense.execute(actor, expense.id);
      setFeedbackMessage({
        tone: 'success',
        text: 'Registro de gasto anulado correctamente.',
      });
      notifyDataChanged();
      await reload();
    } catch (err: any) {
      setFeedbackMessage({
        tone: 'error',
        text: err?.message || 'Error al anular el registro de gasto.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const columns: readonly TableColumn<ExpenseRecord>[] = [
    {
      key: 'timestamp',
      header: 'Fecha / Hora',
      tabular: true,
      render: (item) => (
        <span className="text-xs text-slate-600 font-mono">
          {formatDateTime(item.timestamp)}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      render: (item) => (
        <div className="flex items-center gap-1.5">
          {item.type === ExpenseType.INVENTORY_PRODUCT ? (
            <Package className="h-3.5 w-3.5 text-[#1A5F7A] shrink-0" />
          ) : (
            <Receipt className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          )}
          <span className="font-medium text-xs text-slate-800">
            {EXPENSE_TYPE_LABELS[item.type] ?? item.type}
          </span>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Descripción / Producto',
      render: (item) => (
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-slate-900 truncate text-xs">{item.description}</p>
          {item.productCode && (
            <p className="text-[11px] text-slate-500 font-mono">Código: {item.productCode}</p>
          )}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Cantidad',
      align: 'right',
      tabular: true,
      render: (item) =>
        item.type === ExpenseType.INVENTORY_PRODUCT && item.quantity ? (
          <span className="font-mono text-xs font-semibold text-slate-800">
            {item.quantity} u.
          </span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        ),
    },
    {
      key: 'unitCost',
      header: 'Costo Unitario',
      align: 'right',
      tabular: true,
      render: (item) =>
        item.type === ExpenseType.INVENTORY_PRODUCT && item.unitCost ? (
          <span className="font-mono text-xs text-slate-600">
            ${item.unitCost.toFixed(2)}
          </span>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        ),
    },
    {
      key: 'amount',
      header: 'Monto Total ($)',
      align: 'right',
      tabular: true,
      render: (item) => (
        <span className="font-mono text-xs font-bold text-red-700">
          -${item.amount.toFixed(2)}
        </span>
      ),
    },
    {
      key: 'responsibleUserLabel',
      header: 'Registrado Por',
      render: (item) => (
        <span className="text-xs text-slate-600">{item.responsibleUserLabel}</span>
      ),
    },
    {
      key: 'id',
      header: 'Acción',
      align: 'right',
      render: (item) => (
        <Button
          variant="secondary"
          size="sm"
          disabled={deletingId === item.id}
          icon={<Trash2 className="h-3.5 w-3.5 text-red-600" />}
          onClick={() => void handleDeleteExpense(item)}
        >
          {deletingId === item.id ? 'Anulando...' : 'Anular'}
        </Button>
      ),
    },
  ];

  const summary = viewData?.summary;
  const expensesList = viewData?.expenses ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gastos Operativos"
        subtitle="Registro de productos consumidos (autoconsumo) y gastos manuales con deducción automática al cierre de la jornada."
        actions={
          canCreateExpense && (
            <Button
              variant="primary"
              size="md"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setIsModalOpen(true)}
            >
              + Registrar Gasto
            </Button>
          )
        }
      />

      {feedbackMessage && (
        <div
          role="status"
          className={[
            'rounded-lg border px-4 py-3 text-xs font-medium',
            feedbackMessage.tone === 'success'
              ? 'border-[#287C99]/40 bg-white text-[#123F55]'
              : 'border-red-300 bg-red-50 text-red-800',
          ].join(' ')}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Tarjetas de Resumen Financiero Diario */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="p-4 flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
              <TrendingDown className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Gastos Totales del Día</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                ${summary?.totalAmount.toFixed(2) ?? '0.00'}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4 flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-[#123F55]">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Autoconsumo de Mercancía</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                ${summary?.totalProductExpenseAmount.toFixed(2) ?? '0.00'}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4 flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
              <DollarSign className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Gastos Manuales Operativos</p>
              <p className="mt-0.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
                ${summary?.totalManualExpenseAmount.toFixed(2) ?? '0.00'}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tabla de Registros de Gastos */}
      <Card>
        <CardHeader
          title="Historial de Gastos del Día"
          description={
            viewData?.activeWorkday
              ? `Gastos vinculados a la jornada activa ${viewData.activeWorkday.code}.`
              : 'Gastos registrados en el sistema.'
          }
        />
        <DataTable
          columns={columns}
          rows={expensesList}
          getRowKey={(item) => item.id}
          isLoading={isLoading}
          emptyIcon={<TrendingDown className="h-5 w-5" />}
          emptyTitle="Sin gastos registrados"
          emptyDescription="No se han registrado desembolsos ni mercancía de consumo propio en el día."
          emptyAction={
            canCreateExpense ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setIsModalOpen(true)}
              >
                + Registrar Gasto
              </Button>
            ) : undefined
          }
        />
      </Card>

      <CreateExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        products={products ?? []}
        onSubmit={async (payload) => {
          await useCases.expenses.createExpense.execute(actor, payload);
          setFeedbackMessage({
            tone: 'success',
            text: 'Gasto registrado correctamente.',
          });
          notifyDataChanged();
          await reload();
        }}
      />
    </div>
  );
}
