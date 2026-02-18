# RBK Command Center - Meeting Notes & Next Steps
**Date:** February 18, 2026
**Attendees:** Rebecca (RBK), Emily Gray (EG)
**Sessions:** Two working sessions (morning + afternoon)

---

## Completed During Meetings

These items were built, tested, and confirmed working during today's sessions:

### Session 1 (Morning)
- [x] Switched webhook URL from Zapier to custom API endpoint
- [x] Ran SQL migrations in Supabase for new columns (attachments, etc.)
- [x] Enabled real-time subscriptions for emails table in Supabase
- [x] Ran security fixes in Supabase
- [x] Emails now flowing live into the dashboard from Apps Script
- [x] Edit Draft popup working (click pencil icon to edit AI-generated drafts)
- [x] Attachment metadata capture added (SQL column + Apps Script update)
- [x] Two-column layout implemented on email page (list on left, detail on right)
- [x] Urgent alert banner implemented on email page
- [x] "View in Gmail" button added to email detail view
- [x] Real-time live indicator added to dashboard

### Session 2 (Afternoon)
- [x] Urgent Actions button on dashboard made clickable with popup showing urgent emails
- [x] Quick Links section added to dashboard (Today's Folder, Daily Folder, Daily Announcements)
- [x] "Important Docs" section replaced "My Tasks" button on dashboard
- [x] Meeting Agenda button made clickable with popup showing today's meetings
- [x] My Tasks section made expandable on dashboard
- [x] Add Event from dashboard confirmed working (creates real Google Calendar events)
- [x] Sidebar icons changed from emojis to white icons
- [x] "View in Gmail" button repositioned next to attachment indicator
- [x] SQL migration run for Important Docs database table
- [x] Various UI refinements and layout adjustments

---

## Bugs & Issues to Fix

These are broken or incorrect behaviors that need to be resolved:

| # | Issue | Details |
|---|-------|---------|
| 1 | **Email sending not working** | "Send All" drafts button returned "0 of 2 emails failed" - send functionality needs debugging |
| 2 | **Vercel deployment failing** | Failed deploy hook error - changes made locally are not pushing to the live site |
| 3 | **Draft workflow inconsistent** | Draft editing/workflow only showing on some emails, not all - should appear on every email |
| 4 | **Draft "from" field wrong** | AI-generated draft replies are attributed to wrong sender - needs Apps Script fix to set correct "from" address |
| 5 | **Email count mismatch** | Dashboard showing incorrect total email counts that don't match actual data |
| 6 | **Clear test data** | Fake/test emails need to be purged from the database before going live |

---

## Design Refinements

UI/visual changes discussed but not yet implemented:

### Dashboard
- [ ] Top action buttons: make font bigger and bolder, same size as section headers
- [ ] Numbers inside buttons should be smaller than the text
- [ ] Buttons should have more ombre/gradient effect with 3D raised appearance
- [ ] Remove remaining emojis from dashboard (use icons only)

### Email Page
- [ ] Blue category bars should be lighter/more muted
- [ ] Subject line and sender name should be **bolded**
- [ ] Right-column email categories: use clean gray ombre gradient
- [ ] Overall color palette more muted and professional (ombre gradients instead of flat bold colors)

### General
- [ ] Blue ombre gradient for action-required category cards
- [ ] Gray ombre gradient for less important/informational categories

---

## Next Steps - Immediate Priorities

Features and functionality to build next:

### 1. Important Docs Section (Fully Functional)
- Add ability to add new document links (URL + title)
- Edit existing document links
- Remove/delete document links
- All links persist in Supabase database (already has table)
- Should work across all devices/browsers

### 2. Draft Reply Workflow Improvements
- Every email should have option to "Add Draft Reply" (not just AI-generated ones)
- Draft workflow states: Edit → Mark Ready for Review → RBK Approves → Send
- Drafts marked "ready for review" should appear in the Tasks section on dashboard
- Fix the inconsistent visibility of draft editing controls

### 3. Calendar Enhancements
- Add ability to delete events from the calendar view
- Add arrow navigation to view upcoming days (not just today)
- "Add to Calendar" option directly from an email

### 4. Tasks Improvements
- Full redesign of the Tasks page
- Add task categories (custom categories that users can create)
- Collapsible category sections
- "Add to Tasks" option directly from an email
- "Add to Agenda" option from tasks

### 5. Email Page Features
- Search bar for filtering/finding emails
- All emails should display "Add Draft Reply" button
- Better attachment handling for Review category (avoid needing to go back to Gmail)

### 6. Meeting Agenda
- Make meeting agenda editable directly from the popup (not just view-only)

### 7. Fix Deployment Pipeline
- Debug and resolve Vercel failed deploy hook
- Ensure GitHub pushes trigger successful Vercel builds
- Verify environment variables are correct on Vercel

---

## Future Features - Down the Line

These were discussed as longer-term goals, not immediate priorities:

### Notifications & Alerts
- [ ] Slack notification when something is marked urgent
- [ ] Email notification to Emily when urgent item arrives

### Staff & Student Management
- [ ] Daily staff absences from Amy/Paycom (automate the daily email from Amy)
- [ ] Student absences pulled from Veracross query
- [ ] Admissions sheet link integration

### External Integrations
- [ ] Connect to Emily's Google Tasks
- [ ] Connect to RBK's Google Tasks
- [ ] Cooper Fund query integration
- [ ] Parent app connected to Veracross

### AI Features
- [ ] Chatbot integration for quick queries about emails/tasks
- [ ] Enhanced AI insights in daily briefing

### Content
- [ ] Announcements tab/section
- [ ] Today's Folder / Daily Folder automation

---

## Notes & Context

- The app has been primarily developed using **Claude CLI** in a separate session from the planning conversations
- **Real-time email flow is working**: Apps Script → Webhook API → Supabase → Dashboard (live updates)
- **Google Calendar integration is confirmed working** from the dashboard
- Emily and RBK are actively using and testing the app during development
- The Vercel deployment issue is a blocker for sharing the live URL - currently only works on localhost
- The design direction is: clean, modern, professional - modeled after financial dashboards with dark sidebar, blue accents, white cards, subtle gradients
