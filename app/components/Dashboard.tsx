'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useAuth, useWorkspace } from './AuthProvider';
import { useRealtimeEmails } from '../hooks/useRealtimeEmails';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase-client';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import { hasSubPermission } from '@/lib/modules';
import Sidebar from './Sidebar';
import DevelopmentPage from './development/DevelopmentPage';
import AfterSchoolTab from './AfterSchoolTab';
// GuardianCirclePage now lives inside DevelopmentPage as a tab — the
// top-level `guardian-circle` nav route was retired on 2026-05-15.
import SimchasSendNoteModal, { type SimchasSendNotePayload } from './SimchasSendNoteModal';
import SlackSendModal from './shared/SlackSendModal';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ShimmerCards } from './ui/Shimmer';
import { apiFetch } from '@/lib/apiFetch';
import type { DonorTag } from './development/DonorAnnotations';

const BugReportButton = dynamic(() => import('./BugReportButton'), { ssr: false });
const TiptapEditor = dynamic(() => import('./TiptapEditor'), { ssr: false });
// DonorAnnotations is reused on the Admissions enrollment drilldown so
// staff can attach notes + tags to individual students. Namespaced via
// "Admissions: <fullName>" / "admissions-<personId>" so these rows
// don't collide with real donor annotations in `donor_notes`/`donor_tags`.
const DonorAnnotations = dynamic(() => import('./development/DonorAnnotations'), { ssr: false });

// Admissions-specific tag palette. Distinct labels from the development
// palette + Tailwind tint classes (the DonorAnnotations TagPills picks
// up the soft `bg-…-50` style when a `bg` field is present). Labels must
// match the server-side allowlist in /api/development/donor-tags exactly.
const ADMISSIONS_TAG_DEFS = [
  { label: 'Needs Follow-up', color: 'text-amber-700', bg: 'bg-amber-50' },
  { label: 'Application Incomplete', color: 'text-red-700', bg: 'bg-red-50' },
  { label: 'Scholarship', color: 'text-purple-700', bg: 'bg-purple-50' },
  { label: 'Priority Family', color: 'text-blue-700', bg: 'bg-blue-50' },
  { label: 'Decision Pending', color: 'text-slate-700', bg: 'bg-slate-100' },
];

function sanitizeEmailHtml(html: string): string {
  if (!html) return '';
  if (!html.includes('<')) return `<p>${html.replace(/\n/g, '<br/>')}</p>`;
  let clean = html.replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');
  clean = clean.replace(/<\/?(?:o|w|m):[^>]*>/gi, '');
  clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/\s(?:class|id)="[^"]*"/gi, '');
  clean = clean.replace(/\s{3,}/g, ' ');
  return clean;
}

interface Attachment {
  name: string;
  type: string;
  size: number;
}

interface Email {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  summary: string;
  body_text: string;
  action_needed: string | null;
  draft_reply: string | null;
  edited_draft: string | null;
  draft_status: string | null;
  draft_edited_by: string | null;
  draft_edited_at: string | null;
  priority: string;
  status: string;
  action_status: string | null;
  assigned_to: string;
  received_at: string;
  is_unread: boolean;
  flagged_for_meeting: boolean;
  flagged_by: string | null;
  meeting_notes: string | null;
  message_id?: string | null;
  attachments?: Attachment[] | null;
  reminder_date?: string | null;
  revision_comment?: string | null;
  tbd_suggestion?: string | null;
  tbd_notes?: string | null;
  thread_id?: string | null;
}

interface GmailThreadMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  bodyType: 'html' | 'text';
  snippet: string;
}

interface AgendaNote {
  id: string;
  email_id?: string | null;
  agenda_item_id?: string | null;
  text: string;
  type: 'note' | 'decision' | 'action';
  // Widened from 'rbk' | 'emily' to support all 5 users now permitted by
  // the agenda_notes assignee CHECK constraint (rbk/emily/sara/leora/becca).
  assignee: string | null;
  created_at: string;
  completed?: boolean;
}

interface AgendaItem {
  id: string;
  sort_order: number;
  item_type: 'email' | 'topic' | 'manual';
  is_discussed: boolean;
  email_id?: string;
  topic_id?: string;
  title?: string | null;
  tags?: string[];
  email?: { id: string; subject: string; from_name: string; from_email: string; priority: string; summary: string; action_needed: string; };
  topic?: { id: string; name: string; description: string; };
}

interface RecurringTopic {
  id: string;
  name: string;
  description: string;
  sort_order: number;
}

interface SimchaEvent {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string | null;
  isAllDay: boolean;
}

interface AbsenceRecord {
  person_id: number;
  name: string;
  status_code: number;
  status_label: string;
  excused: boolean;
  attendance_category: number;
  notes: string | null;
  late_arrival_time: string | null;
  early_dismissal_time: string | null;
  grade_level: string | null;
  grade_level_id: number | null;
  ytd_absences: number;
  consecutive_absences: number;
}

interface AbsencesData {
  date: string;
  total: number;
  absences: AbsenceRecord[];
  tardies: AbsenceRecord[];
  earlyDismissals: AbsenceRecord[];
  notExpected?: AbsenceRecord[];
  totalStudents?: number;
  monthlyTrend?: Array<{ date: string; count: number }>;
  topAbsentees?: Array<{ person_id: number; name: string; ytd_absences: number; grade_level_id: number | null }>;
}

// Year-to-date attendance aggregation. Fetched lazily from
// /api/absences?view=ytd on the first Absences-page visit; powers the
// "Attendance Distribution — Year to Date" section below the live
// today-attendance block.
interface AbsencesYtdData {
  view: 'ytd';
  schoolYearStart: string;
  currentQuarter: string | null;
  totalSchoolDays: number;
  absenceTiersByGrade: Array<{
    grade_level_id: number;
    grade_label: string;
    chronically_absent: number;
    at_risk: number;
    satisfactory: number;
  }>;
  quarterlyTrend: Array<{ quarter: string; absences: number; tardies: number }>;
  error?: string;
}

interface Project {
  id: string;
  title: string;
  description: string | null;
  department: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'on_hold' | 'complete' | 'archived';
  progress: number;
  // String (formerly 'rbk' | 'emily' literal union). Phase B widened to
  // any Capitalized assignee_key now that projects.assignee data was
  // migrated to match tasks.assigned_to / agenda_notes.assignee.
  assignee: string;
  due_date: string | null;
  links: Array<{ title: string; url: string }>;
  tags?: string[];
  assignee_email?: string | null;
  team_emails?: string[];
  created_at: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  meetingLink?: string | null;
  calendarLink?: string | null;
}

interface Props {
  emails: Email[];
  calendarEvents: CalendarEvent[];
}

// Priority dot colors for minimal indicators
// Assignee options for task creation + editing. Values are lowercase to
// match the agenda_notes.assignee CHECK constraint; labels are the display
// names. Keep in sync with TASK_USERS in lib/slackNotifications.ts (which
// resolves case-insensitively).
const ASSIGNEE_OPTIONS: { value: string; label: string }[] = [
  { value: 'rbk',   label: 'RBK' },
  { value: 'emily', label: 'Emily' },
  { value: 'sara',  label: 'Sara' },
  { value: 'leora', label: 'Leora' },
  { value: 'becca', label: 'Becca' },
];

const priorityConfig: Record<string, { bg: string; text: string; label: string; icon: string; dot: string; borderLeft: string }> = {
  owner_action: { bg: 'bg-red-50 border border-red-200', text: 'text-red-700', label: 'Action Required', icon: '🔴', dot: 'bg-red-500', borderLeft: 'border-l-4 border-l-red-600' },
  assistant_action: { bg: 'bg-violet-50 border border-violet-200', text: 'text-violet-700', label: 'Emily', icon: '🔵', dot: 'bg-violet-500', borderLeft: 'border-l-4 border-l-violet-600' },
  invitation: { bg: 'bg-cyan-50 border border-cyan-200', text: 'text-cyan-700', label: 'Invitation', icon: '🟣', dot: 'bg-cyan-500', borderLeft: 'border-l-4 border-l-cyan-600' },
  meeting_invite: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Meeting', icon: '🟢', dot: 'bg-green-500', borderLeft: 'border-l-4 border-l-green-500' },
  important_no_action: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-600', label: 'Important', icon: '🟠', dot: 'bg-slate-400', borderLeft: 'border-l-4 border-l-amber-400' },
  review: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'Review', icon: '🟡', dot: 'bg-amber-400', borderLeft: 'border-l-4 border-l-amber-400' },
  fyi: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-500', label: 'FYI', icon: '⚫', dot: 'bg-slate-300', borderLeft: 'border-l-4 border-l-slate-300' },
};

// Status dot colors for minimal indicators
const statusConfig: Record<string, { bg: string; text: string; label: string; icon: string; dot: string }> = {
  pending: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'Pending', icon: '⏰', dot: 'bg-amber-400' },
  in_progress: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'In Progress', icon: '🔄', dot: 'bg-blue-500' },
  done: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Done', icon: '✅', dot: 'bg-green-500' },
  archived: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-500', label: 'Archived', icon: '📦', dot: 'bg-slate-300' },
};

// Action status - simplified per redesign
const actionStatusConfig: Record<string, { bg: string; text: string; label: string; icon: string }> = {
  send: { bg: 'bg-green-50 border border-green-200', text: 'text-green-700', label: 'Send', icon: '✉️' },
  sent: { bg: 'bg-emerald-50 border border-emerald-200', text: 'text-emerald-700', label: 'Sent', icon: '✅' },
  remind_me: { bg: 'bg-slate-50 border border-slate-200', text: 'text-slate-600', label: 'Remind Me', icon: '⏰' },
  draft_ready: { bg: 'bg-blue-50 border border-blue-200', text: 'text-blue-700', label: 'Review Draft', icon: '📝' },
  urgent: { bg: 'bg-red-50 border border-red-200', text: 'text-red-700', label: 'URGENT', icon: '🚨' },
  tbd: { bg: 'bg-amber-50 border border-amber-200', text: 'text-amber-700', label: 'TBD', icon: '❓' },
};

// Draft status
const draftStatusConfig: Record<string, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-slate-50', text: 'text-slate-500', label: 'Not Started' },
  editing: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Editing' },
  draft_ready: { bg: 'bg-green-50', text: 'text-green-700', label: 'Review Draft' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Approved' },
  needs_revision: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Needs Revision' },
};

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const departmentColors: Record<string, { border: string; bg: string; text: string; fill: string }> = {
  'Communications': { border: 'border-l-blue-400', bg: 'bg-blue-50', text: 'text-blue-700', fill: 'bg-blue-400' },
  'Technology': { border: 'border-l-slate-500', bg: 'bg-slate-100', text: 'text-slate-700', fill: 'bg-slate-500' },
  'Development': { border: 'border-l-violet-400', bg: 'bg-violet-50', text: 'text-violet-700', fill: 'bg-violet-400' },
  'Finance': { border: 'border-l-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700', fill: 'bg-emerald-400' },
  'HR': { border: 'border-l-rose-400', bg: 'bg-rose-50', text: 'text-rose-700', fill: 'bg-rose-400' },
  'Media': { border: 'border-l-cyan-400', bg: 'bg-cyan-50', text: 'text-cyan-700', fill: 'bg-cyan-400' },
  'Building & Facilities': { border: 'border-l-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', fill: 'bg-amber-500' },
  'Admissions': { border: 'border-l-teal-400', bg: 'bg-teal-50', text: 'text-teal-700', fill: 'bg-teal-400' },
  'Admin Team': { border: 'border-l-indigo-400', bg: 'bg-indigo-50', text: 'text-indigo-700', fill: 'bg-indigo-400' },
  'Pisgah': { border: 'border-l-orange-400', bg: 'bg-orange-50', text: 'text-orange-700', fill: 'bg-orange-400' },
  'Student Activities': { border: 'border-l-pink-400', bg: 'bg-pink-50', text: 'text-pink-700', fill: 'bg-pink-400' },
};

const DEPARTMENTS = [
  'Communications', 'Technology', 'Development', 'Finance', 'HR',
  'Media', 'Building & Facilities', 'Admissions', 'Admin Team', 'Pisgah', 'Student Activities',
];

const projectPriorityConfig: Record<string, { bg: string; text: string }> = {
  high: { bg: 'bg-rose-100', text: 'text-rose-700' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
  low: { bg: 'bg-slate-100', text: 'text-slate-500' },
};

export default function Dashboard({ emails: initialEmails, calendarEvents }: Props) {
  const { user, signOut, loading: authLoading } = useAuth();
  const { workspaceId, role, modules, moduleConfig, effectiveModules, allowedModules, workspaces, switchWorkspace, impersonating, startImpersonation, stopImpersonation, displayName: wsDisplayName, currentMember, assistant, principal, workspaceOwnerEmail, workspaceBrand, googleTasksConnected } = useWorkspace();
  const { emails, setEmails, isConnected, refreshEmails } = useRealtimeEmails(initialEmails, workspaceId);

  // Configurable inbox labels per workspace (fall back to generic defaults)
  const ownerLabel = moduleConfig?.inbox?.owner_label ?? 'Owner';
  const assistantLabel = moduleConfig?.inbox?.assistant_label ?? 'Assistant';

  // Phase B: identity helpers for Tasks-page column rendering. These
  // replace the previous hardcoded 'rbk'/'emily' literals. assigneeKey
  // values are Capitalized in the DB ('RBK', 'Emily'); the lowercase
  // forms exist for case-insensitive comparisons against the internal
  // task.assignee field which is constructed from various sources
  // (email tag, agenda_notes row) and historically lowercase.
  //
  // The "second column" is whoever the current user has a working
  // relationship with: their assistant (when they're a principal) or
  // their principal (when they're an assistant). Principals see
  // [me | assistant]; assistants see [me | principal]; standalone users
  // see only their own column.
  const secondColumnMember = assistant ?? principal;
  const myAssigneeKey = currentMember?.assigneeKey ?? null;
  const theirAssigneeKey = secondColumnMember?.assigneeKey ?? null;
  const myAssigneeKeyLower = myAssigneeKey ? myAssigneeKey.toLowerCase() : null;
  const theirAssigneeKeyLower = theirAssigneeKey ? theirAssigneeKey.toLowerCase() : null;
  const myDisplayName = currentMember?.displayName ?? (user?.email?.split('@')[0] ?? 'Me');
  const theirDisplayName = secondColumnMember?.displayName ?? null;
  const hasSecondColumn = !!secondColumnMember && !!theirAssigneeKey;
  // Backward-compat alias — older call sites still use hasAssistant.
  // Resolves to the same value as hasSecondColumn now.
  const hasAssistant = hasSecondColumn;

  // Phase E: shows the Academy / HS / Institutional toggle only for
  // users with multi-division access (Becca, Debra May). Single-
  // division users never see the toggle, banner, or badges.
  const hasMultipleDivisions = (currentMember?.divisions?.length ?? 0) > 1;

  // Client-only render guard for workspace switcher (avoids hydration mismatch)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Admin: fetch all workspace members for impersonation dropdown
  const [allMembers, setAllMembers] = useState<Array<{ email: string; display_name: string | null; role: string; workspace_id: string; workspace_name: string }>>([]);
  useEffect(() => {
    if (user?.email?.toLowerCase() !== 'rglassberg@saracademy.org') return;
    fetch('/api/admin/workspace-members')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.members) setAllMembers(data.members); })
      .catch(() => {});
  }, [user?.email]);

  // Set Firebase UID on Supabase anon client so RLS policies can resolve workspace_id
  useEffect(() => {
    if (user?.uid) {
      supabase.rpc('set_current_user_id', { user_id: user.uid }).then(({ error }) => {
        if (error) console.error('Failed to set RLS user context:', error);
      });
    }
  }, [user?.uid]);

  // Gmail OAuth consent banner
  const [gmailBanner, setGmailBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('gmailConnected')) {
      if (params.get('gmailConnected') === 'true') {
        setGmailBanner({ type: 'success', message: "Gmail connected successfully. RBK's emails will now sync with full content." });
      } else {
        const error = params.get('error') || 'Unknown error';
        setGmailBanner({ type: 'error', message: `Gmail connection failed: ${error}` });
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Mobile sidebar drawer state. Sidebar is `md:static` on desktop, so this
  // only has an effect below the `md` breakpoint where the sidebar is a
  // fixed overlay.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const VALID_NAV_IDS = ['dashboard', 'inbox', 'agenda', 'tasks', 'gemara', 'communications', 'projects', 'absences', 'after_school', 'admissions', 'simchas', 'student-logs', 'lever', 'development', 'emily'];
  const [activeNav, setActiveNav] = useState(() => {
    if (typeof window !== 'undefined') {
      // Check ?nav= search param first (from /home navigation)
      const params = new URLSearchParams(window.location.search);
      const navParam = params.get('nav');
      if (navParam && VALID_NAV_IDS.includes(navParam)) return navParam;
      // Fall back to hash
      const hash = window.location.hash.replace('#', '');
      if (VALID_NAV_IDS.includes(hash)) return hash;
    }
    return 'dashboard';
  });

  // Sync activeNav to URL hash
  useEffect(() => {
    window.location.hash = activeNav === 'dashboard' ? '' : `#${activeNav}`;
  }, [activeNav]);

  // Read ?nav= and ?projectPanel= from URL on mount and clean up
  const pendingProjectPanelRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const navParam = params.get('nav');
    const projectPanelId = params.get('projectPanel');
    if (navParam && VALID_NAV_IDS.includes(navParam)) {
      setActiveNav(navParam);
    }
    if (projectPanelId) {
      pendingProjectPanelRef.current = projectPanelId;
    }
    if (navParam || projectPanelId) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // Viewer redirect: on initial load, navigate to first allowed module
  const viewerRedirectedRef = useRef(false);
  useEffect(() => {
    if (viewerRedirectedRef.current) return;
    if (role !== 'viewer' || !allowedModules || activeNav !== 'dashboard') return;
    // Don't redirect if URL has a ?nav= param — let the URL cleanup effect handle it
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('nav')) return;
    // Priority order for first module
    const moduleToNav: [string, string][] = [
      ['admissions', 'admissions'],
      ['absences', 'absences'],
      ['recruiting', 'lever'],
      ['simchas', 'simchas'],
      ['projects', 'projects'],
    ];
    for (const [mod, navId] of moduleToNav) {
      if (allowedModules[mod]) {
        viewerRedirectedRef.current = true;
        setActiveNav(navId);
        return;
      }
    }
  }, [role, allowedModules, activeNav]);

  const [gmailSyncStatus, setGmailSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [emailCategory, setEmailCategory] = useState<string>('rbk');
  const [updating, setUpdating] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Draft editing
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const draftTextRef = useRef('');

  // Sent emails (loaded on demand from Gmail API)
  const [sentEmails, setSentEmails] = useState<Array<{ id: string; threadId: string; subject: string; to: string; date: string; snippet: string; body: string }>>([]);
  const [sentLoading, setSentLoading] = useState(false);
  const sentLoadedRef = useRef(false);

  // Meeting notes
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  // Stores the lowercase assigneeKey (e.g. 'rbk', 'emily'). Default empty;
  // dropdown buttons populate based on current member + assistant.
  const [notesAssignee, setNotesAssignee] = useState<string>('');

  // Drafts Ready popup
  const [showDraftsPopup, setShowDraftsPopup] = useState(false);
  const [showTbdPopup, setShowTbdPopup] = useState(false);
  const [sendingBatch, setSendingBatch] = useState(false);

  // Request Revision modal
  const [revisionEmailId, setRevisionEmailId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState('');

  // Remind Me modal
  const [remindMeEmailId, setRemindMeEmailId] = useState<string | null>(null);
  const [remindMeDate, setRemindMeDate] = useState('');

  // Bulk email selection
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const toggleEmailSelection = (emailId: string) => {
    const newSelected = new Set(selectedEmails);
    if (newSelected.has(emailId)) {
      newSelected.delete(emailId);
    } else {
      newSelected.add(emailId);
    }
    setSelectedEmails(newSelected);
  };

  const selectAllInSection = (emailIds: string[]) => {
    const newSelected = new Set(selectedEmails);
    emailIds.forEach(id => newSelected.add(id));
    setSelectedEmails(newSelected);
  };

  const clearSelection = () => {
    setSelectedEmails(new Set());
  };

  const markSelectedDone = async () => {
    if (selectedEmails.size === 0) return;
    setBulkUpdating(true);
    try {
      const emailIds = Array.from(selectedEmails);
      const promises = emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      );
      await Promise.all(promises);
      setEmails(emails.map(e => selectedEmails.has(e.id) ? { ...e, status: 'done' } : e));
      setSelectedEmails(new Set());

      // Archive all in Gmail (fire and forget)
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark emails done:', error);
    }
    setBulkUpdating(false);
  };

  const markEmailRead = (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email || !email.is_unread) return;
    // Optimistic update
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, is_unread: false } : e));
    // Fire and forget
    fetch('/api/emails/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: emailId, is_unread: false }),
    }).catch(() => {});
  };

  const markSectionDone = async (emailIds: string[]) => {
    if (emailIds.length === 0) return;
    if (!confirm(`Mark ${emailIds.length} email${emailIds.length > 1 ? 's' : ''} as done?`)) return;
    setBulkUpdating(true);
    try {
      const promises = emailIds.map(id =>
        fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'done' }),
        })
      );
      await Promise.all(promises);
      setEmails(emails.map(e => emailIds.includes(e.id) ? { ...e, status: 'done' } : e));

      // Archive all in Gmail (fire and forget)
      emailIds.forEach(id => {
        fetch(`/api/emails/${id}/archive`, { method: 'POST' })
          .catch(err => console.error('Gmail archive failed:', err));
      });
    } catch (error) {
      console.error('Failed to mark section done:', error);
    }
    setBulkUpdating(false);
  };

  // Calendar event creation
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventFormData, setEventFormData] = useState({
    title: '',
    date: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    location: '',
    description: '',
  });
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Calendar navigation
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scheduleEvents, setScheduleEvents] = useState<CalendarEvent[]>(calendarEvents);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // Contextual Slack-send modal. When non-null the modal renders;
  // setting it back to null closes. Single piece of state covers
  // both the task-card and agenda-header entry points.
  const [slackSendContext, setSlackSendContext] = useState<string | null>(null);

  // Fetch calendar on mount to ensure it works in production
  useEffect(() => {
    fetchCalendarForDate(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch action notes for tasks view
  useEffect(() => {
    fetchActionNotes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch sent emails on demand when category switches to 'sent'
  useEffect(() => {
    if (emailCategory !== 'sent' || sentLoadedRef.current) return;
    setSentLoading(true);
    fetch('/api/gmail/sent')
      .then(res => res.json())
      .then(data => {
        if (data.messages) {
          setSentEmails(data.messages);
          sentLoadedRef.current = true;
        }
      })
      .catch(err => console.error('Failed to fetch sent emails:', err))
      .finally(() => setSentLoading(false));
  }, [emailCategory]);

  // Meeting countdown alert
  const [upcomingMeeting, setUpcomingMeeting] = useState<{ title: string; minutesUntil: number; meetingLink?: string | null } | null>(null);

  // Check for upcoming meetings every 30 seconds
  useEffect(() => {
    const checkUpcomingMeetings = () => {
      const now = new Date();
      // Only check today's events from scheduleEvents
      for (const event of scheduleEvents) {
        if (event.isAllDay) continue;
        const startTime = new Date(event.startTime);
        const diffMs = startTime.getTime() - now.getTime();
        const diffMinutes = Math.ceil(diffMs / 60000);

        // Show alert if meeting is within 5 minutes and hasn't started yet
        if (diffMinutes > 0 && diffMinutes <= 5) {
          setUpcomingMeeting({ title: event.title, minutesUntil: diffMinutes, meetingLink: event.meetingLink });
          return;
        }
      }
      setUpcomingMeeting(null);
    };

    checkUpcomingMeetings();
    const interval = setInterval(checkUpcomingMeetings, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [scheduleEvents]);

  const refreshGoogleToken = async (): Promise<boolean> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/calendar.readonly');
      provider.addScope('https://www.googleapis.com/auth/calendar.events');
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
      provider.addScope('https://www.googleapis.com/auth/gmail.send');
      provider.addScope('https://www.googleapis.com/auth/gmail.modify');
      provider.setCustomParameters({ prompt: 'none' });
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const accessToken = credential?.accessToken;
      const idToken = await result.user.getIdToken();
      if (!accessToken) return false;
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, accessToken }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const fetchAgendaNotes = async (key: string, opts?: { agendaItemId?: string }) => {
    try {
      const param = opts?.agendaItemId ? `agenda_item_id=${opts.agendaItemId}` : `emailId=${key}`;
      const res = await fetch(`/api/agenda-notes?${param}`);
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({ ...prev, [key]: data.notes || [] }));
      }
    } catch (e) {
      console.error('Failed to fetch agenda notes:', e);
    }
  };

  const addAgendaNote = async (key: string, opts?: { agendaItemId?: string }) => {
    if (!newNoteText.trim()) return;
    try {
      const postBody: Record<string, unknown> = {
        text: newNoteText.trim(),
        type: 'note',
        assignee: null,
        meeting_date: new Date().toISOString().split('T')[0],
      };
      if (opts?.agendaItemId) postBody.agenda_item_id = opts.agendaItemId;
      else postBody.email_id = key;
      const res = await fetch('/api/agenda-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody),
      });
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({
          ...prev,
          [key]: [...(prev[key] || []), data.note],
        }));
        setNewNoteText('');
        setAddingNoteToId(null);
        fetchActionNotes();
      } else {
        console.error('Failed to add agenda note:', await res.text());
      }
    } catch (e) {
      console.error('Failed to add agenda note:', e);
    }
  };

  const deleteAgendaNote = async (emailId: string, noteId: string) => {
    try {
      await fetch(`/api/agenda-notes?id=${noteId}`, { method: 'DELETE' });
      setAgendaNotes(prev => ({
        ...prev,
        [emailId]: (prev[emailId] || []).filter(n => n.id !== noteId),
      }));
      setActionNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (e) {
      console.error('Failed to delete agenda note:', e);
    }
  };

  const fetchActionNotes = async () => {
    try {
      const res = await fetch('/api/agenda-notes?type=action');
      if (res.ok) {
        const data = await res.json();
        setActionNotes(data.notes || []);
      }
    } catch (e) {
      console.error('Failed to fetch action notes:', e);
    }
  };

  // Source-tagged tasks (rows in the `tasks` Supabase table created by
  // cross-module flows — e.g. donor notes that @mention RBK auto-insert a
  // row with source='development'). The legacy email/note derived tasks
  // continue to come from the in-component logic; these supplement them.
  interface SourcedTask {
    id: string;
    title: string;
    description: string | null;
    source: string | null;
    source_ref: string | null;
    assigned_to: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }
  const [sourcedTasks, setSourcedTasks] = useState<SourcedTask[]>([]);
  const [showCompletedDev, setShowCompletedDev] = useState(false);
  const [showCompletedAdmissions, setShowCompletedAdmissions] = useState(false);
  const [fromDevCollapsed, setFromDevCollapsed] = useState(false);
  const [fromAdmCollapsed, setFromAdmCollapsed] = useState(true);
  // Click-to-expand state for From Development / From Admissions cards.
  // One open at a time across both sections (a single string id is
  // sufficient since `tasks.id` is unique).
  const [expandedSourcedTaskId, setExpandedSourcedTaskId] = useState<string | null>(null);
  const fetchSourcedTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) return;
      const json = await res.json();
      setSourcedTasks(json.tasks || []);
    } catch { /* silent */ }
  }, []);
  const toggleSourcedTaskStatus = useCallback(async (t: SourcedTask) => {
    const nextStatus = t.status === 'done' ? 'todo' : 'done';
    // Optimistic
    setSourcedTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: nextStatus, completed_at: nextStatus === 'done' ? new Date().toISOString() : null } : x));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, status: nextStatus }),
      });
    } catch { /* swallow */ }
  }, []);

  // Fetch sourced tasks once on first visit to the Tasks view.
  const loadedSourcedTasksRef = useRef(false);
  useEffect(() => {
    if (activeNav !== 'tasks' || loadedSourcedTasksRef.current) return;
    loadedSourcedTasksRef.current = true;
    fetchSourcedTasks();
  }, [activeNav, fetchSourcedTasks]);

  // ─── Project updates: bulk load + Realtime + one-time localStorage migration ───
  // Bulk-fetch all updates for the workspace on mount (cheap query, indexed
  // by workspace_id). Groups results by project_id so the card-recency
  // indicator and panel feed render immediately without per-project fetches.
  const loadedProjectUpdatesRef = useRef(false);
  useEffect(() => {
    if (!workspaceId || loadedProjectUpdatesRef.current) return;
    loadedProjectUpdatesRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/project-updates');
        if (!res.ok || cancelled) return;
        const { updates } = await res.json() as { updates: Array<{ id: string; project_id: string; text: string; author: string; created_at: string }> };
        const grouped: Record<string, Array<{ id: string; text: string; timestamp: string; author: string }>> = {};
        for (const u of updates) {
          if (!grouped[u.project_id]) grouped[u.project_id] = [];
          grouped[u.project_id].push({ id: u.id, text: u.text, timestamp: u.created_at, author: u.author });
        }
        if (!cancelled) setProjectUpdates(grouped);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // One-time migration: localStorage held the previous (client-only)
  // history of project updates. On first mount after this migration ships,
  // we POST each entry to the API so it lands in Supabase, then clear the
  // key so we don't double-post on subsequent loads.
  const migratedLocalUpdatesRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || migratedLocalUpdatesRef.current || !workspaceId) return;
    migratedLocalUpdatesRef.current = true;
    let raw: string | null;
    try { raw = localStorage.getItem('projectUpdates'); } catch { raw = null; }
    if (!raw) return;
    let parsed: Record<string, Array<{ text: string; timestamp?: string }>>;
    try { parsed = JSON.parse(raw); } catch { localStorage.removeItem('projectUpdates'); return; }
    const author = user?.displayName || user?.email?.split('@')[0] || 'unknown';
    (async () => {
      for (const [projectId, list] of Object.entries(parsed)) {
        for (const entry of (list || []).slice().reverse()) {
          // Reversed so the oldest entry posts first → newest stays at top.
          if (!entry?.text) continue;
          try {
            await fetch('/api/project-updates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: projectId, text: entry.text, author }),
            });
          } catch { /* skip */ }
        }
      }
      try { localStorage.removeItem('projectUpdates'); } catch { /* noop */ }
    })();
  }, [workspaceId, user]);

  // Real-time project-updates sync. Mirrors the tasks-sync channel shape.
  // The project_updates table was added to the supabase_realtime publication
  // in the same migration; without that the channel would subscribe cleanly
  // but never receive broadcasts (the silent failure mode the existing
  // agenda_notes channel quietly hits).
  const [projectUpdatesLive, setProjectUpdatesLive] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel('project-updates-sync')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'project_updates',
        filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const u = payload.new as { id: string; project_id: string; text: string; author: string; created_at: string };
        if (!u?.id || !u.project_id) return;
        setProjectUpdates(prev => {
          const existing = prev[u.project_id] || [];
          // Dedup: our own optimistic insert already added an entry that
          // got swapped for the server row by the POST handler, so the id
          // is already present. Skip in that case.
          if (existing.some(x => x.id === u.id)) return prev;
          return {
            ...prev,
            [u.project_id]: [
              { id: u.id, text: u.text, timestamp: u.created_at, author: u.author },
              ...existing,
            ],
          };
        });
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'project_updates',
        filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const old = payload.old as { id?: string; project_id?: string };
        if (!old?.id) return;
        setProjectUpdates(prev => {
          // payload.old only includes the primary key by default (replica
          // identity DEFAULT). Strip by id across all projects.
          const next: typeof prev = {};
          for (const [pid, list] of Object.entries(prev)) {
            next[pid] = list.filter(u => u.id !== old.id);
          }
          return next;
        });
      })
      .subscribe((status) => {
        setProjectUpdatesLive(status === 'SUBSCRIBED');
      });
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);
  void projectUpdatesLive; // referenced but no UI yet; keep lint quiet

  // Real-time task sync via Supabase
  const [tasksLive, setTasksLive] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel('tasks-sync')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agenda_notes',
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => {
        // Silent re-fetch on any change
        fetchActionNotes();
      })
      .subscribe((status) => {
        setTasksLive(status === 'SUBSCRIBED');
      });
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const updateAgendaNote = async (emailId: string, noteId: string, updates: { type?: string; assignee?: string | null; text?: string }) => {
    try {
      const res = await fetch(`/api/agenda-notes?id=${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setAgendaNotes(prev => ({
          ...prev,
          [emailId]: (prev[emailId] || []).map(n => n.id === noteId ? data.note : n),
        }));
        // Refresh action notes so tasks view stays in sync
        fetchActionNotes();
      }
    } catch (e) {
      console.error('Failed to update agenda note:', e);
    }
  };

    const fetchCalendarForDate = async (date: Date, isRetry = false) => {
    const hadEventsAlready = scheduleEvents.length > 0;
    setLoadingSchedule(true);
    try {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const res = await fetch(`/api/calendar/today?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setScheduleEvents(data.events || []);
        setCalendarAuthError(false);
      } else if (res.status === 401 && !isRetry) {
        // Token expired — try silent refresh
        const refreshed = await refreshGoogleToken();
        if (refreshed) {
          await fetchCalendarForDate(date, true);
          return;
        } else {
          // Only show reconnect button if we have no data at all
          // (not just a mid-session refresh failure)
          if (!hadEventsAlready) {
            setCalendarAuthError(true);
          }
          setScheduleEvents([]);
        }
      } else {
        console.error('Calendar API returned error:', res.status);
        setScheduleEvents([]);
      }
    } catch (e) {
      console.error('Failed to fetch calendar:', e);
      setScheduleEvents([]);
    }
    setLoadingSchedule(false);
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setSelectedDate(newDate);
    fetchCalendarForDate(newDate);
  };

  const deleteCalendarEvent = async (eventId: string) => {
    if (!confirm('Delete this calendar event?')) return;
    try {
      const res = await fetch(`/api/calendar/delete?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setScheduleEvents(scheduleEvents.filter(e => e.id !== eventId));
      } else {
        alert('Failed to delete event');
      }
    } catch (e) {
      console.error('Failed to delete event:', e);
      alert('Failed to delete event');
    }
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  // Create calendar event from email
  const createEventFromEmail = (email: Email) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setEventFormData({
      title: email.subject,
      date: tomorrow.toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00',
      location: '',
      description: `From: ${email.from_name || email.from_email}\n\n${email.summary}`,
    });
    setShowEventModal(true);
  };

  // Dashboard popups
  const [showUrgentPopup, setShowUrgentPopup] = useState(false);
  const [showAgendaPopup, setShowAgendaPopup] = useState(false);
  const [showImportantDocsPopup, setShowImportantDocsPopup] = useState(false);
  const [editingImportantDocs, setEditingImportantDocs] = useState(false);
  const [editingAgendaId, setEditingAgendaId] = useState<string | null>(null);
  const [agendaNoteText, setAgendaNoteText] = useState('');

  // Email popup (for viewing from tasks/agenda)
  const [popupEmailId, setPopupEmailId] = useState<string | null>(null);
  const [popupDraftText, setPopupDraftText] = useState('');
  const [calendarAuthError, setCalendarAuthError] = useState(false);
  const popupEmail = popupEmailId ? emails.find(e => e.id === popupEmailId) : null;
  useEffect(() => {
    if (popupEmail) {
      setPopupDraftText(popupEmail.edited_draft || popupEmail.draft_reply || '');
    } else if (popupEmailId && workspaceId) {
      // Email not in local state (older than 500-email limit) — fetch it directly
      supabase.from('emails').select('*').eq('id', popupEmailId).eq('workspace_id', workspaceId).single().then(({ data }) => {
        if (data) {
          const email = data as Email;
          setEmails(prev => [...prev, email]);
          setPopupDraftText(email.edited_draft || email.draft_reply || '');
        }
      });
    }
  }, [popupEmailId]);

  // Agenda state
  const [agendaItemsList, setAgendaItemsList] = useState<AgendaItem[]>([]);
  const [recurringTopics, setRecurringTopics] = useState<RecurringTopic[]>([]);
  const [currentAgendaItemId, setCurrentAgendaItemId] = useState<string | null>(null);
  const [agendaNotes, setAgendaNotes] = useState<Record<string, AgendaNote[]>>({});
  const [actionNotes, setActionNotes] = useState<AgendaNote[]>([]);
  const [agendaTab, setAgendaTab] = useState<'all' | 'note' | 'decision' | 'action'>('all');
  const [addingNoteToId, setAddingNoteToId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [expandedAgendaId, setExpandedAgendaId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [tagDropdownItemId, setTagDropdownItemId] = useState<string | null>(null);
  const [projectDropdownItemId, setProjectDropdownItemId] = useState<string | null>(null);
  const [newProjectFromAgendaTitle, setNewProjectFromAgendaTitle] = useState('');
  const [newProjectFromAgendaDept, setNewProjectFromAgendaDept] = useState('');
  const [projectAddedConfirm, setProjectAddedConfirm] = useState<string | null>(null);
  const [showAddAgendaItem, setShowAddAgendaItem] = useState(false);
  const [addAgendaItemTitle, setAddAgendaItemTitle] = useState('');
  const [addAgendaItemSearch, setAddAgendaItemSearch] = useState('');
  const [addAgendaItemEmailId, setAddAgendaItemEmailId] = useState<string | null>(null);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskModalEmailId, setTaskModalEmailId] = useState<string | null>(null);
  const [taskModalText, setTaskModalText] = useState('');
  const [taskModalAssignee, setTaskModalAssignee] = useState<string>('');

  // Simchas & Shivas state
  const [bnbMitzvahs, setBnbMitzvahs] = useState<SimchaEvent[]>([]);
  const [weekCalendarEvents, setWeekCalendarEvents] = useState<CalendarEvent[]>([]);
  const [simchasLoading, setSimchasLoading] = useState(true);
  const [expandedSimcha, setExpandedSimcha] = useState<string | null>(null);
  const [simchasAttending, setSimchasAttending] = useState<Record<string, 'yes' | 'no'>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = JSON.parse(localStorage.getItem('simchasAttending') || '{}');
        // Migrate legacy boolean format
        const migrated: Record<string, 'yes' | 'no'> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v === true || v === 'yes') migrated[k] = 'yes';
          else if (v === false || v === 'no') migrated[k] = 'no';
        }
        return migrated;
      } catch { return {}; }
    }
    return {};
  });
  // sidebarCollapsed state moved into Sidebar component

  // Compose email state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  // Fetch Bar/Bat Mitzvah events and week calendar events (lazy)
  const simchasLoadedRef = useRef(false);
  useEffect(() => {
    if (activeNav !== 'simchas' || simchasLoadedRef.current) return;
    simchasLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      setSimchasLoading(true);
      try {
        const [simchasRes, calWeekRes] = await Promise.all([
          fetch('/api/simchas'),
          fetch('/api/calendar/week'),
        ]);
        if (simchasRes.ok) {
          const data = await simchasRes.json();
          if (!cancelled) setBnbMitzvahs(data.events || []);
        }
        if (calWeekRes.ok) {
          const data = await calWeekRes.json();
          if (!cancelled) setWeekCalendarEvents(data.events || []);
        }
      } catch (e) {
        console.error('Failed to fetch simchas:', e);
      }
      if (!cancelled) setSimchasLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeNav]);

  // Fetch dismissed invitation IDs (lazy, with simchas)
  const dismissedLoadedRef = useRef(false);
  useEffect(() => {
    if (activeNav !== 'simchas' || dismissedLoadedRef.current) return;
    dismissedLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/simchas/dismiss');
        if (res.ok) {
          const data = await res.json();
          setDismissedInvitations(new Set(data.dismissedIds || []));
        }
      } catch { /* silent */ }
    })();
  }, [activeNav]);

  const dismissInvitation = async (emailId: string) => {
    setDismissedInvitations(prev => new Set([...prev, emailId]));
    try {
      await fetch('/api/simchas/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      });
    } catch { /* silent */ }
  };

  // Client-side data cache for page data (5-minute TTL)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataCacheRef = useRef<Record<string, { data: any; timestamp: number }>>({});
  const [backgroundRefreshing, setBackgroundRefreshing] = useState<string | null>(null);
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Absences state
  const [absencesData, setAbsencesData] = useState<AbsencesData | null>(null);
  const [absencesLoading, setAbsencesLoading] = useState(false);
  // Date in view on the absences page. `null` means "today" — keeps
  // the existing live Veracross fetch unchanged. Setting a date here
  // switches the fetcher onto /api/absences/historical?date=YYYY-MM-DD.
  const [absencesDate, setAbsencesDate] = useState<string | null>(null);
  const [absencesCollapsed, setAbsencesCollapsed] = useState<Record<string, boolean>>({ absences: false, tardies: false, earlyDismissals: false, notExpected: false });
  // New grade-card layout: section collapse state + currently expanded
  // grade card (one at a time). ELC collapsed by default; LS + MS open.
  const [absencesSectionCollapsed, setAbsencesSectionCollapsed] = useState<{ elc: boolean; ls: boolean; ms: boolean }>({ elc: true, ls: false, ms: false });
  const [absencesExpandedGrade, setAbsencesExpandedGrade] = useState<number | null>(null);
  // YTD aggregation for the Attendance Distribution section. Fetched
  // separately + lazily so the today-attendance block paints first
  // and the heavier server aggregation streams in behind it.
  const [absencesYtdData, setAbsencesYtdData] = useState<AbsencesYtdData | null>(null);
  const [absencesYtdLoading, setAbsencesYtdLoading] = useState(false);
  const loadedAbsencesYtdRef = useRef(false);

  const fetchAbsences = useCallback(async (isBackground = false) => {
    if (!isBackground) setAbsencesLoading(true);
    else setBackgroundRefreshing('absences');
    try {
      // When absencesDate is null (=today) fall back to the live
      // Veracross route. For any past date use attendance_cache. The
      // dataCacheRef bucket is only used for today's data so old
      // navigations don't poison the cached "today" payload.
      const url = absencesDate
        ? `/api/absences/historical?date=${absencesDate}`
        : '/api/absences';
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setAbsencesData(data);
        if (!absencesDate) {
          dataCacheRef.current.absences = { data, timestamp: Date.now() };
        }
      }
    } catch (e) {
      console.error('Failed to fetch absences:', e);
    }
    if (!isBackground) setAbsencesLoading(false);
    else setBackgroundRefreshing(prev => prev === 'absences' ? null : prev);
  }, [absencesDate]);

  // Re-fetch when the user navigates the date picker. Today's data
  // stays cached separately so the trip back to today doesn't refetch.
  useEffect(() => {
    if (activeNav !== 'absences') return;
    if (absencesDate === null) {
      const cached = dataCacheRef.current.absences;
      if (cached) setAbsencesData(cached.data);
      else fetchAbsences();
      return;
    }
    fetchAbsences();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absencesDate]);

  useEffect(() => {
    if (activeNav !== 'absences') return;
    const cached = dataCacheRef.current.absences;
    if (cached && !absencesData) {
      setAbsencesData(cached.data);
    }
    if (!absencesData && !cached) {
      fetchAbsences();
    } else if (cached && Date.now() - cached.timestamp > CACHE_TTL) {
      fetchAbsences(true); // background refresh
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  // Lazy YTD aggregation fetch — fires once per session on first
  // Absences-page visit. Re-using the ref-based gate the rest of the
  // file relies on (e.g. loadedAdmissionsTagsRef) so refetch only
  // happens after an explicit Refresh action.
  useEffect(() => {
    if (activeNav !== 'absences') return;
    if (loadedAbsencesYtdRef.current) return;
    loadedAbsencesYtdRef.current = true;
    setAbsencesYtdLoading(true);
    apiFetch('/api/absences?view=ytd')
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (json) setAbsencesYtdData(json as AbsencesYtdData); })
      .catch(() => { /* silent — chart section just won't render */ })
      .finally(() => setAbsencesYtdLoading(false));
  }, [activeNav]);

  // Admissions state
  interface AdmissionApplication {
    application_id: number;
    applicant_id: number;
    year_applying_for: number;
    grade_applying_for: number;
    application_status: number;
    application_decision_response: number;
    application_date: string | null;
    application_decision_date: string | null;
    application_decision_response_date: string | null;
    requesting_financial_aid: boolean;
    decline_reason: string | null;
    student_group_applying_for: number;
    household_id?: number | null;
    isNewFamily?: boolean;
  }

  interface ReEnrollmentStudent {
    id: number;
    first_name: string;
    last_name: string;
    grade_level: number;
    next_grade: number;
    grade_applying_for: number | null;
    enrollment_status: number;
    campus: number;
    student_group: string | null;
    city: string | null;
    state: string | null;
  }

  const ENROLLMENT_STATUS_LABELS: Record<number, string> = {
    2: 'Pending Re-Enrollment',
    3: 'Likely to Re-Enroll',
    4: 'Re-Enrollment on Hold',
    5: 'Re-Enrolled',
    6: 'Likely to Re-Enroll',
    8: 'Not Re-Enrolling',
  };

  // Veracross grade_level uses admissions-style numbering:
  // 40=I/T, 35=2YN, 30=3YN, 25=4YN, 20=K, 1-8=1st-8th
  // ADMISSIONS_GRADE_LABELS works for both applicants (grade_applying_for) and re-enrollments (grade_level).

  // Canonical sort order for projection grade labels
  const PROJECTION_GRADE_ORDER = [
    'Infant/Toddler', '2 Year Nursery', '3 Year Nursery',
    '4 Year Nursery', 'Kindergarten', '1st Grade', '2nd Grade',
    '3rd Grade', '4th Grade', '5th Grade', '6th Grade',
    '7th Grade', '8th Grade',
    '9th Grade', '10th Grade', '11th Grade', '12th Grade',
  ];

  // Convert any grade number to a canonical string label for grouping
  // Both applicants (grade_applying_for) and re-enrollments (next_grade) use the same numbering
  const getCanonicalGradeKey = (_source: 'applicant' | 'reenrollment', grade: number): string => {
    return ADMISSIONS_GRADE_LABELS[grade] ?? `Grade ${grade}`;
  };

  const APPLICATION_STATUS_GROUPS: Record<string, number[]> = {
    Accepted: [4, 5, 12, 14, 15, 16],
    Waitlisted: [6, 17, 18, 19],
    Denied: [7, 13],
    Withdrawn: [9],
    'In Progress': [1, 2, 11],
    'N/A': [0],
  };

  const DECISION_RESPONSE_LABELS: Record<number, string> = {
    0: 'N/A', 1: 'Pending', 2: 'Enrollment Complete', 3: 'Declined Offer',
    4: 'Accepted Offer', 5: 'Enrollment Withdrawn', 6: 'Waitlist Accept',
    7: 'Waitlist Decline', 8: 'No Response', 9: 'Considering Offer',
  };

  const ADMISSIONS_GRADE_LABELS: Record<number, string> = {
    40: 'Infant/Toddler', 35: '2 Year Nursery', 30: '3 Year Nursery',
    25: '4 Year Nursery', 20: 'Kindergarten', 1: '1st Grade', 2: '2nd Grade',
    3: '3rd Grade', 4: '4th Grade', 5: '5th Grade', 6: '6th Grade',
    7: '7th Grade', 8: '8th Grade',
    9: '9th Grade', 10: '10th Grade', 11: '11th Grade', 12: '12th Grade',
  };

  const ADMISSIONS_GRADE_SORT = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // Reverse map: grade label → grade number (for currentYearCounts lookup)
  const GRADE_LABEL_TO_NEXT_NUMBER: Record<string, number> = {};
  for (const [num, label] of Object.entries(ADMISSIONS_GRADE_LABELS)) {
    GRADE_LABEL_TO_NEXT_NUMBER[label] = Number(num);
  }

  // School level grade groupings (using grade numbers)
  const ELC_GRADES = [40, 35, 30, 25, 20]; // I/T through K
  const LOWER_GRADES = [1, 2, 3, 4, 5]; // 1st through 5th
  const MIDDLE_GRADES = [6, 7, 8]; // 6th through 8th

  const APPLICATION_STATUS_DETAIL_LABELS: Record<number, string> = {
    0: 'N/A', 1: 'Pending Review', 2: 'In Process', 4: 'Accepted', 5: 'Accepted w/Condition',
    6: 'Waitlisted', 7: 'Denied', 9: 'Withdrawn', 11: 'Not Ready',
    12: 'Accepted from Waitlist', 13: 'Denied from Waitlist',
    14: 'Accepted (Academy)', 15: 'Accepted (HS)', 16: 'Accepted (ELC)',
    17: 'Waitlisted (HS)', 18: 'Waitlisted (ELC)', 19: 'Waitlisted (Academy)',
  };

  const [admissionsData, setAdmissionsData] = useState<AdmissionApplication[] | null>(null);
  const [reEnrollmentsData, setReEnrollmentsData] = useState<ReEnrollmentStudent[]>([]);
  const [currentYearCounts, setCurrentYearCounts] = useState<Record<number, number>>({});
  const [admissionsLoading, setAdmissionsLoading] = useState(false);
  const [admissionsLastFetched, setAdmissionsLastFetched] = useState<Date | null>(null);
  const [admissionsTab, setAdmissionsTab] = useState<'overview' | 'projection' | 'enrollment'>('overview');
  // Phase E: division toggle for multi-division users. 'academy' is the
  // safe default — RBK and the rest of the Academy team open straight
  // to their existing view. Only Becca + Debra May (divisions.length>1)
  // ever see the toggle.
  const [activeDivisionAdmissions, setActiveDivisionAdmissions] = useState<'academy' | 'hs' | 'both'>('academy');
  const [activeDivisionLever, setActiveDivisionLever] = useState<'academy' | 'hs' | 'both'>('academy');
  const [admissionsSearchTerm, setAdmissionsSearchTerm] = useState('');
  const [projectionDeclinedExpanded, setProjectionDeclinedExpanded] = useState(false);
  const [projectionNotReEnrollingExpanded, setProjectionNotReEnrollingExpanded] = useState(false);
  const [admissionsRefreshKey, setAdmissionsRefreshKey] = useState(0);
  const [admissionsDrilldown, setAdmissionsDrilldown] = useState<{ type: 'grade' | 'status' | 'response' | 'projection_grade' | 'projection_combined' | 'projection_category' | 'projection_leaving' | 'projection_pending' | 'projection_pisgah' | 'projection_incomplete' | 'projection_waitlist'; value: number; label: string } | null>(null);
  const [admissionsDrilldownSearch, setAdmissionsDrilldownSearch] = useState('');
  const [admissionsDrilldownFilter, setAdmissionsDrilldownFilter] = useState<'all' | 'new' | 're'>('all');
  // Per-student notes + tags inside the admissions drilldown side panel.
  // Bulk-fetched once per session (gated by loadedAdmissionsTagsRef) and
  // keyed on the full prefixed "Admissions: <fullName>" string so unrelated
  // donor tags returned by the same workspace-wide query are silently
  // ignored at lookup time. Pattern mirrors GuardianCirclePage's tagsByDonor.
  const [admissionsDrilldownTags, setAdmissionsDrilldownTags] = useState<Map<string, DonorTag[]>>(new Map());
  const loadedAdmissionsTagsRef = useRef(false);
  // Tracks which student card in the drilldown list is currently expanded
  // to show its DonorAnnotations panel. One open at a time.
  const [expandedAdmissionsStudent, setExpandedAdmissionsStudent] = useState<string | null>(null);
  const [overviewDrilldownFilter, setOverviewDrilldownFilter] = useState<'all' | 'enrolled' | 'pending' | 'declined'>('all');
  const [applicantNames, setApplicantNames] = useState<Record<number, string>>({});
  const [applicantNamesLoading, setApplicantNamesLoading] = useState(false);
  const [admissionsCities, setAdmissionsCities] = useState<Record<number, string>>({});
  // Parallel map to admissionsCities — populated by the same /api/admissions/cities
  // fetch. Used by the region-grouping logic in the geography donut so that
  // out-of-state addresses (NJ/CT) bucket correctly even when the city
  // name isn't on the CITY_TO_REGION whitelist.
  const [admissionsStates, setAdmissionsStates] = useState<Record<number, string>>({});
  const [admissionsCitiesLoading, setAdmissionsCitiesLoading] = useState(false);
  const [admissionsCitiesFailed, setAdmissionsCitiesFailed] = useState(false);
  const [hoveredCitySlice, setHoveredCitySlice] = useState<{ name: string; count: number; pct: string; x: number; y: number } | null>(null);
  const [shivaNoteSent, setShivaNoteSent] = useState<Record<string, boolean>>({});
  // Modal state for the Send Condolence Note flow. Holds the payload for
  // whichever Shiva email RBK is currently composing a note for.
  const [shivaModalPayload, setShivaModalPayload] = useState<SimchasSendNotePayload | null>(null);
  // Tiny self-dismissing toast for confirmation feedback (currently only
  // used by the Send Condolence Note flow).
  const [shivaToast, setShivaToast] = useState<string | null>(null);
  useEffect(() => {
    if (!shivaToast) return;
    const id = setTimeout(() => setShivaToast(null), 3000);
    return () => clearTimeout(id);
  }, [shivaToast]);
  const [dismissedInvitations, setDismissedInvitations] = useState<Set<string>>(new Set());

  // Enrollment budget state
  const [enrollmentBudget, setEnrollmentBudget] = useState<Record<string, number>>({});
  const [budgetEditingGrade, setBudgetEditingGrade] = useState<string | null>(null);
  const [budgetEditValue, setBudgetEditValue] = useState('');
  const [budgetSavedGrade, setBudgetSavedGrade] = useState<string | null>(null);

  // Grade override state
  interface GradeOverride { override_grade: string; reason: string | null; original_grade: string | null; student_name: string | null; updated_by: string | null; updated_at: string; is_pisgah: boolean; }
  const [gradeOverrides, setGradeOverrides] = useState<Record<string, GradeOverride>>({});
  const [overrideDropdownId, setOverrideDropdownId] = useState<string | null>(null);

  const [projectionCityExpanded, setProjectionCityExpanded] = useState(false);
  // 6-fix batch: Enrollment by Geography view toggle. 'city' is the
  // legacy behavior; 'region' groups via CITY_TO_REGION below.
  const [geoView, setGeoView] = useState<'city' | 'region'>('city');
  // Division toggle for multi-division users on the geography section.
  // Only Becca (academy+hs) sees this. HS / Institutional are
  // placeholders until HS admissions data lands.
  const [geoDivision, setGeoDivision] = useState<'academy' | 'hs' | 'institutional'>('academy');
  const [projectionCityDrilldown, setProjectionCityDrilldown] = useState<string | null>(null);
  const [projectionCityGradeFilter, setProjectionCityGradeFilter] = useState<string | null>(null);
  const [projectionCitySearch, setProjectionCitySearch] = useState('');

  // Lever recruiting state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [leverData, setLeverData] = useState<{ postings: any[]; opportunities: any[]; stages: any[] } | null>(null);
  const [leverLoading, setLeverLoading] = useState(false);
  const [leverRefreshKey, setLeverRefreshKey] = useState(0);
  const [leverShowStaleRoles, setLeverShowStaleRoles] = useState(false);
  const [selectedLeverStage, setSelectedLeverStage] = useState<string | null>(null);
  const [leverTeamFilter, setLeverTeamFilter] = useState<string | null>(null);
  const [leverPositionFilter, setLeverPositionFilter] = useState<string | null>(null);
  const [leverStaleFilter, setLeverStaleFilter] = useState<'14' | '30' | '90' | null>(null);
  const [leverSearchTerm, setLeverSearchTerm] = useState('');
  // leverFilterExpanded removed — filters use dropdowns now
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [leverCandidatePanel, setLeverCandidatePanel] = useState<any>(null);
  const [leverNotes, setLeverNotes] = useState<Array<{ id: string; text: string; createdAt: number; user: { name: string; email: string } | null }>>([]);
  const [leverNotesLoading, setLeverNotesLoading] = useState(false);
  const [leverNoteText, setLeverNoteText] = useState('');
  const [leverNotePosting, setLeverNotePosting] = useState(false);

  // Fetch notes when candidate panel opens
  useEffect(() => {
    if (!leverCandidatePanel?.id) { setLeverNotes([]); return; }
    setLeverNotesLoading(true);
    setLeverNotes([]);
    setLeverNoteText('');
    fetch(`/api/recruiting/notes?opportunityId=${leverCandidatePanel.id}`)
      .then(r => r.ok ? r.json() : { notes: [] })
      .then(d => setLeverNotes(d.notes || []))
      .catch(() => {})
      .finally(() => setLeverNotesLoading(false));
  }, [leverCandidatePanel?.id]);


  const fetchAdmissions = useCallback(async (isBackground = false, division: 'academy' | 'hs' | 'both' = 'academy') => {
    if (!isBackground) setAdmissionsLoading(true);
    else setBackgroundRefreshing('admissions');
    try {
      const res = await apiFetch(`/api/admissions?division=${division}`);
      if (res.ok) {
        const data = await res.json();
        setAdmissionsData(data.applications || []);
        setReEnrollmentsData(data.reEnrollments || []);
        setCurrentYearCounts(data.currentYearCounts || {});
        setAdmissionsLastFetched(new Date());
        dataCacheRef.current.admissions = { data, timestamp: Date.now() };
      }
    } catch (e) {
      console.error('Failed to fetch admissions:', e);
    }
    if (!isBackground) setAdmissionsLoading(false);
    else setBackgroundRefreshing(prev => prev === 'admissions' ? null : prev);
  }, []);

  // Re-fetch admissions when the division toggle changes (only meaningful
  // for multi-division users; single-division users keep activeDivision
  // pinned to 'academy' so this effect re-runs only on initial mount).
  useEffect(() => {
    if (activeNav !== 'admissions') return;
    // Invalidate the cache so a fresh request goes out with the new param.
    delete dataCacheRef.current.admissions;
    setAdmissionsData(null);
    fetchAdmissions(false, activeDivisionAdmissions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDivisionAdmissions]);

  useEffect(() => {
    if (activeNav !== 'admissions') return;
    const cached = dataCacheRef.current.admissions;
    if (cached && !admissionsData) {
      setAdmissionsData(cached.data.applications || []);
      setReEnrollmentsData(cached.data.reEnrollments || []);
      setCurrentYearCounts(cached.data.currentYearCounts || {});
      setAdmissionsLastFetched(new Date(cached.timestamp));
    }
    if (!admissionsData && !cached) {
      fetchAdmissions();
    } else if (cached && Date.now() - cached.timestamp > CACHE_TTL) {
      fetchAdmissions(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav, admissionsRefreshKey]);

  // Fetch enrollment budget when admissions tab loads
  useEffect(() => {
    if (activeNav !== 'admissions') return;
    if (Object.keys(enrollmentBudget).length > 0) return;
    (async () => {
      try {
        const res = await fetch('/api/admissions/budget');
        if (res.ok) {
          const data = await res.json();
          setEnrollmentBudget(data.budget || {});
        }
      } catch { /* silent */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  // Fetch grade overrides when admissions tab loads
  useEffect(() => {
    if (activeNav !== 'admissions') return;
    if (Object.keys(gradeOverrides).length > 0) return;
    (async () => {
      try {
        const res = await fetch('/api/admissions/grade-overrides');
        if (res.ok) {
          const data = await res.json();
          setGradeOverrides(data.overrides || {});
        }
      } catch { /* silent */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  const saveGradeOverride = async (studentId: string | number, studentName: string, originalGrade: string, overrideGrade: string, reason?: string, isPisgah?: boolean) => {
    const id = String(studentId);
    const existing = gradeOverrides[id];
    setGradeOverrides(prev => ({ ...prev, [id]: { override_grade: overrideGrade, reason: reason ?? existing?.reason ?? null, original_grade: originalGrade, student_name: studentName, updated_by: user?.email || null, updated_at: new Date().toISOString(), is_pisgah: isPisgah ?? existing?.is_pisgah ?? false } }));
    setOverrideDropdownId(null);
    try {
      await fetch('/api/admissions/grade-overrides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id, studentName, originalGrade, overrideGrade, reason, isPisgah }),
      });
    } catch { /* silent */ }
  };

  const togglePisgah = async (studentId: string | number, studentName: string, originalGrade: string, currentlyPisgah: boolean) => {
    const id = String(studentId);
    const existing = gradeOverrides[id];
    if (currentlyPisgah && existing && existing.override_grade === existing.original_grade && !existing.reason) {
      // No grade override, just a Pisgah flag — remove the record entirely
      await removeGradeOverride(studentId);
    } else {
      // Set/unset Pisgah flag
      const effectiveGrade = existing?.override_grade || originalGrade;
      setGradeOverrides(prev => ({
        ...prev,
        [id]: {
          ...(existing || { override_grade: effectiveGrade, reason: null, original_grade: originalGrade, student_name: studentName, updated_by: user?.email || null, updated_at: new Date().toISOString(), is_pisgah: false }),
          is_pisgah: !currentlyPisgah,
        },
      }));
      try {
        await fetch('/api/admissions/grade-overrides', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: id, studentName, originalGrade, isPisgah: !currentlyPisgah }),
        });
      } catch { /* silent */ }
    }
  };

  const removeGradeOverride = async (studentId: string | number) => {
    const id = String(studentId);
    setGradeOverrides(prev => { const next = { ...prev }; delete next[id]; return next; });
    setOverrideDropdownId(null);
    try {
      await fetch('/api/admissions/grade-overrides', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id }),
      });
    } catch { /* silent */ }
  };

  const saveBudget = async (gradeCode: string, count: number) => {
    setEnrollmentBudget(prev => ({ ...prev, [gradeCode]: count }));
    setBudgetEditingGrade(null);
    setBudgetSavedGrade(gradeCode);
    setTimeout(() => setBudgetSavedGrade(prev => prev === gradeCode ? null : prev), 1500);
    try {
      await fetch('/api/admissions/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gradeCode, count }),
      });
    } catch { /* silent */ }
  };

  // Fetch cities separately after admissions data loads (with retry)
  const fetchAdmissionsCities = useCallback(async (ids: number[]) => {
    setAdmissionsCitiesLoading(true);
    setAdmissionsCitiesFailed(false);
    const attempt = async (): Promise<{ cities: Record<number, string>; states: Record<number, string> }> => {
      const res = await fetch(`/api/admissions/cities?applicantIds=${ids.join(',')}`);
      if (!res.ok) throw new Error(`Cities API ${res.status}`);
      const data = await res.json();
      return { cities: data.cities || {}, states: data.states || {} };
    };
    try {
      let result = await attempt();
      // Retry once after 2s if empty (possible transient failure)
      if (Object.keys(result.cities).length === 0) {
        await new Promise(r => setTimeout(r, 2000));
        result = await attempt();
      }
      setAdmissionsCities(result.cities);
      setAdmissionsStates(result.states);
      setAdmissionsCitiesFailed(Object.keys(result.cities).length === 0);
    } catch {
      // Retry once after 2s on error
      try {
        await new Promise(r => setTimeout(r, 2000));
        const result = await attempt();
        setAdmissionsCities(result.cities);
        setAdmissionsStates(result.states);
        setAdmissionsCitiesFailed(Object.keys(result.cities).length === 0);
      } catch {
        setAdmissionsCitiesFailed(true);
      }
    }
    setAdmissionsCitiesLoading(false);
  }, []);

  useEffect(() => {
    if (!admissionsData || admissionsData.length === 0) return;
    if (Object.keys(admissionsCities).length > 0) return; // already loaded
    const ids = [...new Set(admissionsData.map(a => a.applicant_id))];
    if (ids.length === 0) return;
    fetchAdmissionsCities(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionsData]);



  // Reset search and filter when drilldown changes
  useEffect(() => {
    setAdmissionsDrilldownSearch('');
    setAdmissionsDrilldownFilter('all');
    setOverviewDrilldownFilter('all');
    setExpandedAdmissionsStudent(null);
  }, [admissionsDrilldown]);

  // Lazy bulk fetch of donor_tags for the admissions drilldown panel.
  // Fires once per session — the first time the drilldown opens — and
  // gates re-fetch with a ref so panel re-opens don't re-fire the query.
  // The same /api/development/donor-tags query that powers Guardian Circle
  // returns every workspace tag (including real donor tags); we filter by
  // map key at render time.
  useEffect(() => {
    if (!admissionsDrilldown) return;
    if (loadedAdmissionsTagsRef.current) return;
    loadedAdmissionsTagsRef.current = true;
    let cancelled = false;
    apiFetch('/api/development/donor-tags')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.tags) return;
        const map = new Map<string, DonorTag[]>();
        for (const t of json.tags as DonorTag[]) {
          const arr = map.get(t.constituent_name) || [];
          arr.push(t);
          map.set(t.constituent_name, arr);
        }
        setAdmissionsDrilldownTags(map);
      })
      .catch(() => { /* silent — annotations will just show empty tag rows */ });
    return () => { cancelled = true; };
  }, [admissionsDrilldown]);

  const updateAdmissionsTag = useCallback((constituentName: string, newTags: DonorTag[]) => {
    setAdmissionsDrilldownTags(prev => {
      const m = new Map(prev);
      if (newTags.length === 0) m.delete(constituentName);
      else m.set(constituentName, newTags);
      return m;
    });
  }, []);

  // Lazy-fetch applicant names when drilldown opens
  useEffect(() => {
    if (!admissionsDrilldown || !admissionsData) return;

    let filtered: AdmissionApplication[] = [];
    if (admissionsDrilldown.type === 'grade') {
      filtered = admissionsData.filter(a => a.grade_applying_for === admissionsDrilldown.value);
    } else if (admissionsDrilldown.type === 'projection_grade') {
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
        .filter(a => [2, 4, 9, 1].includes(a.application_decision_response))
        .filter(a => a.grade_applying_for === admissionsDrilldown.value);
    } else if (admissionsDrilldown.type === 'projection_combined') {
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
        .filter(a => [2, 4, 9, 1].includes(a.application_decision_response))
        .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === admissionsDrilldown.label);
    } else if (admissionsDrilldown.type === 'projection_category') {
      const catVal = admissionsDrilldown.value;
      const isSchool = catVal >= 10;
      const schoolGradeNums = catVal === 10 ? ELC_GRADES : catVal === 11 ? LOWER_GRADES : catVal === 12 ? MIDDLE_GRADES : [];
      const catCodes = isSchool || catVal === 0 ? [2, 4, 9, 1] : catVal === 1 ? [2] : catVal === 2 ? [4, 9, 1] : [];
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
        .filter(a => catCodes.includes(a.application_decision_response))
        .filter(a => isSchool ? schoolGradeNums.includes(a.grade_applying_for) : true);
    } else if (admissionsDrilldown.type === 'status') {
      const codes = APPLICATION_STATUS_GROUPS[admissionsDrilldown.label] || [];
      filtered = admissionsData.filter(a => codes.includes(a.application_status));
    } else if (admissionsDrilldown.type === 'response') {
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
        .filter(a => a.application_decision_response === admissionsDrilldown.value);
    } else if (admissionsDrilldown.type === 'projection_pending') {
      filtered = admissionsData
        .filter(a => a.application_status === 1)
        .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === admissionsDrilldown.label);
    } else if (admissionsDrilldown.type === 'projection_pisgah') {
      filtered = admissionsData
        .filter(a => a.student_group_applying_for === 1)
        .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === admissionsDrilldown.label);
    } else if (admissionsDrilldown.type === 'projection_incomplete') {
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
        .filter(a => [4, 9, 1].includes(a.application_decision_response))
        .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === admissionsDrilldown.label);
    } else if (admissionsDrilldown.type === 'projection_waitlist') {
      filtered = admissionsData
        .filter(a => APPLICATION_STATUS_GROUPS.Waitlisted.includes(a.application_status))
        .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === admissionsDrilldown.label);
    }

    // Only fetch IDs we don't already have
    const idsNeeded = [...new Set(filtered.map(a => a.applicant_id))].filter(id => !applicantNames[id]);
    if (idsNeeded.length === 0) return;

    let cancelled = false;
    setApplicantNamesLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/admissions/applicants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicantIds: idsNeeded }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setApplicantNames(prev => ({ ...prev, ...data.applicantNames }));
        }
      } catch (e) {
        console.error('Failed to fetch applicant names:', e);
      }
      if (!cancelled) setApplicantNamesLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionsDrilldown, admissionsData]);

  // Lazy-fetch applicant names when city drilldown opens
  useEffect(() => {
    if (!projectionCityDrilldown || !admissionsData) return;
    // Fetch names for ALL accepted new applicants (not just current city — avoids race with admissionsCities)
    const accepted = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status) && [2, 4, 9, 1].includes(a.application_decision_response));
    const idsNeeded = [...new Set(accepted.map(a => a.applicant_id))].filter(id => !applicantNames[id]);
    if (idsNeeded.length === 0) return;

    let cancelled = false;
    setApplicantNamesLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/admissions/applicants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicantIds: idsNeeded }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setApplicantNames(prev => ({ ...prev, ...data.applicantNames }));
        }
      } catch { /* silent */ }
      if (!cancelled) setApplicantNamesLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionCityDrilldown, admissionsData]);

  // Lazy-fetch declined applicant names when projection declined section expands
  useEffect(() => {
    if (!projectionDeclinedExpanded || !admissionsData) return;
    const declined = admissionsData
      .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
      .filter(a => a.application_decision_response === 3);
    const idsNeeded = [...new Set(declined.map(a => a.applicant_id))].filter(id => !applicantNames[id]);
    if (idsNeeded.length === 0) return;
    let cancelled = false;
    setApplicantNamesLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/admissions/applicants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicantIds: idsNeeded }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setApplicantNames(prev => ({ ...prev, ...data.applicantNames }));
        }
      } catch (e) {
        console.error('Failed to fetch declined applicant names:', e);
      }
      if (!cancelled) setApplicantNamesLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionDeclinedExpanded, admissionsData]);

  // Lever fetch with caching
  useEffect(() => {
    if (activeNav !== 'lever') return;
    const cached = dataCacheRef.current.lever;
    if (cached && !leverData) {
      setLeverData(cached.data);
    }
    if (!leverData && !cached) {
      setLeverLoading(true);
      apiFetch(`/api/lever?division=${activeDivisionLever}`).then(r => r.json()).then(d => {
        setLeverData(d);
        dataCacheRef.current.lever = { data: d, timestamp: Date.now() };
        setLeverLoading(false);
      }).catch(() => setLeverLoading(false));
    } else if (cached && Date.now() - cached.timestamp > CACHE_TTL) {
      setBackgroundRefreshing('lever');
      apiFetch(`/api/lever?division=${activeDivisionLever}`).then(r => r.json()).then(d => {
        setLeverData(d);
        dataCacheRef.current.lever = { data: d, timestamp: Date.now() };
        setBackgroundRefreshing(prev => prev === 'lever' ? null : prev);
      }).catch(() => setBackgroundRefreshing(prev => prev === 'lever' ? null : prev));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav, leverRefreshKey]);

  // Re-fetch lever when the division toggle changes.
  useEffect(() => {
    if (activeNav !== 'lever') return;
    delete dataCacheRef.current.lever;
    setLeverData(null);
    setLeverLoading(true);
    apiFetch(`/api/lever?division=${activeDivisionLever}`)
      .then(r => r.json())
      .then(d => {
        setLeverData(d);
        dataCacheRef.current.lever = { data: d, timestamp: Date.now() };
        setLeverLoading(false);
      })
      .catch(() => setLeverLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDivisionLever]);

  const getApplicationStatusLabel = (statusCode: number): string => {
    for (const [label, codes] of Object.entries(APPLICATION_STATUS_GROUPS)) {
      if (codes.includes(statusCode)) return label;
    }
    return 'Unknown';
  };

  const openTaskModal = (email: Email) => {
    setTaskModalEmailId(email.id);
    setTaskModalText(`Task: Follow up on "${email.subject}"`);
    setTaskModalAssignee(theirAssigneeKey ?? myAssigneeKey ?? '');
    setShowTaskModal(true);
  };

  const saveTaskFromModal = async () => {
    if (!taskModalEmailId || !taskModalText.trim()) return;
    const notes = `[@${taskModalAssignee.toUpperCase()}] ${taskModalText}`;
    await updateMeetingNotes(taskModalEmailId, notes);
    setShowTaskModal(false);
    setTaskModalEmailId(null);
    setTaskModalText('');
  };

  // Note task context popup
  const [noteTaskPopupId, setNoteTaskPopupId] = useState<string | null>(null);

  // Hide completed tasks toggle
  const [hideCompletedTasks, setHideCompletedTasks] = useState(true);

  // Tasks page state
  const [showCompletedRbk, setShowCompletedRbk] = useState(false);
  const [showCompletedTheirs, setShowCompletedTheirs] = useState(false);
  const [draftsToApproveCollapsed, setDraftsToApproveCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('draftsToApproveCollapsed') ?? 'true'); } catch { return true; }
    }
    return true;
  });
  const [expandedDraftApproveId, setExpandedDraftApproveId] = useState<string | null>(null);
  const [taskPanelId, setTaskPanelId] = useState<{ type: 'email' | 'note'; id: string } | null>(null);
  const [editingPanelTitle, setEditingPanelTitle] = useState(false);
  const [panelTitleText, setPanelTitleText] = useState('');
  const [taskDueDates, setTaskDueDates] = useState<Record<string, { date: string; time: string }>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('taskDueDates') || '{}'); } catch { return {}; }
    }
    return {};
  });
  const [taskLastUpdated, setTaskLastUpdated] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('taskLastUpdated') || '{}'); } catch { return {}; }
    }
    return {};
  });
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('taskNotes') || '{}'); } catch { return {}; }
    }
    return {};
  });
  // TBD notes are now stored in Supabase (email.tbd_notes), not localStorage
  const [taskOrder, setTaskOrder] = useState<Record<string, string[]>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('taskOrder') || '{}'); } catch { return {}; }
    }
    return {};
  });
  const [taskUrgent, setTaskUrgent] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('taskUrgent') || '{}'); } catch { return {}; }
    }
    return {};
  });
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [editingTaskNoteId, setEditingTaskNoteId] = useState<string | null>(null);
  const [editingTaskNoteText, setEditingTaskNoteText] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskText, setAddTaskText] = useState('');
  // Assignee state widened to all 5 users (the agenda_notes CHECK was
  // extended on 2026-05-19 to accept 'rbk' | 'emily' | 'sara' | 'leora' | 'becca').
  const [addTaskAssignee, setAddTaskAssignee] = useState<string>('rbk');
  const [taskPanelMode, setTaskPanelMode] = useState<'edit' | 'create'>('edit');
  const [createTaskText, setCreateTaskText] = useState('');
  const [createTaskAssignee, setCreateTaskAssignee] = useState<string>('rbk');
  const [createTaskDueDate, setCreateTaskDueDate] = useState('');
  const [createTaskUrgent, setCreateTaskUrgent] = useState(false);
  const [createTaskSaving, setCreateTaskSaving] = useState(false);

  // Projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Open project panel when projects finish loading (if pending from URL param)
  useEffect(() => {
    if (!pendingProjectPanelRef.current || projects.length === 0) return;
    const found = projects.find(p => p.id === pendingProjectPanelRef.current);
    if (found) {
      setSelectedProject(found);
      pendingProjectPanelRef.current = null;
    }
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [newProjectDepartment, setNewProjectDepartment] = useState('');
  const [newProjectPriority, setNewProjectPriority] = useState<'high' | 'medium' | 'low'>('medium');
  // Stores the Capitalized assigneeKey (e.g. 'RBK', 'Emily'). Initialized
  // to the current user; reset to the same in the addProject success path.
  const [newProjectAssignee, setNewProjectAssignee] = useState<string>('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectDueDate, setNewProjectDueDate] = useState('');
  // Migrated from localStorage → Supabase project_updates table on 2026-05-21.
  // `id` is the server-generated UUID; optimistic inserts carry a temp id
  // until the POST resolves. The card-recency check + panel render only
  // use `timestamp` so this shape stays backward compatible.
  const [projectUpdates, setProjectUpdates] = useState<Record<string, Array<{ id: string; text: string; timestamp: string; author?: string }>>>({});
  const [newUpdateText, setNewUpdateText] = useState('');
  const [updateEditorKey, setUpdateEditorKey] = useState(0);
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);

  // Tasks attached to a project (rows in the `tasks` Supabase table with
  // project_id = this project). Lazily fetched when the project side panel
  // opens. Inline add form state is colocated.
  interface ProjectTask {
    id: string;
    title: string;
    assigned_to: string;
    status: string;
  }
  const [projectTasksMap, setProjectTasksMap] = useState<Record<string, ProjectTask[]>>({});
  const [newProjectTaskTitle, setNewProjectTaskTitle] = useState('');
  const [newProjectTaskAssignee, setNewProjectTaskAssignee] = useState<string>('rbk');
  const [savingProjectTask, setSavingProjectTask] = useState(false);

  // Project drag-and-drop (cards between columns)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverDept, setDragOverDept] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const projectDragRef = useRef(false);

  // Column drag-and-drop (reorder departments)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('projectColumnOrder');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length === DEPARTMENTS.length) return parsed;
        }
      } catch {}
    }
    return DEPARTMENTS;
  });

  // Tags dropdown
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  const [panelDraftText, setPanelDraftText] = useState('');
  const [panelNoteText, setPanelNoteText] = useState('');
  const [completedNoteIds, setCompletedNoteIds] = useState<Set<string>>(new Set());

  // Gemara resources
  interface GemaraItem { id: string; type: 'link' | 'note'; title: string; url: string | null; body: string | null; created_at: string; }
  const [gemaraItems, setGemaraItems] = useState<GemaraItem[]>([]);
  const [loadingGemara, setLoadingGemara] = useState(true);
  const [showAddGemara, setShowAddGemara] = useState(false);
  const [newGemaraType, setNewGemaraType] = useState<'link' | 'note'>('link');
  const [newGemaraTitle, setNewGemaraTitle] = useState('');
  const [newGemaraUrl, setNewGemaraUrl] = useState('');
  const [newGemaraBody, setNewGemaraBody] = useState('');
  const [editingGemaraId, setEditingGemaraId] = useState<string | null>(null);
  const [editGemaraTitle, setEditGemaraTitle] = useState('');
  const [editGemaraUrl, setEditGemaraUrl] = useState('');
  const [editGemaraBody, setEditGemaraBody] = useState('');

  // Communications / Monday.com state
  interface MondayCommsItem { id: string; name: string; url: string; status: string; commType: string; notes: string; draftLink: string; file: string; requester: string; audience: string; dueDate: string }
  const [mondayCommsItems, setMondayCommsItems] = useState<MondayCommsItem[]>([]);
  const [commsLoading, setCommsLoading] = useState(false);
  const [commsError, setCommsError] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [requestNoteText, setRequestNoteText] = useState('');
  const [commsToast, setCommsToast] = useState<string | null>(null);

  const [showAddDoc, setShowAddDoc] = useState(false);
  const [showAddQuickLink, setShowAddQuickLink] = useState(false);
  const [newQuickLinkTitle, setNewQuickLinkTitle] = useState('');
  const [newQuickLinkUrl, setNewQuickLinkUrl] = useState('');

  const gemaraLoadedRef = useRef(false);
  useEffect(() => {
    if (activeNav !== 'gemara' || gemaraLoadedRef.current) return;
    gemaraLoadedRef.current = true;
    const fetchGemara = async () => {
      try {
        const res = await fetch('/api/gemara');
        if (res.ok) {
          const data = await res.json();
          setGemaraItems(data.items || []);
        }
      } catch (e) {
        console.error('Failed to load gemara items:', e);
      }
      setLoadingGemara(false);
    };
    fetchGemara();
  }, [activeNav]);

  const addGemaraItem = async () => {
    const title = newGemaraTitle.trim();
    if (!title) return;
    try {
      const payload = {
        type: newGemaraType,
        title,
        url: newGemaraType === 'link' ? newGemaraUrl.trim() || null : null,
        body: newGemaraType === 'note' ? newGemaraBody.trim() || null : null,
      };
      const res = await fetch('/api/gemara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Gemara save failed:', res.status, errData);
        return;
      }
      const data = await res.json();
      const item = data.item;
      if (item) {
        setGemaraItems(prev => [item, ...prev]);
      }
      setNewGemaraTitle('');
      setNewGemaraUrl('');
      setNewGemaraBody('');
      setShowAddGemara(false);
    } catch (e) {
      console.error('Failed to add gemara item:', e);
    }
  };

  const deleteGemaraItem = async (id: string) => {
    try {
      const res = await fetch(`/api/gemara?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setGemaraItems(prev => prev.filter(i => i.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete gemara item:', e);
    }
  };

  const updateGemaraItem = async (id: string, updates: { title: string; url?: string | null; body?: string | null }) => {
    try {
      const res = await fetch('/api/gemara', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      if (res.ok) {
        const data = await res.json();
        setGemaraItems(prev => prev.map(i => i.id === id ? { ...i, ...data.item } : i));
        setEditingGemaraId(null);
      }
    } catch (e) {
      console.error('Failed to update gemara item:', e);
    }
  };

  // Communications — fetch pending Monday.com items
  const fetchCommsItems = useCallback(async () => {
    setCommsLoading(true);
    setCommsError(null);
    try {
      const res = await fetch('/api/monday/communications');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMondayCommsItems(data.items || []);
    } catch (err) {
      console.error('Failed to fetch Monday communications:', err);
      setCommsError('Failed to load approvals');
    }
    setCommsLoading(false);
  }, []);

  useEffect(() => {
    if (activeNav === 'communications') fetchCommsItems();
  }, [activeNav, fetchCommsItems]);

  const handleCommsAction = async (itemId: string, action: 'approve' | 'request_changes', note?: string) => {
    setMondayCommsItems(prev => prev.filter(i => i.id !== itemId));
    setExpandedRequestId(null);
    setRequestNoteText('');
    const toastMsg = action === 'approve' ? 'Approved \u2713' : 'Sent back for revisions';
    setCommsToast(toastMsg);
    setTimeout(() => setCommsToast(null), 3000);
    try {
      await fetch('/api/monday/communications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action, note }),
      });
    } catch { /* optimistic — already removed */ }
  };

  // Important Docs - stored in database
  const [importantDocs, setImportantDocs] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocUrl, setNewDocUrl] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState('');

  // Load Important Docs from database on mount
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/important-docs');
        if (res.ok) {
          const data = await res.json();
          setImportantDocs(data.docs || []);
        }
      } catch (e) {
        console.error('Failed to load important docs:', e);
      }
      setLoadingDocs(false);
    };
    fetchDocs();
  }, []);

  const addImportantDoc = async (title: string, url: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url }),
      });
      if (res.ok) {
        const data = await res.json();
        setImportantDocs([...importantDocs, data.doc]);
      }
    } catch (e) {
      console.error('Failed to add doc:', e);
    }
  };

  const deleteImportantDoc = async (id: string) => {
    try {
      const res = await fetch(`/api/important-docs?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setImportantDocs(importantDocs.filter(d => d.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete doc:', e);
    }
  };

  const updateImportantDoc = async (id: string, title: string) => {
    try {
      const res = await fetch('/api/important-docs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title }),
      });
      if (res.ok) {
        setImportantDocs(importantDocs.map(d => d.id === id ? { ...d, title } : d));
        setEditingDocId(null);
        setEditingDocTitle('');
      }
    } catch (e) {
      console.error('Failed to update doc:', e);
    }
  };

  // Projects - fetch on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects || []);
        }
      } catch (e) {
        console.error('Failed to fetch projects:', e);
      }
      setLoadingProjects(false);
    };
    fetchProjects();
  }, []);

  const addProject = async () => {
    if (!newProjectTitle.trim() || !newProjectDepartment) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newProjectTitle.trim(),
          department: newProjectDepartment,
          priority: newProjectPriority,
          assignee: newProjectAssignee || myAssigneeKey,
          description: newProjectDescription.trim() || null,
          due_date: newProjectDueDate || null,
        }),
      });
      if (res.ok) {
        const { project } = await res.json();
        setProjects(prev => [project, ...prev]);
        setNewProjectTitle('');
        setNewProjectDepartment('');
        setNewProjectPriority('medium');
        setNewProjectAssignee(myAssigneeKey ?? '');
        setNewProjectDescription('');
        setNewProjectDueDate('');
        setShowAddProjectModal(false);
      }
    } catch (e) {
      console.error('Failed to add project:', e);
    }
  };

  const updateProject = async (id: string, fields: Partial<Project>) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      });
      if (res.ok) {
        const { project } = await res.json();
        setProjects(prev => prev.map(p => p.id === id ? project : p));
        if (selectedProject?.id === id) setSelectedProject(project);
      }
    } catch (e) {
      console.error('Failed to update project:', e);
    }
  };

  const archiveProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== id));
        setSelectedProject(null);
      }
    } catch (e) {
      console.error('Failed to archive project:', e);
    }
  };

  // Optimistic POST. The temp id is replaced with the server-generated UUID
  // once the API returns; the Realtime subscription will then deliver the
  // INSERT echo, but the dedup guard inside the subscription handler skips
  // entries whose id already exists in state.
  const addProjectUpdate = async (projectId: string, text: string) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const author = user?.displayName || user?.email?.split('@')[0] || 'unknown';
    const optimistic = { id: tempId, text, timestamp: new Date().toISOString(), author };

    setProjectUpdates(prev => ({
      ...prev,
      [projectId]: [optimistic, ...(prev[projectId] || [])],
    }));
    setNewUpdateText('');
    setUpdateEditorKey(k => k + 1);

    try {
      const res = await fetch('/api/project-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, text, author }),
      });
      if (!res.ok) throw new Error('POST failed');
      const { update } = await res.json();
      // Replace temp entry with the server row (id, canonical timestamp).
      setProjectUpdates(prev => ({
        ...prev,
        [projectId]: (prev[projectId] || []).map(u =>
          u.id === tempId
            ? { id: update.id, text: update.text, timestamp: update.created_at, author: update.author }
            : u,
        ),
      }));
    } catch {
      // Roll back the optimistic insert on failure.
      setProjectUpdates(prev => ({
        ...prev,
        [projectId]: (prev[projectId] || []).filter(u => u.id !== tempId),
      }));
    }
  };

  // Delete an update by id. Optimistic; rolls back on error.
  const deleteProjectUpdate = async (projectId: string, updateId: string) => {
    const prior = projectUpdates;
    setProjectUpdates(prev => ({
      ...prev,
      [projectId]: (prev[projectId] || []).filter(u => u.id !== updateId),
    }));
    try {
      const res = await fetch(`/api/project-updates?id=${updateId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('DELETE failed');
    } catch {
      setProjectUpdates(prior);
    }
  };

  // Fetch tasks attached to a project when the side panel opens. Reset
  // the inline form state on each open so a half-typed draft from one
  // project doesn't bleed into another.
  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;
    setNewProjectTaskTitle('');
    setNewProjectTaskAssignee('rbk');
    fetch(`/api/tasks?project_id=${encodeURIComponent(selectedProject.id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.tasks) return;
        setProjectTasksMap(prev => ({ ...prev, [selectedProject.id]: json.tasks }));
      })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [selectedProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProjectTask = async (projectId: string) => {
    const title = newProjectTaskTitle.trim();
    if (!title || savingProjectTask) return;
    setSavingProjectTask(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          assigned_to: newProjectTaskAssignee, // route normalizes to Capitalized
          source: 'project',
          source_ref: projectId,
          project_id: projectId,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.task) {
          setProjectTasksMap(prev => ({
            ...prev,
            [projectId]: [json.task, ...(prev[projectId] || [])],
          }));
          setNewProjectTaskTitle('');
        }
      }
    } catch { /* silent */ }
    setSavingProjectTask(false);
  };

  const toggleProjectTaskDone = async (projectId: string, task: ProjectTask) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    // Optimistic
    setProjectTasksMap(prev => ({
      ...prev,
      [projectId]: (prev[projectId] || []).map(t => t.id === task.id ? { ...t, status: nextStatus } : t),
    }));
    try {
      await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status: nextStatus }),
      });
    } catch { /* silent */ }
  };

  // Expanded task in My Tasks section
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  // Collapsible sections for inbox
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    important_no_action: false,
    review: false,
    invitation: false,
    fyi: false,
    untagged: false,
    shivaEmails: false,
  });

  // Move To dropdown state for untagged emails
  const [openMoveDropdown, setOpenMoveDropdown] = useState<string | null>(null);

  // Close move dropdown on outside click
  useEffect(() => {
    if (!openMoveDropdown) return;
    const handleClick = () => setOpenMoveDropdown(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [openMoveDropdown]);

  // Auto-expand sections when search is active
  useEffect(() => {
    if (searchQuery) {
      setExpandedSections({ important_no_action: true, review: true, invitation: true, fyi: true, untagged: true, shivaEmails: true });
    }
  }, [searchQuery]);

  // Derived data
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
      return { emailId: e.id, noteId: null as string | null, subject: e.subject, task: taskText, assignee: isEmily ? 'emily' : isRbk ? 'rbk' : null, isComplete, isDiscussed, priority: e.priority, date: e.received_at, source: 'email' as const };
    })
    .filter(t => t.assignee && t.task);

  const noteTasks = actionNotes
    .filter(n => n.assignee)
    .map(n => ({
      emailId: null as string | null,
      noteId: n.id,
      subject: null as string | null,
      task: n.text,
      // Internal task.assignee is lowercase across all sources (emailTasks
      // synthesizes from [@RBK]/[@EMILY] tags; agenda_notes API returns
      // Capitalized after the Phase B shim removal). Lowercase here for
      // consistent comparison via myAssigneeKeyLower/theirAssigneeKeyLower.
      assignee: (n.assignee ? n.assignee.toLowerCase() : null) as string | null,
      isComplete: completedNoteIds.has(n.id) || !!n.completed,
      isDiscussed: false,
      priority: null as string | null,
      date: n.created_at,
      source: (n.email_id ? 'email' : n.agenda_item_id ? 'agenda' : 'manual') as 'email' | 'agenda' | 'manual',
    }));

  const tasks = [...emailTasks, ...noteTasks].sort((a, b) => Number(a.isComplete) - Number(b.isComplete));

  const filteredTasks = tasks;

  const getTaskId = (t: typeof tasks[0]) => t.emailId || t.noteId || '';

  const sortByOrder = (list: typeof tasks, columnId: string) => {
    const order = taskOrder[columnId];
    if (!order) return list;
    return [...list].sort((a, b) => {
      const aIdx = order.indexOf(getTaskId(a));
      const bIdx = order.indexOf(getTaskId(b));
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
  };

  // Tasks columns are dynamic per current user + their assistant. The
  // "mine" / "theirs" pair replaces the legacy hardcoded RBK / Emily
  // columns. When no assistant is configured (most members),
  // pendingTheirs is empty and the assistant column hides itself.
  const pendingMine = myAssigneeKeyLower
    ? sortByOrder(filteredTasks.filter(t => t.assignee === myAssigneeKeyLower && !t.isComplete), myAssigneeKeyLower)
    : [];
  const completedMine = myAssigneeKeyLower
    ? filteredTasks.filter(t => t.assignee === myAssigneeKeyLower && t.isComplete)
    : [];
  const pendingTheirs = theirAssigneeKeyLower
    ? sortByOrder(filteredTasks.filter(t => t.assignee === theirAssigneeKeyLower && !t.isComplete), theirAssigneeKeyLower)
    : [];
  const completedTheirs = theirAssigneeKeyLower
    ? filteredTasks.filter(t => t.assignee === theirAssigneeKeyLower && t.isComplete)
    : [];

  const handleTaskDrop = useCallback((columnId: string, dragId: string, dropId: string) => {
    // columnId is the lowercase assigneeKey of the target column
    const list = columnId === myAssigneeKeyLower ? pendingMine : pendingTheirs;
    const ids = list.map(getTaskId);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dropId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    const next = { ...taskOrder, [columnId]: ids };
    setTaskOrder(next);
    localStorage.setItem('taskOrder', JSON.stringify(next));
  }, [pendingMine, pendingTheirs, taskOrder, myAssigneeKeyLower]);

  const touchTaskUpdated = useCallback((taskId: string) => {
    setTaskLastUpdated(prev => {
      const next = { ...prev, [taskId]: new Date().toISOString() };
      localStorage.setItem('taskLastUpdated', JSON.stringify(next));
      return next;
    });
  }, []);

  const saveTaskDueDate = useCallback((taskId: string, field: 'date' | 'time', value: string) => {
    const current = taskDueDates[taskId] || { date: '', time: '' };
    const updated = { ...current, [field]: value };
    const next = { ...taskDueDates, [taskId]: updated };
    if (!updated.date && !updated.time) delete next[taskId];
    setTaskDueDates(next);
    localStorage.setItem('taskDueDates', JSON.stringify(next));
    touchTaskUpdated(taskId);
  }, [taskDueDates, touchTaskUpdated]);

  const toggleTaskUrgent = useCallback((taskId: string) => {
    setTaskUrgent(prev => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      if (!next[taskId]) delete next[taskId];
      localStorage.setItem('taskUrgent', JSON.stringify(next));
      return next;
    });
  }, []);

  const saveNoteText = useCallback(async (noteId: string, text: string) => {
    setActionNotes(prev => prev.map(n => n.id === noteId ? { ...n, text } : n));
    try {
      await fetch(`/api/agenda-notes?id=${noteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    } catch (e) { console.error('Failed to save note text:', e); }
    touchTaskUpdated(`note-${noteId}`);
  }, [touchTaskUpdated]);

  const saveNoteAssignee = useCallback(async (noteId: string, assignee: string) => {
    setActionNotes(prev => prev.map(n => n.id === noteId ? { ...n, assignee } : n));
    try {
      await fetch(`/api/agenda-notes?id=${noteId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee }) });
    } catch (e) { console.error('Failed to save note assignee:', e); }
    touchTaskUpdated(`note-${noteId}`);
  }, [touchTaskUpdated]);

  // Legacy derived list for dashboard card count + agenda popup
  const agendaItems = emails.filter(e => e.flagged_for_meeting);

  // Fetch agenda items + recurring topics from API
  const fetchAgendaItemsList = async () => {
    try {
      const res = await fetch('/api/agenda-items');
      if (res.ok) {
        const data = await res.json();
        setAgendaItemsList(data.items || []);
        // Fetch notes for all items (email, topic, and manual)
        for (const item of (data.items || [])) {
          if (item.email_id) {
            fetchAgendaNotes(item.email_id);
          } else if (item.item_type === 'topic' || item.item_type === 'manual') {
            fetchAgendaNotes(item.id, { agendaItemId: item.id });
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch agenda items:', e);
    }
  };

  const fetchRecurringTopics = async () => {
    try {
      const res = await fetch('/api/agenda-items/topics');
      if (res.ok) {
        const data = await res.json();
        setRecurringTopics(data.topics || []);
      }
    } catch (e) {
      console.error('Failed to fetch recurring topics:', e);
    }
  };

  // Load agenda data on mount + sync flagged emails
  useEffect(() => {
    const initAgenda = async () => {
      // Fetch existing agenda items
      const res = await fetch('/api/agenda-items');
      if (!res.ok) return;
      const { items } = await res.json();
      setAgendaItemsList(items || []);

      // Sync flagged emails that aren't in agenda_items yet
      const existingEmailIds = new Set(
        (items || []).filter((i: AgendaItem) => i.item_type === 'email').map((i: AgendaItem) => i.email_id)
      );
      const flaggedEmails = emails.filter(e => e.flagged_for_meeting);
      let needsRefresh = false;
      for (const email of flaggedEmails) {
        if (!existingEmailIds.has(email.id)) {
          await fetch('/api/agenda-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_type: 'email', email_id: email.id }),
          });
          needsRefresh = true;
        }
      }
      if (needsRefresh) {
        const res2 = await fetch('/api/agenda-items');
        if (res2.ok) {
          const data2 = await res2.json();
          setAgendaItemsList(data2.items || []);
        }
      }

      // Fetch notes for all items (email and topic)
      for (const item of (items || [])) {
        if (item.email_id) {
          fetchAgendaNotes(item.email_id);
        } else if (item.item_type === 'topic') {
          fetchAgendaNotes(item.id, { agendaItemId: item.id });
        }
      }
    };
    initAgenda();
    fetchRecurringTopics();
  }, [emails.filter(e => e.flagged_for_meeting).map(e => e.id).join(',')]);

  const urgentEmails = emails.filter(e => e.priority === 'owner_action' && e.status !== 'done' && e.status !== 'archived');
  const activeEmails = emails.filter(e => showArchived || (e.status !== 'archived'));
  const emilyQueue = emails.filter(e => (e.priority === 'assistant_action' || e.draft_status === 'needs_revision' || e.action_status === 'tbd') && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk');
  const needsRevisionEmails = emails.filter(e => e.draft_status === 'needs_revision' && e.status !== 'done' && e.status !== 'archived');

  // Search filter helper
  const matchesSearch = (email: Email) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (email.subject || '').toLowerCase().includes(query) ||
      (email.from_email || '').toLowerCase().includes(query) ||
      (email.from_name || '').toLowerCase().includes(query) ||
      (email.summary || '').toLowerCase().includes(query) ||
      (email.body_text || '').toLowerCase().includes(query)
    );
  };

  // Exclude emails sent by the workspace owner (RBK's own sent mail that slipped through)
  // Phase E: workspace owner email — used to filter the owner's own
  // sent mail out of the inbox view. Falls back to the legacy hardcoded
  // value during cookie migration (defense-in-depth; the session
  // workspace endpoint now returns workspace_owner_email from the DB).
  const OWNER_EMAIL = (workspaceOwnerEmail || 'kraussb@saracademy.org').toLowerCase();
  const isOwnerEmail = (e: Email) => e.from_email?.toLowerCase() === OWNER_EMAIL;

  // Inbox view filtered lists (with search)
  const urgentAlerts = emails.filter(e => e.action_status === 'urgent' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && !isOwnerEmail(e) && matchesSearch(e));
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const urgentTasks = tasks.filter(t => {
    if (t.isComplete) return false;
    const tid = getTaskId(t);
    if (taskUrgent[tid]) return true;
    const dd = taskDueDates[tid];
    return dd?.date ? dd.date < todayET : false;
  });
  const totalUrgentCount = urgentAlerts.length + urgentTasks.length;
  // Helper to check if email is snoozed (has future reminder date/time)
  const isSnoozed = (email: Email) => {
    if (!email.reminder_date) return false;
    const reminderDate = new Date(email.reminder_date);
    return reminderDate > new Date();
  };

  // Filter out snoozed emails from main lists
  const rbkActionEmails = emails.filter(e => e.priority === 'owner_action' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e));
  const emilyActionEmails = emails.filter(e => e.priority === 'assistant_action' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e));
  const importantNoAction = emails.filter(e => e.priority === 'important_no_action' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e));
  const reviewEmails = emails.filter(e => e.priority === 'review' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e));
  const invitationEmails = emails.filter(e => e.priority === 'invitation' && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && e.from_email?.toLowerCase() !== 'egray@saracademy.org' && matchesSearch(e));
  const fyiEmails = emails.filter(e => (e.priority === 'fyi' || e.from_email?.toLowerCase() === 'egray@saracademy.org') && e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' && e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e));
  const shivaEmails = emails.filter(e => {
    if (e.action_status !== 'shiva' || e.status === 'done' || e.status === 'archived' || e.status === 'junk' || isSnoozed(e) || isOwnerEmail(e)) return false;
    // Only show official SAR condolence notices (Hamakom)
    const subj = (e.subject || '').toLowerCase();
    return subj.includes('hamakom') && matchesSearch(e);
  });

  // Parse the shiva end date from a Hamakom email body. Hamakom emails
  // list shiva schedule lines like
  //   "Sunday, May 18 from 9:00am - 9:00pm"
  //   "Thursday, May 21 from 8:00am - 5:00pm"
  // We want the LAST such line — that's when shiva ends. Returns a
  // pre-formatted human string ("Thursday, May 21 at 5:00pm") or null
  // if parsing fails (graceful degradation per spec).
  const SHIVA_DATE_LINE_RE = /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)[,\s]+\s*(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:[^0-9]+?)(\d{1,2}:\d{2}\s*(?:am|pm))\s*[-–to]+\s*(\d{1,2}:\d{2}\s*(?:am|pm))/gi;
  function parseShivaEndDate(body: string | null | undefined): string | null {
    if (!body) return null;
    SHIVA_DATE_LINE_RE.lastIndex = 0;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = SHIVA_DATE_LINE_RE.exec(body)) !== null) last = m;
    if (!last) return null;
    const [, day, month, dayNum, , endTime] = last;
    return `${day}, ${month} ${dayNum} at ${endTime}`;
  }

  // B'nei Mitzvah invitation emails for the Simchas page
  const bneiMitzvahInvitations = emails.filter(e => {
    if (e.priority !== 'invitation' || e.status === 'done' || e.status === 'junk') return false;
    const text = `${e.subject || ''} ${e.body_text || ''} ${e.summary || ''}`.toLowerCase();
    if (!(text.includes('bar mitzvah') || text.includes('bat mitzvah'))) return false;
    // Exclude reminders and confirmations — only show original invitations
    const subj = (e.subject || '').toLowerCase();
    if (subj.includes('reminder') || subj.includes('confirmed') || subj.includes('you are confirmed')) return false;
    if (dismissedInvitations.has(e.id)) return false;
    return true;
  });

  const knownPriorities = ['owner_action', 'assistant_action', 'important_no_action', 'review', 'invitation', 'fyi'];
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const untaggedEmails = emails.filter(e =>
    !knownPriorities.includes(e.priority) &&
    e.status !== 'done' && e.status !== 'archived' && e.status !== 'junk' &&
    e.action_status !== 'tbd' && e.action_status !== 'shiva' && !isSnoozed(e) && !isOwnerEmail(e) && matchesSearch(e) &&
    new Date(e.received_at) >= fourteenDaysAgo
  );
  const draftsReady = emails.filter(e => e.draft_status === 'draft_ready' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e) && !isOwnerEmail(e));
  const draftsApproved = emails.filter(e => e.draft_status === 'approved' && e.status !== 'done' && e.status !== 'archived' && !isSnoozed(e));
  const tbdEmails = emails.filter(e => e.action_status === 'tbd' && e.status !== 'done' && e.status !== 'archived');
  const tbdWithSuggestion = tbdEmails.filter(e => e.tbd_suggestion);

  // Filter out past events for today; show all events for other dates
  const now = new Date();
  const upcomingEvents = isToday(selectedDate)
    ? scheduleEvents.filter(event => event.isAllDay || new Date(event.endTime) > now)
    : scheduleEvents;
  const isEventPast = (event: CalendarEvent) => {
    if (event.isAllDay) return false;
    return new Date(event.endTime) < now;
  };

  const formatTime = (time: string, isAllDay: boolean) => {
    if (isAllDay) return 'All day';
    return format(parseISO(time), 'h:mm a');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getGmailUrl = (messageId: string | null | undefined) => {
    if (!messageId) return null;
    // Gmail URL format for opening a specific message
    return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
  };

  // API Functions
  const updateStatus = async (emailId: string, newStatus: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: newStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: newStatus } : e));

        // If marking as done, also archive in Gmail
        if (newStatus === 'done') {
          fetch(`/api/emails/${emailId}/archive`, { method: 'POST' })
            .catch(err => console.error('Gmail archive failed:', err));
        }
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  // Label email in Gmail as RBK/Done and archive — fire-and-forget
  const processEmailInGmail = (emailId: string) => {
    fetch('/api/gmail/process-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailId }),
    }).catch(err => console.error('Gmail process failed:', err));
  };

  // Move untagged email to a priority section
  const moveUntaggedEmail = async (emailId: string, newPriority: string) => {
    setOpenMoveDropdown(null);
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, priority: newPriority } : e));
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, priority: newPriority }),
      });
      if (!res.ok) console.error('Failed to move email:', await res.text());
    } catch (error) { console.error('Move failed:', error); }
  };

  // Mark email as junk and trash in Gmail
  const markAsJunk = async (emailId: string) => {
    setOpenMoveDropdown(null);
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, status: 'junk' } : e));
    try {
      await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, status: 'junk' }),
      });
    } catch (error) { console.error('Junk status update failed:', error); }
    // Fire-and-forget Gmail trash
    fetch('/api/gmail/trash-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailId }),
    }).catch(err => console.error('Gmail trash failed:', err));
  };

  const updateActionStatus = async (emailId: string, actionStatus: string | null) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, action_status: actionStatus }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, action_status: actionStatus } : e));
      } else {
        console.error('Failed to update action status:', await res.text());
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  // Request revision - sends draft back to Emily with comment
  const requestRevision = async (emailId: string, comment: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          draft_status: 'needs_revision',
          revision_comment: comment,
          priority: 'assistant_action' // Move to Emily's queue
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e,
          draft_status: 'needs_revision',
          priority: 'assistant_action'
        } : e));
        setRevisionEmailId(null);
        setRevisionComment('');
        if (expandedDraftApproveId === emailId) setExpandedDraftApproveId(null);
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  // Set reminder - hides email until reminder date
  const setReminder = async (emailId: string, reminderDate: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: emailId,
          action_status: 'remind_me',
          reminder_date: reminderDate
        }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? {
          ...e,
          action_status: 'remind_me',
          reminder_date: reminderDate
        } : e));
        setRemindMeEmailId(null);
        setRemindMeDate('');
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const toggleMeetingFlag = async (emailId: string, currentlyFlagged: boolean) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged_for_meeting: !currentlyFlagged }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const updateMeetingNotes = async (emailId: string, notes: string) => {
    try {
      const res = await fetch(`/api/emails/${emailId}/flag`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_notes: notes }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
  };

  const toggleTaskComplete = async (emailId: string) => {
    const email = emails.find(e => e.id === emailId);
    if (!email?.meeting_notes) return;
    let newNotes = email.meeting_notes;
    const isCompleting = !newNotes.includes('[DONE]');
    if (isCompleting) {
      newNotes = newNotes.replace('[@EMILY] ', '[@EMILY] [DONE] ').replace('[@RBK] ', '[@RBK] [DONE] ');
    } else {
      newNotes = newNotes.replace('[DONE] ', '').replace(' [DONE]', '');
    }
    await updateMeetingNotes(emailId, newNotes);
    // When completing, mark email done and process in Gmail
    if (isCompleting) {
      updateStatus(emailId, 'done');
      processEmailInGmail(emailId);
    }
  };

  const toggleNoteTaskComplete = async (noteId: string) => {
    const note = actionNotes.find(n => n.id === noteId);
    if (!note) return;
    const newCompleted = !note.completed;
    // Optimistic update — both local state and sticky completedNoteIds
    setActionNotes(prev => prev.map(n => n.id === noteId ? { ...n, completed: newCompleted } : n));
    setCompletedNoteIds(prev => {
      const next = new Set(prev);
      if (newCompleted) next.add(noteId); else next.delete(noteId);
      return next;
    });
    try {
      const res = await fetch(`/api/agenda-notes?id=${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: newCompleted }),
      });
      if (!res.ok) {
        console.error('Failed to toggle note task:', await res.text());
        setActionNotes(prev => prev.map(n => n.id === noteId ? { ...n, completed: !newCompleted } : n));
        setCompletedNoteIds(prev => {
          const next = new Set(prev);
          if (!newCompleted) next.add(noteId); else next.delete(noteId);
          return next;
        });
      } else if (newCompleted && note.email_id) {
        // When completing a note task connected to an email, mark email done and process in Gmail
        updateStatus(note.email_id, 'done');
        processEmailInGmail(note.email_id);
      }
    } catch (e) {
      console.error('Failed to toggle note task:', e);
      setActionNotes(prev => prev.map(n => n.id === noteId ? { ...n, completed: !newCompleted } : n));
      setCompletedNoteIds(prev => {
        const next = new Set(prev);
        if (!newCompleted) next.add(noteId); else next.delete(noteId);
        return next;
      });
    }
  };

  const saveDraft = async (emailId: string, draft: string, markReady = false) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited_draft: draft, draft_status: markReady ? 'draft_ready' : 'editing' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
        if (markReady) setEditingDraftId(null);
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const approveDraft = async (emailId: string) => {
    setUpdating(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_status: 'approved' }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(emails.map(e => e.id === emailId ? { ...e, ...updated } : e));
      }
    } catch (error) { console.error('Failed:', error); }
    setUpdating(null);
  };

  const sendEmail = async (emailId: string, isRetry = false) => {
    if (!isRetry && !confirm(`Send this email from ${user?.email ?? 'your account'}?`)) return;

    setSendingEmail(emailId);
    try {
      const res = await fetch(`/api/emails/${emailId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        alert('Email sent successfully!');
        // Update local state + mark done in DB (triggers archive)
        setEmails(emails.map(e =>
          e.id === emailId ? { ...e, status: 'done', action_status: 'sent' } : e
        ));
        // Collapse inline draft panel if open
        if (expandedDraftApproveId === emailId) setExpandedDraftApproveId(null);
        // Label and archive in Gmail
        processEmailInGmail(emailId);
      } else if (res.status === 401 && !isRetry) {
        // Token expired — try silent refresh then retry
        const refreshed = await refreshGoogleToken();
        if (refreshed) {
          setSendingEmail(null);
          await sendEmail(emailId, true);
          return;
        }
        alert('Session expired. Please sign out and sign back in.');
      } else {
        const error = await res.json();
        alert(`Failed to send: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to send:', error);
      alert('Failed to send email. Please try again.');
    }
    setSendingEmail(null);
  };

  const discardDraft = async (emailId: string) => {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/emails/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: emailId, draft_status: null, draft_reply: null, edited_draft: null }),
      });
      if (res.ok) {
        setEmails(prev => prev.map(e => e.id === emailId ? { ...e, draft_status: null, draft_reply: null, edited_draft: null } : e));
        if (expandedDraftApproveId === emailId) setExpandedDraftApproveId(null);
      }
    } catch (error) { console.error('Discard draft failed:', error); }
  };

  const createCalendarEvent = async () => {
    setCreatingEvent(true);
    try {
      const startDateTime = new Date(`${eventFormData.date}T${eventFormData.startTime}:00`);
      const endDateTime = new Date(`${eventFormData.date}T${eventFormData.endTime}:00`);

      const res = await fetch('/api/calendar/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: eventFormData.title,
          description: eventFormData.description || undefined,
          location: eventFormData.location || undefined,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
        }),
      });

      if (res.ok) {
        alert('Event created successfully!');
        setShowEventModal(false);
        setEventFormData({
          title: '',
          date: new Date().toISOString().split('T')[0],
          startTime: '09:00',
          endTime: '10:00',
          location: '',
          description: '',
        });
        // Refresh the page to get updated calendar
        window.location.reload();
      } else {
        const error = await res.json();
        alert(`Failed to create event: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to create event:', error);
      alert('Failed to create event. Please try again.');
    }
    setCreatingEvent(false);
  };

  const openEventModalFromEmail = (email: Email) => {
    setEventFormData({
      title: email.subject,
      date: new Date().toISOString().split('T')[0],
      startTime: '09:00',
      endTime: '10:00',
      location: '',
      description: `From: ${email.from_name || email.from_email}\n\n${email.summary || ''}`,
    });
    setShowEventModal(true);
  };

  // Badge Component - minimal dot indicator
  const Badge = ({ config }: { config: { bg: string; text: string; label: string; icon: string; dot?: string } }) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full inline-block ${config.dot || config.bg.split(' ')[0]}`}></span>
      <span className="text-slate-500 text-xs">{config.label}</span>
    </span>
  );

  // Convert URLs in text to clickable links
  const linkifyText = (text: string): React.ReactNode[] => {
    if (!text) return [text];
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">{part}</a>
      ) : part
    );
  };

  // Strip email signatures for clean display
  // Detect forwarded message dividers and extract the forwarded content
  const extractForwardedBody = (text: string): string => {
    if (!text) return '';
    const fwdPatterns = [
      /^-{5,}\s*Forwarded message\s*-{5,}/im,
      /^-{5,}\s*Original Message\s*-{5,}/im,
      /^Begin forwarded message:/im,
      /^-{3,}\s*Forwarded by\b/im,
    ];
    for (const pattern of fwdPatterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const before = text.slice(0, match.index).trim();
        const after = text.slice(match.index).trim();
        // Check if the outer wrapper has meaningful content (not just greeting/signature)
        const beforeLines = before.split('\n').filter(l => l.trim().length > 0);
        const isMeaningful = beforeLines.length > 2 && beforeLines.some(l => l.trim().length > 40);
        if (isMeaningful) {
          return before + '\n\n' + after;
        }
        return after;
      }
    }
    return text;
  };

  const stripSignature = (text: string): string => {
    if (!text) return '';
    // First extract forwarded content so we don't lose it during signature stripping
    const processed = extractForwardedBody(text);
    const lines = processed.split('\n');
    const cutPatterns = [
      /^--\s*$/,
      /^_{3,}/,
      /principal/i,
      /head of school/i,
      /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
      /www\./i,
      /@\w+\.\w+/,
      /sent from my/i,
    ];
    let cutIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (cutPatterns.some(p => p.test(lines[i]))) {
        cutIndex = i;
        break;
      }
    }
    return lines.slice(0, cutIndex).join('\n').replace(/^>+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  };

  // Unified expanded email panel — used everywhere an email is opened
  const ExpandedEmailPanel = ({ email }: { email: Email }) => {
    const [fetchedThreadEmails, setFetchedThreadEmails] = useState<Email[]>([]);
    const [gmailThread, setGmailThread] = useState<{ threadId: string; messages: GmailThreadMessage[] } | null>(null);
    const [gmailThreadLoading, setGmailThreadLoading] = useState(false);

    // Get thread emails from local state first
    const localThreadEmails = email.thread_id
      ? emails.filter(e => e.thread_id === email.thread_id)
      : [email];

    // Fetch full thread from Supabase if we might be missing emails
    useEffect(() => {
      if (!email.thread_id || !workspaceId) return;
      const fetchThread = async () => {
        try {
          const { data, error } = await supabase
            .from('emails')
            .select('*')
            .eq('thread_id', email.thread_id)
            .eq('workspace_id', workspaceId)
            .order('received_at', { ascending: true });
          if (!error && data && data.length > localThreadEmails.length) {
            setFetchedThreadEmails(data as Email[]);
          }
        } catch (err) { console.error('Thread fetch error:', err); }
      };
      fetchThread();
    }, [email.thread_id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch full Gmail thread on demand (uses message_id or thread_id)
    useEffect(() => {
      const lookupId = email.message_id || email.thread_id;
      if (!lookupId) return;
      setGmailThreadLoading(true);
      setGmailThread(null);
      fetch(`/api/gmail/thread/${lookupId}`)
        .then(res => {
          if (!res.ok) throw new Error(`Gmail thread fetch failed: ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data.messages && data.messages.length > 0) {
            setGmailThread(data);
          }
          setGmailThreadLoading(false);
        })
        .catch(err => {
          console.log('Gmail thread fetch unavailable, using Supabase fallback:', err.message);
          setGmailThreadLoading(false);
        });
    }, [email.message_id, email.thread_id]);

    const threadEmails = (fetchedThreadEmails.length > localThreadEmails.length ? fetchedThreadEmails : localThreadEmails)
      .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());

    // Determine display message count
    const displayCount = gmailThread ? gmailThread.messages.length : threadEmails.length;

    const draftValue = email.edited_draft || email.draft_reply || '';

    // Extract sender name from "Name <email>" format
    const parseSenderName = (from: string): string => {
      const match = from.match(/^(.+?)\s*<.+>$/);
      return match ? match[1].replace(/^["']|["']$/g, '') : from;
    };

    return (
      <div className="px-3 pb-3 flex flex-col h-full" onClick={(e) => e.stopPropagation()}>
        {/* Action needed banner */}
        {email.action_needed && email.action_needed !== 'No action needed' && email.action_needed !== 'None' && (
          <div className="mb-3 bg-white border border-slate-100 border-l-4 border-l-orange-400 rounded-xl shadow-md px-4 py-3 flex items-start gap-3 flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-orange-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Action Needed</p>
              <p className="text-sm text-slate-700">{email.action_needed}</p>
            </div>
          </div>
        )}

        {/* Attachments banner */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200 flex-shrink-0">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-amber-800">
                📎 {email.attachments.length} Attachment{email.attachments.length > 1 ? 's' : ''}
              </p>
              {getGmailUrl(email.message_id) && (
                <a
                  href={getGmailUrl(email.message_id)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                >
                  View Attachments →
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

        {/* Two column layout */}
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Left: Thread view */}
          <div className="flex-[4] min-w-0 flex flex-col">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1 flex-shrink-0">
              {displayCount > 1 ? `Thread (${displayCount})` : 'Original Email'}
              {gmailThreadLoading && <span className="ml-2 text-slate-300 font-normal">fetching...</span>}
            </p>
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed overflow-y-auto flex-1 space-y-3">
              {gmailThread ? (
                /* Gmail API thread — full HTML/text bodies */
                gmailThread.messages.map((msg, idx) => (
                  <div key={msg.id}>
                    {idx > 0 && <div className="border-t border-slate-200 my-2" />}
                    {gmailThread.messages.length > 1 && (
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="font-semibold text-slate-700">{parseSenderName(msg.from)}</span>
                        <span className="text-[10px] text-slate-400 ml-2 flex-shrink-0">
                          {format(new Date(msg.date), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    )}
                    {msg.bodyType === 'html' ? (
                      <div className="prose prose-sm max-w-none text-sm overflow-hidden max-h-[300px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.body) }} />
                    ) : (
                      <div className="whitespace-pre-wrap">{linkifyText(msg.body)}</div>
                    )}
                  </div>
                ))
              ) : (
                /* Supabase fallback — existing behavior */
                threadEmails.map((msg, idx) => (
                  <div key={msg.id}>
                    {idx > 0 && <div className="border-t border-slate-200 my-2" />}
                    {threadEmails.length > 1 && (
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="font-semibold text-slate-700">{msg.from_name || msg.from_email}</span>
                        <span className="text-[10px] text-slate-400 ml-2 flex-shrink-0">
                          {format(new Date(msg.received_at), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{linkifyText(stripSignature(msg.body_text || msg.summary))}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Draft reply */}
          <div className="flex-[5] min-w-0 flex flex-col">
            <div className="bg-white rounded-xl shadow-md border border-slate-100 p-3 flex flex-col gap-2 flex-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Draft Reply</p>
                <span className={`text-xs font-medium ${email.draft_status === 'draft_ready' ? 'text-green-600' : email.draft_status === 'approved' ? 'text-blue-600' : 'text-slate-400'}`}>
                  {email.draft_status === 'draft_ready' ? '✓ Ready' : email.draft_status === 'approved' ? '✓ Approved' : 'Not Started'}
                </span>
              </div>
              <textarea
                className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white flex-1"
                placeholder="Draft a reply..."
                defaultValue={draftValue}
                onChange={(e) => { draftTextRef.current = e.target.value; }}
                onBlur={() => { if (draftTextRef.current !== draftValue) saveDraft(email.id, draftTextRef.current); }}
              />
              <button onClick={() => saveDraft(email.id, draftTextRef.current, true)} className="w-full px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors flex-shrink-0">
                Mark Ready
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // TBD Input Card Component (Emily adds suggestions)
  const TbdInputCard = ({ email }: { email: Email }) => {
    const [suggestion, setSuggestion] = useState(email.tbd_suggestion || '');
    const [saving, setSaving] = useState(false);

    const saveSuggestion = async () => {
      if (!suggestion.trim()) return;
      setSaving(true);
      try {
        const res = await fetch('/api/emails/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: email.id, tbd_suggestion: suggestion.trim() }),
        });
        if (res.ok) {
          setEmails(prev => prev.map(e => e.id === email.id ? { ...e, tbd_suggestion: suggestion.trim() } : e));
        }
      } catch (error) { console.error('Failed to save suggestion:', error); }
      setSaving(false);
    };

    return (
      <div className="bg-white border border-slate-200 border-l-4 border-l-teal-500 rounded-xl p-4 shadow-sm">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-medium text-slate-900">{email.subject}</p>
            <p className="text-sm text-slate-500">{email.from_name || email.from_email} · {formatDistanceToNow(parseISO(email.received_at), { addSuffix: true })}</p>
          </div>
        </div>
        {email.summary && <p className="text-sm text-slate-600 mb-2">{email.summary}</p>}
        {email.action_needed && <p className="text-xs text-slate-500 mb-3"><span className="font-medium">Action needed:</span> {email.action_needed}</p>}
        <div className="mt-3">
          <label className="block text-xs font-medium text-teal-700 mb-1">Your suggestion</label>
          <textarea
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="What do you suggest for this email?"
            className="w-full border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-teal-300 focus:border-teal-400 outline-none resize-none"
            rows={2}
          />
          <button
            onClick={saveSuggestion}
            disabled={saving || !suggestion.trim()}
            className="mt-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : email.tbd_suggestion ? 'Update Suggestion' : 'Save Suggestion'}
          </button>
        </div>
      </div>
    );
  };

  // Email Card Component
  const EmailCard = ({ email }: { email: Email }) => {
    const priority = priorityConfig[email.priority] || priorityConfig.fyi;
    const status = statusConfig[email.status] || statusConfig.pending;
    const isExpanded = expandedEmail === email.id;

    return (
      <div className={`bg-white border border-slate-200 rounded-xl mb-2 shadow-sm transition-all duration-150 ${priority.borderLeft} ${isExpanded ? 'ring-2 ring-blue-200 ring-offset-1' : 'hover:shadow-md'} ${email.status === 'done' ? 'opacity-60' : ''}`}>

        {/* COLLAPSED / HEADER ROW — always visible */}
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
            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <div className="relative group">
                <button onClick={() => updateStatus(email.id, 'done')} className={`p-1.5 rounded-md transition-colors hover:bg-green-50 ${email.status === 'done' ? 'text-green-600' : 'text-slate-500 hover:text-green-600'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Mark Done</span>
              </div>
              <div className="relative group">
                <button onClick={() => updateActionStatus(email.id, email.action_status === 'urgent' ? null : 'urgent')} className={`p-1.5 rounded-md transition-colors hover:bg-red-50 ${email.action_status === 'urgent' ? 'text-red-600' : 'text-slate-500 hover:text-red-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Mark Urgent</span>
              </div>
              <div className="relative group">
                <button onClick={() => updateActionStatus(email.id, email.action_status === 'tbd' ? null : 'tbd')} className={`p-1.5 rounded-md transition-colors hover:bg-amber-50 ${email.action_status === 'tbd' ? 'text-amber-600' : 'text-slate-500 hover:text-amber-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Mark TBD</span>
              </div>
              <div className="relative group">
                <button onClick={() => { setRemindMeEmailId(email.id); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setRemindMeDate(tomorrow.toISOString().split('T')[0]); }} className="p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Remind Me</span>
              </div>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <div className="relative group">
                <button onClick={() => toggleMeetingFlag(email.id, email.flagged_for_meeting)} className={`p-1.5 rounded-md transition-colors hover:bg-amber-50 ${email.flagged_for_meeting ? 'text-amber-500' : 'text-slate-500 hover:text-amber-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill={email.flagged_for_meeting ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add to Agenda</span>
              </div>
              <div className="relative group">
                <button onClick={() => createEventFromEmail(email)} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add to Calendar</span>
              </div>
              <div className="relative group">
                <button onClick={() => { setTaskModalEmailId(email.id); setShowTaskModal(true); }} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                </button>
                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">Add Task</span>
              </div>
            </div>
          </div>

          {/* Summary preview — only when collapsed */}
          {!isExpanded && (
            <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{email.summary}</p>
          )}
        </div>

        {/* EXPANDED PANEL */}
        {isExpanded && <ExpandedEmailPanel email={email} />}

      </div>
    );
  };

  // Summary Card Component
  const SummaryCard = ({ icon, title, count, subtitle, gradient, topBorder, onClick }: {
    icon: string; title: string; count?: number; subtitle: string; gradient: string; topBorder?: string; onClick?: () => void;
  }) => (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm ${topBorder || ''} ${onClick ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-600 text-sm font-semibold uppercase tracking-wide">{title}</p>
          {count !== undefined && <p className="text-slate-900 text-3xl font-bold mt-1">{count}</p>}
          <p className="text-slate-400 text-sm mt-1">{subtitle}</p>
        </div>
        {title === 'Urgent' && count !== undefined && count > 0 ? (
          <span className="w-3 h-3 bg-red-500 rounded-full mt-1"></span>
        ) : title === 'Urgent' ? null : (
          <span className="text-2xl opacity-60">{icon}</span>
        )}
      </div>
    </div>
  );

  // Auth + workspace loading guard — prevents stale user data flash on refresh
  if (authLoading || !workspaceId) {
    return (
      <div className="bg-white w-full h-screen flex items-center justify-center">
        <svg className="w-8 h-8 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex">
      {/* Mobile backdrop — fades in behind the sidebar drawer */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed-overlay drawer below md, in-flow column at md+ */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-out md:static md:translate-x-0 md:transition-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <Sidebar
          user={user}
          activeNav={activeNav}
          setActiveNav={setActiveNav}
          role={role}
          allowedModules={allowedModules}
          effectiveModules={effectiveModules}
          workspaceId={workspaceId}
          workspaces={workspaces}
          switchWorkspace={switchWorkspace}
          signOut={signOut}
          unreadCount={emails.filter(e => e.is_unread).length}
          emilyQueueCount={emilyQueue.length}
          assistant={assistant}
          onCompose={() => { setComposeOpen(true); setComposeError(null); }}
          mounted={mounted}
          impersonating={impersonating}
          startImpersonation={startImpersonation}
          stopImpersonation={stopImpersonation}
          allMembers={allMembers}
          onNavClick={() => setSidebarOpen(false)}
          googleTasksConnected={googleTasksConnected}
        />
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile sticky header — hamburger + current page name */}
        <div className="md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-lg text-slate-700 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-medium text-slate-800 text-sm capitalize truncate px-2">
            {activeNav?.replace(/-/g, ' ') || 'Home'}
          </span>
          <div className="w-9" aria-hidden="true" />
        </div>
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-8 py-5 print:hidden">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-slate-900 font-semibold text-xl">{(() => {
                const hour = new Date().getHours();
                const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
                const firstName = (currentMember?.displayName ?? wsDisplayName ?? user?.email?.split('@')[0] ?? '').split(' ')[0] || 'there';
                return `${timeGreeting}, ${firstName}.`;
              })()}</h2>
              <p className="text-slate-500 text-sm mt-0.5">Here's what needs your attention today</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Meeting Countdown Alert */}
              {upcomingMeeting && (
                <div className="bg-amber-50 border border-amber-200 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                  <span className="font-medium text-amber-800 truncate max-w-[200px]">{upcomingMeeting.title}</span>
                  <span className="whitespace-nowrap text-amber-600">in {upcomingMeeting.minutesUntil} min{upcomingMeeting.minutesUntil !== 1 ? 's' : ''}</span>
                  {upcomingMeeting.meetingLink && (
                    <a
                      href={upcomingMeeting.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-amber-600 text-white px-3 py-1 rounded-lg font-medium hover:bg-amber-700 transition-colors ml-1 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Join
                    </a>
                  )}
                </div>
              )}
              {/* Urgent Alert Button - shows on all pages except inbox (which has banner) */}
              {urgentAlerts.length > 0 && activeNav !== 'inbox' && (
                <button
                  onClick={() => {
                    setActiveNav('inbox');
                    setExpandedEmail(urgentAlerts[0].id);
                  }}
                  className="bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  {urgentAlerts.length} Urgent
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Gmail OAuth consent banner */}
        {gmailBanner && (
          <div className={`mx-8 mt-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between ${gmailBanner.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
            <span>{gmailBanner.message}</span>
            <button onClick={() => setGmailBanner(null)} className="ml-4 text-lg leading-none opacity-50 hover:opacity-100">&times;</button>
          </div>
        )}

        <div className="p-8">
          {/* Dashboard View */}
          {activeNav === 'dashboard' && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Urgent Card */}
                <div
                  className={`bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-red-500 ${totalUrgentCount > 0 ? 'cursor-pointer hover:bg-slate-50 transition-colors' : ''}`}
                  onClick={totalUrgentCount > 0 ? () => setShowUrgentPopup(true) : undefined}
                >
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-600 text-sm font-semibold uppercase tracking-wide">Urgent</p>
                    {totalUrgentCount > 0 && <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>}
                  </div>
                  {totalUrgentCount === 0 ? (
                    <p className="text-slate-400 text-sm py-2">All clear</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                      {urgentAlerts.map((email) => (
                        <div key={email.id} className="bg-red-50/60 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors">
                          <p className="text-sm font-semibold text-slate-800 truncate">{email.subject}</p>
                          <p className="text-xs text-slate-500 truncate">{email.from_name || email.from_email}</p>
                        </div>
                      ))}
                      {urgentTasks.map((task) => (
                        <div key={getTaskId(task)} className="bg-red-50/60 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors">
                          <p className="text-sm font-semibold text-slate-800 truncate">{task.task}</p>
                          <p className="text-xs text-slate-500 truncate"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Task</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Links Card */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-blue-500">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-600 text-sm font-semibold uppercase tracking-wide">Quick Links</p>
                    <button
                      onClick={() => setShowAddQuickLink(!showAddQuickLink)}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showAddQuickLink ? 'Cancel' : '+ Add'}
                    </button>
                  </div>

                  {/* Add Quick Link Form */}
                  {showAddQuickLink && (
                    <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={newQuickLinkTitle}
                        onChange={(e) => setNewQuickLinkTitle(e.target.value)}
                        placeholder="Title"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      <input
                        type="url"
                        value={newQuickLinkUrl}
                        onChange={(e) => setNewQuickLinkUrl(e.target.value)}
                        placeholder="URL"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button type="button" onClick={() => { setShowAddQuickLink(false); setNewQuickLinkTitle(''); setNewQuickLinkUrl(''); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                        <button type="button" onClick={async () => { if (newQuickLinkTitle.trim() && newQuickLinkUrl.trim()) { await addImportantDoc(newQuickLinkTitle.trim(), newQuickLinkUrl.trim()); setNewQuickLinkTitle(''); setNewQuickLinkUrl(''); setShowAddQuickLink(false); } }} disabled={!newQuickLinkTitle.trim() || !newQuickLinkUrl.trim()} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">Save</button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <a
                      href="https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1.5 bg-blue-50/60 hover:bg-blue-50 rounded-lg px-2 py-1 transition-colors"
                    >
                      <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      <span className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[200px]">Today&apos;s Folder</span>
                    </a>
                    <a
                      href="https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?usp=drive_link"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1.5 bg-blue-50/60 hover:bg-blue-50 rounded-lg px-2 py-1 transition-colors"
                    >
                      <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      <span className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[200px]">Daily Announcements</span>
                    </a>
                    <a
                      href="https://drive.google.com/drive/folders/1-HDl_sA_9jDZPTEOGPJ7R57O5iU62AwE"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1.5 bg-blue-50/60 hover:bg-blue-50 rounded-lg px-2 py-1 transition-colors"
                    >
                      <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                      <span className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[200px]">Daily Folder</span>
                    </a>
                    {/* Dynamic Quick Links from database — cap at 3 (6 total with hardcoded) */}
                    {importantDocs.slice(0, 3).map((doc) => (
                      <div key={doc.id} className="group flex items-center gap-1.5 bg-blue-50/60 hover:bg-blue-50 rounded-lg px-2 py-1 transition-colors">
                        <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        <div className="flex-1 min-w-0">
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline truncate block max-w-[200px]">{doc.title}</a>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteImportantDoc(doc.id); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0 p-0.5"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    ))}
                    {importantDocs.length > 3 && (
                      <button onClick={() => setShowImportantDocsPopup(true)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors mt-1">
                        View all ({3 + importantDocs.length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Important Docs Card */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-amber-500">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-600 text-sm font-semibold uppercase tracking-wide">Important Docs</p>
                    <button
                      onClick={() => setShowAddDoc(!showAddDoc)}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showAddDoc ? 'Cancel' : '+ Add'}
                    </button>
                  </div>

                  {/* Add Doc Form */}
                  {showAddDoc && (
                    <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-2">
                      <input
                        autoFocus
                        type="text"
                        value={newDocTitle}
                        onChange={(e) => setNewDocTitle(e.target.value)}
                        placeholder="Title"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      <input
                        type="url"
                        value={newDocUrl}
                        onChange={(e) => setNewDocUrl(e.target.value)}
                        placeholder="URL"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button type="button" onClick={() => { setShowAddDoc(false); setNewDocTitle(''); setNewDocUrl(''); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                        <button type="button" onClick={async () => { if (newDocTitle.trim() && newDocUrl.trim()) { await addImportantDoc(newDocTitle.trim(), newDocUrl.trim()); setNewDocTitle(''); setNewDocUrl(''); setShowAddDoc(false); } }} disabled={!newDocTitle.trim() || !newDocUrl.trim()} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">Save</button>
                      </div>
                    </div>
                  )}

                  {/* Docs List */}
                  {loadingDocs ? (
                    <p className="text-slate-400 text-sm text-center py-4">Loading...</p>
                  ) : importantDocs.length === 0 ? (
                    <p className="text-slate-400 text-xs text-center py-4">No documents yet</p>
                  ) : (
                    <div className="space-y-1">
                      {importantDocs.slice(0, 6).map((doc) => (
                        <div key={doc.id} className="group flex items-center gap-1.5 bg-blue-50/60 hover:bg-blue-50 rounded-lg px-2 py-1 transition-colors">
                          <svg className="w-3 h-3 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                          <div className="flex-1 min-w-0">
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline truncate block max-w-[200px]">{doc.title}</a>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteImportantDoc(doc.id); }}
                            className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0 p-0.5"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      ))}
                      {importantDocs.length > 6 && (
                        <button onClick={() => setShowImportantDocsPopup(true)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors mt-1">
                          View all ({importantDocs.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Gemara Card — gated by module flag */}
                {effectiveModules?.gemara !== false && <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm border-t-4 border-t-emerald-500">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-600 text-sm font-semibold uppercase tracking-wide">Gemara</p>
                    <button
                      onClick={() => setShowAddGemara(!showAddGemara)}
                      className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showAddGemara ? 'Cancel' : '+ Add'}
                    </button>
                  </div>

                  {/* Add Item Form */}
                  {showAddGemara && (
                    <div className="mb-3 p-3 bg-slate-50 rounded-lg space-y-2">
                      <div className="flex items-center gap-1 bg-white rounded-full p-0.5 border border-slate-200">
                        <button onClick={() => setNewGemaraType('link')} className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${newGemaraType === 'link' ? 'bg-blue-500 text-white' : 'text-slate-500'}`}>Link</button>
                        <button onClick={() => setNewGemaraType('note')} className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${newGemaraType === 'note' ? 'bg-amber-500 text-white' : 'text-slate-500'}`}>Note</button>
                      </div>
                      <input
                        autoFocus
                        type="text"
                        value={newGemaraTitle}
                        onChange={(e) => setNewGemaraTitle(e.target.value)}
                        placeholder="Title"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      {newGemaraType === 'link' ? (
                        <input
                          type="url"
                          value={newGemaraUrl}
                          onChange={(e) => setNewGemaraUrl(e.target.value)}
                          placeholder="URL"
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                        />
                      ) : (
                        <textarea
                          value={newGemaraBody}
                          onChange={(e) => setNewGemaraBody(e.target.value)}
                          placeholder="Note body..."
                          rows={2}
                          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 resize-none focus:ring-2 focus:ring-slate-400 focus:outline-none"
                        />
                      )}
                      <div className="flex items-center gap-2 justify-end">
                        <button type="button" onClick={() => { setShowAddGemara(false); setNewGemaraTitle(''); setNewGemaraUrl(''); setNewGemaraBody(''); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                        <button type="button" onClick={addGemaraItem} disabled={!newGemaraTitle.trim()} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">Save</button>
                      </div>
                    </div>
                  )}

                  {/* Items List */}
                  {loadingGemara ? (
                    <p className="text-slate-400 text-sm text-center py-4">Loading...</p>
                  ) : gemaraItems.length === 0 ? (
                    <p className="text-slate-400 text-xs text-center py-4">No resources yet. Emily can add links and notes here.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                      {gemaraItems.map((item) => (
                        editingGemaraId === item.id ? (
                          <div key={item.id} className="p-3 bg-slate-50 rounded-lg space-y-2">
                            <input
                              autoFocus
                              type="text"
                              value={editGemaraTitle}
                              onChange={(e) => setEditGemaraTitle(e.target.value)}
                              placeholder="Title"
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                            />
                            {item.type === 'link' ? (
                              <input
                                type="url"
                                value={editGemaraUrl}
                                onChange={(e) => setEditGemaraUrl(e.target.value)}
                                placeholder="URL"
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                              />
                            ) : (
                              <textarea
                                value={editGemaraBody}
                                onChange={(e) => setEditGemaraBody(e.target.value)}
                                placeholder="Note body..."
                                rows={2}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 resize-none focus:ring-2 focus:ring-slate-400 focus:outline-none"
                              />
                            )}
                            <div className="flex items-center gap-2 justify-end">
                              <button type="button" onClick={() => setEditingGemaraId(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                              <button type="button" onClick={() => updateGemaraItem(item.id, { title: editGemaraTitle, url: item.type === 'link' ? editGemaraUrl : null, body: item.type === 'note' ? editGemaraBody : null })} disabled={!editGemaraTitle.trim()} className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div key={item.id} className={`group flex items-start gap-2 rounded-lg px-3 py-2 transition-colors ${item.type === 'link' ? 'bg-blue-50/60 hover:bg-blue-50' : 'bg-amber-50/60 hover:bg-amber-50'}`}>
                            {item.type === 'link' ? (
                              <svg className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            )}
                            <div className="flex-1 min-w-0">
                              {item.type === 'link' && item.url ? (
                                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline">{item.title}</a>
                              ) : (
                                <p className="text-sm font-semibold text-slate-700">{item.title}</p>
                              )}
                              {item.body && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.body}</p>}
                            </div>
                            <button
                              onClick={() => { setEditingGemaraId(item.id); setEditGemaraTitle(item.title); setEditGemaraUrl(item.url || ''); setEditGemaraBody(item.body || ''); }}
                              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-slate-500 transition-all flex-shrink-0 p-0.5"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button
                              onClick={() => deleteGemaraItem(item.id)}
                              className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0 p-0.5"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </div>}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Today's Schedule */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => navigateDate('prev')}
                        className="text-slate-400 hover:text-slate-600 p-1"
                      >
                        ◀
                      </button>
                      <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <span className="text-blue-500">📅</span>
                        {isToday(selectedDate) ? "Today's Schedule" : format(selectedDate, 'EEE, MMM d')}
                      </h3>
                      <button
                        onClick={() => navigateDate('next')}
                        className="text-slate-400 hover:text-slate-600 p-1"
                      >
                        ▶
                      </button>
                      {!isToday(selectedDate) && (
                        <button
                          onClick={() => { setSelectedDate(new Date()); setScheduleEvents(calendarEvents); }}
                          className="text-xs text-blue-600 hover:text-blue-800 ml-2"
                        >
                          Back to Today
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowEventModal(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold transition-colors"
                      title="Add event"
                    >
                      +
                    </button>
                  </div>
                  {loadingSchedule ? (
                    <p className="text-slate-400 text-sm">Loading...</p>
                  ) : scheduleEvents.length === 0 ? (
                    calendarAuthError ? (
                      <div className="text-center py-4">
                        <p className="text-slate-400 text-xs mb-2">Calendar session expired</p>
                        <button
                          onClick={async () => {
                            const refreshed = await refreshGoogleToken();
                            if (refreshed) fetchCalendarForDate(selectedDate);
                          }}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                        >
                          Reconnect Calendar
                        </button>
                      </div>
                    ) : (
                      <p className="text-slate-400 text-sm">No events {isToday(selectedDate) ? 'today' : 'on this day'}</p>
                    )
                  ) : upcomingEvents.length === 0 ? (
                    <p className="text-slate-400 text-sm">No events on this day</p>
                  ) : (
                    <div className="space-y-1">
                      {upcomingEvents.map((event) => (
                        <div key={event.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                          <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded min-w-[60px] text-center">
                            {formatTime(event.startTime, event.isAllDay)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-900 text-sm truncate">{event.title}</p>
                            {event.location && <p className="text-xs text-slate-500 truncate">📍 {event.location}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            {event.meetingLink && (
                              <a
                                href={event.meetingLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded text-xs font-medium transition-colors"
                              >
                                Join
                              </a>
                            )}
                            {event.calendarLink && (
                              <a
                                href={event.calendarLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 text-xs"
                                title="View in Google Calendar"
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* To-Do Today */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                      <span className="text-blue-500">✅</span> To-Do Today
                    </h3>
                    <button
                      onClick={() => setHideCompletedTasks(!hideCompletedTasks)}
                      className={`text-xs px-2 py-1 rounded transition-all ${hideCompletedTasks ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {hideCompletedTasks ? 'Show Completed' : 'Hide Completed'}
                    </button>
                  </div>

                  {/* Urgent Items - Always at Top */}
                  {urgentAlerts.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Urgent</p>
                      <div className="space-y-2">
                        {urgentAlerts.map((email) => (
                          <div
                            key={email.id}
                            className="bg-white border border-red-200 border-l-4 border-l-red-500 rounded-lg p-3 cursor-pointer hover:bg-red-50 transition-colors shadow-sm"
                            onClick={() => setPopupEmailId(email.id)}
                          >
                            <p className="text-sm font-medium text-slate-900">{email.subject}</p>
                            <p className="text-xs text-slate-500">{email.from_name || email.from_email}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Review Drafts Sub-section */}
                  {draftsReady.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Review Drafts ({draftsReady.length})</p>
                      <div className="space-y-2">
                        {draftsReady.slice(0, 3).map((email) => (
                          <div
                            key={email.id}
                            className="bg-white border border-green-200 border-l-4 border-l-green-500 rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-all"
                            onClick={() => { setActiveNav('inbox'); setShowDraftsPopup(true); }}
                          >
                            <p className="text-sm font-medium text-slate-900 truncate">{email.subject}</p>
                            <p className="text-xs text-slate-500 mb-2">To: {email.from_email}</p>
                            <p className="text-xs text-slate-600 line-clamp-2">{(email.edited_draft || email.draft_reply || '').substring(0, 100)}...</p>
                          </div>
                        ))}
                        {draftsReady.length > 3 && (
                          <button
                            onClick={() => { setActiveNav('inbox'); setShowDraftsPopup(true); }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            View all {draftsReady.length} drafts →
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Approved Drafts Ready to Send */}
                  {draftsApproved.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Ready to Send ({draftsApproved.length})</p>
                        {draftsApproved.length > 1 && (
                          <button
                            onClick={async () => {
                              if (!confirm(`Send all ${draftsApproved.length} approved emails?`)) return;
                              setSendingBatch(true);
                              try {
                                const res = await fetch('/api/emails/send-batch', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ emailIds: draftsApproved.map(e => e.id) }),
                                });
                                const result = await res.json();
                                if (res.ok) {
                                  const sentIds = result.results.filter((r: { success: boolean }) => r.success).map((r: { id: string }) => r.id);
                                  setEmails(prev => prev.map(e =>
                                    sentIds.includes(e.id) ? { ...e, status: 'done', action_status: 'sent' } : e
                                  ));
                                  alert(result.message);
                                } else {
                                  alert(`Failed: ${result.error}`);
                                }
                              } catch (error) {
                                console.error('Batch send error:', error);
                                alert('Failed to send emails.');
                              }
                              setSendingBatch(false);
                            }}
                            disabled={sendingBatch}
                            className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                          >
                            {sendingBatch ? 'Sending...' : 'Send All'}
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {draftsApproved.map((email) => (
                          <div key={email.id} className="bg-white border border-blue-200 border-l-4 border-l-blue-500 rounded-lg p-3 shadow-sm">
                            <p className="text-sm font-medium text-slate-900 truncate">{email.subject}</p>
                            <p className="text-xs text-slate-500 mb-2">To: {email.from_email}</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => sendEmail(email.id)}
                                disabled={sendingEmail === email.id}
                                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                              >
                                {sendingEmail === email.id ? 'Sending...' : 'Send'}
                              </button>
                              <button
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-xs font-medium"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tasks */}
                  {tasks.filter(t => myAssigneeKeyLower && t.assignee === myAssigneeKeyLower && (!hideCompletedTasks || !t.isComplete)).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Tasks</p>
                      <div className="space-y-2">
                        {[...tasks.filter(t => myAssigneeKeyLower && t.assignee === myAssigneeKeyLower && (!hideCompletedTasks || !t.isComplete))].sort((a, b) => {
                          const todayStr = new Date().toISOString().split('T')[0];
                          const aId = getTaskId(a); const bId = getTaskId(b);
                          const aOverdue = taskDueDates[aId]?.date ? taskDueDates[aId].date < todayStr : false;
                          const aUrgent = (taskUrgent[aId] || aOverdue) ? 1 : 0;
                          const bOverdue = taskDueDates[bId]?.date ? taskDueDates[bId].date < todayStr : false;
                          const bUrgent = (taskUrgent[bId] || bOverdue) ? 1 : 0;
                          return bUrgent - aUrgent;
                        }).map((task, idx) => {
                          const taskKey = task.emailId || task.noteId || String(idx);
                          const tid = getTaskId(task);
                          const isOverdue = (() => { const dd = taskDueDates[tid]; if (!dd?.date) return false; return dd.date < new Date().toISOString().split('T')[0]; })();
                          const isUrgent = (taskUrgent[tid] || isOverdue) && !task.isComplete;
                          const isPanelOpen = taskPanelId && ((taskPanelId.type === 'email' && taskPanelId.id === task.emailId) || (taskPanelId.type === 'note' && taskPanelId.id === task.noteId));
                          const dueDate = taskDueDates[tid];
                          const notes = taskNotes[tid];
                          const dueDateColor = (() => {
                            if (!dueDate?.date) return '';
                            const today = new Date().toISOString().split('T')[0];
                            if (dueDate.date < today) return 'text-red-500';
                            if (dueDate.date === today) return 'text-amber-500';
                            return 'text-slate-400';
                          })();
                          return (
                            <div
                              key={taskKey}
                              className={`rounded-lg transition-all cursor-pointer ${
                                task.isComplete ? 'bg-slate-50' : isUrgent ? 'bg-rose-50 border border-slate-200 border-l-4 border-l-amber-400 shadow-sm' : 'bg-white border border-slate-200 shadow-sm'
                              } ${isPanelOpen ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
                              onClick={() => { setTaskPanelMode('edit'); setTaskPanelId(task.emailId ? { type: 'email', id: task.emailId } : task.noteId ? { type: 'note', id: task.noteId } : null); }}
                            >
                              <div className="flex items-start gap-3 p-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); task.emailId ? toggleTaskComplete(task.emailId) : task.noteId ? toggleNoteTaskComplete(task.noteId) : undefined; }}
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                                    task.isComplete ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400 hover:bg-green-50'
                                  }`}
                                >
                                  {task.isComplete && '✓'}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className={`text-sm font-medium ${task.isComplete ? 'line-through text-slate-400' : 'text-slate-900'}`}>{task.task}</p>
                                    {isUrgent && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700 uppercase flex-shrink-0">Urgent</span>}
                                  </div>
                                  {task.subject ? (
                                    <p className="text-xs text-slate-400 truncate">Re: {task.subject}</p>
                                  ) : (
                                    <p className="text-xs text-amber-500">From agenda notes</p>
                                  )}
                                  {notes && <p className="text-xs text-slate-400 italic whitespace-pre-wrap line-clamp-3 mt-0.5">{notes}</p>}
                                  {dueDate?.date && (
                                    <div className={`flex items-center gap-1 mt-0.5 text-xs ${dueDateColor}`}>
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                      <span>{format(parseISO(dueDate.date), 'MMM d')}{dueDate.time ? ` at ${dueDate.time}` : ''}</span>
                                      {dueDate.time && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {urgentAlerts.length === 0 && draftsReady.length === 0 && draftsApproved.length === 0 && tasks.filter(t => myAssigneeKeyLower && t.assignee === myAssigneeKeyLower && (!hideCompletedTasks || !t.isComplete)).length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-4">All caught up! Nothing to do right now.</p>
                  )}
                </div>
              </div>

              {/* Owner Action Emails */}
              {urgentEmails.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
{ownerLabel} Action Emails
                  </h3>
                  <div className="space-y-4">
                    {urgentEmails.map((email) => (
                      <EmailCard key={email.id} email={email} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Inbox View - Redesigned */}
          {activeNav === 'inbox' && (
            <>
            <div className="space-y-6">
              {/* Urgent Alert Banner */}
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
                        draftTextRef.current = urgentAlerts[0].edited_draft || urgentAlerts[0].draft_reply || '';
                        updateActionStatus(urgentAlerts[0].id, null);
                      }}
                      className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors text-sm"
                    >
                      View Now
                    </button>
                  </div>
                </div>
              )}

              {/* Zone 1: Top Bar */}
              <div className="flex items-center gap-3 mb-3">
                <select
                  value={emailCategory}
                  onChange={(e) => { setEmailCategory(e.target.value); setExpandedEmail(null); }}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="rbk">{ownerLabel} Action ({rbkActionEmails.length})</option>
                  <option value="review">Review ({reviewEmails.length})</option>
                  <option value="important">Important No Action ({importantNoAction.length})</option>
                  <option value="invitation">Invitations ({invitationEmails.length})</option>
                  <option value="fyi">FYI ({fyiEmails.length})</option>
                  <option value="untagged">Untagged ({untaggedEmails.length})</option>
                  <option value="emily">{assistantLabel} Action ({emilyActionEmails.length})</option>
                  <option value="sent">Sent{sentEmails.length > 0 ? ` (${sentEmails.length})` : ''}</option>
                </select>
                <button
                  onClick={() => setShowDraftsPopup(true)}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  Drafts Ready
                  {draftsReady.length > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{draftsReady.length}</span>
                  )}
                </button>
                <button
                  onClick={() => setShowTbdPopup(true)}
                  className="bg-amber-500 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors flex items-center gap-2 relative"
                >
                  TBD
                  {tbdEmails.length > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{tbdEmails.length}</span>
                  )}
                  {tbdWithSuggestion.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-teal-400 rounded-full border-2 border-white" />
                  )}
                </button>
                <button
                  disabled={gmailSyncStatus === 'syncing'}
                  onClick={async () => {
                    setGmailSyncStatus('syncing');
                    try {
                      const res = await fetch('/api/gmail/sync', { method: 'POST' });
                      const data = await res.json();
                      if (data.success) {
                        setGmailSyncStatus('success');
                        setTimeout(() => refreshEmails(), 5000);
                      } else {
                        setGmailSyncStatus('error');
                      }
                    } catch {
                      setGmailSyncStatus('error');
                    }
                    setTimeout(() => setGmailSyncStatus('idle'), 3000);
                  }}
                  className={`ml-auto px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors border ${
                    gmailSyncStatus === 'success'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : gmailSyncStatus === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {gmailSyncStatus === 'syncing' ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Syncing...
                    </>
                  ) : gmailSyncStatus === 'success' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Synced!
                    </>
                  ) : gmailSyncStatus === 'error' ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      Failed
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Sync
                    </>
                  )}
                </button>
              </div>

              {/* Two-panel layout */}
              {(() => {
                const isSent = emailCategory === 'sent';
                const rawCategoryEmails = isSent ? [] :
                  emailCategory === 'rbk' ? rbkActionEmails :
                  emailCategory === 'review' ? reviewEmails :
                  emailCategory === 'important' ? importantNoAction :
                  emailCategory === 'invitation' ? invitationEmails :
                  emailCategory === 'fyi' ? fyiEmails :
                  emailCategory === 'untagged' ? untaggedEmails :
                  emailCategory === 'emily' ? emilyActionEmails :
                  [];
                // Sort RBK Action: urgent/unread first, then read by date
                const categoryEmails = emailCategory === 'rbk'
                  ? [...rawCategoryEmails].sort((a, b) => {
                      const aUrgentUnread = a.action_status === 'urgent' || a.is_unread ? 1 : 0;
                      const bUrgentUnread = b.action_status === 'urgent' || b.is_unread ? 1 : 0;
                      if (aUrgentUnread !== bUrgentUnread) return bUrgentUnread - aUrgentUnread;
                      // Within same group, sort by date descending
                      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
                    })
                  : rawCategoryEmails;
                const filteredSentEmails = isSent
                  ? sentEmails.filter(e =>
                      !searchQuery ||
                      e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      e.to.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                  : [];
                const selectedEmailObj = !isSent && expandedEmail ? emails.find(e => e.id === expandedEmail) : null;
                const selectedSentEmail = isSent && expandedEmail ? sentEmails.find(e => e.id === expandedEmail) : null;
                return (
                  <div className="flex gap-0" style={{ height: 'calc(100vh - 180px)' }}>
                    {/* Zone 2: Left panel — email list */}
                    <div className="w-[380px] flex-shrink-0 bg-white rounded-l-xl border border-slate-200 flex flex-col overflow-hidden">
                      {/* Search */}
                      <div className="p-3 border-b border-slate-100">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search emails..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 pl-9 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          />
                          <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          {searchQuery && (
                            <button
                              onClick={() => setSearchQuery('')}
                              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Email list */}
                      <div className="flex-1 overflow-y-auto">
                        {isSent ? (
                          sentLoading ? (
                            <div className="text-slate-400 text-sm text-center py-12">Loading sent emails...</div>
                          ) : filteredSentEmails.length === 0 ? (
                            <div className="text-slate-400 text-sm text-center py-12">No emails here</div>
                          ) : (
                            filteredSentEmails.map((email) => (
                              <div
                                key={email.id}
                                onClick={() => { setExpandedEmail(email.id); markEmailRead(email.id); }}
                                className={`px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors
                                  ${expandedEmail === email.id
                                    ? 'bg-blue-50 border-l-2 border-l-blue-500'
                                    : 'hover:bg-slate-50 border-l-2 border-l-transparent'}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-slate-700 truncate">
                                      To: {email.to.match(/^(.+?)\s*</)?.[1] || email.to}
                                    </p>
                                    <p className="text-sm text-slate-500 truncate">{email.subject}</p>
                                  </div>
                                  <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                                    {formatDistanceToNow(new Date(email.date), { addSuffix: true })}
                                  </span>
                                </div>
                              </div>
                            ))
                          )
                        ) : (
                          categoryEmails.length === 0 ? (
                            <div className="text-slate-400 text-sm text-center py-12">No emails here</div>
                          ) : (
                            (() => {
                              const isRbk = emailCategory === 'rbk';
                              const hasUnread = isRbk && categoryEmails.some(e => e.is_unread || e.action_status === 'urgent');
                              const hasRead = isRbk && categoryEmails.some(e => !e.is_unread && e.action_status !== 'urgent');
                              let dividerShown = false;
                              return categoryEmails.map((email) => {
                                const isUnreadOrUrgent = email.is_unread || email.action_status === 'urgent';
                                const showDivider = isRbk && hasUnread && hasRead && !isUnreadOrUrgent && !dividerShown;
                                if (showDivider) dividerShown = true;
                                return (
                                  <div key={email.id}>
                                    {showDivider && (
                                      <div className="flex items-center gap-3 px-4 py-2">
                                        <div className="flex-1 border-t border-slate-200" />
                                        <span className="text-xs text-slate-400">Earlier</span>
                                        <div className="flex-1 border-t border-slate-200" />
                                      </div>
                                    )}
                                    <div
                                      onClick={() => { setExpandedEmail(email.id); markEmailRead(email.id); draftTextRef.current = email.edited_draft || email.draft_reply || ''; }}
                                      className={`px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors
                                        ${expandedEmail === email.id
                                          ? 'bg-blue-50 border-l-2 border-l-blue-500'
                                          : 'hover:bg-slate-50 border-l-2 border-l-transparent'}`}
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-start gap-2 min-w-0 flex-1">
                                          <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${isRbk && isUnreadOrUrgent ? 'bg-blue-500' : (priorityConfig[email.priority]?.dot || 'bg-slate-300')}`} />
                                          <div className="min-w-0">
                                            <p className={`text-sm truncate ${email.is_unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                                              {email.from_name || email.from_email}
                                            </p>
                                            <p className={`text-sm truncate ${email.is_unread ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{email.subject}</p>
                                          </div>
                                        </div>
                                        <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                                          {formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              });
                            })()
                          )
                        )}
                      </div>
                    </div>

                    {/* Zone 3: Right panel — email detail */}
                    <div className="flex-1 bg-white rounded-r-xl border-t border-r border-b border-slate-200 flex flex-col h-full">
                      {isSent ? (
                        selectedSentEmail ? (
                          <>
                            <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-200 flex-shrink-0">
                              <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-slate-800 truncate">{selectedSentEmail.subject}</h2>
                                <p className="text-sm text-slate-500">To: {selectedSentEmail.to}</p>
                              </div>
                              <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0 mt-1">
                                {format(new Date(selectedSentEmail.date), 'MMM d, h:mm a')}
                              </span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 whitespace-pre-wrap text-sm text-slate-700">
                              {selectedSentEmail.body}
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            <p className="text-sm">Select an email to view it</p>
                          </div>
                        )
                      ) : selectedEmailObj ? (
                        <>
                          {/* Header: subject + sender on left, action icons on right */}
                          <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-slate-200 flex-shrink-0 overflow-visible relative">
                            <div className="min-w-0">
                              <h2 className="text-lg font-semibold text-slate-800 truncate">{selectedEmailObj.subject}</h2>
                              <p className="text-sm text-slate-500">{selectedEmailObj.from_name || selectedEmailObj.from_email}</p>
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0 overflow-visible">
                              <div className="relative group">
                                <button onClick={() => updateStatus(selectedEmailObj.id, 'done')} className={`p-1.5 rounded-md transition-colors hover:bg-green-50 ${selectedEmailObj.status === 'done' ? 'text-green-600' : 'text-slate-500 hover:text-green-600'}`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Mark Done</span>
                              </div>
                              <div className="relative group">
                                <button onClick={() => updateActionStatus(selectedEmailObj.id, selectedEmailObj.action_status === 'urgent' ? null : 'urgent')} className={`p-1.5 rounded-md transition-colors hover:bg-red-50 ${selectedEmailObj.action_status === 'urgent' ? 'text-red-600' : 'text-slate-500 hover:text-red-500'}`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Mark Urgent</span>
                              </div>
                              <div className="relative group">
                                <button onClick={() => updateActionStatus(selectedEmailObj.id, selectedEmailObj.action_status === 'tbd' ? null : 'tbd')} className={`p-1.5 rounded-md transition-colors hover:bg-amber-50 ${selectedEmailObj.action_status === 'tbd' ? 'text-amber-600' : 'text-slate-500 hover:text-amber-500'}`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Mark TBD</span>
                              </div>
                              <div className="relative group">
                                <button onClick={() => { setRemindMeEmailId(selectedEmailObj.id); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setRemindMeDate(tomorrow.toISOString().split('T')[0]); }} className="p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Remind Me</span>
                              </div>
                              <div className="w-px h-4 bg-slate-200 mx-1" />
                              <div className="relative group">
                                <button onClick={() => toggleMeetingFlag(selectedEmailObj.id, selectedEmailObj.flagged_for_meeting)} className={`p-1.5 rounded-md transition-colors hover:bg-amber-50 ${selectedEmailObj.flagged_for_meeting ? 'text-amber-500' : 'text-slate-500 hover:text-amber-500'}`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill={selectedEmailObj.flagged_for_meeting ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Add to Agenda</span>
                              </div>
                              <div className="relative group">
                                <button onClick={() => createEventFromEmail(selectedEmailObj)} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Add to Calendar</span>
                              </div>
                              <div className="relative group">
                                <button onClick={() => { setTaskModalEmailId(selectedEmailObj.id); setShowTaskModal(true); }} className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                                </button>
                                <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Add Task</span>
                              </div>
                              {!selectedEmailObj.is_unread && (
                                <div className="relative group">
                                  <button onClick={() => {
                                    setEmails(prev => prev.map(e => e.id === selectedEmailObj.id ? { ...e, is_unread: true } : e));
                                    fetch('/api/emails/status', {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: selectedEmailObj.id, is_unread: true }),
                                    }).catch(() => {});
                                  }} className="p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                                  </button>
                                  <span className="absolute bottom-full right-0 mb-1 px-2 py-0.5 bg-slate-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">Mark Unread</span>
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Email content */}
                          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                            <ExpandedEmailPanel key={selectedEmailObj.id} email={selectedEmailObj} />
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                          <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <p className="text-sm">Select an email to view it</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {/* Drafts Ready Popup */}
              {showDraftsPopup && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDraftsPopup(false)}>
                  <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">Drafts Ready for Review</h3>
                      <button onClick={() => setShowDraftsPopup(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
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
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => discardDraft(email.id)}
                                  className="border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                                >
                                  Discard
                                </button>
                                <button
                                  onClick={() => sendEmail(email.id)}
                                  disabled={sendingEmail === email.id}
                                  className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                                >
                                  {sendingEmail === email.id ? 'Sending...' : 'Send'}
                                </button>
                              </div>
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
                          onClick={async () => {
                            if (!confirm(`Send all ${draftsApproved.length} approved drafts?`)) return;
                            setSendingBatch(true);
                            try {
                              const res = await fetch('/api/emails/send-batch', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email_ids: draftsApproved.map(e => e.id) }),
                              });
                              const result = await res.json();
                              if (res.ok) {
                                // Update local state for successfully sent emails
                                const sentIds = result.results.filter((r: { success: boolean }) => r.success).map((r: { id: string }) => r.id);
                                setEmails(emails.map(e =>
                                  sentIds.includes(e.id) ? { ...e, status: 'done', action_status: 'sent' } : e
                                ));
                                alert(result.message);
                              } else {
                                alert(`Failed: ${result.error}`);
                              }
                            } catch (error) {
                              console.error('Batch send error:', error);
                              alert('Failed to send emails. Please try again.');
                            }
                            setSendingBatch(false);
                            setShowDraftsPopup(false);
                          }}
                          disabled={sendingBatch}
                          className="w-full bg-green-600 text-white py-3 rounded-xl font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {sendingBatch ? 'Sending All...' : `Send All Approved (${draftsApproved.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TBD Popup - moved to shared location at bottom of component */}

            </div>

            {/* Floating Selection Action Bar */}
            {selectedEmails.size > 0 && (
              <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center gap-4 z-40">
                <span className="font-medium text-sm">{selectedEmails.size} selected</span>
                <button
                  onClick={markSelectedDone}
                  disabled={bulkUpdating}
                  className="bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {bulkUpdating ? 'Updating...' : 'Mark Done'}
                </button>
                <button
                  onClick={clearSelection}
                  className="text-slate-400 hover:text-white transition-colors text-sm"
                >
                  Clear
                </button>
              </div>
            )}
            </>
          )}

          {/* Agenda View */}
          {activeNav === 'agenda' && (() => {
            const removeAgendaItem = async (itemId: string) => {
              await fetch(`/api/agenda-items?id=${itemId}`, { method: 'DELETE' });
              setAgendaItemsList(prev => prev.filter(i => i.id !== itemId));
            };
            const toggleDiscussed = async (item: AgendaItem) => {
              const res = await fetch('/api/agenda-items', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, is_discussed: !item.is_discussed }),
              });
              if (res.ok) {
                setAgendaItemsList(prev => prev.map(i => i.id === item.id ? { ...i, is_discussed: !i.is_discussed } : i));
              }
            };
            const handleDrop = async (targetId: string, e: React.DragEvent) => {
              e.preventDefault();
              if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return; }
              const oldList = [...agendaItemsList];
              const dragIdx = oldList.findIndex(i => i.id === draggingId);
              const dropIdx = oldList.findIndex(i => i.id === targetId);
              if (dragIdx === -1 || dropIdx === -1) { setDraggingId(null); setDragOverId(null); return; }
              const [moved] = oldList.splice(dragIdx, 1);
              oldList.splice(dropIdx, 0, moved);
              const reordered = oldList.map((item, idx) => ({ ...item, sort_order: idx }));
              setAgendaItemsList(reordered);
              setDraggingId(null);
              setDragOverId(null);
              await fetch('/api/agenda-items', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: reordered.map(i => ({ id: i.id, sort_order: i.sort_order })) }),
              });
            };
            const addTopicToAgenda = async (topicId: string) => {
              const res = await fetch('/api/agenda-items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_type: 'topic', topic_id: topicId }),
              });
              if (res.ok) fetchAgendaItemsList();
            };
            const createTopic = async () => {
              if (!newTopicName.trim()) return;
              const res = await fetch('/api/agenda-items/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newTopicName.trim() }),
              });
              if (res.ok) {
                setNewTopicName('');
                setShowAddTopic(false);
                fetchRecurringTopics();
              }
            };
            // Helper to update tags on an agenda item
            const updateItemTags = async (itemId: string, tags: string[]) => {
              const res = await fetch('/api/agenda-items', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: itemId, tags }),
              });
              if (res.ok) {
                setAgendaItemsList(prev => prev.map(i => i.id === itemId ? { ...i, tags } : i));
              }
            };

            // Helper to render a single agenda item row
            const renderItemRow = (item: AgendaItem, idx: number, isSubItem = false) => {
              const noteKey = item.email_id || item.id;
              const notes = agendaNotes[noteKey] || [];
              const isCurrent = currentAgendaItemId === item.id;
              const isExpanded = expandedAgendaId === item.id;
              const isTopicItem = item.item_type === 'topic';
              const isManualItem = item.item_type === 'manual';
              const itemTags = item.tags || [];

              // Compact note summary
              const noteSummary = notes.length > 0 ? `${notes.length} note${notes.length !== 1 ? 's' : ''}` : '';

              // Get item display title
              const itemTitle = isTopicItem
                ? (item.topic?.name || 'Untitled topic')
                : isManualItem
                ? (item.title || 'Untitled')
                : (item.email?.subject || 'Untitled');

              return (
                <div
                  key={item.id}
                  draggable={!isSubItem}
                  onDragStart={!isSubItem ? () => setDraggingId(item.id) : undefined}
                  onDragOver={!isSubItem ? (e: React.DragEvent) => { e.preventDefault(); setDragOverId(item.id); } : undefined}
                  onDrop={!isSubItem ? (e: React.DragEvent) => handleDrop(item.id, e) : undefined}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                  className={`bg-white border border-slate-200 rounded-lg shadow-sm transition-all ${
                    isCurrent ? 'border-l-4 border-l-blue-500 ring-1 ring-blue-100' : ''
                  } ${item.is_discussed ? 'opacity-60' : ''} ${
                    draggingId === item.id ? 'opacity-40' : ''
                  } ${dragOverId === item.id && draggingId !== item.id ? 'border-t-2 border-t-blue-500' : ''} ${
                    isSubItem ? 'ml-8' : ''
                  }`}
                >
                  {/* Collapsed row */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedAgendaId(null);
                        setCurrentAgendaItemId(null);
                      } else {
                        setExpandedAgendaId(item.id);
                        setCurrentAgendaItemId(item.id);
                      }
                    }}
                  >
                    {!isSubItem && (
                      <span className="text-slate-300 cursor-grab text-sm flex-shrink-0" onMouseDown={(e) => e.stopPropagation()}>{'\u2807'}</span>
                    )}

                    <span className="text-[11px] text-slate-400 font-medium w-4 text-center flex-shrink-0">{idx + 1}</span>

                    <button
                      onClick={(e) => { e.stopPropagation(); toggleDiscussed(item); }}
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[9px] transition-colors flex-shrink-0 ${
                        item.is_discussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-green-400'
                      }`}
                      title={item.is_discussed ? 'Mark undiscussed' : 'Mark discussed'}
                    >
                      {item.is_discussed && '\u2713'}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isTopicItem && <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0" />}
                        {isManualItem && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                        <p className={`font-medium text-xs truncate ${item.is_discussed ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {itemTitle}
                        </p>
                        {!isTopicItem && !isManualItem && (
                          <span className="text-[11px] text-slate-400 flex-shrink-0">{item.email?.from_name || item.email?.from_email || ''}</span>
                        )}
                      </div>
                      {/* Tag chips on collapsed row */}
                      {itemTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {itemTags.map(tag => (
                            <span key={tag} className="bg-slate-100 text-slate-600 text-[10px] rounded-full px-2 py-0.5">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {!isExpanded && noteSummary && (
                      <span className="text-xs text-slate-400 flex-shrink-0 hidden sm:inline">{noteSummary}</span>
                    )}

                    {isCurrent && (
                      <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">CURRENT</span>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); removeAgendaItem(item.id); }}
                      className="text-slate-300 hover:text-red-400 text-sm leading-none flex-shrink-0"
                      title="Remove from agenda"
                    >{'\u2715'}</button>

                    <span className={`text-xs text-slate-300 flex-shrink-0 ${isExpanded ? 'rotate-180 inline-block' : ''}`}>{'\u25BE'}</span>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-2 pt-1 border-t border-slate-100">
                      {/* Topic description */}
                      {isTopicItem && item.topic?.description && (
                        <p className="text-xs text-slate-500 mb-2">{item.topic.description}</p>
                      )}

                      {/* Email info line + View Email + Add to Projects */}
                      {!isTopicItem && !isManualItem && item.email && (
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-[11px] text-slate-400">{item.email.from_name || item.email.from_email}</span>
                          <span className="text-[11px] text-slate-300">{'\u00b7'}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPopupEmailId(item.email_id!); }}
                            className="text-xs text-blue-500 hover:underline"
                          >
                            View Email
                          </button>
                        </div>
                      )}

                      {/* Tags + Add tag */}
                      <div className="flex flex-wrap items-center gap-1 mb-2">
                        {itemTags.map(tag => (
                          <span key={tag} className="bg-slate-100 text-slate-600 text-xs rounded-full px-2 py-0.5 flex items-center gap-1">
                            {tag}
                            <button
                              onClick={(e) => { e.stopPropagation(); updateItemTags(item.id, itemTags.filter(t => t !== tag)); }}
                              className="text-slate-400 hover:text-red-400 text-[10px] leading-none"
                            >{'\u2715'}</button>
                          </span>
                        ))}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setTagDropdownItemId(tagDropdownItemId === item.id ? null : item.id); }}
                            className="text-[11px] text-slate-400 hover:text-blue-600 font-medium"
                          >+ tag</button>
                          {tagDropdownItemId === item.id && (
                            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 min-w-[140px]">
                              {recurringTopics.filter(t => !itemTags.includes(t.name)).map(topic => (
                                <button
                                  key={topic.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateItemTags(item.id, [...itemTags, topic.name]);
                                    setTagDropdownItemId(null);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                >{topic.name}</button>
                              ))}
                              {recurringTopics.filter(t => !itemTags.includes(t.name)).length === 0 && (
                                <p className="px-3 py-1.5 text-xs text-slate-400">No tags available</p>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Add to Projects */}
                        <div className="relative ml-auto">
                          <button
                            onClick={(e) => { e.stopPropagation(); setProjectDropdownItemId(projectDropdownItemId === item.id ? null : item.id); setNewProjectFromAgendaTitle(itemTitle); setNewProjectFromAgendaDept(''); }}
                            className="text-[11px] text-slate-400 hover:text-violet-600 font-medium"
                          >+ project</button>
                          {projectDropdownItemId === item.id && (
                            <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 p-3 w-60" onClick={(e) => e.stopPropagation()}>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                              <input
                                type="text"
                                value={newProjectFromAgendaTitle}
                                onChange={(e) => setNewProjectFromAgendaTitle(e.target.value)}
                                className="w-full h-7 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-2"
                              />
                              <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
                              <select
                                value={newProjectFromAgendaDept}
                                onChange={(e) => setNewProjectFromAgendaDept(e.target.value)}
                                className="w-full h-7 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-2"
                              >
                                <option value="">Select...</option>
                                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                              </select>
                              <button
                                onClick={async () => {
                                  if (!newProjectFromAgendaTitle.trim() || !newProjectFromAgendaDept) return;
                                  const res = await fetch('/api/projects', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      title: newProjectFromAgendaTitle.trim(),
                                      department: newProjectFromAgendaDept,
                                      status: 'active',
                                      progress: 0,
                                      description: `Created from agenda item: ${itemTitle}`,
                                    }),
                                  });
                                  if (res.ok) {
                                    setProjectDropdownItemId(null);
                                    setProjectAddedConfirm(item.id);
                                    setTimeout(() => setProjectAddedConfirm(null), 2000);
                                  }
                                }}
                                disabled={!newProjectFromAgendaTitle.trim() || !newProjectFromAgendaDept}
                                className="w-full bg-violet-600 text-white py-1.5 rounded text-xs font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors"
                              >Create</button>
                            </div>
                          )}
                          {projectAddedConfirm === item.id && (
                            <span className="absolute top-full right-0 mt-1 text-[11px] text-green-600 font-medium whitespace-nowrap">Added to Projects</span>
                          )}
                        </div>
                      </div>

                      {/* Notes thread */}
                      {notes.length > 0 && (
                        <div className="space-y-0.5">
                          {notes.map((note) => (
                            <div key={note.id} className="flex items-center gap-2 group py-1">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                note.type === 'decision' ? 'bg-blue-500' : note.type === 'action' ? 'bg-amber-500' : 'bg-slate-400'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {editingNoteId === note.id ? (
                                    <input
                                      type="text"
                                      value={editingNoteText}
                                      onChange={(e) => setEditingNoteText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && editingNoteText.trim()) {
                                          updateAgendaNote(noteKey, note.id, { text: editingNoteText.trim() });
                                          setEditingNoteId(null);
                                        }
                                        if (e.key === 'Escape') setEditingNoteId(null);
                                      }}
                                      onBlur={() => {
                                        if (editingNoteText.trim() && editingNoteText.trim() !== note.text) {
                                          updateAgendaNote(noteKey, note.id, { text: editingNoteText.trim() });
                                        }
                                        setEditingNoteId(null);
                                      }}
                                      autoFocus
                                      className="flex-1 px-2 py-0.5 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                    />
                                  ) : (
                                    <p
                                      className="text-sm text-slate-700 cursor-text hover:text-slate-900"
                                      onClick={(e) => { e.stopPropagation(); setEditingNoteId(note.id); setEditingNoteText(note.text); }}
                                    >{note.text}</p>
                                  )}
                                  {note.type === 'action' && note.assignee && editingNoteId !== note.id && (
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                                      (note.assignee?.toLowerCase() === theirAssigneeKeyLower) ? 'bg-blue-50 text-blue-600' : 'bg-violet-50 text-violet-600'
                                    }`}>
                                      {note.assignee?.toLowerCase() === theirAssigneeKeyLower ? (theirDisplayName ?? 'Assistant') : myDisplayName}
                                    </span>
                                  )}
                                  {editingNoteId !== note.id && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); deleteAgendaNote(noteKey, note.id); }}
                                      className="ml-auto text-slate-200 hover:text-red-400 text-xs flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >{'\u2715'}</button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add note input */}
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="text"
                          value={addingNoteToId === noteKey ? newNoteText : ''}
                          onFocus={() => setAddingNoteToId(noteKey)}
                          onChange={(e) => { setAddingNoteToId(noteKey); setNewNoteText(e.target.value); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newNoteText.trim()) {
                              if (isTopicItem) addAgendaNote(item.id, { agendaItemId: item.id });
                              else if (item.email_id) addAgendaNote(item.email_id);
                              else addAgendaNote(item.id, { agendaItemId: item.id });
                            }
                            if (e.key === 'Escape') { setAddingNoteToId(null); setNewNoteText(''); }
                          }}
                          placeholder="Add a note..."
                          className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                        />
                        <button
                          onClick={() => {
                            if (!newNoteText.trim()) return;
                            if (isTopicItem) addAgendaNote(item.id, { agendaItemId: item.id });
                            else if (item.email_id) addAgendaNote(item.email_id);
                            else addAgendaNote(item.id, { agendaItemId: item.id });
                          }}
                          disabled={addingNoteToId !== noteKey || !newNoteText.trim()}
                          className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            return (
            <div className="w-full">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  Meeting Agenda
                  <span className="ml-2 text-sm font-normal text-slate-400">{agendaItemsList.length} items</span>
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddAgendaItem(!showAddAgendaItem)}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                  >+ Add Item</button>
                  <button
                    onClick={() => {
                      const dateLabel = format(new Date(), 'EEE, MMM d');
                      const lines = agendaItemsList.map(i => {
                        const titleText = i.title || i.email?.subject || i.topic?.name || '(untitled)';
                        const status = i.is_discussed ? 'discussed' : 'pending';
                        return `• ${titleText} (${status})`;
                      });
                      const body = lines.length > 0 ? `\n${lines.join('\n')}` : '\n(no items)';
                      setSlackSendContext(`Meeting Agenda — ${dateLabel}${body}`);
                    }}
                    disabled={agendaItemsList.length === 0}
                    className="text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send agenda summary to a workspace member via Slack"
                  >
                    Send to Slack
                  </button>
                  {currentAgendaItemId && (
                    <button onClick={() => { setCurrentAgendaItemId(null); setExpandedAgendaId(null); }} className="text-xs text-slate-400 hover:text-slate-600">
                      Clear current
                    </button>
                  )}
                </div>
              </div>

              {/* Add Item Form */}
              {showAddAgendaItem && (
                <div className="bg-white border border-blue-200 rounded-lg p-3 mb-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={addAgendaItemTitle}
                      onChange={(e) => setAddAgendaItemTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && addAgendaItemTitle.trim()) {
                          (async () => {
                            const postBody: Record<string, unknown> = { item_type: addAgendaItemEmailId ? 'email' : 'manual', title: addAgendaItemTitle.trim() };
                            if (addAgendaItemEmailId) postBody.email_id = addAgendaItemEmailId;
                            console.log('Add agenda item (Enter): posting', postBody);
                            try {
                              const res = await fetch('/api/agenda-items', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(postBody),
                              });
                              console.log('Add agenda item (Enter): response status', res.status);
                              if (res.ok) {
                                fetchAgendaItemsList();
                                setAddAgendaItemTitle('');
                                setAddAgendaItemEmailId(null);
                                setAddAgendaItemSearch('');
                                setShowAddAgendaItem(false);
                              } else {
                                const errData = await res.json();
                                console.error('Add agenda item (Enter) failed:', errData);
                                alert('Failed to add item: ' + (errData.error || 'Unknown error'));
                              }
                            } catch (err) {
                              console.error('Add agenda item (Enter) error:', err);
                              alert('Failed to add item: network error');
                            }
                          })();
                        }
                        if (e.key === 'Escape') { setShowAddAgendaItem(false); setAddAgendaItemTitle(''); setAddAgendaItemEmailId(null); setAddAgendaItemSearch(''); }
                      }}
                      placeholder="Item title..."
                      autoFocus
                      className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                      onClick={async () => {
                        if (!addAgendaItemTitle.trim()) return;
                        const postBody: Record<string, unknown> = { item_type: addAgendaItemEmailId ? 'email' : 'manual', title: addAgendaItemTitle.trim() };
                        if (addAgendaItemEmailId) postBody.email_id = addAgendaItemEmailId;
                        console.log('Add agenda item: posting', postBody);
                        try {
                          const res = await fetch('/api/agenda-items', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(postBody),
                          });
                          console.log('Add agenda item: response status', res.status);
                          if (res.ok) {
                            fetchAgendaItemsList();
                            setAddAgendaItemTitle('');
                            setAddAgendaItemEmailId(null);
                            setAddAgendaItemSearch('');
                            setShowAddAgendaItem(false);
                          } else {
                            const errData = await res.json();
                            console.error('Add agenda item failed:', errData);
                            alert('Failed to add item: ' + (errData.error || 'Unknown error'));
                          }
                        } catch (err) {
                          console.error('Add agenda item error:', err);
                          alert('Failed to add item: network error');
                        }
                      }}
                      disabled={!addAgendaItemTitle.trim()}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40"
                    >Save</button>
                    <button
                      onClick={() => { setShowAddAgendaItem(false); setAddAgendaItemTitle(''); setAddAgendaItemEmailId(null); setAddAgendaItemSearch(''); }}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >Cancel</button>
                  </div>
                  {/* Optional email link */}
                  <div className="relative">
                    <input
                      type="text"
                      value={addAgendaItemSearch}
                      onChange={(e) => { setAddAgendaItemSearch(e.target.value); setAddAgendaItemEmailId(null); }}
                      placeholder="Link to email (search by subject)..."
                      className="w-full h-7 px-2 border border-slate-200 rounded text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    {addAgendaItemSearch.length >= 2 && !addAgendaItemEmailId && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-32 overflow-y-auto">
                        {emails.filter(e => e.subject.toLowerCase().includes(addAgendaItemSearch.toLowerCase())).slice(0, 5).map(e => (
                          <button
                            key={e.id}
                            onClick={() => { setAddAgendaItemEmailId(e.id); setAddAgendaItemSearch(e.subject); if (!addAgendaItemTitle.trim()) setAddAgendaItemTitle(e.subject); }}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 truncate"
                          >{e.subject}</button>
                        ))}
                      </div>
                    )}
                    {addAgendaItemEmailId && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500 text-xs">linked</span>
                    )}
                  </div>
                </div>
              )}

              {/* Agenda Items */}
              {agendaItemsList.length === 0 && !showAddAgendaItem ? (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
                  <p className="text-slate-500 font-medium">No items on the agenda</p>
                  <p className="text-sm text-slate-400 mt-1">Click "+ Add Item" or star emails to build your agenda</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {agendaItemsList.map((item, idx) => renderItemRow(item, idx))}
                </div>
              )}

              {/* TBD Section */}
              {(() => {
                const agendaTbdExpanded = expandedSections.agenda_tbd !== false;
                return (
                  <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedSections(s => ({ ...s, agenda_tbd: !agendaTbdExpanded }))}
                      className="w-full bg-amber-50 px-4 py-3 flex items-center justify-between text-slate-800 sticky top-0 z-10 border-b border-amber-100"
                    >
                      <span className="font-semibold text-sm">TBD</span>
                      <div className="flex items-center gap-2">
                        <span className={`${tbdEmails.length > 0 ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{tbdEmails.length}</span>
                        <span className={`transition-transform ${agendaTbdExpanded ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>
                    {agendaTbdExpanded && (
                      <div className="p-4 space-y-3">
                        {tbdEmails.length === 0 ? (
                          <p className="text-slate-500 text-sm text-center py-4">No TBD emails</p>
                        ) : (
                          tbdEmails.map((email) => (
                            <div
                              key={email.id}
                              className="border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-amber-300 hover:bg-amber-50/30 transition-colors"
                              onClick={() => setShowTbdPopup(true)}
                            >
                              <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                              <p className="text-slate-500 text-xs mt-0.5">{email.from_name || email.from_email} · {formatDistanceToNow(parseISO(email.received_at), { addSuffix: true })}</p>
                              {email.summary && <p className="text-sm text-slate-600 mt-2">{email.summary}</p>}
                              {email.tbd_suggestion && (
                                <div className="bg-teal-50 border border-teal-200 rounded-lg p-2 mt-2">
                                  <p className="text-xs text-teal-800"><span className="font-medium">Emily suggests:</span> {email.tbd_suggestion}</p>
                                </div>
                              )}
                              {email.tbd_notes && (
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2">
                                  <p className="text-xs text-slate-600 whitespace-pre-wrap">{email.tbd_notes}</p>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Available Tags */}
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Available Tags</h4>
                  <button
                    onClick={() => setShowAddTopic(!showAddTopic)}
                    className="text-xs text-slate-400 hover:text-blue-600 font-medium"
                  >+ Add</button>
                </div>

                {/* Inline add tag */}
                {showAddTopic && (
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={newTopicName}
                      onChange={(e) => setNewTopicName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') createTopic(); if (e.key === 'Escape') { setShowAddTopic(false); setNewTopicName(''); } }}
                      placeholder="New tag name..."
                      autoFocus
                      className="flex-1 h-8 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    />
                    <button onClick={createTopic} disabled={!newTopicName.trim()} className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40">Create</button>
                    <button onClick={() => { setShowAddTopic(false); setNewTopicName(''); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                  </div>
                )}

                {recurringTopics.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {Array.from(new Map(recurringTopics.map(t => [t.name, t])).values()).map((topic) => (
                      <div key={topic.id} className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1">
                        <span className="text-sm text-slate-700">{topic.name}</span>
                        <button
                          onClick={async () => {
                            await fetch('/api/agenda-items/topics', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: topic.id, is_active: false }),
                            });
                            fetchRecurringTopics();
                          }}
                          className="text-slate-400 hover:text-red-500 text-xs"
                          title="Remove tag"
                        >{'\u2715'}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {/* Tasks View */}
          {activeNav === 'tasks' && (
            <div className="relative">
              {/* Page Header */}
              <div className="flex items-center gap-3 mb-5">
                <h1 className="text-2xl font-bold text-slate-900">Tasks</h1>
                {tasksLive && <span className="flex items-center gap-1 text-[10px] text-green-500 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>}
                <button
                  onClick={() => { setTaskPanelMode('create'); setCreateTaskText(''); setCreateTaskAssignee('rbk'); setCreateTaskDueDate(''); setCreateTaskUrgent(false); setTaskPanelId({ type: 'note', id: '__create__' }); }}
                  className="h-7 px-3 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1"
                >
                  <span className="text-sm leading-none">+</span> Add
                </button>
                <span className="inline-flex items-center px-3 py-0.5 rounded-full text-sm bg-slate-100 text-slate-600">
                  {pendingMine.length + pendingTheirs.length} pending
                </span>
              </div>

              {/* Two-Column Layout — collapses to one column when the
                  current user has no second-column partner. */}
              <div className={`grid grid-cols-1 ${hasSecondColumn ? 'lg:grid-cols-2' : ''} gap-8`}>

                {/* RBK Column */}
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-base font-bold text-slate-900">{myDisplayName}</h2>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500 text-white">
                      {pendingMine.length}
                    </span>
                  </div>

                  {/* Source-tagged groups: cross-module auto-created tasks (e.g. donor
                      note @RBK mentions). Rendered above Drafts to Approve. The
                      original RBK column derived tasks remain below as "My Tasks". */}
                  {(() => {
                    const devTasks = sourcedTasks.filter(t => t.source === 'development' && t.assigned_to?.toLowerCase() === myAssigneeKeyLower);
                    const devPending = devTasks.filter(t => t.status !== 'done');
                    const devDone = devTasks.filter(t => t.status === 'done');
                    if (devTasks.length === 0) return null;
                    return (
                      <div className="mb-4">
                        <button
                          onClick={() => setFromDevCollapsed(c => !c)}
                          className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 transition-colors mb-2"
                        >
                          <svg className={`w-3.5 h-3.5 transition-transform ${!fromDevCollapsed ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                          From Development
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">{devPending.length}</span>
                        </button>
                        {!fromDevCollapsed && (
                          <div className="space-y-1.5">
                            {devPending.map(t => {
                              const isExpanded = expandedSourcedTaskId === t.id;
                              return (
                              <div
                                key={t.id}
                                onClick={() => setExpandedSourcedTaskId(prev => prev === t.id ? null : t.id)}
                                className={`bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'ring-1 ring-emerald-200' : ''}`}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleSourcedTaskStatus(t); }}
                                    className="mt-0.5 w-4 h-4 rounded border border-slate-300 hover:border-emerald-500 flex items-center justify-center flex-shrink-0"
                                    title="Mark done"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-800 break-words">{t.title}</p>
                                    {t.source_ref && (
                                      <p className="text-[11px] text-slate-500 mt-0.5">{t.source_ref}</p>
                                    )}
                                  </div>
                                  <svg className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                                {isExpanded && (
                                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
                                    {t.description && (
                                      <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{t.description}</p>
                                    )}
                                    <button
                                      onClick={() => toggleSourcedTaskStatus(t)}
                                      className="text-xs font-medium px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                                    >
                                      Mark complete
                                    </button>
                                  </div>
                                )}
                              </div>
                              );
                            })}
                            {devPending.length === 0 && devDone.length > 0 && (
                              <p className="text-xs text-slate-400 italic">All caught up.</p>
                            )}
                            {devDone.length > 0 && (
                              <>
                                <button
                                  onClick={() => setShowCompletedDev(s => !s)}
                                  className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors mt-1"
                                >
                                  {showCompletedDev ? 'Hide' : 'Show'} completed ({devDone.length})
                                </button>
                                {showCompletedDev && devDone.map(t => (
                                  <div key={t.id} className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 flex items-start gap-2 opacity-70">
                                    <button
                                      onClick={() => toggleSourcedTaskStatus(t)}
                                      className="mt-0.5 w-4 h-4 rounded bg-emerald-500 border border-emerald-500 flex items-center justify-center flex-shrink-0 text-white"
                                      title="Reopen"
                                    >
                                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    </button>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-slate-500 line-through break-words">{t.title}</p>
                                      {t.source_ref && (
                                        <p className="text-[11px] text-slate-400 mt-0.5">{t.source_ref}</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* From Admissions — placeholder section (renders only when rows exist) */}
                  {(() => {
                    const admTasks = sourcedTasks.filter(t => t.source === 'admissions' && t.assigned_to?.toLowerCase() === myAssigneeKeyLower);
                    if (admTasks.length === 0) return null;
                    const admPending = admTasks.filter(t => t.status !== 'done');
                    const admDone = admTasks.filter(t => t.status === 'done');
                    return (
                      <div className="mb-4">
                        <button
                          onClick={() => setFromAdmCollapsed(c => !c)}
                          className="flex items-center gap-2 text-sm font-semibold text-amber-700 hover:text-amber-900 transition-colors mb-2"
                        >
                          <svg className={`w-3.5 h-3.5 transition-transform ${!fromAdmCollapsed ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                          From Admissions
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{admPending.length}</span>
                        </button>
                        {!fromAdmCollapsed && (
                          <div className="space-y-1.5">
                            {admPending.map(t => {
                              const isExpanded = expandedSourcedTaskId === t.id;
                              return (
                              <div
                                key={t.id}
                                onClick={() => setExpandedSourcedTaskId(prev => prev === t.id ? null : t.id)}
                                className={`bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'ring-1 ring-amber-200' : ''}`}
                              >
                                <div className="flex items-start gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleSourcedTaskStatus(t); }}
                                    className="mt-0.5 w-4 h-4 rounded border border-slate-300 hover:border-amber-500 flex items-center justify-center flex-shrink-0"
                                    title="Mark done"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-800 break-words">{t.title}</p>
                                    {t.source_ref && <p className="text-[11px] text-slate-500 mt-0.5">{t.source_ref}</p>}
                                  </div>
                                  <svg className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                                {isExpanded && (
                                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-2" onClick={(e) => e.stopPropagation()}>
                                    {t.description && (
                                      <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">{t.description}</p>
                                    )}
                                    <button
                                      onClick={() => toggleSourcedTaskStatus(t)}
                                      className="text-xs font-medium px-2.5 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                                    >
                                      Mark complete
                                    </button>
                                  </div>
                                )}
                              </div>
                              );
                            })}
                            {admDone.length > 0 && (
                              <button
                                onClick={() => setShowCompletedAdmissions(s => !s)}
                                className="text-[11px] text-slate-400 hover:text-slate-600 transition-colors mt-1"
                              >
                                {showCompletedAdmissions ? 'Hide' : 'Show'} completed ({admDone.length})
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Drafts to Approve Section */}
                  {(() => {
                    const draftsToApprove = emails.filter(e => e.draft_status === 'draft_ready' && e.status !== 'done' && e.status !== 'junk' && !isSnoozed(e) && !isOwnerEmail(e));
                    if (draftsToApprove.length === 0) return null;
                    const expandedDraftEmail = expandedDraftApproveId ? draftsToApprove.find(e => e.id === expandedDraftApproveId) || null : null;
                    return (
                      <div className="mb-4">
                        <button
                          onClick={() => {
                            const next = !draftsToApproveCollapsed;
                            setDraftsToApproveCollapsed(next);
                            localStorage.setItem('draftsToApproveCollapsed', JSON.stringify(next));
                            if (next) setExpandedDraftApproveId(null);
                          }}
                          className="flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900 transition-colors mb-2"
                        >
                          <svg className={`w-3.5 h-3.5 transition-transform ${!draftsToApproveCollapsed ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                          Drafts to Approve
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{draftsToApprove.length}</span>
                        </button>
                        {!draftsToApproveCollapsed && (
                          <div className="space-y-2">
                            {draftsToApprove.map((email) => (
                              <div key={email.id}>
                                <div
                                  onClick={() => {
                                    if (expandedDraftApproveId === email.id) {
                                      setExpandedDraftApproveId(null);
                                    } else {
                                      setExpandedDraftApproveId(email.id);
                                      draftTextRef.current = email.edited_draft || email.draft_reply || '';
                                    }
                                  }}
                                  className={`bg-white rounded-2xl border border-slate-100 border-l-4 border-l-blue-400 cursor-pointer transition-all duration-150 ${expandedDraftApproveId === email.id ? 'ring-2 ring-blue-200' : ''}`}
                                  style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                  <div className="p-4">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-slate-500">{email.from_name || email.from_email}</span>
                                      <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}</span>
                                    </div>
                                    <p className="text-sm font-medium text-slate-800 mt-1 line-clamp-1">{email.subject}</p>
                                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{email.summary || (email.draft_reply || '').substring(0, 120)}</p>
                                  </div>
                                </div>
                                {expandedDraftApproveId === email.id && expandedDraftEmail && (
                                  <div className="mt-2 bg-white rounded-2xl border border-blue-100 overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                                    <div className="h-[420px] flex flex-col">
                                      <ExpandedEmailPanel key={expandedDraftEmail.id} email={expandedDraftEmail} />
                                    </div>
                                    <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); sendEmail(expandedDraftEmail.id); }}
                                        disabled={sendingEmail === expandedDraftEmail.id}
                                        className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                                      >
                                        {sendingEmail === expandedDraftEmail.id ? 'Sending...' : 'Send'}
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); discardDraft(expandedDraftEmail.id); }}
                                        className="border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors"
                                      >
                                        Discard
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setRevisionEmailId(expandedDraftEmail.id); }}
                                        className="border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-50 transition-colors"
                                      >
                                        Request Revision
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Inline Add Task Form */}
                  {showAddTask && (
                    <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-3" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
                      <input
                        autoFocus
                        type="text"
                        value={addTaskText}
                        onChange={(e) => setAddTaskText(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && addTaskText.trim()) {
                            try {
                              const res = await fetch('/api/agenda-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: addTaskText.trim(), type: 'action', assignee: addTaskAssignee }) });
                              if (res.ok) { const { note } = await res.json(); setActionNotes(prev => [...prev, note]); }
                            } catch (e) { console.error('Failed to add task:', e); }
                            setAddTaskText(''); setShowAddTask(false);
                          }
                          if (e.key === 'Escape') { setAddTaskText(''); setShowAddTask(false); }
                        }}
                        placeholder="Task name..."
                        className="w-full text-sm border border-slate-200 rounded-lg p-2 mb-3 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5">
                          {ASSIGNEE_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setAddTaskAssignee(opt.value)}
                              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                addTaskAssignee === opt.value
                                  ? 'bg-blue-500 text-white'
                                  : 'text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setAddTaskText(''); setShowAddTask(false); }} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                          <button
                            disabled={!addTaskText.trim()}
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/agenda-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: addTaskText.trim(), type: 'action', assignee: addTaskAssignee }) });
                                if (res.ok) { const { note } = await res.json(); setActionNotes(prev => [...prev, note]); }
                              } catch (e) { console.error('Failed to add task:', e); }
                              setAddTaskText(''); setShowAddTask(false);
                            }}
                            className="px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
                          >Add</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {pendingMine.length === 0 && !showAddTask ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
                      <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3">
                        <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-sm text-slate-400">No pending tasks</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {pendingMine.map((task, idx) => {
                        const tid = getTaskId(task);
                        const dueDate = taskDueDates[tid];
                        const isOverdue = dueDate?.date ? dueDate.date < new Date().toISOString().split('T')[0] : false;
                        const isUrgent = taskUrgent[tid] || task.priority === 'owner_action' || isOverdue;
                        const leftBorder = isUrgent ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-blue-500';
                        const cardBg = isUrgent ? 'bg-rose-50' : 'bg-white';
                        return (
                        <div
                          key={tid || `rbk-${idx}`}
                          draggable
                          onDragStart={() => setDraggingTaskId(tid)}
                          onDragOver={(e) => { e.preventDefault(); setDragOverTaskId(tid); }}
                          onDragLeave={() => setDragOverTaskId(null)}
                          onDrop={(e) => { e.preventDefault(); if (draggingTaskId && draggingTaskId !== tid && myAssigneeKeyLower) handleTaskDrop(myAssigneeKeyLower, draggingTaskId, tid); setDraggingTaskId(null); setDragOverTaskId(null); }}
                          onDragEnd={() => { setDraggingTaskId(null); setDragOverTaskId(null); }}
                          onClick={() => { setTaskPanelMode('edit'); setTaskPanelId(task.emailId ? { type: 'email', id: task.emailId } : task.noteId ? { type: 'note', id: task.noteId } : null); }}
                          className={`group ${cardBg} rounded-2xl border border-slate-100 ${leftBorder} cursor-pointer transition-all duration-150 ${dragOverTaskId === tid && draggingTaskId !== tid ? 'ring-2 ring-blue-200' : ''} ${draggingTaskId === tid ? 'opacity-50' : ''}`}
                          style={draggingTaskId === tid ? { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' } : { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                        >
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); task.emailId ? toggleTaskComplete(task.emailId) : task.noteId ? toggleNoteTaskComplete(task.noteId) : undefined; }}
                                  className="w-5 h-5 rounded-full border-2 border-slate-200 hover:border-green-400 hover:bg-green-50 flex-shrink-0 flex items-center justify-center transition-colors mt-0.5"
                                  aria-label="Mark complete"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {editingTaskNoteId === tid && task.noteId ? (
                                      <input
                                        autoFocus
                                        className="text-sm font-medium text-slate-800 leading-snug w-full bg-transparent border-b border-slate-300 outline-none"
                                        value={editingTaskNoteText}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => setEditingTaskNoteText(e.target.value)}
                                        onBlur={() => { if (editingTaskNoteText.trim() && task.noteId) saveNoteText(task.noteId, editingTaskNoteText.trim()); setEditingTaskNoteId(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') setEditingTaskNoteId(null); }}
                                      />
                                    ) : (
                                      <span
                                        className="text-sm font-medium text-slate-800 leading-snug"
                                        onDoubleClick={(e) => { if (task.noteId) { e.stopPropagation(); setEditingTaskNoteId(tid); setEditingTaskNoteText(task.task); } }}
                                      >
                                        {task.task}
                                      </span>
                                    )}
                                    {isUrgent && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-100 text-red-700 flex-shrink-0">Urgent</span>}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); toggleTaskUrgent(tid); }}
                                      className={`p-0.5 rounded transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100 ${isUrgent ? 'text-red-500 opacity-100' : 'text-slate-300 hover:text-red-400'}`}
                                      title={isUrgent ? 'Remove urgent' : 'Mark urgent'}
                                    >
                                      <svg className="w-3.5 h-3.5" fill={isUrgent ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const notes = taskNotes[tid] ? `\n${taskNotes[tid]}` : '';
                                        setSlackSendContext(`Task: ${task.task}${notes}`);
                                      }}
                                      className="p-0.5 rounded text-slate-300 hover:text-blue-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                                      title="Send via Slack"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                    </button>
                                  </div>
                                </div>
                              </div>
                              {taskNotes[tid] && <p className="text-xs text-slate-400 italic whitespace-pre-wrap line-clamp-3 mt-1 pl-8">{taskNotes[tid]}</p>}
                              <div className="flex items-center justify-between mt-3 pl-8">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {task.source === 'email' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">From email</span>
                                  )}
                                  {task.source === 'agenda' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-600">From agenda</span>
                                  )}
                                  {task.source === 'manual' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">Manual</span>
                                  )}
                                  {task.date && (
                                    <span className="text-[10px] text-slate-400">{format(parseISO(task.date), 'MMM d')}</span>
                                  )}
                                  {dueDate?.date && (() => {
                                    const today = new Date().toISOString().split('T')[0];
                                    const isOverdue = dueDate.date < today;
                                    const isToday = dueDate.date === today;
                                    return (
                                      <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : isToday ? 'text-amber-500 font-medium' : 'text-slate-500'}`}>
                                        {isOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                                        Due {format(parseISO(dueDate.date), 'MMM d')}
                                        {dueDate.time && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                                  RBK
                                </div>
                              </div>
                            </div>
                        </div>
                        );
                      })}
                    </div>
                  )}

                  {completedMine.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setShowCompletedRbk(!showCompletedRbk)}
                        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <svg className={`w-3 h-3 transition-transform ${showCompletedRbk ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        {completedMine.length} completed
                      </button>
                      {showCompletedRbk && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
                          {completedMine.map((task, idx) => (
                            <div key={getTaskId(task) || `rbk-done-${idx}`} className="bg-white rounded-2xl border border-slate-50 border-l-4 border-l-green-400 p-4 opacity-50">
                              <div className="flex items-start gap-3">
                                <button
                                  onClick={() => { task.emailId ? toggleTaskComplete(task.emailId) : task.noteId ? toggleNoteTaskComplete(task.noteId) : undefined; }}
                                  className="w-5 h-5 rounded-full bg-green-500 border-2 border-green-500 flex-shrink-0 flex items-center justify-center mt-0.5"
                                  aria-label="Mark incomplete"
                                >
                                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <span className="text-sm font-medium text-slate-400 line-through leading-snug">{task.task}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Assistant Column — only rendered when the current user
                    has an assistant configured (via workspace_members.assistant_to
                    on the assistant's row pointing back to the current user). */}
                {hasAssistant && (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-base font-bold text-slate-900">{theirDisplayName ?? 'Assistant'}</h2>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-500 text-white">
                      {pendingTheirs.length}
                    </span>
                  </div>

                  {pendingTheirs.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}>
                      <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3">
                        <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-sm text-slate-400">No pending tasks</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {pendingTheirs.map((task, idx) => {
                        const tid = getTaskId(task);
                        const dueDate = taskDueDates[tid];
                        const isOverdue = dueDate?.date ? dueDate.date < new Date().toISOString().split('T')[0] : false;
                        const isUrgent = taskUrgent[tid] || task.priority === 'owner_action' || isOverdue;
                        const cardBg = isUrgent ? 'bg-rose-50' : 'bg-white';
                        const leftBorder = isUrgent ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-teal-500';
                        return (
                        <div
                          key={tid || `emily-${idx}`}
                          draggable
                          onDragStart={() => setDraggingTaskId(tid)}
                          onDragOver={(e) => { e.preventDefault(); setDragOverTaskId(tid); }}
                          onDragLeave={() => setDragOverTaskId(null)}
                          onDrop={(e) => { e.preventDefault(); if (draggingTaskId && draggingTaskId !== tid && theirAssigneeKeyLower) handleTaskDrop(theirAssigneeKeyLower, draggingTaskId, tid); setDraggingTaskId(null); setDragOverTaskId(null); }}
                          onDragEnd={() => { setDraggingTaskId(null); setDragOverTaskId(null); }}
                          onClick={() => { setTaskPanelMode('edit'); setTaskPanelId(task.emailId ? { type: 'email', id: task.emailId } : task.noteId ? { type: 'note', id: task.noteId } : null); }}
                          className={`group ${cardBg} rounded-2xl border border-slate-100 ${leftBorder} cursor-pointer transition-all duration-150 ${dragOverTaskId === tid && draggingTaskId !== tid ? 'ring-2 ring-teal-200' : ''} ${draggingTaskId === tid ? 'opacity-50' : ''}`}
                          style={draggingTaskId === tid ? { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' } : { boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                        >
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); task.emailId ? toggleTaskComplete(task.emailId) : task.noteId ? toggleNoteTaskComplete(task.noteId) : undefined; }}
                                  className="w-5 h-5 rounded-full border-2 border-slate-200 hover:border-green-400 hover:bg-green-50 flex-shrink-0 flex items-center justify-center transition-colors mt-0.5"
                                  aria-label="Mark complete"
                                />
                                <div className="flex-1 min-w-0">
                                  {editingTaskNoteId === tid && task.noteId ? (
                                    <input
                                      autoFocus
                                      className="text-sm font-medium text-slate-800 leading-snug w-full bg-transparent border-b border-slate-300 outline-none"
                                      value={editingTaskNoteText}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditingTaskNoteText(e.target.value)}
                                      onBlur={() => { if (editingTaskNoteText.trim() && task.noteId) saveNoteText(task.noteId, editingTaskNoteText.trim()); setEditingTaskNoteId(null); }}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') setEditingTaskNoteId(null); }}
                                    />
                                  ) : (
                                    <span
                                      className="text-sm font-medium text-slate-800 leading-snug"
                                      onDoubleClick={(e) => { if (task.noteId) { e.stopPropagation(); setEditingTaskNoteId(tid); setEditingTaskNoteText(task.task); } }}
                                    >
                                      {task.task}
                                    </span>
                                  )}
                                  {isUrgent && <span className="inline-flex items-center ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-700 uppercase">Urgent</span>}
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleTaskUrgent(tid); }}
                                  className={`flex-shrink-0 p-1 rounded-lg transition-colors ${isUrgent ? 'text-red-500 hover:bg-red-50' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-500 hover:bg-amber-50'}`}
                                  aria-label="Toggle urgent"
                                  title={isUrgent ? 'Remove urgent' : 'Mark urgent'}
                                >
                                  <svg className="w-4 h-4" fill={isUrgent ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const notes = taskNotes[tid] ? `\n${taskNotes[tid]}` : '';
                                    setSlackSendContext(`Task: ${task.task}${notes}`);
                                  }}
                                  className="flex-shrink-0 p-1 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                                  title="Send via Slack"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                              </div>
                              {taskNotes[tid] && <p className="text-xs text-slate-400 italic whitespace-pre-wrap line-clamp-3 mt-1 pl-8">{taskNotes[tid]}</p>}
                              <div className="flex items-center justify-between mt-3 pl-8">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {task.source === 'email' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">From email</span>}
                                  {task.source === 'agenda' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-600">From agenda</span>}
                                  {task.source === 'manual' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">Manual</span>}
                                  {task.date && (
                                    <span className="text-[10px] text-slate-400">{format(parseISO(task.date), 'MMM d')}</span>
                                  )}
                                  {dueDate?.date && (() => {
                                    const today = new Date().toISOString().split('T')[0];
                                    const isOverdue = dueDate.date < today;
                                    const isDueToday = dueDate.date === today;
                                    return (
                                      <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : isDueToday ? 'text-amber-500 font-medium' : 'text-slate-500'}`}>
                                        {isOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                                        Due {format(parseISO(dueDate.date), 'MMM d')}
                                        {dueDate.time && <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                                  {(theirAssigneeKey || '?').slice(0, 3).toUpperCase()}
                                </div>
                              </div>
                            </div>
                        </div>
                        );
                      })}
                    </div>
                  )}

                  {completedTheirs.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setShowCompletedTheirs(!showCompletedTheirs)}
                        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <svg className={`w-3 h-3 transition-transform ${showCompletedTheirs ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        {completedTheirs.length} completed
                      </button>
                      {showCompletedTheirs && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
                          {completedTheirs.map((task, idx) => (
                            <div key={getTaskId(task) || `emily-done-${idx}`} className="bg-white rounded-2xl border border-slate-50 border-l-4 border-l-green-400 p-4 opacity-50">
                              <div className="flex items-start gap-3">
                                <button
                                  onClick={() => { task.emailId ? toggleTaskComplete(task.emailId) : task.noteId ? toggleNoteTaskComplete(task.noteId) : undefined; }}
                                  className="w-5 h-5 rounded-full bg-green-500 border-2 border-green-500 flex-shrink-0 flex items-center justify-center mt-0.5"
                                  aria-label="Mark incomplete"
                                >
                                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                </button>
                                <span className="text-sm font-medium text-slate-400 line-through leading-snug">{task.task}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

              </div>

            </div>
          )}

          {/* Projects View */}
          {activeNav === 'projects' && (
            <div className="relative">
              {/* Page Header */}
              <div className="flex items-center gap-3 mb-5">
                <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
                <span className="inline-flex items-center px-3 py-0.5 rounded-full text-sm bg-slate-100 text-slate-600">
                  {projects.filter(p => p.status === 'active').length} active
                </span>
              </div>

              {/* Kanban Board */}
              {loadingProjects ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto pb-4 -mx-8 px-8">
                  <div className="flex gap-4" style={{ minWidth: 'max-content' }}>
                    {columnOrder.map((dept, colIdx) => {
                      const deptProjects = projects.filter(p => p.department === dept && p.status !== 'archived');
                      const colors = departmentColors[dept] || { border: 'border-l-slate-400', bg: 'bg-slate-50', text: 'text-slate-700', fill: 'bg-slate-400' };
                      const borderTopColor = colors.border.replace('border-l-', 'border-t-');

                      return (
                        <div
                          key={dept}
                          className={`min-w-[280px] max-w-[280px] flex flex-col relative ${draggingColumn === dept ? 'opacity-50' : ''}`}
                          onDragOver={(e) => {
                            if (draggingColumn && draggingColumn !== dept) {
                              e.preventDefault();
                              setDragOverColumn(dept);
                            } else if (draggingProjectId) {
                              e.preventDefault();
                              setDragOverDept(dept);
                              // Clear card-level indicator when over empty space
                              const target = e.target as HTMLElement;
                              if (!target.closest('[data-project-card]')) {
                                setDragOverProjectId(null);
                              }
                            }
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              if (draggingColumn) setDragOverColumn(null);
                              if (draggingProjectId) { setDragOverDept(null); setDragOverProjectId(null); }
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggingColumn && draggingColumn !== dept) {
                              const newOrder = [...columnOrder];
                              const fromIdx = newOrder.indexOf(draggingColumn);
                              newOrder.splice(fromIdx, 1);
                              const toIdx = newOrder.indexOf(dept);
                              newOrder.splice(toIdx, 0, draggingColumn);
                              setColumnOrder(newOrder);
                              localStorage.setItem('projectColumnOrder', JSON.stringify(newOrder));
                              setDraggingColumn(null);
                              setDragOverColumn(null);
                            } else if (draggingProjectId && !e.defaultPrevented) {
                              const draggedProject = projects.find(p => p.id === draggingProjectId);
                              if (draggedProject && draggedProject.department !== dept) {
                                updateProject(draggingProjectId, { department: dept } as Partial<Project>);
                              }
                              setDraggingProjectId(null);
                              setDragOverDept(null);
                              setDragOverProjectId(null);
                            }
                          }}
                        >
                          {/* Column drag insertion line (left side) */}
                          {dragOverColumn === dept && draggingColumn && colIdx === 0 && (
                            <div className="absolute -left-2 top-0 bottom-0 w-1 bg-blue-400 rounded-full z-10" />
                          )}
                          {/* Column drag insertion line (right side) */}
                          {dragOverColumn === dept && draggingColumn && (
                            <div className="absolute -right-2 top-0 bottom-0 w-1 bg-blue-400 rounded-full z-10" />
                          )}

                          {/* Column Header */}
                          <div className={`border-t-4 ${borderTopColor} bg-white rounded-t-xl px-4 py-3 flex items-center justify-between group/col`}>
                            <div className="flex items-center gap-2">
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDraggingColumn(dept);
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', dept);
                                }}
                                onDragEnd={() => { setDraggingColumn(null); setDragOverColumn(null); }}
                                className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 transition-colors select-none"
                                title="Drag to reorder column"
                              >⠿</span>
                              <span className="text-sm font-semibold text-slate-800">{dept}</span>
                              {deptProjects.length > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                                  {deptProjects.length}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => { setNewProjectDepartment(dept); setShowAddProjectModal(true); }}
                              className="w-6 h-6 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                            </button>
                          </div>

                          {/* Column Body */}
                          <div className={`rounded-b-xl p-2 flex-1 space-y-2 min-h-[120px] transition-colors ${
                            dragOverDept === dept && draggingProjectId ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50/50'
                          }`}>
                            {deptProjects.length === 0 ? (
                              <div className="flex items-center justify-center h-full min-h-[100px]">
                                <p className="text-xs text-slate-300">{dragOverDept === dept && draggingProjectId ? 'Drop here' : 'No projects'}</p>
                              </div>
                            ) : (
                              deptProjects.map((project, cardIdx) => {
                                const prioConfig = projectPriorityConfig[project.priority] || projectPriorityConfig.medium;
                                const cardColors = departmentColors[project.department] || { border: 'border-l-slate-400', bg: 'bg-slate-50', text: 'text-slate-700', fill: 'bg-slate-400' };
                                return (
                                  <div key={project.id}>
                                    {/* Insertion line above card */}
                                    {dragOverProjectId === project.id && draggingProjectId && draggingProjectId !== project.id && (
                                      <div className="h-0.5 bg-blue-400 rounded-full mx-1 mb-1" />
                                    )}
                                    <div
                                      data-project-card
                                      draggable
                                      onDragStart={(e) => {
                                        projectDragRef.current = true;
                                        setDraggingProjectId(project.id);
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData('text/plain', project.id);
                                        e.stopPropagation();
                                      }}
                                      onDragEnd={() => {
                                        setTimeout(() => { projectDragRef.current = false; }, 0);
                                        setDraggingProjectId(null);
                                        setDragOverDept(null);
                                        setDragOverProjectId(null);
                                      }}
                                      onDragOver={(e) => {
                                        if (draggingProjectId && draggingProjectId !== project.id) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setDragOverProjectId(project.id);
                                        }
                                      }}
                                      onDrop={(e) => {
                                        // Only handle card drops, let column drops bubble to the column div
                                        if (!draggingProjectId) return;
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (draggingProjectId !== project.id) {
                                          const draggedProject = projects.find(p => p.id === draggingProjectId);
                                          if (draggedProject && draggedProject.department !== dept) {
                                            updateProject(draggingProjectId, { department: dept } as Partial<Project>);
                                          }
                                        }
                                        setDraggingProjectId(null);
                                        setDragOverDept(null);
                                        setDragOverProjectId(null);
                                      }}
                                      onClick={() => { if (!projectDragRef.current) setSelectedProject(project); }}
                                      className={`bg-white rounded-xl border border-slate-100 border-l-4 ${cardColors.border} cursor-pointer transition-all duration-150 ${
                                        draggingProjectId === project.id ? 'opacity-50 cursor-grabbing' : ''
                                      }`}
                                      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' }}
                                      onMouseEnter={(e) => { if (!draggingProjectId) { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
                                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                    >
                                      <div className="p-3">
                                        {/* Priority badge + inline toggle on hover */}
                                        <div className="flex items-center gap-2 mb-2">
                                          <span className={`group-hover:hidden inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${prioConfig.bg} ${prioConfig.text}`}>
                                            {project.priority}
                                          </span>
                                          <div className="hidden group-hover:flex items-center gap-0.5 bg-slate-100 rounded-full p-0.5">
                                            {(['high', 'medium', 'low'] as const).map(p => (
                                              <button
                                                key={p}
                                                onClick={(e) => { e.stopPropagation(); updateProject(project.id, { priority: p }); }}
                                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                                                  project.priority === p
                                                    ? p === 'high' ? 'bg-rose-500 text-white' : p === 'medium' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white'
                                                    : 'text-slate-400 hover:text-slate-600'
                                                }`}
                                              >
                                                {p.charAt(0).toUpperCase() + p.slice(1)}
                                              </button>
                                            ))}
                                          </div>
                                          {project.status === 'on_hold' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">on hold</span>
                                          )}
                                          {project.status === 'complete' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">complete</span>
                                          )}
                                        </div>

                                        {/* Title */}
                                        <h3 className="text-sm font-semibold text-slate-800 mb-1">{project.title}</h3>

                                        {/* Updates indicator — small unread-style row. Updates live in
                                            the projectUpdates state map (per project, persisted in
                                            localStorage), not as a field on the project object. */}
                                        {(() => {
                                          const cardUpdates = projectUpdates[project.id] || [];
                                          if (cardUpdates.length === 0) return null;
                                          const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
                                          const cutoff = Date.now() - SEVEN_DAYS_MS;
                                          const hasRecent = cardUpdates.some(u => {
                                            const t = new Date(u.timestamp).getTime();
                                            return Number.isFinite(t) && t >= cutoff;
                                          });
                                          return (
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                              {hasRecent && (
                                                <span
                                                  className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500"
                                                  title="New update in the last 7 days"
                                                  aria-label="New update"
                                                />
                                              )}
                                              <span className="text-[10px] text-slate-400 font-medium">
                                                {cardUpdates.length} update{cardUpdates.length === 1 ? '' : 's'}
                                              </span>
                                            </div>
                                          );
                                        })()}

                                        {/* Description */}
                                        {project.description && (
                                          <p className="text-xs text-slate-500 mb-2 line-clamp-2">{stripHtml(project.description)}</p>
                                        )}

                                        {/* Tags (secondary departments) */}
                                        {project.tags && project.tags.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mb-2">
                                            {project.tags.slice(0, 2).map(tag => {
                                              const tagColors = departmentColors[tag] || { bg: 'bg-slate-50', text: 'text-slate-600' };
                                              return (
                                                <span key={tag} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${tagColors.bg} ${tagColors.text}`}>
                                                  {tag}
                                                </span>
                                              );
                                            })}
                                            {project.tags.length > 2 && (
                                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">
                                                +{project.tags.length - 2}
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Links */}
                                        {project.links?.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mb-3">
                                            {project.links.slice(0, 3).map((link, i) => (
                                              <a
                                                key={i}
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50 rounded px-1.5 py-0.5"
                                              >
                                                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /><path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                                {link.title}
                                              </a>
                                            ))}
                                            {project.links.length > 3 && (
                                              <span className="inline-flex items-center text-[11px] text-blue-500 bg-blue-50 rounded px-1.5 py-0.5">
                                                +{project.links.length - 3}
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Progress bar */}
                                        <div className="mb-3">
                                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                              className={`h-full rounded-full transition-all ${cardColors.fill}`}
                                              style={{ width: `${project.progress}%` }}
                                            />
                                          </div>
                                        </div>

                                        {/* Footer: assignee + due date */}
                                        <div className="flex items-center justify-between">
                                          <div className={`w-6 h-6 rounded-full ${project.assignee?.toLowerCase() === myAssigneeKeyLower ? 'bg-blue-500' : project.assignee?.toLowerCase() === theirAssigneeKeyLower ? 'bg-teal-500' : 'bg-slate-500'} text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>
                                            {(project.assignee || '?').slice(0, 3).toUpperCase()}
                                          </div>
                                          {project.due_date && (() => {
                                            const isOverdue = new Date(project.due_date) < new Date(new Date().toISOString().split('T')[0]);
                                            return (
                                              <span className={`text-[10px] flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                                                {isOverdue && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                                                {format(parseISO(project.due_date), 'MMM d')}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Floating Add Project Button */}
              <button
                onClick={() => setShowAddProjectModal(true)}
                className="fixed bottom-8 right-8 bg-slate-900 text-white rounded-full w-14 h-14 text-2xl flex items-center justify-center hover:bg-slate-700 hover:scale-105 transition-all duration-150 z-30"
                style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
              >
                +
              </button>

              {/* Project Side Panel */}
              {selectedProject && (() => {
                const project = selectedProject;
                const colors = departmentColors[project.department] || { border: 'border-l-slate-400', bg: 'bg-slate-50', text: 'text-slate-700', fill: 'bg-slate-400' };
                const updates = projectUpdates[project.id] || [];

                return (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => { setSelectedProject(null); setEditingProjectTitle(false); }} />

                    {/* Panel */}
                    <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                      {/* Header */}
                      <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center justify-between mb-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                            {project.department}
                          </span>
                          <button onClick={() => { setSelectedProject(null); setEditingProjectTitle(false); }} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        {editingProjectTitle ? (
                          <textarea
                            autoFocus
                            value={project.title}
                            onChange={(e) => {
                              setSelectedProject({ ...project, title: e.target.value });
                              setProjects(prev => prev.map(p => p.id === project.id ? { ...p, title: e.target.value } : p));
                            }}
                            onBlur={() => { updateProject(project.id, { title: project.title }); setEditingProjectTitle(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setEditingProjectTitle(false); }}
                            className="text-xl font-bold text-slate-900 w-full bg-transparent border-none outline-none resize-none"
                            rows={1}
                            style={{ height: 'auto', minHeight: '32px' }}
                            ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                          />
                        ) : (
                          <h2 className="text-xl font-bold text-slate-900 cursor-pointer" onClick={() => setEditingProjectTitle(true)}>
                            {project.title}
                          </h2>
                        )}
                      </div>

                      {/* Body */}
                      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
                        {/* STATUS */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Status</label>
                          <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5">
                            {(['active', 'on_hold', 'complete'] as const).map(s => (
                              <button
                                key={s}
                                onClick={() => updateProject(project.id, { status: s })}
                                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                  project.status === s
                                    ? s === 'active' ? 'bg-blue-500 text-white' : s === 'on_hold' ? 'bg-amber-500 text-white' : 'bg-green-500 text-white'
                                    : 'text-slate-500 hover:text-slate-700'
                                }`}
                              >
                                {s === 'active' ? 'Active' : s === 'on_hold' ? 'On Hold' : 'Complete'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* PRIORITY */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Priority</label>
                          <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5">
                            {(['high', 'medium', 'low'] as const).map(p => (
                              <button
                                key={p}
                                onClick={() => updateProject(project.id, { priority: p })}
                                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                  project.priority === p
                                    ? p === 'high' ? 'bg-rose-500 text-white' : p === 'medium' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white'
                                    : 'text-slate-500 hover:text-slate-700'
                                }`}
                              >
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* PROGRESS */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                            Progress — {project.progress}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={project.progress}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setSelectedProject({ ...project, progress: val });
                              setProjects(prev => prev.map(p => p.id === project.id ? { ...p, progress: val } : p));
                            }}
                            onMouseUp={(e) => updateProject(project.id, { progress: parseInt((e.target as HTMLInputElement).value) })}
                            onTouchEnd={(e) => updateProject(project.id, { progress: parseInt((e.target as HTMLInputElement).value) })}
                            className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-500"
                          />
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                            <div className={`h-full rounded-full transition-all ${colors.fill}`} style={{ width: `${project.progress}%` }} />
                          </div>
                        </div>

                        {/* DESCRIPTION */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Description</label>
                          <TiptapEditor
                            key={`desc-${project.id}`}
                            content={project.description || ''}
                            placeholder="Add a description..."
                            onUpdate={(html) => {
                              setSelectedProject(prev => prev ? { ...prev, description: html } : prev);
                              setProjects(prev => prev.map(p => p.id === project.id ? { ...p, description: html } : p));
                            }}
                            onBlur={() => updateProject(project.id, { description: project.description })}
                          />
                        </div>

                        {/* DEPARTMENTS (tags) */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Also involves</label>
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {(project.tags || []).map(tag => {
                              const tagColors = departmentColors[tag] || { bg: 'bg-slate-100', text: 'text-slate-600' };
                              return (
                                <span key={tag} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${tagColors.bg} ${tagColors.text}`}>
                                  {tag}
                                  <button
                                    onClick={() => {
                                      const filtered = (project.tags || []).filter(t => t !== tag);
                                      updateProject(project.id, { tags: filtered } as Partial<Project>);
                                    }}
                                    className="ml-0.5 hover:text-red-500 transition-colors"
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </span>
                              );
                            })}
                            <div className="relative">
                              <button
                                onClick={() => setShowTagDropdown(!showTagDropdown)}
                                className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors text-sm"
                              >+</button>
                              {showTagDropdown && (
                                <div className="absolute top-8 left-0 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-10 w-48 max-h-48 overflow-auto">
                                  {DEPARTMENTS.filter(d => d !== project.department && !(project.tags || []).includes(d)).map(d => {
                                    const dColors = departmentColors[d] || { bg: 'bg-slate-50', text: 'text-slate-600' };
                                    return (
                                      <button
                                        key={d}
                                        onClick={() => {
                                          const newTags = [...(project.tags || []), d];
                                          updateProject(project.id, { tags: newTags } as Partial<Project>);
                                          setShowTagDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors flex items-center gap-2"
                                      >
                                        <span className={`w-2 h-2 rounded-full ${dColors.bg.replace('bg-', 'bg-')}`} />
                                        {d}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* ASSIGNEE + DUE DATE */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Assignee</label>
                            <button
                              onClick={() => {
                                // Toggle assignee between current member and assistant.
                                // No-op when the workspace has no assistant configured.
                                if (!hasAssistant || !myAssigneeKey || !theirAssigneeKey) return;
                                const curLower = project.assignee?.toLowerCase() ?? null;
                                const next = curLower === myAssigneeKeyLower ? theirAssigneeKey : myAssigneeKey;
                                updateProject(project.id, { assignee: next } as Partial<Project>);
                              }}
                              disabled={!hasAssistant}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 ${hasAssistant ? 'hover:border-slate-300' : 'cursor-default'} transition-colors`}
                            >
                              {(() => {
                                const lower = project.assignee?.toLowerCase() ?? null;
                                const isMine = lower === myAssigneeKeyLower;
                                const isTheirs = lower === theirAssigneeKeyLower;
                                const color = isMine ? 'bg-blue-500' : isTheirs ? 'bg-teal-500' : 'bg-slate-500';
                                const label = isMine ? myDisplayName : isTheirs ? (theirDisplayName ?? 'Assistant') : (project.assignee || 'Unassigned');
                                return (
                                  <>
                                    <div className={`w-6 h-6 rounded-full ${color} text-white flex items-center justify-center text-[9px] font-bold`}>
                                      {(project.assignee || '?').slice(0, 3).toUpperCase()}
                                    </div>
                                    <span className="text-sm text-slate-700">{label}</span>
                                  </>
                                );
                              })()}
                            </button>
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Due Date</label>
                            <input
                              type="date"
                              value={project.due_date || ''}
                              onChange={(e) => updateProject(project.id, { due_date: e.target.value || null } as Partial<Project>)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                            />
                          </div>
                        </div>

                        {/* UPDATES */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Updates</label>
                          <div className="mb-3 flex gap-2 items-end">
                            <div className="flex-1">
                              <TiptapEditor
                                key={`update-${project.id}-${updateEditorKey}`}
                                content=""
                                placeholder="Add an update... (Ctrl+Enter to post)"
                                minHeight="60px"
                                onUpdate={(html) => setNewUpdateText(html)}
                                onCtrlEnter={() => {
                                  const html = newUpdateText.trim();
                                  if (html && html !== '<p></p>') addProjectUpdate(project.id, html);
                                }}
                              />
                            </div>
                            <button
                              onClick={() => {
                                const html = newUpdateText.trim();
                                if (html && html !== '<p></p>') addProjectUpdate(project.id, html);
                              }}
                              disabled={!newUpdateText.trim() || newUpdateText.trim() === '<p></p>'}
                              className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
                            >
                              Post
                            </button>
                          </div>
                          {updates.length > 0 && (
                            <div className="space-y-2">
                              {updates.map((u, i) => (
                                <div key={i} className="bg-slate-50 rounded-lg p-3">
                                  <div className="text-sm text-slate-700 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: u.text }} />
                                  <p className="text-[10px] text-slate-400 mt-1">{formatDistanceToNow(parseISO(u.timestamp), { addSuffix: true })}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* TASKS — rows in the `tasks` Supabase table with
                            project_id = this project. Inline add form below
                            with assignee dropdown. Click the circle to toggle
                            done; status flips via PATCH /api/tasks. */}
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Tasks</label>
                          {(() => {
                            const tasksForProject = projectTasksMap[project.id] || [];
                            return (
                              <>
                                {tasksForProject.length > 0 && (
                                  <div className="space-y-1.5 mb-3">
                                    {tasksForProject.map(t => (
                                      <div key={t.id} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2">
                                        <button
                                          onClick={() => toggleProjectTaskDone(project.id, t)}
                                          className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                                            t.status === 'done'
                                              ? 'bg-emerald-500 border-emerald-500 text-white'
                                              : 'border-slate-300 hover:border-emerald-500'
                                          }`}
                                          title={t.status === 'done' ? 'Reopen' : 'Mark done'}
                                        >
                                          {t.status === 'done' && (
                                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                          )}
                                        </button>
                                        <p className={`flex-1 text-sm break-words ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                                          {t.title}
                                        </p>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-600 flex-shrink-0">
                                          {t.assigned_to}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {/* Add task form */}
                                <div className="flex flex-col gap-2">
                                  <input
                                    type="text"
                                    value={newProjectTaskTitle}
                                    onChange={(e) => setNewProjectTaskTitle(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProjectTask(project.id); } }}
                                    placeholder="Add a task..."
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                  />
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {ASSIGNEE_OPTIONS.map(opt => (
                                      <button
                                        key={opt.value}
                                        onClick={() => setNewProjectTaskAssignee(opt.value)}
                                        className={`px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${
                                          newProjectTaskAssignee === opt.value
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                    <button
                                      onClick={() => addProjectTask(project.id)}
                                      disabled={!newProjectTaskTitle.trim() || savingProjectTask}
                                      className="ml-auto bg-slate-900 text-white text-xs font-medium px-3 py-1 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors"
                                    >
                                      {savingProjectTask ? '…' : '+ Add Task'}
                                    </button>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-3">
                        {project.status !== 'complete' ? (
                          <button
                            onClick={() => updateProject(project.id, { status: 'complete', progress: 100 })}
                            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
                          >
                            Mark Complete
                          </button>
                        ) : (
                          <button
                            onClick={() => updateProject(project.id, { status: 'active' })}
                            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm('Archive this project?')) archiveProject(project.id); }}
                          className="px-4 py-2 text-red-500 hover:text-red-700 text-sm font-medium transition-colors"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Add Project Modal */}
              {showAddProjectModal && (
                <>
                  <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={() => setShowAddProjectModal(false)} />
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6" style={{ boxShadow: '0 24px 48px rgba(0,0,0,0.2)' }}>
                      <h3 className="text-lg font-bold text-slate-900 mb-4">New Project</h3>

                      {/* Title */}
                      <input
                        autoFocus
                        type="text"
                        value={newProjectTitle}
                        onChange={(e) => setNewProjectTitle(e.target.value)}
                        placeholder="Project title"
                        className="w-full text-sm border border-slate-200 rounded-lg p-3 mb-3 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      />

                      {/* Department */}
                      <select
                        value={newProjectDepartment}
                        onChange={(e) => setNewProjectDepartment(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-lg p-3 mb-3 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      >
                        <option value="">Select department...</option>
                        {DEPARTMENTS.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>

                      {/* Priority */}
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Priority</label>
                      <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 mb-3">
                        {(['high', 'medium', 'low'] as const).map(p => (
                          <button
                            key={p}
                            onClick={() => setNewProjectPriority(p)}
                            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              newProjectPriority === p
                                ? p === 'high' ? 'bg-rose-500 text-white' : p === 'medium' ? 'bg-amber-500 text-white' : 'bg-slate-500 text-white'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>

                      {/* Assignee — current user + their assistant if configured */}
                      <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 block">Assignee</label>
                      <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 mb-4">
                        {myAssigneeKey && (
                          <button
                            onClick={() => setNewProjectAssignee(myAssigneeKey)}
                            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${(newProjectAssignee || myAssigneeKey)?.toLowerCase() === myAssigneeKeyLower ? 'bg-blue-500 text-white' : 'text-slate-500'}`}
                          >
                            {myDisplayName}
                          </button>
                        )}
                        {hasAssistant && theirAssigneeKey && (
                          <button
                            onClick={() => setNewProjectAssignee(theirAssigneeKey)}
                            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${newProjectAssignee?.toLowerCase() === theirAssigneeKeyLower ? 'bg-teal-500 text-white' : 'text-slate-500'}`}
                          >
                            {theirDisplayName}
                          </button>
                        )}
                      </div>

                      {/* Buttons */}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => { setShowAddProjectModal(false); setNewProjectTitle(''); setNewProjectDepartment(''); setNewProjectDescription(''); setNewProjectDueDate(''); }}
                          className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={addProject}
                          disabled={!newProjectTitle.trim() || !newProjectDepartment}
                          className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
                        >
                          Create Project
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Simchas & Shivas View */}
          {activeNav === 'simchas' && effectiveModules?.simchas === false && (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400 text-sm">This module is not enabled for your workspace.</p>
            </div>
          )}
          {activeNav === 'simchas' && effectiveModules?.simchas !== false && (() => {
            // Current week: Monday through Sunday
            const now = new Date();
            const dayOfWeek = now.getDay();
            const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            sunday.setHours(23, 59, 59, 999);

            const weekDays = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(monday);
              d.setDate(monday.getDate() + i);
              return d;
            });

            const weekLabel = `${format(monday, 'MMMM d')} \u2013 ${format(sunday, monday.getMonth() === sunday.getMonth() ? 'd, yyyy' : 'MMMM d, yyyy')}`;

            // Filter shivas/funerals from week calendar events
            const shivaFuneralEvents = weekCalendarEvents.filter((ev) => {
              const title = ev.title.toLowerCase();
              return title.includes('shiva') || title.includes('funeral') || title.includes('levaya');
            });

            // Helper: get events for a day
            const eventsForDay = (day: Date) => {
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
              const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
              const bnb = bnbMitzvahs.filter(e => { const d = new Date(e.start); return d >= dayStart && d < dayEnd; });
              const shiva = shivaFuneralEvents.filter(e => { const d = new Date(e.startTime); return d >= dayStart && d < dayEnd; });
              return { bnb, shiva };
            };

            const isToday = (d: Date) => {
              const t = new Date();
              return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
            };

            return (
              <div>
                {/* Page Header */}
                <div className="mb-6">
                  <h1 className="text-2xl font-bold text-slate-900">Simchas & Shivas This Week</h1>
                  <p className="text-sm text-slate-500 mt-1">{weekLabel}</p>
                </div>

                {simchasLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                  </div>
                ) : (
                  <>
                    {/* ═══════ DESIGN A — WEEK GRID VIEW ═══════ */}
                    <div className="mb-10">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Design A — Week View</p>
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="grid grid-cols-7 divide-x divide-slate-100">
                          {weekDays.map((day) => {
                            const today = isToday(day);
                            const { bnb, shiva } = eventsForDay(day);
                            const hasEvents = bnb.length > 0 || shiva.length > 0;
                            return (
                              <div key={day.toISOString()} className={`min-h-[160px] ${today ? 'bg-blue-50/60' : ''}`}>
                                {/* Day header */}
                                <div className={`px-2 py-2 text-center border-b ${today ? 'bg-blue-100/60 border-blue-200' : 'bg-slate-50 border-slate-100'}`}>
                                  <p className={`text-xs font-semibold ${today ? 'text-blue-700' : 'text-slate-500'}`}>
                                    {format(day, 'EEE')}
                                  </p>
                                  <p className={`text-sm font-bold ${today ? 'text-blue-800' : 'text-slate-800'}`}>
                                    {format(day, 'M/d')}
                                  </p>
                                </div>
                                {/* Events */}
                                <div className="p-1.5 space-y-1">
                                  {bnb.map((ev) => (
                                    <div key={ev.uid}>
                                      <button
                                        onClick={() => setExpandedSimcha(expandedSimcha === ev.uid ? null : ev.uid)}
                                        className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${simchasAttending[ev.uid] === 'yes' ? 'bg-green-100 text-green-800 hover:bg-green-200' : simchasAttending[ev.uid] === 'no' ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'}`}
                                      >
                                        <span className="mr-1">&#x2605;</span>
                                        {ev.summary}
                                        {simchasAttending[ev.uid] === 'yes' && <span className="ml-1 text-[9px] font-bold text-green-700">YES</span>}
                                        {simchasAttending[ev.uid] === 'no' && <span className="ml-1 text-[9px] font-bold text-blue-600">NO</span>}
                                        {expandedSimcha === ev.uid && (
                                          <div className="mt-1 text-[10px] font-normal text-blue-600 space-y-0.5">
                                            {ev.description && <p>{ev.description}</p>}
                                            {ev.location && <p>{ev.location}</p>}
                                            {!ev.isAllDay && <p>{format(parseISO(ev.start), 'h:mm a')}</p>}
                                          </div>
                                        )}
                                      </button>
                                      {expandedSimcha === ev.uid && (
                                        <div className="mt-0.5 flex gap-1">
                                          {(['yes', 'no'] as const).map(val => {
                                            const active = simchasAttending[ev.uid] === val;
                                            return (
                                              <button
                                                key={val}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSimchasAttending(prev => {
                                                    const next = { ...prev };
                                                    if (active) { delete next[ev.uid]; } else { next[ev.uid] = val; }
                                                    localStorage.setItem('simchasAttending', JSON.stringify(next));
                                                    return next;
                                                  });
                                                }}
                                                className={`flex-1 text-center text-[10px] font-medium px-2 py-1 rounded-md transition-colors ${
                                                  active
                                                    ? val === 'yes' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                    : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                                                }`}
                                              >
                                                {val === 'yes' ? (active ? '✓ Yes' : 'Yes') : (active ? '✓ No' : 'No')}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {shiva.map((ev) => {
                                    const isFuneral = ev.title.toLowerCase().includes('funeral');
                                    return (
                                      <button
                                        key={ev.id}
                                        onClick={() => setExpandedSimcha(expandedSimcha === ev.id ? null : ev.id)}
                                        className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                                          isFuneral ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                        }`}
                                      >
                                        <span className="mr-1">&#x25CF;</span>
                                        {ev.title}
                                        {expandedSimcha === ev.id && (
                                          <div className="mt-1 text-[10px] font-normal text-slate-500 space-y-0.5">
                                            {ev.location && <p>{ev.location}</p>}
                                            {!ev.isAllDay && <p>{format(parseISO(ev.startTime), 'h:mm a')}{ev.endTime ? ` – ${format(parseISO(ev.endTime), 'h:mm a')}` : ''}</p>}
                                          </div>
                                        )}
                                      </button>
                                    );
                                  })}
                                  {!hasEvents && (
                                    <p className="text-center text-slate-300 text-xs py-4">—</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* ═══════ DESIGN B — TWO CARD VIEW ═══════ */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Design B — Card View</p>
                      <div className="grid grid-cols-2 gap-6">
                        {/* Bar & Bat Mitzvahs Card */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden border-t-4 border-t-blue-500">
                          <div className="px-5 py-4 border-b border-slate-100">
                            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                              <span className="text-blue-500">&#x2605;</span>
                              Bar & Bat Mitzvahs This Week
                              <span className="ml-auto bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{bnbMitzvahs.length}</span>
                            </h3>
                          </div>
                          <div className="p-5 space-y-4">
                            {bnbMitzvahs.length === 0 ? (
                              <p className="text-slate-400 text-sm text-center py-8">None this week</p>
                            ) : (
                              bnbMitzvahs.map((ev) => {
                                const evDate = new Date(ev.start);
                                return (
                                  <div key={ev.uid} className="border-b border-slate-50 pb-3 last:border-0 last:pb-0">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <p className="text-xs text-slate-400">{format(evDate, 'EEEE, MMMM d')}</p>
                                        <p className="font-semibold text-slate-900 text-sm mt-0.5">{ev.summary}</p>
                                        {!ev.isAllDay && (
                                          <p className="text-xs text-slate-500 mt-0.5">{format(evDate, 'h:mm a')}</p>
                                        )}
                                        {(ev.description || ev.location) && (
                                          <p className="text-xs text-slate-400 mt-1">
                                            {[ev.description, ev.location].filter(Boolean).join(' · ')}
                                          </p>
                                        )}
                                      </div>
                                      <div className="ml-3 flex-shrink-0 flex gap-1">
                                        {(['yes', 'no'] as const).map(val => {
                                          const active = simchasAttending[ev.uid] === val;
                                          return (
                                            <button
                                              key={val}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSimchasAttending(prev => {
                                                  const next = { ...prev };
                                                  if (active) { delete next[ev.uid]; } else { next[ev.uid] = val; }
                                                  localStorage.setItem('simchasAttending', JSON.stringify(next));
                                                  return next;
                                                });
                                              }}
                                              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                                                active
                                                  ? val === 'yes' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                              }`}
                                            >
                                              {val === 'yes' ? (active ? '✓ Yes' : 'Yes') : (active ? '✓ No' : 'No')}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        {/* Shivas & Funerals Card */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden border-t-4 border-t-slate-400">
                          <div className="px-5 py-4 border-b border-slate-100">
                            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                              <span className="text-slate-400">&#x25CF;</span>
                              Shivas & Funerals This Week
                              <span className="ml-auto bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs font-medium">{shivaFuneralEvents.length}</span>
                            </h3>
                          </div>
                          <div className="p-5 space-y-4">
                            {shivaFuneralEvents.length === 0 ? (
                              <p className="text-slate-400 text-sm text-center py-8">None this week</p>
                            ) : (
                              shivaFuneralEvents.map((ev) => {
                                const evDate = new Date(ev.startTime);
                                return (
                                  <div key={ev.id} className="border-b border-slate-50 pb-3 last:border-0 last:pb-0">
                                    <p className="text-xs text-slate-400">{format(evDate, 'EEEE, MMMM d')}</p>
                                    <p className="font-semibold text-slate-900 text-sm mt-0.5">{ev.title}</p>
                                    {!ev.isAllDay && (
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        {format(evDate, 'h:mm a')}
                                        {ev.endTime ? ` – ${format(parseISO(ev.endTime), 'h:mm a')}` : ''}
                                      </p>
                                    )}
                                    {ev.location && (
                                      <p className="text-xs text-slate-400 mt-1">{ev.location}</p>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ═══════ B'NEI MITZVAH INVITATIONS ═══════ */}
                    <div className="mt-8">
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => setExpandedSections(s => ({ ...s, bnbInvitations: !s.bnbInvitations }))}
                          className="w-full bg-slate-50 px-5 py-3 flex items-center justify-between text-slate-800 border-b border-slate-100"
                        >
                          <span className="font-semibold text-sm">B&apos;nei Mitzvah Invitations to Process</span>
                          <div className="flex items-center gap-2">
                            <span className={`${bneiMitzvahInvitations.length > 0 ? 'bg-slate-400 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{bneiMitzvahInvitations.length}</span>
                            <span className={`transition-transform ${expandedSections.bnbInvitations ? 'rotate-180' : ''}`}>▼</span>
                          </div>
                        </button>
                        {expandedSections.bnbInvitations && (
                          <div className="p-5 space-y-3">
                            {bneiMitzvahInvitations.length === 0 ? (
                              <p className="text-slate-400 text-sm text-center py-6">No B&apos;nei Mitzvah invitations</p>
                            ) : (
                              bneiMitzvahInvitations.map((email) => (
                                <div
                                  key={email.id}
                                  className="relative group bg-white border border-slate-200 border-l-4 border-l-slate-300 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md"
                                  onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                                >
                                  <button
                                    onClick={(e) => { e.stopPropagation(); dismissInvitation(email.id); }}
                                    className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    title="Dismiss invitation"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                      <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                      {email.summary && <p className="text-slate-400 text-xs mt-1 line-clamp-2">{email.summary}</p>}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const tomorrow = new Date();
                                          tomorrow.setDate(tomorrow.getDate() + 1);
                                          setEventFormData({
                                            title: email.subject,
                                            date: tomorrow.toISOString().split('T')[0],
                                            startTime: '09:00',
                                            endTime: '10:00',
                                            location: '',
                                            description: email.summary || '',
                                          });
                                          setShowEventModal(true);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                        title="Add to Calendar"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        Add to Calendar
                                      </button>
                                      <span className="text-xs text-slate-400 whitespace-nowrap">{formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}</span>
                                    </div>
                                  </div>
                                  {expandedEmail === email.id && <ExpandedEmailPanel email={email} />}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ═══════ SHIVA EMAILS (filtered to Hamakom only) ═══════ */}
                    <div className="mt-8">
                      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => setExpandedSections(s => ({ ...s, shivaEmails: !s.shivaEmails }))}
                          className="w-full bg-slate-50 px-5 py-3 flex items-center justify-between text-slate-800 border-b border-slate-100"
                        >
                          <span className="font-semibold text-sm">Shiva Emails</span>
                          <div className="flex items-center gap-2">
                            <span className={`${shivaEmails.length > 0 ? 'bg-slate-400 text-white' : 'bg-slate-200 text-slate-500'} px-3 py-1 rounded-full text-xs font-medium`}>{shivaEmails.length}</span>
                            <span className={`transition-transform ${expandedSections.shivaEmails ? 'rotate-180' : ''}`}>▼</span>
                          </div>
                        </button>
                        {expandedSections.shivaEmails && (
                          <div className="p-5 space-y-3">
                            {shivaEmails.length === 0 ? (
                              <p className="text-slate-400 text-sm text-center py-6">No shiva emails</p>
                            ) : (
                              shivaEmails.map((email) => {
                                const shivaEndsAt = parseShivaEndDate(email.body_text);
                                return (
                                <div
                                  key={email.id}
                                  className="bg-white border border-slate-200 border-l-4 border-l-slate-300 rounded-lg p-3 cursor-pointer transition-all shadow-sm hover:shadow-md"
                                  onClick={() => setExpandedEmail(expandedEmail === email.id ? null : email.id)}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                                      <p className="text-slate-500 text-xs mt-1">{email.from_name || email.from_email}</p>
                                      {shivaEndsAt && (
                                        <p className="text-amber-700 text-xs font-medium mt-1">Shiva through {shivaEndsAt}</p>
                                      )}
                                      {email.summary && <p className="text-slate-400 text-xs mt-1 line-clamp-2">{email.summary}</p>}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setPopupEmailId(email.id); }}
                                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1.5"
                                      >
                                        View full notice →
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const tomorrow = new Date();
                                          tomorrow.setDate(tomorrow.getDate() + 1);
                                          setEventFormData({
                                            title: email.subject,
                                            date: tomorrow.toISOString().split('T')[0],
                                            startTime: '09:00',
                                            endTime: '10:00',
                                            location: '',
                                            description: email.summary || '',
                                          });
                                          setShowEventModal(true);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                        title="Add to Calendar"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                        Add to Calendar
                                      </button>
                                      {shivaNoteSent[email.id] ? (
                                        <span
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700"
                                          title="Sent to Emily"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                          </svg>
                                          Sent
                                        </span>
                                      ) : (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const familyName = (email.subject || '').replace(/hamakom/i, '').replace(/[^a-zA-Z\s]/g, '').trim() || 'family';
                                            setShivaModalPayload({
                                              emailId: email.id,
                                              familyName,
                                              summary: email.summary || '',
                                              receivedAt: email.received_at,
                                            });
                                          }}
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                                          title="Open Send Condolence Note modal"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                          Send Note
                                        </button>
                                      )}
                                      <span className="text-xs text-slate-400 whitespace-nowrap">{formatDistanceToNow(new Date(email.received_at), { addSuffix: true })}</span>
                                    </div>
                                  </div>
                                  {expandedEmail === email.id && <ExpandedEmailPanel email={email} />}
                                </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Student Logs View — owner / assistant only. Tries to embed
              the Axiom report via iframe; if Veracross's X-Frame-Options
              blocks the embed (which is typical), users get the open-
              in-Veracross button above and a friendly hint below. */}
          {activeNav === 'student-logs' && role !== 'owner' && role !== 'assistant' && (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400 text-sm">Student Logs is restricted to administrators.</p>
            </div>
          )}
          {activeNav === 'student-logs' && (role === 'owner' || role === 'assistant') && (
            <div>
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-slate-900">Student Logs</h1>
                <p className="text-sm text-slate-500 mt-1">Weekly behavior log from Veracross</p>
              </div>
              {/* Veracross blocks all embedding via X-Frame-Options, so
                  there's no useful inline view. We keep a single
                  prominent open-in-Veracross button instead — RBK
                  prefers a clean button over a broken iframe. */}
              <div className="bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center" style={{ minHeight: 320 }}>
                <a
                  href="https://app.veracross.com/sar/portals/admin#student_behavior_log"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open in Veracross →
                </a>
                <p className="text-xs text-slate-400 mt-3">Opens in a new tab.</p>
              </div>
            </div>
          )}

          {/* Absences View */}
          {activeNav === 'absences' && effectiveModules?.absences === false && (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400 text-sm">This module is not enabled for your workspace.</p>
            </div>
          )}
          {activeNav === 'absences' && effectiveModules?.absences !== false && (() => {
            // Walk one school day in either direction (skip Sat/Sun).
            // Returns YYYY-MM-DD strings. `from` is interpreted as a
            // UTC-noon anchor to dodge timezone edge cases.
            const todayIsoLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            const SCHOOL_YEAR_START = '2025-09-02';
            const stepSchoolDay = (fromIso: string, direction: 1 | -1): string => {
              const [y, m, d] = fromIso.split('-').map(Number);
              const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
              for (let i = 0; i < 14; i++) {
                dt.setUTCDate(dt.getUTCDate() + direction);
                const dow = dt.getUTCDay(); // 0=Sun, 6=Sat
                if (dow !== 0 && dow !== 6) {
                  return dt.toISOString().slice(0, 10);
                }
              }
              return fromIso;
            };
            const currentIso = absencesDate ?? todayIsoLocal;
            const isHistorical = absencesDate !== null;
            const atSchoolYearStart = currentIso <= SCHOOL_YEAR_START;
            const atToday = currentIso >= todayIsoLocal;
            const goPrev = () => {
              const prev = stepSchoolDay(currentIso, -1);
              if (prev < SCHOOL_YEAR_START) return;
              setAbsencesDate(prev);
            };
            const goNext = () => {
              const next = stepSchoolDay(currentIso, 1);
              if (next > todayIsoLocal) return;
              setAbsencesDate(next === todayIsoLocal ? null : next);
            };
            return (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">Student Absences{backgroundRefreshing === 'absences' && <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />Updating...</span>}</h1>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={goPrev}
                      disabled={atSchoolYearStart}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Previous school day"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <p className="text-sm text-slate-500">
                      {absencesData ? format(new Date(absencesData.date + 'T12:00:00'), 'EEEE, MMMM d, yyyy') : format(new Date(currentIso + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                    </p>
                    {isHistorical && (
                      <span className="text-xs text-slate-400">Historical</span>
                    )}
                    <button
                      onClick={goNext}
                      disabled={atToday}
                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Next school day"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchAbsences()}
                    disabled={absencesLoading}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <svg className={`w-4 h-4 ${absencesLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>

              {absencesLoading && !absencesData ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                      <div className="h-5 bg-slate-200 rounded w-40 mb-4" />
                      <div className="space-y-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                        <div className="h-4 bg-slate-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : absencesData ? (
                <>
                  {/* Attendance Overview Charts */}
                  {(absencesData.totalStudents || absencesData.monthlyTrend?.length || absencesData.topAbsentees?.length) ? (
                    <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
                      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Attendance Overview</h2>
                      <div className="flex flex-col lg:flex-row gap-4">
                        {/* Donut: Today's Attendance */}
                        <div className="rounded-lg border border-slate-100 p-4 lg:w-[220px] lg:flex-shrink-0">
                          <h3 className="text-sm font-semibold text-slate-700 mb-3">Today&apos;s Attendance</h3>
                          <div style={{ height: 220 }}>
                            {(() => {
                              const absent = absencesData.absences.length;
                              const tardy = absencesData.tardies.length;
                              const early = absencesData.earlyDismissals.length;
                              const notExp = absencesData.notExpected?.length ?? 0;
                              const total = absencesData.totalStudents || (absent + tardy + early + notExp + 100);
                              const present = Math.max(0, total - absent - tardy - early - notExp);
                              const pctPresent = total > 0 ? Math.round((present / total) * 100) : 0;
                              const data = [
                                { name: 'Present', value: present, color: '#10b981' },
                                { name: 'Absent', value: absent + notExp, color: '#ef4444' },
                                { name: 'Tardy', value: tardy, color: '#f59e0b' },
                                { name: 'Early Dismissal', value: early, color: '#3b82f6' },
                              ].filter(d => d.value > 0);
                              return (
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
                                      {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                                    </Pie>
                                    <Tooltip formatter={(value: any, name: any) => [`${value} students`, name]} />
                                    <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="text-2xl font-bold" fill="#334155">{pctPresent}%</text>
                                    <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="text-xs" fill="#94a3b8">present</text>
                                  </PieChart>
                                </ResponsiveContainer>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Bar: Absences This Month */}
                        <div className="rounded-lg border border-slate-100 p-4 lg:flex-1 lg:min-w-0">
                          <h3 className="text-sm font-semibold text-slate-700 mb-3">Absences This Month</h3>
                          <div style={{ height: 220 }}>
                            {absencesData.monthlyTrend && absencesData.monthlyTrend.length > 0 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={absencesData.monthlyTrend} margin={{ top: 5, right: 5, bottom: 20, left: -10 }}>
                                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => format(new Date(d + 'T12:00:00'), 'MMM d')} angle={-45} textAnchor="end" />
                                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                                  <Tooltip labelFormatter={(d: any) => format(new Date(d + 'T12:00:00'), 'EEEE, MMM d')} formatter={(v: any) => [`${v} absences`]} />
                                  <Bar dataKey="count" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="flex items-center justify-center h-full text-sm text-slate-400">No data this month</div>
                            )}
                          </div>
                        </div>

                        {/* Horizontal Bar: Top 10 Most Absent YTD */}
                        <div className="rounded-lg border border-slate-100 p-4 lg:w-[320px] lg:flex-shrink-0">
                          <h3 className="text-sm font-semibold text-slate-700 mb-3">Most Absent Students (YTD)</h3>
                          <div style={{ height: 220 }}>
                            {absencesData.topAbsentees && absencesData.topAbsentees.length > 0 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={absencesData.topAbsentees} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 9 }} tickFormatter={(n: string) => n.includes(',') ? n.split(',')[1]?.trim() + ' ' + n.split(',')[0]?.trim().charAt(0) + '.' : n} />
                                  <Tooltip formatter={(v: any) => [`${v} absences`]} />
                                  <Bar dataKey="ytd_absences" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="flex items-center justify-center h-full text-sm text-slate-400">No data available</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Summary pills */}
                  <div className="flex gap-3 mb-6">
                    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-full">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-sm font-semibold text-red-700">{absencesData.absences.length + (absencesData.notExpected?.length ?? 0)}</span>
                      <span className="text-sm text-red-600">Absent</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-amber-700">{absencesData.tardies.length}</span>
                      <span className="text-sm text-amber-600">Tardy</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-sm font-semibold text-blue-700">{absencesData.earlyDismissals.length}</span>
                      <span className="text-sm text-blue-600">Early Dismissal</span>
                    </div>
                  </div>

                  {/* Needs Follow-Up Alert */}
                  {(() => {
                    const consecutiveFlags = absencesData.absences.filter(r => r.consecutive_absences >= 3);
                    const ytdFlags = absencesData.absences.filter(r => r.ytd_absences >= 15);
                    if (consecutiveFlags.length === 0 && ytdFlags.length === 0) return null;
                    return (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                        <h3 className="font-semibold text-amber-800 flex items-center gap-2 mb-3">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                          </svg>
                          Needs Follow-Up
                        </h3>
                        {consecutiveFlags.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Consecutive Absences (3+ days)</p>
                            <div className="space-y-1">
                              {consecutiveFlags.map(r => (
                                <div key={`consec-${r.person_id}`} className="flex items-center gap-2 text-sm">
                                  <span className="font-medium text-slate-800">{r.name}</span>
                                  {r.grade_level && <span className="text-xs text-slate-400">{r.grade_level}</span>}
                                  <span className="text-xs font-medium text-amber-700">Absent {r.consecutive_absences} days in a row</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ytdFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">High YTD Absences (15+)</p>
                            <div className="space-y-1">
                              {ytdFlags.map(r => (
                                <div key={`ytd-${r.person_id}`} className="flex items-center gap-2 text-sm">
                                  <span className="font-medium text-slate-800">{r.name}</span>
                                  {r.grade_level && <span className="text-xs text-slate-400">{r.grade_level}</span>}
                                  <span className="text-xs font-medium text-amber-700">{r.ytd_absences} absences this year</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Grade-card layout — replaces the prior flat
                      Absent + Tardy lists. Each section (ELC, LS, MS)
                      shows a row of small cards (one per grade) with
                      absent + tardy counts. Clicking a card expands
                      an absent+tardy roster panel below the row. ELC
                      is collapsed by default since attendance there
                      is usually quiet; LS + MS open by default. */}
                  {(() => {
                    type GradeBucket = { absent: AbsenceRecord[]; tardy: AbsenceRecord[] };
                    const byGrade = new Map<number, GradeBucket>();
                    const ensure = (id: number) => {
                      let b = byGrade.get(id);
                      if (!b) { b = { absent: [], tardy: [] }; byGrade.set(id, b); }
                      return b;
                    };
                    for (const r of [...absencesData.absences, ...(absencesData.notExpected || [])]) {
                      if (r.grade_level_id == null) continue;
                      ensure(r.grade_level_id).absent.push(r);
                    }
                    for (const r of absencesData.tardies) {
                      if (r.grade_level_id == null) continue;
                      ensure(r.grade_level_id).tardy.push(r);
                    }

                    // Section + card definitions. Grade IDs match the
                    // Veracross codes in app/api/absences/route.ts
                    // GRADE_LABELS. ELC has 5 cards (Infant/Toddler
                    // through K) to match the actual SAR roster — the
                    // spec listed only 4 but Infant/Toddler is a real
                    // attendance bucket.
                    const SECTIONS: Array<{ key: 'elc' | 'ls' | 'ms'; title: string; gridClass: string; grades: Array<{ id: number; label: string }> }> = [
                      { key: 'elc', title: 'Early Learning Center', gridClass: 'grid-cols-2 md:grid-cols-5', grades: [
                        { id: 40, label: 'Infant/Toddler' },
                        { id: 35, label: '2 Year Nursery' },
                        { id: 30, label: '3 Year Nursery' },
                        { id: 25, label: '4 Year Nursery' },
                        { id: 20, label: 'Kindergarten' },
                      ]},
                      { key: 'ls', title: 'Lower School', gridClass: 'grid-cols-2 md:grid-cols-4', grades: [
                        { id: 1, label: '1st Grade' },
                        { id: 2, label: '2nd Grade' },
                        { id: 3, label: '3rd Grade' },
                        { id: 4, label: '4th Grade' },
                      ]},
                      { key: 'ms', title: 'Middle School', gridClass: 'grid-cols-2 md:grid-cols-4', grades: [
                        { id: 5, label: '5th Grade' },
                        { id: 6, label: '6th Grade' },
                        { id: 7, label: '7th Grade' },
                        { id: 8, label: '8th Grade' },
                      ]},
                    ];

                    const renderExpandedPanel = (gradeId: number, label: string) => {
                      const b = byGrade.get(gradeId);
                      const absent = b?.absent ?? [];
                      const tardy = b?.tardy ?? [];
                      return (
                        <div className="mt-3 bg-white rounded-xl border border-slate-200 p-5">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-slate-800">{label} — Today</h4>
                            <button
                              onClick={() => setAbsencesExpandedGrade(null)}
                              className="text-xs text-slate-400 hover:text-slate-600 font-medium"
                            >Close ×</button>
                          </div>
                          {absent.length === 0 && tardy.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-3">All students present in this grade today.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-2">Absent ({absent.length})</p>
                                {absent.length === 0 ? (
                                  <p className="text-xs text-slate-400">None</p>
                                ) : absent.map(r => (
                                  <div key={`abs-${r.person_id}`} className={`py-1.5 flex items-center gap-2 text-sm ${r.excused ? '' : 'border-l-2 border-red-400 pl-3'}`}>
                                    <span className="font-medium text-slate-800 truncate">{r.name}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${r.excused ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{r.status_label}</span>
                                    {r.ytd_absences > 0 && <span className="text-xs text-slate-400 flex-shrink-0">({r.ytd_absences} YTD)</span>}
                                  </div>
                                ))}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Tardy ({tardy.length})</p>
                                {tardy.length === 0 ? (
                                  <p className="text-xs text-slate-400">None</p>
                                ) : tardy.map(r => (
                                  <div key={`tar-${r.person_id}`} className="py-1.5 flex items-center gap-2 text-sm">
                                    <span className="font-medium text-slate-800 truncate">{r.name}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 flex-shrink-0">{r.status_label}</span>
                                    {r.late_arrival_time && (
                                      <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
                                        {(() => { const d = new Date(r.late_arrival_time); return format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()), 'h:mm a'); })()}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    };

                    return SECTIONS.map(section => {
                      const collapsed = absencesSectionCollapsed[section.key];
                      const expandedInSection = absencesExpandedGrade != null && section.grades.some(g => g.id === absencesExpandedGrade);
                      const expandedGrade = expandedInSection ? section.grades.find(g => g.id === absencesExpandedGrade) : null;
                      return (
                        <div key={section.key} className="mb-6">
                          <button
                            onClick={() => setAbsencesSectionCollapsed(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                            className="w-full flex items-center justify-between mb-2 hover:opacity-80 transition-opacity"
                          >
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{section.title}</span>
                            <svg className={`w-4 h-4 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {!collapsed && (
                            <>
                              <div className={`grid gap-3 ${section.gridClass}`}>
                                {section.grades.map(g => {
                                  const b = byGrade.get(g.id);
                                  const absentCount = b?.absent.length ?? 0;
                                  const tardyCount = b?.tardy.length ?? 0;
                                  const isExpanded = absencesExpandedGrade === g.id;
                                  return (
                                    <button
                                      key={g.id}
                                      onClick={() => setAbsencesExpandedGrade(prev => prev === g.id ? null : g.id)}
                                      className={`rounded-lg bg-white border border-slate-200 p-3 text-center shadow-sm hover:border-slate-300 transition-colors ${isExpanded ? 'ring-2 ring-slate-300' : ''}`}
                                    >
                                      <p className="text-sm font-semibold text-slate-700">{g.label}</p>
                                      <p className={`text-2xl font-bold mt-1 ${absentCount === 0 ? 'text-slate-300' : 'text-slate-900'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{absentCount}</p>
                                      <p className="text-xs text-slate-400 -mt-0.5">absent</p>
                                      {tardyCount > 0 ? (
                                        <p className="text-sm text-amber-600 mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>{tardyCount} tardy</p>
                                      ) : (
                                        <p className="text-sm text-slate-300 mt-1">0 tardy</p>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                              {expandedGrade && renderExpandedPanel(expandedGrade.id, expandedGrade.label)}
                            </>
                          )}
                        </div>
                      );
                    });
                  })()}

                  {/* Early Dismissals Section */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
                    <button
                      onClick={() => setAbsencesCollapsed(prev => ({ ...prev, earlyDismissals: !prev.earlyDismissals }))}
                      className="w-full px-5 py-4 flex items-center justify-between border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full bg-blue-500" />
                        <h3 className="font-semibold text-slate-900">Early Dismissal</h3>
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">{absencesData.earlyDismissals.length}</span>
                      </div>
                      <svg className={`w-5 h-5 text-slate-400 transition-transform ${absencesCollapsed.earlyDismissals ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {!absencesCollapsed.earlyDismissals && (
                      <div className="px-4 py-2">
                        {absencesData.earlyDismissals.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-8">No early dismissals today</p>
                        ) : (
                          <div>
                            {(() => {
                              const GRADE_SORT_ORDER = [40, 35, 30, 25, 20, 1, 2, 3, 4, 5, 6, 7, 8];
                              const gradeGroups = new Map<string, AbsenceRecord[]>();
                              absencesData.earlyDismissals.forEach(r => {
                                const key = r.grade_level || 'Unknown';
                                if (!gradeGroups.has(key)) gradeGroups.set(key, []);
                                gradeGroups.get(key)!.push(r);
                              });
                              const sortedGrades = [...gradeGroups.keys()].sort((a, b) => {
                                const idA = gradeGroups.get(a)![0].grade_level_id;
                                const idB = gradeGroups.get(b)![0].grade_level_id;
                                const orderA = idA != null ? GRADE_SORT_ORDER.indexOf(idA) : 999;
                                const orderB = idB != null ? GRADE_SORT_ORDER.indexOf(idB) : 999;
                                return (orderA === -1 ? 998 : orderA) - (orderB === -1 ? 998 : orderB);
                              });
                              return sortedGrades.map((grade, idx) => (
                                <div key={grade} className="mb-4 last:mb-0">
                                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1 mt-3 first:mt-0">{grade}</div>
                                  <div className="grid grid-cols-2 gap-x-6">
                                    {gradeGroups.get(grade)!.map(r => (
                                      <div key={r.person_id} className="py-1.5 flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-800 truncate">{r.name}</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 flex-shrink-0">Early Dismissal</span>
                                        {r.early_dismissal_time && (
                                          <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
                                            {(() => { const d = new Date(r.early_dismissal_time); return format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()), 'h:mm a'); })()}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  {idx < sortedGrades.length - 1 && <hr className="border-t border-slate-100 my-3" />}
                                </div>
                              ));
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Attendance Distribution — Year to Date.
                      Aggregated server-side via /api/absences?view=ytd
                      (lazy-fetched on first visit). Respects the same
                      division filter as the live block above because
                      both routes go through getEffectiveDivisions(). */}
                  <div className="mt-8">
                    <h3 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h13M9 11V5H4v12h5z M9 11h13v6H9z" />
                      </svg>
                      Attendance Distribution — Year to Date
                    </h3>
                    {absencesYtdLoading && !absencesYtdData ? (
                      <ShimmerCards count={2} />
                    ) : absencesYtdData && (absencesYtdData.absenceTiersByGrade.length > 0 || absencesYtdData.quarterlyTrend.some(q => q.absences > 0 || q.tardies > 0)) ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Chart 1: Attendance Tiers by Grade */}
                        <div className="bg-white border border-slate-200 rounded-lg p-5">
                          <h4 className="text-sm font-semibold text-slate-800">Attendance Tiers by Grade Level</h4>
                          <p className="text-xs text-slate-500 mt-0.5 mb-4">Distribution of students by ADA tier</p>
                          {/* Custom legend above the chart */}
                          <div className="flex items-center gap-4 mb-3 text-xs">
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#f87171' }} /> Chronically Absent (&lt;90%)</span>
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#fb923c' }} /> At Risk (90–95%)</span>
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#34d399' }} /> Satisfactory (≥95%)</span>
                          </div>
                          <div style={{ height: Math.max(absencesYtdData.absenceTiersByGrade.length * 34 + 30, 200) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={absencesYtdData.absenceTiersByGrade} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 30 }}>
                                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                                <YAxis type="category" dataKey="grade_label" tick={{ fontSize: 11 }} width={100} />
                                <Tooltip formatter={(v: any, name: any) => [`${v} students`, name === 'chronically_absent' ? 'Chronically Absent' : name === 'at_risk' ? 'At Risk' : 'Satisfactory']} />
                                <Bar dataKey="chronically_absent" stackId="a" fill="#f87171" name="chronically_absent" />
                                <Bar dataKey="at_risk" stackId="a" fill="#fb923c" name="at_risk" />
                                <Bar dataKey="satisfactory" stackId="a" fill="#34d399" name="satisfactory" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Chart 2: Quarterly Absence & Tardy Trend */}
                        <div className="bg-white border border-slate-200 rounded-lg p-5">
                          <h4 className="text-sm font-semibold text-slate-800">Quarterly Absence &amp; Tardy Trend</h4>
                          <p className="text-xs text-slate-500 mt-0.5 mb-4">
                            Daily attendance events by grading period{absencesYtdData.currentQuarter ? ` · ${absencesYtdData.currentQuarter} in progress` : ''}
                          </p>
                          <div className="flex items-center gap-4 mb-3 text-xs">
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#f87171' }} /> Absences</span>
                            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: '#fb923c' }} /> Tardies</span>
                          </div>
                          <div style={{ height: 280 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={absencesYtdData.quarterlyTrend} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                                <XAxis dataKey="quarter" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="absences" fill="#f87171" radius={[2, 2, 0, 0]} name="Absences" />
                                <Bar dataKey="tardies" fill="#fb923c" radius={[2, 2, 0, 0]} name="Tardies" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400">
                        No year-to-date attendance data available yet.
                      </div>
                    )}
                  </div>

                </>
              ) : (
                <div className="text-center py-20 text-slate-400">
                  <p>Failed to load absence data</p>
                  <button onClick={() => fetchAbsences()} className="mt-2 text-blue-600 hover:underline text-sm">Try again</button>
                </div>
              )}
            </div>
            );
          })()}

          {/* Admissions View */}
          {activeNav === 'admissions' && effectiveModules?.admissions === false && (
            <div className="flex items-center justify-center h-64">
              <p className="text-slate-400 text-sm">This module is not enabled for your workspace.</p>
            </div>
          )}
          {activeNav === 'admissions' && effectiveModules?.admissions !== false && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">Admissions &amp; Enrollment{backgroundRefreshing === 'admissions' && <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />Updating...</span>}</h1>
                  <p className="text-sm text-slate-500 mt-1">2026–27 School Year</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {admissionsLastFetched
                      ? (() => {
                          const diffSec = Math.floor((Date.now() - admissionsLastFetched.getTime()) / 1000);
                          if (diffSec < 60) return 'Last synced just now';
                          const diffMin = Math.floor(diffSec / 60);
                          if (diffMin < 60) return `Last synced ${diffMin} min ago`;
                          return `Last synced ${Math.floor(diffMin / 60)}h ago`;
                        })()
                      : 'Never synced'}
                  </span>
                  <button
                    onClick={() => { setAdmissionsData(null); setReEnrollmentsData([]); setCurrentYearCounts({}); setAdmissionsCities({}); setAdmissionsCitiesFailed(false); delete dataCacheRef.current.admissions; setAdmissionsRefreshKey(k => k + 1); }}
                    disabled={admissionsLoading}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <svg className={`w-4 h-4 ${admissionsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>

              {/* Division toggle — multi-division users only */}
              {hasMultipleDivisions && (
                <div className="flex items-center gap-2 mb-4 p-1 bg-slate-100 rounded-lg w-fit">
                  {(['academy', 'hs', 'both'] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setActiveDivisionAdmissions(d)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        activeDivisionAdmissions === d
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {d === 'academy' ? 'Academy' : d === 'hs' ? 'High School' : 'Institutional'}
                    </button>
                  ))}
                </div>
              )}

              {/* Amber HS-view banner */}
              {hasMultipleDivisions && activeDivisionAdmissions === 'hs' && (
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4 text-amber-800 text-sm font-medium">
                  <span>🏫</span>
                  <span>High School view — data sourced from SAR High School</span>
                </div>
              )}

              {/* Combined view banner */}
              {hasMultipleDivisions && activeDivisionAdmissions === 'both' && (
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg mb-4 text-slate-700 text-sm font-medium">
                  <span>🏫</span>
                  <span>Viewing all divisions — Academy + High School</span>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
                <button
                  onClick={() => { setAdmissionsTab('overview'); setAdmissionsSearchTerm(''); }}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${admissionsTab === 'overview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Admissions Overview
                </button>
                <button
                  onClick={() => { setAdmissionsTab('projection'); setAdmissionsSearchTerm(''); }}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${admissionsTab === 'projection' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Enrollment Projection
                </button>
                <button
                  onClick={() => { setAdmissionsTab('enrollment'); setAdmissionsSearchTerm(''); }}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${admissionsTab === 'enrollment' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  New Enrollment
                </button>

              </div>

              {admissionsLoading && !admissionsData ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                      <div className="h-5 bg-slate-200 rounded w-40 mb-4" />
                      <div className="space-y-3">
                        <div className="h-4 bg-slate-100 rounded w-full" />
                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                        <div className="h-4 bg-slate-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : admissionsData ? (
                <>
                  {admissionsTab === 'overview' && (() => {
                    const accepted = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status));
                    const waitlisted = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Waitlisted.includes(a.application_status));
                    const denied = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Denied.includes(a.application_status));
                    const withdrawn = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Withdrawn.includes(a.application_status));

                    // Search filter (only affects grade rows, not summary pills)
                    const searchLower = admissionsSearchTerm.toLowerCase().trim();
                    const filteredData = searchLower
                      ? admissionsData.filter(a => {
                          const name = applicantNames[a.applicant_id] || '';
                          const gradeLabel = ADMISSIONS_GRADE_LABELS[a.grade_applying_for] || `Grade ${a.grade_applying_for}`;
                          const statusLabel = getApplicationStatusLabel(a.application_status);
                          const city = admissionsCities[a.applicant_id] || '';
                          return name.toLowerCase().includes(searchLower) ||
                            gradeLabel.toLowerCase().includes(searchLower) ||
                            statusLabel.toLowerCase().includes(searchLower) ||
                            city.toLowerCase().includes(searchLower);
                        })
                      : admissionsData;

                    // Grade grouping (uses filtered data)
                    const gradeGroups = new Map<number, AdmissionApplication[]>();
                    filteredData.forEach(a => {
                      const grade = a.grade_applying_for;
                      if (!gradeGroups.has(grade)) gradeGroups.set(grade, []);
                      gradeGroups.get(grade)!.push(a);
                    });
                    const sortedGrades = [...gradeGroups.keys()].sort((a, b) => {
                      const idxA = ADMISSIONS_GRADE_SORT.indexOf(a);
                      const idxB = ADMISSIONS_GRADE_SORT.indexOf(b);
                      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                    });

                    return (
                      <>
                        {/* Summary pills — clickable for drilldown */}
                        <div className="flex gap-3 mb-6 flex-wrap">
                          {([
                            { key: 'Accepted', codes: APPLICATION_STATUS_GROUPS.Accepted, count: accepted.length, bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', num: 'text-green-700', text: 'text-green-600' },
                            { key: 'Waitlisted', codes: APPLICATION_STATUS_GROUPS.Waitlisted, count: waitlisted.length, bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', num: 'text-amber-700', text: 'text-amber-600' },
                            { key: 'Withdrawn', codes: APPLICATION_STATUS_GROUPS.Withdrawn, count: withdrawn.length, bg: 'bg-slate-50', border: 'border-slate-200', dot: 'bg-slate-400', num: 'text-slate-700', text: 'text-slate-600' },
                          ] as const).map(pill => (
                            <button
                              key={pill.key}
                              onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'status' && prev.label === pill.key ? null : { type: 'status', value: pill.codes[0], label: pill.key })}
                              className={`flex items-center gap-2 px-4 py-2 ${pill.bg} border ${pill.border} rounded-full cursor-pointer hover:opacity-80 transition-opacity ${admissionsDrilldown?.type === 'status' && admissionsDrilldown.label === pill.key ? 'ring-2 ring-blue-400' : ''}`}
                            >
                              <span className={`w-2 h-2 rounded-full ${pill.dot}`} />
                              <span className={`text-sm font-semibold ${pill.num}`}>{pill.count}</span>
                              <span className={`text-sm ${pill.text}`}>{pill.key}</span>
                            </button>
                          ))}
                        </div>

                        {/* Search bar */}
                        <div className="relative mb-6">
                          <input
                            type="text"
                            value={admissionsSearchTerm}
                            onChange={e => setAdmissionsSearchTerm(e.target.value)}
                            placeholder="Search applicants, grades, cities..."
                            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
                          />
                          {admissionsSearchTerm && (
                            <button
                              onClick={() => setAdmissionsSearchTerm('')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {/* Two-column layout: left (Family Response + City), right (By Grade) */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                          {/* Left column: Family Response + City pie */}
                          <div className="space-y-6">
                          {/* Family Response */}
                          <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <h3 className="font-semibold text-slate-900 mb-4">Accepted: Family Response</h3>
                            {accepted.length === 0 ? (
                              <p className="text-sm text-slate-400">No accepted applications yet</p>
                            ) : ((() => {
                              const responseItems = ([
                                { code: 2, label: 'Enrollment Complete', badge: 'bg-green-100 text-green-700', bar: 'bg-green-400' },
                                { code: 4, label: 'Accepted Offer', badge: 'bg-blue-100 text-blue-700', bar: 'bg-blue-400' },
                                { code: 9, label: 'Considering Offer', badge: 'bg-teal-100 text-teal-700', bar: 'bg-teal-400' },
                                { code: 1, label: 'Pending', badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' },
                                { code: 3, label: 'Declined Offer', badge: 'bg-red-100 text-red-700', bar: 'bg-red-400' },
                                { code: 5, label: 'Enrollment Withdrawn', badge: 'bg-red-100 text-red-700', bar: 'bg-red-300' },
                                { code: 8, label: 'No Response', badge: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' },
                              ] as const).map(item => ({ ...item, count: accepted.filter(a => a.application_decision_response === item.code).length })).filter(item => item.count > 0);
                              const maxResponseCount = Math.max(...responseItems.map(r => r.count), 1);
                              return (
                                <div className="space-y-3">
                                  {responseItems.map(({ code, label, badge, bar, count }) => (
                                    <button
                                      key={code}
                                      onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'response' && prev.value === code ? null : { type: 'response', value: code, label })}
                                      className={`w-full text-left hover:bg-slate-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors ${admissionsDrilldown?.type === 'response' && admissionsDrilldown.value === code ? 'bg-blue-50' : ''}`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full flex-shrink-0 ${badge}`}>{label}</span>
                                        <div className="flex-1 h-3 rounded-full overflow-hidden">
                                          <div className={`h-full rounded-full ${bar}`} style={{ width: `${(count / maxResponseCount) * 100}%` }} />
                                        </div>
                                        <span className="text-sm font-semibold text-slate-700 flex-shrink-0 w-8 text-right">{count}</span>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              );
                            })())}
                          </div>

                          {/* Applicants by City — Pie Chart */}
                          <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <h3 className="font-semibold text-slate-900 mb-4">Applicants by City</h3>
                            {(() => {
                              if (admissionsCitiesLoading) {
                                return (
                                  <div className="flex items-center gap-2 py-8 justify-center">
                                    <svg className="w-5 h-5 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span className="text-sm text-slate-400">Loading city data...</span>
                                  </div>
                                );
                              }
                              const PIE_COLORS = ['#4ade80','#60a5fa','#f97316','#a78bfa','#fb7185','#34d399','#facc15','#818cf8','#38bdf8','#f472b6','#2dd4bf','#fb923c','#a3e635','#e879f9','#94a3b8'];
                              const cityCount = new Map<string, number>();
                              admissionsData.forEach(a => {
                                const city = admissionsCities[a.applicant_id];
                                if (city) cityCount.set(city, (cityCount.get(city) || 0) + 1);
                              });
                              if (cityCount.size === 0) {
                                return (
                                  <div className="text-center py-6">
                                    <p className="text-sm text-slate-400 mb-2">{admissionsCitiesFailed ? 'Failed to load city data' : 'No city data available'}</p>
                                    {admissionsCitiesFailed && (
                                      <button
                                        onClick={() => {
                                          const ids = [...new Set(admissionsData.map(a => a.applicant_id))];
                                          if (ids.length > 0) fetchAdmissionsCities(ids);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                      >
                                        Retry
                                      </button>
                                    )}
                                  </div>
                                );
                              }
                              const sorted = [...cityCount.entries()].sort((a, b) => b[1] - a[1]);
                              const top14 = sorted.slice(0, 14);
                              const otherCount = sorted.slice(14).reduce((sum, [, c]) => sum + c, 0);
                              const otherCityCount = sorted.length - 14;
                              const slices: { name: string; count: number; color: string }[] = top14.map(([name, count], i) => ({ name, count, color: PIE_COLORS[i % PIE_COLORS.length] }));
                              if (otherCount > 0) slices.push({ name: `Other (${otherCityCount} cities)`, count: otherCount, color: '#94a3b8' });
                              const total = slices.reduce((s, sl) => s + sl.count, 0);
                              const cx = 150, cy = 150, r = 140;
                              let cumAngle = -Math.PI / 2;
                              const paths = slices.map((sl) => {
                                const angle = (sl.count / total) * 2 * Math.PI;
                                const startX = cx + r * Math.cos(cumAngle);
                                const startY = cy + r * Math.sin(cumAngle);
                                cumAngle += angle;
                                const endX = cx + r * Math.cos(cumAngle);
                                const endY = cy + r * Math.sin(cumAngle);
                                const largeArc = angle > Math.PI ? 1 : 0;
                                const midAngle = cumAngle - angle / 2;
                                const midX = cx + (r * 0.65) * Math.cos(midAngle);
                                const midY = cy + (r * 0.65) * Math.sin(midAngle);
                                const d = slices.length === 1
                                  ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
                                  : `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`;
                                return { ...sl, d, midX, midY, pct: ((sl.count / total) * 100).toFixed(1) };
                              });
                              const leftLegend = slices.filter((_, i) => i % 2 === 0);
                              const rightLegend = slices.filter((_, i) => i % 2 === 1);
                              return (
                                <div>
                                  <div className="flex gap-4 mb-3">
                                    <div className="space-y-1">
                                      {leftLegend.map(sl => (
                                        <div key={sl.name} className="flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sl.color }} />
                                          <span className="text-xs text-slate-600 whitespace-nowrap">{sl.name}</span>
                                          <span className="text-xs font-bold text-slate-800 ml-1">{sl.count}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="space-y-1">
                                      {rightLegend.map(sl => (
                                        <div key={sl.name} className="flex items-center gap-1.5">
                                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sl.color }} />
                                          <span className="text-xs text-slate-600 whitespace-nowrap">{sl.name}</span>
                                          <span className="text-xs font-bold text-slate-800 ml-1">{sl.count}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex justify-center">
                                    <div className="relative" style={{ width: 280, height: 280 }}>
                                      <svg viewBox="0 0 300 300" width={280} height={280}>
                                        {paths.map((p) => (
                                          <path
                                            key={p.name}
                                            d={p.d}
                                            fill={p.color}
                                            stroke="white"
                                            strokeWidth={2}
                                            className="cursor-pointer transition-opacity hover:opacity-80"
                                            onMouseEnter={(e) => {
                                              const rect = (e.target as SVGPathElement).ownerSVGElement?.getBoundingClientRect();
                                              setHoveredCitySlice({ name: p.name, count: p.count, pct: p.pct, x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) });
                                            }}
                                            onMouseLeave={() => setHoveredCitySlice(null)}
                                          />
                                        ))}
                                      </svg>
                                      {hoveredCitySlice && (
                                        <div
                                          className="absolute bg-slate-800 text-white text-xs rounded px-2 py-1 pointer-events-none z-50 whitespace-nowrap"
                                          style={{ left: Math.min(hoveredCitySlice.x + 10, 200), top: Math.max(hoveredCitySlice.y - 30, 0) }}
                                        >
                                          {hoveredCitySlice.name}: {hoveredCitySlice.count} ({hoveredCitySlice.pct}%)
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                          </div>{/* end left column */}

                          {/* Right: By Grade */}
                          <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <h3 className="font-semibold text-slate-900 mb-4">By Grade</h3>
                            {sortedGrades.length === 0 ? (
                              <p className="text-sm text-slate-400">{admissionsSearchTerm ? 'No matching applicants found' : 'No applications'}</p>
                            ) : ((() => {
                              const maxGradeCount = Math.max(...sortedGrades.map(g => gradeGroups.get(g)!.length));
                              return (
                                <div className="space-y-3">
                                  {sortedGrades.map(grade => {
                                    const apps = gradeGroups.get(grade)!;
                                    const gradeAccepted = apps.filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status)).length;
                                    const gradeWaitlisted = apps.filter(a => APPLICATION_STATUS_GROUPS.Waitlisted.includes(a.application_status)).length;
                                    const gradeDenied = apps.filter(a => APPLICATION_STATUS_GROUPS.Denied.includes(a.application_status)).length;
                                    const gradeWithdrawn = apps.filter(a => APPLICATION_STATUS_GROUPS.Withdrawn.includes(a.application_status)).length;
                                    const total = apps.length;
                                    const gradeLabel = ADMISSIONS_GRADE_LABELS[grade] || `Grade ${grade}`;
                                    const barPct = (total / maxGradeCount) * 100;
                                    return (
                                      <button
                                        key={grade}
                                        onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'grade' && prev.value === grade ? null : { type: 'grade', value: grade, label: gradeLabel })}
                                        className={`block w-full text-left hover:bg-slate-50 rounded-lg p-2 -mx-2 transition-colors ${admissionsDrilldown?.type === 'grade' && admissionsDrilldown.value === grade ? 'bg-blue-50' : ''}`}
                                      >
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="text-sm font-medium text-slate-700">{gradeLabel}</span>
                                          <span className="text-sm font-semibold text-slate-900">{total}</span>
                                        </div>
                                        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                                          <div className="flex h-full rounded-full overflow-hidden" style={{ width: `${barPct}%` }}>
                                            {gradeAccepted > 0 && <div className="bg-green-500" style={{ width: `${(gradeAccepted / total) * 100}%` }} />}
                                            {gradeWaitlisted > 0 && <div className="bg-amber-500" style={{ width: `${(gradeWaitlisted / total) * 100}%` }} />}
                                            {gradeDenied > 0 && <div className="bg-red-500" style={{ width: `${(gradeDenied / total) * 100}%` }} />}
                                            {gradeWithdrawn > 0 && <div className="bg-slate-400" style={{ width: `${(gradeWithdrawn / total) * 100}%` }} />}
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })}
                                  {/* Legend */}
                                  <div className="flex gap-4 mt-2 pt-2 border-t border-slate-100">
                                    <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-green-500" />Accepted</span>
                                    <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-amber-500" />Waitlisted</span>
                                    <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-red-500" />Denied</span>
                                    <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400" />Withdrawn</span>
                                  </div>
                                </div>
                              );
                            })())}
                          </div>
                        </div>

                      </>
                    );
                  })()}

                  {admissionsTab === 'projection' && (() => {
                    // New applicants (accepted)
                    const accepted = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status));
                    const newRegistered = accepted.filter(a => a.application_decision_response === 2);
                    const newInProcess = accepted.filter(a => a.application_decision_response === 4);
                    const newLikely = accepted.filter(a => a.application_decision_response === 9);
                    const newContractPending = accepted.filter(a => a.application_decision_response === 1);
                    const newDeclined = accepted.filter(a => a.application_decision_response === 3);
                    const newWaitlisted = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Waitlisted.includes(a.application_status));
                    const newPendingReview = admissionsData.filter(a => a.application_status === 1);

                    // Re-enrollments
                    const reRegistered = reEnrollmentsData.filter(s => s.enrollment_status === 5);
                    const reLikely = reEnrollmentsData.filter(s => [3, 6].includes(s.enrollment_status));
                    const reContractPending = reEnrollmentsData.filter(s => [2, 4].includes(s.enrollment_status));
                    const notReEnrolling = reEnrollmentsData.filter(s => s.enrollment_status === 8);

                    // Combined counts
                    const registeredCount = reRegistered.length + newRegistered.length;
                    const incompleteCount = newInProcess.length + reLikely.length + newLikely.length + reContractPending.length + newContractPending.length;
                    const pipelineTotal = registeredCount + incompleteCount;

                    // Combined grade breakdown — unified type using canonical string grade key
                    type ProjectionRow = { gradeKey: string; source: 'new' | 're'; category: 'registered' | 'inprocess' | 'likely' | 'contractpending'; name: string; id: number; statusLabel: string; pisgah?: boolean; };
                    const projectionRows: ProjectionRow[] = [];

                    // New applicants → canonicalize grade_applying_for
                    newRegistered.forEach(a => projectionRows.push({ gradeKey: getCanonicalGradeKey('applicant', a.grade_applying_for), source: 'new', category: 'registered', name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`, id: a.applicant_id, statusLabel: 'Registered', pisgah: a.student_group_applying_for === 1 }));
                    newInProcess.forEach(a => projectionRows.push({ gradeKey: getCanonicalGradeKey('applicant', a.grade_applying_for), source: 'new', category: 'inprocess', name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`, id: a.applicant_id, statusLabel: 'In Process', pisgah: a.student_group_applying_for === 1 }));
                    newLikely.forEach(a => projectionRows.push({ gradeKey: getCanonicalGradeKey('applicant', a.grade_applying_for), source: 'new', category: 'likely', name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`, id: a.applicant_id, statusLabel: 'Likely to Register', pisgah: a.student_group_applying_for === 1 }));
                    newContractPending.forEach(a => projectionRows.push({ gradeKey: getCanonicalGradeKey('applicant', a.grade_applying_for), source: 'new', category: 'contractpending', name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`, id: a.applicant_id, statusLabel: 'Contract Pending', pisgah: a.student_group_applying_for === 1 }));

                    // Re-enrollments → canonicalize next_grade (projected next year)
                    reRegistered.forEach(s => projectionRows.push({ gradeKey: getCanonicalGradeKey('reenrollment', s.next_grade), source: 're', category: 'registered', name: `${s.first_name} ${s.last_name}`, id: s.id, statusLabel: 'Re-Enrolled' }));
                    reLikely.forEach(s => projectionRows.push({ gradeKey: getCanonicalGradeKey('reenrollment', s.next_grade), source: 're', category: 'likely', name: `${s.first_name} ${s.last_name}`, id: s.id, statusLabel: ENROLLMENT_STATUS_LABELS[s.enrollment_status] || 'Likely' }));
                    reContractPending.forEach(s => projectionRows.push({ gradeKey: getCanonicalGradeKey('reenrollment', s.next_grade), source: 're', category: 'contractpending', name: `${s.first_name} ${s.last_name}`, id: s.id, statusLabel: ENROLLMENT_STATUS_LABELS[s.enrollment_status] || 'Pending' }));

                    // Apply grade overrides — change gradeKey only for actual
                    // grade moves. A Pisgah-only tag stores override_grade =
                    // original_grade as a marker, and must NOT re-bucket.
                    projectionRows.forEach(r => {
                      const override = gradeOverrides[String(r.id)];
                      if (override && override.override_grade !== override.original_grade) {
                        r.gradeKey = override.override_grade;
                      }
                    });

                    // Count overrides per grade (for indicator on table rows).
                    // Pisgah-only tags are not grade moves, so they don't count.
                    const overridesByGrade = new Map<string, number>();
                    projectionRows.forEach(r => {
                      const ov = gradeOverrides[String(r.id)];
                      if (ov && ov.override_grade !== ov.original_grade) {
                        overridesByGrade.set(r.gradeKey, (overridesByGrade.get(r.gradeKey) || 0) + 1);
                      }
                    });

                    // Group by canonical grade key (string)
                    const projGradeGroups = new Map<string, ProjectionRow[]>();
                    projectionRows.forEach(r => {
                      if (!projGradeGroups.has(r.gradeKey)) projGradeGroups.set(r.gradeKey, []);
                      projGradeGroups.get(r.gradeKey)!.push(r);
                    });
                    // Also ensure grades with only pending-review/waitlisted/leaving show up
                    const allGradeKeys = new Set(projGradeGroups.keys());
                    newPendingReview.forEach(a => allGradeKeys.add(getCanonicalGradeKey('applicant', a.grade_applying_for)));
                    newWaitlisted.forEach(a => allGradeKeys.add(getCanonicalGradeKey('applicant', a.grade_applying_for)));
                    notReEnrolling.forEach(s => allGradeKeys.add(getCanonicalGradeKey('reenrollment', s.next_grade)));
                    const projSortedGrades = [...allGradeKeys].sort((a, b) => {
                      const idxA = PROJECTION_GRADE_ORDER.indexOf(a);
                      const idxB = PROJECTION_GRADE_ORDER.indexOf(b);
                      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                    });

                    // Per-grade extra counts (not in projectionRows)
                    const pendingReviewByGrade = new Map<string, number>();
                    newPendingReview.forEach(a => {
                      const k = getCanonicalGradeKey('applicant', a.grade_applying_for);
                      pendingReviewByGrade.set(k, (pendingReviewByGrade.get(k) || 0) + 1);
                    });
                    const waitlistedByGrade = new Map<string, number>();
                    newWaitlisted.forEach(a => {
                      const k = getCanonicalGradeKey('applicant', a.grade_applying_for);
                      waitlistedByGrade.set(k, (waitlistedByGrade.get(k) || 0) + 1);
                    });
                    const leavingByGrade = new Map<string, number>();
                    notReEnrolling.forEach(s => {
                      const k = getCanonicalGradeKey('reenrollment', s.next_grade);
                      leavingByGrade.set(k, (leavingByGrade.get(k) || 0) + 1);
                    });

                    // School level registered counts
                    const registeredByGradeNum = (grades: number[]) => {
                      let count = 0;
                      grades.forEach(g => {
                        const label = ADMISSIONS_GRADE_LABELS[g];
                        if (label) {
                          const rows = projGradeGroups.get(label);
                          if (rows) count += rows.filter(r => r.category === 'registered').length;
                        }
                      });
                      return count;
                    };

                    return (
                      <>
                        {/* School level summary cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                          {([
                            { label: 'ELC', subtitle: 'Infant/Toddler – Kindergarten', count: registeredByGradeNum(ELC_GRADES), border: 'border-l-teal-400', grades: ELC_GRADES },
                            { label: 'Lower School', subtitle: '1st Grade – 5th Grade', count: registeredByGradeNum(LOWER_GRADES), border: 'border-l-blue-400', grades: LOWER_GRADES },
                            { label: 'Middle School', subtitle: '6th Grade – 8th Grade', count: registeredByGradeNum(MIDDLE_GRADES), border: 'border-l-purple-400', grades: MIDDLE_GRADES },
                          ] as const).map(card => (
                            <div
                              key={card.label}
                              onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'projection_category' && prev.label === card.label ? null : { type: 'projection_category', value: card.label === 'ELC' ? 10 : card.label === 'Lower School' ? 11 : 12, label: card.label })}
                              className={`bg-white rounded-xl border border-slate-200 border-l-4 ${card.border} shadow-sm px-5 py-4 cursor-pointer hover:shadow-md transition-shadow ${admissionsDrilldown?.type === 'projection_category' && admissionsDrilldown.label === card.label ? 'ring-2 ring-blue-400' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{card.label}</p>
                                  <p className="text-xs text-slate-400">{card.subtitle}</p>
                                </div>
                                <p className="text-2xl font-bold text-slate-700">{card.count}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Pipeline stat cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                          {([
                            { label: 'Registered', count: registeredCount, subtitle: 'Contracts signed / re-enrolled', border: 'border-t-green-500', num: 'text-green-700', categoryId: 1 },
                            { label: 'Registration Incomplete', count: incompleteCount, subtitle: 'Contract not yet complete', border: 'border-t-blue-500', num: 'text-blue-700', categoryId: 2 },
                            { label: 'Pipeline Total', count: pipelineTotal, subtitle: 'Active pipeline', border: 'border-t-slate-400', num: 'text-slate-700', categoryId: 0 },
                          ] as const).map(card => (
                            <div
                              key={card.label}
                              onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'projection_category' && prev.label === card.label ? null : { type: 'projection_category', value: card.categoryId, label: card.label })}
                              className={`bg-white rounded-xl border border-slate-200 border-t-4 ${card.border} shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow ${admissionsDrilldown?.type === 'projection_category' && admissionsDrilldown.label === card.label ? 'ring-2 ring-blue-400' : ''}`}
                            >
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{card.label}</p>
                              <p className={`text-3xl font-bold ${card.num}`}>{card.count}</p>
                              <p className="text-xs text-slate-400 mt-1">{card.subtitle}</p>
                            </div>
                          ))}
                        </div>

                        {/* Enrollment funnel bar */}
                        {pipelineTotal > 0 && (
                          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
                            <h3 className="font-semibold text-slate-900 mb-3">Enrollment Pipeline</h3>
                            <div className="h-8 rounded-full overflow-hidden flex bg-slate-100">
                              {([
                                { count: registeredCount, color: 'bg-green-500', label: 'Registered' },
                                { count: incompleteCount, color: 'bg-blue-500', label: 'Incomplete' },
                              ] as const).filter(s => s.count > 0).map(seg => {
                                const pct = (seg.count / pipelineTotal) * 100;
                                return (
                                  <div key={seg.label} className={`${seg.color} flex items-center justify-center text-xs font-semibold text-white transition-all`} style={{ width: `${pct}%` }} title={`${seg.label}: ${seg.count}`}>
                                    {pct >= 8 ? seg.count : ''}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-4 mt-3">
                              <p className="text-sm text-slate-600">
                                <span className="font-semibold text-green-700">{registeredCount}</span> of <span className="font-semibold">{pipelineTotal}</span> projected spots confirmed
                              </p>
                              <div className="flex gap-3 ml-auto">
                                {([
                                  { color: 'bg-green-500', label: 'Registered' },
                                  { color: 'bg-blue-500', label: 'Incomplete' },
                                ] as const).map(l => (
                                  <span key={l.label} className="flex items-center gap-1 text-xs text-slate-500">
                                    <span className={`w-2 h-2 rounded-full ${l.color}`} />
                                    {l.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* By Grade breakdown table */}
                        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
                          <h3 className="font-semibold text-slate-900 mb-4">By Grade</h3>
                          {projSortedGrades.length === 0 ? (
                            <p className="text-sm text-slate-400">No students in pipeline</p>
                          ) : (
                            <div className="overflow-visible">
                              <table className="w-full text-sm" style={{ overflow: 'visible' }}>
                                <thead style={{ overflow: 'visible' }}>
                                  {/* Super-header row: "FOR REFERENCE" label over informational columns */}
                                  <tr>
                                    <th colSpan={5} />
                                    <th colSpan={6} className="text-center pb-1 border-l border-slate-200">
                                      <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">For reference</span>
                                    </th>
                                  </tr>
                                  <tr className="border-b border-slate-200" style={{ overflow: 'visible' }}>
                                    <th className="text-left py-2 pr-4 font-medium text-slate-500">Grade</th>
                                    {([
                                      { label: 'Registered', tip: 'Enrollment contract signed and completed', cls: 'text-slate-500' },
                                      { label: 'Incomplete', tip: 'Enrollment contract not yet complete. Includes families who have started the contract, indicated intent, or have a contract pending signature.', cls: 'text-slate-500' },
                                    ] as const).map(col => (
                                      <th key={col.label} className={`text-center py-2 px-1.5 font-medium overflow-visible ${col.cls}`}>
                                        <span className="relative inline-block group cursor-help">
                                          {col.label}
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-800 text-white text-xs rounded px-2 py-1.5 leading-snug z-[9999] invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-normal text-center font-normal not-italic">
                                            {col.tip}
                                            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                                          </span>
                                        </span>
                                      </th>
                                    ))}
                                    <th className="text-center py-2 px-1.5 font-medium text-slate-900">Total</th>
                                    <th className="py-2 pl-3 font-medium text-slate-500 w-24">Progress</th>
                                    {([
                                      { label: 'Pisgah', tip: 'Applicants to the Pisgah program', cls: 'text-slate-400 italic' },
                                      { label: 'Pending', tip: 'Application received, awaiting admissions committee decision', cls: 'text-slate-400 italic' },
                                      { label: 'Waitlist', tip: 'New applicants placed on the waitlist by admissions', cls: 'text-slate-400 italic' },
                                      { label: 'Leaving', tip: 'Re-enrolling student whose family has indicated they are leaving', cls: 'text-slate-400 italic' },
                                      { label: '25-26', tip: 'Current enrollment headcount for the 2025-26 school year', cls: 'text-slate-400 italic' },
                                      { label: 'Budgeted', tip: 'Target enrollment count for 2026-27 school year', cls: 'text-slate-400 italic' },
                                    ] as const).map((col, idx) => (
                                      <th key={col.label} className={`text-center py-2 px-1.5 font-medium overflow-visible ${col.cls}${idx === 0 ? ' border-l border-slate-200' : ''}`}>
                                        <span className="relative inline-block group cursor-help">
                                          {col.label}
                                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-800 text-white text-xs rounded px-2 py-1.5 leading-snug z-[9999] invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-normal text-center font-normal not-italic">
                                            {col.tip}
                                            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                                          </span>
                                        </span>
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {projSortedGrades.map(gradeKey => {
                                    const rows = projGradeGroups.get(gradeKey) || [];
                                    const gRegistered = rows.filter(r => r.category === 'registered').length;
                                    const gIncomplete = rows.filter(r => r.category === 'inprocess' || r.category === 'likely' || r.category === 'contractpending').length;
                                    const gPisgah = rows.filter(r => r.pisgah || gradeOverrides[String(r.id)]?.is_pisgah).length;
                                    const gTotal = rows.length;
                                    const gPendingReview = pendingReviewByGrade.get(gradeKey) || 0;
                                    const gWaitlisted = waitlistedByGrade.get(gradeKey) || 0;
                                    const gLeaving = leavingByGrade.get(gradeKey) || 0;
                                    const gradeNum = GRADE_LABEL_TO_NEXT_NUMBER[gradeKey];
                                    const gLastYear = gradeNum != null ? (currentYearCounts[gradeNum] || 0) : 0;
                                    return (
                                      <tr
                                        key={gradeKey}
                                        onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'projection_combined' && prev.label === gradeKey ? null : { type: 'projection_combined', value: 0, label: gradeKey })}
                                        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${admissionsDrilldown?.type === 'projection_combined' && admissionsDrilldown.label === gradeKey ? 'bg-blue-50' : ''}`}
                                      >
                                        <td className="py-2.5 pr-4 font-medium text-slate-900">
                                          {gradeKey}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5">
                                          {gRegistered > 0 ? <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{gRegistered}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5">
                                          {gIncomplete > 0 ? <span onClick={(e) => { e.stopPropagation(); setAdmissionsDrilldown(prev => prev?.type === 'projection_incomplete' && prev.label === gradeKey ? null : { type: 'projection_incomplete', value: 0, label: gradeKey }); }} className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 cursor-pointer hover:opacity-80">{gIncomplete}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 font-bold text-slate-900">{gTotal}</td>
                                        <td className="py-2.5 pl-3">
                                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                                            {gRegistered > 0 && gTotal > 0 && <div className="bg-green-500 h-full" style={{ width: `${(gRegistered / gTotal) * 100}%` }} />}
                                            {gIncomplete > 0 && gTotal > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(gIncomplete / gTotal) * 100}%` }} />}
                                          </div>
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 border-l border-slate-200" style={{ opacity: 0.75 }}>
                                          {gPisgah > 0 ? <span onClick={(e) => { e.stopPropagation(); setAdmissionsDrilldown(prev => prev?.type === 'projection_pisgah' && prev.label === gradeKey ? null : { type: 'projection_pisgah', value: 0, label: gradeKey }); }} className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 cursor-pointer" style={{ opacity: 1 }} onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '1'; }} onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.75'; }}>{gPisgah}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {gPendingReview > 0 ? <span onClick={(e) => { e.stopPropagation(); setAdmissionsDrilldown(prev => prev?.type === 'projection_pending' && prev.label === gradeKey ? null : { type: 'projection_pending', value: 0, label: gradeKey }); }} className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 italic cursor-pointer" style={{ opacity: 1 }} onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '1'; }} onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.75'; }}>{gPendingReview}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {gWaitlisted > 0 ? <span onClick={(e) => { e.stopPropagation(); setAdmissionsDrilldown(prev => prev?.type === 'projection_waitlist' && prev.label === gradeKey ? null : { type: 'projection_waitlist', value: 0, label: gradeKey }); }} className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-pointer" style={{ opacity: 1 }} onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '1'; }} onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.75'; }}>{gWaitlisted}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {gLeaving > 0 ? <span onClick={(e) => { e.stopPropagation(); setAdmissionsDrilldown(prev => prev?.type === 'projection_leaving' && prev.label === gradeKey ? null : { type: 'projection_leaving', value: 0, label: gradeKey }); }} className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 cursor-pointer" style={{ opacity: 1 }} onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '1'; }} onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.opacity = '0.75'; }}>{gLeaving}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 text-xs text-slate-400" style={{ opacity: 0.75 }}>{gLastYear || '—'}</td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.85 }} onClick={(e) => e.stopPropagation()}>
                                          {budgetEditingGrade === gradeKey ? (
                                            <input
                                              type="number"
                                              autoFocus
                                              className="w-14 text-center text-xs border-b-2 border-blue-500 outline-none bg-transparent py-0.5"
                                              value={budgetEditValue}
                                              onChange={(e) => setBudgetEditValue(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveBudget(gradeKey, Number(budgetEditValue) || 0);
                                                if (e.key === 'Escape') setBudgetEditingGrade(null);
                                              }}
                                              onBlur={() => saveBudget(gradeKey, Number(budgetEditValue) || 0)}
                                            />
                                          ) : (() => {
                                            const budgeted = enrollmentBudget[gradeKey] || 0;
                                            const rows = projGradeGroups.get(gradeKey) || [];
                                            const gRegistered = rows.filter(r => r.category === 'registered').length;
                                            // Permission check pattern:
                                            // 1. Owners always have access
                                            // 2. Other users need: module enabled + sub-permission granted
                                            // 3. Use hasSubPermission(modules, moduleKey, subKey)
                                            // 4. Add new sub-permissions in SUB_PERMISSIONS on the permissions page
                                            const canEdit = role === 'owner' || hasSubPermission(allowedModules, 'admissions', 'edit_enrollment_budget');
                                            const gap = budgeted > 0 ? gRegistered - budgeted : null;
                                            return (
                                              <span
                                                className={`inline-flex items-center gap-1 ${canEdit ? 'cursor-pointer group' : ''} ${budgetSavedGrade === gradeKey ? 'text-green-600' : ''}`}
                                                onClick={() => {
                                                  if (!canEdit) return;
                                                  setBudgetEditingGrade(gradeKey);
                                                  setBudgetEditValue(String(budgeted || ''));
                                                }}
                                              >
                                                {budgeted > 0 ? (
                                                  <>
                                                    <span className="text-xs font-medium text-slate-500">{budgeted}</span>
                                                    {gap !== null && gap >= 0 && <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                                                    {gap !== null && gap < 0 && <span className="text-[10px] font-bold text-red-500">{gap}</span>}
                                                  </>
                                                ) : (
                                                  <span className="text-slate-300 group-hover:text-slate-400 transition-colors">
                                                    —
                                                    {canEdit && <svg className="w-3 h-3 inline ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>}
                                                  </span>
                                                )}
                                              </span>
                                            );
                                          })()}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  {(() => {
                                    let tRegistered = 0, tIncomplete = 0, tTotal = 0, tPisgah = 0, tPending = 0, tWaitlisted = 0, tLeaving = 0, tLastYear = 0, tBudgeted = 0;
                                    projSortedGrades.forEach(gradeKey => {
                                      const rows = projGradeGroups.get(gradeKey) || [];
                                      tRegistered += rows.filter(r => r.category === 'registered').length;
                                      tIncomplete += rows.filter(r => r.category === 'inprocess' || r.category === 'likely' || r.category === 'contractpending').length;
                                      tPisgah += rows.filter(r => r.pisgah || gradeOverrides[String(r.id)]?.is_pisgah).length;
                                      tTotal += rows.length;
                                      tPending += pendingReviewByGrade.get(gradeKey) || 0;
                                      tBudgeted += enrollmentBudget[gradeKey] || 0;
                                      tWaitlisted += waitlistedByGrade.get(gradeKey) || 0;
                                      tLeaving += leavingByGrade.get(gradeKey) || 0;
                                      const gradeNum = GRADE_LABEL_TO_NEXT_NUMBER[gradeKey];
                                      tLastYear += gradeNum != null ? (currentYearCounts[gradeNum] || 0) : 0;
                                    });
                                    return (
                                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                                        <td className="py-2.5 pr-4 text-slate-900">TOTAL</td>
                                        <td className="text-center py-2.5 px-1.5">
                                          {tRegistered > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{tRegistered}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5">
                                          {tIncomplete > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{tIncomplete}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 font-bold text-slate-900">{tTotal}</td>
                                        <td className="py-2.5 pl-3">
                                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                                            {tRegistered > 0 && tTotal > 0 && <div className="bg-green-500 h-full" style={{ width: `${(tRegistered / tTotal) * 100}%` }} />}
                                            {tIncomplete > 0 && tTotal > 0 && <div className="bg-blue-500 h-full" style={{ width: `${(tIncomplete / tTotal) * 100}%` }} />}
                                          </div>
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 border-l border-slate-200" style={{ opacity: 0.75 }}>
                                          {tPisgah > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{tPisgah}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {tPending > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{tPending}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {tWaitlisted > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{tWaitlisted}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5" style={{ opacity: 0.75 }}>
                                          {tLeaving > 0 ? <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">{tLeaving}</span> : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="text-center py-2.5 px-1.5 text-xs text-slate-400" style={{ opacity: 0.75 }}>{tLastYear || '—'}</td>
                                        <td className="text-center py-2.5 px-1.5 text-xs font-bold text-slate-500" style={{ opacity: 0.85 }}>{tBudgeted || '—'}</td>
                                      </tr>
                                    );
                                  })()}
                                </tfoot>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* Enrollment by City — collapsible donut chart + drilldown panel */}
                        {(() => {
                          const CITY_COLORS = ['#1B3A6B', '#E87722', '#00A5B5', '#7AB648', '#E91E8C', '#2B6CB0', '#D97706', '#6366f1', '#059669', '#dc2626', '#8b5cf6', '#0891b2', '#ca8a04', '#be185d', '#94a3b8'];

                          // Region grouping (region view). The map is keyed by a
                          // lowercased+trimmed city string; STATE_TO_REGION is a
                          // fallback when the city itself doesn't match — this
                          // catches the bulk of NJ/CT students whose city name
                          // (e.g. "Teaneck") isn't on the whitelist but whose
                          // state field is "NJ" or "New Jersey".
                          const CITY_TO_REGION: Record<string, string> = {
                            'yonkers': 'Yonkers & Bronx', 'bronx': 'Yonkers & Bronx', 'riverdale': 'Yonkers & Bronx',
                            'new rochelle': 'Westchester', 'white plains': 'Westchester', 'scarsdale': 'Westchester',
                            'tarrytown': 'Westchester', 'dobbs ferry': 'Westchester', 'tuckahoe': 'Westchester',
                            'harrison': 'Westchester', 'larchmont': 'Westchester', 'mamaroneck': 'Westchester',
                            'ardsley': 'Westchester', 'hastings': 'Westchester', 'hastings-on-hudson': 'Westchester',
                            'irvington': 'Westchester', 'pelham': 'Westchester', 'rye': 'Westchester',
                            'port chester': 'Westchester', 'mount vernon': 'Westchester', 'eastchester': 'Westchester',
                            'elmsford': 'Westchester', 'ossining': 'Westchester', 'sleepy hollow': 'Westchester',
                            'new york': 'Manhattan', 'manhattan': 'Manhattan', 'new york city': 'Manhattan',
                            // Queens — expanded
                            'queens': 'Queens', 'flushing': 'Queens', 'forest hills': 'Queens', 'jamaica': 'Queens',
                            'bayside': 'Queens', 'fresh meadows': 'Queens', 'kew gardens': 'Queens',
                            'hillcrest': 'Queens', 'rego park': 'Queens', 'corona': 'Queens', 'elmhurst': 'Queens',
                            'woodside': 'Queens', 'sunnyside': 'Queens', 'long island city': 'Queens',
                            'ozone park': 'Queens', 'richmond hill': 'Queens', 'springfield gardens': 'Queens',
                            // Great Neck variants
                            'great neck': 'Great Neck', 'great neck plaza': 'Great Neck', 'kings point': 'Great Neck',
                            // New Jersey cities (catches rows where the state field is missing)
                            'teaneck': 'New Jersey', 'englewood': 'New Jersey', 'hackensack': 'New Jersey',
                            'bergenfield': 'New Jersey', 'fair lawn': 'New Jersey', 'paramus': 'New Jersey',
                            'ridgewood': 'New Jersey', 'west orange': 'New Jersey', 'livingston': 'New Jersey',
                            'short hills': 'New Jersey', 'millburn': 'New Jersey', 'maplewood': 'New Jersey',
                            'west caldwell': 'New Jersey', 'caldwell': 'New Jersey',
                          };
                          const STATE_TO_REGION: Record<string, string> = {
                            'nj': 'New Jersey', 'new jersey': 'New Jersey',
                            'ct': 'Connecticut', 'connecticut': 'Connecticut',
                          };
                          const getRegion = (city: string | null, state: string | null): string => {
                            const c = (city || '').toLowerCase().trim();
                            const st = (state || '').toLowerCase().trim();
                            if (CITY_TO_REGION[c]) return CITY_TO_REGION[c];
                            if (STATE_TO_REGION[st]) return STATE_TO_REGION[st];
                            // Legacy fallback: in some rows, the "city" string is
                            // literally a state name. Keep this last so explicit
                            // city/state matches win.
                            if (STATE_TO_REGION[c]) return STATE_TO_REGION[c];
                            return 'Other';
                          };

                          type CityStudent = { id: number; name: string; gradeKey: string; source: 'new' | 're'; statusLabel: string; city: string; rawCity: string; state: string | null };
                          const cityStudents: CityStudent[] = [];

                          // Use same data sources as the by-grade table (projectionRows)
                          // Re-enrollment students (all valid statuses, same filter as by-grade)
                          reEnrollmentsData.filter(s => [2, 3, 4, 5, 6].includes(s.enrollment_status)).forEach(s => {
                            const rawCity = s.city || 'Unknown';
                            cityStudents.push({ id: s.id, name: `${s.first_name} ${s.last_name}`, gradeKey: getCanonicalGradeKey('reenrollment', s.next_grade), source: 're', statusLabel: ENROLLMENT_STATUS_LABELS[s.enrollment_status] || 'Enrolled', city: rawCity, rawCity, state: s.state });
                          });
                          // New applicants (accepted with response codes, same as by-grade)
                          const acceptedForCity = admissionsData.filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status) && [2, 4, 9, 1].includes(a.application_decision_response));
                          acceptedForCity.forEach(a => {
                            const rawCity = admissionsCities[a.applicant_id] || 'Unknown';
                            const state = admissionsStates[a.applicant_id] || null;
                            const name = applicantNames[a.applicant_id] || 'New Applicant';
                            cityStudents.push({ id: a.applicant_id, name, gradeKey: getCanonicalGradeKey('applicant', a.grade_applying_for), source: 'new', statusLabel: a.application_decision_response === 2 ? 'Registered' : 'In Process', city: rawCity, rawCity, state });
                          });

                          // Region view: rewrite each student's `city` to the
                          // mapped region label. Keeps cityGroups/donut/drilldown
                          // logic identical between city + region views. rawCity
                          // and state stay on the row so the diagnostic log can
                          // surface what fell into 'Other'.
                          if (geoView === 'region') {
                            cityStudents.forEach(s => { s.city = getRegion(s.rawCity, s.state); });
                            const otherSample = cityStudents.filter(s => s.city === 'Other').slice(0, 10);
                            if (otherSample.length > 0) {
                              console.log('[geography] Other bucket sample:', otherSample.map(s => ({ city: s.rawCity, state: s.state })));
                            }
                          }

                          const cityGroups = new Map<string, CityStudent[]>();
                          cityStudents.forEach(s => { if (!cityGroups.has(s.city)) cityGroups.set(s.city, []); cityGroups.get(s.city)!.push(s); });
                          const sortedCities = [...cityGroups.entries()].sort((a, b) => b[1].length - a[1].length);
                          const totalStudents = cityStudents.length;

                          // Build donut data — group small cities (<2%) into "Other".
                          // If the data already contains a literal "Other" key
                          // (region view, unmatched bucket), merge the sub-threshold
                          // aggregate into that same slice instead of producing two
                          // slices both labeled "Other".
                          const threshold = totalStudents * 0.02;
                          const mainCities: { name: string; value: number; color: string }[] = [];
                          let otherCount = 0;
                          sortedCities.forEach(([city, students], idx) => {
                            if (city === 'Other') {
                              otherCount += students.length;
                            } else if (students.length >= threshold && mainCities.length < CITY_COLORS.length - 1) {
                              mainCities.push({ name: city, value: students.length, color: CITY_COLORS[idx % CITY_COLORS.length] });
                            } else {
                              otherCount += students.length;
                            }
                          });
                          if (otherCount > 0) mainCities.push({ name: 'Other', value: otherCount, color: '#94a3b8' });

                          // Names in the donut that are real cityGroups entries.
                          // The "Other" slice is an aggregate (literal Other key +
                          // sub-threshold rows), so it needs a synthetic drilldown.
                          const mainCityNames = new Set(mainCities.map(d => d.name).filter(n => n !== 'Other'));
                          const otherDrilldownStudents = projectionCityDrilldown === 'Other'
                            ? cityStudents.filter(s => !mainCityNames.has(s.city))
                            : [];

                          // Drilldown data
                          const drilldownStudents = projectionCityDrilldown === 'Other'
                            ? otherDrilldownStudents
                            : projectionCityDrilldown ? (cityGroups.get(projectionCityDrilldown) || []) : [];
                          const drilldownGrades = new Map<string, number>();
                          drilldownStudents.forEach(s => drilldownGrades.set(s.gradeKey, (drilldownGrades.get(s.gradeKey) || 0) + 1));
                          const searchLower = projectionCitySearch.toLowerCase();
                          const filteredDrilldown = drilldownStudents
                            .filter(s => !projectionCityGradeFilter || s.gradeKey === projectionCityGradeFilter)
                            .filter(s => !searchLower || s.name.toLowerCase().includes(searchLower));

                          return (
                            <div className="bg-white rounded-xl border border-slate-200 mb-6">
                              <button
                                onClick={() => { setProjectionCityExpanded(prev => !prev); setProjectionCityDrilldown(null); setProjectionCityGradeFilter(null); setProjectionCitySearch(''); }}
                                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors rounded-xl"
                              >
                                <span className="font-semibold text-slate-900 text-sm">Enrollment by {geoView === 'region' ? 'Region' : 'City'}</span>
                                <div className="flex items-center gap-2">
                                  <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-medium">{sortedCities.length} {geoView === 'region' ? 'regions' : 'cities'}</span>
                                  <span className={`text-slate-400 transition-transform ${projectionCityExpanded ? 'rotate-180' : ''}`}>▼</span>
                                </div>
                              </button>
                              {projectionCityExpanded && (
                                <div className="border-t border-slate-100">
                                  {/* Toolbar: division toggle (multi-division only) + City/Region toggle */}
                                  <div className="flex items-center gap-3 px-5 pt-4 flex-wrap">
                                    {hasMultipleDivisions && (
                                      <select
                                        value={geoDivision}
                                        onChange={e => setGeoDivision(e.target.value as 'academy' | 'hs' | 'institutional')}
                                        className="rounded-lg px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                      >
                                        <option value="academy">Academy</option>
                                        <option value="hs">High School</option>
                                        <option value="institutional">Institutional</option>
                                      </select>
                                    )}
                                    <div className="inline-flex p-0.5 bg-slate-100 rounded-lg">
                                      {(['city', 'region'] as const).map(v => (
                                        <button
                                          key={v}
                                          onClick={() => setGeoView(v)}
                                          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                            geoView === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                          }`}
                                        >
                                          {v === 'city' ? 'City' : 'Region'}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {hasMultipleDivisions && geoDivision !== 'academy' ? (
                                    <div className="px-5 py-12 text-center">
                                      <p className="text-slate-500 text-sm">Coming soon — {geoDivision === 'hs' ? 'HS' : 'Institutional'} data will appear once HS admissions data is connected.</p>
                                    </div>
                                  ) : totalStudents === 0 ? (
                                    <p className="text-slate-400 text-sm text-center py-6">No {geoView === 'region' ? 'region' : 'city'} data available</p>
                                  ) : (
                                    <div className="flex flex-col lg:flex-row">
                                      {/* Donut chart + legend */}
                                      <div className={`p-5 ${projectionCityDrilldown ? 'lg:w-1/2' : 'w-full'} transition-all`}>
                                        <div className="flex flex-col md:flex-row items-center gap-6">
                                          <div className="w-[220px] h-[220px] flex-shrink-0">
                                            <ResponsiveContainer width="100%" height="100%">
                                              <PieChart>
                                                <Pie
                                                  data={mainCities}
                                                  cx="50%" cy="50%"
                                                  innerRadius={60} outerRadius={100}
                                                  dataKey="value"
                                                  stroke="#fff"
                                                  strokeWidth={2}
                                                  onClick={(entry: any) => {
                                                    if (!entry?.name) return;
                                                    setProjectionCityDrilldown(entry.name === projectionCityDrilldown ? null : entry.name);
                                                    setProjectionCityGradeFilter(null);
                                                    setProjectionCitySearch('');
                                                  }}
                                                  style={{ cursor: 'pointer' }}
                                                >
                                                  {mainCities.map((d, i) => <Cell key={i} fill={d.color} />)}
                                                </Pie>
                                                <Tooltip formatter={(value: any, name: any) => [`${value} (${Math.round((Number(value) / totalStudents) * 100)}%)`, name]} />
                                                <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="text-2xl font-bold" fill="#334155">{totalStudents}</text>
                                                <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="text-xs" fill="#94a3b8">students</text>
                                              </PieChart>
                                            </ResponsiveContainer>
                                          </div>
                                          {/* Legend */}
                                          <div className="flex-1 min-w-0">
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                              {mainCities.map(d => (
                                                <button
                                                  key={d.name}
                                                  onClick={() => { setProjectionCityDrilldown(prev => prev === d.name ? null : d.name); setProjectionCityGradeFilter(null); setProjectionCitySearch(''); }}
                                                  className={`flex items-center gap-2 text-left py-0.5 rounded transition-colors hover:bg-slate-50 cursor-pointer ${projectionCityDrilldown === d.name ? 'bg-blue-50' : ''}`}
                                                >
                                                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                                                  <span className="text-xs text-slate-700 truncate">{d.name}</span>
                                                  <span className="text-xs text-slate-400 ml-auto flex-shrink-0">{d.value}</span>
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Drilldown side panel */}
                                      {projectionCityDrilldown && (
                                        <div className="lg:w-1/2 border-t lg:border-t-0 lg:border-l border-slate-200 p-5 max-h-[500px] overflow-y-auto">
                                          <div className="flex items-center justify-between mb-3">
                                            <div>
                                              <h4 className="font-semibold text-slate-900">{projectionCityDrilldown}</h4>
                                              <p className="text-xs text-slate-500">{drilldownStudents.length} student{drilldownStudents.length !== 1 ? 's' : ''}</p>
                                            </div>
                                            <button onClick={() => { setProjectionCityDrilldown(null); setProjectionCitySearch(''); }} className="text-slate-400 hover:text-slate-600 p-1">
                                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                          </div>
                                          {/* Search */}
                                          <input
                                            type="text"
                                            placeholder="Search by name..."
                                            value={projectionCitySearch}
                                            onChange={e => setProjectionCitySearch(e.target.value)}
                                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mb-3 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                          />
                                          {/* Grade filter pills */}
                                          <div className="flex flex-wrap gap-1.5 mb-3">
                                            <button onClick={() => setProjectionCityGradeFilter(null)} className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${!projectionCityGradeFilter ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>All</button>
                                            {[...drilldownGrades.entries()].sort((a, b) => { const idxA = PROJECTION_GRADE_ORDER.indexOf(a[0]); const idxB = PROJECTION_GRADE_ORDER.indexOf(b[0]); return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB); }).map(([grade, count]) => (
                                              <button key={grade} onClick={() => setProjectionCityGradeFilter(projectionCityGradeFilter === grade ? null : grade)} className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${projectionCityGradeFilter === grade ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{grade} ({count})</button>
                                            ))}
                                          </div>
                                          {/* Student cards */}
                                          <div className="space-y-1.5">
                                            {filteredDrilldown.map(s => {
                                              // Resolve name dynamically for new applicants
                                              const displayName = s.source === 'new'
                                                ? (applicantNames[s.id] || (applicantNamesLoading ? null : s.name))
                                                : s.name;
                                              return (
                                                <div key={`${s.source}-${s.id}`} className="flex items-center gap-2 py-2 px-2.5 rounded-lg hover:bg-slate-50 border border-slate-100">
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${s.id}/273-general`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-slate-800 hover:text-blue-600 transition-colors truncate">
                                                        {displayName || <span className="inline-block h-4 w-28 bg-slate-200 rounded animate-pulse align-middle" />}
                                                      </a>
                                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${s.id}/273-general`} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-500 transition-colors flex-shrink-0" title="Open in Veracross">
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3" /></svg>
                                                      </a>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                      <span className="text-xs text-slate-400">{s.gradeKey}</span>
                                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.source === 'new' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{s.source === 'new' ? 'New Student' : 'Returning'}</span>
                                                      <span className="text-[10px] text-slate-400">{s.statusLabel}</span>
                                                    </div>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                            {filteredDrilldown.length === 0 && <p className="text-slate-400 text-sm text-center py-4">No matches</p>}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Section 4 — Declined new families (collapsed by default) */}
                        {newDeclined.length > 0 && (
                          <div className="bg-white rounded-xl border border-slate-200 mb-4">
                            <button
                              onClick={() => setProjectionDeclinedExpanded(prev => !prev)}
                              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors rounded-xl"
                            >
                              <span className="text-sm font-medium text-slate-600">{newDeclined.length} famil{newDeclined.length === 1 ? 'y' : 'ies'} declined offer</span>
                              <span className={`text-slate-400 transition-transform ${projectionDeclinedExpanded ? 'rotate-180' : ''}`}>▼</span>
                            </button>
                            {projectionDeclinedExpanded && (
                              <div className="px-5 pb-4 space-y-2">
                                {[...newDeclined].sort((a, b) => {
                                  const gradeA = PROJECTION_GRADE_ORDER.indexOf(ADMISSIONS_GRADE_LABELS[a.grade_applying_for] || '');
                                  const gradeB = PROJECTION_GRADE_ORDER.indexOf(ADMISSIONS_GRADE_LABELS[b.grade_applying_for] || '');
                                  if (gradeA !== gradeB) return (gradeA === -1 ? 999 : gradeA) - (gradeB === -1 ? 999 : gradeB);
                                  const nameA = applicantNames[a.applicant_id] || '';
                                  const nameB = applicantNames[b.applicant_id] || '';
                                  const lastA = nameA.split(' ').slice(1).join(' ') || nameA;
                                  const lastB = nameB.split(' ').slice(1).join(' ') || nameB;
                                  return lastA.localeCompare(lastB) || nameA.localeCompare(nameB);
                                }).map(a => (
                                  <div key={a.application_id} className="border border-slate-200 rounded-lg px-4 py-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-900">
                                          {applicantNames[a.applicant_id] || (applicantNamesLoading ? <span className="inline-block h-4 w-28 bg-slate-200 rounded animate-pulse align-middle" /> : `Applicant #${a.applicant_id}`)}
                                        </span>
                                        <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${a.applicant_id}/273-general`} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                        </a>
                                      </div>
                                      {a.application_decision_response_date && (
                                        <span className="text-xs text-slate-400">{format(parseISO(a.application_decision_response_date), 'MMM d, yyyy')}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-500">{ADMISSIONS_GRADE_LABELS[a.grade_applying_for] || `Grade ${a.grade_applying_for}`}</span>
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Declined</span>
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">New Student</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Section 5 — Not re-enrolling (collapsed by default) */}
                        {notReEnrolling.length > 0 && (
                          <div className="bg-white rounded-xl border border-slate-200">
                            <button
                              onClick={() => setProjectionNotReEnrollingExpanded(prev => !prev)}
                              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors rounded-xl"
                            >
                              <span className="text-sm font-medium text-slate-600">{notReEnrolling.length} student{notReEnrolling.length !== 1 ? 's' : ''} not re-enrolling</span>
                              <span className={`text-slate-400 transition-transform ${projectionNotReEnrollingExpanded ? 'rotate-180' : ''}`}>▼</span>
                            </button>
                            {projectionNotReEnrollingExpanded && (
                              <div className="px-5 pb-4 space-y-2">
                                {[...notReEnrolling].sort((a, b) => {
                                  const gradeA = PROJECTION_GRADE_ORDER.indexOf(ADMISSIONS_GRADE_LABELS[a.next_grade] || '');
                                  const gradeB = PROJECTION_GRADE_ORDER.indexOf(ADMISSIONS_GRADE_LABELS[b.next_grade] || '');
                                  if (gradeA !== gradeB) return (gradeA === -1 ? 999 : gradeA) - (gradeB === -1 ? 999 : gradeB);
                                  return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
                                }).map(s => (
                                  <div key={s.id} className="border border-slate-200 rounded-lg px-4 py-3">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-900">{s.first_name} {s.last_name}</span>
                                        <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${s.id}/273-general`} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                        </a>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-slate-500">{ADMISSIONS_GRADE_LABELS[s.grade_level] || `Grade ${s.grade_level}`} → {ADMISSIONS_GRADE_LABELS[s.next_grade] || `Grade ${s.next_grade}`}</span>
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Not Re-Enrolling</span>
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Re-Enrollment</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {admissionsTab === 'enrollment' && (() => {
                    // Enrollment: families actively enrolling (Enrollment Complete=2, Accepted Offer=4, Considering Offer=9)
                    const enrolling = admissionsData.filter(a => [2, 4, 9].includes(a.application_decision_response));

                    const gradeGroups = new Map<number, AdmissionApplication[]>();
                    enrolling.forEach(a => {
                      const grade = a.grade_applying_for;
                      if (!gradeGroups.has(grade)) gradeGroups.set(grade, []);
                      gradeGroups.get(grade)!.push(a);
                    });
                    const sortedGrades = [...gradeGroups.keys()].sort((a, b) => {
                      const idxA = ADMISSIONS_GRADE_SORT.indexOf(a);
                      const idxB = ADMISSIONS_GRADE_SORT.indexOf(b);
                      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                    });

                    return (
                      <>
                        {/* Summary pills: confirmed + pending */}
                        <div className="flex items-center gap-3 mb-6 flex-wrap">
                          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-sm font-semibold text-green-700">{enrolling.filter(a => a.application_decision_response === 2).length}</span>
                            <span className="text-sm text-green-600">confirmed</span>
                          </div>
                          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-sm font-semibold text-blue-700">{enrolling.filter(a => [4, 9].includes(a.application_decision_response)).length}</span>
                            <span className="text-sm text-blue-600">pending</span>
                          </div>
                        </div>

                        {/* Grade rows */}
                        <div className="space-y-3">
                          {sortedGrades.length === 0 ? (
                            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                              <p className="text-sm text-slate-400">No students currently enrolling</p>
                            </div>
                          ) : sortedGrades.map(grade => {
                            const apps = gradeGroups.get(grade)!;
                            const enrollmentComplete = apps.filter(a => a.application_decision_response === 2).length;
                            const acceptedOffer = apps.filter(a => a.application_decision_response === 4).length;
                            const consideringOffer = apps.filter(a => a.application_decision_response === 9).length;
                            const gradeLabel = ADMISSIONS_GRADE_LABELS[grade] || `Grade ${grade}`;
                            return (
                              <button
                                key={grade}
                                onClick={() => setAdmissionsDrilldown(prev => prev?.type === 'grade' && prev.value === grade ? null : { type: 'grade', value: grade, label: gradeLabel })}
                                className={`bg-white rounded-xl border border-slate-200 px-5 py-4 w-full text-left hover:bg-slate-50 transition-colors ${admissionsDrilldown?.type === 'grade' && admissionsDrilldown.value === grade ? 'ring-2 ring-blue-400' : ''}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-slate-900">{gradeLabel}</span>
                                    <span className="text-sm font-medium text-slate-500">{apps.length} student{apps.length !== 1 ? 's' : ''}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {enrollmentComplete > 0 && (
                                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                                        {enrollmentComplete} Enrolled
                                      </span>
                                    )}
                                    {acceptedOffer > 0 && (
                                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">
                                        {acceptedOffer} Accepted
                                      </span>
                                    )}
                                    {consideringOffer > 0 && (
                                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-teal-100 text-teal-700">
                                        {consideringOffer} Considering
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}

                </>
              ) : (
                <div className="text-center py-20 text-slate-400">
                  <p>Failed to load admissions data</p>
                  <button onClick={() => fetchAdmissions()} className="mt-2 text-blue-600 hover:underline text-sm">Try again</button>
                </div>
              )}

              {/* Drilldown slide-in panel */}
              {admissionsDrilldown && admissionsData && (() => {
                // For projection_category (stat card click) or projection_combined (grade row click), build a unified list
                // Leaving drilldown — show only leaving students for a grade
                if (admissionsDrilldown.type === 'projection_leaving') {
                  const gradeLabel = admissionsDrilldown.label;
                  const leavingStudents = reEnrollmentsData
                    .filter(s => s.enrollment_status === 8)
                    .filter(s => getCanonicalGradeKey('reenrollment', s.next_grade) === gradeLabel)
                    .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{gradeLabel} – Leaving</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{leavingStudents.length} student{leavingStudents.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {leavingStudents.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">No leaving students</p></div>
                          ) : (
                            <div className="space-y-2">
                              {leavingStudents.map(s => {
                                const fullName = `${s.first_name} ${s.last_name}`;
                                const annotationsName = `Admissions: ${fullName}`;
                                const annotationsId = `admissions-${String(s.id)}`;
                                const studentKey = `re-${s.id}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                <div
                                  key={s.id}
                                  className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                  onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{fullName}</span>
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${s.id}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    </div>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Not Re-Enrolling</span>
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Returning</span>
                                  </div>
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                      <DonorAnnotations
                                        constituentName={annotationsName}
                                        constituentId={annotationsId}
                                        tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                        onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                        tagDefs={ADMISSIONS_TAG_DEFS}
                                      />
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Pending Review drilldown — show applicants with application_status === 1 for a grade
                if (admissionsDrilldown.type === 'projection_pending') {
                  const gradeLabel = admissionsDrilldown.label;
                  const pendingApplicants = admissionsData
                    .filter(a => a.application_status === 1)
                    .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === gradeLabel)
                    .sort((a, b) => {
                      const nameA = applicantNames[a.applicant_id] || '';
                      const nameB = applicantNames[b.applicant_id] || '';
                      const lastA = nameA.split(' ').slice(1).join(' ') || nameA;
                      const lastB = nameB.split(' ').slice(1).join(' ') || nameB;
                      return lastA.localeCompare(lastB);
                    });

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{gradeLabel} – Pending Review</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{pendingApplicants.length} applicant{pendingApplicants.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {pendingApplicants.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">No pending applicants</p></div>
                          ) : (
                            <div className="space-y-2">
                              {pendingApplicants.map(a => {
                                const fullName = applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`;
                                const annotationsName = `Admissions: ${fullName}`;
                                const annotationsId = `admissions-${String(a.applicant_id)}`;
                                const studentKey = `new-${a.applicant_id}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                <div
                                  key={a.application_id}
                                  className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                  onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{fullName}</span>
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${a.applicant_id}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    </div>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 italic">Pending Review</span>
                                    <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">New Student</span>
                                  </div>
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                      <DonorAnnotations
                                        constituentName={annotationsName}
                                        constituentId={annotationsId}
                                        tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                        onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                        tagDefs={ADMISSIONS_TAG_DEFS}
                                      />
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Waitlist drilldown — show applicants with waitlisted status for a grade
                if (admissionsDrilldown.type === 'projection_waitlist') {
                  const gradeLabel = admissionsDrilldown.label;
                  const waitlistApplicants = admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Waitlisted.includes(a.application_status))
                    .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === gradeLabel)
                    .sort((a, b) => {
                      const nameA = applicantNames[a.applicant_id] || '';
                      const nameB = applicantNames[b.applicant_id] || '';
                      const lastA = nameA.split(' ').slice(1).join(' ') || nameA;
                      const lastB = nameB.split(' ').slice(1).join(' ') || nameB;
                      return lastA.localeCompare(lastB);
                    });

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{gradeLabel} – Waitlist</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{waitlistApplicants.length} applicant{waitlistApplicants.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {waitlistApplicants.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">No waitlisted applicants</p></div>
                          ) : (
                            <div className="space-y-2">
                              {waitlistApplicants.map(a => {
                                const statusLabel = APPLICATION_STATUS_DETAIL_LABELS[a.application_status] || `Status ${a.application_status}`;
                                const fullName = applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`;
                                const annotationsName = `Admissions: ${fullName}`;
                                const annotationsId = `admissions-${String(a.applicant_id)}`;
                                const studentKey = `new-${a.applicant_id}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                  <div
                                    key={a.application_id}
                                    className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                    onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-900">{fullName}</span>
                                        <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${a.applicant_id}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                        </a>
                                      </div>
                                      <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{statusLabel}</span>
                                      <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">New Student</span>
                                    </div>
                                    {isExpanded && (
                                      <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                        <DonorAnnotations
                                          constituentName={annotationsName}
                                          constituentId={annotationsId}
                                          tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                          onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                          tagDefs={ADMISSIONS_TAG_DEFS}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Pisgah drilldown — match projection-row logic: include both
                // new applicants (Veracross-side Pisgah via student_group_applying_for === 1
                // OR a manual gradeOverrides[id].is_pisgah toggle) and re-enrollments
                // (manual toggle only — re-enrollment data has no Veracross Pisgah field).
                // Effective grade respects the Pisgah-only-doesn't-rebucket rule.
                if (admissionsDrilldown.type === 'projection_pisgah') {
                  const gradeLabel = admissionsDrilldown.label;
                  const NEW_STATUS_LABELS: Record<number, string> = { 2: 'Registered', 4: 'In Process', 9: 'Likely to Register', 1: 'Contract Pending' };
                  const RE_PROJECTION_STATUSES = [5, 3, 6, 2, 4];

                  const effectiveGradeFor = (id: number, defaultGrade: string) => {
                    const ov = gradeOverrides[String(id)];
                    if (ov && ov.override_grade !== ov.original_grade) return ov.override_grade;
                    return defaultGrade;
                  };

                  type Row = { key: string; name: string; source: 'new' | 're'; statusLabel: string; personId: number };
                  const rows: Row[] = [];

                  // New applicants — projection statuses only
                  admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
                    .filter(a => [2, 4, 9, 1].includes(a.application_decision_response))
                    .forEach(a => {
                      const origGrade = getCanonicalGradeKey('applicant', a.grade_applying_for);
                      const grade = effectiveGradeFor(a.applicant_id, origGrade);
                      if (grade !== gradeLabel) return;
                      const isPisgah =
                        a.student_group_applying_for === 1 ||
                        gradeOverrides[String(a.applicant_id)]?.is_pisgah === true;
                      if (!isPisgah) return;
                      rows.push({
                        key: `new-${a.applicant_id}`,
                        name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`,
                        source: 'new',
                        statusLabel: NEW_STATUS_LABELS[a.application_decision_response] || 'Accepted',
                        personId: a.applicant_id,
                      });
                    });

                  // Re-enrollments — projection statuses only, Pisgah via override
                  reEnrollmentsData
                    .filter(s => RE_PROJECTION_STATUSES.includes(s.enrollment_status))
                    .forEach(s => {
                      const origGrade = getCanonicalGradeKey('reenrollment', s.next_grade);
                      const grade = effectiveGradeFor(s.id, origGrade);
                      if (grade !== gradeLabel) return;
                      const isPisgah = gradeOverrides[String(s.id)]?.is_pisgah === true;
                      if (!isPisgah) return;
                      rows.push({
                        key: `re-${s.id}`,
                        name: `${s.first_name} ${s.last_name}`,
                        source: 're',
                        statusLabel: ENROLLMENT_STATUS_LABELS[s.enrollment_status] || 'Re-Enrolling',
                        personId: s.id,
                      });
                    });

                  rows.sort((a, b) => {
                    const lastA = a.name.split(' ').slice(1).join(' ') || a.name;
                    const lastB = b.name.split(' ').slice(1).join(' ') || b.name;
                    return lastA.localeCompare(lastB);
                  });

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{gradeLabel} – Pisgah</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{rows.length} student{rows.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {rows.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">No Pisgah students</p></div>
                          ) : (
                            <div className="space-y-2">
                              {rows.map(r => {
                                const annotationsName = `Admissions: ${r.name}`;
                                const annotationsId = `admissions-${String(r.personId)}`;
                                const studentKey = `${r.source}-${r.personId}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                <div
                                  key={r.key}
                                  className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                  onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{r.name}</span>
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${r.personId}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    </div>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Pisgah</span>
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{r.statusLabel}</span>
                                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${r.source === 'new' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{r.source === 'new' ? 'New Student' : 'Returning'}</span>
                                  </div>
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                      <DonorAnnotations
                                        constituentName={annotationsName}
                                        constituentId={annotationsId}
                                        tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                        onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                        tagDefs={ADMISSIONS_TAG_DEFS}
                                      />
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Incomplete drilldown — show both new applicants (response 4,9,1) and re-enrollments (status 2,3,4,6) for a grade
                if (admissionsDrilldown.type === 'projection_incomplete') {
                  const gradeLabel = admissionsDrilldown.label;

                  // New applicants with incomplete enrollment
                  const newIncomplete = admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
                    .filter(a => [4, 9, 1].includes(a.application_decision_response))
                    .filter(a => getCanonicalGradeKey('applicant', a.grade_applying_for) === gradeLabel)
                    .map(a => ({
                      key: `new-${a.applicant_id}`,
                      name: applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`,
                      source: 'new' as const,
                      statusLabel: a.application_decision_response === 4 ? 'In Process' : a.application_decision_response === 9 ? 'Likely to Register' : 'Contract Pending',
                      personId: a.applicant_id,
                    }));

                  // Re-enrollments with incomplete status
                  const reIncomplete = reEnrollmentsData
                    .filter(s => [2, 3, 4, 6].includes(s.enrollment_status))
                    .filter(s => getCanonicalGradeKey('reenrollment', s.next_grade) === gradeLabel)
                    .map(s => ({
                      key: `re-${s.id}`,
                      name: `${s.first_name} ${s.last_name}`,
                      source: 're' as const,
                      statusLabel: s.enrollment_status === 2 ? 'Pending Re-Enrollment' : s.enrollment_status === 3 || s.enrollment_status === 6 ? 'Likely to Re-Enroll' : 'On Hold',
                      personId: s.id,
                    }));

                  const allIncomplete = [...newIncomplete, ...reIncomplete].sort((a, b) => a.name.localeCompare(b.name));

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{gradeLabel} – Registration Incomplete</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{allIncomplete.length} student{allIncomplete.length !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {allIncomplete.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">No incomplete registrations</p></div>
                          ) : (
                            <div className="space-y-2">
                              {allIncomplete.map(row => {
                                const annotationsName = `Admissions: ${row.name}`;
                                const annotationsId = `admissions-${String(row.personId)}`;
                                const studentKey = `${row.source}-${row.personId}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                <div
                                  key={row.key}
                                  className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                  onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{row.name}</span>
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${row.personId}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    </div>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{row.statusLabel}</span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${row.source === 'new' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{row.source === 'new' ? 'New Student' : 'Returning'}</span>
                                  </div>
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                      <DonorAnnotations
                                        constituentName={annotationsName}
                                        constituentId={annotationsId}
                                        tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                        onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                        tagDefs={ADMISSIONS_TAG_DEFS}
                                      />
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                if (admissionsDrilldown.type === 'projection_category' || admissionsDrilldown.type === 'projection_combined') {
                  type CombinedRow = { key: string; firstName: string; lastName: string; name: string; source: 'new' | 're'; statusLabel: string; statusColor: string; personId: number; };
                  const combinedRows: CombinedRow[] = [];

                  const getNewStatusInfo = (response: number): { label: string; color: string } => {
                    if (response === 2) return { label: 'Enrollment Complete', color: 'bg-green-100 text-green-700' };
                    if (response === 4) return { label: 'Accepted Offer', color: 'bg-blue-100 text-blue-700' };
                    if (response === 9) return { label: 'Considering Offer', color: 'bg-amber-100 text-amber-700' };
                    if (response === 1) return { label: 'Pending', color: 'bg-slate-100 text-slate-600' };
                    return { label: 'Unknown', color: 'bg-slate-100 text-slate-600' };
                  };
                  const getReStatusInfo = (status: number): { label: string; color: string } => {
                    if (status === 5) return { label: 'Re-Enrolled', color: 'bg-green-100 text-green-700' };
                    if ([3, 6].includes(status)) return { label: ENROLLMENT_STATUS_LABELS[status] || 'Considering', color: 'bg-amber-100 text-amber-700' };
                    if ([2, 4].includes(status)) return { label: ENROLLMENT_STATUS_LABELS[status] || 'Pending', color: 'bg-slate-100 text-slate-600' };
                    return { label: ENROLLMENT_STATUS_LABELS[status] || 'Unknown', color: 'bg-slate-100 text-slate-600' };
                  };

                  // Category filter for stat card drilldown
                  // 0=pipeline total, 1=registered, 2=in process, 3=likely
                  // 10=ELC, 11=Lower School, 12=Middle School (school-level cards)
                  const isCategory = admissionsDrilldown.type === 'projection_category';
                  const catId = admissionsDrilldown.value;
                  const isSchoolLevel = isCategory && catId >= 10;
                  const schoolGrades = catId === 10 ? ELC_GRADES : catId === 11 ? LOWER_GRADES : catId === 12 ? MIDDLE_GRADES : [];
                  const schoolGradeLabels = schoolGrades.map(g => ADMISSIONS_GRADE_LABELS[g]).filter(Boolean);
                  // Decision response codes per category
                  // catId: 0=pipeline total, 1=registered, 2=registration incomplete, 10/11/12=school level
                  const newResponseCodes = isCategory
                    ? (isSchoolLevel || catId === 0 ? [2, 4, 9, 1] : catId === 1 ? [2] : catId === 2 ? [4, 9, 1] : [])
                    : [2, 4, 9, 1];
                  // Enrollment status codes per category
                  const reStatusCodes = isCategory
                    ? (isSchoolLevel || catId === 0 ? [2, 3, 4, 5, 6] : catId === 1 ? [5] : catId === 2 ? [2, 3, 4, 6] : [])
                    : [2, 3, 4, 5, 6];

                  // Grade filter for school-level or grade-specific drilldowns
                  const gradeFilter = (gradeLabel: string) => {
                    if (isSchoolLevel) return schoolGradeLabels.includes(gradeLabel);
                    if (isCategory) return true; // pipeline/category cards show all grades
                    return gradeLabel === admissionsDrilldown.label;
                  };

                  // Helper: get effective grade (with override applied).
                  // A Pisgah-only override stores override_grade === original_grade
                  // as a flag carrier and must not change the bucket.
                  const effectiveGrade = (source: 'new' | 're', id: number, defaultGrade: string) => {
                    const ov = gradeOverrides[String(id)];
                    if (ov && ov.override_grade !== ov.original_grade) return ov.override_grade;
                    return defaultGrade;
                  };

                  // New applicants
                  admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
                    .filter(a => newResponseCodes.includes(a.application_decision_response))
                    .filter(a => gradeFilter(effectiveGrade('new', a.applicant_id, getCanonicalGradeKey('applicant', a.grade_applying_for))))
                    .forEach(a => {
                      const info = getNewStatusInfo(a.application_decision_response);
                      const fullName = applicantNames[a.applicant_id] || '';
                      const parts = fullName.split(' ');
                      const firstName = parts[0] || `Applicant`;
                      const lastName = parts.slice(1).join(' ') || `#${a.applicant_id}`;
                      combinedRows.push({ key: `new-${a.application_id}`, firstName, lastName, name: fullName || `Applicant #${a.applicant_id}`, source: 'new', statusLabel: info.label, statusColor: info.color, personId: a.applicant_id });
                    });

                  // Re-enrollments
                  reEnrollmentsData
                    .filter(s => reStatusCodes.includes(s.enrollment_status))
                    .filter(s => gradeFilter(effectiveGrade('re', s.id, getCanonicalGradeKey('reenrollment', s.next_grade))))
                    .forEach(s => {
                      const info = getReStatusInfo(s.enrollment_status);
                      combinedRows.push({ key: `re-${s.id}`, firstName: s.first_name, lastName: s.last_name, name: `${s.first_name} ${s.last_name}`, source: 're', statusLabel: info.label, statusColor: info.color, personId: s.id });
                    });

                  // Sort alphabetically by last name, then first name
                  combinedRows.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

                  const newCount = combinedRows.filter(r => r.source === 'new').length;
                  const reCount = combinedRows.filter(r => r.source === 're').length;
                  const totalCount = combinedRows.length;

                  // Apply source filter
                  const sourceFiltered = admissionsDrilldownFilter === 'all' ? combinedRows
                    : admissionsDrilldownFilter === 'new' ? combinedRows.filter(r => r.source === 'new')
                    : combinedRows.filter(r => r.source === 're');

                  // Apply search filter
                  const searchLower = admissionsDrilldownSearch.toLowerCase();
                  const displayRows = searchLower
                    ? sourceFiltered.filter(r => r.firstName.toLowerCase().includes(searchLower) || r.lastName.toLowerCase().includes(searchLower))
                    : sourceFiltered;

                  return (
                    <>
                      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                        <div className="px-6 py-5 border-b border-slate-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{admissionsDrilldown.label}</h3>
                              <p className="text-sm text-slate-500 mt-0.5">{totalCount} student{totalCount !== 1 ? 's' : ''}</p>
                            </div>
                            <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                          {/* Search */}
                          <div className="relative mt-3">
                            <input
                              type="text"
                              placeholder="Search by name..."
                              value={admissionsDrilldownSearch}
                              onChange={e => setAdmissionsDrilldownSearch(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
                            />
                            {admissionsDrilldownSearch && (
                              <button onClick={() => setAdmissionsDrilldownSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">×</button>
                            )}
                          </div>
                          {/* Filter pills */}
                          <div className="flex gap-1.5 mt-3">
                            {([
                              { key: 'all' as const, label: 'All' },
                              { key: 'new' as const, label: `New Families (${newCount})` },
                              { key: 're' as const, label: `Returning (${reCount})` },
                            ]).map(f => (
                              <button
                                key={f.key}
                                onClick={() => setAdmissionsDrilldownFilter(f.key)}
                                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${admissionsDrilldownFilter === f.key ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                          {applicantNamesLoading && (
                            <div className="flex items-center gap-2 mb-4 text-sm text-slate-400">
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Loading names...
                            </div>
                          )}
                          {displayRows.length === 0 ? (
                            <div className="text-center py-12 text-slate-400"><p className="text-sm">{totalCount === 0 ? 'No students for this grade' : 'No matching results'}</p></div>
                          ) : (
                            <div className="space-y-2">
                              {displayRows.map(r => {
                                // Per-student annotations namespace — same donor_notes /
                                // donor_tags tables, prefixed key so they stay separate
                                // from real donor annotations.
                                const annotationsName = `Admissions: ${r.name}`;
                                const annotationsId = `admissions-${String(r.personId)}`;
                                const studentKey = `${r.source}-${r.personId}`;
                                const isExpanded = expandedAdmissionsStudent === studentKey;
                                return (
                                <div
                                  key={r.key}
                                  className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                  onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-slate-900">{r.name}</span>
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${r.personId}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    </div>
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.source === 'new' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                      {r.source === 'new' ? 'New Student' : 'Returning'}
                                    </span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.statusColor}`}>{r.statusLabel}</span>
                                    {gradeOverrides[String(r.personId)] &&
                                      gradeOverrides[String(r.personId)].override_grade !== gradeOverrides[String(r.personId)].original_grade && (
                                      <>
                                        <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                          </svg>
                                          Grade manually edited
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                                          Moved from {gradeOverrides[String(r.personId)].original_grade}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  {/* Grade override + Pisgah toggle — for users with edit_enrollment_data permission */}
                                  {(role === 'owner' || hasSubPermission(allowedModules, 'admissions', 'edit_enrollment_data')) && (() => {
                                    const isPisgah = gradeOverrides[String(r.personId)]?.is_pisgah || false;
                                    return (
                                      <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                        {/* Grade override */}
                                        {overrideDropdownId === `${r.source}-${r.personId}` ? (
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <select
                                              autoFocus
                                              className="text-xs border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                              defaultValue=""
                                              onChange={(e) => {
                                                if (e.target.value) {
                                                  const origGrade = gradeOverrides[String(r.personId)]?.original_grade || admissionsDrilldown.label;
                                                  saveGradeOverride(r.personId, r.name, origGrade, e.target.value);
                                                }
                                              }}
                                              onBlur={() => setOverrideDropdownId(null)}
                                            >
                                              <option value="">Move to grade...</option>
                                              {PROJECTION_GRADE_ORDER.map(g => (
                                                <option key={g} value={g}>{g}</option>
                                              ))}
                                            </select>
                                            {gradeOverrides[String(r.personId)] && (
                                              <button
                                                onMouseDown={(e) => { e.preventDefault(); removeGradeOverride(r.personId); }}
                                                className="text-[10px] text-red-500 hover:text-red-700"
                                              >
                                                Revert
                                              </button>
                                            )}
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => setOverrideDropdownId(`${r.source}-${r.personId}`)}
                                            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-0.5"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            {gradeOverrides[String(r.personId)] ? 'Change grade' : 'Move to grade'}
                                          </button>
                                        )}
                                        {/* Pisgah toggle */}
                                        <button
                                          onClick={() => togglePisgah(r.personId, r.name, gradeOverrides[String(r.personId)]?.original_grade || admissionsDrilldown.label, isPisgah)}
                                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors flex items-center gap-0.5 ${
                                            isPisgah
                                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                              : 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-600'
                                          }`}
                                        >
                                          Pisgah
                                          {isPisgah && <span className="ml-0.5">×</span>}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                  {/* Per-student notes + tags — same DonorAnnotations
                                      panel as Guardian Circle, namespaced via the
                                      "Admissions: " prefix. Click anywhere on the card
                                      to toggle. */}
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                      <DonorAnnotations
                                        constituentName={annotationsName}
                                        constituentId={annotationsId}
                                        tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                        onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                        tagDefs={ADMISSIONS_TAG_DEFS}
                                      />
                                    </div>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Non-projection drilldown types (existing logic)
                let filtered: AdmissionApplication[] = [];
                if (admissionsDrilldown.type === 'grade') {
                  filtered = admissionsData.filter(a => a.grade_applying_for === admissionsDrilldown.value);
                } else if (admissionsDrilldown.type === 'projection_grade') {
                  filtered = admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
                    .filter(a => [2, 4, 9, 1].includes(a.application_decision_response))
                    .filter(a => a.grade_applying_for === admissionsDrilldown.value);
                } else if (admissionsDrilldown.type === 'status') {
                  const codes = APPLICATION_STATUS_GROUPS[admissionsDrilldown.label] || [];
                  filtered = admissionsData.filter(a => codes.includes(a.application_status));
                } else if (admissionsDrilldown.type === 'response') {
                  filtered = admissionsData
                    .filter(a => APPLICATION_STATUS_GROUPS.Accepted.includes(a.application_status))
                    .filter(a => a.application_decision_response === admissionsDrilldown.value);
                }

                const getStatusColor = (status: number): string => {
                  if (APPLICATION_STATUS_GROUPS.Accepted.includes(status)) return 'bg-green-100 text-green-700';
                  if (APPLICATION_STATUS_GROUPS.Waitlisted.includes(status)) return 'bg-amber-100 text-amber-700';
                  if (APPLICATION_STATUS_GROUPS.Denied.includes(status)) return 'bg-red-100 text-red-700';
                  if (APPLICATION_STATUS_GROUPS.Withdrawn.includes(status)) return 'bg-slate-100 text-slate-600';
                  return 'bg-slate-100 text-slate-600';
                };

                const getResponseColor = (response: number): string => {
                  if (response === 2) return 'bg-green-100 text-green-700';
                  if (response === 4) return 'bg-blue-100 text-blue-700';
                  if (response === 9) return 'bg-teal-100 text-teal-700';
                  if (response === 1) return 'bg-amber-100 text-amber-700';
                  if (response === 3 || response === 5) return 'bg-red-100 text-red-700';
                  return 'bg-slate-100 text-slate-600';
                };

                // Sort by last name, first name (using applicantNames)
                const sortedFiltered = [...filtered].sort((a, b) => {
                  const nameA = applicantNames[a.applicant_id] || '';
                  const nameB = applicantNames[b.applicant_id] || '';
                  const partsA = nameA.split(' ');
                  const partsB = nameB.split(' ');
                  const lastA = partsA.slice(1).join(' ') || partsA[0] || '';
                  const lastB = partsB.slice(1).join(' ') || partsB[0] || '';
                  return lastA.localeCompare(lastB) || (partsA[0] || '').localeCompare(partsB[0] || '');
                });

                // Apply search
                const overviewSearchLower = admissionsDrilldownSearch.toLowerCase();
                const displayFiltered = overviewSearchLower
                  ? sortedFiltered.filter(a => {
                      const name = applicantNames[a.applicant_id] || '';
                      return name.toLowerCase().includes(overviewSearchLower);
                    })
                  : sortedFiltered;

                return (
                  <>
                    <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setAdmissionsDrilldown(null)} />
                    <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                      <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{admissionsDrilldown.label}</h3>
                            <p className="text-sm text-slate-500 mt-0.5">{filtered.length} applicant{filtered.length !== 1 ? 's' : ''}</p>
                          </div>
                          <button onClick={() => setAdmissionsDrilldown(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        {/* Search */}
                        <div className="relative mt-3">
                          <input
                            type="text"
                            placeholder="Search by name..."
                            value={admissionsDrilldownSearch}
                            onChange={e => setAdmissionsDrilldownSearch(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
                          />
                          {admissionsDrilldownSearch && (
                            <button onClick={() => setAdmissionsDrilldownSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">×</button>
                          )}
                        </div>
                        {/* Filter pills (overview grade drilldown only) */}
                        {admissionsDrilldown.type === 'grade' && (() => {
                          const enrolledCount = filtered.filter(a => a.application_decision_response === 2).length;
                          const pendingCount = filtered.filter(a => a.application_status === 1).length;
                          const declinedCount = filtered.filter(a => a.application_decision_response === 3).length;
                          return (
                            <div className="flex gap-1.5 mt-3">
                              {([
                                { key: 'all' as const, label: 'All' },
                                { key: 'enrolled' as const, label: `Enrollment Complete (${enrolledCount})` },
                                { key: 'pending' as const, label: `Pending (${pendingCount})` },
                                { key: 'declined' as const, label: `Declined Offer (${declinedCount})` },
                              ]).map(f => (
                                <button
                                  key={f.key}
                                  onClick={() => setOverviewDrilldownFilter(f.key)}
                                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${overviewDrilldownFilter === f.key ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}
                                >
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex-1 overflow-y-auto px-6 py-4">
                        {applicantNamesLoading && (
                          <div className="flex items-center gap-2 mb-4 text-sm text-slate-400">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Loading names...
                          </div>
                        )}
                        {(() => {
                          // Apply overview filter
                          const overviewFiltered = overviewDrilldownFilter === 'all' ? displayFiltered
                            : overviewDrilldownFilter === 'enrolled' ? displayFiltered.filter(a => a.application_decision_response === 2)
                            : overviewDrilldownFilter === 'pending' ? displayFiltered.filter(a => a.application_status === 1)
                            : displayFiltered.filter(a => a.application_decision_response === 3);
                          return overviewFiltered.length === 0 ? (
                          <div className="text-center py-12 text-slate-400">
                            <p className="text-sm">{filtered.length === 0 ? 'No matching applicants' : 'No matching results'}</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {overviewFiltered.map(a => {
                              const fullName = applicantNames[a.applicant_id] || `Applicant #${a.applicant_id}`;
                              const annotationsName = `Admissions: ${fullName}`;
                              const annotationsId = `admissions-${String(a.applicant_id)}`;
                              const studentKey = `new-${a.applicant_id}`;
                              const isExpanded = expandedAdmissionsStudent === studentKey;
                              return (
                              <div
                                key={a.application_id}
                                className={`border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}
                                onClick={() => setExpandedAdmissionsStudent(prev => prev === studentKey ? null : studentKey)}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-slate-900">
                                      {fullName}
                                    </span>
                                    {a.applicant_id != null && (
                                      <a href={`https://axiom.veracross.com/sar/#/detail/student-ls/${a.applicant_id}/273-general`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-blue-500 transition-colors" title="Open in Veracross">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
                                      </a>
                                    )}
                                    {a.household_id != null && (
                                      <a href={`https://accounting.veracross.com/sar/#/detail/household/${a.household_id}/-420-current-amount-due`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-slate-300 hover:text-green-600 transition-colors" title="View current amount due (Veracross Accounting)">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {a.application_date && (
                                      <span className="text-xs text-slate-400">{format(parseISO(a.application_date), 'MMM d, yyyy')}</span>
                                    )}
                                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-slate-500">{ADMISSIONS_GRADE_LABELS[a.grade_applying_for] || `Grade ${a.grade_applying_for}`}</span>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getStatusColor(a.application_status)}`}>
                                    {APPLICATION_STATUS_DETAIL_LABELS[a.application_status] || getApplicationStatusLabel(a.application_status)}
                                  </span>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getResponseColor(a.application_decision_response)}`}>
                                    {DECISION_RESPONSE_LABELS[a.application_decision_response] || 'Unknown'}
                                  </span>
                                  {a.isNewFamily && (
                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700" title="First-year family at the school">New Family</span>
                                  )}
                                </div>
                                {isExpanded && (
                                  <div className="border-t border-slate-100 mt-4 pt-4" onClick={e => e.stopPropagation()}>
                                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Notes &amp; Tags</p>
                                    <DonorAnnotations
                                      constituentName={annotationsName}
                                      constituentId={annotationsId}
                                      tags={admissionsDrilldownTags.get(annotationsName) ?? []}
                                      onTagsChange={(next) => updateAdmissionsTag(annotationsName, next)}
                                      tagDefs={ADMISSIONS_TAG_DEFS}
                                    />
                                  </div>
                                )}
                              </div>
                              );
                            })}
                          </div>
                        );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* After School Programs View */}
          {activeNav === 'after_school' && <AfterSchoolTab />}

          {/* Development View — Guardian Circle is now a tab inside this page (position 3 of 5). */}
          {activeNav === 'development' && <DevelopmentPage onNavigate={setActiveNav} />}

          {/* Lever Recruiting View */}
          {activeNav === 'lever' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">Recruiting{backgroundRefreshing === 'lever' && <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />Updating...</span>}</h1>
                  <p className="text-sm text-slate-400 mt-0.5">Powered by Lever</p>
                </div>
                <div className="flex items-center gap-2">
                  {leverData && (
                    <>
                      {/* Open Positions count — server already filters by division
                          query param, so leverData.postings.length reflects the
                          active division view directly (no inline HS exclusion). */}
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 rounded-full text-sm font-medium text-blue-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{leverData.postings.length} Open Positions
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-full text-sm font-medium text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{leverData.opportunities.filter((o: any) => o.createdAt > Date.now() - 7 * 86400000).length} New Applicants This Week
                      </span>
                    </>
                  )}
                  <button
                    onClick={() => { setLeverData(null); delete dataCacheRef.current.lever; setLeverRefreshKey(k => k + 1); }}
                    disabled={leverLoading}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <svg className={`w-4 h-4 ${leverLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>

              {leverLoading && !leverData ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                      <div className="h-5 bg-slate-200 rounded w-40 mb-4" />
                      <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map(j => <div key={j} className="h-4 bg-slate-100 rounded w-full" />)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : leverData ? (() => {
                const { postings, opportunities, stages } = leverData;
                const postingIds = new Set(postings.map((p: any) => p.id));
                const now = Date.now();
                const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
                // Helper: extract posting ID from application (handles both string and expanded object)
                const getOppPostingId = (o: any): string | null => {
                  const posting = o.applications?.[0]?.posting;
                  if (!posting) return null;
                  return typeof posting === 'string' ? posting : posting.id || null;
                };
                // Filter opps: non-HS + last 365 days
                const filteredOpps = opportunities.filter((o: any) => {
                  const oppPostingId = getOppPostingId(o);
                  return (!oppPostingId || postingIds.has(oppPostingId)) && (o.createdAt > oneYearAgo);
                });
                const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
                const newThisWeek = filteredOpps.filter((o: any) => o.createdAt > weekAgo);
                // API already filters archived=false, so all filteredOpps are active pipeline
                const activePipeline = filteredOpps;
                const stageMap = new Map(stages.map((s: any) => [s.id, s.text]));
                const postingMap = new Map(postings.map((p: any) => [p.id, p]));

                // Phase E: posting → division. Used to render small
                // Academy/HS pills on candidate + open-role cards when
                // the user is viewing the combined "Institutional"
                // mode, so it's obvious at a glance which school each
                // role belongs to.
                const postingDivision = (p: any): 'academy' | 'hs' => {
                  if (!p) return 'academy';
                  if (p.categories?.department === 'SAR High School') return 'hs';
                  if ((p.categories?.team || '').includes('High School')) return 'hs';
                  return 'academy';
                };
                const showDivisionBadges = hasMultipleDivisions && activeDivisionLever === 'both';

                const getStageBadgeColor = (stageName: string) => {
                  const s = stageName.toLowerCase();
                  if (s.includes('offer') || s.includes('hired')) return 'bg-green-100 text-green-700';
                  if (s.includes('interview') || s.includes('phone')) return 'bg-blue-100 text-blue-700';
                  if (s.includes('screen')) return 'bg-amber-100 text-amber-700';
                  return 'bg-slate-100 text-slate-600';
                };
                const getStageLeftBorder = (stageName: string) => {
                  const s = stageName.toLowerCase();
                  if (s.includes('offer') || s.includes('hired')) return 'border-l-green-500';
                  if (s.includes('interview')) return 'border-l-blue-500';
                  if (s.includes('phone') || s.includes('screen')) return 'border-l-amber-500';
                  return 'border-l-slate-300';
                };

                // Pipeline stage counts for active opps
                const stageCounts = new Map<string, number>();
                activePipeline.forEach((o: any) => {
                  const name = stageMap.get(o.stage) || 'Unknown';
                  stageCounts.set(name, (stageCounts.get(name) || 0) + 1);
                });
                const topStages = [...stageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).filter(([, c]) => c > 0);

                // Group by team (department is always "SAR Academy" — useless)
                const twoYearsMs = 730 * 24 * 60 * 60 * 1000;
                const visiblePostings = leverShowStaleRoles ? postings : postings.filter((p: any) => !p.createdAt || (now - p.createdAt) < twoYearsMs);
                const staleCount = postings.length - postings.filter((p: any) => !p.createdAt || (now - p.createdAt) < twoYearsMs).length;
                const deptGroups = new Map<string, any[]>();
                visiblePostings.forEach((p: any) => {
                  const group = p.categories?.team || p.categories?.commitment || 'General';
                  if (!deptGroups.has(group)) deptGroups.set(group, []);
                  deptGroups.get(group)!.push(p);
                });
                const sortedDepts = [...deptGroups.keys()].sort();

                // Collect unique team values
                const uniqueTeams = Array.from(new Set(
                  postings.map((p: any) => p.categories?.team || 'General').filter(Boolean)
                )).sort();

                // Cascade: positions filtered by selected team
                const teamFilteredPostings = leverTeamFilter
                  ? postings.filter((p: any) => (p.categories?.team || 'General') === leverTeamFilter)
                  : postings;
                const uniquePositions = Array.from(new Set(
                  teamFilteredPostings.map((p: any) => p.text).filter(Boolean)
                )).sort();

                // Reset position filter if it doesn't exist in the current team's positions
                if (leverPositionFilter && !uniquePositions.includes(leverPositionFilter)) {
                  setLeverPositionFilter(null);
                }

                // Apply team + position + search filters to the base filtered opps (BEFORE stage selection)
                let preStageFiltered = [...filteredOpps];
                if (leverTeamFilter) {
                  const teamPIds = new Set(teamFilteredPostings.map((p: any) => p.id));
                  preStageFiltered = preStageFiltered.filter((o: any) => {
                    const pid = getOppPostingId(o);
                    return pid && teamPIds.has(pid);
                  });
                }
                if (leverPositionFilter) {
                  const posPIds = new Set(
                    postings.filter((p: any) => p.text === leverPositionFilter).map((p: any) => p.id)
                  );
                  preStageFiltered = preStageFiltered.filter((o: any) => {
                    const pid = getOppPostingId(o);
                    return pid && posPIds.has(pid);
                  });
                }
                const leverSearchLower = leverSearchTerm.toLowerCase().trim();
                if (leverSearchLower) {
                  preStageFiltered = preStageFiltered.filter((o: any) => {
                    const name = o.name?.toLowerCase() || '';
                    const oppPostingId = getOppPostingId(o);
                    const posting = oppPostingId ? postingMap.get(oppPostingId) : null;
                    const title = posting?.text?.toLowerCase() || o.headline?.toLowerCase() || '';
                    const tags = (o.tags || []).join(' ').toLowerCase();
                    return name.includes(leverSearchLower) || title.includes(leverSearchLower) || tags.includes(leverSearchLower);
                  });
                }

                // Pipeline stage cards: counts reflect filtered state
                const stageIdCounts = new Map<string, number>();
                preStageFiltered.forEach((o: any) => {
                  stageIdCounts.set(o.stage, (stageIdCounts.get(o.stage) || 0) + 1);
                });
                const pipelineCards = stages
                  .filter((s: any) => stageIdCounts.has(s.id))
                  .map((s: any) => ({ id: s.id, name: s.text, count: stageIdCounts.get(s.id) || 0 }))
                  .sort((a: any, b: any) => b.count - a.count);

                // Apply stage OR stale filter on top (mutually exclusive)
                const now2 = Date.now();
                const d14 = 14 * 86400000; const d30 = 30 * 86400000; const d90 = 90 * 86400000;
                let allFilteredOpps = preStageFiltered;
                if (selectedLeverStage) {
                  allFilteredOpps = preStageFiltered.filter((o: any) => o.stage === selectedLeverStage);
                } else if (leverStaleFilter) {
                  allFilteredOpps = preStageFiltered.filter((o: any) => {
                    if (!o.lastInteractionAt) return false;
                    const age = now2 - o.lastInteractionAt;
                    if (leverStaleFilter === '14') return age >= d14 && age < d30;
                    if (leverStaleFilter === '30') return age >= d30 && age < d90;
                    return age >= d90;
                  });
                }
                const selectedStageName = selectedLeverStage ? (stageMap.get(selectedLeverStage) || 'Unknown') : null;

                const filteredDisplayOpps = [...allFilteredOpps].sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));

                const hasAnyFilter = !!leverTeamFilter || !!selectedLeverStage || !!leverPositionFilter || !!leverSearchTerm || !!leverStaleFilter;
                const filterSelectClass = (active: boolean) => `rounded-lg px-3 py-2 text-sm font-medium border transition-colors cursor-pointer appearance-none pr-8 bg-no-repeat ${active ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`;
                const selectArrowStyle = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: 'right 10px center', backgroundRepeat: 'no-repeat' };

                return (
                  <>
                    {/* Filter row: search + dropdowns */}
                    <div className="flex flex-col md:flex-row gap-2.5 mb-3">
                      {/* Search — takes ~50% */}
                      <div className="relative md:flex-[2]">
                        <input type="text" value={leverSearchTerm} onChange={e => setLeverSearchTerm(e.target.value)} placeholder="Search candidates, positions..." className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300" />
                        {leverSearchTerm && <button onClick={() => setLeverSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">×</button>}
                      </div>
                      {/* Division dropdown — multi-division users only.
                          Sits inline with the other filter dropdowns so
                          academy-only users see no layout shift. Internal
                          state value 'both' shows as "All Schools" to
                          match the unfiltered semantic. */}
                      {hasMultipleDivisions && (
                        <select
                          value={activeDivisionLever}
                          onChange={e => setActiveDivisionLever(e.target.value as 'academy' | 'hs' | 'both')}
                          className={filterSelectClass(activeDivisionLever !== 'both')}
                          style={selectArrowStyle}
                        >
                          <option value="both">All Schools</option>
                          <option value="academy">Academy</option>
                          <option value="hs">High School</option>
                        </select>
                      )}
                      {/* Team dropdown */}
                      <select value={leverTeamFilter || ''} onChange={e => { setLeverTeamFilter(e.target.value || null); setLeverPositionFilter(null); }} className={filterSelectClass(!!leverTeamFilter)} style={selectArrowStyle}>
                        <option value="">All Teams</option>
                        {uniqueTeams.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {/* Position dropdown */}
                      <select value={leverPositionFilter || ''} onChange={e => setLeverPositionFilter(e.target.value || null)} className={filterSelectClass(!!leverPositionFilter)} style={selectArrowStyle}>
                        <option value="">All Positions</option>
                        {uniquePositions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    {/* Clear + count */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs text-slate-500">Showing {filteredDisplayOpps.length} candidate{filteredDisplayOpps.length !== 1 ? 's' : ''}</span>
                      {hasAnyFilter && (
                        <button onClick={() => { setLeverTeamFilter(null); setSelectedLeverStage(null); setLeverPositionFilter(null); setLeverSearchTerm(''); setLeverStaleFilter(null); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Clear all filters</button>
                      )}
                    </div>

                    {/* Pipeline Overview */}
                    {(() => {
                      const STAGE_COLORS: Record<string, string> = {};
                      const brandPalette = ['#1B3A6B', '#E87722', '#00A5B5', '#7AB648', '#2B6CB0', '#E91E8C', '#64748b', '#D97706'];
                      const STAGE_TIPS: Record<string, string> = {
                        'new applicant': 'Recently applied, needs initial review',
                        'new lead': 'Sourced or referred, not yet contacted',
                        'responded': 'Replied to initial outreach',
                        'initial screening': 'Phone screens completed, being evaluated for interviews',
                        'on-site interview': 'Scheduled or completed in-person interviews',
                        'hr screening and reference check': 'References being checked, HR review in progress',
                        'offer and background check': 'Offer extended, pending acceptance and verification',
                      };
                      pipelineCards.forEach((c: any, i: number) => { STAGE_COLORS[c.id] = brandPalette[i % brandPalette.length]; });

                      // Stale candidates (reuse now2/d14/d30/d90 from outer scope)
                      const stale14 = preStageFiltered.filter((o: any) => o.lastInteractionAt && (now2 - o.lastInteractionAt) >= d14 && (now2 - o.lastInteractionAt) < d30);
                      const stale30 = preStageFiltered.filter((o: any) => o.lastInteractionAt && (now2 - o.lastInteractionAt) >= d30 && (now2 - o.lastInteractionAt) < d90);
                      const stale90 = preStageFiltered.filter((o: any) => o.lastInteractionAt && (now2 - o.lastInteractionAt) >= d90);

                      return (
                        <div className="mb-6">
                          <h3 className="font-bold text-slate-800 mb-3">Pipeline Overview</h3>
                          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 mb-4">
                            {/* ALL card */}
                            <button
                              onClick={() => { setSelectedLeverStage(null); setLeverStaleFilter(null); }}
                              className="relative group rounded-lg px-3 py-2.5 cursor-pointer transition-all duration-200 border-2"
                              style={!selectedLeverStage && !leverStaleFilter ? { backgroundColor: '#1B3A6B', borderColor: '#1B3A6B', color: 'white' } : { borderColor: '#1B3A6B', backgroundColor: 'white' }}
                              onMouseEnter={(e) => { if (selectedLeverStage || leverStaleFilter) { e.currentTarget.style.backgroundColor = '#1B3A6B'; e.currentTarget.style.color = 'white'; }}}
                              onMouseLeave={(e) => { if (selectedLeverStage || leverStaleFilter) { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.color = ''; }}}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: !selectedLeverStage && !leverStaleFilter ? 'rgba(255,255,255,0.85)' : '#64748b' }}>All</p>
                              <p className="text-xl font-bold" style={{ color: !selectedLeverStage && !leverStaleFilter ? 'white' : '#1B3A6B' }}>{preStageFiltered.length}</p>
                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">All active candidates in the pipeline<span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" /></span>
                            </button>
                            {pipelineCards.map((card: any) => {
                              const color = STAGE_COLORS[card.id] || '#64748b';
                              const selected = selectedLeverStage === card.id;
                              const tip = STAGE_TIPS[card.name.toLowerCase()] || `${card.count} candidates in this stage`;
                              return (
                                <button
                                  key={card.id}
                                  onClick={() => { setSelectedLeverStage(selected ? null : card.id); setLeverStaleFilter(null); }}
                                  className="relative group rounded-lg px-3 py-2.5 cursor-pointer transition-all duration-200 border-2"
                                  style={selected ? { backgroundColor: color, borderColor: color, color: 'white' } : { borderColor: color, backgroundColor: 'white' }}
                                  onMouseEnter={(e) => { if (!selected) { e.currentTarget.style.backgroundColor = color; e.currentTarget.style.color = 'white'; }}}
                                  onMouseLeave={(e) => { if (!selected) { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.color = ''; }}}
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: selected ? 'rgba(255,255,255,0.85)' : '#64748b' }}>{card.name}</p>
                                  <p className="text-xl font-bold" style={{ color: selected ? 'white' : color }}>{card.count}</p>
                                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-normal max-w-[200px] text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">{tip}<span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" /></span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Needs Attention — stale candidates (clickable) */}
                          <div className="flex gap-2.5 flex-wrap">
                            {([
                              { key: '14' as const, label: '14+ Days', count: stale14.length, color: '#D97706', tip: 'Candidates with no activity in the last 2 weeks. May need a follow-up.' },
                              { key: '30' as const, label: '30+ Days', count: stale30.length, color: '#E87722', tip: 'Candidates with no activity in 30+ days. Consider following up or archiving.' },
                              { key: '90' as const, label: '90+ Days', count: stale90.length, color: '#DC2626', tip: 'Candidates stale for 3+ months. Should be reviewed and likely archived.' },
                            ]).map(tier => {
                              const isActive = leverStaleFilter === tier.key;
                              return (
                                <button
                                  key={tier.key}
                                  onClick={() => { setLeverStaleFilter(isActive ? null : tier.key); setSelectedLeverStage(null); }}
                                  className="relative group rounded-lg px-3 py-2 border-2 cursor-pointer transition-all duration-200"
                                  style={isActive
                                    ? { backgroundColor: tier.color, borderColor: tier.color, color: 'white' }
                                    : { borderColor: tier.color, backgroundColor: tier.count > 0 ? undefined : '#f8fafc', opacity: tier.count > 0 ? 1 : 0.5 }
                                  }
                                >
                                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${isActive ? 'text-white opacity-90' : 'text-slate-500'}`}>No Activity {tier.label}</p>
                                  <p className="text-lg font-bold" style={{ color: isActive ? 'white' : tier.count > 0 ? tier.color : '#94a3b8' }}>{tier.count}</p>
                                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-normal max-w-[220px] text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">{tier.tip}<span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" /></span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Two-column layout */}
                    <div className="flex gap-6 items-start">
                      {/* Left: Candidates */}
                      <div className="flex-1 bg-white rounded-xl border border-slate-200 p-5">
                        <h3 className="font-semibold text-slate-900 mb-4">
                          {selectedStageName ? `Candidates — ${selectedStageName}` : 'All Candidates'}
                          <span className="text-sm font-normal text-slate-400 ml-2">{filteredDisplayOpps.length}</span>
                        </h3>
                        {filteredDisplayOpps.length === 0 ? (
                          <p className="text-sm text-slate-400 py-8 text-center">No candidates{selectedStageName ? ` in ${selectedStageName}` : ''}</p>
                        ) : (
                          <div className="space-y-1">
                            {filteredDisplayOpps.map((o: any) => {
                              const oppPostingId = getOppPostingId(o);
                              const posting = oppPostingId ? postingMap.get(oppPostingId) : null;
                              const roleText = posting?.text || (o.headline ? (o.headline.length > 40 ? o.headline.slice(0, 40) + '...' : o.headline) : null);
                              const stageName = stageMap.get(o.stage) || 'Unknown';
                              const source = o.sources?.[0] || 'Direct';
                              const timeAgo = o.createdAt ? formatDistanceToNow(new Date(o.createdAt), { addSuffix: true }) : '';
                              const originBadge = o.origin ? { sourced: 'bg-purple-100 text-purple-700', applied: 'bg-blue-100 text-blue-700', referred: 'bg-green-100 text-green-700', agency: 'bg-amber-100 text-amber-700' }[o.origin as string] || null : null;
                              return (
                                <div
                                  key={o.id}
                                  onClick={() => setLeverCandidatePanel(o)}
                                  className={`flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 border-l-2 pl-3 cursor-pointer hover:bg-slate-50 transition-colors ${getStageLeftBorder(stageName)}`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-800 truncate">{o.name || 'Unknown'}</p>
                                    {roleText && (
                                      <p className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                                        {showDivisionBadges && posting && (
                                          postingDivision(posting) === 'hs'
                                            ? <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex-shrink-0">HS</span>
                                            : <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 flex-shrink-0">Academy</span>
                                        )}
                                        <span className="truncate">{roleText}</span>
                                      </p>
                                    )}
                                  </div>
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${getStageBadgeColor(stageName)}`}>{stageName}</span>
                                  {originBadge && <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${originBadge}`}>{o.origin}</span>}
                                  <div className="flex-shrink-0 text-right min-w-[70px]">
                                    <p className="text-xs text-slate-400">{source}</p>
                                    <p className="text-xs text-slate-400">{timeAgo}</p>
                                  </div>
                                  {o.urls?.show && (
                                    <a href={o.urls.show} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex-shrink-0 text-slate-400 hover:text-blue-500">
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                    </a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Right: Open Roles */}
                      <div className="w-96 flex-shrink-0">
                      <div className="bg-white rounded-xl border border-slate-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-slate-900">Open Roles</h3>
                          <span className="text-xs text-slate-400">{visiblePostings.length} roles</span>
                        </div>
                        {visiblePostings.length === 0 ? (
                          <p className="text-sm text-slate-400 py-8 text-center">No open roles</p>
                        ) : (
                          <div className="space-y-4">
                            {staleCount > 0 && (
                              <button
                                onClick={() => setLeverShowStaleRoles(!leverShowStaleRoles)}
                                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                {leverShowStaleRoles ? 'Hide long-term open roles' : `${staleCount} role${staleCount !== 1 ? 's' : ''} hidden (open 2+ years) — show all`}
                              </button>
                            )}
                            {sortedDepts.map(dept => {
                              const deptPostings = deptGroups.get(dept)!.sort((a: any, b: any) => (a.text || '').localeCompare(b.text || ''));
                              const deptAppCount = deptPostings.reduce((sum: number, p: any) => sum + filteredOpps.filter((o: any) => getOppPostingId(o) === p.id).length, 0);
                              return (
                                <div key={dept}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{dept}</h4>
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${deptAppCount > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{deptPostings.length}</span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {deptPostings.map((p: any) => {
                                      const appCount = filteredOpps.filter((o: any) => getOppPostingId(o) === p.id).length;
                                      const daysOpen = p.createdAt ? Math.floor((now - p.createdAt) / (1000 * 60 * 60 * 24)) : 0;
                                      return (
                                        <div key={p.id} className="flex items-center gap-2 py-1.5">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                                              {showDivisionBadges && (
                                                postingDivision(p) === 'hs'
                                                  ? <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex-shrink-0">HS</span>
                                                  : <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 flex-shrink-0">Academy</span>
                                              )}
                                              <span className="truncate">{p.text}</span>
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                              {p.categories?.location && <span className="text-xs text-slate-400">{p.categories.location}</span>}
                                              <span className={`text-xs ${daysOpen > 60 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>{daysOpen}d open</span>
                                            </div>
                                          </div>
                                          {appCount > 0 && <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">{appCount}</span>}
                                          {p.urls?.show && (
                                            <a href={p.urls.show} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-slate-400 hover:text-blue-500">
                                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                            </a>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      </div>
                    </div>
                  </>
                );
              })() : (
                <div className="text-center py-20 text-slate-400">
                  <p>Failed to load recruiting data</p>
                  <button onClick={() => { setLeverData(null); setLeverRefreshKey(k => k + 1); }} className="mt-2 text-blue-600 hover:underline text-sm">Try again</button>
                </div>
              )}

              {/* Candidate detail panel */}
              {leverCandidatePanel && leverData && (() => {
                const o = leverCandidatePanel;
                const stageMap2 = new Map(leverData.stages.map((s: any) => [s.id, s.text]));
                const postingMap2 = new Map(leverData.postings.map((p: any) => [p.id, p]));
                const stageName = stageMap2.get(o.stage) || 'Unknown';
                const oppPostingId = o.applications?.[0]?.posting;
                const postingId = typeof oppPostingId === 'string' ? oppPostingId : oppPostingId?.id;
                const posting = postingId ? postingMap2.get(postingId) : null;
                const roleText = posting?.text || o.headline || 'No role specified';
                const getStageBadgeColor2 = (s: string) => {
                  const sl = s.toLowerCase();
                  if (sl.includes('offer') || sl.includes('hired')) return 'bg-green-100 text-green-700';
                  if (sl.includes('interview') || sl.includes('phone')) return 'bg-blue-100 text-blue-700';
                  if (sl.includes('screen')) return 'bg-amber-100 text-amber-700';
                  return 'bg-slate-100 text-slate-600';
                };
                const daysInPipeline = o.createdAt ? Math.floor((Date.now() - o.createdAt) / (1000 * 60 * 60 * 24)) : 0;
                return (
                  <>
                    <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setLeverCandidatePanel(null)} />
                    <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
                      <div className="px-6 py-5 border-b border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xl font-bold text-slate-900">{o.name || 'Unknown'}</h3>
                          <button onClick={() => setLeverCandidatePanel(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${getStageBadgeColor2(stageName)}`}>{stageName}</span>
                          {o.origin && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{o.origin}</span>}
                          <span className="text-xs text-slate-400">{daysInPipeline} days in pipeline</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Role</p>
                          <p className="text-sm text-slate-800">{roleText}</p>
                        </div>
                        {o.sources?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Source</p>
                            <p className="text-sm text-slate-800">{o.sources.join(', ')}</p>
                          </div>
                        )}
                        {(o.emails?.length > 0 || o.phones?.length > 0) && (
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Contact</p>
                            {o.emails?.[0] && <p className="text-sm text-slate-800">{o.emails[0]}</p>}
                            {o.phones?.[0]?.value && <p className="text-sm text-slate-800">{o.phones[0].value}</p>}
                          </div>
                        )}
                        {o.tags?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Tags</p>
                            <div className="flex flex-wrap gap-1">
                              {o.tags.map((t: string) => (
                                <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {o.headline && (
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Headline</p>
                            <p className="text-sm text-slate-800">{o.headline}</p>
                          </div>
                        )}
                        {o.createdAt && (
                          <div>
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Added</p>
                            <p className="text-sm text-slate-800">{format(new Date(o.createdAt), 'MMM d, yyyy')} ({formatDistanceToNow(new Date(o.createdAt), { addSuffix: true })})</p>
                          </div>
                        )}
                        {/* Notes section */}
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Notes</p>
                            {leverNotes.length > 0 && <span className="bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5 rounded">{leverNotes.length}</span>}
                          </div>
                          {leverNotesLoading ? (
                            <div className="text-xs text-slate-400 animate-pulse">Loading notes...</div>
                          ) : (
                            <>
                              {leverNotes.length > 0 && (
                                <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                                  {[...leverNotes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(n => (
                                    <div key={n.id} className="bg-slate-50 rounded-lg p-2.5">
                                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.text}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        {n.user?.name && <span className="text-[10px] text-slate-500">{n.user.name}</span>}
                                        {n.createdAt && <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <textarea
                                value={leverNoteText}
                                onChange={e => setLeverNoteText(e.target.value)}
                                placeholder="Add a note..."
                                className="w-full border border-slate-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                                rows={2}
                              />
                              <button
                                disabled={!leverNoteText.trim() || leverNotePosting}
                                onClick={async () => {
                                  setLeverNotePosting(true);
                                  try {
                                    const res = await fetch('/api/recruiting/notes', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ opportunityId: o.id, value: leverNoteText.trim(), userEmail: user?.email }),
                                    });
                                    if (res.ok) {
                                      const { note } = await res.json();
                                      if (note) setLeverNotes(prev => [note, ...prev]);
                                      setLeverNoteText('');
                                    }
                                  } catch { /* ignore */ }
                                  setLeverNotePosting(false);
                                }}
                                className="mt-2 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors"
                              >
                                {leverNotePosting ? 'Posting...' : 'Post Note'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {o.urls?.show && (
                        <div className="px-6 py-4 border-t border-slate-100">
                          <a href={o.urls.show} target="_blank" rel="noopener noreferrer" className="block w-full text-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                            View in Lever
                          </a>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Emily's Queue View */}
          {activeNav === 'emily' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  Emily's Queue
                  <span className="ml-2 bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-sm font-medium">
                    {emilyQueue.length}
                  </span>
                </h3>
                {emilyQueue.length > 0 && (
                  <button
                    onClick={() => markSectionDone(emilyQueue.map(e => e.id))}
                    disabled={bulkUpdating}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    ✓ Mark All Done
                  </button>
                )}
              </div>

              {emilyQueue.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
                  <p className="text-slate-400">No emails in Emily's queue</p>
                  <p className="text-sm text-slate-400 mt-1">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Needs Your Input (TBD) Section */}
                  {tbdEmails.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                        Needs Your Input ({tbdEmails.length})
                      </h4>
                      <div className="space-y-3">
                        {tbdEmails.map((email) => (
                          <TbdInputCard key={email.id} email={email} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Needs Revision Section */}
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
                                onClick={() => { setEditingDraftId(email.id); setDraftText(email.edited_draft || email.draft_reply || ''); }}
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

                  {/* Regular Emily Queue */}
                  {emilyQueue.filter(e => e.draft_status !== 'needs_revision').length > 0 && (
                    <div>
                      {needsRevisionEmails.length > 0 && (
                        <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-3">
                          Other Emails
                        </h4>
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
          )}

          {/* Gemara View */}
          {activeNav === 'gemara' && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h3 className="text-lg font-semibold text-slate-900">Gemara</h3>
              </div>
              <div className="space-y-3 max-w-xl">
                {([
                  { title: 'Gemara Folder', description: 'Shared resources, source sheets, and class materials.', href: '#gemara-folder' },
                  { title: 'Oral Test Sign-Up', description: 'Students sign up for their oral assessment slot.', href: '#oral-test-signup' },
                  { title: 'Oral Test Rubric', description: 'Grading criteria and assessment standards.', href: '#oral-test-rubric' },
                ] as const).map((link) => (
                  <a
                    key={link.title}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">{link.title}</span>
                      <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6m4-3h6v6m-11 5L21 3" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">{link.description}</p>
                  </a>
                ))}
              </div>
              <p className="text-sm text-slate-400 mt-6">More Gemara tools coming soon</p>
            </div>
          )}

          {/* Communications View */}
          {activeNav === 'communications' && (
            <div>
              {/* Toast */}
              {commsToast && (
                <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-fade-in">
                  {commsToast}
                </div>
              )}

              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <h1 className="text-2xl font-bold text-slate-900">Communications</h1>
                </div>
                <a
                  href="https://sar-academy.monday.com/boards/4035548140"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open board in Monday
                </a>
              </div>

              {/* Section 1: Pending Approvals */}
              <div className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-lg font-semibold text-slate-800">Pending your approval</h2>
                  {!commsLoading && mondayCommsItems.length > 0 && (
                    <span className="bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">{mondayCommsItems.length}</span>
                  )}
                </div>

                {commsLoading ? (
                  <ShimmerCards count={4} />
                ) : commsError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <span className="text-red-700 text-sm">{commsError}</span>
                    <button onClick={fetchCommsItems} className="text-red-600 text-sm font-medium hover:text-red-800">Retry</button>
                  </div>
                ) : mondayCommsItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 bg-white rounded-xl border border-slate-200">
                    <svg className="w-12 h-12 text-green-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-slate-400 text-sm">No pending approvals</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mondayCommsItems.map((item) => {
                      const commTypePill = (() => {
                        const t = (item.commType || '').toLowerCase();
                        if (t.includes('email')) return { bg: 'bg-blue-100 text-blue-700', label: item.commType || 'Email' };
                        if (t.includes('chadashot')) return { bg: 'bg-amber-100 text-amber-700', label: item.commType || 'Chadashot' };
                        if (t.includes('linkedin')) return { bg: 'bg-blue-200 text-blue-900', label: item.commType || 'LinkedIn' };
                        if (t.includes('today@') || t.includes('today at')) return { bg: 'bg-teal-100 text-teal-700', label: item.commType || 'Today@SAR' };
                        if (t.includes('jewish link')) return { bg: 'bg-purple-100 text-purple-700', label: item.commType || 'Jewish Link' };
                        if (t.includes('digest')) return { bg: 'bg-gray-100 text-gray-600', label: item.commType || 'Digest' };
                        return { bg: 'bg-slate-100 text-slate-600', label: item.commType || 'Other' };
                      })();

                      return (
                        <div key={item.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                          <div className="p-4 flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-slate-900 text-sm truncate">{item.name}</p>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${commTypePill.bg}`}>{commTypePill.label}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                                {item.requester && <span>From: {item.requester}</span>}
                                {item.audience && <span>Audience: {item.audience}</span>}
                                {item.dueDate && <span>Due: {item.dueDate}</span>}
                              </div>
                              {item.notes && <p className="text-slate-500 text-xs mt-2 line-clamp-2">{item.notes}</p>}
                            </div>
                            <div className="flex flex-col gap-1.5 flex-shrink-0">
                              {item.draftLink && (
                                <a href={item.draftLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors whitespace-nowrap">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                                  View draft
                                </a>
                              )}
                              {item.file && (
                                <a href={item.file} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors whitespace-nowrap">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                  View attachment
                                </a>
                              )}
                              <button onClick={() => handleCommsAction(item.id, 'approve')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors whitespace-nowrap">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                Approve
                              </button>
                              <button onClick={() => setExpandedRequestId(expandedRequestId === item.id ? null : item.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors whitespace-nowrap">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                Request changes
                              </button>
                            </div>
                          </div>
                          {expandedRequestId === item.id && (
                            <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                              <textarea
                                value={requestNoteText}
                                onChange={(e) => setRequestNoteText(e.target.value)}
                                placeholder="Leave a note for Yael/Ilana (optional)"
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                                rows={3}
                              />
                              <div className="flex items-center gap-2 mt-2">
                                <button
                                  onClick={() => handleCommsAction(item.id, 'request_changes', requestNoteText.trim() || undefined)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-white hover:bg-slate-700 transition-colors"
                                >
                                  Send
                                </button>
                                <button
                                  onClick={() => { setExpandedRequestId(null); setRequestNoteText(''); }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Section 2: Social Media — driven by workspaceBrand.
                  Hidden entirely when no brand entries are configured. */}
              {(() => {
                const ownerShort = workspaceBrand?.ownerShortName || 'Owner';
                const instagramIcon = <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 01-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 017.8 2m-.2 2A3.6 3.6 0 004 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 003.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5M12 7a5 5 0 110 10 5 5 0 010-10m0 2a3 3 0 100 6 3 3 0 000-6z" />;
                const linkedinIcon = <path d="M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14m-.5 15.5v-5.3a3.26 3.26 0 00-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 011.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 001.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 00-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />;
                const xIcon = <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />;
                const links: Array<{ name: string; handle: string; url: string; color: string; bg: string; icon: React.ReactNode }> = [];
                if (workspaceBrand?.schoolInstagram) {
                  const h = workspaceBrand.schoolInstagram;
                  links.push({ name: 'School Instagram', handle: `@${h}`, url: `https://www.instagram.com/${h}/`, color: 'text-pink-500', bg: 'bg-pink-50 hover:bg-pink-100', icon: instagramIcon });
                }
                if (workspaceBrand?.ownerInstagram) {
                  const h = workspaceBrand.ownerInstagram;
                  links.push({ name: `${ownerShort} Instagram`, handle: `@${h}`, url: `https://www.instagram.com/${h}/`, color: 'text-pink-500', bg: 'bg-pink-50 hover:bg-pink-100', icon: instagramIcon });
                }
                if (workspaceBrand?.ownerLinkedIn) {
                  const h = workspaceBrand.ownerLinkedIn;
                  links.push({ name: `${ownerShort} LinkedIn`, handle: h, url: `https://www.linkedin.com/in/${h}/`, color: 'text-blue-600', bg: 'bg-blue-50 hover:bg-blue-100', icon: linkedinIcon });
                }
                if (workspaceBrand?.ownerX) {
                  const h = workspaceBrand.ownerX;
                  links.push({ name: `${ownerShort} X`, handle: `@${h}`, url: `https://x.com/${h}`, color: 'text-slate-700', bg: 'bg-slate-50 hover:bg-slate-100', icon: xIcon });
                }
                if (links.length === 0) return null;
                return (
                  <div>
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Social media</h2>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {links.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-3 p-4 rounded-xl border border-slate-200 ${link.bg} transition-colors`}
                        >
                          <svg className={`w-6 h-6 ${link.color} flex-shrink-0`} fill="currentColor" viewBox="0 0 24 24">{link.icon}</svg>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{link.name}</p>
                            <p className="text-xs text-slate-400 truncate">{link.handle}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </main>

      {/* Draft Editor Modal - Global */}
      {editingDraftId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingDraftId(null)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Edit Draft Response</h3>
              <button onClick={() => setEditingDraftId(null)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === editingDraftId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="font-medium text-slate-900">{email.subject}</p>
                    <p className="text-sm text-slate-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Draft Response</label>
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                      placeholder="Type your response here..."
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setEditingDraftId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, false);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="border border-slate-200 text-slate-700 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      Save Draft
                    </button>
                    <button
                      onClick={async () => {
                        await saveDraft(editingDraftId, draftText, true);
                        setEditingDraftId(null);
                      }}
                      disabled={updating === editingDraftId}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      Mark Ready for Review
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Request Revision Modal */}
      {revisionEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRevisionEmailId(null)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Request Revision
            </h3>
            {(() => {
              const email = emails.find(e => e.id === revisionEmailId);
              if (!email) return null;
              return (
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="font-medium text-slate-900 text-sm">{email.subject}</p>
                    <p className="text-xs text-slate-500">To: {email.from_email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Comment for Emily</label>
                    <textarea
                      value={revisionComment}
                      onChange={(e) => setRevisionComment(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      placeholder="What changes are needed?"
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => setRevisionEmailId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => requestRevision(revisionEmailId, revisionComment)}
                      disabled={updating === revisionEmailId}
                      className="bg-amber-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
                    >
                      Send to Emily
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Note Task Context Popup */}
      {noteTaskPopupId && (() => {
        const note = actionNotes.find(n => n.id === noteTaskPopupId);
        if (!note) return null;
        // Find the agenda item this note belongs to
        const parentItem = agendaItemsList.find(item =>
          item.id === note.agenda_item_id || item.email_id === note.email_id
        );
        const contextName = parentItem?.topic?.name || parentItem?.email?.subject || 'Agenda note';
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setNoteTaskPopupId(null)}>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-slate-900 mb-3">Task Details</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Task</p>
                  <p className="text-sm text-slate-800">{note.text}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">From</p>
                  <p className="text-sm text-slate-800">{contextName}</p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Assignee</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${note.assignee?.toLowerCase() === myAssigneeKeyLower ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                      {note.assignee?.toLowerCase() === myAssigneeKeyLower ? myDisplayName : (theirDisplayName ?? note.assignee ?? 'Assistant')}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Status</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${note.completed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {note.completed ? 'Complete' : 'Pending'}
                    </span>
                  </div>
                </div>
                {note.email_id && (
                  <button
                    onClick={() => { setNoteTaskPopupId(null); setPopupEmailId(note.email_id || null); }}
                    className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    View Email
                  </button>
                )}
              </div>
              <button onClick={() => setNoteTaskPopupId(null)} className="mt-4 w-full text-sm text-slate-400 hover:text-slate-600 transition-colors">
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* Remind Me Modal */}
      {remindMeEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRemindMeEmailId(null)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Set Reminder
            </h3>
            {(() => {
              const email = emails.find(e => e.id === remindMeEmailId);
              if (!email) return null;

              const setQuickReminder = (hours: number) => {
                const reminder = new Date();
                reminder.setHours(reminder.getHours() + hours);
                setRemindMeDate(reminder.toISOString());
              };

              const setReminderForTime = (hour: number, minute = 0) => {
                const reminder = new Date();
                reminder.setHours(hour, minute, 0, 0);
                if (reminder <= new Date()) {
                  reminder.setDate(reminder.getDate() + 1);
                }
                setRemindMeDate(reminder.toISOString());
              };

              const setReminderForDay = (daysAhead: number) => {
                const reminder = new Date();
                reminder.setDate(reminder.getDate() + daysAhead);
                reminder.setHours(9, 0, 0, 0);
                setRemindMeDate(reminder.toISOString());
              };

              return (
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="font-medium text-slate-900 text-sm truncate">{email.subject}</p>
                  </div>

                  {/* Quick time options */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Quick Options</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setQuickReminder(1)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        In 1 hour
                      </button>
                      <button
                        onClick={() => setQuickReminder(2)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        In 2 hours
                      </button>
                      <button
                        onClick={() => setReminderForTime(15)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        This afternoon
                      </button>
                      <button
                        onClick={() => setReminderForTime(17, 30)}
                        className="px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-medium text-blue-700 border border-blue-200"
                      >
                        End of day
                      </button>
                      <button
                        onClick={() => setReminderForDay(1)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
                      >
                        Tomorrow 9am
                      </button>
                      <button
                        onClick={() => setReminderForDay(7)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
                      >
                        Next week
                      </button>
                    </div>
                  </div>

                  {/* Custom date/time */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Or pick a date & time</label>
                    <input
                      type="datetime-local"
                      value={remindMeDate ? remindMeDate.slice(0, 16) : ''}
                      onChange={(e) => setRemindMeDate(new Date(e.target.value).toISOString())}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      onClick={() => setRemindMeEmailId(null)}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => setReminder(remindMeEmailId, remindMeDate)}
                      disabled={updating === remindMeEmailId || !remindMeDate}
                      className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      Set Reminder
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Task Side Panel (shared across dashboard + tasks page) */}
      {/* Create Task Panel */}
      {taskPanelId && taskPanelMode === 'create' && (
        <>
          <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => { setTaskPanelId(null); setTaskPanelMode('edit'); }} />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">
            <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">New Task</p>
                <input
                  autoFocus
                  type="text"
                  placeholder="Task title..."
                  value={createTaskText}
                  onChange={e => setCreateTaskText(e.target.value)}
                  className="text-lg font-semibold text-slate-900 leading-snug w-full border-b border-slate-200 pb-1 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button onClick={() => { setTaskPanelId(null); setTaskPanelMode('edit'); }} className="text-slate-400 hover:text-slate-600 flex-shrink-0 p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Assignee</p>
                <div className="flex gap-2">
                  {ASSIGNEE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCreateTaskAssignee(opt.value)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        createTaskAssignee === opt.value
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Due Date</p>
                <input type="date" value={createTaskDueDate} onChange={e => setCreateTaskDueDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Priority</p>
                <button onClick={() => setCreateTaskUrgent(!createTaskUrgent)} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${createTaskUrgent ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}>
                  <svg className="w-4 h-4" fill={createTaskUrgent ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  {createTaskUrgent ? 'Urgent' : 'Mark urgent'}
                </button>
              </div>
              <div className="text-xs text-slate-400">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Manual</span>
              </div>
            </div>
            <div className="px-6 pt-4 pb-20 border-t border-slate-100 flex items-center gap-3">
              <button
                disabled={!createTaskText.trim() || createTaskSaving}
                onClick={async () => {
                  setCreateTaskSaving(true);
                  try {
                    const res = await fetch('/api/agenda-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: createTaskText.trim(), type: 'action', assignee: createTaskAssignee }) });
                    if (res.ok) {
                      const { note } = await res.json();
                      setActionNotes(prev => [...prev, note]);
                      if (createTaskUrgent) {
                        // Key MUST match getTaskId() for a note-based task,
                        // which is the raw note id (task.noteId = note.id) —
                        // NOT a `note-` prefixed form, or the urgent lookup
                        // never finds it. Also persist to localStorage under
                        // the same 'taskUrgent' key as toggleTaskUrgent so the
                        // flag survives re-render/reload instead of being lost.
                        const taskId = note.id;
                        setTaskUrgent(prev => {
                          const next = { ...prev, [taskId]: true };
                          localStorage.setItem('taskUrgent', JSON.stringify(next));
                          return next;
                        });
                      }
                      setTaskPanelId(null);
                      setTaskPanelMode('edit');
                    }
                  } catch { /* silent */ }
                  setCreateTaskSaving(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {createTaskSaving ? 'Creating...' : 'Create Task'}
              </button>
              <button onClick={() => { setTaskPanelId(null); setTaskPanelMode('edit'); }} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          </div>
        </>
      )}

      {taskPanelId && taskPanelMode === 'edit' && (() => {
        const panelEmail = taskPanelId.type === 'email' ? emails.find(e => e.id === taskPanelId.id) : null;
        const panelNote = taskPanelId.type === 'note' ? actionNotes.find(n => n.id === taskPanelId.id) : null;
        const panelTask = tasks.find(t => (taskPanelId.type === 'email' && t.emailId === taskPanelId.id) || (taskPanelId.type === 'note' && t.noteId === taskPanelId.id));
        if (!panelTask) return null;

        const parentItem = panelNote ? agendaItemsList.find(item => item.id === panelNote.agenda_item_id || item.email_id === panelNote.email_id) : null;
        const contextName = parentItem?.topic?.name || parentItem?.email?.subject || null;
        const parentEmail = panelNote ? (parentItem?.email || emails.find(e => e.id === panelNote.email_id)) : null;
        const sourceContext = parentEmail?.summary || parentEmail?.action_needed || null;
        const panelTaskId = getTaskId(panelTask);
        const dueDateVal = taskDueDates[panelTaskId] || { date: '', time: '' };
        const lastUpdated = taskLastUpdated[panelTaskId];

        return (
          <>
            <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={() => setTaskPanelId(null)} />
            <div className="fixed top-0 right-0 bottom-0 w-full max-w-[420px] bg-white shadow-2xl z-50 flex flex-col">

              {/* Panel Header — TASK (editable title) + badges */}
              <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Task</p>
                  {panelNote && editingPanelTitle ? (
                    <textarea
                      autoFocus
                      className="text-lg font-semibold text-slate-900 leading-snug w-full border border-slate-200 rounded-lg p-1 resize-none focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      defaultValue={panelNote.text}
                      rows={1}
                      onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                      ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== panelNote.text) saveNoteText(panelNote.id, val);
                        setEditingPanelTitle(false);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setEditingPanelTitle(false); }}
                    />
                  ) : (
                    <h2
                      className={`text-lg font-semibold text-slate-900 leading-snug ${panelNote ? 'cursor-text hover:bg-slate-50 rounded px-1 -mx-1 transition-colors' : ''}`}
                      onClick={() => { if (panelNote) setEditingPanelTitle(true); }}
                    >
                      {panelTask.task}
                    </h2>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                      {panelTask.assignee?.toLowerCase() === myAssigneeKeyLower ? myDisplayName : (theirDisplayName ?? panelTask.assignee ?? '—')}
                    </span>
                    {panelTask.source === 'email' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">From email</span>}
                    {panelTask.source === 'agenda' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-600">From agenda</span>}
                    {panelTask.source === 'manual' && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">Manual</span>}
                    {taskUrgent[panelTaskId] && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Urgent</span>
                    )}
                    {panelTask.isComplete && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700">Complete</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleTaskUrgent(panelTaskId); }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${taskUrgent[panelTaskId] ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-50 text-slate-400 hover:bg-amber-50 hover:text-amber-600'}`}
                    >
                      <svg className="w-3 h-3" fill={taskUrgent[panelTaskId] ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                      {taskUrgent[panelTaskId] ? 'Urgent' : 'Mark urgent'}
                    </button>
                  </div>
                </div>
                <button onClick={() => { setTaskPanelId(null); setEditingPanelTitle(false); }} className="text-slate-400 hover:text-slate-600 flex-shrink-0 p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Panel Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* Due Date + Time */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Due Date</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={dueDateVal.date}
                      onChange={(e) => saveTaskDueDate(panelTaskId, 'date', e.target.value)}
                      className="flex-1 text-sm border border-slate-200 rounded-lg p-2 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    />
                    <input
                      type="time"
                      value={dueDateVal.time}
                      onChange={(e) => saveTaskDueDate(panelTaskId, 'time', e.target.value)}
                      className="w-28 text-sm border border-slate-200 rounded-lg p-2 hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    />
                  </div>
                  {dueDateVal.date && dueDateVal.time && (
                    <p className="text-xs text-slate-400 mt-1.5">A Slack reminder will be sent at this time</p>
                  )}
                </div>

                {/* SOURCE — for agenda notes: agenda item link + AI context */}
                {panelNote && (contextName || sourceContext) && (
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Source</p>
                    {contextName && (
                      <button
                        onClick={() => { setTaskPanelId(null); setEditingPanelTitle(false); setActiveNav('agenda'); }}
                        className="text-sm text-slate-700 hover:text-slate-900 hover:underline font-medium"
                      >
                        {contextName}
                      </button>
                    )}
                    {sourceContext && (
                      <p className="text-sm text-slate-500 italic mt-1 leading-relaxed">{sourceContext}</p>
                    )}
                  </div>
                )}

                {/* SOURCE — for email tasks: email info + summary/action */}
                {panelEmail && (
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Source</p>
                    <p className="text-sm text-slate-700 font-medium">{panelEmail.from_name || panelEmail.from_email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDistanceToNow(parseISO(panelEmail.received_at), { addSuffix: true })}</p>
                    {panelEmail.summary && (
                      <p className="text-sm text-slate-500 italic mt-1.5 leading-relaxed">{panelEmail.summary}</p>
                    )}
                    {!panelEmail.summary && panelEmail.action_needed && panelEmail.action_needed !== 'None' && panelEmail.action_needed !== 'No action needed' && (
                      <p className="text-sm text-slate-500 italic mt-1.5 leading-relaxed">{panelEmail.action_needed}</p>
                    )}
                  </div>
                )}

                {/* Email body + draft (kept for email tasks) */}
                {panelEmail && (
                  <>
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Full Email</p>
                      <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                        {linkifyText(stripSignature(panelEmail.body_text || panelEmail.summary || ''))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Draft Reply</p>
                      <textarea
                        className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none bg-white leading-relaxed"
                        rows={5}
                        placeholder="Draft a reply..."
                        defaultValue={panelEmail.edited_draft || panelEmail.draft_reply || ''}
                        onBlur={(e) => { const val = e.target.value; if (val !== (panelEmail.edited_draft || panelEmail.draft_reply || '')) { saveDraft(panelEmail.id, val, false); touchTaskUpdated(panelTaskId); } }}
                      />
                    </div>
                  </>
                )}

                {/* ASSIGNEE + CREATED/UPDATED row */}
                <div className="flex gap-6">
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Assignee</p>
                    {panelNote ? (
                      <button
                        onClick={() => {
                          if (!hasAssistant || !myAssigneeKey || !theirAssigneeKey) return;
                          const curLower = panelNote.assignee?.toLowerCase() ?? null;
                          const newAssignee = curLower === myAssigneeKeyLower ? theirAssigneeKey : myAssigneeKey;
                          saveNoteAssignee(panelNote.id, newAssignee);
                        }}
                        disabled={!hasAssistant}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 ${hasAssistant ? 'hover:bg-slate-200 cursor-pointer' : ''} transition-colors`}
                      >
                        {panelNote.assignee?.toLowerCase() === myAssigneeKeyLower ? myDisplayName : (theirDisplayName ?? panelNote.assignee ?? '—')}
                        {hasAssistant && (
                          <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                        )}
                      </button>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {panelTask.assignee?.toLowerCase() === myAssigneeKeyLower ? myDisplayName : (theirDisplayName ?? panelTask.assignee ?? '—')}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Created</p>
                    <span className="text-sm text-slate-600">{panelNote ? format(parseISO(panelNote.created_at), 'MMM d, yyyy') : panelEmail ? format(parseISO(panelEmail.received_at), 'MMM d, yyyy') : '—'}</span>
                  </div>
                  {lastUpdated && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Updated</p>
                      <span className="text-sm text-slate-600">{format(parseISO(lastUpdated), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</p>
                  <textarea
                    className="w-full min-h-[80px] text-sm border border-slate-200 rounded-lg p-2 resize-none hover:border-slate-300 focus:ring-2 focus:ring-slate-400 focus:outline-none"
                    placeholder="Add notes about this task..."
                    defaultValue={taskNotes[panelTaskId] || ''}
                    key={panelTaskId}
                    onBlur={(e) => {
                      const val = e.target.value;
                      setTaskNotes(prev => {
                        const next = { ...prev, [panelTaskId]: val };
                        localStorage.setItem('taskNotes', JSON.stringify(next));
                        return next;
                      });
                      touchTaskUpdated(panelTaskId);
                    }}
                  />
                </div>
              </div>

              {/* Panel Footer — Mark Complete removed per spec; only the
                  circle/checkbox on the task card itself toggles completion.
                  pb-20 keeps the Close button clear of the bottom-right FAB
                  (compose button) that sits at `fixed bottom-8 right-8`. */}
              <div className="px-6 pt-4 pb-20 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => { setTaskPanelId(null); setEditingPanelTitle(false); }}
                  className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Create Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              Create Calendar Event
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={eventFormData.title}
                  onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Event title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={eventFormData.date}
                  onChange={(e) => setEventFormData({ ...eventFormData, date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={eventFormData.startTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, startTime: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={eventFormData.endTime}
                    onChange={(e) => setEventFormData({ ...eventFormData, endTime: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  value={eventFormData.location}
                  onChange={(e) => setEventFormData({ ...eventFormData, location: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={eventFormData.description}
                  onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  rows={3}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowEventModal(false)}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={createCalendarEvent}
                disabled={!eventFormData.title || creatingEvent}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingEvent ? 'Creating...' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Urgent Actions Popup */}
      {showUrgentPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Urgent ({urgentAlerts.length})
              </h3>
              <button
                onClick={() => setShowUrgentPopup(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3">
              {urgentAlerts.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No urgent items</p>
              ) : (
                urgentAlerts.map((email) => (
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
                        onClick={() => {
                          setShowUrgentPopup(false);
                          setActiveNav('inbox');
                          setExpandedEmail(email.id);
                          markEmailRead(email.id);
                        }}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        View & Respond
                      </button>
                      <button
                        onClick={() => updateStatus(email.id, 'done')}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        ✓ Done
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
      )}

      {/* Meeting Agenda Popup */}
      {showAgendaPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Meeting Agenda ({agendaItems.length})
              </h3>
              <button
                onClick={() => setShowAgendaPopup(false)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-3">
              {agendaItems.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No items on the agenda. Star emails to add them.</p>
              ) : (
                agendaItems.map((email) => {
                  const isDiscussed = email.meeting_notes?.startsWith('[DISCUSSED]');
                  return (
                    <div key={email.id} className={`bg-white border border-slate-200 rounded-lg p-4 shadow-sm ${isDiscussed ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => {
                            const notes = email.meeting_notes || '';
                            if (isDiscussed) updateMeetingNotes(email.id, notes.replace('[DISCUSSED] ', ''));
                            else updateMeetingNotes(email.id, '[DISCUSSED] ' + notes);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                            isDiscussed ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 hover:border-blue-500'
                          }`}
                        >
                          {isDiscussed && '✓'}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium ${isDiscussed ? 'line-through text-slate-400' : 'text-slate-900'}`}>{email.subject}</p>
                          <p className="text-sm text-slate-500 mt-1">{email.from_name || email.from_email}</p>
                          {editingAgendaId === email.id ? (
                            <div className="mt-2">
                              <textarea
                                value={agendaNoteText}
                                onChange={(e) => setAgendaNoteText(e.target.value)}
                                placeholder="Add notes for this agenda item..."
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => {
                                    updateMeetingNotes(email.id, (isDiscussed ? '[DISCUSSED] ' : '') + agendaNoteText);
                                    setEditingAgendaId(null);
                                  }}
                                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingAgendaId(null)}
                                  className="text-slate-500 hover:text-slate-700 px-2 py-1 text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            email.meeting_notes && (
                              <p className="text-sm text-amber-700 mt-2 bg-amber-100 rounded px-2 py-1">
                                📝 {email.meeting_notes.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '')}
                              </p>
                            )
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 ml-9">
                        <button
                          onClick={() => {
                            setShowAgendaPopup(false);
                            setPopupEmailId(email.id);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          View Email
                        </button>
                        <button
                          onClick={() => {
                            const currentNote = email.meeting_notes?.replace('[DISCUSSED] ', '').replace(/\[@\w+\] /, '') || '';
                            setEditingAgendaId(email.id);
                            setAgendaNoteText(currentNote);
                          }}
                          className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          Edit Notes
                        </button>
                        <button
                          onClick={() => toggleMeetingFlag(email.id, true)}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Important Docs Popup */}
      {showImportantDocsPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Important Docs
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingImportantDocs(!editingImportantDocs)}
                  className="text-slate-400 hover:text-slate-600 text-sm"
                >
                  {editingImportantDocs ? 'Done' : '✏️ Edit'}
                </button>
                <button
                  onClick={() => setShowImportantDocsPopup(false)}
                  className="text-slate-400 hover:text-slate-600 text-xl"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {loadingDocs ? (
                <p className="text-slate-400 text-center py-4">Loading...</p>
              ) : importantDocs.length === 0 ? (
                <p className="text-slate-400 text-center py-4">No documents added yet</p>
              ) : (
                importantDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2">
                    {editingDocId === doc.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editingDocTitle}
                          onChange={(e) => setEditingDocTitle(e.target.value)}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          autoFocus
                        />
                        <button
                          onClick={() => updateImportantDoc(doc.id, editingDocTitle)}
                          className="text-green-500 hover:text-green-700 p-1"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => { setEditingDocId(null); setEditingDocTitle(''); }}
                          className="text-slate-400 hover:text-slate-600 p-1"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 bg-slate-50 hover:bg-slate-100 rounded-lg px-4 py-3 text-slate-700 font-medium transition-colors"
                        >
                          📎 {doc.title}
                        </a>
                        {editingImportantDocs && (
                          <>
                            <button
                              onClick={() => { setEditingDocId(doc.id); setEditingDocTitle(doc.title); }}
                              className="text-slate-400 hover:text-slate-600 p-2"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => deleteImportantDoc(doc.id)}
                              className="text-red-400 hover:text-red-600 p-2"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            {editingImportantDocs && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-sm font-medium text-slate-700 mb-2">Add New Document</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="url"
                    placeholder="URL"
                    value={newDocUrl}
                    onChange={(e) => setNewDocUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    onClick={async () => {
                      if (newDocTitle && newDocUrl) {
                        await addImportantDoc(newDocTitle, newDocUrl);
                        setNewDocTitle('');
                        setNewDocUrl('');
                      }
                    }}
                    disabled={!newDocTitle || !newDocUrl}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    Add Document
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Popup (for viewing from tasks/agenda) */}
      {popupEmail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPopupEmailId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900 text-base leading-snug truncate">{popupEmail.subject}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{popupEmail.from_name || popupEmail.from_email}</p>
              </div>
              <button onClick={() => setPopupEmailId(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto py-4">
              <ExpandedEmailPanel email={popupEmail} />
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
              {popupEmail.attachments && popupEmail.attachments.length > 0 && getGmailUrl(popupEmail.message_id) && (
                <a href={getGmailUrl(popupEmail.message_id)!} target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                  View in Gmail
                </a>
              )}
              <button onClick={() => setPopupEmailId(null)} className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      {showTaskModal && taskModalEmailId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTaskModal(false)}>
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h3 className="text-lg font-semibold text-slate-900">Add Task</h3>
              <button onClick={() => setShowTaskModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            {(() => {
              const email = emails.find(e => e.id === taskModalEmailId);
              if (!email) return null;
              return (
                <div className="p-6 space-y-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500">Related to email:</p>
                    <p className="font-medium text-slate-900 truncate">{email.subject}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Task Description</label>
                    <input
                      type="text"
                      value={taskModalText}
                      onChange={(e) => setTaskModalText(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="Enter task description..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && taskModalText.trim()) {
                          saveTaskFromModal();
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Assign to</label>
                    <div className="flex gap-3">
                      {hasAssistant && theirAssigneeKey && (
                        <button
                          onClick={() => setTaskModalAssignee(theirAssigneeKey)}
                          className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                            taskModalAssignee?.toLowerCase() === theirAssigneeKeyLower
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {theirDisplayName}
                        </button>
                      )}
                      {myAssigneeKey && (
                        <button
                          onClick={() => setTaskModalAssignee(myAssigneeKey)}
                          className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                            taskModalAssignee?.toLowerCase() === myAssigneeKeyLower
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {myDisplayName}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setShowTaskModal(false)}
                      className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveTaskFromModal}
                      disabled={!taskModalText.trim()}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add Task
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {/* Shared TBD Popup — accessible from All Emails and Agenda pages */}
      {showTbdPopup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTbdPopup(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">TBD Emails</h3>
              <button onClick={() => setShowTbdPopup(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
              {tbdEmails.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No TBD emails</p>
              ) : (
                tbdEmails.map((email) => (
                  <div key={email.id} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{email.subject}</p>
                        <p className="text-sm text-slate-500">{email.from_name || email.from_email} · {formatDistanceToNow(parseISO(email.received_at), { addSuffix: true })}</p>
                      </div>
                    </div>
                    {email.summary && <p className="text-sm text-slate-600 mb-1">{email.summary}</p>}
                    {email.action_needed && <p className="text-xs text-slate-500 mb-2"><span className="font-medium">Action needed:</span> {email.action_needed}</p>}
                    {email.tbd_suggestion && (
                      <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 mt-2 mb-3">
                        <p className="text-sm text-teal-800"><span className="font-medium">Emily suggests:</span> {email.tbd_suggestion}</p>
                      </div>
                    )}
                    <textarea
                      defaultValue={email.tbd_notes || ''}
                      onBlur={(e) => {
                        const val = e.target.value;
                        setEmails(prev => prev.map(em => em.id === email.id ? { ...em, tbd_notes: val } : em));
                        fetch('/api/emails/status', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: email.id, tbd_notes: val }),
                        }).catch(err => console.error('Failed to save TBD notes:', err));
                      }}
                      placeholder="Add notes..."
                      rows={2}
                      className="w-full mt-2 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                    />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          updateActionStatus(email.id, null);
                          setEmails(prev => prev.map(e => e.id === email.id ? { ...e, action_status: null, tbd_suggestion: null } : e));
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        Move to Action
                      </button>
                      <button
                        onClick={() => updateStatus(email.id, 'done')}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        Mark Done
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compose Email Modal */}
      {composeOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 w-full max-w-2xl mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">New Email</h3>
              <button
                onClick={() => { setComposeOpen(false); setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeError(null); }}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">To</label>
                <input
                  type="email"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="recipient@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Subject"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Body</label>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                  placeholder="Write your message..."
                />
              </div>
              {composeError && (
                <p className="text-sm text-red-600">{composeError}</p>
              )}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button
                onClick={() => { setComposeOpen(false); setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeError(null); }}
                className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setComposeSending(true);
                  setComposeError(null);
                  try {
                    const res = await fetch('/api/emails/compose', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
                    });
                    const data = await res.json();
                    if (!res.ok || !data.success) {
                      setComposeError(data.error || 'Failed to send');
                    } else {
                      setComposeOpen(false);
                      setComposeTo('');
                      setComposeSubject('');
                      setComposeBody('');
                    }
                  } catch {
                    setComposeError('Failed to send email');
                  } finally {
                    setComposeSending(false);
                  }
                }}
                disabled={!composeTo || !composeSubject || !composeBody || composeSending}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {composeSending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bug report floating button */}
      <BugReportButton activeNav={activeNav} workspaceId={workspaceId ?? null} userEmail={user?.email ?? null} />

      {/* Send Condolence Note modal — opened from a Shiva email card */}
      {shivaModalPayload && (
        <SimchasSendNoteModal
          payload={shivaModalPayload}
          onClose={() => setShivaModalPayload(null)}
          onSent={() => {
            const id = shivaModalPayload.emailId;
            setShivaNoteSent(prev => ({ ...prev, [id]: true }));
            setShivaModalPayload(null);
            setShivaToast('Sent to Emily');
          }}
        />
      )}

      {/* Bottom-right ephemeral toast */}
      {shivaToast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-lg px-4 py-3 shadow-lg z-50 text-sm print:hidden">
          {shivaToast}
        </div>
      )}

      {/* Contextual Slack-send modal — driven by `slackSendContext`. */}
      {slackSendContext !== null && (
        <SlackSendModal contextText={slackSendContext} onClose={() => setSlackSendContext(null)} />
      )}

    </div>
  );
}
