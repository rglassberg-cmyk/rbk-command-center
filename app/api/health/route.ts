import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: 'unknown', latency: 0 },
      webhook: { status: 'ready' },
    },
    stats: {
      totalEmails: 0,
      pendingEmails: 0,
      lastEmailReceived: null as string | null,
    },
  };

  try {
    // Check database connection
    const dbStart = Date.now();
    const { count, error: countError } = await supabaseAdmin
      .from('emails')
      .select('*', { count: 'exact', head: true });

    checks.checks.database.latency = Date.now() - dbStart;

    if (countError) {
      checks.status = 'unhealthy';
      checks.checks.database.status = 'error: ' + countError.message;
    } else {
      checks.checks.database.status = 'connected';
      checks.stats.totalEmails = count || 0;
    }

    // Get pending count
    const { count: pendingCount } = await supabaseAdmin
      .from('emails')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    checks.stats.pendingEmails = pendingCount || 0;

    // Get last email received
    const { data: lastEmail } = await supabaseAdmin
      .from('emails')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();

    if (lastEmail) {
      checks.stats.lastEmailReceived = lastEmail.received_at;
    }

    return NextResponse.json(checks, {
      status: checks.status === 'healthy' ? 200 : 503,
    });
  } catch (error: any) {
    checks.status = 'unhealthy';
    checks.checks.database.status = 'error: ' + error.message;

    return NextResponse.json(checks, { status: 503 });
  }
}
