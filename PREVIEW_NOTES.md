# RBK Command Center - Preview Notes
**Prepared for Rabbi Krauss | February 2026**

---

## Executive Summary

The RBK Command Center is a custom email triage dashboard designed to help Rabbi Krauss and Emily manage his inbox more efficiently. The app automatically processes incoming emails, categorizes them by priority, drafts responses, and provides a unified view of emails, calendar, tasks, and meeting agenda items.

**Current Status:** Core functionality is complete and ready for daily use. The app successfully:
- Pulls emails automatically via Google Apps Script
- Categorizes and prioritizes emails using AI
- Displays today's calendar with meeting links
- Tracks tasks and meeting agenda items
- Sends approved email replies directly from the dashboard

**What's Working Well:**
- Email triage workflow (view, categorize, draft, approve, send)
- Calendar integration with one-click meeting joins
- Bulk actions to quickly clear email backlogs
- Real-time updates when new emails arrive

**Areas for Feedback:** We'd love input on the workflow, what's missing, and what would make this more useful day-to-day.

---

## Features In Place

### Email Management
- **Automatic Email Import** - New emails pulled every 5 minutes via Google Apps Script
- **AI-Powered Triage** - Emails automatically categorized (RBK Action, Emily Action, Important, Review, Invitations, FYI)
- **AI Draft Replies** - Suggested responses generated for emails needing replies
- **Draft Editing & Approval** - Edit drafts, mark as ready, approve, then send
- **Send Emails** - Send approved replies directly from the dashboard (with RBK's signature)
- **Bulk Actions** - "Mark All Done" buttons on each section, plus multi-select with checkboxes
- **Email Search** - Search by subject, sender, or content
- **Attachments** - View attachment info; "View Attachments" link to Gmail when needed

### Calendar Integration
- **Today's Schedule** - Shows upcoming events on the dashboard
- **Calendar Navigation** - Browse previous/next days
- **Meeting Links** - One-click "Join" buttons for Zoom/Google Meet/Teams
- **Create Events** - Add calendar events from the dashboard or directly from emails
- **Delete Events** - Remove events from the calendar
- **Auto Token Refresh** - No manual sign-out/in required

### Tasks & Agenda
- **Task Assignment** - Create tasks from emails, assign to RBK or Emily
- **Task Tracking** - Mark tasks complete, hide completed tasks
- **Meeting Agenda** - Flag emails to discuss, add notes, mark as discussed
- **Email Popup** - View full email details from tasks/agenda without leaving the page

### Quick Access
- **Important Docs** - Customizable links to frequently used documents (add, edit, delete)
- **Quick Links** - Direct access to Today's Folder, Daily Announcements, Daily Folder
- **Drafts Ready Counter** - See how many emails are ready to send at a glance

### Technical
- **Real-time Updates** - Email list updates automatically when changes occur
- **Secure Authentication** - Google OAuth with automatic token refresh
- **Mobile Responsive** - Works on tablet/desktop (mobile optimization pending)

---

## Roadmap / Future Features

### High Priority
- **Email Threading** - View conversation history for email chains
- **Snooze/Remind Later** - Temporarily hide emails and resurface them later
- **Quick Reply Templates** - Pre-written responses for common situations
- **Email Forwarding** - Forward emails to others directly from the dashboard

### Medium Priority
- **Analytics Dashboard** - Track email volume, response times, busiest days
- **Recurring Tasks** - Tasks that repeat on a schedule
- **Calendar Event Templates** - Quick-create common meeting types
- **Notification System** - Browser/email alerts for urgent items

### Nice to Have
- **Dark Mode** - Easier on the eyes for evening use
- **Keyboard Shortcuts** - Power-user navigation
- **Mobile App** - Native iOS/Android experience
- **Integration with Other Tools** - Slack notifications, etc.

---

## UI/Design Notes

### Areas with Focused Design Work
These sections have had intentional design attention and should feel polished:

1. **Dashboard - Top Half**
   - Summary cards (Urgent Actions, Quick Links, Important Docs, Meeting Agenda)
   - Today's Schedule section with calendar navigation
   - My Tasks section with expandable task details

2. **Sidebar Navigation**
   - Clean navigation with icons
   - Active state highlighting
   - User profile and sign-out

3. **All Emails Page**
   - Two-column layout (Action emails left, Categories right)
   - Color-coded sections by priority
   - Expandable email cards with full details
   - Search bar with clear functionality
   - Bulk selection with floating action bar

4. **Email Cards (Expanded)**
   - Summary, action needed, draft reply sections
   - Status buttons with visual feedback
   - Attachment display
   - Quick action buttons (Add to Calendar, Add to Tasks, Add to Agenda)

### Areas Still Using Basic Styling
These work functionally but haven't had design polish yet:

1. **Meeting Agenda Page** - Functional but basic layout
2. **Tasks Page** - Simple two-column list view
3. **Popup Modals** - Functional but could be more refined
4. **Mobile Views** - Not yet optimized for small screens
5. **Dashboard - Bottom Half** - Urgent Emails and Emily's Queue sections

### Design Consistency Notes
- Color palette: Sky blue (primary), with amber/orange for warnings, red for urgent
- All buttons have hover states and click feedback (scale animation)
- Cards use subtle shadows and rounded corners
- Gradient headers on sections for visual hierarchy

---

## Known Issues / Limitations

1. **Calendar Access** - User must have access to RBK's calendar (sharing required)
2. **Attachments** - Can't download directly; must click through to Gmail
3. **Email Threading** - Each email shown separately, no conversation view yet
4. **Apps Script Trigger** - Must run under RBK's account for proper access

---

## Questions for Feedback

1. Is the email categorization accurate? Any categories that should be added/changed?
2. Are the AI-generated draft replies helpful? Too formal/informal?
3. What's missing from the daily workflow?
4. Any actions you do frequently that should have a shortcut?
5. How does the calendar integration feel? Missing any info?
6. Thoughts on the visual design? Anything hard to read or find?

---

## Technical Details (For Reference)

- **Frontend:** Next.js 14 with React, TypeScript, Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Authentication:** NextAuth.js with Google OAuth
- **Email Processing:** Google Apps Script + Claude AI
- **Hosting:** Vercel
- **Calendar/Email APIs:** Google Calendar API, Gmail API

---

*Document prepared by Rebecca Glassberg with Claude AI assistance*
