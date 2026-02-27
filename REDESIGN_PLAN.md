# RBK Command Center - Redesign Plan & CLI Prompts

**Created:** February 27, 2026
**Project Owner:** Rebecca Glassberg
**Vision:** "Notion meets Superhuman meets Bloomberg Terminal"

---

## Architecture Overview

The redesign breaks the monolithic 3,361-line `Dashboard.tsx` into focused, maintainable components while implementing the new visual design system. The approach is **page-by-page rebuild** -- we create a new component architecture alongside the existing code, swap in one view at a time, and delete the old code when each section is verified working.

### New File Structure

```
app/
  components/
    layout/
      Sidebar.tsx            # Navigation sidebar
      Header.tsx             # Page header with alerts
      MeetingAlert.tsx       # Upcoming meeting countdown
    dashboard/
      DashboardView.tsx      # Main dashboard page
      SummaryCards.tsx        # Top row cards (urgent, links, docs, agenda)
      TodaySchedule.tsx      # Calendar widget
      TodoToday.tsx          # Action items list
      RBKActionSection.tsx   # RBK action emails preview
    inbox/
      InboxView.tsx          # Email inbox page
      EmailCard.tsx          # Individual email row
      EmailExpanded.tsx      # Expanded email detail
      DraftEditor.tsx        # Draft editing panel
      InboxFilters.tsx       # Search + filter bar
      EmailSection.tsx       # Grouped email section
    agenda/
      AgendaView.tsx         # Meeting agenda page
      AgendaItem.tsx         # Individual agenda item
    tasks/
      TasksView.tsx          # Tasks page
      TaskCard.tsx           # Individual task card
    calendar/
      CalendarView.tsx       # Calendar page
      EventModal.tsx         # Create/edit event modal
    docs/
      ImportantDocsModal.tsx  # Important docs popup
    shared/
      Badge.tsx              # Priority/status badges
      Button.tsx             # Consistent button component
      Modal.tsx              # Reusable modal wrapper
      StatusDropdown.tsx     # Status selector
  hooks/
    useRealtimeEmails.ts     # (existing, keep)
    useEmailActions.ts       # NEW: centralized email actions
    useCalendar.ts           # NEW: calendar data + actions
  lib/
    api.ts                   # NEW: centralized API calls
    constants.ts             # NEW: colors, priorities, statuses
    utils.ts                 # NEW: shared helpers
  styles/
    design-tokens.css        # NEW: CSS custom properties
```

### Design System Tokens

```
Colors:
  Primary:     #1e40af (blue-800)    -- main accent
  Surface:     #ffffff               -- card backgrounds
  Background:  #f8fafc (slate-50)    -- page background
  Sidebar:     #0f172a (slate-900)   -- dark sidebar
  Text:        #0f172a (slate-900)   -- primary text
  Muted:       #64748b (slate-500)   -- secondary text
  Border:      #e2e8f0 (slate-200)   -- card borders

Status Colors (muted, not screaming):
  Urgent:      #dc2626 border only   -- red-600
  Action:      #1e40af border only   -- blue-800
  Done:        #16a34a muted         -- green-600
  Pending:     #d97706 muted         -- amber-600
  Info:        #64748b muted         -- slate-500

Typography:
  Font:        Geist Sans (already loaded)
  Headings:    font-semibold, tracking-tight
  Body:        text-sm (14px), text-slate-700
  Small:       text-xs (12px), text-slate-500
  No emojis in UI chrome -- use Lucide icons only
```

---

## Phase 1: Foundation (Prompts 1-3)

Sets up the design system, shared components, and layout shell.

## Phase 2: Core Views (Prompts 4-7)

Rebuilds each main view: Dashboard, Inbox, Agenda, Tasks.

## Phase 3: Polish & Cleanup (Prompts 8-9)

Calendar view, modals, delete legacy code, fix types.

---

## CLI Prompts

### PROMPT 1: Design Tokens + Shared Constants

```
I'm redesigning the RBK Command Center app (Next.js 16 + Tailwind CSS 4 + React 19).

TASK: Create the design system foundation files. Do NOT modify any existing files yet.

FILE 1: app/styles/design-tokens.css
Create CSS custom properties for our design system:
- Colors: primary (#1e40af), surface (#ffffff), background (#f8fafc), sidebar (#0f172a), text (#0f172a), muted (#64748b), border (#e2e8f0)
- Status colors as borders only: urgent (#dc2626), action (#1e40af), done (#16a34a), pending (#d97706), info (#64748b)
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64
- Border radius: sm (6px), md (8px), lg (12px)
- Shadows: sm, md (subtle, not heavy)
- Transition: default (150ms ease)

FILE 2: lib/constants.ts
Export typed config objects:
- priorityConfig: maps priority keys (rbk_action, eg_action, invitation, meeting_invite, important_no_action, review, fyi) to { label, borderColor (tailwind class), textColor, bgColor, icon (Lucide icon component name -- NO emojis) }
- statusConfig: maps status keys (pending, in_progress, done, archived) to same shape
- draftStatusConfig: maps draft status keys (not_started, editing, draft_ready, approved, needs_revision) to same shape
- actionStatusConfig: maps (send, sent, remind_me, draft_ready, urgent) to same shape
- NAV_ITEMS array: [{id, label, icon (Lucide name)}] for dashboard, inbox, agenda, tasks, calendar

FILE 3: lib/api.ts
Create a centralized API module with typed functions:
- updateEmailStatus(id: string, status: string): Promise<void>
- updateDraft(id: string, editedDraft: string, draftStatus: string): Promise<void>
- flagForMeeting(id: string, flagged: boolean): Promise<void>
- archiveEmail(id: string): Promise<void>
- sendEmail(id: string): Promise<{success: boolean}>
- sendBatchEmails(ids: string[]): Promise<{sent: number, failed: number}>
- fetchCalendarEvents(date: Date, accessToken: string): Promise<CalendarEvent[]>
- createCalendarEvent(event: EventData, accessToken: string): Promise<void>
- deleteCalendarEvent(eventId: string, accessToken: string): Promise<void>
- fetchImportantDocs(): Promise<Doc[]>
- addImportantDoc(title: string, url: string): Promise<Doc>
- deleteImportantDoc(id: string): Promise<void>
All functions should handle errors consistently (try/catch, throw with message).

FILE 4: lib/utils.ts
Export helper functions:
- formatRelativeTime(dateString: string): string -- uses date-fns formatDistanceToNow
- formatTime(dateString: string): string -- "9:00 AM" format
- formatDate(dateString: string): string -- "Feb 27, 2026" format
- formatFileSize(bytes: number): string
- truncate(text: string, maxLength: number): string
- getInitials(name: string): string -- for avatar fallbacks
- isToday(dateString: string): boolean
- isSnoozed(email: {reminder_date?: string | null}): boolean
- matchesSearch(email: Email, query: string): boolean

Use the existing Email and CalendarEvent interfaces from the current Dashboard.tsx (lines 8-56) as the type definitions. Put them in types/index.ts as well (replacing the outdated types/database.ts).

IMPORTANT:
- Use Tailwind CSS 4 syntax (no tailwind.config.ts needed, @theme directive)
- Import Lucide icons like: import { AlertCircle, Mail } from 'lucide-react'
- TypeScript strict mode
- No emojis anywhere in UI code
```

---

### PROMPT 2: Shared UI Components

```
I'm redesigning the RBK Command Center. The design tokens and constants from the previous step exist at lib/constants.ts, lib/api.ts, lib/utils.ts, and app/styles/design-tokens.css.

TASK: Create the shared UI components. These are small, reusable pieces used across all views.

FILE 1: app/components/shared/Badge.tsx
A versatile badge component:
- Props: variant ('priority' | 'status' | 'draft' | 'action'), value (string key), size ('sm' | 'md')
- Looks up colors from the config objects in lib/constants.ts
- Renders: colored dot + text label (no emojis)
- Uses Lucide icons where appropriate
- Tailwind classes: rounded-full, text-xs or text-sm, px-2.5 py-0.5, font-medium
- Border style: 1px solid with the status color

FILE 2: app/components/shared/Button.tsx
Professional button component:
- Props: variant ('primary' | 'secondary' | 'ghost' | 'danger'), size ('sm' | 'md' | 'lg'), icon (optional Lucide icon), children, disabled, loading, onClick
- Primary: bg-blue-800 text-white hover:bg-blue-900
- Secondary: bg-white text-slate-700 border border-slate-200 hover:bg-slate-50
- Ghost: text-slate-500 hover:text-slate-700 hover:bg-slate-100
- Danger: text-red-600 border border-red-200 hover:bg-red-50
- All: rounded-lg, font-medium, transition, focus ring
- Loading state shows a spinner (Lucide Loader2 with animate-spin)
- Icon rendered at size 16px before children text
- NO emojis. Text labels only (or icon-only with aria-label).

FILE 3: app/components/shared/Modal.tsx
Reusable modal wrapper:
- Props: isOpen, onClose, title, children, size ('sm' | 'md' | 'lg')
- Backdrop: fixed inset-0 bg-black/50 backdrop-blur-sm z-50
- Panel: bg-white rounded-xl shadow-xl, centered, max-height 90vh with overflow-auto
- Header: title + X close button (Lucide X icon)
- Animate in with transition (opacity + scale)
- Close on backdrop click and Escape key
- sm: max-w-md, md: max-w-lg, lg: max-w-2xl

FILE 4: app/components/shared/StatusDropdown.tsx
Dropdown for changing email status:
- Props: currentStatus, onStatusChange, disabled
- Options: Pending, In Progress, Done, Archived
- Each option shows colored dot + label
- Uses a native <select> styled with Tailwind for reliability
- Or a custom dropdown with proper keyboard nav

DESIGN RULES for all components:
- White backgrounds for cards/surfaces
- Slate-200 borders (subtle, not heavy)
- Blue-800 as primary accent
- No shadows heavier than shadow-sm
- Rounded-lg (8px) for cards, rounded-full for badges
- Text: slate-900 primary, slate-500 secondary, slate-400 tertiary
- Transitions on hover/focus states (150ms)
- All interactive elements need focus-visible rings
```

---

### PROMPT 3: Layout Shell (Sidebar + Header)

```
I'm redesigning the RBK Command Center. The shared components (Badge, Button, Modal, StatusDropdown) exist at app/components/shared/. Design tokens at app/styles/design-tokens.css. Constants at lib/constants.ts.

TASK: Create the layout components -- Sidebar and Header. These wrap all page content.

FILE 1: app/components/layout/Sidebar.tsx
Dark sidebar navigation:
- Props: activeNav (string), onNavChange (function), userEmail (string), userName (string), onSignOut
- Width: w-64 (256px), fixed height full screen
- Background: bg-slate-900 (dark)
- Top section:
  - App name "RBK Command Center" in white text, text-lg font-semibold
  - Small "Command Center" subtitle in slate-400, text-xs
- Navigation items from NAV_ITEMS constant (lib/constants.ts):
  - dashboard (LayoutDashboard icon), inbox (Inbox icon), agenda (ClipboardList icon), tasks (CheckSquare icon), calendar (Calendar icon)
  - Each item: flex items-center gap-3, px-3 py-2.5, rounded-lg, text-sm
  - Default: text-slate-400 hover:text-white hover:bg-slate-800
  - Active: text-white bg-slate-800, with a 3px blue-500 left border accent
  - Show unread count badge on Inbox if applicable
- Bottom section:
  - User info: initials avatar (bg-blue-800 text-white rounded-full w-8 h-8) + name + email truncated
  - Sign out button: ghost style, text-slate-400
  - Real-time connection indicator: green dot if connected, gray if not

FILE 2: app/components/layout/Header.tsx
Top header bar:
- Props: title (string), subtitle (optional string), children (for right-side actions), urgentCount (number), onUrgentClick
- Height: h-16, border-b border-slate-200, bg-white
- Left: page title (text-xl font-semibold text-slate-900) + optional subtitle (text-sm text-slate-500)
- Right: children slot (for page-specific actions like search, filters)
- If urgentCount > 0: show a subtle red banner below header with "X urgent items need attention" + View button
  - Banner: bg-red-50 border-b border-red-100, text-red-700, text-sm
  - Animated pulse on the count badge

FILE 3: app/components/layout/MeetingAlert.tsx
Floating meeting countdown:
- Props: title (string), minutesUntil (number), meetingLink (string | null), onDismiss
- Position: fixed bottom-4 right-4 z-40
- Style: bg-white border border-amber-200 shadow-lg rounded-xl p-4
- Shows: "Meeting in X min" with meeting title
- If meetingLink: "Join Meeting" button (primary style, opens in new tab)
- Dismiss X button
- Subtle amber left border accent
- Animate in from bottom

Now update app/page.tsx and app/layout.tsx:
- layout.tsx: import design-tokens.css after globals.css
- page.tsx: keep the existing server-side data fetching but pass data to a new wrapper

Create FILE 4: app/components/AppShell.tsx
Client component that wraps Sidebar + Header + content area:
- Props: emails, calendarEvents (same as current Dashboard props)
- Uses useState for activeNav
- Uses useSession for user info
- Uses useRealtimeEmails hook for real-time updates
- Renders: flex layout with Sidebar on left, main content area on right
- Main area: flex-1 flex flex-col, overflow-auto
- Content area below header renders the active view based on activeNav
- For now, just render a placeholder <div> for each view with the view name
- Import MeetingAlert and show it when there's an upcoming meeting (port the useEffect logic from current Dashboard.tsx lines 224-246)

IMPORTANT:
- The existing Dashboard.tsx must NOT be modified or deleted yet
- AppShell.tsx will eventually replace Dashboard.tsx
- Use 'use client' on AppShell.tsx
- Import from existing hooks/useRealtimeEmails.ts
- page.tsx should import AppShell instead of Dashboard (swap the import)
```

---

### PROMPT 4: Dashboard View

```
I'm redesigning the RBK Command Center. The layout (Sidebar, Header, AppShell) is built. Shared components (Badge, Button, Modal) exist. Constants and API helpers are in lib/.

TASK: Build the Dashboard view -- the main landing page RBK sees when he opens the app.

Reference the current implementation in app/components/Dashboard.tsx lines 1136-1564 for the data and logic, but completely redesign the UI.

FILE 1: app/components/dashboard/DashboardView.tsx
Main dashboard container:
- Props: emails (Email[]), calendarEvents (CalendarEvent[]), onNavigate (to switch to inbox/agenda)
- Layout: grid with responsive columns
  - Top row: 4 summary cards in a grid (grid-cols-2 lg:grid-cols-4 gap-4)
  - Below: 2-column layout (lg:grid-cols-5 gap-6)
    - Left column (col-span-3): Today's Schedule + RBK Action emails preview
    - Right column (col-span-2): To-Do Today list

FILE 2: app/components/dashboard/SummaryCards.tsx
Top row of 4 cards:
- Each card: bg-white rounded-xl border border-slate-200 p-5, hover:shadow-sm transition
- Left accent border (4px) in the card's theme color
- Layout: icon (Lucide, 20px, in theme color) + title (text-sm font-medium text-slate-500) + count/value (text-2xl font-bold text-slate-900)
- Cards:
  1. Urgent (red accent): count of urgent/rbk_action pending emails. Click navigates to inbox.
  2. Drafts Ready (blue accent): count of draft_status === 'draft_ready'. Click opens drafts popup.
  3. Meeting Agenda (amber accent): count of flagged_for_meeting emails. Click navigates to agenda.
  4. Important Docs (slate accent): count of important docs. Click opens docs modal.
- Clicking each card triggers the appropriate navigation or modal

FILE 3: app/components/dashboard/TodaySchedule.tsx
Calendar widget (port from current lines 1203-1293):
- Section header: "Today's Schedule" with date, refresh button (RotateCw icon)
- If loading: subtle skeleton animation
- Events list: each event is a row with:
  - Time range (text-xs font-mono text-slate-500): "9:00 AM - 10:00 AM"
  - Title (text-sm font-medium text-slate-900)
  - "Now" badge if event is currently happening (bg-green-100 text-green-700 text-xs)
  - Location if present (text-xs text-slate-400)
  - Meeting link: small video icon button if available
  - All-day events at top with "All Day" badge
- If no events: "No events today" with calendar icon, muted
- Clicking an event opens it in Google Calendar (new tab)
- White card with slate-200 border, rounded-xl

FILE 4: app/components/dashboard/TodoToday.tsx
Action items list (port from current lines 1295-1560):
- Section header: "To-Do Today" with count
- Sub-sections with subtle dividers:
  1. URGENT items (if any): red-50 background strip, red left border
  2. Review Drafts (if any): items with draft_status === 'draft_ready', blue left border
  3. Approved (ready to send): items with draft_status === 'approved', green left border
  4. Action items: rbk_action emails that are pending/in_progress
- Each todo item row:
  - Checkbox (rounded, when checked marks as done via API)
  - Priority badge (small)
  - Subject line (text-sm, truncated)
  - From name (text-xs text-slate-500)
  - Time ago (text-xs text-slate-400)
  - Quick action buttons on hover: Done (Check icon), Flag for Agenda (Flag icon)
- "View All" link at bottom to navigate to inbox
- Empty state: checkmark icon + "All caught up!" message

DESIGN NOTES:
- All cards: white bg, rounded-xl, border border-slate-200
- No shadows except on hover (shadow-sm)
- Text hierarchy: slate-900 > slate-700 > slate-500 > slate-400
- Lucide icons only, 16-20px, in muted colors unless they represent status
- Transitions on all interactive elements
- Professional, clean, spacious -- generous padding (p-5 or p-6 on cards)

Update AppShell.tsx to render DashboardView when activeNav === 'dashboard'.
```

---

### PROMPT 5: Inbox View

```
I'm redesigning the RBK Command Center. Dashboard view is complete. Layout, shared components, and lib helpers are all in place.

TASK: Build the Inbox view -- the core email triage interface. This is the most important view.

Reference current Dashboard.tsx lines 1565-2339 for data/logic, but completely redesign the UI.

DESIGN VISION: Two-column inbox layout inspired by Superhuman/modern email clients.
- Left column: Action emails (RBK + Emily) on a light gray background
- Right column: Info emails (Invitations, Important, Review, FYI) on a slightly darker slate background
- White email cards with colored left borders to indicate priority
- Clean separation between sections

FILE 1: app/components/inbox/InboxView.tsx
Main inbox container:
- Props: emails, setEmails, searchQuery, setSearchQuery
- Top: InboxFilters component (search bar + filter toggles)
- If urgent emails exist: red alert banner at top (bg-red-50, border-red-100)
  - "X urgent items need attention" with View button
- Layout: grid grid-cols-1 xl:grid-cols-2 gap-6
  - Left: action emails (bg-slate-50 rounded-xl p-4)
  - Right: info emails (bg-slate-100 rounded-xl p-4)
- Bulk action bar: appears when emails are selected (fixed bottom, bg-white shadow-lg)
  - Shows count selected + "Mark Done" + "Clear Selection" buttons

FILE 2: app/components/inbox/InboxFilters.tsx
Search and filter bar:
- Search input: w-full, rounded-lg, border-slate-200, Search icon (Lucide), placeholder "Search emails..."
- Filter row below search: toggle buttons for showing/hiding sections
  - Each toggle: pill-shaped, text-xs, shows section name + count
  - Active: filled background in section color, inactive: outline only
- "Show Archived" toggle on the right
- "X results" count text

FILE 3: app/components/inbox/EmailSection.tsx
Grouped section of emails:
- Props: title, emails, variant ('action' | 'info'), priority, icon (Lucide), onEmailAction, selectedEmails, onToggleSelect
- Section header: icon + title + count badge + "Select All" checkbox + "Mark All Done" button
- Collapsible (chevron toggle)
- Maps over emails rendering EmailCard for each
- Empty state: small muted text "No [section] emails"
- Section title colors: muted, using the priority's text color

FILE 4: app/components/inbox/EmailCard.tsx
Individual email card (the most critical component):
- Props: email, isExpanded, onToggle, isSelected, onToggleSelect, onStatusChange, onFlag, onAction
- COLLAPSED STATE (default):
  - White card, rounded-lg, border border-slate-200
  - Left border: 3px in priority color (blue for rbk_action, etc.)
  - Layout: single row with checkbox + priority dot + content + actions
    - Checkbox: rounded, for bulk selection
    - From name (font-medium text-sm text-slate-900, truncated)
    - Subject (text-sm text-slate-700, truncated)
    - Summary preview (text-xs text-slate-500, truncated to 1 line)
    - Time ago (text-xs text-slate-400, right-aligned)
    - Attachment icon if has attachments (Paperclip, text-slate-400)
    - Priority badge (small)
    - Draft status badge if applicable
  - Hover: shadow-sm, bg-slate-50
  - If done/archived: opacity-60, line-through on subject
  - If flagged for meeting: small flag icon (amber)
  - Click anywhere (except buttons/checkbox) to expand

- EXPANDED STATE (when clicked):
  - Card grows, white bg, slightly elevated shadow-md
  - Full content revealed below the header row:
    - Summary section: "Summary" label + full summary text
    - Action Needed: if present, highlighted in blue-50 box with AlertCircle icon
    - Full email body: in a bordered container, max-height with scroll
    - Attachments: list with file icons and sizes
  - Action buttons row (always visible at bottom of expanded card):
    - Primary actions (always shown with text labels):
      - Done (Check icon, green border)
      - Urgent (AlertTriangle icon, red border)
      - Agenda (Flag icon, amber border)
    - Secondary actions (icon-only, with tooltips):
      - Remind Me (Bell icon)
      - Calendar (CalendarPlus icon)
      - Archive (Archive icon)
    - Status dropdown (right side)
  - Draft section below actions (if draft exists):
    - Render via DraftEditor component

FILE 5: app/components/inbox/DraftEditor.tsx
Draft viewing and editing panel:
- Props: email, onSave, onSend, onRequestRevision
- Shows current draft (AI-generated or edited)
- Draft status badge at top
- If not editing: display draft text in a styled container
  - "Edit Draft" button, "Copy" button, "Approve" button (if Emily), "Send" button (if approved)
- If editing: textarea with the draft, character count
  - "Save Draft" button (marks as editing), "Mark Ready" button (marks as draft_ready)
- Revision section: if needs_revision, show revision comment in orange-50 box
- "Request Revision" button (for RBK): opens inline comment field
- Sent status: if action_status === 'sent', show green checkmark + "Sent" label

SECTIONS IN INBOX (left column):
1. RBK Action Required (red-600 left border, AlertCircle icon)
2. Emily Action (blue-600 left border, UserCheck icon)

SECTIONS IN INBOX (right column):
3. Invitations (purple-600 left border, Mail icon)
4. Meeting Requests (green-600 left border, Calendar icon)
5. Important (amber-600 left border, Star icon)
6. Review (slate-500 left border, Eye icon)
7. FYI (slate-400 left border, Info icon)

Update AppShell.tsx to render InboxView when activeNav === 'inbox'.

CRITICAL DESIGN RULES:
- White cards on gray backgrounds = visual separation
- Left colored borders = category identification (NOT background colors)
- No emojis anywhere
- Generous whitespace between cards (gap-3)
- Smooth expand/collapse transitions
- Batch actions work via checkbox selection
- All email CRUD operations use the centralized lib/api.ts functions
```

---

### PROMPT 6: Agenda View

```
I'm redesigning the RBK Command Center. Dashboard and Inbox views are complete.

TASK: Build the Agenda view -- where RBK and Emily review flagged items for their daily meeting.

Reference current Dashboard.tsx lines 2340-2429 for logic.

FILE 1: app/components/agenda/AgendaView.tsx
Meeting agenda page:
- Props: emails, setEmails
- Header: "Meeting Agenda" title + date + "Clear All" button (with confirmation)
- Get flagged emails: emails.filter(e => e.flagged_for_meeting)
- If no flagged items: empty state with ClipboardList icon + "No items flagged for discussion" + "Flag emails from the inbox to add them here"
- If items exist:
  - Count badge: "X items to discuss"
  - List of AgendaItem components
  - Each section grouped by priority (urgent first, then rbk_action, then others)
  - "Add Notes" section at bottom: textarea for general meeting notes

FILE 2: app/components/agenda/AgendaItem.tsx
Individual agenda item:
- Props: email, onRemove, onUpdateNotes, onStatusChange
- Card: white bg, rounded-xl, border border-slate-200, p-4
- Left: amber-500 left border (3px) to indicate agenda item
- Content:
  - Priority badge + From name + Subject
  - Summary (text-sm text-slate-600)
  - Action needed (if present, in blue-50 highlighted box)
  - Meeting notes textarea (expandable, auto-save on blur)
  - Assigned to selector: "RBK" / "Emily" toggle
- Actions:
  - Remove from agenda (X button, unflag)
  - Mark Done (Check icon)
  - Quick status change dropdown
- Notes are saved via PATCH to /api/emails/[id]/flag with meeting_notes field

DESIGN NOTES:
- Clean, focused layout -- this is a working document for meetings
- Large, readable text (meeting context = often on a screen or tablet)
- Easy to tap/click (touch-friendly for tablet PWA use)
- White cards, subtle borders, plenty of space
- Amber accent for agenda theme
```

---

### PROMPT 7: Tasks View

```
I'm redesigning the RBK Command Center. Dashboard, Inbox, and Agenda views are complete.

TASK: Build the Tasks view -- a kanban-style or list view of all actionable emails.

Reference current Dashboard.tsx lines 2430-2496 for logic. Also reference the user's inspiration of "floating, moveable task cards."

FILE 1: app/components/tasks/TasksView.tsx
Tasks page with column layout:
- Props: emails, setEmails
- Filter to actionable emails: rbk_action and eg_action priorities
- Layout: 3 columns (responsive, stack on mobile)
  - Column 1: "To Do" (status === 'pending') -- slate-50 bg
  - Column 2: "In Progress" (status === 'in_progress') -- blue-50 bg
  - Column 3: "Done" (status === 'done', last 20 only) -- green-50 bg
- Each column:
  - Header with count badge
  - Scrollable list of TaskCard components
  - Column accent: subtle top border in column color
- Quick filters at top: "All" / "RBK" / "Emily" toggle
- Search bar specific to tasks

FILE 2: app/components/tasks/TaskCard.tsx
Individual task card:
- Props: email, onStatusChange, onViewEmail
- Card: white bg, rounded-lg, border border-slate-200, p-4
- Content:
  - Priority badge (small) + assigned badge ("RBK" or "Emily")
  - Subject (font-medium text-sm)
  - From (text-xs text-slate-500)
  - Summary (text-xs text-slate-600, 2 lines max)
  - Time received (text-xs text-slate-400)
  - Draft status badge if applicable
  - Attachment indicator
- Actions (bottom of card):
  - Quick status buttons: arrow-right to move to next column
  - "View Email" to expand full email detail (opens modal or navigates to inbox with that email expanded)
- Hover: lift with shadow-sm
- Visual indicator for overdue/snoozed items

DESIGN NOTES:
- Column layout inspired by Trello/Linear but simpler
- No drag-and-drop needed (keep it simple) -- use buttons to move between columns
- Cards should feel lightweight and scannable
- The "Done" column shows items with reduced opacity
- Mobile: columns stack vertically, each collapsible
```

---

### PROMPT 8: Calendar View + Modals

```
I'm redesigning the RBK Command Center. Dashboard, Inbox, Agenda, and Tasks views are complete.

TASK: Build the Calendar view and remaining modal components.

FILE 1: app/components/calendar/CalendarView.tsx
Full calendar page:
- Props: calendarEvents, session (for access token)
- Date navigation: left/right arrows + "Today" button + selected date display
- Uses fetchCalendarForDate from lib/api.ts when date changes
- Event list for selected day (same style as TodaySchedule but full-width)
- "Create Event" button (opens EventModal)
- Each event card:
  - Time, title, location
  - Meeting link button if available
  - Delete button (with confirmation) for user-created events
  - Link to open in Google Calendar

FILE 2: app/components/calendar/EventModal.tsx
Create event modal (port from Dashboard.tsx lines 2817-3079):
- Uses shared Modal wrapper
- Form fields: title, date, start time, end time, location, description
- "Create Event" submit button
- Calls createCalendarEvent from lib/api.ts
- Loading state while creating
- Success: close modal, refresh events
- Error: show error message

FILE 3: app/components/docs/ImportantDocsModal.tsx
Important docs popup (port from Dashboard.tsx lines 3080-end):
- Uses shared Modal wrapper
- List of saved docs with title + URL
- Each doc: clickable link (opens in new tab) + delete button (in edit mode)
- "Add Document" form: title input + URL input + Add button
- "Edit" toggle to show/hide delete buttons
- Uses lib/api.ts for CRUD operations
- Empty state: "No important docs saved yet"

FILE 4: Update app/components/inbox/EmailCard.tsx
Add "Remind Me" functionality:
- When Remind Me is clicked, show inline date picker (not a separate modal)
- Date picker: input type="date" with min=tomorrow
- "Set Reminder" button saves reminder_date via API
- If email has reminder_date in the future, show Bell icon with date
- Snoozed emails are filtered out of main inbox (shown in separate "Snoozed" section)

FILE 5: Update AppShell.tsx
- Render CalendarView when activeNav === 'calendar'
- Wire up ImportantDocsModal (shown via state, triggered from SummaryCards)
- Wire up the drafts ready popup (list of approved drafts with "Send All" option)
- Add keyboard shortcut: 'g' then 'd' for dashboard, 'g' then 'i' for inbox, etc. (like Gmail/Superhuman)

DESIGN: Same principles -- white surfaces, slate borders, blue accents, Lucide icons, no emojis.
```

---

### PROMPT 9: Cleanup + Type Fixes + Final Polish

```
I'm completing the RBK Command Center redesign. All new views are built and working.

TASK: Clean up legacy code, fix types, and polish the final product.

STEP 1: Delete legacy files
- Delete app/components/EmailDashboard.tsx (legacy duplicate, not used)
- Delete the old app/components/Dashboard.tsx (replaced by new component architecture)
- Delete app/components/TodayAgenda.tsx (replaced by TodaySchedule in dashboard/)

STEP 2: Fix types/database.ts
Replace the current types/database.ts with accurate types that match the actual Supabase schema AND what the UI uses. Include all fields:
- id, thread_id, message_id, from_email, from_name, subject, body_text, body_html
- priority (union type of 7 values)
- summary, action_needed, draft_reply, edited_draft
- draft_status ('not_started' | 'editing' | 'draft_ready' | 'approved' | 'needs_revision')
- draft_edited_by, draft_edited_at
- action_status ('send' | 'sent' | 'remind_me' | 'draft_ready' | 'urgent' | null)
- assigned_to ('rbk' | 'emily')
- status ('pending' | 'in_progress' | 'done' | 'archived')
- is_unread, flagged_for_meeting, flagged_by, flagged_at, meeting_notes
- received_at, created_at, updated_at
- attachments (JSON array of {name, type, size})
- reminder_date, revision_comment
- message_id (for Gmail operations)
Also export CalendarEvent, ImportantDoc, and other shared types.

STEP 3: Update globals.css
- Import design-tokens.css
- Set body font to Geist Sans (var(--font-geist-sans))
- Remove dark mode styles (not needed for this app)
- Add smooth scrolling
- Add selection color (blue-100)
- Ensure no default browser style conflicts

STEP 4: Update layout.tsx
- Theme color to match new sidebar: #0f172a (slate-900)
- Verify PWA manifest colors match

STEP 5: Polish pass
- Verify all components use consistent spacing (p-4, p-5, p-6 scale)
- Verify all text uses the typography scale (text-xs through text-xl)
- Verify all colors are from the design token palette
- Add aria-labels to all icon-only buttons
- Add loading skeletons for data-fetching states
- Ensure mobile responsiveness: sidebar collapses to hamburger menu on mobile
- Test that all API calls use lib/api.ts (no raw fetch() in components)

STEP 6: Run build
- Run `npm run build` and fix any TypeScript errors
- Verify no unused imports or variables
- Ensure all pages render without errors

IMPORTANT: Do NOT delete anything until you've verified the new components are fully functional. Build first, then clean up.
```

---

## Execution Order

Run the prompts in order (1 through 9). Each prompt builds on the previous one. After each prompt:

1. Run `npm run build` to check for errors
2. Run `npm run dev` and visually verify in browser
3. Fix any issues before moving to the next prompt

### Estimated Timeline

| Prompt | Task | Est. Time |
|--------|------|-----------|
| 1 | Design tokens + constants + API + utils | 15-20 min |
| 2 | Shared UI components | 10-15 min |
| 3 | Layout shell (sidebar + header) | 15-20 min |
| 4 | Dashboard view | 20-25 min |
| 5 | Inbox view (largest) | 30-40 min |
| 6 | Agenda view | 10-15 min |
| 7 | Tasks view | 15-20 min |
| 8 | Calendar + modals | 20-25 min |
| 9 | Cleanup + polish | 15-20 min |
| **Total** | | **~2.5-3.5 hours** |

---

## Key Design Decisions (Quick Reference)

- **No emojis** in UI chrome. Lucide icons only.
- **White cards** on gray/slate backgrounds for separation.
- **Colored left borders** (3px) to indicate priority/category.
- **Blue-800** as the single primary accent color.
- **Slate palette** for all neutrals (900, 700, 500, 400, 200, 100, 50).
- **Status colors are muted**: only borders and small badges, never loud backgrounds.
- **Red is reserved** for truly urgent items only.
- **Geist Sans** font throughout.
- **No heavy shadows** -- shadow-sm on hover only.
- **Single scroll** -- no nested scroll zones.
- **Sticky header** with the page title and urgent alert.
- **Dark sidebar** (slate-900) with light text.
- **Mobile**: sidebar becomes a slide-out drawer with hamburger toggle.
