'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import { getEffectiveModules } from '@/lib/modules';

interface AuthContextType {
  user: User | null;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  signOut: async () => {},
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

// Workspace context — Phase 2 multi-tenant foundation
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

// Phase B: identity payloads for the active user and (optionally) their
// assistant. Tasks page reads these to drive its two-column layout
// instead of the legacy hardcoded RBK/Emily strings.
export interface CurrentMember {
  assigneeKey: string | null;
  displayName: string | null;
  title: string | null;
  divisions: string[];
  slackUserId: string | null;
}

export interface AssistantMember {
  assigneeKey: string | null;
  displayName: string | null;
  email: string | null;
  slackUserId: string | null;
}

// `principal` shares the same shape as `assistant` — it's the inverse
// of the assistant_to FK. Tasks page reads (assistant ?? principal) to
// pick the second-column partner.
export type PrincipalMember = AssistantMember;

// Phase E: workspace-level branding config sourced from workspaces.brand
// jsonb. All fields optional — workspaces that haven't configured
// social links etc. will return null/undefined for the entries that
// aren't set, and brand-dependent UI hides accordingly.
export interface WorkspaceBrand {
  ownerShortName?: string;
  ownerInstagram?: string;
  ownerLinkedIn?: string;
  ownerX?: string;
  schoolInstagram?: string;
}

interface WorkspaceContextType {
  workspaceId: string | null;
  role: 'owner' | 'assistant' | 'viewer' | null;
  // System builder / super-admin (e.g. Becca), distinct from a plain
  // workspace owner (e.g. RBK). Reflects the REAL session (not adjusted by
  // impersonation). Gates the admin panel + admin-only actions.
  isSuperAdmin: boolean;
  modules: Record<string, boolean> | null;
  moduleConfig: Record<string, any> | null;
  allowedModules: Record<string, boolean> | null;
  effectiveModules: Record<string, boolean> | null;
  displayName: string | null;
  workspaces: WorkspaceInfo[];
  switchWorkspace: (id: string) => void | Promise<void>;
  impersonating: ImpersonationTarget | null;
  startImpersonation: (target: ImpersonationTarget) => void;
  stopImpersonation: () => void;
  currentMember: CurrentMember | null;
  assistant: AssistantMember | null;
  principal: PrincipalMember | null;
  workspaceOwnerEmail: string | null;
  workspaceBrand: WorkspaceBrand | null;
  // True when the active workspace member has a non-null
  // google_tasks_refresh_token. Drives the Connect / Connected affordance
  // in the Sidebar; flipped from the GET /api/auth/session/workspace
  // response so refreshes after an OAuth round-trip pick up the new state.
  googleTasksConnected: boolean;
  // Per-user opt-in flags for in-development features. See
  // lib/testingFeatures.ts for the registry. Component-level gating
  // (e.g. the Development Overview tab) reads this array directly.
  testingFeatures: string[];
  // Workspace-wide promoted features (workspaces.promoted_features).
  // Use `canSeeTestingFeature()` from lib/testingFeatures.ts to
  // union this with `testingFeatures` instead of checking both
  // arrays manually in every gated component.
  promotedFeatures: string[];
}

function readImpersonation(): ImpersonationTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('impersonation');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspaceId: null,
  role: null,
  isSuperAdmin: false,
  modules: null,
  moduleConfig: null,
  allowedModules: null,
  effectiveModules: null,
  displayName: null,
  workspaces: [],
  switchWorkspace: () => {},
  impersonating: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
  currentMember: null,
  assistant: null,
  principal: null,
  workspaceOwnerEmail: null,
  workspaceBrand: null,
  googleTasksConnected: false,
  testingFeatures: [],
  promotedFeatures: [],
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const switchWorkspace = useCallback(async (id: string) => {
    localStorage.setItem('selectedWorkspaceId', id);
    try {
      await fetch('/api/auth/switch-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: id }),
      });
    } catch {
      // Reload anyway — loadWorkspaceFromSession will resolve from localStorage
    }
    window.location.reload();
  }, []);

  // Impersonation (admin-only, client-side)
  const [impersonating, setImpersonating] = useState<ImpersonationTarget | null>(readImpersonation);

  const startImpersonation = useCallback((target: ImpersonationTarget) => {
    localStorage.setItem('impersonation', JSON.stringify(target));
    setImpersonating(target);
    window.location.reload();
  }, []);

  const stopImpersonation = useCallback(() => {
    localStorage.removeItem('impersonation');
    setImpersonating(null);
    window.location.reload();
  }, []);

  // Workspace state — initialized with impersonation values if active
  const imp = readImpersonation();
  const [workspace, setWorkspace] = useState<WorkspaceContextType>({
    workspaceId: imp ? imp.workspace_id : null,
    role: imp ? (imp.role as 'owner' | 'assistant' | 'viewer') : null,
    isSuperAdmin: false,
    modules: null,
    moduleConfig: null,
    allowedModules: null,
    effectiveModules: null,
    displayName: imp ? imp.display_name : null,
    workspaces: [],
    switchWorkspace,
    impersonating: imp,
    startImpersonation,
    stopImpersonation,
    currentMember: null,
    assistant: null,
    principal: null,
    workspaceOwnerEmail: null,
    workspaceBrand: null,
    googleTasksConnected: false,
    testingFeatures: [],
    promotedFeatures: [],
  });

  // Load workspace context from session cookie on initial auth
  const loadWorkspaceFromSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/auth/session/workspace?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const allWorkspaces: WorkspaceInfo[] = data.workspaces || [];

        // Check localStorage for a previously selected workspace
        const selectedId = localStorage.getItem('selectedWorkspaceId');
        const selected = selectedId
          ? allWorkspaces.find(w => w.id === selectedId)
          : null;

        // Use selected workspace if valid, otherwise fall back to session default
        const activeId = selected ? selected.id : (data.workspace_id || null);
        const activeWs = selected || allWorkspaces.find(w => w.id === activeId);

        // modules/module_config come from the top-level session fields (set for the active workspace)
        let wsModules = data.modules || null;
        let memberAllowed = data.allowed_modules || null;
        let moduleConfig = data.module_config || null;

        const currentImp = readImpersonation();
        let effectiveId = activeId;
        let effectiveRole: 'owner' | 'assistant' | 'viewer' | null = (activeWs?.role as 'owner' | 'assistant' | 'viewer') || data.role || null;
        let effectiveDisplayName = data.display_name || null;
        // Phase B: identity payloads. Without impersonation, take them
        // directly from the session cookie (set server-side for the
        // logged-in user). With impersonation, replace all three with
        // the target's row + their assistant + their principal from the
        // admin endpoint.
        let effectiveCurrentMember: CurrentMember | null = data.current_member || null;
        let effectiveAssistant: AssistantMember | null = data.assistant || null;
        let effectivePrincipal: PrincipalMember | null = data.principal || null;

        if (currentImp) {
          effectiveId = currentImp.workspace_id;
          effectiveRole = currentImp.role as 'owner' | 'assistant' | 'viewer';
          effectiveDisplayName = currentImp.display_name;

          // Fetch the impersonated member's workspace modules + allowed_modules,
          // plus their assignee_key / assistant_to so currentMember + assistant
          // reflect the impersonated identity rather than the real Becca.
          try {
            const impRes = await fetch(`/api/admin/workspace-members?workspace_id=${currentImp.workspace_id}&email=${encodeURIComponent(currentImp.email)}&t=${Date.now()}`, { cache: 'no-store' });
            if (impRes.ok) {
              const impData = await impRes.json();
              const allMembers: Array<{
                id: string;
                email: string;
                display_name: string | null;
                workspace_id: string;
                allowed_modules: Record<string, boolean> | null;
                divisions?: string[] | null;
                title?: string | null;
                assignee_key?: string | null;
                slack_user_id?: string | null;
                assistant_to?: string | null;
              }> = impData.members || [];

              const impMember = allMembers.find(
                m => m.email === currentImp.email && m.workspace_id === currentImp.workspace_id
              );
              if (impMember) {
                memberAllowed = impMember.allowed_modules || null;

                effectiveCurrentMember = {
                  assigneeKey: impMember.assignee_key ?? null,
                  displayName: impMember.display_name ?? currentImp.display_name,
                  title: impMember.title ?? null,
                  divisions: impMember.divisions ?? [],
                  slackUserId: impMember.slack_user_id ?? null,
                };

                // Reverse lookup: the impersonated user's assistant is
                // whoever has assistant_to pointing back to impMember.id.
                const assistantRow = allMembers.find(m => m.assistant_to === impMember.id);
                effectiveAssistant = assistantRow ? {
                  assigneeKey: assistantRow.assignee_key ?? null,
                  displayName: assistantRow.display_name ?? null,
                  email: assistantRow.email ?? null,
                  slackUserId: assistantRow.slack_user_id ?? null,
                } : null;

                // Forward lookup: if the impersonated user assists someone,
                // resolve their principal.
                const principalRow = impMember.assistant_to
                  ? allMembers.find(m => m.id === impMember.assistant_to)
                  : null;
                effectivePrincipal = principalRow ? {
                  assigneeKey: principalRow.assignee_key ?? null,
                  displayName: principalRow.display_name ?? null,
                  email: principalRow.email ?? null,
                  slackUserId: principalRow.slack_user_id ?? null,
                } : null;
              }
            }
          } catch { /* use defaults */ }
        }

        setWorkspace({
          workspaceId: effectiveId,
          role: effectiveRole,
          // Super-admin reflects the REAL session cookie, never impersonation
          // (same rationale as googleTasksConnected below).
          isSuperAdmin: data.is_super_admin === true,
          modules: wsModules,
          moduleConfig,
          allowedModules: memberAllowed,
          effectiveModules: getEffectiveModules(wsModules, memberAllowed),
          displayName: effectiveDisplayName,
          workspaces: allWorkspaces,
          switchWorkspace,
          impersonating: currentImp,
          startImpersonation,
          stopImpersonation,
          currentMember: effectiveCurrentMember,
          assistant: effectiveAssistant,
          principal: effectivePrincipal,
          workspaceOwnerEmail: data.workspace_owner_email || null,
          workspaceBrand: data.workspace_brand || null,
          // Impersonation never carries the impersonator's Google Tasks
          // connection — the flag reflects the real session cookie
          // (i.e. the active member's own connection state).
          googleTasksConnected: !!data.google_tasks_connected,
          testingFeatures: Array.isArray(data.testing_features) ? data.testing_features : [],
          promotedFeatures: Array.isArray(data.promoted_features) ? data.promoted_features : [],
        });
      }
    } catch {
      // Endpoint may not exist yet — workspace context stays null
    }
  }, [switchWorkspace, startImpersonation, stopImpersonation]);

  // Refresh the __session cookie with a fresh ID token and reload workspace context
  const refreshSession = useCallback(async (currentUser: User) => {
    try {
      const idToken = await currentUser.getIdToken(true);
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      // Re-read workspace context after cookie is updated
      await loadWorkspaceFromSession();
    } catch (error) {
      console.error('Failed to refresh session:', error);
    }
  }, [loadWorkspaceFromSession]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (firebaseUser) {
        loadWorkspaceFromSession();
      } else {
        setWorkspace({ workspaceId: null, role: null, isSuperAdmin: false, modules: null, moduleConfig: null, allowedModules: null, effectiveModules: null, displayName: null, workspaces: [], switchWorkspace, impersonating: null, startImpersonation, stopImpersonation, currentMember: null, assistant: null, principal: null, workspaceOwnerEmail: null, workspaceBrand: null, googleTasksConnected: false, testingFeatures: [], promotedFeatures: [] });
      }
    });
    return unsubscribe;
  }, [loadWorkspaceFromSession, switchWorkspace, startImpersonation, stopImpersonation]);

  // Periodically refresh ID token → re-set __session cookie (every 10 min)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      refreshSession(user);
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, refreshSession]);

  // One-shot refresh for users with cookies older than Phase B (which
  // added current_member + assistant to the session payload). If the
  // workspace context loaded without a currentMember, force a session
  // rebuild so the new fields populate without requiring a re-login.
  // Guarded by a flag so we don't loop forever if the user genuinely
  // has no workspace_members row.
  const [didMigrateSession, setDidMigrateSession] = useState(false);
  useEffect(() => {
    if (!user || loading || didMigrateSession) return;
    if (workspace.currentMember) return; // already migrated
    setDidMigrateSession(true);
    refreshSession(user);
  }, [user, loading, workspace.currentMember, didMigrateSession, refreshSession]);

  const handleSignOut = useCallback(async () => {
    localStorage.removeItem('selectedWorkspaceId');
    localStorage.removeItem('impersonation');
    await fetch('/api/auth/signout', { method: 'POST' });
    await firebaseSignOut(auth);
    setImpersonating(null);
    setWorkspace({ workspaceId: null, role: null, isSuperAdmin: false, modules: null, moduleConfig: null, allowedModules: null, effectiveModules: null, displayName: null, workspaces: [], switchWorkspace, impersonating: null, startImpersonation, stopImpersonation, currentMember: null, assistant: null, principal: null, workspaceOwnerEmail: null, workspaceBrand: null, googleTasksConnected: false, testingFeatures: [], promotedFeatures: [] });
  }, [switchWorkspace, startImpersonation, stopImpersonation]);

  return (
    <AuthContext.Provider value={{ user, signOut: handleSignOut, loading }}>
      <WorkspaceContext.Provider value={workspace}>
        {children}
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
}
