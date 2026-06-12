# RBK Command Center - Phase 4 Build Plan
## Post-Emily Meeting #2 (May 6, 2026)

This builds on the Phase 3 plan (completed). All Phase 3 items are shipped.

---

## TIER 1: Critical Fixes (Deploy First)

### 1. This Week at SAR iframe disappearing intermittently
- The iframe sometimes fails to load/render on the homepage
- Happened multiple times during the Emily meeting
- Likely a rendering race condition or iframe loading issue
- Add an error/fallback state: if iframe fails to load after 5 seconds, show a "Reload" button and the direct link
- Test across browsers

### 2. Dashboard tiles navigating to wrong pages
- "Development" tile takes user to Projects instead of Development
- Verify all tile navId mappings are correct after the recent fixes
- Test each tile click for every user type

### 3. Site loading speed after login
- Login flow takes too long before the homepage renders
- The redirect from / to /home adds delay
- Investigate: is the session check slow? Is the redirect causing a double-render?
- Consider server-side redirect instead of client-side

---

## TIER 2: Simchas & Shivas Updates

### 4. Add "Not Attending" button
- Currently only "Attending" (turns green when clicked)
- Add Yes/No toggle: Yes = green, No = stays blue (event still visible on calendar)
- Emily needs to see the response so she knows RBK's status
- Store the response (attending: true/false/null)

### 5. Filter B'nai Mitzvah invitation emails
- Remove reminder emails ("this is a reminder")
- Remove confirmation emails ("you are confirmed")
- Only show the FIRST/original invitation email for each event
- Keep the "Add to Calendar" button on the original invitation
- Filter logic: check subject line for "reminder" or "confirmed" keywords

### 6. Filter Shiva emails
- Only show emails with "Hamakom" in the subject line
- These are the official SAR condolence notices
- Remove shiva notices from other shuls
- Remove generic sad news emails (e.g., "great-grandmother passed away")
- Exact subject pattern TBD (Becca to provide)

### 7. Add "Send Note" button on Shiva emails
- New button on each shiva email card (next to "Add to Calendar")
- Clicking it creates a task assigned to Emily Gray
- Task text: "Draft condolence note for [family name]"
- Task appears in Emily's tasks, NEVER in RBK's
- Links to the original email for context
- Eventually integrates into the email workflow

---

## TIER 3: Admissions & Enrollment Enhancements

### 8. Application Pipeline (New Section/Tab)
- Add a new tab or section on the Admissions page
- Show two categories:
  - **Prospects**: filled out inquiry form but didn't complete full application
  - **Applicants**: completed application, in review
- Current admissions overview only shows post-decision (accepted/waitlisted/etc.)
- Needs investigation: which Veracross API fields distinguish prospects vs applicants
- This gives RBK visibility into the full funnel

### 9. Enrollment Projection: Column Totals
- Add total numbers at the bottom of each column in the by-grade table
- Simple sum of all grade rows per status column

### 10. Enrollment Projection: Waitlist Column Fix
- Waitlist column shows empty/zero for all grades
- Investigate: is the data not being fetched, or is the mapping wrong?
- Check Veracross enrollment_status codes for waitlisted students

### 11. Enrollment Projection: Budgeted Column
- Add a new "Budgeted" column showing target enrollment per grade
- This is NOT from Veracross - it's manually entered
- Emily Daniel would update these numbers directly on the dashboard
- Store in Supabase (new table or column in an enrollment config table)
- Make the column editable inline (click to edit, save on blur)
- Show difference between actual vs budgeted (green if at/above, red if below)

### 12. Enrollment Projection: Demographics/City View
- New collapsible section or tab on the enrollment page
- Show enrolled students grouped by city
- Each city is clickable to expand and show individual students
- Filter pills at the top for grades (like admissions has for new/returning)
- Example: click "Scarsdale" → see all students from Scarsdale, with grade filter showing "8th Grade: 12, 5th Grade: 8"

### 13. Pisgah Data Fix
- student_group_applying_for field doesn't work for current students
- May need Veracross support ticket
- Blocks accurate Pisgah enrollment tracking
- Action: write Veracross ticket about current_student_group API access

---

## TIER 4: Development Page Additions

### 14. Cooper Fund Page
- New sub-tab under Development (alongside Weekly Gifts and Campaigns)
- Data sources:
  - Ellen's spreadsheet (expenses by category, current balance)
  - Veracross donations query (money coming in to Cooper Fund)
- Display:
  - Current balance (from spreadsheet)
  - Money in: donations to Cooper Fund this year (from Veracross or spreadsheet)
  - Money out: expenses by category (camp, medical/mental health, food/housing, etc.)
  - Charts: category breakdown
- Emily will share the spreadsheet and slide deck as reference
- Could use Google Sheets API to pull data, or manual CSV import

### 15. Campaign Naming Cleanup
- Guardian Circle and other campaigns have duplicate/messy naming in Veracross
- Sarah Hasson is working on cleanup in Veracross
- Once cleaned up, the Campaigns tab will look cleaner automatically
- No code change needed, just tracking

### 16. Donor Intelligence Hub Integration
- Separate Netlify site built with Sarah Hasson
- AI-powered donor research profiles
- Has bulk import feature (not yet tested by Sarah)
- Eventually embed or link from the Development page
- Action: Sarah to schedule meeting with RBK to demo

---

## TIER 5: This Week at SAR / Calendar Improvements

### 17. Add "More Info" Button Type
- Currently have Livestream and Register button types
- Need a "More Info" button that links to the event email/flyer
- In the Google Calendar event description, format: `link: [url]` or `moreinfo: [url]`
- The calendar site parses this and shows a "More Info" button

### 18. Train Melissa, Adina, and Shira
- Show them how to add grades to events when creating through Monday form
- Format: in the calendar description field, add `grades: 1, 2, 3` (or range like `grades: 1-5`)
- Also show `internal: yes` for staff-only events
- Create a cheat sheet document for reference

### 19. Replace Daily Digest Event List
- The scrollable event list in the daily digest email can be replaced with a link to This Week at SAR
- Flyers and detailed info stay in the email
- Just remove the long scrolling calendar portion
- Action: coordinate with Alana who manages the digest

### 20. Click Tracking
- Add analytics to the This Week at SAR Netlify site
- Track: page views, grade filter usage, event clicks, search queries
- Helps understand parent engagement
- Separate project (Netlify site, not Command Center)

---

## TIER 6: Permissions & Architecture

### 21. Granular Sub-Permissions (Enhancement)
- Already built basic framework (Cooper Fund, Israel Fund, Offer Approvals)
- Wire up conditional rendering: if user doesn't have offer_approvals sub-permission, hide the offer approval indicators on Recruiting page
- Same for Development sub-pages: only show Cooper Fund tab if user has cooper_fund permission

### 22. Task Connections Configuration
- New section on Permissions page
- Shows which pages/actions create tasks
- Checkboxes per user: "Project assignments create tasks", "Offer approvals create tasks", "Shiva send-note creates tasks"
- Controls what appears in each user's task list

---

## TIER 7: Email & Workflow (Needs Design Discussion)

### 23. Rethink Email on Dashboard
- Current email page is "rebuilding Gmail" which doesn't make sense
- Should focus on actionable items only:
  - Drafts ready for review
  - Emails that need action (flagged by Emily)
  - Task-generating emails
- Link back to Gmail for actual email reading/sending
- Separate from the email sync that powers other features

### 24. Approval Workflow (Recruiting)
- When candidate reaches "Offer and Background Check" stage, specific users need to approve
- RBK, Beth Pepper, Amy Hyman, Deborah May should see "Action Required"
- Integrate with Lever's offer approval email or API
- Should create a task in the Tasks page
- Needs: investigate Lever's approval API or parse approval emails

### 25. Monday.com Approvals Queue
- Under Communications sidebar page
- Show pending approvals from Monday.com
- RBK currently gets approval requests via email
- Could pull from Monday.com API
- Needs: investigate Monday.com API for approval workflows

### 26. Procurify Replacement
- Purchase approval workflow in the dashboard
- Currently uses Procurify; may be replaced
- Parked until procurement workflow is decided

---

## KEY LINKS

| Item | URL |
|------|-----|
| This Week at SAR | https://thisweek-sar.netlify.app/ |
| Daily Announcements Doc | https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?tab=t.0 |
| Today's Folder | https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link |
| Pending Online Gifts Query | https://axiom.veracross.com/sar/#/results/1470528 |
| Gmail Consent Flow | https://rbk-cmd-center.web.app/api/auth/gmail-consent |
| Donor Intelligence Hub | (Netlify URL - ask Sarah) |
| Live Site | https://rbk-cmd-center.web.app |
| Source Code | ~/DevProjects/RBK_Command_Center |

---

## COMPLETED (Phase 3)
- Homepage redesign: 3-column layout, greeting, tabs, daily announcements, tasks
- This Week at SAR embedded for all users
- Today's Schedule card with per-user Google tokens
- Per-user Google OAuth token storage (user_google_tokens table)
- Calendar scope fix (calendar.readonly + calendar.events)
- Reconnect button on schedule card
- Task filtering by assigned user
- Responsive breakpoints (lg instead of xl)
- All users redirect to /home
- Gemara sidebar page (placeholder links)
- Communications sidebar page (placeholder)
- Granular sub-permissions UI
- Homepage tiles fix
- Admissions city data loading fix
- Admissions applicant name loading fix
- Recruiting: pipeline redesign, stale candidates, notes, filters
- Development: campaign totals, donor side panel, default sort, Veracross link fix, pending gifts banner
- Weekly Gifts: search bar, dedup fix, workspace fix, scheduled sync fix
- Attendance charts
- Search bars on Admissions Overview and Weekly Gifts

---

*Document created: May 6, 2026*
*Source: Emily Gray meeting #2 transcript + ongoing troubleshooting*
