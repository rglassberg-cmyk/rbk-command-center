'use client';

import { useState } from 'react';
import ProgressRing from './ProgressRing';
import type { HomeProject } from './TodayHero';

interface MyProjectsListProps {
  projects: HomeProject[];
  todayHeroVisible: boolean;
  heroProjectIds: string[];
  onOpenProject: (projectId: string) => void;
}

function formatDueShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatUpdatedAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function emailInitial(email: string): string {
  return email.split('@')[0].charAt(0).toUpperCase();
}

function emailFirstName(email: string): string {
  const local = email.split('@')[0];
  // Try to split on common separators
  const parts = local.split(/[._-]/);
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'oklch(0.58 0.15 25)',
  medium: 'oklch(0.68 0.12 55)',
  low: '#cbd5e1',
};

export default function MyProjectsList({ projects, todayHeroVisible, heroProjectIds, onOpenProject }: MyProjectsListProps) {
  const [groupExpanded, setGroupExpanded] = useState<{ onHold: boolean; complete: boolean }>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('homeProjectGroupExpanded') || '{}'); } catch { /* empty */ }
    }
    return { onHold: false, complete: false };
  });

  const toggleGroup = (key: 'onHold' | 'complete') => {
    const next = { ...groupExpanded, [key]: !groupExpanded[key] };
    setGroupExpanded(next);
    localStorage.setItem('homeProjectGroupExpanded', JSON.stringify(next));
  };

  // Filter out hero projects from "In progress" when hero visible
  const activeProjects = projects.filter(p => p.status === 'active' && !(todayHeroVisible && heroProjectIds.includes(p.id)));
  const onHoldProjects = projects.filter(p => p.status === 'on_hold');
  const completeProjects = projects.filter(p => p.status === 'complete');

  const heading = todayHeroVisible ? 'All my projects' : 'My projects';
  const totalCount = activeProjects.length + onHoldProjects.length + completeProjects.length;

  if (projects.length === 0 && !todayHeroVisible) {
    return (
      <div className="mb-10">
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center bg-white">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-slate-600 font-medium" style={{ fontSize: 15 }}>No projects yet</p>
          <p className="text-slate-400 mt-1" style={{ fontSize: 13 }}>
            When you&apos;re assigned to a project or added to a team, it&apos;ll show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-10">
      {/* Heading */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bold" style={{ fontSize: 20, color: '#1B3A6B' }}>{heading}</h2>
        <span className="text-slate-400 font-medium" style={{ fontSize: 13 }}>{totalCount} project{totalCount === 1 ? '' : 's'}</span>
      </div>

      {/* In progress — always expanded */}
      {activeProjects.length > 0 && (
        <GroupSection label="In progress" count={activeProjects.length}>
          <ProjectRows projects={activeProjects} onOpenProject={onOpenProject} />
        </GroupSection>
      )}

      {/* On hold — collapsible */}
      {onHoldProjects.length > 0 && (
        <GroupSection label="On hold" count={onHoldProjects.length} collapsible expanded={groupExpanded.onHold} onToggle={() => toggleGroup('onHold')}>
          {groupExpanded.onHold && <ProjectRows projects={onHoldProjects} onOpenProject={onOpenProject} />}
        </GroupSection>
      )}

      {/* Complete — collapsible */}
      {completeProjects.length > 0 && (
        <GroupSection label="Complete" count={completeProjects.length} collapsible expanded={groupExpanded.complete} onToggle={() => toggleGroup('complete')}>
          {groupExpanded.complete && <ProjectRows projects={completeProjects} onOpenProject={onOpenProject} isComplete />}
        </GroupSection>
      )}
    </div>
  );
}

function GroupSection({ label, count, collapsible, expanded, onToggle, children }: {
  label: string;
  count: number;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {collapsible ? (
        <button onClick={onToggle} className="flex items-center gap-1.5 mb-2 group">
          <svg
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          ><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span className="text-slate-500 font-medium uppercase" style={{ fontSize: 12 }}>{label}</span>
          <span className="text-slate-400" style={{ fontSize: 12 }}>· {count}</span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-slate-500 font-medium uppercase" style={{ fontSize: 12 }}>{label}</span>
          <span className="text-slate-400" style={{ fontSize: 12 }}>· {count}</span>
        </div>
      )}
      {(!collapsible || expanded) && children}
    </div>
  );
}

function ProjectRows({ projects, onOpenProject, isComplete }: { projects: HomeProject[]; onOpenProject: (id: string) => void; isComplete?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {projects.map((project, idx) => (
        <div
          key={project.id}
          onClick={() => onOpenProject(project.id)}
          className={`flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors ${isComplete ? 'opacity-70' : ''}`}
          style={{
            padding: '16px 24px',
            borderBottom: idx < projects.length - 1 ? '1px solid #f1f5f9' : undefined,
            marginLeft: idx < projects.length - 1 ? 20 : 0,
            // Offset the border but keep content full width
          }}
        >
          {/* Progress ring */}
          <ProgressRing
            size={28}
            stroke={3}
            progress={project.progress}
            color={isComplete ? 'oklch(0.62 0.10 145)' : undefined}
          />

          {/* Title + description */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_COLORS[project.priority] || '#cbd5e1' }} />
              <span className={`text-slate-900 font-medium truncate ${isComplete ? 'line-through' : ''}`} style={{ fontSize: 15 }}>{project.title}</span>
            </div>
            {project.description && (
              <p className="text-slate-500 truncate mt-0.5 pl-3.5" style={{ fontSize: 12 }}>{project.description}</p>
            )}
          </div>

          {/* Team tags */}
          <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
            {project.team_emails.slice(0, 2).map((email) => (
              <span key={email} className="bg-slate-100 text-slate-600 rounded px-2 py-0.5" style={{ fontSize: 11.5 }}>
                {emailFirstName(email)}
              </span>
            ))}
            {project.team_emails.length > 2 && (
              <span className="bg-slate-100 text-slate-600 rounded px-2 py-0.5" style={{ fontSize: 11.5 }}>
                +{project.team_emails.length - 2}
              </span>
            )}
          </div>

          {/* Assignee avatar */}
          <div className="flex-shrink-0">
            {project.isMine ? (
              <span
                className="inline-flex items-center justify-center rounded-full text-white font-bold"
                style={{ width: 22, height: 22, fontSize: 9, backgroundColor: 'oklch(0.58 0.12 235)' }}
              >
                You
              </span>
            ) : project.assignee_email ? (
              <span
                className="inline-flex items-center justify-center rounded-full bg-slate-200 text-slate-600 font-semibold"
                style={{ width: 22, height: 22, fontSize: 10 }}
              >
                {emailInitial(project.assignee_email)}
              </span>
            ) : null}
          </div>

          {/* Date */}
          <div className="text-right flex-shrink-0 text-slate-500" style={{ minWidth: 88, fontSize: 12 }}>
            {project.due_date
              ? formatDueShort(project.due_date)
              : project.updated_at
                ? `updated ${formatUpdatedAgo(project.updated_at)}`
                : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
