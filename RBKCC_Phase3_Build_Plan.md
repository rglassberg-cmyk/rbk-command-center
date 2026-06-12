# RBK Command Center - Phase 3 Build Plan
## Post-Emily Meeting (May 5, 2026)

---

## TIER 1: Homepage Redesign (All Users)

### 1. Embed "This Week at SAR" on Homepage
- **URL to embed:** https://thisweek-sar.netlify.app/
- Replace the current "This Week at SAR" calendar section on EVERYONE's homepage
- This is the Netlify-hosted calendar with grade filtering, search, sport emojis, and live Google Calendar sync
- Should be embedded via iframe or similar, maintaining search/filter functionality
- Current homepage calendar section should be fully replaced, not duplicated

### 2. Change RBK's Greeting
- Change from "Welcome back, Rabbi" to "Good morning, Bini" (or time-appropriate: Good afternoon/evening)
- Spelling: **Bini** (not Binnie, not Binny)
- All other users keep their current first-name greeting pattern

### 3. Move Today's Schedule to Right Side of Homepage
- Move all existing dashboard calendar/schedule functionality to the right column of the homepage
- Must include: Zoom join links, pop-out to full calendar, add new event, day switching, auto-hide past events
- This is currently on the old dashboard page; we're consolidating everything to /home
- Applies to RBK and Emily Gray's homepages

### 4. Collapsible Daily Announcements Section
- **Google Doc URL:** https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?tab=t.0
- Embed this Google Doc directly on the homepage (iframe)
- Should be in a collapsible section so RBK can collapse it after reviewing in the morning
- This doc is updated daily by Emily Gray; contains: day count, Hebrew date, sponsorships, birthdays, game scores, RBK's schedule, staff absences
- Applies to RBK and Emily Gray's homepages
- Not needed as a separate sidebar item since it's embedded on homepage

### 5. Today's Folder Button/Link
- **Google Drive URL:** https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link
- Cannot be embedded (it's a folder with variable contents)
- Show as a prominent button/link on the homepage, opens in new tab
- Contains: printed materials for RBK's day (resumes for interviews, model lessons, documents he needs)
- Applies to RBK and Emily Gray's homepages

### 6. Collapsible Today's Tasks Section
- Show tasks from the Tasks page that have a past-due date or today as due date
- Connected to the Tasks page: marking done here marks done there (same data source)
- Same functionality: mark as done, assign to people, add due date/time, urgency toggle, notes
- Source field should work (shows where the task originated, e.g., meeting agenda)
- Collapsible section on homepage
- Later: cross-assign tasks to other users (Sara, Beth, etc.) who would see them on their homepage

### 7. Remove/Conditional Sections
- **Remove Urgent section** from homepage unless there's actually something urgent (conditional display)
- **Remove emails** from the RBK dashboard entirely (emails have their own page in sidebar)
- Need to iterate on how "urgent" should function in the future

### 8. Fix Homepage Dashboard Tiles
- Tiles should show ALL modules a user has access to
- Bug: Amy Hyman has Recruiting access but it doesn't show as a tile on her homepage
- Audit all users' tiles against their actual permissions

---

## TIER 2: Bug Fixes

### 9. Fix City Data Loading on Admissions
- Admissions page "loading city data" sometimes doesn't render
- May be a race condition or data fetching issue
- Noted during Emily demo; need to investigate

### 10. Fix Slow Applicant Name Loading on Admissions
- Applicant names on the Admissions Overview tab sometimes take too long to load or don't appear
- May be related to the API response time or rendering
- Could benefit from caching

---

## TIER 3: New Pages/Features

### 11. Gemara Sidebar Page
- New sidebar item under a relevant group
- Contains 3 links for now (to be built out with embeds later):
  - Gemara folder (Google Drive link, TBD)
  - Oral test sign-up (link TBD)
  - Oral test rubric (link TBD)
- RBK only (permission-gated)
- Future: could embed these docs and add teacher-facing Gemara tracking

### 12. Communications Sidebar Page
- New sidebar page
- Will include an Approvals Queue section
- Approvals Queue integrates with Monday.com (their current approval workflow)
- Needs design discussion before building
- RBK mentioned: Daily Announcements, Communications, Approvals Queue as sidebar items
- Daily Announcements embedded on homepage, so no separate sidebar item needed
- Communications + Approvals Queue = one combined sidebar page

### 13. More Granular Permissions
- Current permissions page allows enabling/disabling entire modules per user
- Need sub-permissions within modules, e.g.:
  - Under Recruiting: "Offer Approvals" checkbox (only RBK, Beth Pepper, Amy, Deborah May)
  - Under Development: specific fund access
- This enables showing "Action Required" indicators to specific users

---

## TIER 4: Future Iteration (Needs Design Discussion)

### 14. Recruiting Approval Workflow
- When a candidate reaches "Offer and Background Check" stage, certain users need to approve
- RBK, Beth Pepper, Amy Hyman, Deborah May should see "Action Required" indicator
- This needs to integrate with either Lever's offer approval flow or email notifications
- Should connect to the Tasks page (approval appears as a task)
- Needs more iteration on exactly how this works

### 15. Task Connections Section on Permissions Page
- A section on the permissions page showing which pages/actions feed into Tasks
- e.g., "Project assignments create tasks" (checkbox)
- e.g., "Offer approvals create tasks" (checkbox)
- Configurable per user
- Helps control what shows up in each user's task list

### 16. Development Sub-Pages
- Cooper Fund: separate tab under Development (data TBD, likely from Veracross or spreadsheet)
- Israel Fund Management Sheet: embed or link (currently an Excel doc)
- RBK Fundraising doc: embed or link
- These need data source investigation before building

### 17. Procurify Replacement / Purchase Approvals
- RBK wants purchase approval workflow in the dashboard
- Currently uses Procurify; may be replaced
- Parked for now; revisit when procurement workflow is decided

---

## OTHER NOTES

### Performance / Caching
- Site loads slowly sometimes, especially on Admissions and when pulling live data
- Need to investigate caching strategies for pages that pull from Veracross
- May be internet-related but worth optimizing

### Click Tracking for This Week at SAR
- Separate project (Netlify site, not Command Center)
- Add analytics to track how many parents are using the calendar
- Don't forget about this!

### Emily Gray's Homepage
- Should have the same layout and sections as RBK's homepage
- Same: greeting, This Week at SAR embed, Today's Schedule, Daily Announcements, Today's Folder, Today's Tasks, Projects, Dashboard tiles

### Debra Eis Homepage
- Should see the events calendar (This Week at SAR embed) on her homepage
- Same as everyone else since the embed will be on all homepages

---

## KEY LINKS

| Item | URL |
|------|-----|
| This Week at SAR | https://thisweek-sar.netlify.app/ |
| Daily Announcements Doc | https://docs.google.com/document/d/1YnnpnzVUylVRNx8f3HsXepSl8xW8y7htQC2wrSwnouo/edit?tab=t.0 |
| Today's Folder | https://drive.google.com/drive/folders/10lSL_ZVTYDEIRnL4mu46J41g-sFaIce9?usp=drive_link |
| Pending Online Gifts Query | https://axiom.veracross.com/sar/#/results/1470528 |
| Live Site | https://rbk-cmd-center.web.app |
| Source Code | ~/DevProjects/RBK_Command_Center |

---

*Document created: May 5, 2026*
*Source: Becca + Emily Gray meeting transcript + RBK feedback notes*
