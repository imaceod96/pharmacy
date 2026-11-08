import { BaseEntity, EntityId, ISODateString } from '../../../../shared/types/entity';
import { ValidationError } from '../../../../shared/types/errors';

/**
 * Estados permitidos para una cuenta / operación del módulo de Ventas (Bloque 1).
 * REGLA PRINCIPAL: El módulo de Ventas no realiza cobros; registra cuentas abiertas,
 * preparación de partidas y despacho físico de mercancía.
 */
export enum SaleStatus {
  OPEN = 'OPEN',
  DISPATCHED = 'DISPATCHED',
  CANCELLED = 'CANCELLED',
}

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  [SaleStatus.OPEN]: 'Cuenta abierta',
  [SaleStatus.DISPATCHED]: 'Despachada',
  [SaleStatus.CANCELLED]: 'Cancelada',
};

export type SaleOriginType = 'OPEN_ACCOUNT' | 'DIRECT_DISPATCH';

/**
 * Partida individual dentro de una cuenta abierta o venta despachada.
 * Al despachar, los precios e importes quedan congelados históricamente.
 */
export interface SaleLineItemRecord {
  readonly productId: EntityId;
  readonly productCode: string;
  readonly sku: string | null;
  readonly productName: string;
  readonly measurementUnitId: EntityId;
  readonly unitName: string;
  readonly unitSymbol: string;
  readonly quantity: number;
  readonly unitSalePrice: number;
  readonly lineSubtotal: number;
}

/**
 * Estado de sincronización en tiempo real de una partida de cuenta abierta
 * respecto al catálogo vigente de almacén.
 */
export interface SaleLineCatalogSyncStatus {
  readonly productId: EntityId;
  readonly productName: string;
  readonly isProductMissing: boolean;
  readonly isProductInactive: boolean;
  readonly isOutOfStock: boolean;
  readonly isInsufficientStock: boolean;
  readonly availableStock: number;
  readonly requestedQuantity: number;
  readonly hasPriceChanged: boolean;
  readonly savedUnitSalePrice: number;
  readonly currentCatalogSalePrice: number;
  readonly blocksDispatch: boolean;
  readonly statusMessage: string | null;
}

/**
 * Registro persistente de una cuenta abierta o venta despachada/cancelada en IndexedDB.
 */
export interface SaleRecord extends BaseEntity {
  readonly folio: string;
  readonly consecutiveNumber?: number | null;
  readonly accountName?: string | null;
  readonly customerOrTableLabel?: string | null;
  readonly originType?: SaleOriginType;
  readonly status: SaleStatus;
  readonly items?: readonly SaleLineItemRecord[];
  readonly totalAmount?: number;
  readonly totalCostAmount?: number;
  readonly transferAmount?: number;
  readonly cashAmount?: number;
  readonly openedAt: ISODateString;
  readonly openedByUserId?: string;
  readonly openedByUserLabel?: string;
  readonly createdWorkdayId?: EntityId | null;
  readonly workdayId?: EntityId | null;
  readonly dispatchedWorkdayId?: EntityId | null;
  readonly dispatchedAt?: ISODateString | null;
  readonly dispatchedByUserId?: string | null;
  readonly dispatchedByUserLabel?: string | null;
  readonly closedAt: ISODateString | null;
  readonly cancelledAt?: ISODateString | null;
  readonly cancelledByUserId?: string | null;
  readonly cancelledByUserLabel?: string | null;
  readonly cancellationReason?: string | null;
  readonly hasStockMovement?: boolean;
  readonly inventoryMovementIds?: readonly EntityId[];
  readonly operationId?: string | null;
  readonly isPriorWorkdayAccount?: boolean;
  readonly priorWorkdayCode?: string | null;
}

export type SaleBaseRecord = SaleRecord;

/**
 * Resumen ligero de una cuenta abierta que bloquea operaciones de inventario.
 */
export interface PendingOpenAccountSummary {
  readonly id: EntityId;
  readonly folio: string;
  readonly consecutiveNumber: number | null;
  readonly accountName: string;
  readonly displayLabel: string;
  readonly totalAmount: number;
  readonly itemsCount: number;
  readonly openedAt: ISODateString;
  readonly workdayId: EntityId | null;
}

/**
 * Error de dominio especializado cuando existen cuentas abiertas que bloquean
 * el inicio de un corte parcial o del inventario final / cierre de jornada.
 */
export class PendingOpenAccountsError extends ValidationError {
  public readonly pendingAccounts: readonly PendingOpenAccountSummary[];

  constructor(message: string, pendingAccounts: readonly PendingOpenAccountSummary[]) {
    super(message);
    this.name = 'PendingOpenAccountsError';
    this.pendingAccounts = pendingAccounts;
  }
}

/**
 * Formatea el número consecutivo de una cuenta abierta como #001, #002, etc.
 */
export function formatOpenAccountConsecutive(consecutiveNumber: number): string {
  return `#${String(consecutiveNumber).padStart(3, '0')}`;
}

/**
 * Formatea el folio de un despacho directo sin cuenta abierta previa.
 */
export function formatDirectDispatchFolio(sequenceNumber: number): string {
  return `VD-${String(sequenceNumber).padStart(4, '0')}`;
}

/**
 * Construye la etiqueta visible combinada (#001 — Mesa 1).
 */
export function formatSaleDisplayLabel(
  sale: Pick<
    SaleRecord,
    'folio' | 'accountName' | 'customerOrTableLabel' | 'originType'
  >
): string {
  const label = (sale.accountName ?? sale.customerOrTableLabel ?? '').trim();
  if (label) {
    return `${sale.folio} — ${label}`;
  }
  if (sale.originType === 'DIRECT_DISPATCH') {
    return `${sale.folio} — Despacho directo`;
  }
  return sale.folio;
}

/**
 * Construye el resumen estructurado de una cuenta abierta para alertas de bloqueo.
 */
export function toPendingOpenAccountSummary(
  sale: SaleRecord
): PendingOpenAccountSummary {
  const accountName =
    (sale.accountName ?? sale.customerOrTableLabel ?? '').trim() || 'Cuenta sin nombre';
  return {
    id: sale.id,
    folio: sale.folio,
    consecutiveNumber: sale.consecutiveNumber ?? null,
    accountName,
    displayLabel: `${sale.folio} — ${accountName}`,
    totalAmount: sale.totalAmount ?? 0,
    itemsCount: sale.items?.length ?? 0,
    openedAt: sale.openedAt,
    workdayId: sale.workdayId ?? sale.createdWorkdayId ?? null,
  };
}

/**
 * Valida una cantidad de partida comercial:
 * - Numérica y finita
 * - Mayor que cero (> 0)
 * - Máximo 2 decimales
 * - Dentro del límite numérico operativo
 */
export function validateSaleLineQuantity(
  quantity: unknown,
  productLabel = 'el producto'
): number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    throw new ValidationError(
      `La cantidad para ${productLabel} debe ser un valor numérico válido.`
    );
  }

  if (quantity <= 0) {
    throw new ValidationError(
      `La cantidad para ${productLabel} debe ser estrictamente mayor que cero.`
    );
  }

  const parts = quantity.toString().split('.');
  const decimals = parts[1]?.length ?? 0;
  if (decimals > 2) {
    throw new ValidationError(
      `La cantidad para ${productLabel} admite como máximo dos decimales.`
    );
  }

  if (quantity > 9999999.99) {
    throw new ValidationError(
      `La cantidad para ${productLabel} excede el límite numérico permitido.`
    );
  }

  return Math.round(quantity * 100) / 100;
}

export interface SaleLineDraftInput {
  readonly productId: EntityId;
  readonly quantity: number;
  readonly unitSalePrice?: number;
}

/**
 * Consolida partidas repetidas del mismo producto en una sola línea sumando sus cantidades
 * y validando cada cantidad individual y acumulada.
 */
export function consolidateSaleLineInputs(
  rawLines: readonly SaleLineDraftInput[]
): { productId: EntityId; quantity: number; customUnitSalePrice?: number }[] {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new ValidationError(
      'Debes incluir al menos un producto válido en la venta.'
    );
  }

  const map = new Map<
    EntityId,
    { productId: EntityId; quantity: number; customUnitSalePrice?: number }
  >();

  for (const line of rawLines) {
    const productId = (line?.productId || '').trim();
    if (!productId) {
      throw new ValidationError('Se detectó una partida sin identificador de producto.');
    }

    const validQty = validateSaleLineQuantity(line.quantity);
    const existing = map.get(productId);
    if (!existing) {
      map.set(productId, {
        productId,
        quantity: validQty,
        customUnitSalePrice: line.unitSalePrice,
      });
    } else {
      const summed = validateSaleLineQuantity(
        Math.round((existing.quantity + validQty) * 100) / 100
      );
      map.set(productId, {
        productId,
        quantity: summed,
        customUnitSalePrice: line.unitSalePrice ?? existing.customUnitSalePrice,
      });
    }
  }

  return Array.from(map.values());
}
