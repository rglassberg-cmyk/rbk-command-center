'use client';

import { format } from 'date-fns';
import {
  LayoutDashboard,
  Inbox,
  User,
  Star,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../AuthProvider';
import { NAV_ITEMS } from '@/lib/constants';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Inbox,
  User,
  Star,
  ClipboardCheck,
};

interface SidebarProps {
  activeNav: string;
  setActiveNav: (id: string) => void;
  isConnected: boolean;
  unreadCount: number;
  emilyQueueCount: number;
}

export function Sidebar({ activeNav, setActiveNav, unreadCount, emilyQueueCount }: SidebarProps) {
  const { user, signOut } = useAuth();

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-white font-semibold text-lg">RBK Command Center</h1>
        <p className="text-slate-500 text-xs mt-1">{format(new Date(), 'EEEE, MMM d')}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = iconMap[item.icon];
          const badge =
            item.id === 'inbox' && unreadCount > 0
              ? unreadCount
              : item.id === 'emily' && emilyQueueCount > 0
                ? emilyQueueCount
                : null;

          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeNav === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {Icon && <Icon className="w-5 h-5" />}
              {item.label}
              {badge !== null && (
                <span className="ml-auto bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User */}
      {user && (
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            {user.photoURL && (
              <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
              <button onClick={() => signOut()} className="text-xs text-slate-500 hover:text-white transition-colors">
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
