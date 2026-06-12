# RBK Command Center — Architectural Assessment for HS Expansion

**Date:** 2026-05-21
**Author:** Codebase analysis (read-only)
**Context:** Planning to expand from SAR Academy Lower School to also serve SAR High School.

---

## Section 1: Current User Model

### How a user is identified after login

The full auth flow is multi-step and ultimately produces a JSON-encoded `__session` cookie that downstream API routes read via `lib/auth.ts → getAuthSession()`.

1. Client-side: `app/login/page.tsx` — Firebase Auth Google popup. Scopes requested at sign-in: `calendar.readonly`, `calendar.events`, `gmail.readonly`, `gmail.send`, `gmail.modify` (`app/login/page.tsx:9-13`). The Firebase access token + ID token are sent to `/api/auth/session`.
2. Server: `app/api/auth/session/route.ts` verifies the Firebase ID token, derives the email, then checks `ALLOWED_EMAILS` env var **or** any matching `workspace_members` row (`route.ts:28-36`). On first sign-in it swaps `PLACEHOLDER_*` `user_id` rows for the real Firebase UID (`route.ts:90-98`).
3. It then loads all `workspace_members` rows for the user, picks owner-role first as default, and serializes `{ workspace_id, role, modules, module_config, allowed_modules, workspaces[], accessToken, user{email,name,image} }` into the `__session` cookie. The Google access token rides along inside `__session` and is **not** stored in the DB on a per-user basis (see Section 2).
4. Client: `AuthProvider.tsx` reads back `/api/auth/session/workspace`, computes `effectiveModules = getEffectiveModules(modules, allowedModules)`, and exposes `useAuth()` + `useWorkspace()` hooks. The session is refreshed every 10 min (`AuthProvider.tsx:239-241`).

**Fields available on the server session object** (`AuthSession` in `lib/auth.ts:3-15`): `user.email`, `user.name`, `user.image`, `accessToken`, `workspaceId`, `role`, `modules`, `moduleConfig`, `allowedModules`.

**Fields on the client workspace context** (`AuthProvider.tsx:39-52`): `workspaceId`, `role` (`owner|assistant|viewer`), `modules`, `moduleConfig`, `allowedModules`, `effectiveModules`, `displayName`, `workspaces[]`, `switchWorkspace()`, `impersonating`, `startImpersonation()`, `stopImpersonation()`.

### Exhaustive list of hardcoded references to specific users

This is grouped by category. Every reference was confirmed with grep across `app/` and `lib/`.

**A. Admin gate (Rebecca's email)**
- `lib/impersonate.ts:4` — `const ADMIN_EMAIL = 'rglassberg@saracademy.org'`
- `app/api/admin/workspace-members/route.ts:5` — same constant
- `app/api/admin/workspace-members/[id]/route.ts:5` — same constant
- `app/admin/permissions/page.tsx:8` — same constant (and many uses at lines 124, 156, 296, 374, 613, 620, 621, 626, 627, 701, 703)
- `app/home/page.tsx:59` — `if (user?.email?.toLowerCase() !== 'rglassberg@saracademy.org') return;` (gates loading impersonation member list)
- `app/components/Dashboard.tsx:281` — same email check
- `app/api/calendar/today/route.ts:49`, `app/api/calendar/week/route.ts:15` — admin check to enable impersonation header reading

**B. RBK / Bini (workspace owner) hardcoded**
- `app/page.tsx:34` — `const rbkCalendarId = 'kraussb@saracademy.org'` (server-side calendar fetch always targets RBK's calendar)
- `app/home/page.tsx:18-19` — `POWER_USERS = ['kraussb@saracademy.org','egray@saracademy.org']`, `NAME_OVERRIDES = { 'kraussb@saracademy.org': 'Bini' }`
- `app/components/Dashboard.tsx:2496` — `const OWNER_EMAIL = 'kraussb@saracademy.org'` (filters out emails the owner sent)
- `app/components/Dashboard.tsx:2842` — confirmation prompt hardcodes `kraussb@saracademy.org`
- `app/components/Dashboard.tsx:3436` — `user.email === 'kraussb@saracademy.org'` → "Good morning, Bini." greeting
- `app/components/Dashboard.tsx:10150-10152` — RBK Instagram/LinkedIn/X hardcoded into footer (`@kraussb`, `bini-krauss`, `@binikrauss`)
- `app/api/auth/gmail-callback/route.ts:4` — `WORKSPACE_OWNER_EMAIL = 'kraussb@saracademy.org'` (only this email's OAuth grant updates `workspaces.gmail_refresh_token`)
- `app/api/emails/compose/route.ts:24`, `app/api/emails/send-batch/route.ts:44`, `app/api/emails/[id]/send/route.ts:38,166` — all emails sent FROM `kraussb@saracademy.org`
- `app/api/development/draft-thank-you/route.ts:23,36,110` — system prompt for thank-you notes hardcodes "Rabbi Bini Krauss, principal of SAR Academy" and `kraussb@saracademy.org`
- `app/api/recruiting/notes/route.ts:7` — Lever user ID mapping hardcodes `'kraussb@saracademy.org'`
- `app/api/webhook/lever/route.ts:56` — Slack DM goes to `channel: 'U04NBR22Y'` (RBK's Slack ID)
- `app/api/gmail/process-email/route.ts:5` — `LABEL_NAME = 'RBK/Done'` (Gmail label name embeds "RBK")

**C. Email signature embedded in HTML (across 3 routes)**
- `app/api/emails/compose/route.ts:5-21`
- `app/api/emails/send-batch/route.ts:24-41`
- `app/api/emails/[id]/send/route.ts:18-34`
- All embed: name "Rabbi Binyamin Krauss", title "Principal", phone "718.548.1717 ext. 1206", email `kraussb@saracademy.org`, LinkedIn `bini-krauss`, SAR logo image.

**D. Emily / Gray (assistant) hardcoded**
- `app/home/page.tsx:18` — `egray@saracademy.org` in POWER_USERS
- `app/components/EmailDashboard.tsx:39-104,136,153,184,191,304,362,372,417-467,617-694,776-777,885` — RBK / Emily tasks columns, labels, classes, assignee enums
- `app/components/Dashboard.tsx:163,194-195,400,1018,1688,1786,2293-2350,2477-2543,2606,2665,2676,2683,2755,4162,4246,4923-4925,5241-5650,5663-5767,6086,6304-6312,6528-6534,6952,9864-9959,10254-10311,10588-10710,11225-11436` — pervasive `'rbk' | 'emily'` UI (two-column tasks layout, project assignee toggle, agenda notes assignee toggle, "Emily's Queue" sidebar, "Drafts to Approve" workflow, "Notify Emily / Escalate to Emily" action labels, Send-to-Emily buttons, etc.)
- `app/components/Sidebar.tsx:34,61,360,377,379` — `emilyQueueCount` prop, "Emily's Queue" nav item
- `app/components/SimchasSendNoteModal.tsx:72,77,80,85,110` — "Send to Emily" UI copy
- `app/api/simchas/send-note/route.ts:7,49-104` — `EMILY_SLACK_ID = 'U05M5KT86GK'`, hardcoded assignee `'Emily'` for simchas notes
- `app/api/recruiting/notes/route.ts:8` — `egray@saracademy.org` in Lever user map
- `app/styles/design-tokens.css:26` — `--color-emily: #7c3aed`

**E. Hardcoded Slack IDs (defined in 3+ places, identical roster)**
- `lib/slackNotifications.ts:18-24` — `TASK_USERS` = {RBK: U04NBR22Y, Emily: U05M5KT86GK, Sara: U04NB3YP3, Leora: U05M4L1RY6Q, Becca: U04PVHXSD}
- `app/components/development/DonorAnnotations.tsx:25-29` — same 5 users repeated with email + slackId
- `app/api/development/donor-notes/route.ts:27-31` — same 5 users repeated
- `app/api/tasks/due-today/route.ts:9-13` — same 5 Slack IDs

**F. Hardcoded assignee enum / CHECK constraints**
- `app/api/tasks/route.ts:11-14` — `ASSIGNEE_NORMALIZE` whitelist {RBK, Emily, Sara, Leora, Becca}
- DB `tasks.assigned_to` CHECK: `ANY (ARRAY['RBK','Emily','Sara','Leora','Becca'])` (verified via Supabase MCP)
- DB `agenda_notes.assignee` CHECK: `ANY (ARRAY['rbk','emily','sara','leora','becca', NULL])`
- DB `emails.assigned_to` CHECK: `ANY (ARRAY['rbk','emily'])` (only 2 — narrower than tasks)
- DB `emails.priority` (no CHECK live, but UI uses) `'rbk_action' | 'eg_action' | 'invitation' | 'meeting_invite' | 'important_no_action' | 'review' | 'fyi' | 'drafts_ready'` (per `app/api/webhook/email/route.ts:21`)
- `app/components/home/TodayTasksCard.tsx:18-19` — `EMAIL_TO_ASSIGNEE = { 'kraussb@...': 'rbk', 'egray@...': 'emily' }` (so this card silently shows zero tasks for anyone other than RBK or Emily)

**G. Seed workspace ID hardcoded as fallback**
- `app/api/webhook/email/route.ts:91` — `const RBK_WORKSPACE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'` (only one workspace handled by the email webhook)

### Does workspace_members have an "assistant TO" relationship?

**No.** Verified directly against Supabase (`mcp__claude_ai_Supabase__list_tables`):

```
workspace_members columns:
  id (uuid PK)
  workspace_id (uuid FK → workspaces.id)
  user_id (text, Firebase UID or PLACEHOLDER_*)
  email (text)
  role (text, CHECK IN ['owner','assistant','viewer'])
  display_name (text)
  allowed_modules (jsonb)
  created_at (timestamptz)
```

The `role` column says **what** kind of member someone is (`assistant`), but there is no column saying **whose** assistant they are. Today the system assumes "the workspace has exactly one owner, and any `role='assistant'` row works for that owner". This worked when one workspace = RBK + Emily. It breaks the moment a workspace has multiple owners (e.g. SAR HS principal + LS principal in one workspace).

To support assistant-TO relationships, add a column:

```sql
ALTER TABLE workspace_members ADD COLUMN assistant_to uuid REFERENCES workspace_members(id);
-- nullable; only meaningful when role = 'assistant'
```

(Or `assistant_to_email text` if you want to dodge the FK-to-same-table awkwardness — but a `workspace_members.id` FK is cleaner because it survives email changes.)

### Making the Tasks page user-aware

**Current rendering:** Two hardcoded columns in `app/components/Dashboard.tsx`:
- RBK column: lines 5241-5644 (`pendingRbk` filtered at `:2334` as `t.assignee === 'rbk'`)
- Emily column: lines 5645-5780 (`pendingEmily` filtered at `:2336` as `t.assignee === 'emily'`)

The columns hardcode header text "RBK" and "Emily" (`:5244`, `:5648`), the filter is hardcoded to the lowercase string literals, and the sub-sections "From Development" / "From Admissions" filter `sourcedTasks` against `assigned_to === 'RBK'` (`:5254`, `:5325`) — note the case mismatch (Capitalized in `tasks.assigned_to`, lowercase in `agenda_notes.assignee`).

**API endpoints involved:**
- `GET /api/tasks` (`app/api/tasks/route.ts:20-46`) — returns all workspace tasks; does NOT filter by assignee
- `GET /api/agenda-notes?type=action` (`app/api/agenda-notes/route.ts:6-42`) — returns all workspace action notes; does NOT filter by assignee
- The Dashboard fetches both lists and partitions them client-side by `assignee` string

**What it takes to make this user-aware:**
1. Resolve the current user's "assignee key" — today there is no canonical mapping from `workspace_members.email` → an assignee string. Either (a) add a column `workspace_members.assignee_key text` (containing 'rbk', 'emily', 'sara', etc.) or (b) use `display_name`'s first token. Option (a) is cleaner because it survives renames.
2. Resolve the assistant's `workspace_members.id` via the new `assistant_to` column (or fall back to "any other owner in the same workspace" if multi-owner).
3. Refactor the two columns into a single parameterized component that takes `{ memberId, memberLabel, assigneeKey }` and is rendered twice (`<TaskColumn member={me} />`, `<TaskColumn member={myAssistant} />`).
4. Replace literal `'rbk'`/`'emily'`/`'RBK'`/`'Emily'` in `Dashboard.tsx` with the resolved keys (~30 sites). The capitalization mismatch between `tasks.assigned_to` and `agenda_notes.assignee` should be unified at the same time (pick one canonical form and migrate the other table's data + CHECK constraint).
5. `lib/slackNotifications.ts` `TASK_USERS` lookup currently keyed by literal Capitalized names — needs to be keyed by `workspace_members.id` (or `workspace_members.email`) and read Slack IDs from a new `workspace_members.slack_user_id text` column.

---

## Section 2: Calendar & Email Personalization

### Calendar — is it RBK-only or per-user?

**Mixed, and there is a real mismatch in `app/page.tsx`.**

- `app/page.tsx:34` hardcodes `rbkCalendarId = 'kraussb@saracademy.org'` and pulls today's events server-side using the **logged-in user's** `__session.accessToken` Bearer token. The Google Calendar API allows Calendar API requests to read calendars the token's user has access to — so this works for Bini (his own calendar) and works for Emily because she has been granted read access to Bini's calendar. **It does not work for anyone else** unless they've been granted access to `kraussb@saracademy.org`. This is the legacy hardcoded path used by the original Dashboard route.
- `app/api/calendar/today/route.ts:58,85` and `app/api/calendar/week/route.ts:22,36` use the **proper** per-user path: they call `getValidGoogleToken(workspaceId, calendarEmail)` from `lib/googleToken.ts` (which reads `user_google_tokens` table) and then hit `calendars/primary/events`. This is dynamic and works correctly for any user once they connect their Google account via the Gmail-callback flow.

**Tokens are stored per (workspace_id, user_email)** in `user_google_tokens` (columns: `workspace_id`, `user_email`, `access_token`, `refresh_token`, `token_expiry`, `scopes`) — that table has 3 rows already. The workspace-level token `workspaces.gmail_refresh_token` is only written when the connecting user is RBK (`app/api/auth/gmail-callback/route.ts:89`).

**So there are TWO calendar paths in parallel.** The newer `/api/calendar/today` + `/api/calendar/week` are correct and multi-user-safe. The older server component `app/page.tsx:29-112` is hardcoded to RBK and will silently fail for any user who isn't on RBK's calendar ACL.

### Gmail — RBK-tied?

**Yes, completely.** All three send routes embed `kraussb@saracademy.org` and Rabbi Krauss's signature as a compile-time constant:
- `app/api/emails/compose/route.ts:14, 24` (Compose new)
- `app/api/emails/send-batch/route.ts:34, 44` (Batch send)
- `app/api/emails/[id]/send/route.ts:27, 38, 166` (Reply to email)

The `From:` header is **literally `kraussb@saracademy.org`** in every outgoing MIME message. The signature HTML in all three files is duplicated (not factored to a single module) and includes the SAR logo, phone, LinkedIn, etc. for RBK only.

The Gmail API uses `users/me/messages/send` with the access token from `session.accessToken` (which lives in the `__session` cookie). For this to succeed when a non-RBK user is signed in, that user would need Gmail "Send As" delegation for `kraussb@saracademy.org` — see `[id]/send/route.ts:166` which explicitly raises "Permission denied. Make sure you have Send As permissions for kraussb@saracademy.org" on 403.

The email *sync* pipeline (Cloud Functions, not in this repo's `app/api/`) reads from `workspaces.gmail_refresh_token` — also one-per-workspace, also currently only RBK's token.

**To support multiple senders** (Bini's emails for Bini, Emily's for Emily):
1. The three send routes need to read `fromEmail`, `fromName`, and the signature HTML from `workspace_members` (e.g. add `display_name`, `title`, `phone`, `signature_html`, `from_email_override` columns) or from a new `email_identities` table keyed by `(workspace_id, user_email)`.
2. The Gmail API call would target the per-user token from `user_google_tokens` instead of `session.accessToken` (which is brittle — see below).
3. If multiple users in the same workspace each have their own Gmail being synced (e.g. an HS principal who wants their own inbox triaged), `workspaces.gmail_refresh_token` becomes 1-to-many: move the token to `workspace_members.gmail_refresh_token` (or keep it in `user_google_tokens` and have the Cloud Functions loop members instead of workspaces).

### OAuth scopes — per-user or shared?

- **Requested at login** (`app/login/page.tsx:9-13`): `calendar.readonly`, `calendar.events`, `gmail.readonly`, `gmail.send`, `gmail.modify`. These are baked into the popup-flow for every user.
- **Storage**: The access token from the popup is placed in the `__session` cookie (`app/api/auth/session/route.ts:147-171`). It is a Firebase OAuth credential's access token; Firebase does not return a refresh token through `signInWithPopup`, so this token is short-lived (~1 hour) and there is no per-user refresh path tied to login. To get a long-lived refresh token, the user must run the separate `/api/auth/gmail-consent` → `/api/auth/gmail-callback` flow (which requests `access_type: offline + prompt: consent`) and the refresh token is written to `user_google_tokens` keyed by `(workspace_id, user_email)`.
- The session cookie's `accessToken` is what `app/api/emails/compose/route.ts:92`, `app/api/emails/[id]/send/route.ts:152`, etc. use to call Gmail. So **email sends today rely on the short-lived cookie token, not the stored refresh token**. After ~1 hour the cookie token expires; the next ID-token refresh in `AuthProvider.tsx` doesn't re-fetch a new Google access token (it only re-issues the Firebase ID token). The right fix is to retire `session.accessToken` and have every Google-API endpoint go through `getValidGoogleToken(workspaceId, email)` — which is already the pattern the calendar routes use.

---

## Section 3: Veracross Data & High School

### Where is HS filtered out?

Every place is a hardcoded grade-list filter, not a configurable workspace setting.

- **Absences** — `app/api/absences/route.ts:40` `const HS_GRADING_PERIOD = 29` and lines 202, 327, 358 do `.neq('grading_period', HS_GRADING_PERIOD)` to exclude HS attendance. Grade labels at `:23-37` cover only ELC through 8th grade (no 9-12).
- **Absences sync** — `app/api/absences/sync/route.ts:5, 123` — same HS_GRADING_PERIOD=29 exclusion when writing to `attendance_cache`.
- **Admissions** — `app/api/admissions/route.ts:154, 156` — `HS_GRADES = [9,10,11,12]`, applications filtered `!HS_GRADES.includes(a.grade_applying_for)`. Lines 130-131 hardcode `RE_ENROLLMENT_GRADE_LEVELS = [40,35,30,25,20,1..7]` (no 8 because 8th doesn't re-enroll into LS) and `CURRENT_YEAR_GRADE_LEVELS = [40,35,30,25,20,1..8]`.
- **Admissions reenrollment** — `app/api/admissions/reenrollment/route.ts:90, 96` — same `HS_GRADES = [9,10,11,12]` exclusion.
- **Recruiting (Lever)** — `app/api/webhook/lever/route.ts:40-46` and `app/api/lever/route.ts:13` — `dept === 'SAR High School' || team.includes('High School')` → skip. Excludes HS job postings from the workspace.
- **Dashboard** — `app/components/Dashboard.tsx:9319` — `leverData.postings.filter(... 'SAR High School' || team.includes('High School'))` in the recruiting count display.
- **Grade label maps** — `app/components/Dashboard.tsx:1188-1190` (admissions card labels), `app/api/absences/route.ts:23-37` — none of them define labels for grades 9-12.

### Veracross data model — does it separate LS/HS?

**Yes, there are 3+ signals already on Veracross records:**

1. **`grade_level`** — students 1-8 = LS/MS, 9-12 = HS, plus ELC codes 20-40 (Kindergarten and younger).
2. **`grading_period`** — 19 = lower/middle, 29 = HS (per the comment at `app/api/absences/route.ts:58`).
3. **`campus`** — admissions student records have a `campus` numeric ID (`app/api/admissions/route.ts:33, 244`). Today the code reads `s.campus` but does not filter on it. This is the cleanest field for division segmentation if Veracross uses different campus IDs for LS vs HS.
4. **Lever `department/team`** — for the `recruiting` module, the strings `'SAR Academy'` (LS) vs `'SAR High School'` distinguish division.

### What is currently synced from Veracross?

- **Students roster** — pulled live (no cache) by `app/api/absences/route.ts:121-...` and `app/api/admissions/route.ts:140-...`. Used to build `gradeMap` for joining with attendance and to count enrollment by grade.
- **Attendance** — cached in `attendance_cache` table (121,238 rows). Synced by `app/api/absences/sync/route.ts`. HS already filtered out at sync time.
- **Admissions applications, applicants, households** — pulled live each request (no cache). HS filtered out at request time.
- **Gifts/Development** — cached in `gifts_cache` table (12,429 rows). Synced via `lib/syncGifts.ts`. Gifts have NO division field on the gift record; the comment at `syncGifts.ts:57` flags this as a known gap. Donations to SAR are likely not split by LS/HS at all in Veracross.
- **Enrollment budget / grade overrides** — stored in `enrollment_budget` (13 rows) and `enrollment_grade_overrides` (74 rows), but `grade_code` is text and `RE_ENROLLMENT_GRADE_LEVELS = [40,35,30,25,20,1..7]` is implicitly LS-only.

**Which apply to HS, LS, or both?**

| Module | LS | HS | Notes |
|---|---|---|---|
| `absences` (students) | ✅ | ⚠️ excluded by HS_GRADING_PERIOD=29 | Same Veracross account; just toggle the filter |
| `admissions` | ✅ | ⚠️ excluded by HS_GRADES list | New applications, re-enrollment |
| `faculty_absences` | ✅ both potentially | ✅ both potentially | Sourced from Paycom/Google Sheet, not Veracross — likely already org-wide |
| `recruiting` (Lever) | ✅ | ⚠️ explicitly filtered out | Lever postings tagged with department; filter is the only thing excluding HS |
| `gifts_cache` / development | shared org-wide | shared org-wide | Gifts to "SAR" not split LS/HS |
| `simchas` | shared | shared | iCal feed from `barbatmitzvah@saracademy.org` — community-wide |
| `gemara` | RBK-specific | n/a | Resource card config; not data-driven |

### A "unified but segmented" model

Concretely, three layers of filter could exist; pick the right one for each module:

1. **DB-level RLS** — works for tables where the data itself has a division column (e.g. add `division text` to `gifts_cache`, `attendance_cache` if you decide to store both LS and HS). Then RLS policy: `workspace_members.divisions @> ARRAY[row.division]`. This is brittle for tables that don't have a per-row division (gifts) and overkill for live API passes through (admissions, recruiting).
2. **API-level WHERE clause** — for cached tables, the API route reads the user's allowed divisions from `workspace_members` and adds `.in('division', userDivisions)`. This is the right layer for `attendance_cache` and (if expanded) `gifts_cache`.
3. **App-level filter on effectiveModules** — for live Veracross/Lever fetches, the API route applies the existing HS-exclusion filter conditionally based on what the user can see. For example: a member with `divisions: ['ls']` keeps the current filter; `divisions: ['hs']` reverses it; `divisions: ['ls','hs']` (executive director) returns everything.

**Recommended:** Add `workspace_members.divisions text[]` (default `['ls']` for now). All HS-exclusion sites become `if (memberDivisions.includes('ls') && !memberDivisions.includes('hs')) filterOutHS()`. Debra May (exec director) gets `['ls','hs']`. New HS-only staff get `['hs']`.

---

## Section 4: Multi-Workspace vs Single-Workspace

### What is the existing `workspaces` table used for today?

- 1 row in `workspaces` (verified: RBK's seed `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).
- The workspace switcher in `AuthProvider.tsx:85-97` and the `workspaces[]` array in the session cookie were built so that a user with rows in multiple workspaces (e.g. Becca is owner of "Becca — Dev" + assistant on RBK's) could toggle between them. Per `SAAS_ARCHITECTURE.md:185-193`, dev was set up as a second workspace row in the same Supabase project specifically to validate this pattern works.
- Each workspace owns: its `modules` JSONB (feature flags), its `module_config` JSONB (per-module settings like `inbox.owner_label='RBK'`), its `gmail_refresh_token`, and all data scoped via `workspace_id` on every table.
- RLS enforces `workspace_id = current_workspace_id()` across all data tables (`PHASE6_RLS.sql`).

**The workspace abstraction is well-built. Its current sole purpose is dev-vs-prod separation, but it's the same mechanism that would split SAR LS from SAR HS if you took Option B below.**

### Option A: One workspace, division field on workspace_members

**What changes:**
- Add `workspace_members.divisions text[]` (e.g. `['ls']`, `['hs']`, `['ls','hs']` for exec).
- Veracross filter sites (Section 3) consult `memberDivisions` instead of hardcoded exclude lists.
- Sidebar / page content still gated by `effectiveModules`. Add per-division module flags if needed (e.g., HS doesn't use `gemara`).
- Tasks/agenda assignees expand from 5 hardcoded names (RBK/Emily/Sara/Leora/Becca) to N HS staff — requires the assignee-key refactor anyway (Section 1).

**Pros:**
- Exec directors (Debra May) trivially see both — just `divisions: ['ls','hs']`.
- Single Gmail-pipeline workspace, single `gmail_refresh_token` for the org (today still one).
- Cross-school agenda items / projects / donor notes "just work" — same `workspace_id`.
- No workspace-switcher friction for users with cross-school roles.

**Cons:**
- All HS-vs-LS filtering becomes app-level concerns. Easy to miss a filter site and leak data across divisions.
- Currently the `inbox.owner_label` and `module_config` are per-workspace, so a single workspace can't easily say "Bini and Emily for LS, X and Y for HS." Would need to extend `module_config` (or move to `workspace_members.config`).
- Workspace owner role: today there's one. If LS and HS each have a principal/exec director, do they both get `role='owner'`? Yes — but the "owner" semantics in `getAuthSession` only matter for the default-workspace pick, not for permissions.

### Option B: Two workspaces (`SAR-LS`, `SAR-HS`)

**What changes:**
- Insert second workspace row. Cross-school staff get a second `workspace_members` row.
- Each workspace has its own `modules`, `module_config`, `gmail_refresh_token` (if HS has its own inbox to triage).
- Tasks/agenda/projects are scoped to one workspace at a time. Exec directors switch workspaces to see the other school's data.

**Pros:**
- Strong data isolation guaranteed by existing RLS (`workspace_id = current_workspace_id()`) — no risk of leaks.
- Per-workspace email pipelines clean — HS principal can connect their own Gmail to the HS workspace without touching LS.
- The existing switcher UX already supports this; minimal new code.
- Easy to onboard HS as a separate phase without touching LS at all (additive).

**Cons:**
- Exec directors get a worse UX — they have to switch workspaces to see HS vs LS data instead of seeing both at once. The current switcher reloads the page (`AuthProvider.tsx:96`).
- Cross-school projects/donor notes/agenda items have to be duplicated or live in a third "Org" workspace.
- Impersonation flows (`getEffectiveWorkspaceId`, `getEffectiveMembership`) already work across workspaces, no change needed.
- Doubles the count of `workspace_members` rows for any cross-school staff; potential drift if roles in two workspaces diverge.

### Recommendation

**Option A (one workspace, division field) for LS+HS, with the existing workspace boundary reserved for true tenant isolation (e.g., a future "second school district" tenant).**

Reasoning:
- LS and HS are still **one organization** (SAR Academy). Donors give to "SAR", not separately. Exec directors fundamentally need both-school visibility, and the existing switcher is page-reload-heavy and not built for "view both at once".
- The current architecture already supports per-user data scoping via `allowed_modules`; extending it with `divisions text[]` is a natural continuation.
- Workspaces as a tenancy boundary should remain reserved for true multi-org SaaS — if SAR ever sells this product to another school, *that* becomes a new workspace.
- The biggest cost (cross-workspace agenda/projects) is avoided.

The main risk with Option A is forgetting a division-filter site and leaking data — mitigate by:
1. Adding an integration test that hits each Veracross-touching API route with a fixture HS user and asserts no HS data appears.
2. Refactoring the HS-exclusion constants into a single helper in `lib/` (e.g. `lib/divisions.ts → filterByDivision(rows, memberDivisions)`) — today the constants are duplicated across `app/api/absences/*`, `app/api/admissions/*`, `app/api/lever/*`.

---

## Section 5: Recommended Changes

### Schema changes

**a) Assistant TO relationship:**
```sql
ALTER TABLE workspace_members
  ADD COLUMN assistant_to uuid REFERENCES workspace_members(id),
  ADD COLUMN assignee_key text,        -- 'bini', 'emily', 'sara', etc. — replaces hardcoded names
  ADD COLUMN slack_user_id text;       -- per-member Slack ID, replaces hardcoded TASK_USERS map
```
Backfill: `assignee_key` from current `display_name.split(' ')[0].toLowerCase()`, `slack_user_id` from existing constants, `assistant_to` set manually (Emily → Bini's row, Sara/Leora/Becca → null or → Bini).

**b) Per-user Google tokens (already half-done):**
The `user_google_tokens` table already exists with `(workspace_id, user_email, access_token, refresh_token, token_expiry, scopes)`. The remaining work is to **stop using `session.accessToken` from the cookie** for any Gmail/Calendar call — route everything through `getValidGoogleToken()`. Then the `__session` cookie loses `accessToken` entirely.

For workspace-level Gmail sync (Cloud Functions): keep `workspaces.gmail_refresh_token` for the legacy single-owner case, OR migrate to `workspace_members.is_gmail_synced boolean` so Cloud Functions loop synced members instead of workspaces. Recommend the latter — more flexible.

**c) Division segmentation:**
```sql
ALTER TABLE workspace_members
  ADD COLUMN divisions text[] DEFAULT ARRAY['ls'];
-- Values: 'ls', 'hs', or both for execs. Empty = no division-scoped data.
```
Centralize the filter in `lib/divisions.ts`:
```ts
export function canSeeDivision(memberDivisions: string[], rowDivision: 'ls' | 'hs'): boolean { ... }
export function veracrossGradeFilterForMember(divisions: string[]) { ... }
```
Then replace the 8 hardcoded HS-exclusion sites with calls to the helper.

**d) Email identities / signatures:**
```sql
ALTER TABLE workspace_members
  ADD COLUMN email_identity_html text,  -- signature HTML
  ADD COLUMN title text;                -- "Principal", "Executive Director", etc.
```
The three send routes read `from_email` from `session.user.email`, `from_name` from `display_name` (or `display_name + " " + title`), and signature from `email_identity_html`. Drop the duplicated `EMAIL_SIGNATURE` constants from all three.

### Scope estimate: Tasks page user-aware

**Medium (1-3 days).** Justification:
- The two columns are a copy-paste pair in `Dashboard.tsx` totaling ~530 lines (5241-5780). Extracting to a reusable `<TaskColumn />` component is mechanical.
- Filter logic at lines 2334-2350 needs to accept dynamic `assigneeKey` arguments — straightforward.
- The "From Development" / "From Admissions" sub-sections at 5254 and 5325 need their hardcoded `assigned_to === 'RBK'` replaced with the resolved key — case mismatch (Capitalized vs lowercase) between `tasks` and `agenda_notes` should be unified at the same time, which means a one-time migration + CHECK constraint replacement.
- `Slack` notifications (`lib/slackNotifications.ts`) need to consult `workspace_members.slack_user_id` instead of the literal map.
- Tests for the assignment flow + the moving-between-columns drag-and-drop need re-validation.

What pushes it from small to medium is the data migration (capitalization unification) and the touch-points being scattered across `Dashboard.tsx`. If the case mismatch were already cleaned up, this would be a 4-6 hour refactor.

### Refactor checklist (hardcoded → dynamic)

The Section 1 enumeration is the canonical list. Reorganized as a build order:

1. **Workspace owner identity** — replace `'kraussb@saracademy.org'` in 12 sites with `workspace.owner_email` lookup.
2. **Assistant identity** — replace `'egray@saracademy.org'` in ~5 sites with assistant lookup via `assistant_to` (or `WHERE role='assistant'`).
3. **POWER_USERS / NAME_OVERRIDES** in `app/home/page.tsx:18-19` — drive from `workspace_members.role IN ('owner','assistant')` and `display_name` respectively.
4. **TodayTasksCard** EMAIL_TO_ASSIGNEE — drive from `workspace_members.assignee_key`.
5. **Slack TASK_USERS** in `lib/slackNotifications.ts` + duplicates in `donor-notes/route.ts`, `DonorAnnotations.tsx`, `tasks/due-today/route.ts` — single source of truth via `workspace_members` lookup.
6. **Calendar `rbkCalendarId`** in `app/page.tsx:34` — switch to `calendars/primary` like `/api/calendar/today` already does, or delete the legacy server-side fetch and let the client-side TodayScheduleCard handle it.
7. **Gmail send `fromEmail` + signature** in 3 routes — read from `workspace_members`.
8. **`OWNER_EMAIL` in Dashboard.tsx:2496** — read from `workspace.owner_email`.
9. **"RBK/Done" Gmail label** — make it `${owner_label}/Done` via `module_config.inbox.owner_label`.
10. **Hardcoded RBK Instagram/LinkedIn/X in Dashboard.tsx:10150-10152** — move to `workspace.social_links jsonb` or a config table.
11. **Lever user map** in `app/api/recruiting/notes/route.ts:7-9` — add `workspace_members.lever_user_id text`.
12. **Email priority enum `rbk_action` / `eg_action`** — rename to `owner_action` / `assistant_action`. This requires a data migration + Cloud Function update. Defer until the rest stabilizes.

### Build order

**Phase A — Foundations (do first, low risk):**
1. Migrate `tasks.assigned_to` and `agenda_notes.assignee` to a unified canonical form (one case). Update CHECK constraints.
2. Add columns: `workspace_members.assignee_key`, `slack_user_id`, `assistant_to`, `divisions`, `title`, `email_identity_html`.
3. Backfill all the above for the 9 existing members.
4. Add `lib/divisions.ts` helper. Replace the 8 hardcoded HS-exclusion sites.
5. Move per-Slack-ID and per-Lever-user maps from constants to `workspace_members` lookups.

**Phase B — Tasks page generalization:**
6. Extract `<TaskColumn />` from Dashboard.tsx. Replace `pendingRbk`/`pendingEmily` with `pendingMine`/`pendingTheirs` driven by current user + assistant_to.
7. Update the agenda assignee toggles and project assignee toggles similarly.
8. Test with Becca's dev workspace impersonating different members.

**Phase C — Email & Calendar de-RBK-ification:**
9. Replace email send signatures with per-member identity reads.
10. Retire `session.accessToken` for Gmail/Calendar — every API route uses `getValidGoogleToken()`.
11. Update `app/page.tsx` to either use `primary` calendar or delete the legacy server fetch.

**Phase D — HS Onboarding (additive):**
12. Add first HS member rows (HS principal + assistant if any) with `divisions: ['hs']`.
13. Toggle the workspace's `modules` for any LS-only modules HS doesn't need.
14. Verify all Veracross fetches respect the new division filter.
15. Run a side-by-side impersonation test of HS user vs LS user vs exec (`divisions: ['ls','hs']`).

**Phase E — Cleanup:**
16. Rename `rbk_action` / `eg_action` priorities to `owner_action` / `assistant_action`.
17. Move RBK-specific UI strings ("RBK Command Center" title, RBK socials, "Bini" greeting) behind `workspace.brand jsonb` config.

---

## Section 6: Future integrations — Google Tasks

**Yes, the `tasks` table can be synced with each user's Google Tasks**, with caveats:

- **Scope needed**: `https://www.googleapis.com/auth/tasks` (read+write) or `tasks.readonly` for one-way. Add to the login scopes list at `app/login/page.tsx:9-13` and/or to the `gmail-consent` flow.
- **Direction**:
  - **App → Google (one-way push)**: Create a Google Tasks task whenever a new row is inserted into `tasks` assigned to the current user. Use the user's `user_google_tokens.access_token` (already stored). Set `notes` to a link back to the Command Center task.
  - **Google → App (sync back)**: Poll the user's `@default` task list periodically (or use Tasks API push notifications via Pub/Sub — limited support) and upsert. Requires a `tasks.google_task_id text` column and a `tasks.google_task_list_id text` to track the mapping.
  - **Two-way**: Combine both, with a last-modified comparison to resolve conflicts. Add `tasks.synced_at timestamptz` and `tasks.google_etag text`.
- **Gotchas**:
  1. **Google Tasks has no assignee field.** Each Google account has its own task list. So our `tasks.assigned_to = 'Emily'` would be synced to *Emily's* Google account — meaning at sync time we need to look up the assignee's `user_google_tokens` row, not the current user's. This requires that the assignee has connected their Google account; if they haven't, the task can't be pushed.
  2. **Google Tasks has no priority field, no labels, no project linkage.** Our `priority`, `source`, `project_id` columns are lost on the Google side. Workaround: stuff a JSON-encoded blob into the `notes` field with our metadata.
  3. **Google Tasks only has one due date** (no time, just `due` date). Our `due_date` is `timestamptz`. Map `tasks.due_date::date` → `google.due`.
  4. **Status mapping is binary**: Google has `needsAction` and `completed`. Our `todo` / `in_progress` / `done` / `archived` collapses to `needsAction` / `needsAction` / `completed` / (skip). `in_progress` doesn't round-trip.
  5. **No labels in Google Tasks free API.** The `source = 'development'` / `source = 'admissions'` tagging that drives the "From Development" / "From Admissions" sub-sections in `Dashboard.tsx:5254, 5325` can't be visible on the Google side. Could use multiple **task lists** (one per source) but then the user has 5 lists instead of 1, which fragments their Google Tasks UX.
  6. **Rate limits**: Google Tasks API is 50,000 queries/day/project but only 500 per user per 100 seconds. For 5 users this is plenty, but a big initial backfill needs throttling.
  7. **Deletion semantics differ**: deleting in Google means hard-delete; our `status='archived'` is soft. Decide a policy.

**Recommended starter pattern (one-way, app→Google):** Add `tasks.google_task_id text NULL`. On task insert/update, fire-and-forget an upsert to the assignee's Google Tasks `@default` list. Store the returned ID. On task delete, mark Google task as completed (not deleted, to preserve audit). One-way is ~2 days of work; two-way is ~1 week including conflict resolution and webhook polling.

---

## Summary

The app is highly hardcoded to two specific users (Bini Krauss and Emily Gray) at dozens of sites across the codebase, even though the underlying schema (`workspaces`, `workspace_members`, `modules`, `allowed_modules`, `user_google_tokens`) is already a well-built multi-tenant foundation. The biggest architectural gap is that `workspace_members` knows what role someone has (`owner | assistant | viewer`) but has no `assistant_to` pointer, so there is no way for the Tasks page to say "show me the current user's column and the column of whoever assists them" — both columns are filtered by literal strings `'rbk'` and `'emily'`. Calendar is partially de-RBK'd (per-user tokens in `user_google_tokens`, but `app/page.tsx:34` still hardcodes RBK's calendar) while Gmail send is entirely RBK-only — every outgoing message hardcodes the From address, name, and signature HTML. For HS expansion, **one workspace with a `divisions text[]` column on `workspace_members` is the right call** — LS and HS are one organization, exec directors need both-school visibility, and Veracross already has natural division signals (`grade_level`, `grading_period=29`, `campus`, Lever department) that just need to be flipped from a hardcoded exclusion list to a member-aware helper. Build order: **(A) foundations** — add `assistant_to`, `assignee_key`, `slack_user_id`, `divisions`, `email_identity_html` columns and unify the `tasks`/`agenda_notes` case mismatch first; **(B) Tasks page generalization** to remove the RBK/Emily column literals; **(C) Email & calendar de-RBK-ification** including retiring `session.accessToken` in favor of `getValidGoogleToken()`; **(D) HS onboarding** by adding member rows with `divisions: ['hs']` and flipping the centralized division filter; **(E) cleanup** of priority enums and remaining branded strings. Phases A–C must run before HS data is ever exposed to anyone.
