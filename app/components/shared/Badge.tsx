'use client';

import {
  AlertCircle,
  User,
  Mail,
  Calendar,
  Star,
  Eye,
  Info,
  Clock,
  RefreshCw,
  CheckCircle,
  Archive,
  FileText,
  Pencil,
  FileCheck,
  ThumbsUp,
  RotateCcw,
  Send,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import {
  priorityConfig,
  statusConfig,
  draftStatusConfig,
  actionStatusConfig,
  type ConfigItem,
} from '@/lib/constants';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  AlertCircle,
  User,
  Mail,
  Calendar,
  Star,
  Eye,
  Info,
  Clock,
  RefreshCw,
  CheckCircle,
  Archive,
  FileText,
  Pencil,
  FileCheck,
  ThumbsUp,
  RotateCcw,
  Send,
  Bell,
  AlertTriangle,
};

interface BadgeProps {
  variant: 'priority' | 'status' | 'draft' | 'action';
  value: string;
  size?: 'sm' | 'md';
}

const configMap: Record<BadgeProps['variant'], Record<string, ConfigItem>> = {
  priority: priorityConfig,
  status: statusConfig,
  draft: draftStatusConfig,
  action: actionStatusConfig,
};

export function Badge({ variant, value, size = 'sm' }: BadgeProps) {
  const config = configMap[variant]?.[value];

  if (!config) {
    return null;
  }

  const IconComponent = iconMap[config.icon];
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium
        ${sizeClasses}
        ${config.bgColor}
        ${config.textColor}
        border ${config.borderColor}
        transition-colors duration-150
      `}
    >
      {IconComponent && (
        <IconComponent className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      )}
      <span>{config.label}</span>
    </span>
  );
}

export default Badge;
