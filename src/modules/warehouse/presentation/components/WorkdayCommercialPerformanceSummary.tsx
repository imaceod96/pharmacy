import React from 'react';
import {
  DollarSign,
  Package,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency } from '../../../../shared/utils/money';
import { WorkdayCommercialPerformanceResult } from '../../domain/entities/WorkdayCommercialPerformance';
import { WorkdayDispatchedSaleItem } from '../../application/GetWorkdayDetailUseCase';

import { ExpenseDailySummary } from '../../../expenses/domain/entities/ExpenseRecord';

export interface WorkdayCommercialPerformanceSummaryProps {
  readonly performance: WorkdayCommercialPerformanceResult;
  readonly dispatchedSales?: readonly WorkdayDispatchedSaleItem[];
  readonly canViewCosts: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly expensesSummary?: ExpenseDailySummary;
  readonly adjustedNetProfit?: number;
  readonly totalTransferSalesAmount?: number;
  readonly totalCashSalesAmount?: number;
  readonly expectedCashInDrawer?: number;
}

export function WorkdayCommercialPerformanceSummary({
  performance,
  dispatchedSales = [],
  canViewCosts,
  title = 'Resultado Comercial de la Jornada',
  description = 'Ventas, costo de mercancía despachada (FIFO), Ganancia Bruta, Gastos del día y Ganancia Neta Ajustada.',
  expensesSummary,
  adjustedNetProfit,
  totalTransferSalesAmount,
  totalCashSalesAmount,
  expectedCashInDrawer,
}: WorkdayCommercialPerformanceSummaryProps) {
  const hasExpenses = expensesSummary !== undefined && expensesSummary.totalAmount > 0;
  const netProfitVal = adjustedNetProfit !== undefined ? adjustedNetProfit : (performance.grossProfit - (expensesSummary?.totalAmount ?? 0));

  const transferSum = totalTransferSalesAmount ?? dispatchedSales.reduce((acc, s) => acc + (s.transferAmount ?? 0), 0);
  const cashSum = totalCashSalesAmount ?? dispatchedSales.reduce((acc, s) => acc + (s.cashAmount ?? s.totalAmount ?? 0), 0);
  const manualExpensesVal = expensesSummary?.totalManualExpenseAmount ?? 0;
  const expectedCashVal = expectedCashInDrawer ?? Math.round((cashSum - manualExpensesVal) * 100) / 100;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
        <div>
          <h3 className="text-base font-bold text-[#123F55]">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>

        {/* Tarjetas de Métricas Agregadas */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasExpenses ? 'lg:grid-cols-6' : 'lg:grid-cols-4'} gap-4`}>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
              <span>1. Valor Comercial</span>
              <DollarSign className="h-4 w-4 text-[#123F55]" />
            </div>
            <div className="text-xl font-bold font-mono text-[#123F55]">
              {formatCurrency(performance.totalCommercialValue)}
            </div>
            <div className="text-[11px] text-slate-500">
              {performance.totalDispatchesCount} despacho(s) ({performance.distinctProductsCount} prod.)
            </div>
          </div>

          {canViewCosts ? (
            <>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>2. Costo FIFO Compra</span>
                  <ShoppingBag className="h-4 w-4 text-slate-600" />
                </div>
                <div className="text-xl font-bold font-mono text-slate-800">
                  {performance.hasUnknownCosts ? (
                    <span className="text-amber-800 text-sm font-semibold">Pendiente</span>
                  ) : (
                    formatCurrency(performance.totalCostOfGoodsDispatched)
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Lotes de adquisición
                </div>
              </div>

              <div className="rounded-lg bg-emerald-50/60 border border-emerald-200 p-4 space-y-1">
                <div className="flex items-center justify-between text-slate-700 text-xs font-semibold">
                  <span>3. Ganancia Bruta</span>
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <div
                  className={`text-xl font-bold font-mono ${
                    performance.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {performance.hasUnknownCosts ? (
                    <span className="text-amber-800 text-sm font-semibold">Pendiente</span>
                  ) : (
                    formatCurrency(performance.grossProfit)
                  )}
                </div>
                <div className="text-[11px] text-slate-600">
                  Venta − Costo FIFO
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-1">
                <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
                  <span>4. Margen Bruto</span>
                  <span className="font-mono text-xs font-bold text-[#1A5F7A]">%</span>
                </div>
                <div className="text-xl font-bold font-mono text-[#1A5F7A]">
                  {performance.hasUnknownCosts ? (
                    <span className="text-amber-800 text-sm font-semibold">Pendiente</span>
                  ) : performance.totalCommercialValue > 0 ? (
                    `${performance.grossMarginPercentage.toFixed(2)}%`
                  ) : (
                    'N/A'
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  Rentabilidad comercial
                </div>
              </div>

              {expensesSummary && (
                <>
                  <div className="rounded-lg bg-red-50/60 border border-red-200 p-4 space-y-1">
                    <div className="flex items-center justify-between text-red-800 text-xs font-semibold">
                      <span>5. (-) Gastos del Día</span>
                      <DollarSign className="h-4 w-4 text-red-600" />
                    </div>
                    <div className="text-xl font-bold font-mono text-red-700">
                      -{formatCurrency(expensesSummary.totalAmount)}
                    </div>
                    <div className="text-[11px] text-slate-600 truncate">
                      Auto: ${expensesSummary.totalProductExpenseAmount.toFixed(2)} | Man: ${expensesSummary.totalManualExpenseAmount.toFixed(2)}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#123F55]/10 border border-[#123F55]/30 p-4 space-y-1">
                    <div className="flex items-center justify-between text-[#123F55] text-xs font-bold">
                      <span>6. (=) Ganancia Neta</span>
                      <TrendingUp className="h-4 w-4 text-[#123F55]" />
                    </div>
                    <div
                      className={`text-xl font-bold font-mono ${
                        netProfitVal >= 0 ? 'text-[#123F55]' : 'text-red-700'
                      }`}
                    >
                      {formatCurrency(netProfitVal)}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Ganancia Bruta − Gastos
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 col-span-1 sm:col-span-3 flex items-center justify-center text-xs text-slate-500 italic">
              Información de costos y utilidades restringida al rol Administrador.
            </div>
          )}
        </div>

        {/* Cierre y Arqueo de Caja (Medios de Pago: Transferencia vs. Efectivo) */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <h4 className="text-xs font-bold text-[#123F55]">
            Cierre y Arqueo de Caja (Medios de Pago)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-0.5">
              <span className="text-slate-500 text-[11px] font-medium block">
                Ventas por Transferencia
              </span>
              <span className="text-base font-bold font-mono text-[#1A5F7A]">
                {formatCurrency(transferSum)}
              </span>
              <span className="text-[10px] text-slate-400 block">Ingresos bancarios/QR</span>
            </div>

            <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-0.5">
              <span className="text-slate-500 text-[11px] font-medium block">
                Ventas en Efectivo
              </span>
              <span className="text-base font-bold font-mono text-emerald-800">
                {formatCurrency(cashSum)}
              </span>
              <span className="text-[10px] text-slate-400 block">Recaudado en caja</span>
            </div>

            <div className="rounded-lg bg-white border border-slate-200 p-3 space-y-0.5">
              <span className="text-slate-500 text-[11px] font-medium block">
                (-) Gastos Manuales del Día
              </span>
              <span className="text-base font-bold font-mono text-red-700">
                -{formatCurrency(manualExpensesVal)}
              </span>
              <span className="text-[10px] text-slate-400 block">Pagados en efectivo</span>
            </div>

            <div className="rounded-lg bg-[#123F55] text-white p-3 space-y-0.5 shadow-xs">
              <span className="text-slate-200 text-[11px] font-semibold block">
                (=) Efectivo Físico Esperado en Caja
              </span>
              <span className="text-lg font-bold font-mono text-[#F49D37]">
                {formatCurrency(expectedCashVal)}
              </span>
              <span className="text-[10px] text-slate-300 block">Efectivo Ventas − Gastos Manuales</span>
            </div>
          </div>
        </div>

        {/* Desglose por Producto */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-800">
            Desglose comercial por producto ({performance.productBreakdown.length})
          </h4>
          {performance.productBreakdown.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                  <tr>
                    <th className="p-2.5">Código / SKU</th>
                    <th className="p-2.5">Producto</th>
                    <th className="p-2.5 text-right">Cant. Despachada</th>
                    <th className="p-2.5 text-right">Despachos</th>
                    <th className="p-2.5 text-right">Valor Comercial</th>
                    {canViewCosts && (
                      <>
                        <th className="p-2.5 text-right">Costo FIFO</th>
                        <th className="p-2.5 text-right">Ganancia / Utilidad Bruta</th>
                        <th className="p-2.5 text-right">Margen</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {performance.productBreakdown.map((prod) => (
                    <tr key={prod.productId} className="hover:bg-slate-50">
                      <td className="p-2.5 font-mono text-[11px] text-slate-600">
                        {prod.productCode}
                      </td>
                      <td className="p-2.5 font-medium text-slate-900">
                        {prod.productName}
                      </td>
                      <td className="p-2.5 text-right font-mono text-slate-700">
                        {prod.dispatchedQuantity.toFixed(2)} {prod.unitSymbol}
                      </td>
                      <td className="p-2.5 text-right font-mono text-slate-600">
                        {prod.dispatchesCount}
                      </td>
                      <td className="p-2.5 text-right font-mono font-semibold text-[#123F55]">
                        {formatCurrency(prod.commercialValue)}
                      </td>
                      {canViewCosts && (
                        <>
                          <td className="p-2.5 text-right font-mono text-slate-600">
                            {prod.hasUnknownCost ? (
                              <span className="text-amber-800 text-[11px] italic">No disponible</span>
                            ) : (
                              formatCurrency(prod.costAmount)
                            )}
                          </td>
                          <td
                            className={`p-2.5 text-right font-mono font-semibold ${
                              prod.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {prod.hasUnknownCost ? (
                              <span className="text-amber-800 text-[11px] italic">No disponible</span>
                            ) : (
                              formatCurrency(prod.grossProfit)
                            )}
                          </td>
                          <td className="p-2.5 text-right font-mono text-slate-700">
                            {prod.hasUnknownCost ? 'N/A' : `${prod.marginPercentage.toFixed(2)}%`}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-slate-500 italic bg-slate-50 rounded-lg border border-slate-200">
              No se han registrado despachos en esta jornada.
            </div>
          )}
        </div>

        {/* Desglose por Despacho */}
        {dispatchedSales.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold text-slate-800">
              Desglose de operaciones de despacho ({dispatchedSales.length})
            </h4>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                  <tr>
                    <th className="p-2.5">Folio / Cuenta</th>
                    <th className="p-2.5">Fecha y Hora</th>
                    <th className="p-2.5">Partidas Despachadas</th>
                    <th className="p-2.5 text-right">Total Despachado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {dispatchedSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="p-2.5">
                        <span className="font-semibold text-[#123F55]">{s.displayLabel}</span>
                        <span className="block text-[10px] text-slate-500">
                          {s.originType === 'DIRECT_DISPATCH' ? 'Despacho directo' : 'Cuenta abierta'}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-600">
                        {s.dispatchedAt ? s.dispatchedAt.replace('T', ' ').substring(0, 16) : '—'}
                      </td>
                      <td className="p-2.5">
                        <div className="space-y-0.5">
                          {s.items.map((item) => (
                            <div key={item.productId} className="text-[11px]">
                              <span className="text-slate-800 font-medium">{item.productName}</span>{' '}
                              <span className="font-mono text-slate-500">
                                ({item.quantity} {item.unitSymbol}) @ {formatCurrency(item.unitSalePrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold text-[#123F55]">
                        {formatCurrency(s.totalAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
