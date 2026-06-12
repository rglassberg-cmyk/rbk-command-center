import { NextResponse, type NextRequest } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { memberCanSeeDivision, DIVISION_ACADEMY, DIVISION_HS } from '@/lib/divisions';
import { getEffectiveDivisions } from '@/lib/impersonate';
import { applyDivisionParam } from '@/lib/divisionParam';
import { getLeverCredentials } from '@/lib/getIntegration';

const LEVER_BASE = 'https://api.lever.co/v1';

function leverAuth(apiKey: string): string {
  return `Basic ${Buffer.from(apiKey + ':').toString('base64')}`;
}

function isHighSchool(posting: { categories?: { department?: string; team?: string } }): boolean {
  const dept = posting.categories?.department || '';
  const team = posting.categories?.team || '';
  return dept === 'SAR High School' || team.includes('High School');
}

export async function GET(request: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user?.email || !session.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Phase D hotfix: impersonation-aware + division-toggle param.
  const callerDivisions = await getEffectiveDivisions(session);
  const memberDivisions = applyDivisionParam(
    new URL(request.url).searchParams.get('division'),
    callerDivisions,
  );
  const canSeeAcademy = memberCanSeeDivision(memberDivisions, DIVISION_ACADEMY);
  const canSeeHs = memberCanSeeDivision(memberDivisions, DIVISION_HS);
  console.log('[lever] callerDivisions=', callerDivisions, 'effective=', memberDivisions, 'canSeeAcademy=', canSeeAcademy, 'canSeeHs=', canSeeHs, 'user=', session.user.email);

  try {
    const { apiKey: leverApiKey } = await getLeverCredentials(session.workspaceId);
    const headers = { Authorization: leverAuth(leverApiKey), Accept: 'application/json' };

    // Fetch postings + stages in parallel, paginate opportunities separately
    const [postingsRes, stagesRes] = await Promise.all([
      fetch(`${LEVER_BASE}/postings?state=published&state=internal&limit=100`, { headers }),
      fetch(`${LEVER_BASE}/stages`, { headers }),
    ]);

    if (!postingsRes.ok || !stagesRes.ok) {
      const err = !postingsRes.ok ? await postingsRes.text() : await stagesRes.text();
      console.error('Lever API error:', err);
      throw new Error('Lever API error');
    }

    const [postingsJson, stagesJson] = await Promise.all([
      postingsRes.json(),
      stagesRes.json(),
    ]);

    // Paginate all active opportunities
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allOpportunities: any[] = [];
    let offset: string | null = null;
    let hasMore = true;
    while (hasMore) {
      const oppUrl: string = `${LEVER_BASE}/opportunities?limit=100&expand=applications&archived=false${offset ? `&offset=${offset}` : ''}`;
      const oppRes: Response = await fetch(oppUrl, { headers });
      if (!oppRes.ok) break;
      const oppJson: { data?: any[]; hasNext?: boolean; next?: string } = await oppRes.json();
      allOpportunities.push(...(oppJson.data || []));
      if (!oppJson.hasNext || !oppJson.next) { hasMore = false; } else { offset = oppJson.next; }
    }

    const postings = (postingsJson.data || []).filter((p: any) => {
      const isHs = isHighSchool(p);
      return isHs ? canSeeHs : canSeeAcademy;
    });
    const opportunities = allOpportunities;
    const stages = stagesJson.data || [];
    console.log('[LEVER] Fetched', opportunities.length, 'opportunities,', postings.length, 'postings');

    return NextResponse.json({ postings, opportunities, stages });
  } catch (error) {
    console.error('Error fetching Lever data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Lever data', postings: [], opportunities: [], stages: [] },
      { status: 200 }
    );
  }
}
