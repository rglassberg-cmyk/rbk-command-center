'use client';

import { formatDistanceToNow, parseISO } from 'date-fns';
import { priorityConfig } from '@/lib/constants';
import type { Email } from '@/types';

interface EmailPopupProps {
  email: Email;
  popupDraftText: string;
  setPopupDraftText: (text: string) => void;
  onSaveDraft: (emailId: string, draft: string, markReady?: boolean) => Promise<void>;
  onOpenFullView: (emailId: string) => void;
  onClose: () => void;
}

function getGmailUrl(messageId: string | null | undefined) {
  if (!messageId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

export function EmailPopup({ email, popupDraftText, setPopupDraftText, onSaveDraft, onOpenFullView, onClose }: EmailPopupProps) {
  const config = priorityConfig[email.priority];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900 text-base leading-snug truncate">{email.subject}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{email.from_name || email.from_email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Meta row */}
          <div className="flex items-center gap-3">
            {config && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.textColor}`}>
                {config.label}
              </span>
            )}
            <span className="text-xs text-slate-400">{formatDistanceToNow(parseISO(email.received_at), { addSuffix: true })}</span>
          </div>

          {/* Summary */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Summary</p>
            <p className="text-sm text-slate-700 leading-relaxed">{email.summary}</p>
          </div>

          {/* Action needed */}
          {email.action_needed && email.action_needed !== 'None' && email.action_needed !== 'No action needed' && (
            <div className="bg-white border border-slate-100 border-l-4 border-l-orange-400 rounded-xl shadow-md px-4 py-3 flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-orange-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Action Needed</p>
                <p className="text-sm text-slate-700">{email.action_needed}</p>
              </div>
            </div>
          )}

          {/* Original email */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Full Email</p>
            <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {(email.body_text || '').replace(/^>+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim()}
            </div>
          </div>

          {/* Draft reply */}
          <div className="bg-white rounded-xl shadow-md border border-slate-100 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Draft Reply</p>
              <span className={`text-xs font-medium ${email.draft_status === 'draft_ready' ? 'text-green-600' : email.draft_status === 'approved' ? 'text-blue-600' : 'text-slate-400'}`}>
                {email.draft_status === 'draft_ready' ? 'Ready' : email.draft_status === 'approved' ? 'Approved' : 'Editing'}
              </span>
            </div>
            <textarea
              className="w-full text-sm text-slate-700 border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white leading-relaxed"
              rows={6}
              placeholder="Draft a reply..."
              value={popupDraftText}
              onChange={(e) => setPopupDraftText(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => onSaveDraft(email.id, popupDraftText, false)}
                className="px-4 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
              >
                Save Draft
              </button>
              <button
                onClick={() => onSaveDraft(email.id, popupDraftText, true)}
                className="flex-1 px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
              >
                Mark Ready for Review
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            onClick={() => onOpenFullView(email.id)}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Open Full View
          </button>
          {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
            <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              View in Gmail
            </a>
          )}
          <button onClick={onClose} className="ml-auto text-sm text-slate-400 hover:text-slate-600 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmailPopup;
