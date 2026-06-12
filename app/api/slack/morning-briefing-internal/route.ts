import { NextRequest, NextResponse } from 'next/server';
import { generateAllBriefings, DRY_RUN } from '@/lib/morningBriefing';

// Internal trigger for the Cloud Function. Shared-secret-auth, same
// pattern as sync-gifts-internal / sync-constituents-internal.
//
// Honors the DRY_RUN constant in lib/morningBriefing.ts. While that
// stays true, this endpoint never posts to Slack — making Cloud Run
// invocation safe even before Becca approves live sends.
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-internal-secret');
  const expectedSecret = process.env.INTERNAL_SYNC_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const briefings = await generateAllBriefings({ dryRun: DRY_RUN });
    return NextResponse.json({
      success: true,
      dryRun: DRY_RUN,
      count: briefings.length,
      briefings,
    });
  } catch (err) {
    console.error('[BUZZ INTERNAL] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal briefing run failed' },
      { status: 500 },
    );
  }
}
