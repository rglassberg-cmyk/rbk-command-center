'use client';

import type { Email } from '@/types';

interface DraftsPopupProps {
  draftsReady: Email[];
  draftsApproved: Email[];
  sendingEmail: string | null;
  sendingBatch: boolean;
  onSendEmail: (emailId: string) => Promise<void>;
  onSendBatch: (emailIds: string[]) => Promise<void>;
  onClose: () => void;
}

export function DraftsPopup({ draftsReady, draftsApproved, sendingEmail, sendingBatch, onSendEmail, onSendBatch, onClose }: DraftsPopupProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Drafts Ready for Review</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
        </div>
        <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
          {draftsReady.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No drafts ready for review</p>
          ) : (
            draftsReady.map((email) => (
              <div key={email.id} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-slate-900">{email.subject}</p>
                    <p className="text-sm text-slate-500">To: {email.from_email}</p>
                  </div>
                  <button
                    onClick={() => onSendEmail(email.id)}
                    disabled={sendingEmail === email.id}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {sendingEmail === email.id ? 'Sending...' : 'Send'}
                  </button>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 mt-2">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">
                    {(email.edited_draft || email.draft_reply)?.substring(0, 200)}...
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
        {draftsApproved.length > 0 && (
          <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
            <button
              onClick={() => onSendBatch(draftsApproved.map(e => e.id))}
              disabled={sendingBatch}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {sendingBatch ? 'Sending All...' : `Send All Approved (${draftsApproved.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DraftsPopup;
