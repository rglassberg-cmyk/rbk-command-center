# RBK Command Center — Project Context

## Overview

Next.js 16 app serving as a unified operations dashboard for Rebecca (RBK) and Emily. Deployed to Firebase Hosting at **https://rbk-cmd-center.web.app**, with Supabase as the database and Firebase Auth (Google OAuth) for authentication.

**Tech stack:** Next.js 16 + React 19 + Tailwind CSS + Supabase + Firebase (Auth, Hosting, Cloud Functions)

## Key Files

### Core UI

- **`app/components/Dashboard.tsx`** — Main UI component (~3700 lines). Contains all views: Dashboard, Inbox, Agenda, Tasks, Emily's Queue. Handles state, data derivation, and interactions.
- **`app/components/EmailDashboard.tsx`** — Email dashboard wrapper
- **`app/components/TodayAgenda.tsx`** — Today's agenda component
- **`app/components/AuthProvider.tsx`** — Auth context provider
- **`app/components/shared/`** — Reusable components (Badge, Button, Modal, StatusDropdown)

### API Routes (`app/api/`)

- **`agenda-notes/route.ts`** — CRUD for agenda notes (GET, POST, PATCH, DELETE)
- **`emails/status/route.ts`** — Email status updates
- **`emails/[id]/flag/route.ts`** — Flag emails for meeting, update meeting_notes
- **`emails/[id]/draft/route.ts`** — Draft editing and approval
- **`emails/[id]/send/route.ts`** — Send emails via Gmail API
- **`emails/[id]/archive/route.ts`** — Archive emails
- **`emails/send-batch/route.ts`** — Batch email sending
- **`calendar/today/route.ts`** — Fetch Google Calendar events
- **`calendar/create/route.ts`** — Create calendar events
- **`calendar/delete/route.ts`** — Delete calendar events
- **`auth/session/route.ts`** — Session management
- **`auth/signout/route.ts`** — Sign out
- **`health/route.ts`** — Health check
- **`important-docs/route.ts`** — Important docs list
- **`webhook/email/route.ts`** — Inbound email webhook

### Config & Libs

- **`lib/auth.ts`** — Auth utilities and session handling
- **`lib/supabase.ts`** — Supabase client initialization
- **`lib/firebase-client.ts`** — Firebase client SDK setup
- **`types/index.ts`** — Shared TypeScript interfaces (Email, CalendarEvent, Doc, etc.)
- **`types/database.ts`** — Database type definitions
- **`hooks/useRealtimeEmails.ts`** — Real-time email subscription hook

## Current Features

### Email Inbox
- Two-panel layout with categorized email lists (RBK Action, Emily Action, Important, Review, Invitation, FYI)
- Priority color coding with dots and badges
- Popup modal for viewing full email details
- Draft editing with approve/revision workflow
- Send via Gmail API with batch support
- Archive functionality
- Snooze with reminder dates
- Search across all fields

### Meeting Agenda
- Left sidebar showing today's calendar schedule
- Numbered agenda items (emails flagged for meeting)
- Threaded notes per agenda item saved to Supabase `agenda_notes` table
- Inline note adding via simple text input (defaults to type "note")
- Each note displays inline type pills (Note / Decision / Action) — click to change type via PATCH
- Action-type notes show inline assignee toggle (Emily / RBK) — also updates via PATCH
- Tab strip filter: All | Notes | Decisions | Actions
- "Set as Current" indicator for active discussion item
- Mark as discussed checkbox per item
- Delete note and remove from agenda controls

### Tasks
- Pulls from two sources:
  1. Email-derived tasks: emails with `meeting_notes` containing `[@RBK]` or `[@EMILY]` markers
  2. Agenda note-derived tasks: agenda notes with `type='action'` and an assignee
- Two-column layout split by assignee (RBK / Emily)
- Email tasks show subject line, "View" link to popup, and toggle-complete checkbox
- Agenda note tasks show "From agenda notes" label with amber action indicator
- Dashboard view also shows RBK tasks inline with expandable email details

### Calendar
- Google Calendar API integration
- Fetches events on mount with date navigation
- Token refresh logic with silent retry on 401
- Create and delete events
- Meeting countdown alert (checks every 30 seconds)
- Shows in agenda sidebar and dashboard sidebar

### Dashboard
- Calendar events sidebar (today's schedule)
- Summary cards: urgent emails, drafts ready, drafts approved
- RBK tasks with expandable email previews
- Meeting countdown banner
- Quick access to all views via nav

### Emily's Queue
- Filtered view of Emily's action items and needs-revision emails

## Supabase Tables

### `emails`
Main email storage with fields for priority, status, draft management, meeting flags, and meeting notes.

### `agenda_notes`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `email_id` | uuid | FK to emails table |
| `text` | text | Note content |
| `type` | text | `'note'` \| `'decision'` \| `'action'` |
| `assignee` | text | `'rbk'` \| `'emily'` \| null |
| `created_at` | timestamp | Auto-set on insert |

## Deployment

```bash
# Build and deploy
npm run build && npx firebase deploy

# Also deployed to Vercel
npx vercel --prod
```

- **Firebase:** https://rbk-cmd-center.web.app
- **Vercel:** https://rbk-command-center.vercel.app

## Known Pending Items

- **Projects page** — mockup design, eventual Monday.com integration
- **Standalone tasks and agenda items** — items not tied to emails
- **Tasks page visual redesign** — improved layout and interaction patterns
