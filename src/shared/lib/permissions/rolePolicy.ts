import { sessionElevationService } from '../security/SessionElevationService';
import { UnauthorizedOperationError } from '../../types/errors';
import { Permission, SessionActor, UserRole } from '../../types/permissions';

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  [UserRole.ADMIN]: new Set<Permission>([
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_DAILY_INCOME,
    Permission.CREATE_SALE,
    Permission.VIEW_OPEN_SALES,
    Permission.VIEW_SALES_HISTORY,
    Permission.VIEW_PRODUCTS,
    Permission.MANAGE_PRODUCTS,
    Permission.VIEW_PRODUCT_COSTS,
    Permission.VIEW_INVENTORY_CUTS,
    Permission.MANAGE_INVENTORY_CUTS,
    Permission.VIEW_SETTINGS,
    Permission.MANAGE_BACKUPS,
    Permission.VIEW_OPERATION_HISTORY,
    Permission.VIEW_EXPENSES,
    Permission.CREATE_EXPENSE,
  ]),
  [UserRole.CASHIER]: new Set<Permission>([
    Permission.VIEW_DASHBOARD,
    Permission.CREATE_SALE,
    Permission.VIEW_OPEN_SALES,
    Permission.VIEW_SALES_HISTORY,
    Permission.VIEW_PRODUCTS,
    Permission.VIEW_INVENTORY_CUTS,
    Permission.VIEW_EXPENSES,
    Permission.CREATE_EXPENSE,
  ]),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.CASHIER]: 'Cajero',
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function assertPermission(
  actor: SessionActor,
  permission: Permission,
  operationDescription: string
): void {
  if (!hasPermission(actor.role, permission)) {
    throw new UnauthorizedOperationError(operationDescription);
  }

  // Operaciones administrativas que no están disponibles para Cajero exigen elevación activa por PIN
  if (actor.role === UserRole.ADMIN) {
    if (!actor.elevationToken || !sessionElevationService.isSessionElevated(actor.elevationToken)) {
      throw new UnauthorizedOperationError(
        `Operación denegada (${operationDescription}): La sesión no cuenta con elevación administrativa previa obtenida mediante PIN de 6 dígitos.`
      );
    }
  }
}

