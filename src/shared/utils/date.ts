import { ISODateString } from '../types/entity';

const dateTimeFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateOnlyFormatter = new Intl.DateTimeFormat('es-MX', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function nowISO(): ISODateString {
  return new Date().toISOString();
}

export function formatDateTime(iso: ISODateString | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return dateTimeFormatter.format(parsed);
}

export function formatCurrentLocalDate(): string {
  return dateOnlyFormatter.format(new Date());
}

export function getTodayLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isFutureDate(dateStr: string): boolean {
  const today = getTodayLocalDateString();
  return dateStr > today;
}

export function isSameLocalDay(isoA: ISODateString, isoB: ISODateString): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface ExpirationStatus {
  readonly status: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'VALID' | 'UNKNOWN';
  readonly daysRemaining: number | null;
  readonly label: string;
  readonly isAlert: boolean; // Alerta preventiva cuando le queda 1 año o menos (<= 365 días) o ya está vencido
}

/**
 * Calcula los días calendario que restan hasta una fecha YYYY-MM o YYYY-MM-DD.
 * Para formato mes/año (YYYY-MM), se toma el último día de dicho mes (estándar farmacéutico/comercial).
 */
export function getDaysUntil(dateStr: string): number {
  if (!dateStr || !dateStr.includes('-')) return 0;
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return 0;

  const year = parts[0];
  const month = parts[1]; // 1 a 12
  // Si no se proporcionó día (formato mes/año YYYY-MM), se fija al último día de ese mes
  const day = parts.length >= 3 && !Number.isNaN(parts[2])
    ? parts[2]
    : new Date(year, month, 0).getDate();

  const targetDate = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Evalúa si una fecha de vencimiento requiere alerta preventiva (1 año o menos / <= 365 días).
 * Compatible con formato YYYY-MM y YYYY-MM-DD.
 */
export function getExpirationStatus(expirationDate: string | null | undefined): ExpirationStatus {
  if (!expirationDate || !expirationDate.trim()) {
    return {
      status: 'UNKNOWN',
      daysRemaining: null,
      label: 'Sin vencimiento',
      isAlert: false,
    };
  }

  const days = getDaysUntil(expirationDate.trim());

  if (days < 0) {
    const expiredDaysAgo = Math.abs(days);
    return {
      status: 'EXPIRED',
      daysRemaining: days,
      label: expiredDaysAgo === 0 ? 'Vence este mes' : `Vencido hace ${expiredDaysAgo} d`,
      isAlert: true,
    };
  }

  if (days === 0) {
    return {
      status: 'EXPIRED',
      daysRemaining: 0,
      label: 'Vence este mes',
      isAlert: true,
    };
  }

  // Alerta preventiva: 1 año o menos (<= 365 días)
  if (days <= 365) {
    let timeLabel = '';
    if (days <= 30) {
      timeLabel = `${days} días`;
    } else {
      const months = Math.floor(days / 30.41);
      const remDays = days % 30;
      timeLabel = months >= 1 && remDays > 0 ? `${months}m ${remDays}d` : `${months} meses`;
    }

    return {
      status: days <= 90 ? 'CRITICAL' : 'WARNING',
      daysRemaining: days,
      label: `Vence en ${timeLabel}`,
      isAlert: true,
    };
  }

  const totalMonths = Math.floor(days / 30.41);
  const years = Math.floor(totalMonths / 12);
  const remainingMonths = totalMonths % 12;
  const timeDesc = remainingMonths > 0 ? `${years}a ${remainingMonths}m` : `${years} años`;

  return {
    status: 'VALID',
    daysRemaining: days,
    label: `Vigente (>1 año, ${timeDesc})`,
    isAlert: false,
  };
}

/**
 * Formatea una fecha de vencimiento únicamente a Mes y Año (MM/AAAA),
 * sin mostrar el día.
 */
export function formatSimpleDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parts = dateStr.trim().split('-');
  if (parts.length >= 2) {
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    return `${month}/${year}`;
  }
  return dateStr;
}

