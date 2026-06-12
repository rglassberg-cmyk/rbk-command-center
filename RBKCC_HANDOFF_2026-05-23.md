# ARCHIVED — superseded by RBKCC_MASTER_TODO.md (June 2, 2026)

# RBK Command Center — Chat Handoff Document
_Generated: May 23, 2026 — end of major SaaS refactor session_

---

## APP AT A GLANCE

- **Live URL:** https://rbk-cmd-center.web.app
- **Local project:** ~/DevProjects/RBK_Command_Center
- **Deploy command:** `./deploy.sh`
- **Latest Cloud Run revision:** `ssrrbkcmdcenter-00487-4x8`
- **Stack:** Next.js 16, Supabase (RLS), Firebase (Hosting + Cloud Functions + Cloud Run), Veracross API, Lever API, Gmail API, Anthropic API, Slack
- **Source of truth files:** `CLAUDE_CONTEXT.md`, `RBKCC_VISION_AND_ROADMAP.md`

---

## KEY PEOPLE

| Person | Email | Slack ID | Role | Divisions | Notes |
|--------|-------|----------|------|-----------|-------|
| Rabbi Krauss (RBK) | kraussb@saracademy.org | U04NBR22Y | owner | academy | Primary end user |
| Emily Gray | egray@saracademy.org | U05M5KT86GK | assistant | academy | RBK's executive assistant. `assistant_to` = RBK's member ID |
| Becca (you) | rglassberg@saracademy.org | — | owner | academy, hs | Builder / Director of Technology |
| Debra Eis | deis@saracademy.org | — | viewer | academy | Business Office Staff |
| Emily Daniel | edaniel@saracademy.org | — | viewer | academy | Admissions staff |
| Amy Hyman | ahyman@saracademy.org | — | viewer | academy | HR |
| Debra May | debra@saracademy.org | — | viewer | academy, hs | Executive Director (added herself via permissions page) |
| Sara Hasson | sara.hasson@saracademy.org | — | viewer | academy | Development viewer |
| Leora Miller | leora.miller@saracademy.org | — | viewer | academy | Development viewer |

**Important:** `divisions: ['academy']` = ELC + Lower School + Middle School (one building). `divisions: ['hs']` = High School (separate building, same institution). These are stored in `workspace_members.divisions text[]`.

---

## WHAT WAS BUILT THIS SESSION — PHASES A THROUGH F (ALL COMPLETE)

### Phase A — Schema Foundations (rev 00456)
- Added 6 columns to `workspace_members`: `assistant_to`, `assignee_key`, `slack_user_id`, `divisions text[]`, `title`, `email_identity_html`
- Renamed `ls` → `academy` throughout codebase and DB
- Created `lib/assignees.ts`, `lib/getWorkspaceMemberByAssignee.ts`, `lib/divisions.ts`
- Moved Slack lookups from hardcoded constants to DB
- Backfilled all 9 members with correct data

### Phase B — Tasks Page Generalized (rev 00463 + hotfix 00465)
- Tasks page now bidirectional: RBK sees his tasks + Emily's; Emily sees her tasks + RBK's; standalone users see one column
- Fixed inverted assistant lookup bug (`assistant_to` pointer direction)
- Session now includes `currentMember`, `assistant`, and `principal` fields
- Assistant picker added to Admin → Users tab
- Greeting personalized from `currentMember.displayName`

### Phase C — Email/Calendar De-RBK-ified (rev 00467)
- Email from address + signature reads from `workspace_members.email_identity_html`
- `session.accessToken` retired across 8 Gmail routes — all now use `getValidGoogleToken()`
- `rbkCalendarId = 'kraussb@saracademy.org'` removed from `app/page.tsx` → uses `primary`
- RBK's signature backfilled into `email_identity_html`
- `gmail-callback` now updates the authenticated user's tokens (not hardcoded to RBK)

### Phase D — HS Division Filter (rev 00469 + hotfixes 00471)
- `getGradeFilterForMember(divisions)` now dynamic per user
- `HS_GRADING_PERIOD` corrected: was 29, actually 24. `HS_GRADING_PERIODS = [24, 29]`
- Fixed impersonation bug: was using Becca's divisions when impersonating RBK
- `apiFetch` used instead of plain `fetch` to send impersonation headers
- `getEffectiveDivisions(session)` returns impersonated user's divisions correctly
- Division toggle scaffolded (Academy / High School / Institutional) for multi-division users

### Phase E — Cleanup (rev 00475)
- `rbk_action` → `owner_action`, `eg_action` → `assistant_action` in DB (2,623 rows), Cloud Function, and all client code
- `workspaces.brand jsonb` column added; SAR backfilled with ownerInstagram, ownerLinkedIn, ownerX, schoolInstagram, ownerShortName
- Social media links in Dashboard.tsx now read from `workspaceBrand` (no more hardcoded `binikrauss`, `bini-krauss`)
- Zero remaining hardcoded `kraussb` / `binikrauss` references in `app/` or `lib/`

### Phase F — SaaS Self-Service API Keys (rev 00481)
- `workspace_integrations` table created (RLS service-role only)
- `lib/getIntegration.ts` with 5-minute in-memory cache and env var fallbacks
- Helper functions: `getVeracrossCredentials()`, `getSlackCredentials()`, `getLeverCredentials()`, `getAnthropicCredentials()`
- 8+ API routes refactored to use helpers
- Admin → Integrations tab: 7 cards (Veracross, Gmail, Google Calendar, Slack, Lever, Anthropic, Rise Vision)
- Configure forms with password masking, Test buttons, Connected/Disconnected status
- "Seed from environment" button clicked — all 4 show green Connected
- Rise Vision: "Coming soon" (Phase G)

---

## OTHER FEATURES DEPLOYED THIS SESSION

### Admin Page Restructured (3 tabs)
- **Users** — permissions, divisions checkboxes (Academy/HS), title field, assistant picker dropdown
- **School Settings** — workspace name (editable), divisions-in-use summary, branding placeholder
- **Integrations** — 7 integration cards (see Phase F)

### Debra May Feature Batch (rev 00483-00485-00487)
- **Attendance:** uses `attendance_category='absent'` for all absence counts; Tardy separate
- **New Student label:** "New Family" → "New Student" in enrollment table; teal "New Family" badge in student side panel (reads Veracross household fields)
- **Household financial link:** dollar icon on student rows → `https://accounting.veracross.com/sar/#/detail/household/[household_id]/-420-current-amount-due`
- **Geography:** City/Region toggle with full CITY_TO_REGION + STATE_TO_REGION mapping; "Other" bucket now clickable; Academy/HS/Institutional dropdown for multi-division users
- **Shiva end date:** parsed from Hamakom email body; "Shiva through [day, date]" displayed; "View full notice →" link
- **Capital Campaign tab:** added to Development (between Campaigns and Guardian Circle); currently shows placeholder since only 1 donor (Harcsztark family, $7,300) — real data will appear when ≥2 donors recorded
- **HS Enrollment:** fixed `RE_ENROLLMENT_GRADE_LEVELS` to include grades 9-11; `NEXT_GRADE_MAP` extended with 9→10, 10→11, 11→12
- **Recruiting division filter:** inline dropdown between search and All Teams (Academy / High School / All Schools); only visible to multi-division users

---

## TESTS STILL PENDING (DO THESE TOMORROW)

| Test | What to check | Status |
|------|--------------|--------|
| RBK email signature | Impersonate RBK → Compose → send to yourself → confirm From + signature correct | ⬜ PENDING |
| Division filter: Becca | Absences, Admissions, Recruiting → should see HS data | ⬜ PENDING |
| Division filter: RBK | Same pages via impersonation → Academy only, no HS | ⬜ PENDING |
| Tasks: RBK view | Impersonate RBK → two columns: Rabbi Krauss + Emily Gray | ⬜ PENDING |
| Tasks: Emily view | Impersonate Emily → two columns: Emily Gray + Rabbi Krauss | ⬜ PENDING |
| Tasks: Becca view | As Becca → one column only | ⬜ PENDING |
| Inbox sections | Action Required + Emily's Queue (now `assistant_action`) still showing correctly | ⬜ PENDING |
| Social media tiles | Home page → 5 SAR links visible, driven by `workspaces.brand` | ⬜ PENDING |
| Recruiting filter | As Becca → 4 dropdowns including "All Schools"; HS filter works | ✅ CONFIRMED |
| Integrations seed | Admin → Integrations → all 4 green Connected | ✅ CONFIRMED |
| Geography regions | Click Other → drilldown opens; NJ/Queens/CT now in correct buckets | ⬜ PENDING |

---

## BLOCKED ITEMS (need info from stakeholders)

| Feature | Blocked on | Who to ask |
|---------|-----------|-----------|
| Transportation page | Bus route → stop mapping (which stops belong to which bus) | Debra May |
| Scholarship button | ParentLocker URL format for per-student links | Debra May |
| After-school programs | Which Veracross endpoint holds registration data | Debra May |
| Day of Learning thank yous | Veracross field name for dedication/honoree text on gift records | Leora Miller |
| Thank you BCC to Veracross | Exact BCC email address for Veracross gift tracking | Emily/Sara |
| Cooper Fund Slack channel | Channel ID for Cooper Fund notifications | Emily |
| Paycom API | Credentials from Paycom rep (email sent, awaiting response) | Paycom rep |
| Digital Signage / Rise Vision | Screen URLs for 5-6 campus displays | RBK |
| HS principal onboarding | HS principal's email, name, title | Becca to get |

---

## READY TO BUILD (no blockers)

| Feature | Priority | Notes |
|---------|----------|-------|
| Communications Monday status text fix | Medium | Raw API value ≠ "Pending RBK Approval" |
| Cooper/Israel Fund clickable event rows | Medium | Drilldown per event with DonorAnnotations |
| Mobile table overflow pass | Medium | Tables on Development page cut off on mobile |
| Admissions @mention notes | Medium | Same as DonorAnnotations but for enrollment drilldown |
| Multi-year giving history per donor | Low | Guardian Circle constituent detail |
| App name decision | Low | Ask RBK if he wants to rename from "Command Center" |
| Cooper Fund year-over-year | Low | Compare disbursements vs last year by category |

---

## CRITICAL TECHNICAL CONTEXT

### Division System
```typescript
DIVISION_ACADEMY = 'academy'  // ELC + LS + MS — one building
DIVISION_HS = 'hs'            // High School — separate building, same institution
```
- Empty `divisions = []` defaults to academy-only (safe fallback)
- Multi-division users (Becca, Debra May): get Academy/HS/Institutional toggle on Admissions and Recruiting
- Division filtering is impersonation-aware via `getEffectiveDivisions(session)` in `lib/impersonate.ts`
- All 4 Veracross routes use `apiFetch` (not plain `fetch`) to send impersonation headers

### Assistant Relationship
- `workspace_members.assistant_to` is set on the **assistant's** row pointing at the **principal**
- Emily's row: `assistant_to = RBK.id` (meaning "Emily assists RBK")
- Session builds both `assistant` (reverse: who assists me) and `principal` (forward: who I assist)
- Tasks page second column = `assistant ?? principal` (assistant takes priority if both exist)

### Email Priority Values (POST Phase E)
- `owner_action` (was `rbk_action`) — RBK's action required
- `assistant_action` (was `eg_action`) — Emily's queue
- Both DB and Cloud Function (`triageGmail`) updated simultaneously

### Integration Credentials (Phase F)
- `workspace_integrations` table, service-role only, never client-readable
- `lib/getIntegration.ts` reads DB first, falls back to env vars
- 5-minute in-memory cache per workspace+type combo
- After "Seed from environment" clicked, DB is source of truth
- Cloud Functions and webhook routes still use `process.env` directly (acceptable for now)

### Veracross Quirks
- **Grade numbers non-sequential:** 40=ELC, 35=2YN, 30=3YN, 25=4YN, 20=K, 1-8=1st-8th
- **HS grading period:** 24 (NOT 29 — that's the prior school year)
- **HS grade numbers:** [9, 10, 11, 12]
- **Re-enrollment endpoint:** `/v3/students` (no `grading_period` param accepted — filter client-side)
- **Admissions endpoint:** `/v3/academics/applications` for new students
- **Attendance pagination:** `master_attendance` caps at 1000/page; use paginated while loop
- **Household invoices URL:** `https://accounting.veracross.com/sar/#/detail/household/[household_id]/-420-current-amount-due`
- **Student record URL:** `https://axiom.veracross.com/sar/#/detail/student-ls/[student_id]/273-general`

### Lever API Quirks
- Basic auth (API key as username, blank password)
- `expand=applications` makes `applications[0].posting` a string ID — use `getOppPostingId()` helper
- Group by `categories.team` (not `categories.department` — always returns "SAR Academy")
- Filter `archived=false` to exclude hired candidates

### Cloud Run
- Service: `ssrrbkcmdcenter`, region `us-east1`, project `rbk-cmd-center`
- Min instances: 1 (no cold start)
- Logs: `gcloud run services logs read ssrrbkcmdcenter --region=us-east1 --project=rbk-cmd-center --limit=100`

---

## HS ONBOARDING — PENDING

When HS principal details are available, run this SQL:
```sql
INSERT INTO workspace_members (
  workspace_id, email, role, allowed_modules, divisions, title, assignee_key, display_name
) VALUES (
  (SELECT id FROM workspaces WHERE name ILIKE '%SAR%' LIMIT 1),
  'hs-principal@saracademy.org',  -- replace with actual
  'owner',
  '{"home":true,"tasks":true,"admissions":true,"absences":true,"lever":true,"development":true}',
  ARRAY['hs'],
  'Head of School',               -- replace with actual title
  'HSPrincipal',                  -- replace with preferred key
  'Rabbi [Name]'                  -- replace with actual name
);
```
Then set their Google auth and test impersonation to verify HS-only data flows.

---

## DOCUMENTS THAT NEED UPDATING ON CLI

### 1. CLAUDE_CONTEXT.md — CRITICAL UPDATE NEEDED
The file is significantly outdated. It still references:
- Old email priorities (`rbk_action`, `eg_action`) — now `owner_action`, `assistant_action`
- Phase A-F changes not fully documented
- Missing: `lib/getIntegration.ts`, `lib/divisions.ts`, `lib/impersonate.ts`, `lib/emailIdentity.ts`
- Missing: `workspace_integrations` table, `workspaces.brand` column
- Missing: All Debra May features (attendance, household link, geography, Capital Campaign tab)
- `Known Pending Items` section is stale

**Prompt to run on CLI:**
```
Read CLAUDE_CONTEXT.md thoroughly. This file is outdated. Update it to reflect:
1. Latest Cloud Run revision: ssrrbkcmdcenter-00487-4x8
2. Phases A-F complete (see Recent Changes section — add full summaries)
3. New lib files: getIntegration.ts, divisions.ts, impersonate.ts, emailIdentity.ts, apiFetch.ts
4. New DB tables/columns: workspace_integrations, workspaces.brand, workspace_members new columns (assistant_to, assignee_key, slack_user_id, divisions, title, email_identity_html)
5. Priority rename: rbk_action→owner_action, eg_action→assistant_action everywhere
6. Division system: DIVISION_ACADEMY='academy', DIVISION_HS='hs', getGradeFilterForMember, getEffectiveDivisions
7. Debra May features: attendance_category fix, New Student label, household financial link, geography region toggle, Capital Campaign tab, HS enrollment grades 9-12
8. Admin page: 3 tabs (Users, School Settings, Integrations)
9. Known pending items: update with current blocked/ready list from this handoff doc
Do not change anything else. Save the file.
```

### 2. RBKCC_TODO_2026-05-15.md — UPDATE NEEDED
Mark completed items and add new ones. Key additions:
- ✅ All SaaS phases A-F complete
- ✅ Attendance category fix
- ✅ New Student label + New Family badge
- ✅ Household financial link
- ✅ Geography region toggle
- ✅ Capital Campaign tab
- ✅ HS enrollment data (grades 9-12 fixed)
- ✅ Recruiting division filter inline
- Add: Transportation page (blocked on route mapping)
- Add: Scholarship button (blocked on ParentLocker URL)
- Add: After-school programs page (blocked on Veracross endpoint)

### 3. RBKCC_VISION_AND_ROADMAP.md — MINOR UPDATE
- Update "Current Status" section (was last updated March 2026)
- Add SaaS milestone: app is now multi-tenant with per-workspace credentials
- Add HS expansion section describing the two-division architecture

---

## PHASE G CANDIDATES (future work)

| Item | Description | Priority |
|------|-------------|----------|
| Rise Vision / Digital Signage | Display URLs for 5-6 campus screens; real-time status dashboard | High (once RBK provides URLs) |
| Transportation page | Bus route grouping, per-student cost, outstanding balance | High (once Debra provides route map) |
| After-school programs | Registration enrollment by program and grade | Medium |
| Scholarship button | ParentLocker link per student (all users see it, only authorized can use) | Medium |
| Credential encryption | `pgsodium` / KMS for `workspace_integrations.credentials` | Low |
| Cloud Function workspace-awareness | `triageGmail` reads credentials from DB instead of env vars | Low |
| Google Tasks sync | Two-way sync between app tasks and Google Tasks | Low |
| HS principal full onboarding | Add HS principal as user, test HS-only view | Waiting on details |

---

## HOW TO START THE NEXT CHAT

Paste this at the top of your first message:
> "I'm continuing work on the RBK Command Center. Please read CLAUDE_CONTEXT.md as your source of truth. The app is live at https://rbk-cmd-center.web.app, local project at ~/DevProjects/RBK_Command_Center, deploy via ./deploy.sh. Latest revision is ssrrbkcmdcenter-00487-4x8. Read the RBKCC_HANDOFF_2026-05-23.md file in the project for full context on what was just built."

Then add this handoff doc to the project knowledge so Claude can read it.
