'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useWorkspace } from '../../components/AuthProvider';
import Sidebar from '../../components/Sidebar';
import { TESTING_FEATURES } from '@/lib/testingFeatures';

const ADMIN_EMAIL = 'rglassberg@saracademy.org';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Member {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  workspace_id: string;
  workspace_name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allowed_modules: Record<string, any> | null;
  divisions: string[];
  title: string | null;
  assignee_key: string | null;
  slack_user_id: string | null;
  // The workspace_members.id of the person THIS member assists. The
  // "X's assistant" relationship is the inverse: find the row whose
  // assistant_to === X.id.
  assistant_to: string | null;
  // Sprint 5: per-user opt-in flags for in-development features. See
  // lib/testingFeatures.ts for the registry.
  testing_features: string[];
}

const DASHBOARD_COLUMNS = [
  { key: 'admissions', label: 'Admissions' },
  { key: 'absences', label: 'Absences' },
  { key: 'after_school', label: 'After School' },
  { key: 'lever', label: 'Recruiting' },
  { key: 'faculty_absences', label: 'Faculty Attendance' },
  { key: 'simchas', label: 'Simchas' },
  { key: 'projects', label: 'Projects' },
  { key: 'development', label: 'Development' },
] as const;

// Full module enumeration used by the Add User form. Superset of
// DASHBOARD_COLUMNS — the table view keeps a tight 7-column layout, but
// admins can grant access to any module here on user creation. Keys here
// match workspaces.modules and the Sidebar's moduleKey references.
const ALL_MODULE_OPTIONS: { key: string; label: string }[] = [
  { key: 'admissions',       label: 'Admissions & Enrollment' },
  { key: 'absences',         label: 'Student Absences' },
  { key: 'after_school',     label: 'After School Programs' },
  { key: 'faculty_absences', label: 'Faculty Attendance' },
  { key: 'projects',         label: 'Projects' },
  { key: 'lever',            label: 'Recruiting' },
  { key: 'development',      label: 'Development (incl. Guardian Circle)' },
  { key: 'simchas',          label: 'Simchas & Shivas' },
  { key: 'communications',   label: 'Communications' },
  { key: 'gemara',           label: 'Gemara' },
  { key: 'agenda',           label: 'Meeting Agenda' },
  { key: 'tasks',            label: 'Tasks' },
  { key: 'calendar',         label: 'Calendar' },
  { key: 'home',             label: 'Home page' },
];

// Categorized module catalog for the redesigned Users tab (By User detail
// panel + By Module grid). Covers EVERY key in ALL_MODULE_OPTIONS plus
// `student_logs` (per spec — not in ALL_MODULE_OPTIONS; the sidebar gates
// Student Logs by role today, but it's surfaced here as a toggle for
// completeness/future use). `communications` lives in ALL_MODULE_OPTIONS
// but wasn't in the spec's category list — placed under OPERATIONS so no
// module is dropped.
type ModuleCategory = 'SCHOOL' | 'OPERATIONS' | 'COMMUNITY' | 'CORE';
const MODULE_CATALOG: { key: string; label: string; category: ModuleCategory; description: string }[] = [
  { key: 'absences',         label: 'Student Absences',       category: 'SCHOOL',     description: 'Daily attendance — absences, tardies, and early dismissals by grade.' },
  { key: 'faculty_absences', label: 'Faculty Absences',       category: 'SCHOOL',     description: 'Faculty and staff attendance tracking.' },
  { key: 'admissions',       label: 'Admissions',             category: 'SCHOOL',     description: 'Applications, enrollment projection, and re-enrollment.' },
  { key: 'after_school',     label: 'After School',           category: 'SCHOOL',     description: 'After-school program registration and enrollment.' },
  { key: 'student_logs',     label: 'Student Logs',           category: 'SCHOOL',     description: 'Weekly behavior log summary from Veracross.' },
  { key: 'development',      label: 'Development',             category: 'OPERATIONS', description: 'Fundraising — gifts, campaigns, Guardian Circle, Cooper & Israel funds.' },
  { key: 'lever',            label: 'Recruiting',             category: 'OPERATIONS', description: 'Lever recruiting pipeline and candidate tracking.' },
  { key: 'projects',         label: 'Projects',               category: 'OPERATIONS', description: 'Cross-department kanban project board.' },
  { key: 'communications',   label: 'Communications',         category: 'OPERATIONS', description: 'Monday.com approvals queue and social media links.' },
  { key: 'simchas',          label: 'Simchas & Shivas',       category: 'COMMUNITY',  description: "B'nei mitzvahs, shivas, and condolence note tracking." },
  { key: 'home',             label: 'Home',                   category: 'CORE',       description: 'Personal home landing page with schedule and projects.' },
  { key: 'tasks',            label: 'Tasks',                  category: 'CORE',       description: 'Shared task board across the workspace.' },
  { key: 'agenda',           label: 'Meeting Agenda',         category: 'CORE',       description: 'Meeting agenda items and threaded notes.' },
  { key: 'calendar',         label: 'Calendar',               category: 'CORE',       description: 'Google Calendar integration.' },
  { key: 'gemara',           label: 'Gemara',                 category: 'CORE',       description: 'Gemara class resource board.' },
];
const CATEGORY_ORDER: ModuleCategory[] = ['SCHOOL', 'OPERATIONS', 'COMMUNITY', 'CORE'];
// Display labels for the category headers/badges. Internal keys stay
// SCHOOL/OPERATIONS/COMMUNITY/CORE; these are what the UI shows.
const CATEGORY_LABEL: Record<ModuleCategory, string> = {
  SCHOOL:     'Academics',
  OPERATIONS: 'Operations',
  COMMUNITY:  'Community',
  CORE:       'Productivity',
};
const CATEGORY_BADGE: Record<ModuleCategory, string> = {
  SCHOOL:     'bg-blue-50 text-blue-700',
  OPERATIONS: 'bg-emerald-50 text-emerald-700',
  COMMUNITY:  'bg-pink-50 text-pink-700',
  CORE:       'bg-slate-100 text-slate-600',
};
function roleAvatarBg(role: string): string {
  if (role === 'owner') return 'bg-blue-500';
  if (role === 'assistant') return 'bg-purple-500';
  return 'bg-slate-400';
}
function memberDisplayName(m: { display_name: string | null; email: string }): string {
  return m.display_name || m.email.split('@')[0];
}

const VALID_ROLES = ['owner', 'assistant', 'viewer'] as const;

const DIVISION_OPTIONS: { value: 'academy' | 'hs'; label: string }[] = [
  { value: 'academy', label: 'Academy (ELC / LS / MS)' },
  { value: 'hs',      label: 'High School' },
];

// Integration cards for the Integrations tab. Phase F made the four
// API-key-based ones (veracross, slack, lever, anthropic) functional
// via workspace_integrations DB rows. Gmail + Calendar use the
// existing Google OAuth flow (user_google_tokens). Rise Vision stays
// "Coming soon" for Phase G.
type IntegrationCard = { key: string; name: string; icon: React.ReactNode };
const INTEGRATION_CARDS: IntegrationCard[] = [
  { key: 'veracross', name: 'Veracross',         icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" /></svg>) },
  { key: 'gmail',     name: 'Gmail',             icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>) },
  { key: 'calendar',  name: 'Google Calendar',   icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>) },
  { key: 'slack',     name: 'Slack',             icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" /></svg>) },
  { key: 'lever',     name: 'Lever',             icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M5 7h14l-1 14H6L5 7z" /></svg>) },
  { key: 'anthropic', name: 'Anthropic (Claude)', icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.5 4l-5 16M14.5 4l5 16M7 14h10" /></svg>) },
  { key: 'rise',      name: 'Rise Vision',       icon: (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" strokeLinecap="round" /></svg>) },
];

// Field config for each API-key integration. Determines what inputs
// to render in the Configure form. Passwords show as "••• Already
// configured — enter new value to update" when hasCredentials=true.
const INTEGRATION_FIELDS: Record<string, Array<{ key: string; label: string; type: 'text' | 'password'; placeholder?: string }>> = {
  veracross: [
    { key: 'schoolCode', label: 'School Code', type: 'text', placeholder: 'e.g. sar' },
    { key: 'clientId', label: 'General Client ID', type: 'password' },
    { key: 'clientSecret', label: 'General Client Secret', type: 'password' },
    { key: 'admissionsClientId', label: 'Admissions Client ID', type: 'password' },
    { key: 'admissionsClientSecret', label: 'Admissions Client Secret', type: 'password' },
  ],
  slack: [
    { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
  ],
  lever: [
    { key: 'apiKey', label: 'API Key', type: 'password' },
  ],
  anthropic: [
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
  ],
};

interface IntegrationStatus {
  integration_type: string;
  is_active: boolean;
  connected_at: string;
  connected_by: string | null;
  updated_at: string;
  hasCredentials: boolean;
  fields: Record<string, boolean>;
}

interface SubPermission {
  key: string;
  label: string;
  description: string;
}

const SUB_PERMISSIONS: Record<string, SubPermission[]> = {
  admissions: [
    { key: 'edit_enrollment_budget', label: 'Edit Enrollment Budget', description: 'Can edit the budgeted enrollment numbers per grade' },
    { key: 'edit_enrollment_data', label: 'Edit Enrollment Data', description: 'Can modify enrollment projection data' },
  ],
  lever: [
    { key: 'offer_approvals', label: 'Offer Approvals', description: 'See and act on offer approval requests' },
  ],
  development: [
    { key: 'cooper_fund', label: 'Cooper Fund', description: 'Access to Cooper Fund data' },
    { key: 'israel_fund', label: 'Israel Fund', description: 'Access to Israel Fund Management' },
    { key: 'israel_fund_editor', label: 'Israel Fund Editor', description: 'Can add, edit, and hide grant records on the Israel Fund page' },
  ],
  home: [
    { key: 'daily_announcements', label: 'Daily Announcements', description: 'See the Daily Announcements tab' },
    { key: 'todays_schedule', label: "Today's Schedule", description: "See Today's Schedule card" },
    { key: 'todays_tasks', label: "Today's Tasks", description: "See Today's Tasks card" },
  ],
};

// Check if a module is enabled (supports both boolean and object formats)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isModEnabled(modules: Record<string, any> | null, key: string): boolean {
  if (!modules) return false;
  const val = modules[key];
  if (val === true) return true;
  if (typeof val === 'object' && val?.enabled) return true;
  return false;
}

type TabKey = 'users' | 'school' | 'integrations' | 'feature-flags' | 'morning-briefings';

interface BriefingResultRow {
  userId: string;
  name: string;
  email: string;
  slackUserId: string;
  kind: 'briefing' | 'onboarding' | 'skipped';
  message: string;
  moduleDataSummary: Record<string, unknown>;
  calendarEventCount: number;
  taskCount: number;
  preferencesUsed?: string;
  onboardingJustSent: boolean;
  error?: string;
}

interface OnboardingRow {
  email: string;
  display_name: string | null;
  onboarding_sent_at: string | null;
  onboarding_complete: boolean;
  preferences_summary: string | null;
}

interface FeatureFlagRow {
  key: string;
  module: string;
  label: string;
  description: string;
  isLive: boolean;
}

// Pill background colors for the MODULE column on the Feature Flags
// tab. Matches existing accent conventions across the app — green for
// development, blue for admissions, etc. Falls back to slate so an
// unknown module key still renders cleanly.
const MODULE_PILL: Record<string, string> = {
  development: 'bg-green-50 text-green-700',
  admissions:  'bg-blue-50 text-blue-700',
  absences:    'bg-amber-50 text-amber-700',
  lever:       'bg-purple-50 text-purple-700',
  simchas:     'bg-pink-50 text-pink-700',
  projects:    'bg-indigo-50 text-indigo-700',
  home:        'bg-slate-50 text-slate-700',
};

export default function PermissionsPage() {
  const router = useRouter();
  const { user, signOut, loading: authLoading } = useAuth();
  const { workspaceId, role, allowedModules, effectiveModules, workspaces, switchWorkspace, impersonating, startImpersonation, stopImpersonation, assistant } = useWorkspace();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('users');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [expandedSub, setExpandedSub] = useState<string | null>(null); // "memberId:moduleKey"
  // Per-member testing-section collapsed state. Defaults to closed —
  // Becca opens it explicitly when granting/revoking preview access.
  const [testingExpandedMembers, setTestingExpandedMembers] = useState<Set<string>>(new Set());
  // Feature Flags tab state.
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagRow[]>([]);
  const [featureFlagsLoading, setFeatureFlagsLoading] = useState(false);
  // Confirm dialog for "Promote to Live". Tracks the feature key being
  // promoted so we can render a one-step confirm before the PATCH.
  const [confirmPromoteKey, setConfirmPromoteKey] = useState<string | null>(null);

  // Morning Briefings tab state.
  const [briefingSubTab, setBriefingSubTab] = useState<'briefings' | 'onboarding'>('briefings');
  const [briefings, setBriefings] = useState<BriefingResultRow[]>([]);
  const [briefingsLoading, setBriefingsLoading] = useState(false);
  const [briefingDryRunConstant, setBriefingDryRunConstant] = useState<boolean | null>(null);
  const [briefingBotName, setBriefingBotName] = useState<string>('Buzz');
  const [onboardingRows, setOnboardingRows] = useState<OnboardingRow[]>([]);
  const [onboardingLoading, setOnboardingLoading] = useState(false);

  // Redesigned Users tab: By User / By Module sub-tabs + shared search +
  // selected-row state for the detail panels.
  const [usersSubTab, setUsersSubTab] = useState<'by-user' | 'by-module'>('by-user');
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedModuleKey, setSelectedModuleKey] = useState<string | null>(null);

  // Add User form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addDisplayName, setAddDisplayName] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addRole, setAddRole] = useState<'owner' | 'assistant' | 'viewer'>('viewer');
  // Tasks defaults ON for new viewers — everyone needs the Tasks page to
  // see their @Notify "Needs Your Reply" items. Admin can still uncheck it.
  const [addModules, setAddModules] = useState<Record<string, boolean>>({ tasks: true });
  const [addDivisions, setAddDivisions] = useState<string[]>([]);
  const [addSaving, setAddSaving] = useState(false);
  // Remove flow state — id of the row currently being deleted (for spinner).
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Inline role edit
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  // Inline display-name edit
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  // Inline title edit
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  // Assistant picker dropdown — `openAssistantId` is the principal row
  // whose dropdown is currently open. The dropdown lists other workspace
  // members with assignee_key; selecting one writes to that other row's
  // assistant_to (NOT to this row), clearing any prior assistant first.
  const [openAssistantId, setOpenAssistantId] = useState<string | null>(null);

  // School Settings tab state
  const [schoolName, setSchoolName] = useState('');
  const [editingSchoolName, setEditingSchoolName] = useState(false);
  const [schoolNameDraft, setSchoolNameDraft] = useState('');
  const [schoolNameSaving, setSchoolNameSaving] = useState(false);

  // Integrations tab state — Phase F
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [openConfigKey, setOpenConfigKey] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!authLoading && user) {
      if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
        router.replace('/home');
      }
    }
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [authLoading, user, router]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/workspace-members');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const sorted = (data.members || []).sort((a: Member, b: Member) => {
        const wsA = a.workspace_name.toLowerCase();
        const wsB = b.workspace_name.toLowerCase();
        if (wsA !== wsB) return wsA.localeCompare(wsB);
        const nameA = (a.display_name || a.email.split('@')[0]).toLowerCase();
        const nameB = (b.display_name || b.email.split('@')[0]).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      setMembers(sorted);
    } catch {
      setError("Couldn't load members. Try refreshing.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && user && user.email?.toLowerCase() === ADMIN_EMAIL) {
      fetchMembers();
    }
  }, [authLoading, user, fetchMembers]);

  // Load integrations when the Integrations tab opens.
  useEffect(() => {
    if (activeTab !== 'integrations' || !workspaceId) return;
    let cancelled = false;
    (async () => {
      setIntegrationsLoading(true);
      try {
        const res = await fetch(`/api/admin/integrations?workspace_id=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setIntegrations(data.integrations || []);
        }
      } catch { /* ignore */ }
      if (!cancelled) setIntegrationsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeTab, workspaceId]);

  const migrateFromEnv = async () => {
    if (!workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm('Seed integration credentials from server environment variables? Idempotent — skips any integration that already has a DB row.')) return;
    try {
      const res = await fetch('/api/admin/integrations/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error('Migration failed');
      const data = await res.json();
      const inserted = (data.results || []).filter((r: { status: string }) => r.status === 'inserted').length;
      const skipped = (data.results || []).filter((r: { status: string }) => r.status === 'skipped_already_exists').length;
      const noEnv = (data.results || []).filter((r: { status: string }) => r.status === 'skipped_no_env').length;
      setToast({
        message: `Seeded ${inserted}; ${skipped} already existed; ${noEnv} had no env value.`,
        type: 'success',
      });
      await refreshIntegrations();
    } catch {
      setToast({ message: "Migration failed.", type: 'error' });
    }
  };

  const refreshIntegrations = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch(`/api/admin/integrations?workspace_id=${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
      }
    } catch { /* ignore */ }
  }, [workspaceId]);

  const saveIntegration = async (type: string) => {
    if (!workspaceId) return;
    // Only send non-empty values — backend merges + strips empty so
    // unchanged password fields keep their existing value.
    const credentials: Record<string, string> = {};
    for (const [k, v] of Object.entries(configForm)) {
      if (v && v.trim().length > 0) credentials[k] = v.trim();
    }
    if (Object.keys(credentials).length === 0) {
      setToast({ message: 'Nothing to save — fields are empty.', type: 'error' });
      return;
    }
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, integration_type: type, credentials }),
      });
      if (!res.ok) throw new Error('Save failed');
      setToast({ message: 'Integration saved', type: 'success' });
      setOpenConfigKey(null);
      setConfigForm({});
      await refreshIntegrations();
    } catch {
      setToast({ message: "Couldn't save integration.", type: 'error' });
    }
    setConfigSaving(false);
  };

  const testIntegration = async (type: string) => {
    if (!workspaceId) return;
    setTestingKey(type);
    setTestResults(prev => ({ ...prev, [type]: { ok: false } }));
    try {
      const res = await fetch('/api/admin/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, integration_type: type }),
      });
      const data = await res.json();
      setTestResults(prev => ({ ...prev, [type]: data }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [type]: { ok: false, error: err instanceof Error ? err.message : 'Network error' } }));
    }
    setTestingKey(null);
  };

  const disconnectIntegration = async (type: string) => {
    if (!workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm(`Disconnect ${type}? Existing data stays; new requests will fall back to environment variables until reconfigured.`)) return;
    try {
      const res = await fetch(`/api/admin/integrations?workspace_id=${workspaceId}&integration_type=${type}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Disconnect failed');
      setToast({ message: 'Disconnected', type: 'success' });
      await refreshIntegrations();
    } catch {
      setToast({ message: "Couldn't disconnect.", type: 'error' });
    }
  };

  // Load workspace name when School Settings tab is opened.
  useEffect(() => {
    if (activeTab !== 'school' || !workspaceId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/workspace?id=${workspaceId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.workspace?.name) setSchoolName(data.workspace.name);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [activeTab, workspaceId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.type === 'success' ? 2000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveModules = async (member: Member, newModules: Record<string, any>) => {
    const key = `${member.id}:save`;
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, allowed_modules: newModules } : m));
    setSavingKey(key);
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_modules: newModules }),
      });
      if (!res.ok) throw new Error('Failed');
      setToast({ message: 'Saved', type: 'success' });
      setSavedKey(key);
      setTimeout(() => setSavedKey(prev => prev === key ? null : prev), 1500);
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, allowed_modules: member.allowed_modules } : m));
      setToast({ message: "Couldn't update. Try again.", type: 'error' });
    }
    setSavingKey(prev => prev === key ? null : prev);
  };

  // Add User
  const resetAddForm = () => {
    setAddEmail('');
    setAddDisplayName('');
    setAddTitle('');
    setAddRole('viewer');
    setAddModules({ tasks: true });
    setAddDivisions([]);
    setShowAddForm(false);
  };

  const handleAddUser = async () => {
    const email = addEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setToast({ message: 'Enter a valid email address.', type: 'error' });
      return;
    }
    const displayName = addDisplayName.trim();
    const title = addTitle.trim();
    const payload: {
      email: string;
      role: string;
      allowed_modules: Record<string, boolean> | null;
      display_name?: string;
      title?: string;
      divisions?: string[];
    } = {
      email,
      role: addRole,
      allowed_modules: addRole === 'viewer' ? addModules : null,
      divisions: addDivisions,
    };
    if (displayName) payload.display_name = displayName;
    if (title) payload.title = title;
    setAddSaving(true);
    try {
      const res = await fetch('/api/admin/workspace-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Add failed');
      }
      const { member: newMember, already_existed } = await res.json();
      if (newMember) {
        setMembers(prev => {
          if (prev.some(m => m.id === newMember.id)) return prev;
          const wsName = workspaces.find(w => w.id === newMember.workspace_id)?.name || 'Unknown';
          return [...prev, { ...newMember, workspace_name: wsName, divisions: newMember.divisions ?? [], title: newMember.title ?? null }];
        });
      }
      setToast({
        message: already_existed
          ? 'User already exists in this workspace.'
          : `${email} added — they can log in via Google now.`,
        type: 'success',
      });
      resetAddForm();
    } catch (e) {
      setToast({ message: (e as Error).message || 'Add failed', type: 'error' });
    }
    setAddSaving(false);
  };

  // Update role inline
  const saveRole = async (member: Member, newRole: 'owner' | 'assistant' | 'viewer') => {
    if (newRole === member.role) { setEditingRoleId(null); return; }
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
    setEditingRoleId(null);
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error('Role update failed');
      setToast({ message: 'Role updated', type: 'success' });
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: member.role } : m));
      setToast({ message: "Couldn't update role. Try again.", type: 'error' });
    }
  };

  // Save inline-edited display name. Empty string → null so the
  // fallback `email.split('@')[0]` re-takes over.
  const saveDisplayName = async (member: Member, raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    setEditingNameId(null);
    if (next === (member.display_name ?? null)) return;
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, display_name: next } : m));
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: next }),
      });
      if (!res.ok) throw new Error('Name update failed');
      setToast({ message: 'Name updated', type: 'success' });
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, display_name: member.display_name } : m));
      setToast({ message: "Couldn't update name. Try again.", type: 'error' });
    }
  };

  // Save inline-edited title (same pattern as display_name).
  const saveTitle = async (member: Member, raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    setEditingTitleId(null);
    if (next === (member.title ?? null)) return;
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, title: next } : m));
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error('Title update failed');
      setToast({ message: 'Title updated', type: 'success' });
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, title: member.title } : m));
      setToast({ message: "Couldn't update title. Try again.", type: 'error' });
    }
  };

  // Set the assistant of `principal` to `newAssistantId` (or null). The
  // schema stores `assistant_to` on the assistant's row pointing at the
  // principal, so this PATCHes the assistant row(s) — not the principal.
  // Clears any prior assistant first to keep the relationship 1:1.
  const setMemberAssistant = async (principal: Member, newAssistantId: string | null) => {
    setOpenAssistantId(null);
    const currentAssistant = members.find(m => m.assistant_to === principal.id);
    if ((currentAssistant?.id ?? null) === newAssistantId) return;

    const prior = members;
    setMembers(prev => prev.map(m => {
      if (currentAssistant && m.id === currentAssistant.id) return { ...m, assistant_to: null };
      if (newAssistantId && m.id === newAssistantId) return { ...m, assistant_to: principal.id };
      return m;
    }));

    try {
      // Clear the previous assistant if it's not the same row we're about to set.
      if (currentAssistant && currentAssistant.id !== newAssistantId) {
        const clearRes = await fetch(`/api/admin/workspace-members/${currentAssistant.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assistant_to: null }),
        });
        if (!clearRes.ok) throw new Error('Failed to clear prior assistant');
      }
      if (newAssistantId) {
        const setRes = await fetch(`/api/admin/workspace-members/${newAssistantId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assistant_to: principal.id }),
        });
        if (!setRes.ok) throw new Error('Failed to set assistant');
      }
      setToast({ message: 'Assistant updated', type: 'success' });
    } catch {
      setMembers(prior);
      setToast({ message: "Couldn't update assistant. Try again.", type: 'error' });
    }
  };

  // Toggle a single division on/off for a member.
  const toggleDivision = async (member: Member, division: string) => {
    const current = member.divisions || [];
    const next = current.includes(division)
      ? current.filter(d => d !== division)
      : [...current, division];
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, divisions: next } : m));
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ divisions: next }),
      });
      if (!res.ok) throw new Error('Divisions update failed');
      setToast({ message: 'Divisions updated', type: 'success' });
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, divisions: current } : m));
      setToast({ message: "Couldn't update divisions. Try again.", type: 'error' });
    }
  };

  // Save school name (School Settings tab).
  const saveSchoolName = async () => {
    const trimmed = schoolNameDraft.trim();
    if (!trimmed || trimmed === schoolName) { setEditingSchoolName(false); return; }
    setSchoolNameSaving(true);
    try {
      const res = await fetch('/api/admin/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: workspaceId, name: trimmed }),
      });
      if (!res.ok) throw new Error('Update failed');
      setSchoolName(trimmed);
      setEditingSchoolName(false);
      setToast({ message: 'School name updated', type: 'success' });
    } catch {
      setToast({ message: "Couldn't update school name.", type: 'error' });
    }
    setSchoolNameSaving(false);
  };

  // Remove a member
  const handleRemoveMember = async (member: Member) => {
    if (member.email.toLowerCase() === ADMIN_EMAIL) {
      setToast({ message: "Can't remove the admin account.", type: 'error' });
      return;
    }
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Remove ${member.email}? They lose access on their next session.`)
      : false;
    if (!ok) return;

    const prior = members;
    setMembers(prev => prev.filter(m => m.id !== member.id));
    setRemovingId(member.id);
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }
      setToast({ message: `${member.email} removed`, type: 'success' });
    } catch (e) {
      setMembers(prior);
      setToast({ message: (e as Error).message || "Couldn't remove user.", type: 'error' });
    }
    setRemovingId(null);
  };

  const toggleModule = (member: Member, moduleKey: string) => {
    if (member.role === 'owner' || member.role === 'assistant') return;
    const currentModules = member.allowed_modules || {};
    const wasEnabled = isModEnabled(currentModules, moduleKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newModules: Record<string, any> = { ...currentModules };
    if (wasEnabled) {
      newModules[moduleKey] = false;
      if (expandedSub === `${member.id}:${moduleKey}`) setExpandedSub(null);
    } else {
      newModules[moduleKey] = true;
    }
    saveModules(member, newModules);
  };

  const toggleSubPermission = (member: Member, moduleKey: string, subKey: string) => {
    if (member.role === 'owner' || member.role === 'assistant') return;
    const currentModules = member.allowed_modules || {};
    const moduleVal = currentModules[moduleKey];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obj: Record<string, any>;
    if (moduleVal === true) {
      const subs = SUB_PERMISSIONS[moduleKey] || [];
      obj = { enabled: true };
      for (const sub of subs) obj[sub.key] = true;
    } else if (typeof moduleVal === 'object') {
      obj = { ...moduleVal };
    } else {
      return;
    }

    obj[subKey] = !obj[subKey];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newModules: Record<string, any> = { ...currentModules, [moduleKey]: obj };
    saveModules(member, newModules);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getSubValue = (modules: Record<string, any> | null, moduleKey: string, subKey: string): boolean => {
    if (!modules) return false;
    const val = modules[moduleKey];
    if (val === true) return true;
    if (typeof val === 'object' && val?.enabled) {
      return val[subKey] !== false;
    }
    return false;
  };

  // Toggle a testing-feature key on a member. Mirrors the optimistic
  // pattern used by saveModules: update locally, fire the PATCH, roll
  // back on failure. Add/remove handled by simple array diff against
  // the existing testing_features value.
  const toggleTestingFeature = async (member: Member, featureKey: string) => {
    const current = member.testing_features ?? [];
    const isOn = current.includes(featureKey);
    const next = isOn
      ? current.filter(k => k !== featureKey)
      : [...current, featureKey];
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, testing_features: next } : m));
    try {
      const res = await fetch(`/api/admin/workspace-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testing_features: next }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, testing_features: current } : m));
    }
  };

  // Lazy-load the feature flags list when the tab is first opened so we
  // don't fire the GET on every admin-page mount.
  useEffect(() => {
    if (activeTab !== 'feature-flags' || featureFlagsLoading || featureFlags.length > 0) return;
    setFeatureFlagsLoading(true);
    fetch('/api/admin/feature-flags')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed')))
      .then(json => setFeatureFlags(json.features || []))
      .catch(() => setToast({ message: "Couldn't load feature flags.", type: 'error' }))
      .finally(() => setFeatureFlagsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Toggle a workspace-wide promotion. Optimistic update on the local
  // featureFlags list; rolls back on failure. Promote-to-live runs
  // through a one-step confirm dialog (handled by the UI below).
  const setFeatureLive = async (key: string, isLive: boolean) => {
    const prior = featureFlags;
    setFeatureFlags(flags => flags.map(f => f.key === key ? { ...f, isLive } : f));
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, isLive }),
      });
      if (!res.ok) throw new Error('Failed');
      const json = await res.json();
      if (Array.isArray(json.features)) setFeatureFlags(json.features);
      setToast({
        message: isLive ? `${key} promoted to Live.` : `${key} returned to Testing.`,
        type: 'success',
      });
    } catch {
      setFeatureFlags(prior);
      setToast({ message: 'Failed to update feature flag.', type: 'error' });
    }
  };

  // Morning Briefings — Generate Preview button hits the preview
  // endpoint, which is always dryRun-forced. The returned dryRunConstant
  // tells the UI whether the underlying lib/morningBriefing.ts DRY_RUN
  // is still true so the banner color (amber vs green) is correct even
  // after Becca flips it.
  const generateBriefingPreview = async () => {
    setBriefingsLoading(true);
    try {
      const res = await fetch('/api/slack/morning-briefing/preview');
      if (!res.ok) throw new Error('Preview failed');
      const json = await res.json();
      setBriefings(json.briefings || []);
      if (typeof json.dryRunConstant === 'boolean') setBriefingDryRunConstant(json.dryRunConstant);
      if (typeof json.botName === 'string') setBriefingBotName(json.botName);
      setToast({ message: `Preview generated — ${json.briefings?.length ?? 0} briefings.`, type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Preview failed', type: 'error' });
    } finally {
      setBriefingsLoading(false);
    }
  };

  // Onboarding sub-tab: list user_briefing_preferences rows for the
  // workspace + show reset button so Becca can re-trigger the intro
  // DM for any user.
  const loadOnboardingRows = async () => {
    setOnboardingLoading(true);
    try {
      const res = await fetch('/api/slack/morning-briefing/onboarding');
      if (!res.ok) throw new Error('Failed to load onboarding rows');
      const json = await res.json();
      setOnboardingRows(json.rows || []);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to load onboarding rows', type: 'error' });
    } finally {
      setOnboardingLoading(false);
    }
  };

  const resetOnboarding = async (email: string) => {
    try {
      const res = await fetch('/api/slack/morning-briefing/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, onboarding_complete: false }),
      });
      if (!res.ok) throw new Error('Reset failed');
      setToast({ message: `Reset onboarding for ${email}.`, type: 'success' });
      await loadOnboardingRows();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Reset failed', type: 'error' });
    }
  };

  // Lazy load onboarding rows when that sub-tab is first opened
  useEffect(() => {
    if (activeTab !== 'morning-briefings') return;
    if (briefingSubTab !== 'onboarding') return;
    if (onboardingRows.length > 0 || onboardingLoading) return;
    loadOnboardingRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, briefingSubTab]);

  if (authLoading || !user || user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <svg className="w-8 h-8 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const ALL_SUB_MODULES = [...DASHBOARD_COLUMNS.map(c => c.key), 'home'];

  // Derived: which divisions exist across all members in the workspace.
  // Used by the School Settings tab read-only summary.
  const workspaceDivisions = Array.from(
    new Set(members.flatMap(m => m.divisions || []))
  ).sort();

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#fbfbfa' }}>
      <Sidebar
        user={user}
        activeNav=""
        setActiveNav={(nav) => router.push(`/?nav=${nav}`)}
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
        allMembers={members}
      />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1200px] px-8 lg:px-12 pt-10 pb-20">
          {/* Header */}
          <div className="mb-2">
            <h1 className="text-slate-900 font-semibold" style={{ fontSize: 28 }}>Admin</h1>
            <p className="text-slate-500 mt-1" style={{ fontSize: 14 }}>Manage users, school settings, and integrations.</p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-6 border-b border-slate-200 mt-6 mb-8">
            {([
              { key: 'users',         label: 'Users' },
              { key: 'school',        label: 'School Settings' },
              { key: 'integrations',  label: 'Integrations' },
              { key: 'feature-flags',     label: 'Feature Flags' },
              { key: 'morning-briefings', label: 'Morning Briefings' },
            ] as { key: TabKey; label: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`pb-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === t.key
                    ? 'font-semibold border-b-2 text-slate-900'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                style={activeTab === t.key ? { borderBottomColor: '#1B3A6B' } : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ===== USERS TAB ===== */}
          {activeTab === 'users' && (() => {
            const q = userSearch.trim().toLowerCase();
            const filteredUsers = members.filter(m =>
              !q || memberDisplayName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
            );
            const selectedUser = members.find(m => m.id === selectedUserId) || null;
            // By Module grid: category order (CATEGORY_ORDER), alphabetical
            // by label within each category.
            const filteredModules = MODULE_CATALOG
              .filter(mod => !q || mod.label.toLowerCase().includes(q) || mod.key.toLowerCase().includes(q))
              .slice()
              .sort((a, b) => {
                const ci = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
                return ci !== 0 ? ci : a.label.localeCompare(b.label);
              });
            const selectedModule = MODULE_CATALOG.find(mod => mod.key === selectedModuleKey) || null;
            const moduleAccessCount = (key: string) =>
              members.filter(m => m.role !== 'viewer' || isModEnabled(m.allowed_modules, key)).length;

            return (
              <>
                {/* Search + sub-tabs */}
                <div className="mb-5">
                  <div className="relative max-w-md mb-4">
                    <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                    </svg>
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder={usersSubTab === 'by-user' ? 'Search users by name or email…' : 'Search modules…'}
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300"
                    />
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                    {([
                      { key: 'by-user', label: 'By User' },
                      { key: 'by-module', label: 'By Module' },
                    ] as { key: 'by-user' | 'by-module'; label: string }[]).map(st => (
                      <button
                        key={st.key}
                        onClick={() => setUsersSubTab(st.key)}
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                          usersSubTab === st.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error banner */}
                {error && (
                  <div className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <span className="text-red-700 text-sm">{error}</span>
                    <button onClick={fetchMembers} className="text-red-600 text-sm font-medium hover:text-red-800">Retry</button>
                  </div>
                )}

                {loading ? (
                  <div className="animate-pulse space-y-2">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="bg-white border border-slate-200 rounded-lg h-16" />
                    ))}
                  </div>
                ) : usersSubTab === 'by-user' ? (
                  /* ---------- BY USER ---------- */
                  <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-6">
                    {/* Left: user list */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                      <div className="p-3 border-b border-slate-100">
                        <button
                          onClick={() => setShowAddForm(true)}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg inline-flex items-center justify-center gap-1.5"
                        >
                          <span className="text-base leading-none">+</span> Add User
                        </button>
                      </div>
                      <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                        {filteredUsers.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-8">No users match.</p>
                        ) : filteredUsers.map(m => {
                          const isSel = m.id === selectedUserId;
                          return (
                            <button
                              key={m.id}
                              onClick={() => setSelectedUserId(m.id)}
                              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-slate-50 transition-colors ${
                                isSel ? 'bg-blue-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 ${roleAvatarBg(m.role)}`}>
                                {memberDisplayName(m).charAt(0).toUpperCase()}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-slate-800 truncate">{memberDisplayName(m)}</span>
                                <span className="block text-xs text-slate-400 truncate">{m.email}</span>
                              </span>
                              <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 flex-shrink-0 ${
                                m.role === 'viewer' ? 'bg-slate-100 text-slate-600' : m.role === 'assistant' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                              }`}>{m.role}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Right: user detail */}
                    <div>
                      {!selectedUser ? (
                        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
                          Select a user to view and edit their access.
                        </div>
                      ) : (() => {
                        const u = selectedUser;
                        const isAdmin = u.email.toLowerCase() === ADMIN_EMAIL;
                        const isViewer = u.role === 'viewer';
                        return (
                          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {/* Header */}
                            <div className="p-5 flex items-center gap-4">
                              <span className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold flex-shrink-0 ${roleAvatarBg(u.role)}`}>
                                {memberDisplayName(u).charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                {editingNameId === u.id ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    onBlur={() => saveDisplayName(u, nameDraft)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); saveDisplayName(u, nameDraft); }
                                      else if (e.key === 'Escape') { setEditingNameId(null); }
                                    }}
                                    placeholder={u.email.split('@')[0]}
                                    className="text-lg font-bold text-slate-900 bg-white border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-200 w-full"
                                  />
                                ) : (
                                  <button
                                    onClick={() => { setEditingNameId(u.id); setNameDraft(u.display_name || ''); }}
                                    className="group inline-flex items-center gap-1.5 max-w-full text-left"
                                    title="Click to edit name"
                                  >
                                    <h3 className="text-lg font-bold text-slate-900 truncate">{memberDisplayName(u)}</h3>
                                    <svg className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-label="Edit name">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                )}
                                <p className="text-sm text-slate-500 truncate">{u.email}</p>
                                <p className="text-xs text-slate-400 mt-0.5">{u.workspace_name}</p>
                              </div>
                            </div>

                            {/* Role + divisions + title + slack */}
                            <div className="p-5 space-y-4">
                              <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Role</label>
                                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                                  {VALID_ROLES.map(r => (
                                    <button
                                      key={r}
                                      onClick={() => !isAdmin && saveRole(u, r)}
                                      disabled={isAdmin}
                                      className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                                        u.role === r ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                                      } ${isAdmin ? 'cursor-not-allowed opacity-60' : ''}`}
                                      title={isAdmin ? 'Admin role is fixed' : undefined}
                                    >
                                      {r}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Divisions</label>
                                <div className="flex items-center gap-4">
                                  {DIVISION_OPTIONS.map(d => (
                                    <label key={d.value} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={(u.divisions || []).includes(d.value)}
                                        onChange={() => toggleDivision(u, d.value)}
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300"
                                      />
                                      {d.label}
                                    </label>
                                  ))}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Title</label>
                                  <input
                                    key={u.id}
                                    type="text"
                                    defaultValue={u.title || ''}
                                    onBlur={(e) => saveTitle(u, e.target.value)}
                                    placeholder="e.g. Principal"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Slack User ID</label>
                                  <p className="px-3 py-2 text-sm text-slate-600 bg-slate-50 rounded-lg border border-slate-100">
                                    {u.slack_user_id || <span className="text-slate-400">Not set</span>}
                                  </p>
                                </div>
                              </div>

                              {/* Assistant — sets who assists this member (writes
                                  assistant_to on the assistant's row). Drives the
                                  Tasks page second column. */}
                              {(() => {
                                const currentAssistant = members.find(m => m.assistant_to === u.id);
                                const candidates = members.filter(m => m.id !== u.id && m.workspace_id === u.workspace_id && m.assignee_key !== null);
                                const isOpen = openAssistantId === u.id;
                                return (
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Assistant</label>
                                    <div className="relative inline-block">
                                      <button
                                        onClick={() => setOpenAssistantId(isOpen ? null : u.id)}
                                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
                                          currentAssistant ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                                        }`}
                                      >
                                        {currentAssistant ? memberDisplayName(currentAssistant) : '+ Set assistant'}
                                        <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                      {isOpen && (
                                        <div className="absolute left-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-60 overflow-y-auto">
                                          <button onClick={() => setMemberAssistant(u, null)} className="block w-full text-left px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">(none)</button>
                                          {candidates.length === 0 ? (
                                            <p className="px-3 py-1.5 text-xs text-slate-400">No eligible members (need an assignee key).</p>
                                          ) : candidates.map(c => (
                                            <button key={c.id} onClick={() => setMemberAssistant(u, c.id)} className="block w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                                              {memberDisplayName(c)}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Module permissions */}
                            <div className="p-5">
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Module Access</label>
                              {!isViewer ? (
                                <p className="text-sm text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-4 py-3">
                                  {u.role === 'owner' ? 'Owners' : 'Assistants'} automatically have access to every module — no per-module toggles needed.
                                </p>
                              ) : (
                                <div className="space-y-5">
                                  {CATEGORY_ORDER.map(cat => {
                                    const mods = MODULE_CATALOG.filter(mm => mm.category === cat);
                                    if (mods.length === 0) return null;
                                    return (
                                      <div key={cat}>
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{CATEGORY_LABEL[cat]}</p>
                                        <div className="space-y-1">
                                          {mods.map(mod => {
                                            const on = isModEnabled(u.allowed_modules, mod.key);
                                            const subs = SUB_PERMISSIONS[mod.key] || [];
                                            const subOpen = expandedSub === `${u.id}:${mod.key}`;
                                            return (
                                              <div key={mod.key} className="rounded-lg border border-slate-100">
                                                <div className="flex items-center justify-between px-3 py-2">
                                                  <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-sm text-slate-700 truncate">{mod.label}</span>
                                                    {subs.length > 0 && on && (
                                                      <button
                                                        onClick={() => setExpandedSub(subOpen ? null : `${u.id}:${mod.key}`)}
                                                        className={`text-slate-400 hover:text-slate-600 ${subOpen ? 'text-blue-500' : ''}`}
                                                        title="Sub-permissions"
                                                      >
                                                        <svg className={`w-3.5 h-3.5 transition-transform ${subOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                      </button>
                                                    )}
                                                  </div>
                                                  <button
                                                    onClick={() => toggleModule(u, mod.key)}
                                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-600' : 'bg-slate-200'}`}
                                                    title={on ? 'Disable' : 'Enable'}
                                                  >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                                  </button>
                                                </div>
                                                {subs.length > 0 && on && subOpen && (
                                                  <div className="border-t border-slate-100 px-3 py-2 space-y-2 bg-slate-50/50">
                                                    {subs.map(sub => (
                                                      <label key={sub.key} className="flex items-start gap-2.5 cursor-pointer">
                                                        <input
                                                          type="checkbox"
                                                          checked={getSubValue(u.allowed_modules, mod.key, sub.key)}
                                                          onChange={() => toggleSubPermission(u, mod.key, sub.key)}
                                                          className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span>
                                                          <span className="text-sm font-medium text-slate-700">{sub.label}</span>
                                                          <span className="block text-xs text-slate-400">{sub.description}</span>
                                                        </span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Testing & Preview */}
                            {TESTING_FEATURES.length > 0 && (() => {
                              const memberFeatures = u.testing_features ?? [];
                              const grouped: Record<string, typeof TESTING_FEATURES> = {};
                              for (const f of TESTING_FEATURES) {
                                if (!grouped[f.module]) grouped[f.module] = [];
                                grouped[f.module].push(f);
                              }
                              return (
                                <div className="p-5">
                                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">🧪 Testing &amp; Preview</label>
                                  <p className="text-xs text-slate-400 mb-3">Features in development. Only grant to users actively helping validate.</p>
                                  <div className="space-y-3">
                                    {Object.entries(grouped).map(([moduleKey, features]) => (
                                      <div key={moduleKey} className="space-y-2">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{moduleKey}</p>
                                        {features.map(f => (
                                          <label key={f.key} className="flex items-start gap-2.5 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={memberFeatures.includes(f.key)}
                                              onChange={() => toggleTestingFeature(u, f.key)}
                                              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span>
                                              <span className="text-sm font-medium text-slate-800">{f.label}</span>
                                              <span className="block text-xs text-slate-400">{f.description}</span>
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Remove */}
                            <div className="p-5">
                              <button
                                onClick={() => handleRemoveMember(u)}
                                disabled={isAdmin || removingId === u.id}
                                className="inline-flex items-center gap-2 text-sm text-red-600 hover:text-red-800 disabled:opacity-40 disabled:hover:text-red-600"
                                title={isAdmin ? "Can't remove the admin account" : 'Remove user'}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                {removingId === u.id ? 'Removing…' : 'Remove user'}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  /* ---------- BY MODULE ---------- */
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredModules.length === 0 ? (
                      <p className="text-sm text-slate-400 col-span-full text-center py-8">No modules match.</p>
                    ) : filteredModules.map(mod => (
                      <button
                        key={mod.key}
                        onClick={() => setSelectedModuleKey(mod.key)}
                        className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-slate-300 transition-all"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold text-slate-800">{mod.label}</span>
                          <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${CATEGORY_BADGE[mod.category]}`}>{CATEGORY_LABEL[mod.category]}</span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2 mb-2">{mod.description}</p>
                        <p className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{moduleAccessCount(mod.key)}</span> {moduleAccessCount(mod.key) === 1 ? 'user' : 'users'} with access
                        </p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Add User modal */}
                {showAddForm && (
                  <>
                    <div className="fixed inset-0 bg-slate-900/30 z-40" onClick={resetAddForm} />
                    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-10 px-4 pointer-events-none">
                      <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-2xl shadow-2xl pointer-events-auto">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Add User</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
                            <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="name@saracademy.org" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Display name <span className="font-normal italic normal-case text-slate-400">— optional</span></label>
                            <input type="text" value={addDisplayName} onChange={(e) => setAddDisplayName(e.target.value)} placeholder="e.g. Sara Hasson" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Role</label>
                            <select value={addRole} onChange={(e) => setAddRole(e.target.value as 'owner' | 'assistant' | 'viewer')} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                              {VALID_ROLES.map(r => (
                                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}{r === 'owner' || r === 'assistant' ? ' (full access)' : ''}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Title <span className="font-normal italic normal-case text-slate-400">— optional</span></label>
                            <input type="text" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="e.g. Principal" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Divisions</label>
                            <div className="flex items-center gap-4 py-2">
                              {DIVISION_OPTIONS.map(d => (
                                <label key={d.value} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                                  <input type="checkbox" checked={addDivisions.includes(d.value)} onChange={(e) => setAddDivisions(prev => e.target.checked ? [...prev, d.value] : prev.filter(v => v !== d.value))} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300" />
                                  {d.label}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className={addRole === 'viewer' ? '' : 'opacity-50 pointer-events-none'}>
                          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            Modules {addRole !== 'viewer' && <span className="font-normal italic normal-case text-slate-400">— owners and assistants see everything; module list ignored.</span>}
                          </label>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {ALL_MODULE_OPTIONS.map(opt => (
                              <label key={opt.key} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                                <input type="checkbox" checked={!!addModules[opt.key]} onChange={(e) => setAddModules(prev => ({ ...prev, [opt.key]: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-300" />
                                {opt.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-2">
                          <button onClick={resetAddForm} disabled={addSaving} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
                          <button onClick={handleAddUser} disabled={addSaving || !addEmail.trim()} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">{addSaving ? 'Adding…' : 'Add User'}</button>
                        </div>
                        <p className="text-xs text-slate-400 mt-3">New users are stored with a placeholder ID and gain a real Firebase UID on their first Google sign-in. They&apos;ll need to sign in via Google with this exact email.</p>
                      </div>
                    </div>
                  </>
                )}

                {/* By Module — detail slide-in panel */}
                {selectedModule && (
                  <>
                    <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setSelectedModuleKey(null)} />
                    <div className="fixed top-0 right-0 bottom-0 w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col">
                      <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-slate-900 truncate">{selectedModule.label}</h3>
                            <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${CATEGORY_BADGE[selectedModule.category]}`}>{CATEGORY_LABEL[selectedModule.category]}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{selectedModule.description}</p>
                        </div>
                        <button onClick={() => setSelectedModuleKey(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 flex-shrink-0">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-6 py-4">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Access</p>
                        <div className="space-y-1">
                          {members.map(m => {
                            const full = m.role !== 'viewer';
                            const on = full || isModEnabled(m.allowed_modules, selectedModule.key);
                            return (
                              <div key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                                <span className="flex items-center gap-2 min-w-0">
                                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0 ${roleAvatarBg(m.role)}`}>
                                    {memberDisplayName(m).charAt(0).toUpperCase()}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm text-slate-700 truncate">{memberDisplayName(m)}</span>
                                    <span className="block text-[11px] text-slate-400 truncate">{m.role}</span>
                                  </span>
                                </span>
                                <button
                                  onClick={() => !full && toggleModule(m, selectedModule.key)}
                                  disabled={full}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-blue-600' : 'bg-slate-200'} ${full ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  title={full ? 'Owners and assistants have full access' : on ? 'Disable' : 'Enable'}
                                >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Sub-permissions per viewer who has the module enabled */}
                        {(SUB_PERMISSIONS[selectedModule.key] || []).length > 0 && (() => {
                          const subs = SUB_PERMISSIONS[selectedModule.key];
                          const enabledViewers = members.filter(m => m.role === 'viewer' && isModEnabled(m.allowed_modules, selectedModule.key));
                          return (
                            <div className="mt-6">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Sub-permissions</p>
                              <p className="text-[11px] text-slate-400 mb-3">Owners and assistants have all sub-permissions. Below: viewers with this module enabled.</p>
                              {enabledViewers.length === 0 ? (
                                <p className="text-sm text-slate-400">No viewers have this module enabled.</p>
                              ) : (
                                <div className="space-y-4">
                                  {enabledViewers.map(m => (
                                    <div key={m.id} className="rounded-lg border border-slate-100 p-3">
                                      <p className="text-sm font-medium text-slate-700 mb-2">{memberDisplayName(m)}</p>
                                      <div className="space-y-2">
                                        {subs.map(sub => (
                                          <label key={sub.key} className="flex items-start gap-2.5 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={getSubValue(m.allowed_modules, selectedModule.key, sub.key)}
                                              onChange={() => toggleSubPermission(m, selectedModule.key, sub.key)}
                                              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span>
                                              <span className="text-sm font-medium text-slate-700">{sub.label}</span>
                                              <span className="block text-xs text-slate-400">{sub.description}</span>
                                            </span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* ===== SCHOOL SETTINGS TAB ===== */}
          {activeTab === 'school' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-slate-900 font-semibold mb-1" style={{ fontSize: 16 }}>School name</h2>
                <p className="text-slate-500 text-xs mb-4">The display name for this workspace.</p>
                {editingSchoolName ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={schoolNameDraft}
                      onChange={(e) => setSchoolNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveSchoolName(); }
                        else if (e.key === 'Escape') { setEditingSchoolName(false); }
                      }}
                      className="flex-1 max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      onClick={saveSchoolName}
                      disabled={schoolNameSaving}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
                    >
                      {schoolNameSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingSchoolName(false)}
                      disabled={schoolNameSaving}
                      className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setSchoolNameDraft(schoolName); setEditingSchoolName(true); }}
                    className="group inline-flex items-center gap-2 text-left"
                    title="Click to edit"
                  >
                    <span className="text-slate-900 font-medium" style={{ fontSize: 15 }}>{schoolName || '—'}</span>
                    <svg className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <h2 className="text-slate-900 font-semibold mb-1" style={{ fontSize: 16 }}>Divisions</h2>
                <p className="text-slate-500 text-xs mb-4">
                  Divisions in use across all members of this workspace. Edit divisions per-user on the Users tab.
                </p>
                {workspaceDivisions.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No members have a division assigned yet.</p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {workspaceDivisions.map(d => (
                      <span
                        key={d}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-medium"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {d === 'academy' ? 'Academy (ELC / LS / MS)' : d === 'hs' ? 'High School' : d}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 opacity-70">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-slate-900 font-semibold" style={{ fontSize: 16 }}>Branding</h2>
                  <span className="text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-500">Coming soon</span>
                </div>
                <p className="text-slate-500 text-xs">Logo, theme colors, and email signature defaults will live here.</p>
              </div>
            </div>
          )}

          {/* ===== INTEGRATIONS TAB ===== */}
          {activeTab === 'integrations' && (
            <div>
              <div className="mb-6 flex items-start justify-between gap-4">
                <p className="text-slate-500 max-w-2xl" style={{ fontSize: 13 }}>
                  Third-party services this workspace connects to. Configure API keys per integration — credentials are stored in the database (RLS-locked, service-role only) and never returned to the browser. While no row exists for an integration, the app falls back to the server environment variable for that key.
                </p>
                {!integrationsLoading && integrations.filter(i => i.is_active && i.hasCredentials).length === 0 && (
                  <button
                    onClick={migrateFromEnv}
                    className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                    title="One-time: copy current process.env values into workspace_integrations"
                  >
                    Seed from environment
                  </button>
                )}
              </div>
              {integrationsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1,2,3,4,5,6,7].map(i => (
                    <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
                      <div className="h-10 w-10 bg-slate-100 rounded-lg mb-3" />
                      <div className="h-4 bg-slate-200 rounded w-32 mb-2" />
                      <div className="h-3 bg-slate-100 rounded w-24 mb-4" />
                      <div className="h-9 bg-slate-100 rounded" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {INTEGRATION_CARDS.map(card => {
                    const isApiKey = card.key in INTEGRATION_FIELDS;
                    const isOAuth = card.key === 'gmail' || card.key === 'calendar';
                    const isComingSoon = card.key === 'rise';
                    const status = integrations.find(i => i.integration_type === card.key);
                    const isOpen = openConfigKey === card.key;
                    const testResult = testResults[card.key];

                    // Status pill: configured + active = green; configured + inactive = red; otherwise slate.
                    const connected = status?.is_active && status?.hasCredentials;
                    const disconnected = status?.is_active === false;
                    let pillBg = 'bg-slate-100 text-slate-600';
                    let pillDot = 'bg-slate-400';
                    let pillText = isOAuth ? 'Google OAuth' : isComingSoon ? 'Coming soon' : 'Not configured';
                    if (connected) {
                      pillBg = 'bg-emerald-50 text-emerald-700';
                      pillDot = 'bg-emerald-500';
                      pillText = 'Connected';
                    } else if (disconnected) {
                      pillBg = 'bg-rose-50 text-rose-700';
                      pillDot = 'bg-rose-500';
                      pillText = 'Disconnected';
                    } else if (isOAuth) {
                      pillBg = 'bg-blue-50 text-blue-700';
                      pillDot = 'bg-blue-500';
                    } else if (isComingSoon) {
                      pillBg = 'bg-slate-100 text-slate-500';
                      pillDot = 'bg-slate-400';
                    }

                    return (
                      <div key={card.key} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
                        <div className="flex items-start justify-between mb-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
                            {card.icon}
                          </div>
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${pillBg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${pillDot}`} />
                            {pillText}
                          </span>
                        </div>
                        <h3 className="text-slate-900 font-semibold mb-1" style={{ fontSize: 15 }}>{card.name}</h3>
                        <p className="text-slate-400 text-xs mb-4 flex-1">
                          {isOAuth && 'Per-user tokens managed via Google sign-in.'}
                          {isComingSoon && 'Phase G — coming soon.'}
                          {isApiKey && status?.connected_by && `Connected by ${status.connected_by}`}
                          {isApiKey && !status?.connected_by && 'API key not yet configured.'}
                        </p>

                        {/* Action buttons */}
                        {isComingSoon && (
                          <button
                            disabled
                            title="Coming soon"
                            className="w-full text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                          >
                            Configure
                          </button>
                        )}
                        {isOAuth && (
                          <a
                            href={`/api/auth/gmail-consent?workspaceId=${workspaceId}&userEmail=${encodeURIComponent(user?.email || '')}`}
                            className="w-full text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-center transition-colors"
                          >
                            Reconnect
                          </a>
                        )}
                        {isApiKey && (
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  if (isOpen) {
                                    setOpenConfigKey(null);
                                    setConfigForm({});
                                  } else {
                                    setOpenConfigKey(card.key);
                                    setConfigForm({});
                                  }
                                }}
                                className="flex-1 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                {isOpen ? 'Cancel' : 'Configure'}
                              </button>
                              <button
                                onClick={() => testIntegration(card.key)}
                                disabled={testingKey === card.key || !status?.hasCredentials}
                                title={!status?.hasCredentials ? 'Configure first' : 'Test connection'}
                                className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {testingKey === card.key ? '…' : 'Test'}
                              </button>
                            </div>
                            {testResult && (
                              <div className={`text-[11px] px-2 py-1 rounded ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                {testResult.ok ? '✓ Connection ok' : `✗ ${testResult.error || 'Failed'}`}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Inline configure form */}
                        {isApiKey && isOpen && (
                          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                            {INTEGRATION_FIELDS[card.key]?.map(field => {
                              const fieldIsConfigured = status?.fields?.[field.key] === true;
                              return (
                                <div key={field.key}>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">
                                    {field.label}
                                    {fieldIsConfigured && <span className="ml-1.5 text-[10px] text-emerald-600 font-normal">• already set</span>}
                                  </label>
                                  <input
                                    type={field.type}
                                    value={configForm[field.key] ?? ''}
                                    onChange={e => setConfigForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    placeholder={fieldIsConfigured ? 'Leave blank to keep current value' : field.placeholder}
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  />
                                </div>
                              );
                            })}
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => saveIntegration(card.key)}
                                disabled={configSaving}
                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
                              >
                                {configSaving ? 'Saving…' : 'Save'}
                              </button>
                              {status?.is_active && (
                                <button
                                  onClick={() => disconnectIntegration(card.key)}
                                  className="text-sm font-medium px-3 py-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  Disconnect
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== FEATURE FLAGS TAB ===== */}
          {activeTab === 'feature-flags' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Feature Flags</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Promote a feature from Testing → Live to make it visible to all users with the relevant module access, without granting per-user. Demote to roll back.
                </p>
              </div>

              {featureFlagsLoading && featureFlags.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
              ) : featureFlags.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">
                  No features in testing. Add entries to <code className="bg-slate-100 rounded px-1 py-0.5">lib/testingFeatures.ts</code> to manage them here.
                </p>
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3 font-medium">Feature</th>
                        <th className="px-5 py-3 font-medium">Module</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium text-right">Toggle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {featureFlags.map(f => {
                        const pillCls = MODULE_PILL[f.module] ?? 'bg-slate-100 text-slate-600';
                        return (
                          <tr key={f.key} className="border-b border-slate-100 last:border-0 align-top">
                            <td className="px-5 py-3">
                              <p className="font-medium text-slate-800">{f.label}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{f.description}</p>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5 ${pillCls}`}>
                                {f.module}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              {f.isLive ? (
                                <span className="inline-flex items-center text-xs font-medium bg-green-50 text-green-700 rounded-full px-2 py-0.5">
                                  ✅ Live — visible to all {f.module} users
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs font-medium bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                                  🧪 Testing — grant per user in Permissions
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {f.isLive ? (
                                <button
                                  onClick={() => setFeatureLive(f.key, false)}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded px-2.5 py-1 transition-colors"
                                >
                                  Move back to Testing
                                </button>
                              ) : (
                                <button
                                  onClick={() => setConfirmPromoteKey(f.key)}
                                  className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-2.5 py-1 transition-colors"
                                >
                                  Promote to Live
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== MORNING BRIEFINGS TAB ===== */}
          {activeTab === 'morning-briefings' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Morning Briefings — {briefingBotName} 🐝</h2>
                <p className="text-xs text-slate-500 mt-0.5">Preview the briefings Buzz will send each morning, and manage onboarding.</p>
              </div>

              {/* DRY_RUN banner. dryRunConstant === null until first preview load — show neutral. */}
              {briefingDryRunConstant === true && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
                  <strong>Preview mode</strong> — no Slacks are being sent. Buzz is logging to the Cloud Run console only. To enable live sends, set <code className="bg-amber-100 rounded px-1">DRY_RUN = false</code> in <code className="bg-amber-100 rounded px-1">lib/morningBriefing.ts</code> and redeploy.
                </div>
              )}
              {briefingDryRunConstant === false && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-800">
                  <strong>Live</strong> — briefings send at 7:30am ET on school days (once the scheduler is uncommented).
                </div>
              )}

              {/* Sub-tabs */}
              <div className="flex items-center gap-4 border-b border-slate-200">
                {(['briefings', 'onboarding'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setBriefingSubTab(t)}
                    className={`pb-2 text-sm font-medium transition-colors ${
                      briefingSubTab === t
                        ? 'border-b-2 border-blue-600 text-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t === 'briefings' ? 'Briefings' : 'Onboarding'}
                  </button>
                ))}
              </div>

              {/* --- BRIEFINGS sub-tab --- */}
              {briefingSubTab === 'briefings' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={generateBriefingPreview}
                      disabled={briefingsLoading}
                      className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
                    >
                      {briefingsLoading ? 'Generating…' : 'Generate Preview'}
                    </button>
                    {briefings.length > 0 && (
                      <span className="text-xs text-slate-500">{briefings.length} briefing{briefings.length === 1 ? '' : 's'} generated</span>
                    )}
                  </div>

                  {briefings.length === 0 && !briefingsLoading && (
                    <p className="text-sm text-slate-400 py-8 text-center">
                      Click <strong>Generate Preview</strong> to render what each user would receive today.
                    </p>
                  )}

                  {briefings.map(b => (
                    <div key={b.userId} className="bg-white border border-slate-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-semibold text-slate-800">{b.name}</p>
                          <p className="text-xs text-slate-400">Slack ID: {b.slackUserId || '(none)'} · {b.email}</p>
                        </div>
                        <span
                          className={`inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5 ${
                            b.kind === 'briefing'
                              ? 'bg-blue-50 text-blue-700'
                              : b.kind === 'onboarding'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {b.kind === 'briefing' ? 'Briefing' : b.kind === 'onboarding' ? 'Onboarding intro' : 'Skipped'}
                        </span>
                      </div>
                      {b.kind === 'onboarding' && (
                        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-1.5 text-xs text-amber-800 mb-2">
                          Onboarding pending — this user will receive the intro message instead of a briefing.
                        </div>
                      )}
                      {b.error ? (
                        <p className="text-xs text-red-600">Error: {b.error}</p>
                      ) : (
                        <pre className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded p-3 border border-slate-100">{b.message}</pre>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
                        <span>📅 {b.calendarEventCount} events</span>
                        <span>📋 {b.taskCount} tasks</span>
                        {b.preferencesUsed && <span className="italic">Pref: &ldquo;{b.preferencesUsed.slice(0, 80)}{b.preferencesUsed.length > 80 ? '…' : ''}&rdquo;</span>}
                      </div>
                    </div>
                  ))}

                  <p className="text-xs text-slate-400 italic pt-3">
                    To enable live sends: set <code className="bg-slate-100 rounded px-1">DRY_RUN = false</code> in <code className="bg-slate-100 rounded px-1">lib/morningBriefing.ts</code>, uncomment the <code className="bg-slate-100 rounded px-1">scheduledMorningBriefings</code> block in <code className="bg-slate-100 rounded px-1">functions/src/index.ts</code>, and redeploy.
                  </p>
                </div>
              )}

              {/* --- ONBOARDING sub-tab --- */}
              {briefingSubTab === 'onboarding' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={loadOnboardingRows}
                      disabled={onboardingLoading}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded px-2.5 py-1 transition-colors disabled:opacity-50"
                    >
                      {onboardingLoading ? 'Loading…' : 'Refresh'}
                    </button>
                    <span className="text-xs text-slate-500">{onboardingRows.length} row{onboardingRows.length === 1 ? '' : 's'}</span>
                  </div>

                  {onboardingRows.length === 0 && !onboardingLoading && (
                    <p className="text-sm text-slate-400 py-8 text-center">No onboarding rows yet — they appear once a briefing has been generated for a user.</p>
                  )}

                  {onboardingRows.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-sm min-w-[700px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                            <th className="px-5 py-3 font-medium">Name</th>
                            <th className="px-5 py-3 font-medium">Onboarding Sent</th>
                            <th className="px-5 py-3 font-medium">Complete</th>
                            <th className="px-5 py-3 font-medium">Preference Summary</th>
                            <th className="px-5 py-3 font-medium text-right">Reset</th>
                          </tr>
                        </thead>
                        <tbody>
                          {onboardingRows.map(r => (
                            <tr key={r.email} className="border-b border-slate-100 last:border-0 align-top">
                              <td className="px-5 py-3">
                                <p className="font-medium text-slate-800">{r.display_name || r.email}</p>
                                <p className="text-xs text-slate-400">{r.email}</p>
                              </td>
                              <td className="px-5 py-3 text-xs text-slate-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {r.onboarding_sent_at ? new Date(r.onboarding_sent_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                              </td>
                              <td className="px-5 py-3">
                                {r.onboarding_complete ? (
                                  <span className="inline-flex items-center text-xs font-medium bg-green-50 text-green-700 rounded-full px-2 py-0.5">✓ Complete</span>
                                ) : (
                                  <span className="inline-flex items-center text-xs font-medium bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">Pending</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-xs text-slate-700">{r.preferences_summary || <span className="text-slate-300">—</span>}</td>
                              <td className="px-5 py-3 text-right">
                                <button
                                  onClick={() => resetOnboarding(r.email)}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 hover:border-slate-400 rounded px-2.5 py-1 transition-colors"
                                >
                                  Reset
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Promote-to-Live confirmation. Single step — Becca clicks
          Continue and the PATCH fires. Cancel just clears the prompt. */}
      {confirmPromoteKey && (() => {
        const f = featureFlags.find(x => x.key === confirmPromoteKey);
        if (!f) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-base font-semibold text-slate-900">Promote {f.label} to Live?</h3>
              <p className="text-sm text-slate-600 mt-2">
                This will make <span className="font-medium">{f.label}</span> visible to all users with <span className="font-medium">{f.module}</span> access. Continue?
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setConfirmPromoteKey(null)}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const key = confirmPromoteKey;
                    setConfirmPromoteKey(null);
                    if (key) setFeatureLive(key, true);
                  }}
                  className="text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1.5"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 rounded-lg px-4 py-3 shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
        }`}>
          <span className={`text-sm ${toast.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
