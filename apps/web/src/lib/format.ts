import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';

export function formatListDate(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'вчера';
  if (isThisYear(d)) return format(d, 'd MMM', { locale: ru });
  return format(d, 'dd.MM.yyyy');
}

export function formatFullDate(iso: string): string {
  return format(new Date(iso), 'd MMMM yyyy, HH:mm', { locale: ru });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

export function senderLabel(name: string | null, address: string | null): string {
  if (name && name.trim()) return name.trim();
  if (address) {
    const at = address.indexOf('@');
    return at > 0 ? address.slice(0, at) : address;
  }
  return '(неизвестный отправитель)';
}

export function initialOf(name: string | null, address: string | null): string {
  const s = senderLabel(name, address);
  return s.slice(0, 1).toUpperCase();
}
