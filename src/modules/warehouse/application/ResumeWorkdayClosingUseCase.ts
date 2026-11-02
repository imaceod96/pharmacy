import { StoreName } from '../../../shared/lib/indexeddb/schema';
import { assertPermission } from '../../../shared/lib/permissions/rolePolicy';
import { EntityNotFoundError, ValidationError } from '../../../shared/types/errors';
import { Permission, SessionActor } from '../../../shared/types/permissions';
import { TransactionManager } from '../../../shared/types/repository';
import { nowISO } from '../../../shared/utils/date';
import { generateEntityId } from '../../../shared/utils/id';
import { OperationLogEntry, OperationModule } from '../../core/domain/entities/OperationLog';
import { PendingOpenAccountsError, SaleRecord, SaleStatus, toPendingOpenAccountSummary } from '../../sales/domain/entities/SaleRecord';
import { FINAL_INVENTORY_BLOCKED_BY_OPEN_ACCOUNTS_MESSAGE } from './PrepareFinalInventorySelectionUseCase';
import { WorkdayRecord, WorkdayStatus } from '../domain/entities/WorkdayRecord';

export interface ResumeWorkdayClosingInput {
  readonly workdayId?: string;
}

export interface ResumeWorkdayClosingResult {
  readonly workday: WorkdayRecord;
}

export class ResumeWorkdayClosingUseCase {
  private readonly transactionManager: TransactionManager;

  constructor(transactionManager: TransactionManager) {
    this.transactionManager = transactionManager;
  }

  public async execute(
    actor: SessionActor,
    input: ResumeWorkdayClosingInput = {}
  ): Promise<ResumeWorkdayClosingResult> {
    assertPermission(
      actor,
      Permission.MANAGE_INVENTORY_CUTS,
      'reanudar el cierre de jornada'
    );

    const timestamp = nowISO();
    const operationId = generateEntityId();

    return this.transactionManager.runTransaction(
      [StoreName.WAREHOUSE_WORKDAYS, StoreName.SALES_RECORDS, StoreName.OPERATION_HISTORY],
      'readwrite',
      async (tx) => {
        // Las cuentas abiertas se permiten durante la reanudación del cierre.

        let workday: WorkdayRecord | undefined;
        if (input.workdayId) {
          workday = await tx.get<WorkdayRecord>(
            StoreName.WAREHOUSE_WORKDAYS,
            input.workdayId
          );
          if (!workday) {
            throw new EntityNotFoundError('warehouse_workdays', input.workdayId);
          }
        } else {
          const allWorkdays = await tx.getAll<WorkdayRecord>(StoreName.WAREHOUSE_WORKDAYS);
          workday = allWorkdays.find((w) => w.status === WorkdayStatus.CLOSING_SUSPENDED);
          if (!workday) {
            throw new ValidationError('No existe ninguna jornada con cierre suspendido para reanudar.');
          }
        }

        if (workday.status !== WorkdayStatus.CLOSING_SUSPENDED) {
          throw new ValidationError(
            `Solo se puede reanudar el cierre de una jornada en estado CLOSING_SUSPENDED (estado actual: ${workday.status}).`
          );
        }

        const updatedWorkday: WorkdayRecord = {
          ...workday,
          status: WorkdayStatus.CLOSING,
          updatedAt: timestamp,
        };
        await tx.upsert(StoreName.WAREHOUSE_WORKDAYS, updatedWorkday);

        const auditEntry: OperationLogEntry = {
          id: operationId,
          module: OperationModule.WAREHOUSE,
          action: 'RESUME_WORKDAY_CLOSING',
          entityType: 'Workday',
          entityId: workday.id,
          actorRole: actor.role,
          description: `Reanudación del cierre de la Jornada #${workday.consecutiveNumber} (${workday.code}).`,
          createdAt: timestamp,
        };
        await tx.insert(StoreName.OPERATION_HISTORY, auditEntry);

        return { workday: updatedWorkday };
      }
    );
  }
}
