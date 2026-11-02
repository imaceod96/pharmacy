import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import {
  PendingOpenAccountsError,
  SaleRecord,
  SaleStatus,
  toPendingOpenAccountSummary,
} from '../../sales/domain/entities/SaleRecord';
import {
  PartialCutStatus,
  PartialInventoryCutRecord,
} from '../domain/entities/InventoryCutRecord';
import {
  isOperativeWorkday,
  WorkdayRecord,
  WorkdayStatus,
} from '../domain/entities/WorkdayRecord';
import {
  FINAL_INVENTORY_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE,
  FinalInventorySelectionResult,
  PrepareFinalInventorySelectionUseCase,
} from './PrepareFinalInventorySelectionUseCase';

export interface StartWorkdayClosingInput {
  readonly workdayId?: string;
}

export interface StartWorkdayClosingReadinessResult {
  readonly workday: WorkdayRecord;
  readonly finalInventorySelection: FinalInventorySelectionResult;
}

/**
 * Valida transaccionalmente los prerrequisitos obligatorios antes de iniciar
 * el inventario final / cierre de jornada:
 * 1. Exclusivo para Administrador (MANAGE_INVENTORY_CUTS).
 * 2. Bloqueo estricto si existe cualquier cuenta en estado OPEN (de esta o jornadas previas).
 * 3. Verifica que no existan cortes parciales en borrador o revisión pendientes de resolver.
 * 4. Actualiza el estado de la jornada a CLOSING y registra la operación en auditoría.
 * 5. Prepara la selección 100 % automática de productos para el inventario final.
 */
export class StartWorkdayClosingUseCase {
  private readonly transactionManager: TransactionManager;
  private readonly prepareFinalInventoryUseCase: PrepareFinalInventorySelectionUseCase;

  constructor(
    transactionManager: TransactionManager,
    prepareFinalInventoryUseCase: PrepareFinalInventorySelectionUseCase
  ) {
    this.transactionManager = transactionManager;
    this.prepareFinalInventoryUseCase = prepareFinalInventoryUseCase;
  }

  public async execute(
    actor: SessionActor,
    input: StartWorkdayClosingInput = {}
  ): Promise<StartWorkdayClosingReadinessResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'iniciar cierre de jornada e inventario final'
    );

    const timestamp = nowISO();
    const operationId = generateEntityId();

    const workday = await this.transactionManager.runTransaction(
      [
        StoreName.WAREHOUSE_WORKDAYS,
        StoreName.WAREHOUSE_INVENTORY_CUTS,
        StoreName.SALES_RECORDS,
        StoreName.OPERATION_HISTORY,
      ],
      'readwrite',
      async (tx) => {
        // 1. Las cuentas abiertas se permiten durante el cierre. Sus existencias ya fueron descontadas
        // físicamente y no sumarán a las ventas hasta ser despachadas manualmente en una jornada abierta.

        // 2. Localizar jornada operativa activa
        let targetWorkday: WorkdayRecord | undefined;
        if (input.workdayId) {
          targetWorkday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            input.workdayId
          );
          if (!targetWorkday) {
            throw new EntityNotFoundError('warehouse_workdays', input.workdayId);
          }
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS
          );
          targetWorkday = allWorkdays.find((w) => isOperativeWorkday(w.status));
          if (!targetWorkday) {
            throw new ValidationError(
              'No existe una jornada abierta para iniciar el proceso de cierre.'
            );
          }
        }

        if (targetWorkday.status === WorkdayStatus.CLOSED) {
          throw new ValidationError(
            `La jornada ${targetWorkday.code} ya se encuentra cerrada.`
          );
        }

        // Si ya está en CLOSING o CLOSING_SUSPENDED, se permite continuar sin re-iniciar
        if (
          targetWorkday.status === WorkdayStatus.CLOSING ||
          targetWorkday.status === WorkdayStatus.CLOSING_SUSPENDED
        ) {
          return targetWorkday;
        }

        // 3. Verificar que no exista un corte parcial en borrador o pendiente de revisión
        const workdayCuts = await tx.getAllByIndex<PartialInventoryCutRecord>(
          StoreName.WAREHOUSE_INVENTORY_CUTS,
          'by_workday_id',
          targetWorkday.id
        );
        const pendingCut = workdayCuts.find(
          (c) =>
            c.status === PartialCutStatus.DRAFT ||
            c.status === PartialCutStatus.READY_FOR_REVIEW
        );
        if (pendingCut) {
          throw new ValidationError(
            `No puedes iniciar el cierre de jornada porque existe un corte parcial pendiente (${pendingCut.reference}). Concluye o cancela ese corte parcial primero.`
          );
        }

        // 4. Actualizar estado de jornada a CLOSING
        const updatedWorkday: WorkdayRecord = {
          ...targetWorkday,
          status: WorkdayStatus.CLOSING,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_WORKDAYS, updatedWorkday);

        // 5. Registrar auditoría operativa
        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'START_WORKDAY_CLOSING',
          entityType: 'Workday',
          entityId: targetWorkday.id,
          actorRole: actor.role,
          description: `Inicio del proceso de cierre e inventario final para la Jornada #${targetWorkday.consecutiveNumber} (${targetWorkday.code}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return updatedWorkday;
      }
    );

    const finalInventorySelection = await this.prepareFinalInventoryUseCase.execute(
      actor,
      { workdayId: workday.id }
    );

    return {
      workday,
      finalInventorySelection,
    };
  }
}
