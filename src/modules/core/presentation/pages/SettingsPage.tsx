import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FolderTree,
  HardDrive,
  Plus,
  RotateCcw,
  Scale,
  Upload,
} from 'lucide-react';
import { useApplication } from '../../../../app/providers/ApplicationProvider';
import { useSession } from '../../../../app/providers/SessionProvider';
import { ROUTES } from '../../../../app/router/routes';
import { useRouter } from '../../../../app/router/RouterProvider';
import { AccessDeniedState } from '../../../../shared/components/AccessDeniedState';
import { Button } from '../../../../shared/components/Button';
import { Card, CardBody, CardHeader } from '../../../../shared/components/Card';
import { DataTable, TableColumn } from '../../../../shared/components/DataTable';
import { FormField } from '../../../../shared/components/FormField';
import { Modal } from '../../../../shared/components/Modal';
import { PageHeader } from '../../../../shared/components/PageHeader';
import { useAsyncQuery } from '../../../../shared/hooks/useAsyncQuery';
import { ROLE_LABELS } from '../../../../shared/lib/permissions/rolePolicy';
import { Permission } from '../../../../shared/types/permissions';
import { formatDateTime } from '../../../../shared/utils/date';
import {
  OperationLogEntry,
  OperationModule,
} from '../../domain/entities/OperationLog';
import { CategoryRecord } from '../../../warehouse/domain/entities/CategoryRecord';
import { MeasurementUnitRecord } from '../../../warehouse/domain/entities/MeasurementUnitRecord';
import { CreateCategoryModal } from '../../../warehouse/presentation/components/CreateCategoryModal';
import { CreateMeasurementUnitModal } from '../../../warehouse/presentation/components/CreateMeasurementUnitModal';
import { ExcelImportModal } from '../../../warehouse/presentation/components/ExcelImportModal';

const MODULE_LABELS: Record<OperationModule, string> = {
  [OperationModule.CORE]: 'Sistema',
  [OperationModule.WAREHOUSE]: 'Almacén',
  [OperationModule.SALES]: 'Ventas',
};

export function SettingsPage() {
  const { actor, can, switchToCashier } = useSession();
  const { useCases, dataRevision, notifyDataChanged } = useApplication();
  const { navigate } = useRouter();

  const [feedbackMessage, setFeedbackMessage] = useState<{
    readonly tone: 'success' | 'error';
    readonly text: string;
  } | null>(null);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState<boolean>(false);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  // Modals for Warehouse Catalogs
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);
  const [isUnitModalOpen, setIsUnitModalOpen] = useState<boolean>(false);

  // Admin PIN Change state
  const [currentPin, setCurrentPin] = useState<string>('');
  const [newPin, setNewPin] = useState<string>('');
  const [confirmNewPin, setConfirmNewPin] = useState<string>('');
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);
  const [isChangingPin, setIsChangingPin] = useState<boolean>(false);

  const hasSettingsAccess = can(Permission.VIEW_SETTINGS);
  const canManageCatalogs = can(Permission.MANAGE_PRODUCTS);

  const {
    data: storageStatus,
    isLoading: isStatusLoading,
    reload: reloadStatus,
  } = useAsyncQuery(
    () =>
      hasSettingsAccess
        ? useCases.core.getSystemStatus.execute(actor)
        : Promise.resolve(null),
    [useCases.core.getSystemStatus, actor, hasSettingsAccess, dataRevision]
  );

  const {
    data: operationHistory,
    isLoading: isHistoryLoading,
    reload: reloadHistory,
  } = useAsyncQuery(
    () =>
      hasSettingsAccess
        ? useCases.core.getOperationHistory.execute(actor, 50)
        : Promise.resolve([]),
    [useCases.core.getOperationHistory, actor, hasSettingsAccess, dataRevision]
  );

  const {
    data: categories,
    isLoading: isCategoriesLoading,
    reload: reloadCategories,
  } = useAsyncQuery(
    () =>
      hasSettingsAccess
        ? useCases.warehouse.listCategories.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listCategories, actor, hasSettingsAccess, dataRevision]
  );

  const {
    data: measurementUnits,
    isLoading: isUnitsLoading,
    reload: reloadUnits,
  } = useAsyncQuery(
    () =>
      hasSettingsAccess
        ? useCases.warehouse.listMeasurementUnits.execute(actor)
        : Promise.resolve([]),
    [useCases.warehouse.listMeasurementUnits, actor, hasSettingsAccess, dataRevision]
  );


  if (!hasSettingsAccess) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Ajustes"
          subtitle="Configuración general, copias de seguridad y catálogos administrativos."
        />
        <AccessDeniedState
          sectionName="Ajustes"
          activeRoleLabel={actor.label}
          onReturnHome={() => navigate(ROUTES.home)}
        />
      </div>
    );
  }

  const handleExportBackup = async () => {
    setFeedbackMessage(null);
    setIsExporting(true);
    try {
      const fileName = await useCases.core.exportBackup.execute(actor);
      setFeedbackMessage({
        tone: 'success',
        text: `Copia de seguridad generada correctamente (${fileName}).`,
      });
      notifyDataChanged();
      await Promise.all([reloadStatus(), reloadHistory()]);
    } catch (err) {
      setFeedbackMessage({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'No fue posible exportar la copia de seguridad.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportExcel = async () => {
    setFeedbackMessage(null);
    setIsExportingExcel(true);
    try {
      const allProducts = await useCases.warehouse.listProducts.execute(actor);
      const { fileName, rowCount } = useCases.warehouse.excelInventory.exportToExcel(
        actor,
        allProducts
      );
      setFeedbackMessage({
        tone: 'success',
        text: `Catálogo de inventario exportado exitosamente a Excel (${fileName}) con ${rowCount} productos.`,
      });
      notifyDataChanged();
      await reloadHistory();
    } catch (err) {
      setFeedbackMessage({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'No fue posible exportar el catálogo de inventario a Excel.',
      });
    } finally {
      setIsExportingExcel(false);
    }
  };

  const [restorePin, setRestorePin] = useState<string>('');

  const handleOpenRestoreModal = () => {
    setSelectedFile(null);
    setRestorePin('');
    setRestoreError(null);
    setIsRestoreModalOpen(true);
  };

  const handleConfirmRestore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFile) {
      setRestoreError('Seleccione un archivo JSON de respaldo válido.');
      return;
    }
    if (restorePin.length !== 6) {
      setRestoreError('Ingrese el PIN de 6 dígitos para reautenticar y confirmar la restauración.');
      return;
    }

    setRestoreError(null);
    setIsRestoring(true);

    try {
      const verifyRes = await useCases.core.verifyAdminPin.execute(actor, {
        pin: restorePin,
        scope: 'RESTORE_BACKUP',
      });
      await useCases.core.restoreBackup.execute(
        actor,
        selectedFile,
        verifyRes.criticalToken!
      );
      setIsRestoreModalOpen(false);
      setSelectedFile(null);
      setRestorePin('');
      // Revocar privilegio ADMIN activo y volver a modo Cajero por seguridad
      switchToCashier();
      setFeedbackMessage({
        tone: 'success',
        text: 'La copia de seguridad se restauró correctamente. Por seguridad, la sesión ha vuelto al modo Cajero.',
      });
      notifyDataChanged();
      await Promise.all([
        reloadStatus(),
        reloadHistory(),
        reloadCategories(),
        reloadUnits(),
      ]);
    } catch (err) {
      setRestoreError(
        err instanceof Error
          ? err.message
          : 'Error al restaurar la copia de seguridad.'
      );
    } finally {
      setIsRestoring(false);
    }
  };

  const categoryColumns: readonly TableColumn<CategoryRecord>[] = [
    {
      key: 'name',
      header: 'Nombre de la categoría',
      render: (cat) => <span className="font-medium text-[#123F55]">{cat.name}</span>,
    },
    {
      key: 'createdAt',
      header: 'Fecha de creación',
      align: 'right',
      tabular: true,
      render: (cat) => formatDateTime(cat.createdAt),
    },
  ];

  const unitColumns: readonly TableColumn<MeasurementUnitRecord>[] = [
    {
      key: 'name',
      header: 'Unidad de medida',
      render: (unit) => <span className="font-medium text-[#123F55]">{unit.name}</span>,
    },
    {
      key: 'createdAt',
      header: 'Fecha de creación',
      align: 'right',
      tabular: true,
      render: (unit) => formatDateTime(unit.createdAt),
    },
  ];

  const historyColumns: readonly TableColumn<OperationLogEntry>[] = [
    {
      key: 'createdAt',
      header: 'Fecha y hora',
      tabular: true,
      render: (entry) => formatDateTime(entry.createdAt),
    },
    {
      key: 'module',
      header: 'Módulo',
      render: (entry) => (
        <span className="font-medium text-[#123F55]">
          {MODULE_LABELS[entry.module] ?? entry.module}
        </span>
      ),
    },
    {
      key: 'actorRole',
      header: 'Rol',
      render: (entry) => ROLE_LABELS[entry.actorRole] ?? entry.actorRole,
    },
    {
      key: 'description',
      header: 'Operación registrada',
      render: (entry) => entry.description,
    },
  ];

  const handleChangeAdminPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinChangeError(null);
    setIsChangingPin(true);

    try {
      await useCases.core.changeAdminPin.execute(actor, {
        currentPin,
        newPin,
        confirmNewPin,
      });
      setCurrentPin('');
      setNewPin('');
      setConfirmNewPin('');
      setFeedbackMessage({
        tone: 'success',
        text: 'El PIN administrativo de 6 dígitos ha sido actualizado correctamente.',
      });
      notifyDataChanged();
      await reloadHistory();
    } catch (err: any) {
      setPinChangeError(err.message || 'Error al cambiar el PIN de administrador.');
    } finally {
      setIsChangingPin(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ajustes"
        subtitle="Administración del almacenamiento local, respaldos y catálogos de almacén."
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

      {/* 1. Catálogos de Almacén (Categorías y Unidades) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Categorías */}
        <Card>
          <CardHeader
            title="Categorías de Producto"
            description="Clasificación general para organización del inventario."
            action={
              canManageCatalogs && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setIsCategoryModalOpen(true)}
                >
                  + Nueva categoría
                </Button>
              )
            }
          />
          <DataTable
            columns={categoryColumns}
            rows={categories ?? []}
            getRowKey={(cat) => cat.id}
            isLoading={isCategoriesLoading}
            emptyIcon={<FolderTree className="h-5 w-5" />}
            emptyTitle="No hay categorías registradas"
            emptyDescription="Cree la primera categoría para organizar los productos del catálogo."
            emptyAction={
              canManageCatalogs ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setIsCategoryModalOpen(true)}
                >
                  + Nueva categoría
                </Button>
              ) : undefined
            }
          />
        </Card>

        {/* Unidades de Medida */}
        <Card>
          <CardHeader
            title="Unidades de Medida"
            description="Unidades de cuantificación para el stock de mercancías."
            action={
              canManageCatalogs && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setIsUnitModalOpen(true)}
                >
                  + Nueva unidad
                </Button>
              )
            }
          />
          <DataTable
            columns={unitColumns}
            rows={measurementUnits ?? []}
            getRowKey={(unit) => unit.id}
            isLoading={isUnitsLoading}
            emptyIcon={<Scale className="h-5 w-5" />}
            emptyTitle="No hay unidades registradas"
            emptyDescription="Cree unidades como Pieza, Kilogramo, Litro o Caja."
            emptyAction={
              canManageCatalogs ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setIsUnitModalOpen(true)}
                >
                  + Nueva unidad
                </Button>
              ) : undefined
            }
          />
        </Card>
      </div>

      {/* 2. Protección de datos locales y copias de seguridad */}
      <Card>
        <CardHeader
          title="Copias de seguridad y transferencia de datos"
          description="Exportación e importación de catálogo en Excel (.xlsx) y respaldos completos del sistema."
        />
        <CardBody className="space-y-5">
          {/* Panel destacado para Excel (.xlsx) */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                  <h3 className="text-xs font-semibold text-slate-900">
                    Catálogo de Inventario en Excel (.xlsx)
                  </h3>
                </div>
                <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                  Descargue o cargue la información completa de inventario (código/SKU, producto, categoría, unidad de medida, existencias, último costo, margen %, precio de venta, disponibilidad y estado). Ideal para editar en Excel o migrar su lista de productos de una PC a otra sin empezar desde cero.
                </p>
              </div>
              {can(Permission.MANAGE_BACKUPS) && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Upload className="h-3.5 w-3.5 text-slate-600" />}
                    onClick={() => setIsExcelImportModalOpen(true)}
                  >
                    Subir Excel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Download className="h-3.5 w-3.5" />}
                    disabled={isExportingExcel}
                    onClick={() => void handleExportExcel()}
                  >
                    {isExportingExcel ? 'Generando Excel…' : 'Descargar Excel'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Panel técnico para JSON */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-[#287C99]" />
                  <h3 className="text-xs font-semibold text-slate-900">
                    Respaldo integral del sistema (Archivo JSON)
                  </h3>
                </div>
                <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                  Guarda una copia exacta de todo el sistema (además de los productos, incluye todo el historial de ventas, jornadas cerradas, cuentas abiertas, cortes y auditoría). No es un archivo para abrir o editar a mano, sino una cápsula de recuperación total protegida con PIN administrativo.
                </p>
              </div>
              {can(Permission.MANAGE_BACKUPS) && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCcw className="h-3.5 w-3.5 text-slate-600" />}
                    onClick={handleOpenRestoreModal}
                  >
                    Restaurar JSON
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download className="h-3.5 w-3.5" />}
                    disabled={isExporting}
                    onClick={() => void handleExportBackup()}
                  >
                    {isExporting ? 'Exportando…' : 'Descargar JSON'}
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#123F55]">
              <HardDrive className="h-3.5 w-3.5 text-[#287C99]" />
              Motor local IndexedDB
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              Esquema v{isStatusLoading ? '—' : storageStatus?.schemaVersion ?? 1}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Último respaldo:{' '}
              <strong className="font-medium text-slate-800 tabular-nums">
                {formatDateTime(storageStatus?.lastBackupAt)}
              </strong>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Productos</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.products ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Categorías</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.categories ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Unidades de medida</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.units ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Entradas de mercancía</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.merchandiseEntries ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Movimientos almacén</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.inventoryMovements ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Cortes de inventario</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.inventoryCuts ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Registros de ventas</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.sales ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Historial de auditoría</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-[#123F55]">
                {isStatusLoading ? '—' : storageStatus?.counts.operationHistory ?? 0}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 3. Seguridad y Cambio de PIN Administrativo */}
      <Card>
        <CardHeader
          title="Seguridad y Control de Acceso Administrativo"
          description="Modificación del PIN numérico de 6 dígitos para elevación de privilegios de sesión."
        />
        <CardBody>
          <form onSubmit={handleChangeAdminPinSubmit} className="space-y-4 max-w-xl">
            {pinChangeError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {pinChangeError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  PIN Actual
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-sm shadow-xs focus:border-[#123F55] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nuevo PIN (6 dígitos)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-sm shadow-xs focus:border-[#123F55] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirmar Nuevo PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirmNewPin}
                  onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-sm shadow-xs focus:border-[#123F55] focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                size="sm"
                disabled={isChangingPin || currentPin.length !== 6 || newPin.length !== 6 || confirmNewPin.length !== 6}
              >
                {isChangingPin ? 'Actualizando PIN...' : 'Guardar Nuevo PIN'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* 4. Historial de operaciones */}
      <Card>
        <CardHeader
          title="Historial de operaciones"
          description="Registro cronológico local con fecha, hora y rol de las acciones ejecutadas."
        />
        <DataTable
          columns={historyColumns}
          rows={operationHistory ?? []}
          getRowKey={(row) => row.id}
          isLoading={isHistoryLoading}
          emptyTitle="No existen operaciones registradas"
          emptyDescription="Cada operación administrativa o de respaldo quedará registrada con su identificador único, fecha y hora exacta."
        />
      </Card>

      {/* Modal de restauración de copia de seguridad */}
      <Modal
        isOpen={isRestoreModalOpen}
        onClose={() => {
          if (!isRestoring) {
            setIsRestoreModalOpen(false);
          }
        }}
        title="Restaurar copia de seguridad"
        description="Esta operación validará la integridad del archivo y sustituirá los registros actuales de forma transaccional."
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={isRestoring}
              onClick={() => setIsRestoreModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={isRestoring || !selectedFile}
              onClick={(e) => void handleConfirmRestore(e)}
            >
              {isRestoring ? 'Restaurando…' : 'Confirmar restauración'}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void handleConfirmRestore(e)} className="space-y-4">
          <FormField
            id="backup-file-input"
            label="Archivo de copia de seguridad (.json)"
            helperText="Seleccione un archivo generado previamente desde este sistema."
            errorText={restoreError ?? undefined}
          >
            <input
              id="backup-file-input"
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setSelectedFile(file);
                setRestoreError(null);
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[#123F55] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-[#1A5F7A] cursor-pointer"
            />
          </FormField>

          <FormField
            id="restore-pin-input"
            label="Reautenticación por PIN de Administrador (6 dígitos)"
            helperText="Confirme su PIN actual para autorizar la sustitución irreversible de datos."
          >
            <input
              id="restore-pin-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={restorePin}
              onChange={(e) => {
                setRestorePin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setRestoreError(null);
              }}
              placeholder="••••••"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-mono tracking-widest text-slate-900 focus:border-[#123F55] focus:outline-none"
            />
          </FormField>
        </form>
      </Modal>

      {/* Modales de Catálogos de Almacén */}
      <CreateCategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        onCreated={() => {
          setFeedbackMessage({
            tone: 'success',
            text: 'Categoría creada exitosamente.',
          });
          void reloadCategories();
          void reloadStatus();
        }}
      />

      <CreateMeasurementUnitModal
        isOpen={isUnitModalOpen}
        onClose={() => setIsUnitModalOpen(false)}
        onCreated={() => {
          setFeedbackMessage({
            tone: 'success',
            text: 'Unidad de medida creada exitosamente.',
          });
          void reloadUnits();
          void reloadStatus();
        }}
      />

      {/* Modal de Importación de Inventario Excel */}
      <ExcelImportModal
        isOpen={isExcelImportModalOpen}
        onClose={() => setIsExcelImportModalOpen(false)}
        onImport={(file) => useCases.warehouse.excelInventory.importFromExcel(actor, file)}
        onCompleted={() => {
          setFeedbackMessage({
            tone: 'success',
            text: 'Catálogo de inventario importado exitosamente desde Excel.',
          });
          notifyDataChanged();
          void reloadStatus();
          void reloadHistory();
          void reloadCategories();
          void reloadUnits();
        }}
      />
    </div>
  );
}
