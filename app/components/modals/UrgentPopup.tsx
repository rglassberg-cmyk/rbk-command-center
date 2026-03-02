'use client';

import type { Email } from '@/types';

function getGmailUrl(messageId: string | null | undefined) {
  if (!messageId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

interface UrgentPopupProps {
  emails: Email[];
  onViewAndRespond: (emailId: string) => void;
  onMarkDone: (emailId: string, status: string) => Promise<void>;
  onClose: () => void;
}

export function UrgentPopup({ emails, onViewAndRespond, onMarkDone, onClose }: UrgentPopupProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Urgent ({emails.length})</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&#10005;</button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-3">
          {emails.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No urgent items</p>
          ) : (
            emails.map((email) => (
              <div key={email.id} className="bg-white border border-red-200 border-l-4 border-l-red-500 rounded-lg p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{email.subject}</p>
                    <p className="text-sm text-slate-500 mt-1">{email.from_name || email.from_email}</p>
                    <p className="text-sm text-slate-600 mt-2">{email.summary}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => onViewAndRespond(email.id)}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                  >
                    View & Respond
                  </button>
                  <button
                    onClick={() => onMarkDone(email.id, 'done')}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                  >
                    Done
                  </button>
                  {email.attachments && email.attachments.length > 0 && getGmailUrl(email.message_id) && (
                    <a
                      href={getGmailUrl(email.message_id)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium"
                    >
                      View Attachments
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default UrgentPopup;
