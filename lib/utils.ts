import { formatDistanceToNow, parseISO, format, isToday as dateFnsIsToday } from 'date-fns';
import type { Email } from '@/types';

export function formatRelativeTime(dateString: string): string {
  try {
    return formatDistanceToNow(parseISO(dateString), { addSuffix: true });
  } catch {
    return '';
  }
}

export function formatTime(dateString: string): string {
  try {
    return format(parseISO(dateString), 'h:mm a');
  } catch {
    return '';
  }
}

export function formatDate(dateString: string): string {
  try {
    return format(parseISO(dateString), 'MMM d, yyyy');
  } catch {
    return '';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function getInitials(name: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function isToday(dateString: string): boolean {
  try {
    return dateFnsIsToday(parseISO(dateString));
  } catch {
    return false;
  }
}

export function isSnoozed(email: { reminder_date?: string | null }): boolean {
  if (!email.reminder_date) return false;
  try {
    const reminderDate = parseISO(email.reminder_date);
    return reminderDate > new Date();
  } catch {
    return false;
  }
}

export function matchesSearch(email: Email, query: string): boolean {
  if (!query.trim()) return true;
  const searchLower = query.toLowerCase();
  return (
    email.subject.toLowerCase().includes(searchLower) ||
    email.from_email.toLowerCase().includes(searchLower) ||
    (email.from_name?.toLowerCase().includes(searchLower) ?? false) ||
    email.summary.toLowerCase().includes(searchLower) ||
    email.body_text.toLowerCase().includes(searchLower)
  );
}
