# RBK Command Center - Preview Notes
**Prepared for Rabbi Krauss | February 2026**
**Last Updated: February 19, 2026**

---

## Executive Summary

The RBK Command Center is a custom email triage dashboard designed to help Rabbi Krauss and Emily manage his inbox more efficiently. The app automatically processes incoming emails, categorizes them by priority, drafts responses, and provides a unified view of emails, calendar, tasks, and meeting agenda items.

**Current Status:** Core functionality is complete and ready for daily use. Major UI/UX improvements completed on Feb 19, 2026.

---

## Features In Place

### Email Management
- **Automatic Email Import** - New emails pulled every 5 minutes via Google Apps Script
- **AI-Powered Triage** - Emails automatically categorized (RBK Action, Emily Action, Important, Review, Invitations, FYI)
- **AI Draft Replies** - Suggested responses generated for emails needing replies
- **Draft Editing & Approval** - Edit drafts, mark as ready, approve, then send
- **Request Revision** - Send drafts back to Emily with comments for revision
- **Send Emails** - Send approved replies directly from the dashboard (with RBK's signature)
- **Send All Approved** - Bulk send all approved drafts at once
- **Gmail Archive on Done** - Marking email as "Done" archives it in Gmail automatically
- **Bulk Actions** - "Mark All Done" buttons on each section, plus multi-select with checkboxes
- **Email Search** - Search by subject, sender, or content
- **Remind Me** - Snooze emails with time options (1 hour, 2 hours, this afternoon, tomorrow, next week, custom)

### Calendar Integration
- **Today's Schedule** - Shows upcoming events on the dashboard (past events auto-hidden)
- **Meeting Countdown** - Alert in header when meeting starts within 5 minutes with Join button
- **Calendar Navigation** - Browse previous/next days
- **Meeting Links** - One-click "Join" buttons for Zoom/Google Meet/Teams
- **Create Events** - Add calendar events from the dashboard or directly from emails
- **Delete Events** - Remove events from the calendar
- **Auto Token Refresh** - No manual sign-out/in required

### Tasks & Agenda
- **To-Do Today** - Combined view showing urgent items, drafts to review, ready to send, and tasks
- **Task Assignment** - Create tasks from emails, assign to RBK or Emily
- **Task Tracking** - Mark tasks complete with draft editing right from task view
- **Meeting Agenda** - Flag emails to discuss, add notes, mark as discussed

### Navigation & Organization
- **Emily's Queue** - Separate page for Emily's action items (with "Needs Revision" section)
- **Important Docs** - Customizable links to frequently used documents
- **Quick Links** - Direct access to Today's Folder, Daily Announcements, Daily Folder

### Technical
- **Real-time Updates** - Email list updates automatically when changes occur
- **Secure Authentication** - Google OAuth with automatic token refresh
- **Two-way Gmail Sync** - Archive emails in Gmail when marked done

---

## Recently Completed (Feb 19, 2026)

### Dashboard Redesign
- Renamed "Urgent Needs Your Action" to "RBK Action Emails"
- Removed Emily's Queue from dashboard (now separate page)
- Replaced "My Tasks" with "To-Do Today" combining urgent/drafts/tasks
- Made Today's Schedule more compact
- Added meeting countdown alert in header

### Action Button Cleanup
- Removed Status row (pending/in_progress/done/archived)
- Removed Escalate button
- Removed explicit Archive button (auto-archive on Done)
- Consolidated to: Mark Done, Mark Urgent, Remind Me + icon buttons
- Renamed "Draft Ready" to "Review Draft"

### Draft Workflow
- Request Revision sends draft back to Emily with comment
- Emily's Queue shows "Needs Revision" section prominently
- Send All Approved for bulk sending
- Edit Draft works from all locations (dashboard, tasks, etc.)

### Remind Me
- Time-based options: 1 hour, 2 hours, this afternoon, end of day
- Date-based options: Tomorrow 9am, Next week
- Custom datetime picker
- Snoozed emails hidden until reminder time

### Gmail Integration
- Mark Done now archives email in Gmail
- Bulk actions also archive in Gmail

### UI Polish
- Button styling standardized across all email sections
- Mark Urgent button added to all email categories
- "More" dropdown menu for secondary actions (Add to Agenda, Calendar, Remind Me, Task)
- Click-outside handler to close dropdowns

---

## Roadmap / Future Features

### High Priority (Next Up)
- [x] **Button Styling Audit** - Standardize all buttons to match All Emails page style (DONE)
- [x] **Urgent Button Everywhere** - Add Mark Urgent option to all email sections (DONE)
- [x] **Drop-down Action Menu** - Implement proper dropdown for RBK/Emily Action Emails (DONE)

### Medium Priority
- [ ] **Email Threading** - View conversation history for email chains
- [ ] **Quick Reply Templates** - Pre-written responses for common situations
- [ ] **Email Forwarding** - Forward emails to others directly from the dashboard
- [ ] **Department Dashboards** - Cooper Fund dashboard with live spreadsheet data

### Lower Priority
- [ ] **Slack Integration** - Connect Notify Emily to Slack
- [ ] **Analytics Dashboard** - Track email volume, response times, busiest days
- [ ] **Notification System** - Browser/email alerts for urgent items

### Future / Longer Term
- [ ] **Two-way Gmail Sync** - Full sync so all Gmail actions reflect in dashboard
- [ ] **Standalone App** - Package for use by other admins
- [ ] **Dark Mode**
- [ ] **Keyboard Shortcuts**
- [ ] **Mobile App**

---

## Known Issues / Limitations

1. **Gmail Scope** - Users need to sign out and back in after updates to grant new permissions
2. **Calendar Access** - User must have access to RBK's calendar (sharing required)
3. **Attachments** - Can't download directly; must click through to Gmail
4. **Email Threading** - Each email shown separately, no conversation view yet

---

## Technical Details

- **Frontend:** Next.js 14 with React, TypeScript, Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Authentication:** NextAuth.js with Google OAuth
- **Email Processing:** Google Apps Script + Claude AI
- **Hosting:** Vercel
- **Calendar/Email APIs:** Google Calendar API, Gmail API

---

*Document prepared by Rebecca Glassberg with Claude AI assistance*
