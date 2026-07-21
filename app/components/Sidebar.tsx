'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import type { User } from 'firebase/auth';

interface WorkspaceInfo {
  id: string;
  name: string;
  role: string;
}

interface ImpersonationTarget {
  email: string;
  display_name: string;
  role: string;
  workspace_id: string;
  workspace_name: string;
}

interface SidebarProps {
  user: User | null;
  activeNav: string;
  setActiveNav: (nav: string) => void;
  role: string | null;
  // System builder / super-admin (Becca) — gates the Admin link + impersonation.
  isSuperAdmin?: boolean;
  allowedModules: Record<string, boolean> | null;
  effectiveModules: Record<string, boolean> | null;
  workspaceId: string | null;
  workspaces: WorkspaceInfo[];
  switchWorkspace: (id: string) => void | Promise<void>;
  signOut: () => void | Promise<void>;
  unreadCount: number;
  emilyQueueCount: number;
  // Phase B: dynamic assistant identity. When null, the Assistant's
  // Queue nav item is hidden entirely. Label uses assistant.displayName.
  assistant?: { displayName: string | null } | null;
  onCompose?: () => void;
  mounted: boolean;
  impersonating?: ImpersonationTarget | null;
  startImpersonation?: (target: ImpersonationTarget) => void;
  stopImpersonation?: () => void;
  allMembers?: Array<{ email: string; display_name: string | null; role: string; workspace_id: string; workspace_name: string }>;
  // Called after any nav item is tapped — used by the mobile overlay
  // wrapper to auto-close the drawer after navigation.
  onNavClick?: () => void;
  // True when the active member has a non-null
  // workspace_members.google_tasks_refresh_token. Drives the small
  // "Connect Google Tasks" affordance / "✓ connected" line above
  // the Sign out button. Optional — undefined treated as "not connected".
  googleTasksConnected?: boolean;
}

const ADMIN_EMAIL = 'rglassberg@saracademy.org';
// All users go to /home by default

export default function Sidebar({
  user,
  activeNav,
  setActiveNav,
  role,
  isSuperAdmin = false,
  allowedModules,
  effectiveModules,
  workspaceId,
  workspaces,
  switchWorkspace,
  signOut,
  unreadCount,
  emilyQueueCount,
  assistant,
  onCompose,
  mounted,
  impersonating,
  startImpersonation,
  stopImpersonation,
  allMembers,
  onNavClick,
  googleTasksConnected = false,
}: SidebarProps) {
  // Super-admin (Becca) — primary signal is is_super_admin; ADMIN_EMAIL kept
  // only as a transitional fallback for the super-admin's own account.
  const isRealAdmin = isSuperAdmin || user?.email?.toLowerCase() === ADMIN_EMAIL;
  // isAdmin: true only for the super-admin AND not impersonating someone else
  const isAdmin = isRealAdmin && !impersonating;
  const pathname = usePathname();
  const router = useRouter();
  const isOnDashboard = pathname === '/';
  const isViewer = role === 'viewer';

  const effectiveEmail = (impersonating?.email || user?.email || '').toLowerCase();
  const shouldRedirectHome = true; // All users go to /home

  // Route-aware nav handler: if not on Dashboard, navigate via URL params.
  // Always fires onNavClick so the mobile overlay wrapper can close itself.
  const handleNav = (navKey: string) => {
    if (isOnDashboard) {
      setActiveNav(navKey);
    } else {
      router.push(`/?nav=${navKey}`);
    }
    onNavClick?.();
  };

  console.log('[SIDEBAR DIAG] effective role:', role, 'allowedModules:', allowedModules, 'effectiveModules:', effectiveModules, 'impersonating:', impersonating?.email || null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('sidebarCollapsed') || '{"Academics": true, "Community": true}'); } catch { return { Academics: true, Community: true }; }
    }
    return { Academics: true, Community: true };
  });

  const toggleSection = (section: string) => {
    const next = { ...sidebarCollapsed, [section]: !sidebarCollapsed[section] };
    setSidebarCollapsed(next);
    localStorage.setItem('sidebarCollapsed', JSON.stringify(next));
  };

  return (
    <aside className="relative w-64 h-full bg-slate-900 text-white flex flex-col border-r border-slate-700/50 flex-shrink-0 print:hidden">
      {/* Mobile-only close button — desktop has no overlay drawer so this
          is hidden at md+. Wired to onNavClick because it's the same close
          callback the drawer wrapper passes in from Dashboard. */}
      {onNavClick && (
        <button
          className="md:hidden absolute top-3 right-3 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
          onClick={onNavClick}
          aria-label="Close navigation"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Logo */}
      <div className="px-6 pt-6 pb-5 border-b border-slate-800">
        <div className="flex flex-col min-w-0">
          <h1 className="text-white font-semibold text-lg whitespace-nowrap">Command Center</h1>
          <p className="text-slate-400 text-xs">by Lhasa</p>
          {mounted && workspaces.find(w => w.id === workspaceId)?.name && (
            <p className="text-slate-500 text-xs mt-1.5 truncate">{workspaces.find(w => w.id === workspaceId)?.name}</p>
          )}
          <p className="text-slate-500 text-xs mt-0.5">{format(new Date(), 'EEEE, MMM d')}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {/* Home — all users */}
        {shouldRedirectHome && (
          <div className="space-y-0.5">
            <button
              onClick={() => { router.push('/home'); onNavClick?.(); }}
              className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === '/home'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </button>
            {/* Home sub-items — power users only (home module) */}
            {effectiveModules?.home !== false && !isViewer && (
              <div className="space-y-0">
                <button
                  onClick={() => { onNavClick?.(); window.location.href = '/home?tab=announcements'; }}
                  className="w-full pl-8 text-xs text-slate-500 hover:text-slate-300 py-1 flex items-center gap-1.5 transition-colors"
                >
                  <span className="w-1 h-1 rounded-full bg-slate-600" />
                  Daily Announcements
                </button>
                <a
                  href="https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full pl-8 text-xs text-slate-500 hover:text-slate-300 py-1 flex items-center gap-1.5 transition-colors"
                >
                  <span className="w-1 h-1 rounded-full bg-slate-600" />
                  Today&apos;s Folder
                  <svg className="w-3 h-3 ml-auto mr-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}

        {/* Daily */}
        {!(role === 'viewer' && allowedModules) && <div>
          <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase px-3 mb-2">Daily</p>
          <div className="space-y-0.5">
            {([
              ...(!shouldRedirectHome ? [{ id: 'dashboard' as const, label: 'Dashboard', icon: (
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              )}] : []),
              { id: 'inbox', label: 'All Emails', icon: (
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              )},
              { id: 'agenda', label: 'Meeting Agenda', icon: (
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              )},
              { id: 'tasks', label: 'Tasks', icon: (
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              )},
              ...(shouldRedirectHome ? [
                { id: 'gemara' as const, label: 'Gemara', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                )},
                { id: 'communications' as const, label: 'Communications', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                )},
              ] : []),
            ] as { id: string; label: string; icon: React.ReactNode }[]).map((item) => (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeNav === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
                {item.label}
                {item.id === 'inbox' && unreadCount > 0 && (
                  <span className="ml-auto bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
            {/* Compose */}
            {onCompose && (
              <button
                onClick={() => { onCompose(); onNavClick?.(); }}
                className="w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Compose
              </button>
            )}
          </div>
        </div>}

        {/* Tasks — always available, even to viewers whose full Daily
            section is hidden above. Ensures every workspace member can
            reach their "Needs Your Reply" @Notify tasks. */}
        {(role === 'viewer' && allowedModules) && (
          <div>
            <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase px-3 mb-2">Daily</p>
            <div className="space-y-0.5">
              <button
                onClick={() => handleNav('tasks')}
                className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeNav === 'tasks'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Tasks
              </button>
            </div>
          </div>
        )}

        {/* Academics */}
        {(effectiveModules?.absences !== false || effectiveModules?.admissions !== false || effectiveModules?.after_school !== false) && <div>
          <button
            onClick={() => toggleSection('Academics')}
            className="flex items-center gap-1 px-3 mb-2 mt-1 w-full group"
          >
            <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">Academics</p>
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${sidebarCollapsed.Academics ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!sidebarCollapsed.Academics && (
            <div className="space-y-0.5">
              {([
                { id: 'absences', label: 'Student Absences', moduleKey: 'absences', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )},
                { id: 'after_school', label: 'After School Programs', moduleKey: 'after_school', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.247m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.247" />
                  </svg>
                )},
                // Student Logs is role-gated (owner/assistant only) rather
                // than module-gated. moduleKey is kept for the filter type
                // shape; the requiredRoles array is the operative gate.
                { id: 'student-logs', label: 'Student Logs', moduleKey: 'absences', requiredRoles: ['owner', 'assistant'], icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )},
                { id: 'admissions', label: 'Admissions & Enrollment', moduleKey: 'admissions', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
                  </svg>
                )},
              ] as { id: string; label: string; moduleKey: string; requiredRoles?: string[]; icon: React.ReactNode }[])
                .filter(item => effectiveModules?.[item.moduleKey] !== false)
                .filter(item => !item.requiredRoles || (role != null && item.requiredRoles.includes(role)))
                .map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeNav === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>}

        {/* Community */}
        {effectiveModules?.simchas !== false && <div>
          <button
            onClick={() => toggleSection('Community')}
            className="flex items-center gap-1 px-3 mb-2 mt-1 w-full group"
          >
            <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">Community</p>
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${sidebarCollapsed.Community ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!sidebarCollapsed.Community && (
            <div className="space-y-0.5">
              <button
                onClick={() => handleNav('simchas')}
                className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeNav === 'simchas'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                Simchas & Shivas
              </button>
            </div>
          )}
        </div>}

        {/* Operations — hidden for viewers UNLESS they have at least one operations module */}
        {(!(role === 'viewer' && allowedModules) || effectiveModules?.projects !== false || effectiveModules?.development !== false || effectiveModules?.lever !== false) && <div>
          <button
            onClick={() => toggleSection('Operations')}
            className="flex items-center gap-1 px-3 mb-2 mt-1 w-full group"
          >
            <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">Operations</p>
            <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${sidebarCollapsed.Operations ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!sidebarCollapsed.Operations && (
            <div className="space-y-0.5">
              {([
                { id: 'projects', label: 'Projects', moduleKey: 'projects', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                )},
                { id: 'lever', label: 'Recruiting', moduleKey: 'lever', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                )},
                { id: 'development', label: 'Development', moduleKey: 'development', icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )},
                // Assistant's Queue — only emitted when the current user
                // has an assistant configured and isn't a viewer-role.
                ...(!isViewer && assistant?.displayName ? [{ id: 'emily', label: `${assistant.displayName}'s Queue`, icon: (
                  <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}] : []),
              ] as { id: string; label: string; moduleKey?: string; icon: React.ReactNode }[]).filter(item => !item.moduleKey || effectiveModules?.[item.moduleKey] !== false).map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeNav === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                  {item.id === 'emily' && emilyQueueCount > 0 && (
                    <span className="ml-auto bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">
                      {emilyQueueCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>}
      </nav>

      {/* Admin section — Becca only */}
      {isAdmin && (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase px-3 mb-2 mt-1">Admin</p>
          <button
            onClick={() => { onNavClick?.(); window.location.href = '/admin/permissions'; }}
            className={`w-full flex items-center gap-3.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeNav === 'admin-permissions'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="size-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Permissions
          </button>
        </div>
      )}

      {/* Workspace switcher / Impersonation + User */}
      {user && (
        <div className="px-3 py-4 border-t border-slate-700">
          {/* Admin impersonation dropdown */}
          {mounted && isRealAdmin && allMembers && allMembers.length > 0 && startImpersonation && stopImpersonation && (
            <div className="mb-3">
              <select
                value={impersonating ? `${impersonating.email}|${impersonating.workspace_id}` : ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    stopImpersonation();
                  } else {
                    const member = allMembers.find(m => `${m.email}|${m.workspace_id}` === e.target.value);
                    if (member) {
                      startImpersonation({
                        email: member.email,
                        display_name: member.display_name || member.email.split('@')[0],
                        role: member.role,
                        workspace_id: member.workspace_id,
                        workspace_name: member.workspace_name,
                      });
                    }
                  }
                }}
                className="w-full bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:border-slate-500 cursor-pointer"
              >
                <option value="">— No impersonation (myself) —</option>
                {allMembers.map((m, idx) => (
                  <option key={`${m.email}-${m.workspace_id}-${idx}`} value={`${m.email}|${m.workspace_id}`}>
                    {m.display_name || m.email.split('@')[0]} · {m.role} · {m.workspace_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Standard workspace switcher — non-admin users with multiple workspaces */}
          {mounted && !isAdmin && workspaces.length > 1 && role !== 'viewer' && (
            <div className="mb-3">
              <select
                value={workspaceId || ''}
                onChange={(e) => switchWorkspace(e.target.value)}
                className="w-full bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:border-slate-500 cursor-pointer"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} ({ws.role})
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Google Tasks connect / connected row. Sits above the user
              avatar block, separated by a thin divider, so the Sign out
              affordance below stays exactly where it was. Rendered for
              all authenticated users — Tasks integration is per-member,
              not module-gated. */}
          <div className="border-t border-slate-800/70 pt-3 mb-3">
            {googleTasksConnected ? (
              <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Google Tasks connected
              </p>
            ) : (
              <a
                href="/api/google-tasks-auth"
                className="text-xs text-slate-500 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Connect Google Tasks
              </a>
            )}
          </div>
          <div className="flex items-center gap-3">
            {user.photoURL && (
              <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
              <button onClick={() => signOut()} className="text-xs text-slate-500 hover:text-white transition-colors">Sign out</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
