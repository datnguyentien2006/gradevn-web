// Chỉnh định dạng hiển thị dùng chung cho các màn hình bước 5.

import type { Contest, SheetFormType, SheetOrientation } from '../core/types';

export function formatScore(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatDate(value: Date | string): string {
  const raw = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(raw.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(raw);
}

export function formatDateTime(value: Date | string): string {
  const raw = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(raw.getTime())) return String(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(raw);
}

export function percent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const FORM_TYPE_LABELS: Record<SheetFormType, string> = {
  standard: 'Chuẩn 40 câu',
  fifty: '50 câu',
  hundred20: '120 câu',
  ministry: 'Nhiều phần (Bộ)'
};

export const ORIENTATION_LABELS: Record<SheetOrientation, string> = {
  portrait: 'Dọc',
  landscape: 'Ngang'
};

export function contestSubtitle(contest: Contest, className: string | null): string {
  const room = contest.classRoomId == null ? 'Ngoài lớp' : className ?? 'Lớp';
  return `${formatDate(contest.examDate)} · ${room} · ${contest.questionCount} câu`;
}

export function keyLabel(examCode: string): string {
  return examCode ? `Mã ${examCode}` : 'Đáp án chung';
}
