'use client';

import { useAuth } from '../AuthProvider';

interface HeaderProps {
  isConnected: boolean;
  urgentCount: number;
  upcomingMeeting: { title: string; minutesUntil: number; meetingLink?: string | null } | null;
  onUrgentClick: () => void;
  onRefresh: () => void;
}

export function Header({ isConnected, urgentCount, upcomingMeeting, onUrgentClick, onRefresh }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 px-8 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-slate-900 font-semibold text-xl">
            Welcome back, {user?.displayName?.split(' ')[0] || 'RBK'}
          </h2>
          <p className="text-slate-500 text-sm mt-0.5">Here&apos;s what needs your attention today</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Meeting Countdown Alert */}
          {upcomingMeeting && (
            <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
              <span className="font-medium text-amber-800 truncate max-w-[200px]">{upcomingMeeting.title}</span>
              <span className="whitespace-nowrap text-amber-600">
                in {upcomingMeeting.minutesUntil} min{upcomingMeeting.minutesUntil !== 1 ? 's' : ''}
              </span>
              {upcomingMeeting.meetingLink && (
                <a
                  href={upcomingMeeting.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-amber-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-amber-700 transition-colors ml-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  Join
                </a>
              )}
            </div>
          )}
          {isConnected && (
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </span>
          )}
          {urgentCount > 0 && (
            <button
              onClick={onUrgentClick}
              className="bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              {urgentCount} Urgent
            </button>
          )}
          <button
            onClick={onRefresh}
            className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
