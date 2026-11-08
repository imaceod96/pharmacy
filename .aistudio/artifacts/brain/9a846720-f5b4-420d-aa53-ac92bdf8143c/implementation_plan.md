# Desglose de Forma de Pago (Efectivo / Transferencia) y Cuadre de Caja en Cierre de Jornada

Mejora en el flujo de confirmación de despacho para registrar pagos en transferencia bancaria y calcular automáticamente el pago en efectivo, junto con la proyección detallada de fondos en el reporte de Cierre de Jornada (Efectivo Físico Esperado en Caja y Transferencias).

## User Review & Critical Decisions

> [!IMPORTANT]
> A continuación se resumen las reglas operativas confirmadas para el cobro por transferencia y el cuadre de caja:

- **Decisión Confirmada 1 (Validación de Transferencia)**: En la ventana modal de confirmación de despacho, si el usuario ingresa un monto pagado por transferencia bancaria, el sistema valida que **no supere el importe total** de la cuenta. El valor restante a pagar en efectivo se calcula automáticamente en tiempo real (`Efectivo = Total - Transferencia`). Si no se ingresa ningún monto, el sistema asume por defecto el 100% en efectivo sin requerir teclear cero.
- **Decisión Confirmada 2 (Cuadre de Efectivo en Cierre de Caja)**: En el reporte de cierre de jornada se desglosa el dinero según su fondo de cobro:
  - **Ganancia Bruta de Ventas** y **Ganancia Neta Ajustada** (descontando los gastos del día).
  - **Total Recaudado por Transferencias** (acreditaciones bancarias/electrónicas).
  - **Efectivo Físico Esperado en Caja**: Calculado exactamente como $\text{Efectivo Recaudado en Ventas} - \text{Gastos Manuales del Día}$.

---

## 1. Overview & Core Concept

- **Qué hace**: Añade el campo de **Transferencia ($)** y desglose automático de **Efectivo ($)** en el flujo modal de despacho de ventas (`DispatchSaleModal.tsx` / `DispatchSaleUseCase.ts`). Almacena los campos `transferAmount` y `cashAmount` en la venta y presenta en el Cierre de Caja del expediente de jornada (`WorkdayCommercialPerformanceSummary.tsx`) el desglose entre dinero electrónico y efectivo neto existente en caja.
- **Público objetivo**: Cajeros y administradores que procesan cobranzas mixtas o transferencias y necesitan conciliar el efectivo físico del cajón al cierre de la jornada.
- **Valor principal**: Elimina la confusión entre ingresos bancarios y efectivo en mano, facilitando el arqueo de caja exacto sin errores humanos de cálculo.

---

## 2. User Experience & Visual Design

### Ventana Modal de Confirmación de Despacho (`DispatchSaleModal.tsx`)
- **Resumen de Cuenta**: Muestra el número/folio de la cuenta y el **Importe Total a Despachar ($)** en tipografía destacada.
- **Campo de Pago por Transferencia ($)**:
  - Input numérico con marcador de moneda.
  - Valor por defecto: vació / $0.00.
  - Si se escribe por ejemplo `$50.00` en una cuenta de `$120.00`, la vista calcula y muestra en vivo:
    - **Venta por Transferencia**: `$50.00`
    - **Venta en Efectivo**: `$70.00`
- **Mensaje de Validación**: Si el monto ingresado supera el total, deshabilita el botón de confirmación y muestra una alerta clara: `"El monto por transferencia no puede exceder el total a cobrar ($120.00)"`.
- **Botones de Acción**: `"Confirmar Despacho"` y `"Confirmar e Imprimir Comprobante"`.

### Cierre de Jornada y Expediente Comercial (`WorkdayCommercialPerformanceSummary.tsx`)
- En el bloque de tarjetas de resumen de la jornada activa o historial se agregarán dos nuevos indicadores clave:
  - **Ventas en Transferencia Bancaria**: Suma de pagos recibidos vía transferencia.
  - **Efectivo Físico Esperado en Caja**: Destacado con marco diferenciado y cálculo en tipografía monospace:
    $$\text{Efectivo en Caja} = \text{Efectivo en Ventas} - \text{Gastos Manuales en Efectivo}$$

---

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Precedencia y Valores por Defecto en Ventas Previas**
  - *Enfoque*: Todas las ventas registradas con anterioridad que no dispongan del campo `transferAmount` se interpretan automáticamente como 100% cobradas en efectivo.
  - *Por qué*: Evita errores de compatibilidad y preserva la integridad del historial pasado.

- **Decisión 2: Gastos Manuales reducen el Efectivo en Caja**
  - *Enfoque*: Los gastos de mercancía (autoconsumo) reducen el inventario físico, mientras que los gastos manuales (alquiler, salarios, compras en efectivo) reducen directamente la cantidad de billetes/monedas esperados en la caja.
  - *Por qué*: Garantiza que el arqueo de caja físico coincida al centavo con el dinero existente al final del turno.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FLUKO DE DESPACHO                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  OpenSalesPage.tsx / DispatchSaleModal.tsx (Ingreso de transferAmount)      │
│                        │                                                    │
│                        ▼                                                    │
│  DispatchSaleUseCase.ts ──> Valida (0 <= transfer <= total)                 │
│                        │    Calcula cashAmount = total - transfer           │
│                        ▼                                                    │
│  SALES_RECORDS (IndexedDB: guarda transferAmount y cashAmount)              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REPORTES Y EXPEDIENTE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  GetWorkdayDetailUseCase.ts / GetSalesDashboardSummaryUseCase.ts             │
│                        │                                                    │
│                        ▼                                                    │
│  WorkdayCommercialPerformanceSummary.tsx                                    │
│  - Total Transferencias: sum(transferAmount)                                │
│  - Efectivo Físico en Caja: sum(cashAmount) - sum(manualExpenses)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Campos adicionales en `SaleRecord.ts`
```typescript
export interface SaleRecord extends BaseEntity {
  // ... campos existentes ...
  readonly transferAmount?: number; // Pago en transferencia
  readonly cashAmount?: number;     // Pago en efectivo
}
```

### Payload de Despacho en `DispatchSaleUseCase.ts`
```typescript
export interface DispatchSaleInput {
  readonly saleId: string;
  readonly transferAmount?: number;
}
```

---

## Verification Plan

1. **Pruebas de compilación y linter**: Ejecutar `lint_applet` y `compile_applet` co-ejecutados para confirmar 0 errores de TypeScript.
2. **Pruebas unitarias automatizadas**:
   - Ejecutar la suite completa (`npx tsx tests/runAllTests.ts`).
   - Agregar pruebas unitarias en `sales.test.ts` que validen:
     1. Despacho con monto de transferencia parcial y cálculo del efectivo restante.
     2. Rechazo de despacho cuando `transferAmount > totalAmount`.
     3. Cuadre del reporte de expediente calculando el efectivo neto en caja descontando los gastos manuales del día.
