# RBK Command Center - Project Structure

## Tech Stack
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS (utility classes inline, minimal CSS files)
- **Auth:** Firebase Auth (client-side) with session cookies
- **Database:** Supabase (emails, important docs)
- **Calendar:** Google Calendar API
- **Hosting:** Firebase Hosting
- **CI/CD:** GitHub Actions

---

## Directory Structure

```
RBK_Command_Center/
├── app/
│   ├── api/                        # Next.js API routes
│   │   ├── auth/
│   │   │   ├── session/route.ts    # POST - set __session cookie from Firebase ID token
│   │   │   └── signout/route.ts    # POST - clear session cookie
│   │   ├── calendar/
│   │   │   ├── create/route.ts     # POST - create Google Calendar event
│   │   │   ├── delete/route.ts     # DELETE - delete Google Calendar event
│   │   │   └── today/route.ts      # GET - fetch calendar events for a given date
│   │   ├── emails/
│   │   │   ├── [id]/
│   │   │   │   ├── archive/route.ts # POST - archive email in Gmail
│   │   │   │   ├── draft/route.ts   # PATCH - save/update draft reply
│   │   │   │   ├── flag/route.ts    # PATCH - toggle meeting flag, update meeting notes
│   │   │   │   └── send/route.ts    # POST - send email via Gmail API
│   │   │   ├── send-batch/route.ts  # POST - send multiple approved drafts
│   │   │   └── status/route.ts      # PATCH - update email status, action_status, priority
│   │   ├── health/route.ts          # GET - health check endpoint
│   │   ├── important-docs/route.ts  # GET/POST/PUT/DELETE - manage important docs in Supabase
│   │   └── webhook/email/route.ts   # POST - webhook for incoming email processing
│   │
│   ├── components/
│   │   ├── AuthProvider.tsx         # Firebase auth context, session cookie refresh (every 10 min)
│   │   ├── Dashboard.tsx            # PRIMARY UI - 3,362 lines, monolith component (see details below)
│   │   ├── EmailDashboard.tsx       # LEGACY - older dashboard, no longer primary
│   │   ├── TodayAgenda.tsx          # Standalone calendar agenda (used by EmailDashboard, not Dashboard)
│   │   └── shared/
│   │       ├── Badge.tsx            # Reusable badge with Lucide icons (NOT used by Dashboard.tsx)
│   │       ├── Button.tsx           # Reusable button: primary/secondary/ghost/danger, loading state
│   │       ├── Modal.tsx            # Reusable modal: backdrop, escape-to-close, sm/md/lg sizes
│   │       ├── StatusDropdown.tsx   # Accessible dropdown with keyboard nav for email status
│   │       └── index.ts            # Barrel export for shared components
│   │
│   ├── hooks/
│   │   └── useRealtimeEmails.ts     # Supabase realtime subscription for live email updates
│   │
│   ├── globals.css                  # Tailwind import, light/dark CSS variables, body font
│   ├── styles/
│   │   └── design-tokens.css        # Design tokens: colors, spacing, radius, shadows, transitions
│   ├── layout.tsx                   # Root layout: Geist fonts, PWA meta, AuthProvider wrapper
│   ├── login/page.tsx               # Login page (Firebase Google sign-in)
│   ├── page.tsx                     # Home page: server component, fetches emails + calendar, renders Dashboard
│   └── favicon.ico
│
├── lib/
│   ├── api.ts                       # API helper utilities
│   ├── auth.ts                      # Server-side auth: getAuthSession() from Firebase session cookie
│   ├── constants.ts                 # Config objects for priority, status, draft, action badges + nav items
│   ├── firebase-admin.ts            # Firebase Admin SDK initialization
│   ├── firebase-client.ts           # Firebase client SDK initialization
│   ├── supabase.ts                  # Supabase client initialization
│   └── utils.ts                     # General utility functions
│
├── types/
│   ├── database.ts                  # Supabase database type definitions
│   └── index.ts                     # Shared TypeScript types
│
├── middleware.ts                     # Next.js middleware (auth redirect logic)
│
├── google-apps-script/
│   └── email-triage.gs              # Google Apps Script for email intake/triage
│
├── supabase-migrations/
│   └── 001_add_email_columns.sql    # Database migration
├── supabase-schema.sql              # Full database schema
│
├── public/
│   ├── 404.html
│   ├── manifest.json                # PWA manifest
│   ├── sar-logo.jpg
│   └── *.svg                        # Static assets
│
├── archive/
│   ├── DESIGN_PLAN.md
│   └── MEETING_NOTES_2026-02-18.md
│
├── .github/workflows/
│   ├── firebase-hosting-merge.yml
│   └── firebase-hosting-pull-request.yml
│
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── firebase.json
├── .firebaserc
├── .gitignore
├── .env / .env.local
└── *.md                             # Documentation files
```

---

## Key Component Details

### Dashboard.tsx (3,362 lines) - Primary UI

This is the main monolith component containing all dashboard functionality.

**Interfaces:**
- `Email` - full email record (id, from, subject, summary, body, priority, status, draft fields, flags, attachments, reminders)
- `CalendarEvent` - calendar event (id, title, times, location, meeting link)
- `Attachment` - email attachment (name, type, size)

**Inline Config Objects:**
- `priorityConfig` - 7 priority levels: rbk_action, eg_action, invitation, meeting_invite, important_no_action, review, fyi
- `statusConfig` - 4 statuses: pending, in_progress, done, archived
- `actionStatusConfig` - 5 action statuses: send, sent, remind_me, draft_ready, urgent
- `draftStatusConfig` - 5 draft statuses: not_started, editing, draft_ready, approved, needs_revision

**State (~30 useState hooks):**
- Navigation: activeNav (dashboard/inbox/emily/agenda/tasks)
- Email: expandedEmail, searchQuery, showArchived, selectedEmails (bulk)
- Drafts: editingDraftId, draftText, showDraftsPopup, sendingBatch
- Meeting: editingNotesId, notesText, notesAssignee
- Calendar: selectedDate, scheduleEvents, showEventModal, eventFormData
- Tasks: expandedTask, hideCompletedTasks, showTaskModal
- Popups: showUrgentPopup, showAgendaPopup, showImportantDocsPopup
- Revision: revisionEmailId, revisionComment
- Reminders: remindMeEmailId, remindMeDate

**Inline Sub-Components:**
- `Badge` - renders priority/status badges with emoji icons
- `EmailCard` - expandable email card with actions (mark done, urgent, remind, flag, calendar, draft editing, send)
- `SummaryCard` - gradient stat card for dashboard overview

**Views (switched by activeNav):**
1. **Dashboard** - Summary cards (Urgent, Quick Links, Important Docs, Meeting Agenda) + Today's Schedule + To-Do Today (urgent, drafts, approved, tasks) + RBK Action Emails
2. **Inbox** - Two-column layout: Left (RBK Action, Emily Action, Drafts Ready button) + Right (collapsible: Important No Action, Review, Invitations, FYI) + search bar + bulk selection bar
3. **Emily's Queue** - Needs Revision section + regular Emily queue with EmailCards
4. **Agenda** - Meeting agenda items with discussed/undiscussed toggle, action item assignment
5. **Tasks** - Two-column: RBK Tasks + Emily Tasks with completion toggles

**Global Modals (always rendered):**
- Draft Editor Modal
- Request Revision Modal
- Remind Me Modal (quick options: 1h, 2h, afternoon, EOD, tomorrow, next week + custom datetime)
- Create Calendar Event Modal
- Urgent Actions Popup
- Meeting Agenda Popup
- Important Docs Popup (with add/edit/delete)
- Email Popup (view from tasks/agenda)
- Task Creation Modal

**API Functions:**
- `updateStatus()` - update email status, auto-archive in Gmail when marking done
- `updateActionStatus()` - set urgent, remind_me, etc.
- `requestRevision()` - send draft back to Emily with comment
- `setReminder()` - snooze email until future date
- `toggleMeetingFlag()` - add/remove from meeting agenda
- `updateMeetingNotes()` - save task/note on email
- `toggleTaskComplete()` - mark task done via [DONE] tag in notes
- `saveDraft()` / `approveDraft()` - draft reply workflow
- `sendEmail()` - send via Gmail API
- `createCalendarEvent()` - create Google Calendar event
- `fetchCalendarForDate()` / `navigateDate()` - calendar navigation
- `markSelectedDone()` / `markSectionDone()` - bulk operations
- Important docs CRUD: `addImportantDoc()`, `deleteImportantDoc()`, `updateImportantDoc()`

**Effects:**
- Upcoming meeting countdown (checks every 30s, alerts within 5 min)
- Load important docs on mount

---

### Shared Components (in app/components/shared/)

These exist but are **NOT currently used** by Dashboard.tsx, which has its own inline implementations.

| Component | Props | Description |
|-----------|-------|-------------|
| `Badge` | variant (priority/status/draft/action), value, size | Renders colored badge with Lucide icon from constants.ts config |
| `Button` | variant (primary/secondary/ghost/danger), size, icon, loading | Styled button with loading spinner, icon support |
| `Modal` | isOpen, onClose, title, size, children | Overlay modal with backdrop blur, escape-to-close, body scroll lock |
| `StatusDropdown` | currentStatus, onStatusChange, disabled | Accessible dropdown with keyboard nav for email status changes |

---

### lib/constants.ts

Defines `ConfigItem` interface and exports config records used by shared Badge component:
- `priorityConfig` - 7 priorities with label, borderColor, textColor, bgColor, icon (Lucide icon name)
- `statusConfig` - 4 statuses
- `draftStatusConfig` - 5 draft statuses
- `actionStatusConfig` - 5 action statuses
- `NAV_ITEMS` - navigation items (dashboard, inbox, agenda, tasks, calendar)

**Note:** Dashboard.tsx duplicates these configs inline with a different format (using emoji icons instead of Lucide icon names).

---

### Styling

- **globals.css** (27 lines) - Tailwind import, CSS custom properties for light/dark mode, body font-family
- **design-tokens.css** (41 lines) - Tailwind `@theme` block defining design tokens:
  - Colors: primary (#1e40af), surface, background, sidebar, text, muted, border
  - Status colors: urgent (red), action (blue), done (green), pending (amber), info (slate)
  - Spacing scale: 4px to 64px
  - Border radius: sm (6px), md (8px), lg (12px)
  - Shadows: sm, md
  - Transition: 150ms ease

**In practice:** Nearly all styling is done via Tailwind utility classes directly in JSX. The design tokens are defined but Dashboard.tsx uses hardcoded Tailwind classes rather than the token values.

---

### Data Flow

1. **Email Intake:** Google Apps Script (`email-triage.gs`) processes incoming emails → sends to webhook → stored in Supabase
2. **Server Rendering:** `page.tsx` fetches emails from Supabase + calendar from Google API → passes as props to Dashboard
3. **Client Updates:** `useRealtimeEmails` hook subscribes to Supabase realtime for live updates
4. **Actions:** Dashboard makes API calls to Next.js routes → routes update Supabase/Gmail/Calendar
5. **Auth:** Firebase Auth (Google sign-in) → session cookie → middleware validates on each request
