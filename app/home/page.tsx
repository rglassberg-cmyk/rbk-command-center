'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useWorkspace } from '../components/AuthProvider';
import Sidebar from '../components/Sidebar';
import WelcomeHeader from '../components/home/WelcomeHeader';
import TodayHero from '../components/home/TodayHero';
import type { HomeProject } from '../components/home/TodayHero';
import MyProjectsList from '../components/home/MyProjectsList';
import DashboardsGrid from '../components/home/DashboardsGrid';
import type { Dashboard } from '../components/home/DashboardsGrid';
import TodayScheduleCard from '../components/home/TodayScheduleCard';
import TodayTasksCard from '../components/home/TodayTasksCard';
import ThisWeekCard from '../components/home/ThisWeekCard';
import { apiFetch } from '@/lib/apiFetch';

const POWER_USERS = ['kraussb@saracademy.org', 'egray@saracademy.org'];
const NAME_OVERRIDES: Record<string, string> = { 'kraussb@saracademy.org': 'Bini' };
const GDOC_PREVIEW_URL = 'https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/preview';
const TODAYS_FOLDER_URL = 'https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link';

export default function HomePage() {
  const router = useRouter();
  const { user, signOut, loading: authLoading } = useAuth();
  const { workspaceId, role, modules, allowedModules, effectiveModules, workspaces, switchWorkspace, impersonating, startImpersonation, stopImpersonation, assistant, googleTasksConnected } = useWorkspace();

  const [mounted, setMounted] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mobile sidebar drawer state. Same pattern as Dashboard.tsx.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [homeTab, setHomeTab] = useState<'home' | 'announcements'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'announcements') return 'announcements';
    }
    return 'home';
  });

  // Data state
  const [firstName, setFirstName] = useState('');
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);

  useEffect(() => {
    setMounted(true);
    // Check ?tab= param on mount (e.g. sidebar sub-item click navigating to /home?tab=announcements)
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'announcements') {
      setHomeTab('announcements');
    }
  }, []);

  // Admin: fetch all workspace members for impersonation dropdown
  const [allMembers, setAllMembers] = useState<Array<{ email: string; display_name: string | null; role: string; workspace_id: string; workspace_name: string }>>([]);
  useEffect(() => {
    if (user?.email?.toLowerCase() !== 'rglassberg@saracademy.org') return;
    fetch('/api/admin/workspace-members')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.members) setAllMembers(data.members); })
      .catch(() => {});
  }, [user?.email]);

  // Fetch data from APIs
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const homeRes = await apiFetch('/api/home');

      if (!homeRes.ok) throw new Error('Failed to load home data');

      const homeData = await homeRes.json();
      setFirstName(homeData.firstName || '');
      setProjects(homeData.projects || []);
      setDashboards(homeData.dashboards || []);
    } catch (err) {
      console.error('Home fetch error:', err);
      setError('Failed to load home data');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && user && workspaceId) {
      fetchData();
    }
  }, [authLoading, user, workspaceId, fetchData]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Handle nav from sidebar — redirect to Dashboard for non-home navs
  const handleSetActiveNav = (nav: string) => {
    if (nav === 'home') {
      setActiveNav('home');
    } else {
      router.push(`/?nav=${nav}`);
    }
  };

  const handleOpenProject = (projectId: string) => {
    router.push(`/?nav=projects&projectPanel=${projectId}`);
  };

  const handleOpenDashboard = (dashboardId: string) => {
    router.push(`/?nav=${dashboardId}`);
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <svg className="w-8 h-8 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // Compute hero project IDs for excluding from main list
  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  const weekStr = weekFromNow.toISOString().split('T')[0];
  const oneDayAgo = Date.now() - 86400000;
  const heroProjectIds = projects
    .filter(p => {
      if (p.status !== 'active') return false;
      const dueSoon = p.due_date && p.due_date <= weekStr;
      const recentlyUpdated = p.updated_at && new Date(p.updated_at).getTime() > oneDayAgo;
      return dueSoon || recentlyUpdated;
    })
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    })
    .slice(0, 2)
    .map(p => p.id);
  const todayHeroVisible = heroProjectIds.length > 0;

  const effectiveEmail = (impersonating?.email || user.email || '').toLowerCase();
  const isPowerUser = POWER_USERS.includes(effectiveEmail);
  const displayFirstName = NAME_OVERRIDES[effectiveEmail] || firstName;

  return (
    <div className="min-h-screen flex bg-stone-50">
      {/* Mobile backdrop — fades in behind the sidebar drawer */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed-overlay drawer below md, in-flow column at md+ */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-out md:static md:translate-x-0 md:transition-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <Sidebar
          user={user}
          activeNav={activeNav}
          setActiveNav={handleSetActiveNav}
          role={role}
          allowedModules={allowedModules}
          effectiveModules={effectiveModules}
          workspaceId={workspaceId}
          workspaces={workspaces}
          switchWorkspace={switchWorkspace}
          signOut={signOut}
          unreadCount={0}
          emilyQueueCount={0}
          assistant={assistant}
          mounted={mounted}
          impersonating={impersonating}
          startImpersonation={startImpersonation}
          stopImpersonation={stopImpersonation}
          allMembers={allMembers}
          onNavClick={() => setSidebarOpen(false)}
          googleTasksConnected={googleTasksConnected}
        />
      </div>

      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile sticky header — hamburger + page name */}
        <div className="md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-lg text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-medium text-slate-800 text-sm capitalize truncate px-2">Home</span>
          <div className="w-9" aria-hidden="true" />
        </div>

        <div className="w-full px-4 md:px-8 lg:px-12 2xl:pr-16 pt-4 md:pt-14 pb-24">
          {/* Error banner */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <span className="text-red-700 text-sm">Couldn&apos;t load your home. Try refreshing.</span>
              <button
                onClick={() => fetchData()}
                className="text-red-600 text-sm font-medium hover:text-red-800"
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            /* Loading skeleton */
            <div className="animate-pulse">
              <div className="flex justify-between items-baseline pb-5 mb-10" style={{ borderBottom: '1px solid #e8edf3' }}>
                <div className="h-7 bg-slate-200 rounded w-64" />
                <div className="h-4 bg-slate-100 rounded w-40" />
              </div>
              <div className="mb-10">
                <div className="h-5 bg-slate-200 rounded w-32 mb-4" />
                <div className="bg-white rounded-lg" style={{ border: '1px solid #e2e8f0' }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-4 p-4" style={{ borderBottom: i < 3 ? '1px solid #f1f5f9' : undefined }}>
                      <div className="w-7 h-7 rounded-full bg-slate-100" />
                      <div className="flex-1">
                        <div className="h-4 bg-slate-200 rounded w-48 mb-2" />
                        <div className="h-3 bg-slate-100 rounded w-72" />
                      </div>
                      <div className="h-4 bg-slate-100 rounded w-16" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-7 mb-10">
                <div className="h-5 bg-slate-200 rounded w-28 mb-4" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-white rounded-lg p-4" style={{ border: '1px solid #e2e8f0' }}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-slate-100" />
                        <div className="h-4 bg-slate-200 rounded w-24" />
                      </div>
                      <div className="h-3 bg-slate-100 rounded w-full mt-3" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <WelcomeHeader firstName={displayFirstName} />

              {/* Sub-tabs for power users */}
              {isPowerUser && (
                <div className="flex items-center gap-4 sm:gap-6 mb-8 border-b border-slate-200 overflow-x-auto">
                  <button
                    onClick={() => setHomeTab('home')}
                    className={`pb-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      homeTab === 'home'
                        ? 'font-semibold border-b-2 text-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    style={homeTab === 'home' ? { borderBottomColor: '#1B3A6B' } : undefined}
                  >
                    Home
                  </button>
                  <button
                    onClick={() => setHomeTab('announcements')}
                    className={`pb-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      homeTab === 'announcements'
                        ? 'font-semibold border-b-2 text-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    style={homeTab === 'announcements' ? { borderBottomColor: '#1B3A6B' } : undefined}
                  >
                    Daily Announcements
                  </button>
                  <a
                    href={TODAYS_FOLDER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 pb-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors whitespace-nowrap"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Today&apos;s Folder
                  </a>
                </div>
              )}

              {/* Tab content */}
              {homeTab === 'announcements' && isPowerUser ? (
                /* Daily Announcements tab — full-width Google Doc embed */
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
                  <div className="flex items-center justify-between px-6 pt-5 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-1 h-5 rounded-full" style={{ backgroundColor: '#7AB648' }} />
                      <svg className="w-5 h-5" style={{ color: '#1B3A6B' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <h3 className="font-bold uppercase tracking-wide" style={{ fontSize: 13, color: '#1B3A6B' }}>Daily Announcements</h3>
                    </div>
                    <a
                      href={TODAYS_FOLDER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Today&apos;s Folder
                    </a>
                  </div>
                  <div className="px-6 pb-5">
                    <iframe
                      src={GDOC_PREVIEW_URL}
                      className="w-full border-0 rounded-lg h-[600px]"
                      loading="lazy"
                      title="Daily Announcements"
                    />
                  </div>
                </div>
              ) : (
                /* Home tab — main content */
                <>
                  {/* Top row: 2 columns at md+ (This Week + Today's Schedule),
                      single column on mobile. Today's Tasks lives full-width
                      below for power users — Tasks was previously a 3rd column
                      on xl+ which crowded This Week. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 items-stretch">
                    <ThisWeekCard />
                    <div className="min-h-0">
                      <TodayScheduleCard />
                    </div>
                  </div>
                  {isPowerUser && (
                    <div className="mb-8">
                      <TodayTasksCard effectiveEmail={effectiveEmail} />
                    </div>
                  )}

                  <TodayHero projects={projects} onOpenProject={handleOpenProject} />
                  <MyProjectsList
                    projects={projects}
                    todayHeroVisible={todayHeroVisible}
                    heroProjectIds={heroProjectIds}
                    onOpenProject={handleOpenProject}
                  />
                  <DashboardsGrid
                    dashboards={dashboards}
                    onOpenDashboard={handleOpenDashboard}
                  />
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
