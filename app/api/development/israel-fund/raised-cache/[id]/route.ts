import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules, hasSubPermission } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

// PATCH /api/development/israel-fund/raised-cache/[id]
//
// Editor-only patch for a single `israel_fund_raised_cache` row.
// Accepts any combination of:
//   - `is_excluded`        (boolean) — per-row eye icon hide/restore
//   - `manual_raised`      (number)  — editor top-up for money that
//                                      never flows through Veracross
//                                      (e.g. a Venmo fundraiser)
//   - `manual_raised_note` (string)  — free-text context for the top-up
// `raised` / `seed_raised` / `gift_count` remain off-limits — they're
// owned by the sync + CSV seed, not manual UI edits.

const EMILY_EMAIL = 'egray@saracademy.org';
const BECCA_EMAIL = 'rglassberg@saracademy.org';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;

  // Module gating
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return NextResponse.json({ error: 'Module not enabled' }, { status: 403 });
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 });
    }
  } catch { /* fail open */ }

  // Editor gate — mirrors the `canEditGrants` rule in IsraelFundTab.tsx.
  const callerEmail = session.user.email.toLowerCase();
  const isEditor =
    hasSubPermission(session.allowedModules ?? null, 'development', 'israel_fund_editor') ||
    callerEmail === EMILY_EMAIL ||
    callerEmail === BECCA_EMAIL ||
    session.role === 'owner';
  if (!isEditor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Build the update payload from whichever recognized fields are
  // present. At least one must be supplied.
  const updates: Record<string, unknown> = {};

  if ('is_excluded' in body) {
    if (typeof body.is_excluded !== 'boolean') {
      return NextResponse.json({ error: 'is_excluded must be boolean' }, { status: 400 });
    }
    updates.is_excluded = body.is_excluded;
  }

  if ('manual_raised' in body) {
    const mr = body.manual_raised;
    if (typeof mr !== 'number' || !Number.isFinite(mr) || mr < 0) {
      return NextResponse.json({ error: 'manual_raised must be a non-negative number' }, { status: 400 });
    }
    updates.manual_raised = mr;
  }

  if ('manual_raised_note' in body) {
    const note = body.manual_raised_note;
    if (note !== null && typeof note !== 'string') {
      return NextResponse.json({ error: 'manual_raised_note must be a string or null' }, { status: 400 });
    }
    // Normalize empty/whitespace-only notes to null.
    const trimmed = typeof note === 'string' ? note.trim() : null;
    updates.manual_raised_note = trimmed ? trimmed : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // Verify the row exists and belongs to this caller's workspace.
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('israel_fund_raised_cache')
    .select('id, workspace_id')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('[raised-cache/:id PATCH] lookup failed:', lookupError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.workspace_id !== wsId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  updates.last_updated = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('israel_fund_raised_cache')
    .update(updates)
    .eq('id', id);
  if (updateError) {
    console.error('[raised-cache/:id PATCH] update failed:', updateError);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
