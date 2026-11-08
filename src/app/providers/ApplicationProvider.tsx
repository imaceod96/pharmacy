import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ExportBackupUseCase } from '../../modules/core/application/ExportBackupUseCase';
import { GetOperationHistoryUseCase } from '../../modules/core/application/GetOperationHistoryUseCase';
import { GetSystemStatusUseCase } from '../../modules/core/application/GetSystemStatusUseCase';
import { RestoreBackupUseCase } from '../../modules/core/application/RestoreBackupUseCase';
import { VerifyAdminPinUseCase } from '../../modules/core/application/VerifyAdminPinUseCase';
import { SetupInitialAdminPinUseCase } from '../../modules/core/application/SetupInitialAdminPinUseCase';
import { ChangeAdminPinUseCase } from '../../modules/core/application/ChangeAdminPinUseCase';
import { CheckAdminPinStatusUseCase } from '../../modules/core/application/CheckAdminPinStatusUseCase';
import { BrowserBackupFileAdapter } from '../../modules/core/infrastructure/BrowserBackupFileAdapter';
import { IndexedDbOperationLogRepository } from '../../modules/core/infrastructure/IndexedDbOperationLogRepository';
import { IndexedDbSystemBackupRepository } from '../../modules/core/infrastructure/IndexedDbSystemBackupRepository';
import { CancelOpenSaleAccountUseCase } from '../../modules/sales/application/CancelOpenSaleAccountUseCase';
import { CreateOpenSaleAccountUseCase } from '../../modules/sales/application/CreateOpenSaleAccountUseCase';
import { DispatchSaleUseCase } from '../../modules/sales/application/DispatchSaleUseCase';
import { GetOpenSaleDetailUseCase } from '../../modules/sales/application/GetOpenSaleDetailUseCase';
import { GetOpenSalesUseCase } from '../../modules/sales/application/GetOpenSalesUseCase';
import { GetSalesDashboardSummaryUseCase } from '../../modules/sales/application/GetSalesDashboardSummaryUseCase';
import { GetSalesHistoryUseCase } from '../../modules/sales/application/GetSalesHistoryUseCase';
import { UpdateOpenSaleAccountUseCase } from '../../modules/sales/application/UpdateOpenSaleAccountUseCase';
import { IndexedDbSaleRepository } from '../../modules/sales/infrastructure/IndexedDbSaleRepository';
import { ActivateProductUseCase } from '../../modules/warehouse/application/ActivateProductUseCase';
import { ApprovePartialCutUseCase } from '../../modules/warehouse/application/ApprovePartialCutUseCase';
import { CancelPartialCutUseCase } from '../../modules/warehouse/application/CancelPartialCutUseCase';
import { CorrectProductStockUseCase } from '../../modules/warehouse/application/CorrectProductStockUseCase';
import { CreateCategoryUseCase } from '../../modules/warehouse/application/CreateCategoryUseCase';
import { CreateMeasurementUnitUseCase } from '../../modules/warehouse/application/CreateMeasurementUnitUseCase';
import { CreatePartialCutUseCase } from '../../modules/warehouse/application/CreatePartialCutUseCase';
import { DeactivateProductUseCase } from '../../modules/warehouse/application/DeactivateProductUseCase';
import { GetActiveWorkdayUseCase } from '../../modules/warehouse/application/GetActiveWorkdayUseCase';
import { GetOutOfStockProductsUseCase } from '../../modules/warehouse/application/GetOutOfStockProductsUseCase';
import { GetPartialCutDetailUseCase } from '../../modules/warehouse/application/GetPartialCutDetailUseCase';
import { GetProductHistoryUseCase } from '../../modules/warehouse/application/GetProductHistoryUseCase';
import { GetWorkdayDetailUseCase } from '../../modules/warehouse/application/GetWorkdayDetailUseCase';
import { ListCategoriesUseCase } from '../../modules/warehouse/application/ListCategoriesUseCase';
import { ListInventoryCutsUseCase } from '../../modules/warehouse/application/ListInventoryCutsUseCase';
import { ListMeasurementUnitsUseCase } from '../../modules/warehouse/application/ListMeasurementUnitsUseCase';
import { ListProductsUseCase } from '../../modules/warehouse/application/ListProductsUseCase';
import { ListWorkdayPartialCutsUseCase } from '../../modules/warehouse/application/ListWorkdayPartialCutsUseCase';
import { ListWorkdaysUseCase } from '../../modules/warehouse/application/ListWorkdaysUseCase';
import { OpenWorkdayUseCase } from '../../modules/warehouse/application/OpenWorkdayUseCase';
import { PrepareFinalInventorySelectionUseCase } from '../../modules/warehouse/application/PrepareFinalInventorySelectionUseCase';
import { ProceedToPartialCutReviewUseCase } from '../../modules/warehouse/application/ProceedToPartialCutReviewUseCase';
import { RecordPartialCutCountUseCase } from '../../modules/warehouse/application/RecordPartialCutCountUseCase';
import { RegisterMerchandiseEntryUseCase } from '../../modules/warehouse/application/RegisterMerchandiseEntryUseCase';
import { RegisterProductWithInitialEntryUseCase } from '../../modules/warehouse/application/RegisterProductWithInitialEntryUseCase';
import { StartWorkdayClosingUseCase } from '../../modules/warehouse/application/StartWorkdayClosingUseCase';
import { SuspendWorkdayClosingUseCase } from '../../modules/warehouse/application/SuspendWorkdayClosingUseCase';
import { ResumeWorkdayClosingUseCase } from '../../modules/warehouse/application/ResumeWorkdayClosingUseCase';
import { ApproveWorkdayClosingUseCase } from '../../modules/warehouse/application/ApproveWorkdayClosingUseCase';
import { RectifyWorkdayClosingUseCase } from '../../modules/warehouse/application/RectifyWorkdayClosingUseCase';
import { MorningStockVerificationUseCase } from '../../modules/warehouse/application/MorningStockVerificationUseCase';
import { ExcelInventoryService } from '../../modules/warehouse/application/ExcelInventoryService';
import { UpdateProductSalePriceUseCase } from '../../modules/warehouse/application/UpdateProductSalePriceUseCase';
import { CreateExpenseUseCase } from '../../modules/expenses/application/CreateExpenseUseCase';
import { ListExpensesUseCase } from '../../modules/expenses/application/ListExpensesUseCase';
import { DeleteExpenseUseCase } from '../../modules/expenses/application/DeleteExpenseUseCase';
import { IndexedDbCategoryRepository } from '../../modules/warehouse/infrastructure/IndexedDbCategoryRepository';
import { IndexedDbCommercialActivityAdapter } from '../../modules/warehouse/infrastructure/IndexedDbCommercialActivityAdapter';
import { IndexedDbInventoryCutRepository } from '../../modules/warehouse/infrastructure/IndexedDbInventoryCutRepository';
import { IndexedDbInventoryMovementRepository } from '../../modules/warehouse/infrastructure/IndexedDbInventoryMovementRepository';
import { IndexedDbMeasurementUnitRepository } from '../../modules/warehouse/infrastructure/IndexedDbMeasurementUnitRepository';
import { IndexedDbMerchandiseEntryRepository } from '../../modules/warehouse/infrastructure/IndexedDbMerchandiseEntryRepository';
import { IndexedDbPriceChangeRepository } from '../../modules/warehouse/infrastructure/IndexedDbPriceChangeRepository';
import { IndexedDbProductRepository } from '../../modules/warehouse/infrastructure/IndexedDbProductRepository';
import { IndexedDbProductStatusChangeRepository } from '../../modules/warehouse/infrastructure/IndexedDbProductStatusChangeRepository';
import { IndexedDbWorkdayRepository } from '../../modules/warehouse/infrastructure/IndexedDbWorkdayRepository';
import { IndexedDbEngine } from '../../shared/lib/indexeddb/IndexedDbEngine';

export interface ApplicationUseCases {
  readonly core: {
    readonly getSystemStatus: GetSystemStatusUseCase;
    readonly getOperationHistory: GetOperationHistoryUseCase;
    readonly exportBackup: ExportBackupUseCase;
    readonly restoreBackup: RestoreBackupUseCase;
    readonly verifyAdminPin: VerifyAdminPinUseCase;
    readonly setupInitialAdminPin: SetupInitialAdminPinUseCase;
    readonly changeAdminPin: ChangeAdminPinUseCase;
    readonly checkAdminPinStatus: CheckAdminPinStatusUseCase;
  };
  readonly expenses: {
    readonly createExpense: CreateExpenseUseCase;
    readonly listExpenses: ListExpensesUseCase;
    readonly deleteExpense: DeleteExpenseUseCase;
  };
  readonly warehouse: {
    readonly createCategory: CreateCategoryUseCase;
    readonly createMeasurementUnit: CreateMeasurementUnitUseCase;
    readonly registerProductWithInitialEntry: RegisterProductWithInitialEntryUseCase;
    readonly registerMerchandiseEntry: RegisterMerchandiseEntryUseCase;
    readonly activateProduct: ActivateProductUseCase;
    readonly deactivateProduct: DeactivateProductUseCase;
    readonly updateProductSalePrice: UpdateProductSalePriceUseCase;
    readonly correctProductStock: CorrectProductStockUseCase;
    readonly getProductHistory: GetProductHistoryUseCase;
    readonly listProducts: ListProductsUseCase;
    readonly listCategories: ListCategoriesUseCase;
    readonly listMeasurementUnits: ListMeasurementUnitsUseCase;
    readonly listInventoryCuts: ListInventoryCutsUseCase;
    readonly openWorkday: OpenWorkdayUseCase;
    readonly getActiveWorkday: GetActiveWorkdayUseCase;
    readonly listWorkdays: ListWorkdaysUseCase;
    readonly getWorkdayDetail: GetWorkdayDetailUseCase;
    readonly getOutOfStockProducts: GetOutOfStockProductsUseCase;
    readonly createPartialCut: CreatePartialCutUseCase;
    readonly recordPartialCutCount: RecordPartialCutCountUseCase;
    readonly proceedToPartialCutReview: ProceedToPartialCutReviewUseCase;
    readonly approvePartialCut: ApprovePartialCutUseCase;
    readonly cancelPartialCut: CancelPartialCutUseCase;
    readonly getPartialCutDetail: GetPartialCutDetailUseCase;
    readonly listWorkdayPartialCuts: ListWorkdayPartialCutsUseCase;
    readonly createPartialCutUseCase: CreatePartialCutUseCase;
    readonly recordPartialCutCountUseCase: RecordPartialCutCountUseCase;
    readonly proceedToPartialCutReviewUseCase: ProceedToPartialCutReviewUseCase;
    readonly approvePartialCutUseCase: ApprovePartialCutUseCase;
    readonly cancelPartialCutUseCase: CancelPartialCutUseCase;
    readonly getPartialCutDetailUseCase: GetPartialCutDetailUseCase;
    readonly listWorkdayPartialCutsUseCase: ListWorkdayPartialCutsUseCase;
    readonly prepareFinalInventorySelection: PrepareFinalInventorySelectionUseCase;
    readonly startWorkdayClosing: StartWorkdayClosingUseCase;
    readonly suspendWorkdayClosing: SuspendWorkdayClosingUseCase;
    readonly resumeWorkdayClosing: ResumeWorkdayClosingUseCase;
    readonly approveWorkdayClosing: ApproveWorkdayClosingUseCase;
    readonly rectifyWorkdayClosing: RectifyWorkdayClosingUseCase;
    readonly morningStockVerification: MorningStockVerificationUseCase;
    readonly excelInventory: ExcelInventoryService;
  };
  readonly sales: {
    readonly getOpenSales: GetOpenSalesUseCase;
    readonly getOpenSaleDetail: GetOpenSaleDetailUseCase;
    readonly getDashboardSummary: GetSalesDashboardSummaryUseCase;
    readonly getSalesHistory: GetSalesHistoryUseCase;
    readonly createOpenSaleAccount: CreateOpenSaleAccountUseCase;
    readonly updateOpenSaleAccount: UpdateOpenSaleAccountUseCase;
    readonly dispatchSale: DispatchSaleUseCase;
    readonly cancelOpenSaleAccount: CancelOpenSaleAccountUseCase;
  };
}

import { PrinterPort } from '../../modules/core/domain/ports/PrinterPort';
import { BrowserPrinterAdapter } from '../../modules/core/infrastructure/BrowserPrinterAdapter';

export interface ApplicationContextValue {
  readonly useCases: ApplicationUseCases;
  readonly printerPort: PrinterPort;
  readonly dataRevision: number;
  readonly notifyDataChanged: () => void;
}

const ApplicationContext = createContext<ApplicationContextValue | null>(null);

export function ApplicationProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [dataRevision, setDataRevision] = useState<number>(0);

  const container = useMemo(() => {
    const engine = new IndexedDbEngine();

    const operationLogRepo = new IndexedDbOperationLogRepository(engine);
    const systemBackupRepo = new IndexedDbSystemBackupRepository(engine);
    const backupFileAdapter = new BrowserBackupFileAdapter();

    const productRepo = new IndexedDbProductRepository(engine);
    const categoryRepo = new IndexedDbCategoryRepository(engine);
    const unitRepo = new IndexedDbMeasurementUnitRepository(engine);
    const merchandiseEntryRepo = new IndexedDbMerchandiseEntryRepository(engine);
    const inventoryMovementRepo = new IndexedDbInventoryMovementRepository(engine);
    const priceChangeRepo = new IndexedDbPriceChangeRepository(engine);
    const productStatusChangeRepo = new IndexedDbProductStatusChangeRepository(engine);
    const inventoryCutRepo = new IndexedDbInventoryCutRepository(engine);
    const workdayRepo = new IndexedDbWorkdayRepository(engine);
    const commercialActivityAdapter = new IndexedDbCommercialActivityAdapter(engine);
    const saleRepo = new IndexedDbSaleRepository(engine);

    const createPartialCut = new CreatePartialCutUseCase(engine, commercialActivityAdapter);
    const recordPartialCutCount = new RecordPartialCutCountUseCase(engine);
    const proceedToPartialCutReview = new ProceedToPartialCutReviewUseCase(engine);
    const approvePartialCut = new ApprovePartialCutUseCase(engine);
    const cancelPartialCut = new CancelPartialCutUseCase(engine);
    const getPartialCutDetail = new GetPartialCutDetailUseCase(engine);
    const listWorkdayPartialCuts = new ListWorkdayPartialCutsUseCase(
      workdayRepo,
      inventoryCutRepo,
      saleRepo
    );
    const prepareFinalInventorySelection = new PrepareFinalInventorySelectionUseCase(
      engine,
      commercialActivityAdapter
    );

    const useCases: ApplicationUseCases = {
      core: {
        getSystemStatus: new GetSystemStatusUseCase(systemBackupRepo),
        getOperationHistory: new GetOperationHistoryUseCase(operationLogRepo),
        exportBackup: new ExportBackupUseCase(systemBackupRepo, backupFileAdapter),
        restoreBackup: new RestoreBackupUseCase(systemBackupRepo, backupFileAdapter),
        verifyAdminPin: new VerifyAdminPinUseCase(engine),
        setupInitialAdminPin: new SetupInitialAdminPinUseCase(engine),
        changeAdminPin: new ChangeAdminPinUseCase(engine),
        checkAdminPinStatus: new CheckAdminPinStatusUseCase(engine),
      },
      warehouse: {
        createCategory: new CreateCategoryUseCase(categoryRepo, operationLogRepo),
        createMeasurementUnit: new CreateMeasurementUnitUseCase(unitRepo, operationLogRepo),
        registerProductWithInitialEntry: new RegisterProductWithInitialEntryUseCase(engine),
        registerMerchandiseEntry: new RegisterMerchandiseEntryUseCase(engine),
        activateProduct: new ActivateProductUseCase(engine),
        deactivateProduct: new DeactivateProductUseCase(engine),
        updateProductSalePrice: new UpdateProductSalePriceUseCase(engine),
        correctProductStock: new CorrectProductStockUseCase(engine),
        getProductHistory: new GetProductHistoryUseCase(
          productRepo,
          categoryRepo,
          unitRepo,
          merchandiseEntryRepo,
          inventoryMovementRepo,
          priceChangeRepo,
          productStatusChangeRepo
        ),
        listProducts: new ListProductsUseCase(productRepo, categoryRepo, unitRepo),
        listCategories: new ListCategoriesUseCase(categoryRepo),
        listMeasurementUnits: new ListMeasurementUnitsUseCase(unitRepo),
        listInventoryCuts: new ListInventoryCutsUseCase(inventoryCutRepo),
        openWorkday: new OpenWorkdayUseCase(engine),
        getActiveWorkday: new GetActiveWorkdayUseCase(workdayRepo),
        listWorkdays: new ListWorkdaysUseCase(workdayRepo),
        getWorkdayDetail: new GetWorkdayDetailUseCase(engine),
        getOutOfStockProducts: new GetOutOfStockProductsUseCase(productRepo, categoryRepo),
        createPartialCut,
        recordPartialCutCount,
        proceedToPartialCutReview,
        approvePartialCut,
        cancelPartialCut,
        getPartialCutDetail,
        listWorkdayPartialCuts,
        createPartialCutUseCase: createPartialCut,
        recordPartialCutCountUseCase: recordPartialCutCount,
        proceedToPartialCutReviewUseCase: proceedToPartialCutReview,
        approvePartialCutUseCase: approvePartialCut,
        cancelPartialCutUseCase: cancelPartialCut,
        getPartialCutDetailUseCase: getPartialCutDetail,
        listWorkdayPartialCutsUseCase: listWorkdayPartialCuts,
        prepareFinalInventorySelection,
        startWorkdayClosing: new StartWorkdayClosingUseCase(
          engine,
          prepareFinalInventorySelection
        ),
        suspendWorkdayClosing: new SuspendWorkdayClosingUseCase(engine),
        resumeWorkdayClosing: new ResumeWorkdayClosingUseCase(engine),
        approveWorkdayClosing: new ApproveWorkdayClosingUseCase(engine),
        rectifyWorkdayClosing: new RectifyWorkdayClosingUseCase(engine),
        morningStockVerification: new MorningStockVerificationUseCase(engine),
        excelInventory: new ExcelInventoryService(engine),
      },
      sales: {
        getOpenSales: new GetOpenSalesUseCase(saleRepo),
        getOpenSaleDetail: new GetOpenSaleDetailUseCase(saleRepo, engine),
        getDashboardSummary: new GetSalesDashboardSummaryUseCase(saleRepo, productRepo),
        getSalesHistory: new GetSalesHistoryUseCase(saleRepo),
        createOpenSaleAccount: new CreateOpenSaleAccountUseCase(engine),
        updateOpenSaleAccount: new UpdateOpenSaleAccountUseCase(engine),
        dispatchSale: new DispatchSaleUseCase(engine),
        cancelOpenSaleAccount: new CancelOpenSaleAccountUseCase(engine),
      },
      expenses: {
        createExpense: new CreateExpenseUseCase(engine),
        listExpenses: new ListExpensesUseCase(engine),
        deleteExpense: new DeleteExpenseUseCase(engine),
      },
    };

    const printerPort = new BrowserPrinterAdapter();

    return { engine, useCases, printerPort };
  }, []);

  useEffect(() => {
    let active = true;

    container.engine
      .initialize()
      .then(() => {
        if (active) {
          setIsReady(true);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setInitError(
            err instanceof Error
              ? err.message
              : 'Error crítico al inicializar la base de datos local.'
          );
        }
      });

    return () => {
      active = false;
    };
  }, [container.engine]);

  const notifyDataChanged = useCallback(() => {
    setDataRevision((prev) => prev + 1);
  }, []);

  const contextValue = useMemo<ApplicationContextValue>(
    () => ({
      useCases: container.useCases,
      printerPort: container.printerPort,
      dataRevision,
      notifyDataChanged,
    }),
    [container.useCases, container.printerPort, dataRevision, notifyDataChanged]
  );

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-base font-semibold text-[#123F55]">
            Almacenamiento local no disponible
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">{initError}</p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-6">
        <div className="text-xs font-medium text-slate-500">
          Preparando almacenamiento local…
        </div>
      </div>
    );
  }

  return (
    <ApplicationContext.Provider value={contextValue}>
      {children}
    </ApplicationContext.Provider>
  );
}

export function useApplication(): ApplicationContextValue {
  const ctx = useContext(ApplicationContext);
  if (!ctx) {
    throw new Error('useApplication debe utilizarse dentro de ApplicationProvider.');
  }
  return ctx;
}
