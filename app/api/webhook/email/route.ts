import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Webhook payload interface matching Apps Script
interface EmailWebhookPayload {
  thread_id: string;
  message_id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  body_html?: string;
  date: string;
  priority: 'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi';
  category: string;
  summary: string;
  action_needed?: string;
  draft_reply?: string;
  assigned_to: 'rbk' | 'emily';
  labels?: string[];
  attachments?: any;
  is_starred?: boolean;
  is_unread?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const authHeader = request.headers.get('authorization');
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret) {
      console.error('WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error('Invalid webhook secret');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const payload: EmailWebhookPayload = await request.json();

    // Validate required fields
    if (!payload.thread_id || !payload.message_id || !payload.from || !payload.subject) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Extract email and name from "Name <email@domain.com>" format
    const fromMatch = payload.from.match(/(.+?)\s*<(.+?)>/);
    const fromName = fromMatch ? fromMatch[1].trim() : null;
    const fromEmail = fromMatch ? fromMatch[2].trim() : payload.from;

    // Parse received date
    const receivedAt = new Date(payload.date);
    const processedAt = new Date(); // Current time

    // Insert email into database
    const { data, error } = await supabaseAdmin
      .from('emails')
      .insert({
        thread_id: payload.thread_id,
        message_id: payload.message_id,
        from_email: fromEmail,
        from_name: fromName,
        to_email: payload.to,
        subject: payload.subject,
        body_text: payload.body,
        body_html: payload.body_html || null,
        priority: payload.priority,
        category: payload.category,
        summary: payload.summary,
        action_needed: payload.action_needed || null,
        draft_reply: payload.draft_reply || null,
        assigned_to: payload.assigned_to,
        status: 'pending',
        labels: payload.labels || [],
        attachments: payload.attachments || null,
        is_starred: payload.is_starred || false,
        is_unread: payload.is_unread !== false, // Default to true
        received_at: receivedAt.toISOString(),
        processed_at: processedAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      // Check if it's a duplicate message_id
      if (error.code === '23505') {
        console.log(`Duplicate email ignored: ${payload.message_id}`);
        return NextResponse.json(
          { status: 'duplicate', message: 'Email already processed' },
          { status: 200 }
        );
      }

      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      );
    }

    console.log(`Email stored successfully: ${data.id} (${payload.subject})`);

    // Return success response
    return NextResponse.json({
      status: 'success',
      email_id: data.id,
      message: 'Email processed and stored',
    });

  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Email webhook endpoint is ready',
    timestamp: new Date().toISOString(),
  });
}
