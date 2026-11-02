import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Button } from '../../../../shared/components/Button';
import { Modal } from '../../../../shared/components/Modal';
import { ExcelImportSummary } from '../../application/ExcelInventoryService';

interface ExcelImportModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onImport: (file: File) => Promise<ExcelImportSummary>;
  readonly onCompleted?: () => void;
}

export function ExcelImportModal({
  isOpen,
  onClose,
  onImport,
  onCompleted,
}: ExcelImportModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<ExcelImportSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setSelectedFile(null);
    setIsProcessing(false);
    setImportSummary(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    resetState();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setImportSummary(null);
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setErrorMessage('Por favor seleccione un archivo Excel válido (.xlsx o .xls).');
        setSelectedFile(null);
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isProcessing) return;
    setErrorMessage(null);
    setImportSummary(null);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        setErrorMessage('Por favor arrastre un archivo Excel válido (.xlsx o .xls).');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleExecuteImport = async () => {
    if (!selectedFile) {
      setErrorMessage('Seleccione un archivo de Excel para comenzar la importación.');
      return;
    }

    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const summary = await onImport(selectedFile);
      setImportSummary(summary);
      if (onCompleted) {
        onCompleted();
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error inesperado al procesar el archivo Excel.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Importar Inventario desde Excel"
      maxWidthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Descripción general */}
        <p className="text-xs text-slate-600 leading-relaxed">
          Cargue un archivo de Excel (<code className="font-mono text-slate-800">.xlsx</code> o{' '}
          <code className="font-mono text-slate-800">.xls</code>) con el catálogo de productos.
          El sistema resolverá categorías, unidades de medida, existencias y creará las capas de costo
          FIFO de forma atómica para que pueda reanudar operaciones en esta o cualquier otra PC.
        </p>

        {/* Zona de selección o arrastre de archivo */}
        {!importSummary && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              selectedFile
                ? 'border-emerald-400 bg-emerald-50/50'
                : 'border-slate-300 hover:border-[#287C99] bg-slate-50/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center gap-2">
              <div
                className={`p-3 rounded-lg ${
                  selectedFile
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                <FileSpreadsheet className="h-7 w-7" />
              </div>

              {selectedFile ? (
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedFile.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {(selectedFile.size / 1024).toFixed(1)} KB · Clic para seleccionar otro archivo
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-slate-700">
                    Haga clic para buscar el archivo Excel o arrástrelo aquí
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Formatos admitidos: Microsoft Excel (.xlsx, .xls)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-medium">No fue posible completar la importación</p>
              <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Resumen de importación exitosa */}
        {importSummary && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm text-emerald-900">
                  ¡Inventario procesado e importado con éxito!
                </p>
                <p className="text-emerald-800 leading-relaxed">
                  Las existencias, costos y reglas comerciales han quedado sincronizadas en el almacenamiento local.
                </p>
              </div>
            </div>

            {/* Métricas estructuradas */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[11px] text-slate-500 font-medium">Filas leídas</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900">
                  {importSummary.totalRows}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="text-[11px] text-emerald-700 font-medium">Productos nuevos</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-700">
                  {importSummary.createdCount}
                </p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
                <p className="text-[11px] text-sky-800 font-medium">Productos actualizados</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-sky-800">
                  {importSummary.updatedCount}
                </p>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-[11px] text-amber-800 font-medium">Catálogos creados</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-800">
                  {importSummary.categoriesCreated + importSummary.unitsCreated}
                </p>
                <p className="text-[10px] text-amber-700 mt-0.5">
                  ({importSummary.categoriesCreated} cat. / {importSummary.unitsCreated} unid.)
                </p>
              </div>
            </div>

            {/* Advertencias de filas si las hubiera */}
            {importSummary.errors.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold text-amber-800 mb-1">
                  Observaciones ({importSummary.errors.length}):
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {importSummary.errors.slice(0, 5).map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                  {importSummary.errors.length > 5 && (
                    <li className="font-medium">
                      … y {importSummary.errors.length - 5} observaciones adicionales.
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            disabled={isProcessing}
          >
            {importSummary ? 'Cerrar' : 'Cancelar'}
          </Button>

          {!importSummary && (
            <Button
              variant="primary"
              size="sm"
              icon={
                isProcessing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )
              }
              disabled={!selectedFile || isProcessing}
              onClick={() => void handleExecuteImport()}
            >
              {isProcessing ? 'Procesando archivo…' : 'Comenzar importación'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
