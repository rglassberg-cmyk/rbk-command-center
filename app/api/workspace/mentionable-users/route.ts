// Returns the workspace's @-mentionable members for the DonorAnnotations
// component (and any other UI surface that needs an @mention autocomplete
// list). Replaces the hardcoded MENTIONABLE_USERS module-level constant
// that used to ship inside DonorAnnotations.tsx.

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

interface MemberRow {
  id: string;
  display_name: string | null;
  email: string;
  slack_user_id: string | null;
  assignee_key: string | null;
  role: string;
  allowed_modules: Record<string, unknown> | null;
}

interface MentionableUser {
  id: string;
  name: string;
  fullName: string;
  email: string;
  slackId: string | null;
  role: string;
}

// Mirrors the `name` field semantics in DonorAnnotations.tsx: prefer the
// short assignee_key (e.g. "RBK") since that's what gets typed after `@`;
// fall back to the first word of display_name so newly-added members
// without an assignee_key still show up usable.
function deriveName(row: MemberRow): string {
  const key = (row.assignee_key || '').trim();
  if (key) return key;
  const dn = (row.display_name || '').trim();
  if (dn) return dn.split(/\s+/)[0];
  return row.email.split('@')[0] || row.email;
}

// True when the member should see the requested module — either they're
// an owner (sees everything) or their allowed_modules grants it. Module
// rows in allowed_modules can be either `true` (legacy) or
// `{ enabled: true, ... }` (granular Phase 4 shape).
function memberCanSeeModule(row: MemberRow, moduleKey: string): boolean {
  if (row.role === 'owner') return true;
  const m = row.allowed_modules?.[moduleKey];
  if (m === true) return true;
  if (m && typeof m === 'object' && 'enabled' in m) {
    return (m as { enabled?: unknown }).enabled === true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  const url = new URL(request.url);
  const moduleFilter = (url.searchParams.get('module') || '').trim();

  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('id, display_name, email, slack_user_id, assignee_key, role, allowed_modules')
    .eq('workspace_id', wsId)
    .order('display_name', { ascending: true });

  if (error) {
    console.error('[mentionable-users] query failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  let rows = (data ?? []) as MemberRow[];
  if (moduleFilter) {
    rows = rows.filter(r => memberCanSeeModule(r, moduleFilter));
  }

  const users: MentionableUser[] = rows.map(r => ({
    id: r.id,
    name: deriveName(r),
    fullName: r.display_name || r.email.split('@')[0] || r.email,
    email: r.email,
    slackId: r.slack_user_id,
    role: r.role,
  }));

  return NextResponse.json({ users });
}
