'use client';

import { useState, useMemo } from 'react';
import { useRealtimeEmails } from '../hooks/useRealtimeEmails';
import { useEmailActions } from '../hooks/useEmailActions';
import { useCalendar } from '../hooks/useCalendar';
import { useAgendaNotes } from '../hooks/useAgendaNotes';
import { useImportantDocs } from '../hooks/useImportantDocs';
import type { Email, CalendarEvent } from '@/types';

// Layout
import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';

// Views
import { DashboardView } from './dashboard/DashboardView';
import { InboxView } from './inbox/InboxView';
import { EmilyQueueView } from './emily/EmilyQueueView';
import { AgendaView } from './agenda/AgendaView';
import { TasksView } from './tasks/TasksView';

// Modals
import { EmailPopup } from './modals/EmailPopup';
import { DraftEditorModal } from './modals/DraftEditorModal';
import { RevisionModal } from './modals/RevisionModal';
import { RemindMeModal } from './modals/RemindMeModal';
import { EventModal } from './modals/EventModal';
import { UrgentPopup } from './modals/UrgentPopup';
import { AgendaPopup } from './modals/AgendaPopup';
import { ImportantDocsPopup } from './modals/ImportantDocsPopup';
import { TaskModal } from './modals/TaskModal';
import { DraftsPopup } from './modals/DraftsPopup';

interface AppShellProps {
  emails: Email[];
  calendarEvents: CalendarEvent[];
}

// Task derivation helper
interface TaskItem {
  emailId: string | null;
  noteId: string | null;
  subject: string | null;
  task: string;
  assignee: string | null;
  isComplete: boolean;
  isDiscussed: boolean;
}

export default function AppShell({ emails: initialEmails, calendarEvents }: AppShellProps) {
  // Core state
  const { emails, setEmails, isConnected, refreshEmails } = useRealtimeEmails(initialEmails);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  // Popup/modal state
  const [popupEmailId, setPopupEmailId] = useState<string | null>(null);
  const [popupDraftText, setPopupDraftText] = useState('');
  const [showUrgentPopup, setShowUrgentPopup] = useState(false);
  const [showAgendaPopup, setShowAgendaPopup] = useState(false);
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);
  const [agendaNoteText, setAgendaNoteText] = useState('');
  const [showImportantDocsPopup, setShowImportantDocsPopup] = useState(false);
  const [showDraftsPopup, setShowDraftsPopup] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalEmailId, setTaskModalEmailId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState('');
  const [taskAssignee, setTaskAssignee] = useState<'rbk' | 'emily'>('emily');

  // Hooks
  const emailActions = useEmailActions({ emails, setEmails });
  const calendar = useCalendar(calendarEvents);
  const agendaNotesHook = useAgendaNotes();
  const docsHook = useImportantDocs();

  const isSnoozed = (email: Email) => {
    if (!email.reminder_date) return false;
    return new Date(email.reminder_date) > new Date();
  };

  // Derived email lists
  const urgentAlerts = useMemo(() =>
    emails.filter(e => e.action_status === 'urgent' && e.status !== 'done' && e.status !== 'archived'),
    [emails]
  );
  const urgentEmails = useMemo(() =>
    emails.filter(e => e.priority === 'rbk_action' && e.status !== 'done' && e.status !== 'archived'),
    [emails]
  );
  const emilyQueue = useMemo(() =>
    emails.filter(e => (e.priority === 'eg_action' || e.draft_status === 'needs_revision') && e.status !== 'done' && e.status !== 'archived'),
    [emails]
  );
  const agendaItems = useMemo(() => emails.filter(e => e.flagged_for_meeting), [emails]);
  const draftsReady = useMemo(() =>
    emails.filter(e => e.draft_status === 'draft_ready' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emails]
  );
  const draftsApproved = useMemo(() =>
    emails.filter(e => e.draft_status === 'approved' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emails]
  );

  // Tasks derivation
  const tasks: TaskItem[] = useMemo(() => {
    const emailTasks = emails
      .filter(e => e.meeting_notes)
      .map(e => {
        const notes = e.meeting_notes || '';
        const isDiscussed = notes.startsWith('[DISCUSSED]');
        let rawNotes = notes.replace('[DISCUSSED] ', '');
        const isComplete = rawNotes.includes('[DONE]');
        rawNotes = rawNotes.replace('[DONE] ', '').replace(' [DONE]', '');
        const isEmily = rawNotes.startsWith('[@EMILY] ');
        const isRbk = rawNotes.startsWith('[@RBK] ');
        const taskText = rawNotes.replace('[@EMILY] ', '').replace('[@RBK] ', '');
        return {
          emailId: e.id,
          noteId: null as string | null,
          subject: e.subject,
          task: taskText,
          assignee: isEmily ? 'emily' : isRbk ? 'rbk' : null,
          isComplete,
          isDiscussed,
        };
      })
      .filter(t => t.assignee && t.task);

    const noteTasks = agendaNotesHook.actionNotes
      .filter(n => n.assignee)
      .map(n => ({
        emailId: null as string | null,
        noteId: n.id,
        subject: null as string | null,
        task: n.text,
        assignee: n.assignee as string | null,
        isComplete: false,
        isDiscussed: false,
      }));

    return [...emailTasks, ...noteTasks];
  }, [emails, agendaNotesHook.actionNotes]);


  // Helpers
  const popupEmail = popupEmailId ? emails.find(e => e.id === popupEmailId) : null;

  const openEditDraft = (emailId: string, draft: string) => {
    emailActions.setEditingDraftId(emailId);
    emailActions.setDraftText(draft);
  };

  const openRevisionModal = (emailId: string) => {
    emailActions.setRevisionEmailId(emailId);
  };

  const openRemindMe = (emailId: string) => {
    emailActions.setRemindMeEmailId(emailId);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    emailActions.setRemindMeDate(tomorrow.toISOString().split('T')[0]);
  };

  const openTaskModal = (emailId: string) => {
    setTaskModalEmailId(emailId);
    setTaskText('');
    setTaskAssignee('emily');
    setShowTaskModal(true);
  };

  const saveTask = async () => {
    if (!taskModalEmailId || !taskText.trim()) return;
    const prefix = taskAssignee === 'rbk' ? '[@RBK] ' : '[@EMILY] ';
    const notes = prefix + taskText.trim();
    await emailActions.updateMeetingNotes(taskModalEmailId, notes);
    setShowTaskModal(false);
    setTaskModalEmailId(null);
    setTaskText('');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex">
      <Sidebar
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        isConnected={isConnected}
        unreadCount={emails.filter(e => e.is_unread).length}
        emilyQueueCount={emilyQueue.length}
      />

      <main className="flex-1 overflow-auto">
        <Header
          isConnected={isConnected}
          urgentCount={activeNav !== 'inbox' ? urgentAlerts.length : 0}
          upcomingMeeting={calendar.upcomingMeeting}
          onUrgentClick={() => {
            setActiveNav('inbox');
            if (urgentAlerts.length > 0) setExpandedEmail(urgentAlerts[0].id);
          }}
          onRefresh={refreshEmails}
        />

        <div className="p-8">
          {/* Dashboard View */}
          {activeNav === 'dashboard' && (
            <DashboardView
              emails={emails}
              urgentAlerts={urgentAlerts}
              draftsReady={draftsReady}
              draftsApproved={draftsApproved}
              urgentEmails={urgentEmails}
              tasks={tasks}
              scheduleEvents={calendar.scheduleEvents}
              selectedDate={calendar.selectedDate}
              loadingSchedule={calendar.loadingSchedule}
              calendarAuthError={calendar.calendarAuthError}
              onNavigateDate={calendar.navigateDate}
              onGoToToday={calendar.goToToday}
              onDeleteCalendarEvent={calendar.deleteCalendarEvent}
              onShowEventModal={() => calendar.setShowEventModal(true)}
              onRefreshCalendarToken={calendar.refreshCalendarToken}
              onFetchCalendarForDate={calendar.fetchCalendarForDate}
              isDateToday={calendar.isDateToday}
              onUpdateStatus={emailActions.updateStatus}
              onApproveDraft={emailActions.approveDraft}
              onSendEmail={emailActions.sendEmail}
              onSendBatchEmails={emailActions.sendBatchEmails}
              sendingEmail={emailActions.sendingEmail}
              sendingBatch={emailActions.sendingBatch}
              updating={emailActions.updating}
              onEditDraft={openEditDraft}
              onRequestRevision={openRevisionModal}
              onShowUrgentPopup={() => setShowUrgentPopup(true)}
              onShowImportantDocsPopup={() => setShowImportantDocsPopup(true)}
              onShowAgendaPopup={() => setShowAgendaPopup(true)}
              onViewEmail={(id) => setPopupEmailId(id)}
              onShowTaskModal={openTaskModal}
              importantDocsCount={docsHook.importantDocs.length}
              agendaItemsCount={agendaItems.length}
              onToggleTaskComplete={emailActions.toggleTaskComplete}
              onNavigateToInbox={() => setActiveNav('inbox')}
            />
          )}

          {/* Inbox View */}
          {activeNav === 'inbox' && (
            <InboxView
              emails={emails}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              selectedEmails={emailActions.selectedEmails}
              onUpdateStatus={emailActions.updateStatus}
              onUpdateActionStatus={emailActions.updateActionStatus}
              onToggleMeetingFlag={emailActions.toggleMeetingFlag}
              onEditDraft={openEditDraft}
              onOpenEventModal={calendar.openEventModalFromEmail}
              onOpenRemindMe={openRemindMe}
              onToggleEmailSelection={emailActions.toggleEmailSelection}
              onMarkSelectedDone={emailActions.markSelectedDone}
              onMarkSectionDone={emailActions.markSectionDone}
              onClearSelection={emailActions.clearSelection}
              onSendEmail={emailActions.sendEmail}
              onSendBatchEmails={emailActions.sendBatchEmails}
              onApproveDraft={emailActions.approveDraft}
              onRequestRevision={openRevisionModal}
              bulkUpdating={emailActions.bulkUpdating}
              sendingEmail={emailActions.sendingEmail}
              sendingBatch={emailActions.sendingBatch}
            />
          )}

          {/* Emily's Queue */}
          {activeNav === 'emily' && (
            <EmilyQueueView
              emails={emails}
              expandedEmail={expandedEmail}
              setExpandedEmail={setExpandedEmail}
              onUpdateStatus={emailActions.updateStatus}
              onEditDraft={openEditDraft}
              onMarkSectionDone={emailActions.markSectionDone}
              onSaveDraft={emailActions.saveDraft}
              bulkUpdating={emailActions.bulkUpdating}
              sendingEmail={emailActions.sendingEmail}
            />
          )}

          {/* Meeting Agenda */}
          {activeNav === 'agenda' && (
            <AgendaView
              emails={emails}
              scheduleEvents={calendar.scheduleEvents}
              selectedDate={calendar.selectedDate}
              loadingSchedule={calendar.loadingSchedule}
              agendaNotes={agendaNotesHook.agendaNotes}
              addingNoteToId={agendaNotesHook.addingNoteToId}
              setAddingNoteToId={agendaNotesHook.setAddingNoteToId}
              newNoteText={agendaNotesHook.newNoteText}
              setNewNoteText={agendaNotesHook.setNewNoteText}
              onAddAgendaNote={agendaNotesHook.addAgendaNote}
              onDeleteAgendaNote={agendaNotesHook.deleteAgendaNote}
              onUpdateAgendaNote={agendaNotesHook.updateAgendaNote}
              onEnsureNotesLoaded={agendaNotesHook.ensureNotesLoaded}
              onUpdateMeetingNotes={emailActions.updateMeetingNotes}
              onToggleMeetingFlag={emailActions.toggleMeetingFlag}
              onViewEmail={(id) => setPopupEmailId(id)}
            />
          )}

          {/* Tasks */}
          {activeNav === 'tasks' && (
            <TasksView
              emails={emails}
              actionNotes={agendaNotesHook.actionNotes}
              onToggleTaskComplete={emailActions.toggleTaskComplete}
              onViewEmail={(id) => setPopupEmailId(id)}
            />
          )}
        </div>
      </main>

      {/* === Global Modals === */}

      {/* Email Detail Popup */}
      {popupEmail && (
        <EmailPopup
          email={popupEmail}
          popupDraftText={popupDraftText}
          setPopupDraftText={setPopupDraftText}
          onSaveDraft={emailActions.saveDraft}
          onOpenFullView={(id) => { openEditDraft(id, popupEmail.edited_draft || popupEmail.draft_reply || ''); }}
          onClose={() => { setPopupEmailId(null); setPopupDraftText(''); }}
        />
      )}

      {/* Draft Editor Modal */}
      {emailActions.editingDraftId && (() => {
        const draftEmail = emails.find(e => e.id === emailActions.editingDraftId);
        return draftEmail ? (
          <DraftEditorModal
            email={draftEmail}
            draftText={emailActions.draftText}
            setDraftText={emailActions.setDraftText}
            updating={emailActions.updating}
            onSaveDraft={emailActions.saveDraft}
            onClose={() => emailActions.setEditingDraftId(null)}
          />
        ) : null;
      })()}

      {/* Revision Modal */}
      {emailActions.revisionEmailId && (() => {
        const revEmail = emails.find(e => e.id === emailActions.revisionEmailId);
        return revEmail ? (
          <RevisionModal
            email={revEmail}
            revisionComment={emailActions.revisionComment}
            setRevisionComment={emailActions.setRevisionComment}
            updating={emailActions.updating}
            onRequestRevision={emailActions.requestRevision}
            onClose={() => emailActions.setRevisionEmailId(null)}
          />
        ) : null;
      })()}

      {/* Remind Me Modal */}
      {emailActions.remindMeEmailId && (() => {
        const remindEmail = emails.find(e => e.id === emailActions.remindMeEmailId);
        return remindEmail ? (
          <RemindMeModal
            email={remindEmail}
            remindMeDate={emailActions.remindMeDate}
            setRemindMeDate={emailActions.setRemindMeDate}
            updating={emailActions.updating}
            onSetReminder={emailActions.setReminder}
            onClose={() => emailActions.setRemindMeEmailId(null)}
          />
        ) : null;
      })()}

      {/* Calendar Event Modal */}
      {calendar.showEventModal && (
        <EventModal
          eventFormData={calendar.eventFormData}
          setEventFormData={calendar.setEventFormData}
          creatingEvent={calendar.creatingEvent}
          onCreateEvent={calendar.createCalendarEvent}
          onClose={() => calendar.setShowEventModal(false)}
        />
      )}

      {/* Urgent Popup */}
      {showUrgentPopup && (
        <UrgentPopup
          emails={urgentAlerts}
          onViewAndRespond={(id) => { setShowUrgentPopup(false); setPopupEmailId(id); }}
          onMarkDone={(id) => emailActions.updateStatus(id, 'done')}
          onClose={() => setShowUrgentPopup(false)}
        />
      )}

      {/* Agenda Popup */}
      {showAgendaPopup && (
        <AgendaPopup
          agendaItems={agendaItems}
          editingAgendaId={editingAgendaId}
          setEditingAgendaId={setEditingAgendaId}
          agendaNoteText={agendaNoteText}
          setAgendaNoteText={setAgendaNoteText}
          onUpdateMeetingNotes={emailActions.updateMeetingNotes}
          onToggleMeetingFlag={emailActions.toggleMeetingFlag}
          onViewEmail={(id) => { setShowAgendaPopup(false); setPopupEmailId(id); }}
          onClose={() => setShowAgendaPopup(false)}
        />
      )}

      {/* Important Docs Popup */}
      {showImportantDocsPopup && (
        <ImportantDocsPopup
          importantDocs={docsHook.importantDocs}
          loadingDocs={docsHook.loadingDocs}
          editingImportantDocs={docsHook.editingImportantDocs}
          setEditingImportantDocs={docsHook.setEditingImportantDocs}
          editingDocId={docsHook.editingDocId}
          setEditingDocId={docsHook.setEditingDocId}
          editingDocTitle={docsHook.editingDocTitle}
          setEditingDocTitle={docsHook.setEditingDocTitle}
          newDocTitle={docsHook.newDocTitle}
          setNewDocTitle={docsHook.setNewDocTitle}
          newDocUrl={docsHook.newDocUrl}
          setNewDocUrl={docsHook.setNewDocUrl}
          onAddDoc={docsHook.addImportantDoc}
          onDeleteDoc={docsHook.deleteImportantDoc}
          onUpdateDoc={docsHook.updateImportantDoc}
          onClose={() => setShowImportantDocsPopup(false)}
        />
      )}

      {/* Task Modal */}
      {showTaskModal && taskModalEmailId && (
        <TaskModal
          email={emails.find(e => e.id === taskModalEmailId)}
          taskText={taskText}
          setTaskText={setTaskText}
          taskAssignee={taskAssignee}
          setTaskAssignee={setTaskAssignee}
          onSaveTask={saveTask}
          onClose={() => { setShowTaskModal(false); setTaskModalEmailId(null); }}
        />
      )}

      {/* Drafts Popup */}
      {showDraftsPopup && (
        <DraftsPopup
          draftsReady={draftsReady}
          draftsApproved={draftsApproved}
          sendingEmail={emailActions.sendingEmail}
          sendingBatch={emailActions.sendingBatch}
          onSendEmail={emailActions.sendEmail}
          onSendBatch={emailActions.sendBatchEmails}
          onClose={() => setShowDraftsPopup(false)}
        />
      )}
    </div>
  );
}
