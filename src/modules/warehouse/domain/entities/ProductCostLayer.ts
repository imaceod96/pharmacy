import { BaseEntity, EntityId, ISODateString } from '../../../../shared/types/entity';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQuantity(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ProductCostLayer extends BaseEntity {
  readonly productId: EntityId;
  readonly originEntryId?: EntityId | null;
  readonly originalQuantity: number;
  remainingQuantity: number;
  readonly unitPurchaseCost: number;
  readonly expirationDate?: string | null;
  readonly createdAt: ISODateString;
  readonly updatedAt: ISODateString;
  readonly auditRef?: string | null;
}

export interface CostAttributionItem {
  readonly layerId: EntityId;
  readonly quantity: number;
  readonly unitPurchaseCost: number;
  readonly allocatedCost: number;
}

export interface CostAttributionResult {
  readonly costAttribution: readonly CostAttributionItem[];
  readonly totalCostAmount: number;
  readonly updatedLayers: readonly ProductCostLayer[];
}

/**
 * Asigna de forma FIFO (First In, First Out) las unidades despachadas de un producto
 * sobre sus capas de costo disponibles en orden cronológico ascendente.
 */
export function allocateCostLayersFIFO(
  productId: EntityId,
  quantityToDispatch: number,
  availableLayers: readonly ProductCostLayer[]
): CostAttributionResult {
  const sortedLayers = availableLayers
    .filter((l) => l.productId === productId && l.remainingQuantity > 0)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let remainingToAllocate = roundQuantity(quantityToDispatch);
  const costAttribution: CostAttributionItem[] = [];
  const updatedLayersMap = new Map<string, ProductCostLayer>();

  // Clonar capas para actualizar localmente
  for (const layer of availableLayers) {
    updatedLayersMap.set(layer.id, { ...layer });
  }

  let totalCostAmount = 0;

  for (const layer of sortedLayers) {
    if (remainingToAllocate <= 0) break;

    const layerMutable = updatedLayersMap.get(layer.id)!;
    const takeQty = Math.min(remainingToAllocate, layerMutable.remainingQuantity);
    const allocatedCost = roundMoney(takeQty * layerMutable.unitPurchaseCost);

    layerMutable.remainingQuantity = roundQuantity(
      layerMutable.remainingQuantity - takeQty
    );
    updatedLayersMap.set(layer.id, layerMutable);

    costAttribution.push({
      layerId: layer.id,
      quantity: takeQty,
      unitPurchaseCost: layer.unitPurchaseCost,
      allocatedCost,
    });

    totalCostAmount = roundMoney(totalCostAmount + allocatedCost);
    remainingToAllocate = roundQuantity(remainingToAllocate - takeQty);
  }

  // Si queda cantidad por asignar sin capas suficientes (ej. stock legacy sin capas de costo),
  // se atribuye al costo estimado 0 o al último costo conocido con referencia de valoración incompleta.
  if (remainingToAllocate > 0) {
    const fallbackCost = sortedLayers.length > 0 ? sortedLayers[sortedLayers.length - 1].unitPurchaseCost : 0;
    const fallbackAllocated = roundMoney(remainingToAllocate * fallbackCost);
    costAttribution.push({
      layerId: 'fallback-legacy-layer',
      quantity: remainingToAllocate,
      unitPurchaseCost: fallbackCost,
      allocatedCost: fallbackAllocated,
    });
    totalCostAmount = roundMoney(totalCostAmount + fallbackAllocated);
  }

  return {
    costAttribution,
    totalCostAmount,
    updatedLayers: Array.from(updatedLayersMap.values()),
  };
}
