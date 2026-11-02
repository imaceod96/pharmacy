import { assertPermission, hasPermission } from '../../../shared/lib/permissions/rolePolicy';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import {
  PendingOpenAccountSummary,
  toPendingOpenAccountSummary,
} from '../../sales/domain/entities/SaleRecord';
import { SaleRepository } from '../../sales/domain/repositories/SaleRepository';
import {
  computeNextPartialCutIntervalStart,
  PartialCutStatus,
  PartialInventoryCutRecord,
  resolveCutCommercialActivityProjection,
  sanitizePartialCutForActor,
} from '../domain/entities/InventoryCutRecord';
import { WorkdayStatus } from '../domain/entities/WorkdayRecord';
import { InventoryCutRepository } from '../domain/repositories/InventoryCutRepository';
import { WorkdayRepository } from '../domain/repositories/WorkdayRepository';
import { PARTIAL_CUT_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE } from './CreatePartialCutUseCase';

export interface WorkdayPartialCutsSummary {
  readonly workdayId: string;
  readonly workdayCode: string;
  readonly workdayStatus: WorkdayStatus;
  readonly cuts: readonly PartialInventoryCutRecord[];
  readonly activeDraftOrReviewCut: PartialInventoryCutRecord | null;
  readonly nextIntervalStartAt: string;
  readonly canCreateNewCut: boolean;
  readonly cannotCreateReason: string | null;
  readonly pendingOpenAccounts: readonly PendingOpenAccountSummary[];
}

export class ListWorkdayPartialCutsUseCase {
  private readonly workdayRepository: WorkdayRepository;
  private readonly inventoryCutRepository: InventoryCutRepository;
  private readonly saleRepository?: SaleRepository;

  constructor(
    workdayRepository: WorkdayRepository,
    inventoryCutRepository: InventoryCutRepository,
    saleRepository?: SaleRepository
  ) {
    this.workdayRepository = workdayRepository;
    this.inventoryCutRepository = inventoryCutRepository;
    this.saleRepository = saleRepository;
  }

  public async execute(
    actor: SessionActor,
    workdayId: string
  ): Promise<WorkdayPartialCutsSummary> {
    assertPermission(
      actor,
      Permission.VIEW_INVENTORY_CUTS,
      'consultar cortes parciales de la jornada'
    );

    const canViewCosts = hasPermission(actor.role, Permission.VIEW_PRODUCT_COSTS);
    const canManageCuts = hasPermission(actor.role, Permission.MANAGE_INVENTORY_CUTS);

    const workday = await this.workdayRepository.findById(workdayId);
    if (!workday) {
      return {
        workdayId,
        workdayCode: '',
        workdayStatus: WorkdayStatus.CLOSED,
        cuts: [],
        activeDraftOrReviewCut: null,
        nextIntervalStartAt: '',
        canCreateNewCut: false,
        cannotCreateReason: 'La jornada indicada no existe.',
        pendingOpenAccounts: [],
      };
    }

    const [cuts, openSales, workdayDispatchedSales] = await Promise.all([
      this.inventoryCutRepository.findByWorkdayId(workday.id),
      this.saleRepository ? this.saleRepository.findOpenSales() : Promise.resolve([]),
      this.saleRepository
        ? this.saleRepository.findDispatchedSalesByWorkdayId(workday.id)
        : Promise.resolve([]),
    ]);

    const pendingOpenAccounts = openSales.map(toPendingOpenAccountSummary);

    const projectedCuts: PartialInventoryCutRecord[] = cuts
      .slice()
      .sort((a, b) => b.consecutiveNumber - a.consecutiveNumber)
      .map((cut) => {
        const commercialActivity = resolveCutCommercialActivityProjection({
          cut,
          allSales: workdayDispatchedSales,
          allCutsInWorkday: cuts,
          workdayOpenedAt: workday.openedAt,
        });
        return sanitizePartialCutForActor(
          cut,
          commercialActivity,
          canViewCosts,
          canManageCuts
        );
      });

    const activeDraftOrReviewCut =
      projectedCuts.find(
        (c) =>
          c.status === PartialCutStatus.DRAFT ||
          c.status === PartialCutStatus.READY_FOR_REVIEW
      ) ?? null;

    const nextIntervalStartAt = computeNextPartialCutIntervalStart(
      workday.openedAt,
      cuts
    );

    let canCreateNewCut = true;
    let cannotCreateReason: string | null = null;

    if (workday.status !== WorkdayStatus.OPEN) {
      canCreateNewCut = false;
      cannotCreateReason =
        'Solo se pueden iniciar nuevos cortes parciales cuando la jornada está en estado Abierta.';
    } else if (activeDraftOrReviewCut) {
      canCreateNewCut = false;
      cannotCreateReason = `Existe un corte parcial activo (${activeDraftOrReviewCut.reference}). Continúa o cancela ese borrador antes de abrir otro para evitar intervalos solapados.`;
    }

    return {
      workdayId: workday.id,
      workdayCode: workday.code,
      workdayStatus: workday.status,
      cuts: projectedCuts,
      activeDraftOrReviewCut,
      nextIntervalStartAt,
      canCreateNewCut,
      cannotCreateReason,
      pendingOpenAccounts,
    };
  }
}

