# RBK Command Center — How It Works
**Source of truth for current system architecture, features, and technical details**
_Last updated: March 2026_

---

## Overview

The RBK Command Center is a custom web app built for Rabbi Krauss (RBK) and his assistant Emily. It consolidates email triage, tasks, meeting agendas, projects, student absences, calendar, and community events into a single dashboard.

**Live URL:** https://rbk-cmd-center.web.app  
**Local path:** ~/DevProjects/RBK_Command_Center  
**Deploy command:** `npm run build && npx firebase deploy`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 + `@tailwindcss/typography` |
| Rich Text | Tiptap (bold, italic, underline, strikethrough, bullet/ordered lists, links) |
| Database | Supabase (PostgreSQL) |
| Auth | Firebase Auth (Google OAuth) + session cookies |
| Hosting | Firebase Hosting |
| Scheduled Jobs | Firebase Cloud Functions (Cloud Scheduler) |
| Email Pipeline | Google Apps Script (runs in RBK's Gmail) — **see pivot note below** |
| Student Data | Veracross API (OAuth2 client credentials) |
| Calendar | Google Calendar API |

---

## Key Files

### Core UI
- `app/components/Dashboard.tsx` — Main UI (~5900 lines). All views: Dashboard, Inbox, Agenda, Tasks, Projects, Absences, Simchas & Shivas, Emily's Queue
- `app/components/TiptapEditor.tsx` — Reusable rich text editor (dynamically imported, SSR disabled)
- `app/components/AuthProvider.tsx` — Auth context provider
- `app/components/shared/` — Badge, Button, Modal, StatusDropdown

### API Routes (`app/api/`)

| Route | Method(s) | Purpose |
|-------|-----------|---------|
| `webhook/email/route.ts` | POST | Inbound email from Apps Script. Auth via `WEBHOOK_SECRET`. Remaps `priority='drafts_ready'` → `priority='rbk_action'` + `draft_status='draft_ready'`. On duplicate (23505), updates `draft_status` if provided. |
| `emails/status/route.ts` | PATCH | Updates status, action_status, draft_status, priority, reminder_date, revision_comment, tbd_suggestion, tbd_notes, draft_reply, edited_draft |
| `emails/[id]/send/route.ts` | POST | Sends email via Gmail API. No approval gate — sends as long as draft has content. |
| `emails/[id]/archive/route.ts` | POST | Archives in Gmail (removes INBOX label) |
| `emails/[id]/draft/route.ts` | PATCH | Draft editing and approval |
| `emails/[id]/flag/route.ts` | PATCH | Flag for meeting / update meeting_notes |
| `emails/send-batch/route.ts` | POST | Batch send all approved drafts |
| `gmail/process-email/route.ts` | POST | Adds "RBK/Done" label + removes INBOX label. Fire-and-forget. |
| `gmail/trash-email/route.ts` | POST | Moves to Gmail trash (reversible). Fire-and-forget. |
| `calendar/today/route.ts` | GET | Fetch Google Calendar events for a date |
| `calendar/week/route.ts` | GET | Fetch full Mon–Sun week events (used by Simchas & Shivas for shiva events) |
| `calendar/create/route.ts` | POST | Create calendar event |
| `calendar/delete/route.ts` | DELETE | Delete calendar event |
| `agenda-items/route.ts` | GET/POST/PATCH/DELETE | Agenda items CRUD. POST supports email/topic/manual item_type. PATCH supports bulk reorder + tags. |
| `agenda-items/topics/route.ts` | CRUD | Recurring topics management |
| `agenda-notes/route.ts` | GET/POST/PATCH/DELETE | Agenda notes + standalone tasks. POST allows `type='action'` with no email_id. PATCH supports `completed` field. |
| `important-docs/route.ts` | GET/POST/PUT/DELETE | Important docs stored in Supabase |
| `projects/route.ts` | GET/POST/PATCH/DELETE | Projects CRUD. GET excludes archived. DELETE soft-archives (`status='archived'`). |
| `gemara/route.ts` | GET/POST/PATCH/DELETE | Gemara resources CRUD |
| `simchas/route.ts` | GET | Fetches SAR Bar/Bat Mitzvah public iCal feed, parses VEVENT blocks, filters to current week. 5-min cache. |
| `absences/route.ts` | GET | Fetches today's absences from Veracross. OAuth2 client credentials. Paginates students. Excludes HS and present students. Queries `attendance_cache` for YTD + consecutive counts. |
| `absences/sync/route.ts` | GET | Syncs Veracross attendance to `attendance_cache`. Protected by `SYNC_SECRET`. Modes: `?mode=daily` or `?mode=backfill`. |
| `auth/session/route.ts` | POST | Sets `__session` cookie from Firebase ID token. Preserves Google access token across refreshes. 24h cookie. |
| `auth/signout/route.ts` | POST | Clears session cookie |
| `health/route.ts` | GET | Health check |

### Config & Libs
- `lib/auth.ts` — Auth utilities and session handling
- `lib/supabase.ts` — Supabase client init
- `lib/firebase-client.ts` — Firebase client SDK
- `lib/firebase-admin.ts` — Firebase Admin SDK (verifyIdToken)
- `types/index.ts` — Shared TypeScript interfaces
- `hooks/useRealtimeEmails.ts` — Supabase real-time subscription for live email updates

---

## Email Pipeline (Current State + Pivot Note)

### How It Currently Works
1. **Google Apps Script** runs every 15 min in RBK's Gmail
2. AI-categorizes emails via OpenAI
3. Sends webhook to `https://rbk-cmd-center.web.app/api/webhook/email`
4. Webhook stores emails in Supabase `emails` table
5. Dashboard reads from Supabase in real time

**Gmail labels created by Apps Script:**
- `RBK` / `Emily` / `Important No Action` / `Review` / `Invitations` / `FYI` / `Shivas` — priority labels
- `Drafts Ready` — Emily applies this manually when a draft is ready for RBK
- `Drafts Synced` — Script swaps `Drafts Ready` to this after syncing (prevents reprocessing)
- `RBK/Done` — Applied by Command Center when email is marked done; also removes INBOX label

### Drafts Ready Flow (Current — Partially Working)
1. Emily writes a draft reply in Gmail
2. Emily applies "Drafts Ready" label to the email thread
3. `syncDraftsReadyLabel()` function in Apps Script runs every 15 min
4. Finds the Gmail draft matching the thread, sends to webhook with `draft_status: 'draft_ready'`
5. Webhook remaps priority and updates Supabase
6. Email appears in "Drafts Ready" section in Command Center

**Known issue:** Emails already existing in DB from prior syncs don't get their `draft_reply` field updated on duplicate — the 23505 conflict handler doesn't update `draft_reply`. Fix pending.

### ⚠️ Pivot Decision (March 2026)
After troubleshooting in a live session with Emily, we identified key limitations of the Google Apps Script approach:
- **Can't be debugged remotely** — requires access to RBK's Gmail to test and run scripts
- **Not scalable** — scripts are tied to a specific user's Gmail account
- **Circular errors** — the Apps Script `getEmailData` helper was missing, the date format was wrong, `sendToCommandCenter` had field mismatches — all required Emily to manually edit code line-by-line during the session

**Direction:** Move email functions (tagging, label syncing, draft syncing) from Google Apps Script into Firebase Cloud Functions using the Gmail API directly. This would allow:
- Full debugging from the dev environment
- Testing with a separate Firebase instance under Becca's own Gmail
- Scalability to other users/principals in the future

**Short-term:** Apps Script stays for now (it does triage/categorization and that part works). The `Drafts Ready` label sync is on hold pending the architecture decision.

---

## Features

### Dashboard (Home)
- **Top 4 cards:** Urgent (emails + tasks), Quick Links, Important Docs, Gemara
- **Today's Schedule** — calendar sidebar with past events auto-hidden, meeting countdown banner (5-min alert with Join link)
- **To-Do Today** — unified list of urgent tasks, drafts to review, emails to send, tasks due today. Urgent tasks sort to top with rose-50 bg + amber border.

### Email Inbox (All Emails page)
- Two-column layout: Left (RBK Action, Emily Action) + Right (collapsible: Important, Review, Invitations, FYI, Shivas, Untagged)
- **Drafts Ready** and **TBD** buttons pinned above the two-column layout
- **ExpandedEmailPanel** — unified expanded view everywhere (two-panel: thread left, draft right)
- Thread support — emails with matching `thread_id` shown chronologically
- Email body URLs linkified to clickable links
- Priority color coding, bulk selection, search (auto-expands collapsed sections)
- **Shivas section** — emails with `action_status='shiva'`, collapsed by default
- **Untagged section** — emails with no valid priority, last 14 days only. "Move to..." dropdown or "Mark Junk" (also trashes in Gmail). "All Junk" bulk button.
- On mark done: email labeled "RBK/Done" + archived from Gmail inbox (fire-and-forget)
- Snooze with reminder dates

### TBD (Holding Area)
- Amber TBD toggle on any email card; parks email outside priority sections
- TBD popup modal for RBK to review/act
- Emily's Queue "Needs Your Input" section — Emily adds suggestions via `TbdInputCard`
- Teal notification dot on TBD button when Emily has suggestions
- TBD section also appears on Agenda page

### Meeting Agenda
- Items from `agenda_items` table — types: email, topic, manual
- "+" Add Item button with inline form (title + optional email link)
- Topics as tags (chips on agenda items, not separate items)
- Drag-and-drop reorder
- Threaded notes per item (single chronological stream, `type='note'`)
- View Email, Add to Projects, Mark Discussed controls per item

### Tasks
- 3 data sources: email-derived (meeting_notes), agenda note-derived (`type='action'`), standalone
- Two-column layout: RBK / Emily
- Drag-and-drop reorder (persisted to localStorage)
- Urgent toggle (stored in localStorage `taskUrgent`)
- Side panel: editable title, due date+time, notes, assignee toggle, source badge, full email body
- Completion: toggles `completed` in Supabase (agenda tasks) or `[DONE]` marker in meeting_notes (email tasks)

### Projects (Kanban Board)
- 11 department columns, horizontal scroll
- Cards draggable between columns (updates `department` via PATCH)
- Column order drag-and-drop (persisted to localStorage)
- Side panel: status toggle, priority pills, progress slider, Tiptap description + updates editor, "Also involves" department tags
- Soft-archive delete

### Student Absences
- Pulls live from Veracross API (OAuth2 client credentials)
- Excludes HS students (grading_period !== 29) and present students
- Three sections: Absent / Tardy / Early Dismissal (collapsible)
- YTD badge per student (from `attendance_cache`)
- "Needs Follow-Up" amber alert: 3+ consecutive absences OR 15+ YTD
- Firebase scheduled function `syncDailyAttendance` runs weekdays at 6 PM ET — upserts all records to `attendance_cache`
- Backfill completed: 93,685 records from Sept 2, 2025 – Mar 9, 2026

### Faculty Absences (Planned — Not Built)
- Tracked in Paycom (HR system), not Veracross
- Becca does not have a Paycom account — requires meeting with Amy or Paycom API access
- Amy currently sends manual spreadsheets (today's absences + YTD accrual balance)
- Becca has a Google Apps Script on Amy's email/spreadsheet for partial automation (Paycom email parsing)
- Goal: build a similar page to student absences, grouped by department, for RBK

### Simchas & Shivas
- **Bar/Bat Mitzvahs** — pulled from SAR public iCal feed (`barbatmitzvah@saracademy.org`), filtered to current week
- **Shivas & Funerals** — filtered from RBK's Google Calendar (current week), matched by "shiva", "funeral", "levaya" in title
- Two design layouts (A = week grid, B = side-by-side cards)
- **Planned:** "Attending" tag Emily can toggle per Bar/Bat Mitzvah, visible on calendar and weekly view

### Simchas & Shivas — Attending Tag (Planned)
- Emily marks whether RBK is attending each Bar/Bat Mitzvah
- Shows visually on the weekly view (e.g., "ATTENDING" badge)
- Corresponding event would appear on RBK's personal calendar

### Emily's Queue
- Emily's action items, Needs Revision emails, TBD "Needs Your Input" section
- Separate page from main dashboard

---

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `emails` | All emails (priority, status, draft fields, meeting flags, TBD fields, reminder_date) |
| `agenda_notes` | Notes + standalone tasks. `type`: note/decision/action. `completed` boolean. `email_id` nullable. |
| `agenda_items` | Meeting agenda items. `item_type`: email/topic/manual. `tags text[]`. |
| `recurring_topics` | Tag library for agenda items |
| `important_docs` | Important document links |
| `projects` | Kanban projects. Includes `links JSONB`, `tags text[]`. |
| `gemara_items` | Gemara links and notes for RBK's class |
| `attendance_cache` | Veracross attendance records. Unique on `(person_id, attendance_date)`. |

---

## localStorage State

| Key | Shape | Purpose |
|-----|-------|---------|
| `taskOrder` | `Record<string, string[]>` | Drag-and-drop task ordering |
| `taskDueDates` | `Record<string, {date, time}>` | Task due dates with optional time |
| `taskNotes` | `Record<string, string>` | Free-form task notes |
| `taskUrgent` | `Record<string, boolean>` | Urgent flag per task |
| `taskLastUpdated` | `Record<string, string>` | ISO timestamp of last task edit |
| `projectUpdates` | `Record<string, Array<{text, timestamp}>>` | Per-project update feed |
| `projectColumnOrder` | `string[]` | Custom kanban column order |

---

## Auth Flow
1. Firebase Google OAuth sign-in
2. `auth/session/route.ts` sets `__session` cookie from Firebase ID token (24h)
3. Middleware validates on each request
4. Google access token preserved across periodic ID token refreshes
5. `refreshGoogleToken()` does silent `signInWithPopup` with all scopes (calendar + gmail.send + gmail.modify) on 401

---

## Firebase Scheduled Functions (`functions/src/index.ts`)
- **`syncDailyAttendance`** — Pub/Sub, weekdays at 11 PM UTC (6 PM ET). Calls `/api/absences/sync?mode=daily` with `SYNC_SECRET` auth header.

---

## Environment Variables (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
WEBHOOK_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
VERACROSS_CLIENT_ID
VERACROSS_CLIENT_SECRET
VERACROSS_SCHOOL_ROUTE=sar
SYNC_SECRET
```

---

## Files to Ignore / Archive
The following files in the repo are outdated and can be ignored or deleted:
- `DEPLOYMENT_GUIDE.md` — references Vercel (deprecated). Firebase is the host now.
- `PREVIEW_NOTES.md` — old preview notes from February, superseded by this doc
- `project-structure.md` — accurate for structure but some details outdated
- `README.md` — very outdated (references NextAuth, Vercel, old stack)
- `SUPABASE_SETUP.md` — one-time setup doc, no longer needed
- `app/components/EmailDashboard.tsx` — legacy component, not the primary UI
