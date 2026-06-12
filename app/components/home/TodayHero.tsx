'use client';

import ProgressRing from './ProgressRing';

interface HomeProject {
  id: string;
  title: string;
  description: string | null;
  department: string;
  priority: 'high' | 'medium' | 'low';
  status: string;
  progress: number;
  assignee_email: string | null;
  team_emails: string[];
  due_date: string | null;
  updated_at: string | null;
  tags: string[];
  isMine: boolean;
}

interface TodayHeroProps {
  projects: HomeProject[];
  onOpenProject?: (projectId: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'oklch(0.58 0.15 25)',
  medium: 'oklch(0.68 0.12 55)',
  low: '#cbd5e1',
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'updated just now';
  if (hours < 24) return `updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `updated ${days}d ago`;
}

function formatDueDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TodayHero({ projects, onOpenProject }: TodayHeroProps) {
  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const todayStr = now.toISOString().split('T')[0];
  const weekStr = weekFromNow.toISOString().split('T')[0];
  const oneDayAgo = Date.now() - 86400000;

  const candidates = projects
    .filter((p) => {
      if (p.status !== 'active') return false;
      const dueSoon = p.due_date && p.due_date <= weekStr;
      const recentlyUpdated = p.updated_at && new Date(p.updated_at).getTime() > oneDayAgo;
      return dueSoon || recentlyUpdated;
    })
    .sort((a, b) => {
      // Due date first (soonest), then most recently updated
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      const aUp = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bUp = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bUp - aUp;
    })
    .slice(0, 2);

  if (candidates.length === 0) return null;

  return (
    <div className="mb-10">
      {/* Section label */}
      <div className="flex items-center gap-2 mb-3.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#E87722' }} />
        <span className="font-bold uppercase" style={{ fontSize: 11.5, letterSpacing: '0.8px', color: '#1B3A6B' }}>
          Today · this week
        </span>
        <span className="text-slate-400" style={{ fontSize: 11.5 }}>
          · {candidates.length} project{candidates.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Cards grid */}
      <div className={`grid gap-3 ${candidates.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        {candidates.map((project) => (
          <div
            key={project.id}
            className="bg-white cursor-pointer group border border-slate-100"
            style={{
              borderRadius: 16,
              boxShadow: 'inset 3px 0 0 #1B3A6B, 0 1px 3px rgba(0,0,0,0.04)',
              padding: '24px 26px',
              transition: 'transform 120ms ease, box-shadow 120ms ease',
            }}
            onClick={() => onOpenProject?.(project.id)}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #1B3A6B, 0 8px 24px rgba(0,0,0,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #1B3A6B, 0 1px 3px rgba(0,0,0,0.04)'; }}
          >
            <div className="flex gap-4">
              <ProgressRing size={52} stroke={4} progress={project.progress} />
              <div className="flex-1 min-w-0">
                {/* Title row */}
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_COLORS[project.priority] || '#cbd5e1' }} />
                  <span className="text-slate-900 font-semibold truncate" style={{ fontSize: 16.5 }}>{project.title}</span>
                </div>
                {/* Description */}
                {project.description && (
                  <p className="text-slate-500 line-clamp-2 mt-1" style={{ fontSize: 13 }}>{project.description}</p>
                )}
                {/* Meta row */}
                <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                  {project.due_date && (
                    <span
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5"
                      style={{ backgroundColor: 'oklch(0.96 0.02 235)', color: 'oklch(0.42 0.10 235)', fontSize: 11.5, fontWeight: 500 }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {formatDueDate(project.due_date)}
                    </span>
                  )}
                  {project.updated_at && (
                    <span className="inline-flex items-center gap-1 text-slate-500" style={{ fontSize: 12 }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'oklch(0.62 0.10 145)' }} />
                      {formatTimeAgo(project.updated_at)}
                    </span>
                  )}
                  {project.isMine && (
                    <span
                      className="inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0"
                      style={{ width: 22, height: 22, fontSize: 9, backgroundColor: 'oklch(0.58 0.12 235)' }}
                    >
                      You
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { HomeProject };
