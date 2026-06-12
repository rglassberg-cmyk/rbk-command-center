import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getEffectiveModules } from '@/lib/modules';
import { getEffectiveWorkspaceId } from '@/lib/impersonate';

interface GrantRow {
  id: string;
  workspace_id: string;
  grant_number: string | null;
  confirmed_payment: string | null;
  date_received: string | null;
  initiative: string | null;
  category: string | null;
  organization_person: string | null;
  link: string | null;
  what_funding: string | null;
  wire_status: string | null;
  submitted_by: string | null;
  contact_info: string | null;
  funding_amount: number;
  grant_not_given: boolean;
  notes: string | null;
  submitted_to_procurify: string | null;
  date_wire_sent: string | null;
  wire_was_sent: boolean;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

async function gate(): Promise<{ wsId: string; session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>> } | { error: NextResponse }> {
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
  return { wsId, session };
}

export async function GET() {
  const g = await gate();
  if ('error' in g) return g.error;
  const { data, error } = await supabaseAdmin
    .from('israel_fund_grants')
    .select('*')
    .eq('workspace_id', g.wsId)
    .order('date_received', { ascending: false, nullsFirst: false })
    .order('grant_number', { ascending: true });
  if (error) {
    console.error('[israel-fund/grants GET] query failed:', error);
    return NextResponse.json({ error: 'Failed to load grants' }, { status: 500 });
  }
  return NextResponse.json({ grants: (data ?? []) as GrantRow[] });
}

export async function POST(request: NextRequest) {
  const g = await gate();
  if ('error' in g) return g.error;
  let body: Partial<GrantRow>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const initiative = typeof body.initiative === 'string' ? body.initiative.trim() : '';
  const fundingAmount = typeof body.funding_amount === 'number' ? body.funding_amount : NaN;
  if (!initiative) {
    return NextResponse.json({ error: 'initiative is required' }, { status: 400 });
  }
  if (!Number.isFinite(fundingAmount)) {
    return NextResponse.json({ error: 'funding_amount must be a number' }, { status: 400 });
  }

  // Whitelist the fields a client can submit. workspace_id +
  // timestamps + the primary key are server-controlled.
  const insertRow = {
    workspace_id: g.wsId,
    grant_number: body.grant_number ?? null,
    confirmed_payment: body.confirmed_payment ?? null,
    date_received: body.date_received ?? null,
    initiative,
    category: body.category ?? null,
    organization_person: body.organization_person ?? null,
    link: body.link ?? null,
    what_funding: body.what_funding ?? null,
    wire_status: body.wire_status ?? null,
    submitted_by: body.submitted_by ?? null,
    contact_info: body.contact_info ?? null,
    funding_amount: fundingAmount,
    grant_not_given: body.grant_not_given === true,
    notes: body.notes ?? null,
    submitted_to_procurify: body.submitted_to_procurify ?? null,
    date_wire_sent: body.date_wire_sent ?? null,
    wire_was_sent: body.wire_was_sent === true,
    is_visible: body.is_visible !== false, // default true
  };

  const { data, error } = await supabaseAdmin
    .from('israel_fund_grants')
    .insert(insertRow)
    .select('*')
    .single();
  if (error) {
    console.error('[israel-fund/grants POST] insert failed:', error);
    return NextResponse.json({ error: 'Failed to create grant' }, { status: 500 });
  }
  return NextResponse.json({ grant: data as GrantRow }, { status: 201 });
}
