export interface ConfigItem {
  label: string;
  borderColor: string;
  textColor: string;
  bgColor: string;
  icon: string;
  dot?: string;
  borderLeft?: string;
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
    dot: 'bg-red-500',
    borderLeft: 'border-l-4 border-l-red-600',
  },
  eg_action: {
    label: 'Emily',
    borderColor: 'border-violet-600',
    textColor: 'text-violet-700',
    bgColor: 'bg-violet-50',
    icon: 'User',
    dot: 'bg-violet-500',
    borderLeft: 'border-l-4 border-l-violet-600',
  },
  invitation: {
    label: 'Invitation',
    borderColor: 'border-cyan-600',
    textColor: 'text-cyan-700',
    bgColor: 'bg-cyan-50',
    icon: 'Mail',
    dot: 'bg-cyan-500',
    borderLeft: 'border-l-4 border-l-cyan-600',
  },
  meeting_invite: {
    label: 'Meeting',
    borderColor: 'border-green-600',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'Calendar',
    dot: 'bg-green-500',
    borderLeft: 'border-l-4 border-l-green-500',
  },
  important_no_action: {
    label: 'Important',
    borderColor: 'border-amber-600',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: 'Star',
    dot: 'bg-amber-400',
    borderLeft: 'border-l-4 border-l-amber-400',
  },
  review: {
    label: 'Review',
    borderColor: 'border-amber-600',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: 'Eye',
    dot: 'bg-amber-400',
    borderLeft: 'border-l-4 border-l-amber-400',
  },
  fyi: {
    label: 'FYI',
    borderColor: 'border-slate-400',
    textColor: 'text-slate-600',
    bgColor: 'bg-slate-50',
    icon: 'Info',
    dot: 'bg-slate-300',
    borderLeft: 'border-l-4 border-l-slate-300',
  },
};

export const statusConfig: Record<string, ConfigItem> = {
  pending: {
    label: 'Pending',
    borderColor: 'border-amber-500',
    textColor: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: 'Clock',
    dot: 'bg-amber-400',
  },
  in_progress: {
    label: 'In Progress',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: 'RefreshCw',
    dot: 'bg-blue-500',
  },
  done: {
    label: 'Done',
    borderColor: 'border-green-500',
    textColor: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: 'CheckCircle',
    dot: 'bg-green-500',
  },
  archived: {
    label: 'Archived',
    borderColor: 'border-slate-400',
    textColor: 'text-slate-500',
    bgColor: 'bg-slate-50',
    icon: 'Archive',
    dot: 'bg-slate-300',
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
  { id: 'inbox', label: 'All Emails', icon: 'Inbox' },
  { id: 'emily', label: "Emily's Queue", icon: 'User' },
  { id: 'agenda', label: 'Meeting Agenda', icon: 'Star' },
  { id: 'tasks', label: 'Tasks', icon: 'ClipboardCheck' },
];
