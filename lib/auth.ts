import { cookies } from 'next/headers';

export interface SessionMember {
  assigneeKey: string | null;
  displayName: string | null;
  title: string | null;
  divisions: string[];
  slackUserId: string | null;
}

export interface SessionAssistant {
  assigneeKey: string | null;
  displayName: string | null;
  email: string | null;
  slackUserId: string | null;
}

// `principal` is the person THIS user assists (when currentMember has
// assistant_to set). Same shape as SessionAssistant — just lives on the
// other side of the same FK pointer. Tasks page treats both as "second
// column" candidates: principal ?? assistant.
export type SessionPrincipal = SessionAssistant;

// Phase E: per-workspace branding (social handles, owner short name,
// school Instagram, etc.). Loaded from workspaces.brand jsonb and
// embedded in the session cookie so the client can render brand-
// dependent UI (e.g. the home page social-links section) without an
// extra fetch.
export interface SessionBrand {
  ownerShortName?: string;
  ownerInstagram?: string;
  ownerLinkedIn?: string;
  ownerX?: string;
  schoolInstagram?: string;
}

interface AuthSession {
  user: {
    email: string | null;
    name: string | null;
    image: string | null;
  };
  accessToken?: string;
  workspaceId?: string | null;
  role?: string | null;
  modules?: Record<string, boolean> | null;
  moduleConfig?: Record<string, any> | null;
  allowedModules?: Record<string, boolean> | null;
  currentMember?: SessionMember | null;
  assistant?: SessionAssistant | null;
  principal?: SessionPrincipal | null;
  workspaceOwnerEmail?: string | null;
  workspaceBrand?: SessionBrand | null;
  // Per-user opt-in list of in-development features (see
  // lib/testingFeatures.ts). Gating happens client-side via
  // useWorkspace().testingFeatures; server routes can also check this
  // for sensitive preview endpoints.
  testingFeatures?: string[];
  // Workspace-wide promoted features — visible to all users with the
  // relevant module access, without needing a per-user grant. The
  // `canSeeTestingFeature` helper unions this with testingFeatures.
  promotedFeatures?: string[];
}


const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string): boolean {
  return allowedEmails.includes(email.toLowerCase());
}

export async function getAuthSession(): Promise<AuthSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('__session');

    if (!sessionCookie?.value) {
      return null;
    }

    const data = JSON.parse(sessionCookie.value);

    if (!data.user?.email) {
      return null;
    }

    return {
      user: {
        email: data.user.email,
        name: data.user.name || null,
        image: data.user.image || null,
      },
      accessToken: data.accessToken || undefined,
      workspaceId: data.workspace_id || null,
      role: data.role || null,
      modules: data.modules || null,
      moduleConfig: data.module_config || null,
      allowedModules: data.allowed_modules || null,
      currentMember: data.current_member || null,
      assistant: data.assistant || null,
      principal: data.principal || null,
      workspaceOwnerEmail: data.workspace_owner_email || null,
      workspaceBrand: data.workspace_brand || null,
      testingFeatures: Array.isArray(data.testing_features) ? data.testing_features : [],
      promotedFeatures: Array.isArray(data.promoted_features) ? data.promoted_features : [],
    };
  } catch {
    // Expected for unauthenticated requests, expired cookies, or
    // when firebase-admin framework layer fails to decode __session
    return null;
  }
}
