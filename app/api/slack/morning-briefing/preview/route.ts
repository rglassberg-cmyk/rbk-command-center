import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/auth';
import { generateAllBriefings, DRY_RUN } from '@/lib/morningBriefing';
import { BOT_NAME } from '@/lib/buzzBot';

// Admin-only preview endpoint. Always forces dryRun=true regardless of
// the DRY_RUN constant — even if Becca flips DRY_RUN=false later in
// lib/morningBriefing.ts, preview still won't post to Slack. The
// `dryRun` field in the response reflects the runtime constant so the
// admin UI can show the correct banner.
const ADMIN_EMAIL = 'rglassberg@saracademy.org';

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.email.toLowerCase() !== ADMIN_EMAIL && session.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Preview always forces dryRun and bypasses the weekend skip so
    // Becca can iterate on any day.
    const briefings = await generateAllBriefings({ dryRun: true, forceWeekend: true });
    return NextResponse.json({
      botName: BOT_NAME,
      dryRunConstant: DRY_RUN,
      previewForcedDryRun: true,
      generatedAt: new Date().toISOString(),
      briefings,
    });
  } catch (err) {
    console.error('[BUZZ PREVIEW] Failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Preview failed' },
      { status: 500 },
    );
  }
}
