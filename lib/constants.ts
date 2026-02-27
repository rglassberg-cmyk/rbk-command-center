import type { LucideIcon } from 'lucide-react';

export interface ConfigItem {
  label: string;
  borderColor: string;
  textColor: string;
  bgColor: string;
  icon: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
}

export const priorityConfig: Record<string, ConfigItem> = {
  rbk_action: {
    label: 'Action Required',
    borderColor: 'border-red-600',
    textColor: 'text-red-700',
    bgColor: 'bg-red-50',
    icon: 'AlertCircle',
  },
  eg_action: {
    label: 'Emily',
    borderColor: 'border-blue-600',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: 'User',
  },
  invitation: {
    label: 'Invitation',
    borderColor: 'border-purple-600',
    textColor: 'text-purple-700',
    bgColor: 'bg-purple-50',
    icon: 'Mail',
  },
  meeting_invite: {
    label: 'Meeting',
    borderColor: 'border-green-600',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'Calendar',
  },
  important_no_action: {
    label: 'Important',
    borderColor: 'border-orange-600',
    textColor: 'text-orange-700',
    bgColor: 'bg-orange-50',
    icon: 'Star',
  },
  review: {
    label: 'Review',
    borderColor: 'border-amber-600',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: 'Eye',
  },
  fyi: {
    label: 'FYI',
    borderColor: 'border-slate-400',
    textColor: 'text-slate-600',
    bgColor: 'bg-slate-50',
    icon: 'Info',
  },
};

export const statusConfig: Record<string, ConfigItem> = {
  pending: {
    label: 'Pending',
    borderColor: 'border-orange-500',
    textColor: 'text-orange-700',
    bgColor: 'bg-orange-50',
    icon: 'Clock',
  },
  in_progress: {
    label: 'In Progress',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: 'RefreshCw',
  },
  done: {
    label: 'Done',
    borderColor: 'border-green-500',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'CheckCircle',
  },
  archived: {
    label: 'Archived',
    borderColor: 'border-slate-400',
    textColor: 'text-slate-500',
    bgColor: 'bg-slate-50',
    icon: 'Archive',
  },
};

export const draftStatusConfig: Record<string, ConfigItem> = {
  not_started: {
    label: 'Not Started',
    borderColor: 'border-slate-300',
    textColor: 'text-slate-600',
    bgColor: 'bg-slate-50',
    icon: 'FileText',
  },
  editing: {
    label: 'Editing',
    borderColor: 'border-amber-500',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: 'Pencil',
  },
  draft_ready: {
    label: 'Review Draft',
    borderColor: 'border-green-500',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'FileCheck',
  },
  approved: {
    label: 'Approved',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: 'ThumbsUp',
  },
  needs_revision: {
    label: 'Needs Revision',
    borderColor: 'border-orange-500',
    textColor: 'text-orange-700',
    bgColor: 'bg-orange-50',
    icon: 'RotateCcw',
  },
};

export const actionStatusConfig: Record<string, ConfigItem> = {
  send: {
    label: 'Send',
    borderColor: 'border-green-500',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'Send',
  },
  sent: {
    label: 'Sent',
    borderColor: 'border-emerald-500',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    icon: 'CheckCircle',
  },
  remind_me: {
    label: 'Remind Me',
    borderColor: 'border-violet-500',
    textColor: 'text-violet-700',
    bgColor: 'bg-violet-50',
    icon: 'Bell',
  },
  draft_ready: {
    label: 'Review Draft',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: 'FileText',
  },
  urgent: {
    label: 'URGENT',
    borderColor: 'border-red-600',
    textColor: 'text-white',
    bgColor: 'bg-red-500',
    icon: 'AlertTriangle',
  },
};

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'inbox', label: 'Inbox', icon: 'Inbox' },
  { id: 'agenda', label: 'Agenda', icon: 'ListTodo' },
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
];
