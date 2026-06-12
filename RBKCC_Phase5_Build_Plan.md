# RBK Command Center - Phase 5 Build Plan
## Post-Emily Gray Meeting #3 + Emily Daniel Session (May 11, 2026)

---

## TIER 0: IMMEDIATE (Becca is with Emily Daniel now)

### 1. Manual Grade Overrides for Enrollment
- **Problem**: Veracross API doesn't expose `student_group_applying_for` for current students. This affects:
  - Students repeating a grade (counted in wrong row)
  - Infant/Toddler being two grades in one (some move to 2YN, others stay in older ITC class)
  - Pisgah students (same API gap)
- **Solution**: Manual override system stored in Supabase, merged at display time
- **Database**: New table `enrollment_grade_overrides`:
  ```sql
  CREATE TABLE enrollment_grade_overrides (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    student_id text NOT NULL,
    student_name text,
    original_grade text,
    override_grade text NOT NULL,
    school_year text NOT NULL DEFAULT '2025-26',
    reason text,
    updated_by text,
    updated_at timestamptz DEFAULT now(),
    UNIQUE(workspace_id, student_id, school_year)
  );
  ```
- **Logic**: When building the by-grade table, check: if override exists for a student, use override_grade instead of Veracross grade. Override takes precedence and is NOT overwritten by syncs.
- **UI**: On the enrollment by-grade drilldown, add an "Override Grade" button or dropdown on each student card. Only users with `edit_enrollment_data` sub-permission can edit.
- **Pattern**: Same as budgeted column (manual data stored separately, merged at display time)
- **Sub-permission**: Use existing `edit_enrollment_data` under admissions

---

## TIER 1: Quick Fixes

### 2. Fix Calendar Fallback (CRITICAL)
- RBK's calendar is showing to all users because calendar routes fall back to workspace token
- Remove workspace token fallback for calendar routes ONLY
- If user hasn't connected their own Google account, return `not_connected` error
- TodayScheduleCard already handles this with "Connect your calendar" button
- Apply to: /api/calendar/today, /week, /create, /delete
- Gmail routes keep workspace fallback (email is shared)
- **Status**: Prompt was written but may not have been deployed yet

### 3. Move Today's Folder Button
- Currently pushed all the way to the right of the tab bar
- Move it to be right next to the "Daily Announcements" tab
- Simple CSS/layout fix in app/home/page.tsx

### 4. Fix Tasks Plus Button Position
- The floating "+" button for adding tasks is covered by the bug report button
- Move the add button to be in the Tasks page header, right next to the word "Tasks"
- Style as a small inline button, not a floating action button

### 5. Fix Becca's Dashboard Redirect
- rglassberg@saracademy.org still sees "Dashboard" in sidebar and lands on old dashboard
- All users should see "Home" and redirect to /home
- Previous fix claimed all users redirect, but Becca's account still doesn't
- Investigate: could be a caching issue or the redirect logic has an edge case

### 6. Fix Calendar During Impersonation
- When Becca impersonates Amy, she sees her own (Becca's) calendar
- During impersonation, the calendar should show the impersonated user's token status
- If the impersonated user hasn't connected, show "Connect your calendar"
- Don't fall back to the impersonator's token

---

## TIER 2: Tasks Improvements

### 7. Add Task Opens Side Panel
- Currently clicking "Add" inserts task inline with just the text field
- Instead, clicking "Add" should open the right-side pullout panel with ALL fields:
  - Task text
  - Due date picker
  - Assignee dropdown (RBK, Emily, or others)
  - Notes field
  - Mark as urgent toggle
  - Source (auto-set to "Tasks" for manual additions)
- Same panel that appears when you click an existing task to edit it

### 8. Fix Task Source Field
- All tasks currently show "Budget and Finance" as the source
- Source should reflect where the task was created:
  - From Tasks page: "Tasks" or empty
  - From Meeting Agenda: "From agenda notes"
  - From Shiva "Send Note": "Shiva email"
  - From other pages: name of the source page

### 9. Real-Time Task Sync
- When Emily marks a task done, RBK should see it without refreshing
- Options: Supabase realtime subscriptions, or polling every 30 seconds
- At minimum, add a visible "Last updated X seconds ago" with auto-refresh
- Goal: changes visible within 30 seconds without manual refresh

---

## TIER 3: Simchas & Shivas Polish

### 10. B'nai Mitzvah: Remove from List Button
- Add an X/dismiss button on each invitation card
- Emily and RBK can remove processed invitations they don't need to see
- Store dismissed state (probably by email ID in localStorage or Supabase)
- Dismissed emails don't reappear

### 11. B'nai Mitzvah: Fix Email Rendering
- Some invitation emails show raw HTML/Outlook code instead of rendered content
- Need better HTML sanitization/rendering for email bodies
- Some automated/forwarded emails don't parse well

### 12. Shiva "Send Note" Button Testing
- Already built, needs testing when a new Hamakom email arrives
- Verify: creates task assigned to Emily, shows success toast, button changes to "Sent"

---

## TIER 4: Sidebar Reorganization

### 13. Add Sub-Items Under Home
- For RBK/Emily, add "Daily Announcements" and "Today's Folder" as sub-items under "Home" in the sidebar
- These should navigate to the respective tab/link on the homepage

### 14. Rename "Community" to "Academics"
- Move Student Absences and Admissions & Enrollment under "Academics"
- Simchas & Shivas stays under "Community"

### 15. Add Student Logs Page
- New sidebar item under "Academics"
- Link to Veracross Axiom query #1473847 (weekly behavior log summary)
- Subtotaled by grade, then by student, showing incident date and notes
- Just a link or embedded iframe, not pulling data into the dashboard
- Can filter student behavior notifications out of RBK's email to reduce inbox noise

### 16. Rise Vision Screens
- RBK requested this but neither Becca nor Emily knows what he wants
- Emily will comment asking for clarification
- Parked until clarified

---

## TIER 5: Communications Page Buildout

### 17. Social Media Embeds
- On the Communications page, embed public social feeds:
  - SAR Academy Instagram
  - RBK's LinkedIn
  - RBK's Instagram
  - RBK's X/Twitter
- Public feeds can be embedded via standard embed codes

### 18. Social Media Post Drafting Section
- Editable section where comms team (Yael, Alana) can draft posts for RBK
- Current workflow: Yael/Alana draft -> send to Emily -> Emily puts in LinkedIn/X as draft -> RBK publishes -> Emily adds to tasks
- Could streamline: draft appears on Communications page, RBK reviews, Emily publishes
- Permissions: comms team members get access to edit this section

### 19. Monday.com Approvals Queue
- Show pending email/comms approvals from Monday.com board
- RBK currently gets approval requests via email
- Needs Monday.com API investigation

---

## TIER 6: Development - Cooper Fund & Israel Fund

### 20. Cooper Fund Tab
- New tab under Development (Weekly Gifts | Campaigns | Cooper Fund)
- **Money going out**: From Cooper Reconciliation spreadsheet (Ellen updates, Emily categorizes)
  - Show expenses by category: camp, medical/mental health, food/housing, etc.
  - Show current balance
  - Spreadsheet name: "Cooper Reconciliation" (Emily to share link)
- **Money coming in**: Already in Veracross via query #1071958 (fundraising activity, Fund = Cooper)
  - Divided by event (Shrek basketball, etc.)
  - This data is already available through our gifts sync
- **Visual**: Pie chart by expense category, balance card, totals (recreate Emily's slide)
- **People**: Ellen manages the spreadsheet, Sara/Leora involved with incoming, Heidi wants to see it before she leaves

### 21. Israel Fund Tab
- New tab under Development (Weekly Gifts | Campaigns | Cooper Fund | Israel Fund)
- **Money coming in**: "Management Report of Israel-Related Funding" spreadsheet (Heidi updates from Veracross)
  - Shows per-event fundraising (e.g., Faraza), amounts raised, amounts sent, balances
  - This is what RBK gets printed - make a visual version of it
  - Spreadsheet: Emily to share link
- **Money going out**: "Israel Grants" spreadsheet (Emily manages, tied to Procurify)
  - RBK does NOT directly look at this sheet
  - Feeds into the management report
- **People**: Heidi must be involved (she manages incoming data), Emily manages grants

---

## TIER 7: Email Workflow (Needs Design Discussion)

### 22. RBK Action Label Cleanup
- Emily to clean up "RBK Action" Gmail label to May 1st onward
- Consolidate duplicate labels: merge "EG Action" + "Emily", merge "RBK" + "RBK Action"
- Aim for ~20 current actionable emails in the label, not 2000+

### 23. Label-to-Task Pipeline (Future)
- When Emily adds "RBK Action" label to an email, auto-create a task on the dashboard
- Would replace the email section on the dashboard entirely
- RBK reads the actual email in Gmail, task just tells him to look

### 24. Email Threads Linked to Projects (Future)
- Tag email threads with a project, all related emails show under that project page
- Similar to how Lever shows all emails for a candidate
- Manual tagging via Gmail label

### 25. Hide Emily's Queue
- RBK doesn't use it, Emily confirms it's not helpful
- Either hide it from the sidebar or repurpose it later

---

## CARRYOVER FROM PREVIOUS PHASES (Incomplete/Needs Testing)

### 26. Lever Notes - NEEDS TESTING
- Notes posted from Recruiting page should appear in Lever with user attribution
- RBK needs to test adding a note from the dashboard and confirming it shows in Lever
- perform_as user IDs: RBK = fbbe3ae8-d014-4f0e-930f-0a2c24d35124, Emily = b5b07c90-c697-4cc8-af6a-19f7bf57a4a9

### 27. Lever Webhook Activation - NOT DONE
- Activate webhook in Lever settings to send Slack DMs to RBK for new non-HS applications
- This is a Lever admin setting, not code

### 28. Application Pipeline (Prospects + Applicants) - NEEDS VERACROSS INVESTIGATION
- New tab on Admissions showing prospects (inquiry only) and applicants (full application)
- Requires investigating which Veracross API fields distinguish these statuses
- Blocked on API understanding

### 29. Pisgah Data Fix - NEEDS VERACROSS TICKET
- student_group_applying_for not available for current students via API
- Need to file Veracross support ticket about current_student_group API access
- Manual overrides (Tier 0, item 1) partially addresses this

### 30. Simchas & Shivas RSVP End-to-End Test
- Yes/No buttons built, need to confirm RSVP state persists and is visible to Emily
- Currently stored in localStorage (client-side only)
- Consider: should RSVP state be stored in Supabase so Emily can see what RBK responded?

### 31. Paycom API for Faculty Absences
- No public API exists
- Email to Paycom rep requesting API credentials was drafted
- Parked until response

### 32. Campaign Naming Cleanup (Veracross)
- RBK wants fewer top-level campaigns with subcategories
- Becca spoke to Sara Hasson, meeting planned for this week
- Veracross data cleanup, not a code change
- Once cleaned, Campaigns tab reflects it automatically

### 33. Site Performance / Loading Speed
- Pages still load slowly, especially Admissions
- Client-side caching was added but login flow is slow
- Need to investigate: session check speed, redirect latency, API response times
- Consider server-side caching for Veracross data

### 34. Delete Fake Projects
- Remove placeholder projects (Open House Video, Campus Safety Audit, etc.)
- Keep only real ones (Donor Intelligence System)
- Consider hiding Projects section from homepage until fully built

### 35. This Week at SAR Click Tracking
- Add analytics to the Netlify calendar site
- Separate project, not Command Center code
- Track page views, grade filter usage, event clicks

---

## KEY LINKS & REFERENCES

| Item | URL/Reference |
|------|---------------|
| This Week at SAR | https://thisweek-sar.netlify.app/ |
| Daily Announcements Doc | https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?tab=t.0 |
| Today's Folder | https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9 |
| Pending Online Gifts Query | https://axiom.veracross.com/sar/#/results/1470528 |
| Student Logs Query | https://axiom.veracross.com/sar/#/results/1473847 |
| Cooper Fund Veracross Query | #1071958 |
| Cooper Reconciliation Sheet | TBD (Emily to share) |
| Israel Funding Mgmt Report | TBD (Emily to share) |
| Israel Grants Sheet | TBD (Emily to share) |
| Gmail Consent Flow | https://rbk-cmd-center.web.app/api/auth/gmail-consent |
| Live Site | https://rbk-cmd-center.web.app |
| Source Code | ~/DevProjects/RBK_Command_Center |

---

*Document created: May 11, 2026*
*Source: Emily Gray meeting #3 + Emily Daniel enrollment session + Phase 3/4 carryover*
