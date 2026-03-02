'use client';

import { formatDistanceToNow } from 'date-fns';
import { priorityConfig, draftStatusConfig } from '@/lib/constants';
import type { Email } from '@/types';

interface EmilyQueueViewProps {
  emails: Email[];
  expandedEmail: string | null;
  setExpandedEmail: (id: string | null) => void;
  onUpdateStatus: (emailId: string, status: string) => Promise<void>;
  onEditDraft: (emailId: string, draftText: string) => void;
  onMarkSectionDone: (emailIds: string[]) => Promise<void>;
  onSaveDraft: (emailId: string, draft: string, markReady?: boolean) => Promise<void>;
  bulkUpdating: boolean;
  sendingEmail: string | null;
}

export function EmilyQueueView({
  emails,
  expandedEmail,
  setExpandedEmail,
  onUpdateStatus,
  onEditDraft,
  onMarkSectionDone,
  bulkUpdating,
}: EmilyQueueViewProps) {
  const emilyQueue = emails.filter(e =>
    (e.priority === 'eg_action' || e.draft_status === 'needs_revision') &&
    e.status !== 'done' && e.status !== 'archived'
  );
  const needsRevisionEmails = emails.filter(e =>
    e.draft_status === 'needs_revision' && e.status !== 'done' && e.status !== 'archived'
  );

  const stripSignature = (text: string): string => {
    if (!text) return '';
    const lines = text.split('\n');
    const cutPatterns = [/^--\s*$/, /^_{3,}/, /principal/i, /head of school/i, /\d{3}[-.\s]\d{3}[-.\s]\d{4}/, /www\./i, /@\w+\.\w+/, /sent from my/i];
    let cutIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (cutPatterns.some(p => p.test(lines[i]))) { cutIndex = i; break; }
    }
    return lines.slice(0, cutIndex).join('\n').replace(/^>+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  };

  const EmailCard = ({ email }: { email: Email }) => {
    const priority = priorityConfig[email.priority] || priorityConfig.fyi;
    const isExpanded = expandedEmail === email.id;
    const cleanBody = stripSignature(email.body_text || email.summary);
    const draftValue = email.edited_draft || email.draft_reply || '';

    return (
      <div className={`bg-white border border-slate-200 rounded-xl mb-2 shadow-sm transition-all duration-150 ${priority.borderLeft} ${isExpanded ? 'ring-2 ring-blue-200 ring-offset-1' : 'hover:shadow-md'} ${email.status === 'done' ? 'opacity-60' : ''}`}>
        <div className="p-3 cursor-pointer" onClick={() => setExpandedEmail(isExpanded ? null : email.id)}>
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <h3 className={`text-slate-800 text-sm font-semibold leading-snug ${email.status === 'done' ? 'line-through text-slate-400' : ''}`}>
              {email.subject}
            </h3>
            <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
            </span>
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-xs">{email.from_name || email.from_email}</p>
          </div>
          {!isExpanded && (
            <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{email.summary}</p>
          )}
        </div>

        {isExpanded && (
          <div className="px-3 pb-3" onClick={(e) => e.stopPropagation()}>
            {email.action_needed && email.action_needed !== 'No action needed' && (
              <div className="mb-3 bg-white border border-slate-100 border-l-4 border-l-orange-400 rounded-xl shadow-md px-4 py-3 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Action Needed</p>
                  <p className="text-sm text-slate-700">{email.action_needed}</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex-[4] min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Original Email</p>
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {cleanBody || email.summary}
                </div>
              </div>
              <div className="flex-[5] min-w-0">
                <div className="bg-white rounded-xl shadow-md border border-slate-100 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Draft Reply</p>
                    <span className={`text-xs font-medium ${email.draft_status === 'draft_ready' ? 'text-green-600' : email.draft_status === 'approved' ? 'text-blue-600' : 'text-slate-400'}`}>
                      {draftStatusConfig[email.draft_status || 'not_started']?.label || 'Not Started'}
                    </span>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 text-xs text-slate-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {draftValue || 'No draft yet'}
                  </div>
                  <button
                    onClick={() => onEditDraft(email.id, draftValue)}
                    className="w-full px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                  >
                    Edit Draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          Emily&apos;s Queue
          <span className="ml-2 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-sm font-medium">
            {emilyQueue.length}
          </span>
        </h3>
        {emilyQueue.length > 0 && (
          <button
            onClick={() => onMarkSectionDone(emilyQueue.map(e => e.id))}
            disabled={bulkUpdating}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            Mark All Done
          </button>
        )}
      </div>

      {emilyQueue.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
          <p className="text-slate-400">No emails in Emily&apos;s queue</p>
          <p className="text-sm text-slate-400 mt-1">All caught up!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {needsRevisionEmails.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                Needs Revision ({needsRevisionEmails.length})
              </h4>
              <div className="space-y-3">
                {needsRevisionEmails.map((email) => (
                  <div key={email.id} className="bg-white border border-amber-200 border-l-4 border-l-amber-500 rounded-xl p-4 shadow-sm">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-slate-900">{email.subject}</p>
                        <p className="text-sm text-slate-500">{email.from_name || email.from_email}</p>
                      </div>
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded text-xs font-medium">
                        Needs Revision
                      </span>
                    </div>
                    {email.revision_comment && (
                      <div className="bg-slate-50 rounded-lg p-3 mt-2 border border-slate-100">
                        <p className="text-xs font-medium text-amber-700 mb-1">Comment from RBK:</p>
                        <p className="text-sm text-slate-700">{email.revision_comment}</p>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => onEditDraft(email.id, email.edited_draft || email.draft_reply || '')}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        Edit Draft
                      </button>
                      <button
                        onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        View Email
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {emilyQueue.filter(e => e.draft_status !== 'needs_revision').length > 0 && (
            <div>
              {needsRevisionEmails.length > 0 && (
                <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">Other Emails</h4>
              )}
              <div className="space-y-4">
                {emilyQueue.filter(e => e.draft_status !== 'needs_revision').map((email) => (
                  <EmailCard key={email.id} email={email} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default EmilyQueueView;
