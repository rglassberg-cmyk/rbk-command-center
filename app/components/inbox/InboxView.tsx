'use client';

import { useState } from 'react';
import type { Email } from '@/types';
import { EmailSection } from './EmailSection';
import { DraftsPopup } from '../modals/DraftsPopup';

interface InboxViewProps {
  emails: Email[];
  expandedEmail: string | null;
  setExpandedEmail: (id: string | null) => void;
  selectedEmails: Set<string>;
  // Actions
  onUpdateStatus: (emailId: string, status: string) => Promise<void>;
  onUpdateActionStatus: (emailId: string, actionStatus: string | null) => Promise<void>;
  onToggleMeetingFlag: (emailId: string, currentlyFlagged: boolean) => Promise<void>;
  onEditDraft: (emailId: string, draftText: string) => void;
  onOpenEventModal: (email: Email) => void;
  onOpenRemindMe: (emailId: string) => void;
  onToggleEmailSelection: (emailId: string) => void;
  onMarkSelectedDone: () => Promise<void>;
  onMarkSectionDone: (emailIds: string[]) => Promise<void>;
  onClearSelection: () => void;
  onSendEmail: (emailId: string) => Promise<void>;
  onSendBatchEmails: (emailIds: string[]) => Promise<void>;
  onApproveDraft: (emailId: string) => Promise<void>;
  onRequestRevision: (emailId: string) => void;
  bulkUpdating: boolean;
  sendingEmail: string | null;
  sendingBatch: boolean;
}

function isSnoozed(email: Email) {
  if (!email.reminder_date) return false;
  return new Date(email.reminder_date) > new Date();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getGmailUrl(messageId: string | null | undefined) {
  if (!messageId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

export function InboxView({
  emails,
  expandedEmail,
  setExpandedEmail,
  selectedEmails,
  onUpdateStatus,
  onUpdateActionStatus,
  onToggleMeetingFlag,
  onEditDraft,
  onOpenEventModal,
  onOpenRemindMe,
  onToggleEmailSelection,
  onMarkSelectedDone,
  onMarkSectionDone,
  onClearSelection,
  onSendEmail,
  onSendBatchEmails,
  onApproveDraft,
  onRequestRevision,
  bulkUpdating,
  sendingEmail,
  sendingBatch,
}: InboxViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDraftsPopup, setShowDraftsPopup] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    important_no_action: false,
    review: false,
    invitation: false,
    fyi: false,
  });

  const matchesSearch = (email: Email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(query) ||
      email.from_email.toLowerCase().includes(query) ||
      (email.from_name?.toLowerCase().includes(query) ?? false) ||
      email.summary.toLowerCase().includes(query) ||
      email.body_text.toLowerCase().includes(query)
    );
  };

  const urgentAlerts = emails.filter(e => e.action_status === 'urgent' && e.status !== 'done' && e.status !== 'archived' && matchesSearch(e));
  const rbkActionEmails = emails.filter(e => e.priority === 'rbk_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const emilyActionEmails = emails.filter(e => e.priority === 'eg_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const importantNoAction = emails.filter(e => e.priority === 'important_no_action' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const reviewEmails = emails.filter(e => e.priority === 'review' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const invitationEmails = emails.filter(e => e.priority === 'invitation' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const fyiEmails = emails.filter(e => e.priority === 'fyi' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && matchesSearch(e));
  const draftsReady = emails.filter(e => e.draft_status === 'draft_ready' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e));
  const draftsApproved = emails.filter(e => e.draft_status === 'approved' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e));

  const renderExpandedContent = (email: Email) => (
    <div className="mt-3 pt-3 border-t border-slate-200" onClick={(e) => e.stopPropagation()}>
      {email.attachments && email.attachments.length > 0 && (
        <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-amber-800">
              {email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}
            </p>
            {getGmailUrl(email.message_id) && (
              <a href={getGmailUrl(email.message_id)!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors">
                View Attachments &rarr;
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {email.attachments.map((att, idx) => (
              <span key={idx} className="bg-white text-slate-700 px-2 py-0.5 rounded text-xs border border-amber-200">
                {att.name} ({formatFileSize(att.size)})
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="bg-slate-50 rounded-lg p-3 max-h-60 overflow-y-auto">
        <p className="text-slate-700 text-sm whitespace-pre-wrap">{email.body_text || email.summary}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button onClick={() => onUpdateStatus(email.id, 'done')} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors">
          Done
        </button>
        <button
          onClick={() => onUpdateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${email.action_status === 'urgent' ? 'bg-red-600 text-white' : 'border border-red-200 text-red-600 hover:bg-red-50'}`}
        >
          Urgent
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => onToggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-2 rounded-full hover:bg-slate-100 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-400'}`} title="Add to Agenda">
            {email.flagged_for_meeting ? '\u2605' : '\u2606'}
          </button>
          <button onClick={() => onEditDraft(email.id, email.edited_draft || email.draft_reply || '')} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Edit Draft">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={() => onOpenEventModal(email)} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Add to Calendar">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </button>
          <button onClick={() => onOpenRemindMe(email.id)} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Remind Me">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
          </button>
        </div>
      </div>
    </div>
  );

  const renderEmailRow = (email: Email, borderColor: string) => (
    <div
      key={email.id}
      onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
      className={`bg-white border border-slate-200 border-l-4 ${borderColor} rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md ${selectedEmails.has(email.id) ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selectedEmails.has(email.id)}
          onChange={(e) => { e.stopPropagation(); onToggleEmailSelection(email.id); }}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
        <div className="flex-1 min-w-0 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-slate-900 font-medium text-sm truncate">{email.subject}</p>
            <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
          </div>
          {email.attachments && email.attachments.length > 0 && (
            <span className="ml-2 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
              {email.attachments.length}
            </span>
          )}
        </div>
      </div>
      {expandedEmail === email.id && renderExpandedContent(email)}
    </div>
  );

  return (
    <>
      <div className="space-y-6">
        {/* Urgent Banner */}
        {urgentAlerts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                <div>
                  <p className="font-semibold text-slate-900">URGENT: {urgentAlerts.length} email{urgentAlerts.length > 1 ? 's' : ''} need immediate attention</p>
                  <p className="text-sm text-slate-600">{urgentAlerts[0].subject}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setExpandedEmail(urgentAlerts[0].id);
                  onUpdateActionStatus(urgentAlerts[0].id, null);
                }}
                className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
              >
                View Now
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search emails by subject, sender, or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-10 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <svg className="absolute left-3 top-3.5 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600">
              &#10005;
            </button>
          )}
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* RBK Action */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white pb-2">
                <h3 className="text-lg font-semibold text-slate-900">RBK Action Emails</h3>
                <div className="flex items-center gap-2">
                  {rbkActionEmails.length > 0 && (
                    <button onClick={() => onMarkSectionDone(rbkActionEmails.map(e => e.id))} disabled={bulkUpdating} className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                      All Done
                    </button>
                  )}
                  <span className={`${rbkActionEmails.length > 0 ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>
                    {rbkActionEmails.length}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {rbkActionEmails.length === 0 ? (
                  <p className="text-slate-500 text-sm">No action items</p>
                ) : (
                  rbkActionEmails.map(email => renderEmailRow(email, 'border-l-red-600'))
                )}
              </div>
            </div>

            {/* Emily Action */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4 sticky top-0 z-10 bg-white pb-2">
                <h3 className="text-lg font-semibold text-slate-900">Emily Action Emails</h3>
                <div className="flex items-center gap-2">
                  {emilyActionEmails.length > 0 && (
                    <button onClick={() => onMarkSectionDone(emilyActionEmails.map(e => e.id))} disabled={bulkUpdating} className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                      All Done
                    </button>
                  )}
                  <span className={`${emilyActionEmails.length > 0 ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>
                    {emilyActionEmails.length}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {emilyActionEmails.length === 0 ? (
                  <p className="text-slate-500 text-sm">No action items</p>
                ) : (
                  emilyActionEmails.map(email => renderEmailRow(email, 'border-l-violet-600'))
                )}
              </div>
            </div>

            {/* Bottom Buttons */}
            <div className="flex gap-4">
              <button onClick={() => setShowDraftsPopup(true)} className="flex-1 bg-blue-600 text-white px-4 py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                Drafts Ready
                {draftsReady.length > 0 && <span className="bg-white/20 px-2 py-0.5 rounded-full text-sm">{draftsReady.length}</span>}
              </button>
              <button disabled className="flex-1 bg-slate-100 text-slate-400 px-4 py-3 rounded-xl font-medium cursor-not-allowed border border-slate-200 flex items-center justify-center gap-2">
                TBD
              </button>
            </div>
          </div>

          {/* Right Column — Collapsible */}
          <div className="space-y-4">
            <EmailSection
              title="Important No Action"
              emails={importantNoAction}
              borderColor="border-l-amber-400"
              badgeColor={importantNoAction.length > 0 ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}
              isExpanded={expandedSections.important_no_action}
              onToggle={() => setExpandedSections(s => ({ ...s, important_no_action: !s.important_no_action }))}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              onMarkSectionDone={onMarkSectionDone}
              bulkUpdating={bulkUpdating}
              renderExpandedContent={renderExpandedContent}
            />
            <EmailSection
              title="Review"
              emails={reviewEmails}
              borderColor="border-l-amber-400"
              badgeColor={reviewEmails.length > 0 ? 'bg-slate-600 text-white' : 'bg-slate-200 text-slate-500'}
              isExpanded={expandedSections.review}
              onToggle={() => setExpandedSections(s => ({ ...s, review: !s.review }))}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              onMarkSectionDone={onMarkSectionDone}
              bulkUpdating={bulkUpdating}
              renderExpandedContent={renderExpandedContent}
            />
            <EmailSection
              title="Invitations"
              emails={invitationEmails}
              borderColor="border-l-cyan-600"
              badgeColor={invitationEmails.length > 0 ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-500'}
              isExpanded={expandedSections.invitation}
              onToggle={() => setExpandedSections(s => ({ ...s, invitation: !s.invitation }))}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              onMarkSectionDone={onMarkSectionDone}
              bulkUpdating={bulkUpdating}
              renderExpandedContent={renderExpandedContent}
            />
            <EmailSection
              title="FYI"
              emails={fyiEmails}
              borderColor="border-l-slate-300"
              badgeColor={fyiEmails.length > 0 ? 'bg-slate-400 text-white' : 'bg-slate-200 text-slate-500'}
              isExpanded={expandedSections.fyi}
              onToggle={() => setExpandedSections(s => ({ ...s, fyi: !s.fyi }))}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              onMarkSectionDone={onMarkSectionDone}
              bulkUpdating={bulkUpdating}
              renderExpandedContent={renderExpandedContent}
            />
          </div>
        </div>

        {/* Drafts Popup */}
        {showDraftsPopup && (
          <DraftsPopup
            draftsReady={draftsReady}
            draftsApproved={draftsApproved}
            sendingEmail={sendingEmail}
            sendingBatch={sendingBatch}
            onSendEmail={onSendEmail}
            onSendBatch={onSendBatchEmails}
            onClose={() => setShowDraftsPopup(false)}
          />
        )}
      </div>

      {/* Floating Selection Bar */}
      {selectedEmails.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 z-40">
          <span className="font-medium text-sm">{selectedEmails.size} selected</span>
          <button onClick={onMarkSelectedDone} disabled={bulkUpdating} className="bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50">
            {bulkUpdating ? 'Updating...' : 'Mark Done'}
          </button>
          <button onClick={onClearSelection} className="text-slate-400 hover:text-white transition-colors text-sm">
            Clear
          </button>
        </div>
      )}
    </>
  );
}

export default InboxView;
