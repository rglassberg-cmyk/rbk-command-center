import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Attachment interface matching Apps Script getAttachmentInfo()
interface Attachment {
  name: string;
  type: string;
  size: number;
}

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
  priority: 'owner_action' | 'assistant_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi' | 'drafts_ready';
  category: string;
  summary: string;
  action_needed?: string;
  draft_reply?: string;
  assigned_to: 'rbk' | 'emily';
  labels?: string[];
  attachments?: Attachment[];
  is_starred?: boolean;
  is_unread?: boolean;
  draft_status?: 'not_started' | 'editing' | 'draft_ready' | 'approved' | 'needs_revision' | null;
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

    console.log('[Webhook] Incoming payload:', JSON.stringify({
      priority: payload.priority,
      draft_status: payload.draft_status,
      message_id: payload.message_id,
      subject: payload.subject?.substring(0, 50),
      has_draft_reply: !!payload.draft_reply,
    }));

    // Validate required fields
    if (!payload.thread_id || !payload.message_id || !payload.from || !payload.subject) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Remap 'drafts_ready' priority to valid DB value + set draft_status
    if (payload.priority === 'drafts_ready') {
      payload.priority = 'owner_action';
      payload.draft_status = 'draft_ready';
    }

    // Extract email and name from "Name <email@domain.com>" format
    const fromMatch = payload.from.match(/(.+?)\s*<(.+?)>/);
    const fromName = fromMatch ? fromMatch[1].trim() : null;
    const fromEmail = fromMatch ? fromMatch[2].trim() : payload.from;

    // Parse received date
    const receivedAt = new Date(payload.date);
    const processedAt = new Date(); // Current time

    // Resolve workspace_id — use RBK's seed workspace (only workspace for now)
    const RBK_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

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
        attachments: payload.attachments || [],
        is_starred: payload.is_starred || false,
        is_unread: payload.is_unread !== false, // Default to true
        received_at: receivedAt.toISOString(),
        processed_at: processedAt.toISOString(),
        workspace_id: RBK_WORKSPACE_ID,
        ...(payload.draft_status ? { draft_status: payload.draft_status } : {}),
      })
      .select()
      .single();

    if (error) {
      // Check if it's a duplicate message_id
      if (error.code === '23505') {
        // If draft_status or draft_reply provided, update the existing email
        console.log('[Webhook] Duplicate detected (23505), updating draft fields:', {
          draft_status: payload.draft_status,
          has_draft_reply: !!payload.draft_reply,
          message_id: payload.message_id,
        });
        if (payload.draft_status || payload.draft_reply) {
          const updateFields: Record<string, string> = {};
          if (payload.draft_status) updateFields.draft_status = payload.draft_status;
          if (payload.draft_reply) updateFields.draft_reply = payload.draft_reply;

          const { data: updateData, error: updateError } = await supabaseAdmin
            .from('emails')
            .update(updateFields)
            .eq('message_id', payload.message_id)
            .select('id, draft_status, message_id')
            .single();

          if (updateError) {
            console.error('[Webhook] Failed to update on duplicate:', updateError);
          } else {
            console.log('[Webhook] Duplicate update success:', JSON.stringify(updateData));
          }
        } else {
          console.log('[Webhook] Duplicate ignored — no draft fields to update:', payload.message_id);
        }
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

    console.log('[Webhook] Email stored successfully:', JSON.stringify({ id: data.id, draft_status: data.draft_status, priority: data.priority, subject: payload.subject?.substring(0, 50) }));

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
