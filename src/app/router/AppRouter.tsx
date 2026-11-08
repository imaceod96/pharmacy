import { HomePage } from '../../modules/core/presentation/pages/HomePage';
import { SettingsPage } from '../../modules/core/presentation/pages/SettingsPage';
import { ExpensesPage } from '../../modules/expenses/presentation/pages/ExpensesPage';
import { OpenSalesPage } from '../../modules/sales/presentation/pages/OpenSalesPage';
import { SalesHistoryPage } from '../../modules/sales/presentation/pages/SalesHistoryPage';
import { InventoryCutsPage } from '../../modules/warehouse/presentation/pages/InventoryCutsPage';
import { ProductHistoryPage } from '../../modules/warehouse/presentation/pages/ProductHistoryPage';
import { ProductsPage } from '../../modules/warehouse/presentation/pages/ProductsPage';
import { WorkdayDetailPage } from '../../modules/warehouse/presentation/pages/WorkdayDetailPage';
import { MainLayout } from '../layouts/MainLayout';
import { useRouter } from './RouterProvider';
import { AppRouteKey } from './routes';

export function AppRouter() {
  const { route } = useRouter();

  const renderActivePage = () => {
    switch (route.key) {
      case AppRouteKey.HOME:
        return <HomePage />;
      case AppRouteKey.OPEN_SALES:
        return <OpenSalesPage />;
      case AppRouteKey.OPEN_SALE_DETAIL:
        return <OpenSalesPage selectedSaleId={route.saleId} />;
      case AppRouteKey.SALES_HISTORY:
        return <SalesHistoryPage />;
      case AppRouteKey.EXPENSES:
        return <ExpensesPage />;
      case AppRouteKey.WAREHOUSE_PRODUCTS:
        return <ProductsPage />;
      case AppRouteKey.WAREHOUSE_PRODUCT_HISTORY:
        return <ProductHistoryPage productId={route.productId} />;
      case AppRouteKey.WAREHOUSE_INVENTORY_CUTS:
        return <InventoryCutsPage />;
      case AppRouteKey.WAREHOUSE_WORKDAY_DETAIL:
        return <WorkdayDetailPage workdayId={route.workdayId} />;
      case AppRouteKey.SETTINGS:
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  };

  return <MainLayout>{renderActivePage()}</MainLayout>;
}
