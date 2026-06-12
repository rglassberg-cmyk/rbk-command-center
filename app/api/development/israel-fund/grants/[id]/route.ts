import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';
import { sendSlackDM } from '@/lib/slackNotifications';
import { getSlackCredentials } from '@/lib/getIntegration';

const EMILY_EMAIL = 'egray@saracademy.org';

// Slack recipients for the "wire sent" notification. Hardcoded
// per-role rather than looked up by email because these are
// role-specific recipients regardless of who initiated the wire.
const RBK_SLACK_USER_ID = 'U04NBR22Y';
const EMILY_SLACK_USER_ID = 'U05M5KT86GK';

// Fields a client may update via PATCH. workspace_id, id, created_at
// are server-managed; updated_at is overwritten on every successful
// patch.
const PATCHABLE_FIELDS = new Set([
  'grant_number',
  'confirmed_payment',
  'date_received',
  'initiative',
  'category',
  'organization_person',
  'link',
  'what_funding',
  'wire_status',
  'submitted_by',
  'contact_info',
  'funding_amount',
  'grant_not_given',
  'notes',
  'submitted_to_procurify',
  'procurify_number',
  'date_wire_sent',
  'wire_was_sent',
  'is_visible',
]);

async function gateAndOwn(id: string) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const wsId = await getEffectiveWorkspaceId(session) || session.workspaceId;
  try {
    const { data: ws } = await supabaseAdmin
      .from('workspaces')
      .select('modules')
      .eq('id', wsId)
      .single();
    if (ws?.modules?.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled' }, { status: 403 }) };
    }
    const effective = getEffectiveModules(ws?.modules || null, session.allowedModules || null);
    if (effective && effective.development === false) {
      return { error: NextResponse.json({ error: 'Module not enabled for user' }, { status: 403 }) };
    }
  } catch { /* fail open */ }

  // Verify the row exists and belongs to this caller's workspace.
  const { data: existing, error } = await supabaseAdmin
    .from('israel_fund_grants')
    .select('id, workspace_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[israel-fund/grants/:id gate] lookup failed:', error);
    return { error: NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) };
  }
  if (!existing) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  if (existing.workspace_id !== wsId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { wsId, session };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await gateAndOwn(id);
  if ('error' in g) return g.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  if ('funding_amount' in updates) {
    const fa = updates.funding_amount;
    if (typeof fa !== 'number' || !Number.isFinite(fa)) {
      return NextResponse.json({ error: 'funding_amount must be a number' }, { status: 400 });
    }
  }
  if ('initiative' in updates) {
    const init = updates.initiative;
    if (typeof init !== 'string' || init.trim() === '') {
      return NextResponse.json({ error: 'initiative must be a non-empty string' }, { status: 400 });
    }
    updates.initiative = init.trim();
  }

  updates.updated_at = new Date().toISOString();

  // Capture prior wire_was_sent so we can fire the Slack notification
  // only on the false/null → true transition. Single extra read for
  // the row we're about to update.
  let priorWireSent: boolean | null = null;
  if ('wire_was_sent' in updates) {
    const { data: prior } = await supabaseAdmin
      .from('israel_fund_grants')
      .select('wire_was_sent')
      .eq('id', id)
      .maybeSingle();
    priorWireSent = (prior?.wire_was_sent as boolean | null) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from('israel_fund_grants')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    console.error('[israel-fund/grants/:id PATCH] update failed:', error);
    return NextResponse.json({ error: 'Failed to update grant' }, { status: 500 });
  }

  // Fire the wire-sent DM only on the false/null → true transition.
  // Both RBK + Emily get the same message — RBK for awareness, Emily
  // for confirmation that the wire she initiated landed.
  if (data && data.wire_was_sent === true && priorWireSent !== true) {
    void (async () => {
      try {
        const { botToken } = await getSlackCredentials(g.wsId);
        if (!botToken) return;
        const initiative = (data.initiative as string | null) ?? '(unspecified initiative)';
        const orgPerson = (data.organization_person as string | null) ?? '(unspecified recipient)';
        const amount = Number(data.funding_amount ?? 0);
        const procurify = (data.procurify_number as string | null)?.trim();
        const procurifyLine = procurify ? `\nProcurify #${procurify}` : '';
        const formattedAmount = amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
        const message = `:money_with_wings: Wire sent: *${initiative}* grant\nto ${orgPerson}\nAmount: ${formattedAmount}${procurifyLine}`;
        await sendSlackDM(RBK_SLACK_USER_ID, message, botToken);
        await sendSlackDM(EMILY_SLACK_USER_ID, message, botToken);
      } catch (err) {
        console.warn('[israel-fund/grants/:id PATCH] wire-sent DM failed:', err);
      }
    })();
  }

  return NextResponse.json({ grant: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await gateAndOwn(id);
  if ('error' in g) return g.error;

  // Tightened ACL — deletion gated to Emily (the data owner) or any
  // workspace owner. Other users can edit via PATCH but can't remove
  // rows outright.
  const callerEmail = g.session.user.email?.toLowerCase() ?? '';
  const callerRole = g.session.role ?? '';
  if (callerEmail !== EMILY_EMAIL && callerRole !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from('israel_fund_grants')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('[israel-fund/grants/:id DELETE] failed:', error);
    return NextResponse.json({ error: 'Failed to delete grant' }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
