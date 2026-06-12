# RBK Command Center — Vision & Roadmap

*Last updated: June 5, 2026*

This is the north-star planning doc — what we're building, why, what exists today, what's next. For day-to-day pending work, see `RBKCC_MASTER_TODO.md`. For implementation detail, see `CLAUDE_CONTEXT.md`.

---

## What We're Building & Why

RBK Command Center is a custom operations dashboard for a school principal (Rabbi Krauss / RBK) and his assistant (Emily Gray). It replaces a patchwork of Gmail, Monday.com, spreadsheets, and manual processes with one place to see and act on everything.

**Original core problems:**
- RBK's inbox is unmanageable — too many emails, no clear triage.
- Emily spends hours manually tracking faculty absences, chasing Paycom entries, building spreadsheets.
- No unified view of the day: email, calendar, tasks, student absences, community events are all separate.
- Drafts written by Emily in Gmail are invisible to RBK in a structured way.
- RBK has no quick way to see who's absent, who needs a follow-up, or what's on the agenda.

**Where it's gone since March 2026**: the app expanded beyond RBK's daily inbox into a multi-tenant operations platform with a full Development module (Guardian Circle, Weekly Gifts, Cooper Fund, Israel Fund, Overview, Campaign Giving, Capital Campaign), Admissions enrollment projection, Recruiting, Attendance YTD analytics, Communications approvals, plus a SaaS architecture (workspaces, multi-user, per-user OAuth, integrations table) that supports adding new schools without code forks.

**Vision**: A single dashboard that makes RBK's day frictionless and gives the SAR senior team a shared operational picture. He opens it, sees what needs his attention, acts on it, and closes it. Other staff (Emily, Debra May, Debra Eis, Heidi, Leora, Sara, Randy) use it for their own functional workflows. The platform is general enough that other principals at peer institutions could spin up their own instance.

---

## Platform Architecture Philosophy

The Command Center is not a system of record. It's the dashboard on top of the systems of record. Three layers, each with a distinct role:

**Monday.com — the operational layer.** Where requests are made, workflows run, details live, and automations route work to the right people. Whole School Events, Communications requests, Budget/Events boards, Projects — all of those workflows stay on Monday. The Command Center reads from Monday; it does not replace it.

**Command Center — the surfaces layer.** Rollup dashboards that show each person what's important right now, aggregated from Monday, Veracross, Google Calendar, tasks, and the other systems of record. The job is "you don't have to log into five tools to know what needs your attention" — not "rebuild those five tools."

**Slack — the delivery layer.** The Slack AI Assistant (see Horizon) brings the Command Center to each person proactively instead of requiring them to open the app. A morning briefing per user, conversational follow-ups, proactive nudges on stale items.

Concrete implications of this model:

- **Whole School Events stays on Monday** (routing to Nick / Communications / Randy). Command Center shows the rollup view of what's in flight, not the request-intake form.
- **Communications workflow stays on Monday.** Command Center shows Randy's pending requests and Yael's queue status; the request creation and approval routing live on Monday.
- **Budget / Events boards stay on Monday.** Command Center shows summary dashboards.
- **Projects page in Command Center**: retire the existing Supabase kanban (never fully built, predates this architecture) and replace it with a Monday Projects rollup view — read from the Monday API, show each user the items relevant to them. See the "Operations & Projects" entry below for the current state and the Near-Term plan for the rebuild.

This unlocks the multi-stakeholder picture: each person sees a personalized rollup that respects the systems they already work in. We don't try to migrate workflows away from tools their teams already use.

---

## Users

| Person | Role | Primary Use |
|---|---|---|
| Rabbi Krauss (RBK) | Principal (owner) | Inbox, calendar, tasks, Development overview, Simchas/Shivas, Communications approvals |
| Emily Gray | Executive Assistant (assistant) | Triage emails, write drafts, Tasks queue, Israel Fund grant tracker, Simchas note flow |
| Becca Glassberg | Director of Technology / Builder (owner) | Build, deploy, iterate; admin permissions; cross-division visibility (Academy + HS) |
| Debra May | Executive Director (viewer + multi-division) | Recruiting, Admissions, future Transportation / After-school / Scholarship views |
| Debra Eis | Admissions Director (viewer) | Admissions overview, enrollment projection drilldowns |
| Heidi Greenbaum | Outgoing Director of Development | Development pages — guidance role only, transitioning out |
| Sara Hasson | Development (viewer) | Campaign Giving, Capital Campaign data |
| Leora Miller | Development (viewer) | Cooper Fund, gift entry workflow |
| Emily Daniel | Admissions staff (viewer) | Admissions drilldowns |
| Amy Hyman | HR (viewer) | Faculty Attendance (pending Paycom API) |
| Randy | Media Director | Rise Vision screens, flyer/graphics requests, photography/video, social media. Needs to know what's been requested from him and what events need media coverage. |
| (Future) HS Principal | High School Principal (owner) | HS-scoped Absences, Admissions, Recruiting |

Division model: `academy` = ELC + Lower + Middle (one building); `hs` = High School (separate building, same institution). Multi-division users (Becca, Debra May) get an Academy/HS/All toggle on relevant pages.

---

## What We've Built (Current State — June 2026)

### Daily operations
- **All Emails** — Gmail triage with categories (Action Required, Emily's Queue, Important, Review, FYI, Travel, Shivas, B'nai Mitzvah, Untagged), draft workflow (Emily writes → marks ready → RBK reviews → sends), TBD holding area with Emily-suggestion flow, mark-as-read on open, Trash/Done labels.
- **Today Agenda** — Meeting agenda with notes, tags, drag-and-drop reorder, standalone action notes.
- **Tasks** — Email-derived, agenda-derived, Simchas-derived, and standalone tasks. Source-aware routing (From Admissions / From Development / Shiva email). Two-column view for principal/assistant pairs; one-column for solo users. Due dates, urgency, side panel.
- **Compose** — New-email composer with per-user signature from `workspace_members.email_identity_html`, sends via per-user Gmail OAuth.
- **Today's Schedule** — Calendar widget (per-user Google Calendar; primary calendar). Zoom/Meet/Teams link detection, all-day handling, IANA timezone.
- **This Week at SAR** — Embedded iframe of `thisweek-sar.netlify.app` with sticky persistence.
- **Daily Announcements** — Embedded Google Doc tab on /home.

### Community / outreach
- **Simchas & Shivas** — Weekly view from Hamakum + B'nai Mitzvah feeds. Bar/Bat Mitzvah keyword filter, shiva end-date parsing, "Add to Calendar" + RSVP Yes/No/Not Attending + Send Note flow.
- **Communications** — Monday.com approvals queue (board 4035548140), social media tiles driven by `workspaces.brand`, social embeds planned.
- **Gemara** — Class resource link board for RBK.

### Academics
- **Student Absences** — Live Veracross `master_attendance` for today (Academy-only at the API layer, HS dropped regardless of caller divisions). Grade-card layout grouped by ELC / Lower / Middle, click card → roster panel of absent + tardy students. Needs Follow-Up alert for 3+ consecutive absences or 15+ YTD. Attendance Distribution YTD section: Attendance Tiers by Grade (Chronically Absent / At Risk / Satisfactory) and Quarterly Absence/Tardy Trend.
- **Admissions & Enrollment** — Overview tab (stat pills, search, drilldowns with @mentions), Enrollment Projection By Grade (Registered / Incomplete / Pisgah / Pending / Waitlist / Leaving / 25-26 / Budgeted), ELC/Lower/Middle school-level cards, manual grade override system, household financial link, city/region geography toggle, multi-division support.
- **Recruiting** — Lever API integration, open roles, recent applications grouped by team, division filter (Academy / HS / All), Lever notes pass-through, candidate posting details.

### Operations & Projects
- **Projects** *(legacy — slated for retirement, see Near-Term)* — Internal Supabase kanban with 11 departments, drag-and-drop, Tiptap rich text, archive flow. Never fully built out; predates the Monday-as-system-of-record architecture. Will be replaced by a Monday Projects rollup view.
- **Emily's Queue** — Action-required emails + tasks scoped to Emily's assignee key.
- **Important Docs** — Pinned doc list, CRUD.

### Development module (heavy lift since March)
- **Overview** *(default landing tab)* — Headline cards (Total Raised FY26, Total Donors, Lapsed Donors with red progress bar toward 0, New Donors). Segment cards by role (Parent / Grandparent / Parents of Alumni / Alumni / Faculty / Other). Campaign Giving by Fund YoY table. Lapsed Donors collapsible list (top 100 by last-gift amount). Gated behind `development_overview` testing flag.
- **Weekly Gifts** — Last 7 days / 14 days / 30 days / Today filter, gift table with sorting, donor side panel, multi-year giving history, Quick Thank You Email generator (Claude-powered), donor notes + tags (5 predefined tag types).
- **Campaign Giving by Fund** — Per-fund cards grouped by fundraising activity, fiscal year scoping, click-through to Guardian Circle.
- **Guardian Circle** — Constituent table (donor name, totals, BBF / Capital, frequency, thank you, status), role pill + grade chips + 🚩 aging-out flag on each row, clickable donor name → sidebar drawer (role, BBF total, child grades, aging-out warning, FY26 giving grid, DonorAnnotations). Flagged-gifts data-quality callout at the top for known Veracross API gaps (~$28K).
- **Cooper Fund** — Three stat cards (Current Balance, FY26 Donated, Total Disbursed), Raised vs Disbursed grouped bar chart with Cooper 25-26 split into a General Fund summary card, Disbursements pie chart (Column H categories), 4-column table (Category / Raised / Disbursed / Remaining). Column G live data from Cooper Reconciliation Google Sheet, event-name consolidation map (M Schreck variants merge, Cooper Yahrzeit + General → Cooper 25-26).
- **Israel Fund** — Three headline cards (Total Raised, Total Disbursed, Balance at SAR). Per-initiative summary table joined live from `israel_fund_grants` Supabase table + Veracross gifts. Grant CRUD UI (Add / Edit / Hide / Delete) gated by `israel_fund_editor` sub-permission. Recharts horizontal bar chart (top 12 Raised vs. Disbursed). Money In accordion. Initial seed of 346 grants imported from Emily's "Master EG" CSV.
- **Capital Campaign** — Empty-state placeholder ("Big Bold Future" fund) until Sara provides the Veracross query. Full page TBD.

### Multi-tenant / SaaS infrastructure
- **Workspaces + workspace_members** — Per-tenant row-level isolation. RLS on all data tables. Per-user role (owner / assistant / viewer), divisions, allowed_modules JSONB, assistant_to FK pointer.
- **Per-user Google OAuth tokens** — `user_google_tokens` table; Calendar + Compose + Drafts use per-user tokens (no workspace-level fallback for Calendar).
- **Per-workspace integrations** — `workspace_integrations` table for Veracross / Slack / Lever / Anthropic credentials with env-var fallbacks; Admin → Integrations UI.
- **Workspace branding** — `workspaces.brand` jsonb (Instagram, LinkedIn, X, school IG handle) drives social tiles.
- **Module system** — `workspaces.modules` boolean record + `workspace_members.allowed_modules` for per-user gating; legacy `true` and nested `{ enabled, sub_permission }` shapes both supported.
- **Sub-permissions** — Per-module fine-grained toggles: `admissions.edit_enrollment_budget`, `admissions.edit_enrollment_data`, `lever.offer_approvals`, `development.cooper_fund`, `development.israel_fund`, `development.israel_fund_editor` (first actual enforcement site, June 3). `home.daily_announcements`, `home.todays_schedule`, `home.todays_tasks`.
- **Testing & Preview / Feature Flags** — `workspace_members.testing_features text[]` (per-user previews) + `workspaces.promoted_features text[]` (workspace-wide promotion). `canSeeTestingFeature()` helper unions both. Admin UI: 🧪 section in Users tab + Feature Flags tab with one-click Promote to Live / roll back. Standing rule: every new in-development feature gets a `TESTING_FEATURES` entry first, gate the UI with the helper, no more "beta banner" buttons.
- **Impersonation** — Becca-only admin tool. Real Firebase user unchanged; `x-impersonated-email` / `x-impersonated-workspace-id` headers swap context per request. All Veracross routes go through `apiFetch` to honor the headers.
- **Multi-workspace switching** — Workspace switcher in sidebar; per-workspace owner-scoped Gmail refresh token.
- **Nightly sync infrastructure** — `gifts_cache` (hourly weekdays / daily weekends), `constituents_cache` (chained after gifts), `attendance_cache` (cron-managed). Backfill route with paginated client-side date filter.
- **Constituents sync** — `constituents_cache` table (workspace_id, constituent_id, role, grades, household_id, roles_raw). `lib/syncConstituents.ts` pulls `/v3/development/constituents` and `/v3/students`, joins by household, runs `parseRoleFromTags()` (Parent / Grandparent / Parents of Alumni / Alumni / Faculty / Other priority order). 9,650 constituents synced; 4,213 with a specific role; 911 with grade data; 89 flagged aging-out.

### Admin & permissions
- **Admin tabs**: Users (member table + sub-permissions + 🧪 Testing & Preview), School Settings, Integrations (7 cards), Feature Flags.
- **Module gating**: per-workspace + per-user. Owners/assistants implicitly get all modules (allowed_modules = null).

### Mobile & PWA
- Manifest + icons + theme color, installable.
- Sidebar drawer with X close + backdrop on `<md`.
- Responsive grids on stat cards + Israel Fund tables + Admissions drilldowns.
- iOS Safari login crash fixed (DonorAnnotations is `next/dynamic` with SSR off).
- Per-page tables still need a mobile column-overflow pass — Guardian Circle and Development table cut off on iPhone.

---

## Active Work (In Progress)

- **Israel Fund seed verification** — 346 grants imported; Emily to confirm the page totals against her spreadsheet ground truth.
- **`/v3/development/gifts` historical gap** — 19 months of data missing from Veracross API (~$703K Israel Fund gap, $28K flagged Guardian Circle gifts). Ticket submitted 2026-06-03; awaiting Veracross response.
- **Cooper Fund data accuracy follow-ups** — $38K gap vs. Leora's ground truth; event consolidation tweaks (Cooper Yahrzeit, General/Undesignated, Education Sayeret Matkal).
- **Pie chart label polish on Cooper Fund** — prompt written, deploy pending.

---

## Near-Term (Next 2-4 Weeks, Unblocked)

### Development
- **Cooper Fund event-name fixes** — merge "Israel Gap Year Scholarships" + "M Schreck B Ball Tournament" → "M Schreck Fund / Israel Gap Year Scholarship". Move General/Undesignated and Cooper Yahrzeit into Cooper 25-26. Drop Education Sayeret Matkal Soldier. Investigate Cooper Purim 25 raised vs disbursed FY mismatch.
- **Drop `total_paid_out` / `paidOut` aliases** from `/api/development/israel-fund` response (UI no longer reads them).
- **Cooper Fund + Israel Fund "Today" filter pill** — first-pill pattern from Weekly Gifts.
- **Cooper Fund + Israel Fund clickable event rows** — expand a money-in row to show individual gifts with DonorAnnotations.
- **Cooper Fund YoY category tracking** — compare current FY Column H disbursements vs prior year snapshot.
- **Capital Campaign tab buildout** — Big Bold Future fund. Sara sending queries; overview buckets (designated vs undesignated), YoY, by constituent.
- **YoY across all development metrics** — total raised, donors by segment, lapsed count. Sara has 5+ years of data; can hardcode prior year while we build the snapshot system.
- **Lapsed Donors gating** — decide whether to hide until Shavuot per Becca's note.
- **Mobile column overflow** — Development + Guardian Circle constituent tables: Name + Event/Fund visible on mobile, rest `hidden md:table-cell`; row tap opens side panel. Same pattern for Recruiting and Emily's Queue.

### Tasks & Notifications
- **Tasks Due-Date Slack reminder** — Cloud Function scheduled 8am ET, query `tasks WHERE due_date = today AND status != 'done'`, DM each assignee's Slack ID.
- **Simchas Send Note overhaul** — modal/inline form first with optional note text → task body in Emily's queue with Hamakum-parsed family info + RBK's note → Slack DM Emily.

### Emails & Thank You workflow
- **All Emails "Action Items" / "To Send" section** at the top — Day of Learning thank yous (AI-drafted), Guardian Circle thank yous (surface envelope-icon drafts), Condolence notes from Simchas flow.
- **Day of Learning thank you automation** — gifts come in as fund `OP: Sponsorships`, event `Day of Learning 25-26`. Leora sets profile codes `day_of_learning_month` / `day_of_learning_day` for recurring annual sponsors.
- **Thank-you auto-BCC** — any thank you from the app auto-BCC's the Veracross tracking address (blocker: exact BCC from Emily/Sara).

### Calendar
- Zoom/Meet detection already shipped — verify deployed.
- RSVP / Register link on calendar event cards (if event has registration URL).
- Confirm calendar event grade tags working for all recurring events.

### Permissions / Settings
- Grant Debra May the Development module + guardian-circle access.
- Confirm correct Veracross query ID for "Yesterday's Absences" link from Emily.

### Recruiting
- **Lever webhook activation** — manual step in Lever Settings → Webhooks. Once active, Slack DMs to RBK for new non-HS applications.

### Media (Randy's page) *(new)*
- **Media rollup page for Randy** — Randy's personalized dashboard. Reads from the Monday Communications board filtered to media requests (flyer / graphics / video / screens checked). Shows: pending requests, in-progress items, what's due this week. Includes a Rise Vision queue section (once RBK provides screen URLs). Surfaces an active-media-projects rollup from Monday Projects so Randy can see his in-flight work. **Does not rebuild Monday** — it surfaces what Randy needs to act on today.
- **Add Randy as `workspace_member`** with the new Media module enabled. Set `slack_user_id` when collected (see Slack AI Assistant prerequisites in Horizon).
- **Confirm Monday board column / status mapping** with Randy before building the filter logic — what exactly identifies a "media request" on the Communications board, and how Randy currently triages.

### Projects (rebuild) *(new)*
- **Retire the internal Supabase Projects kanban** and rebuild as a Monday Projects rollup view. The kanban was never fully adopted; the Monday boards are where actual project work happens. Replacement: a read view of Monday board items relevant to the current user, grouped by project/board. Each person sees their active items. No Supabase storage for this view — reads from the Monday API on load. Per the Platform Architecture Philosophy section.

### Slack AI Assistant — Phase 1 (Morning Briefing)
- **Phase 1 is concrete and unblocked** (see the full phased plan in Horizon → Slack AI Assistant). Cloud Function at 7:30am ET on school days; per-user briefing DM synthesized by Claude using Google Calendar (per-user OAuth), Tasks (due today / overdue), and module-specific Supabase data.
- **Prerequisites already in hand**: per-user Google Calendar OAuth (built), Claude API integration (live), `slack_user_id` set for RBK (`U04NBR22Y`) and Emily (`U05M5KT86GK`), Slack bot token via `workspace_integrations`.
- **Outstanding prerequisite**: collect `slack_user_id` for the remaining active users (Becca, Debra May, Debra Eis, Heidi, Sara, Leora, Amy, Randy, future HS Principal). One-off Slack admin lookup.

---

## Planned (Committed, Blocked or Waiting)

### Debra May items (need info from Debra)
- **Transportation page** — bus route → stop mapping. Shows: student name, grade, stop, cost, outstanding balance. P&L per route. Both Academy + HS students.
- **Scholarship button** — ParentLocker URL format. Button visible to all (for privacy); only works for authorized users.
- **After-school programs page** — Veracross endpoint. Enrollment per program + grade, drilldown like admissions.

### Blocked on Joe Ali
- **Facilities/IT ticket tracker** — Joe getting shared access to ticketing system. Surface (link or iframe) — don't rebuild.

### Veracross blockers
- **`/v3/development/gifts` historical gap** — ticket submitted 2026-06-03. Israel Fund ~$703K + Guardian Circle $28K. Either Veracross fixes the endpoint or we find an alternative endpoint that exposes pre-2025 gifts.
- **Day of Learning dedication-text field name** — Leora to confirm which Veracross field holds the dedication.
- **`grade_applying_for` for re-enrolling students** — Veracross case follow-up; second follow-up needed for `student_group_applying_for` + boarding notes workaround fields.
- **Application Pipeline tab** — prospects (inquiry) vs applicants (full application). Blocked on Veracross API field investigation.

### External dependencies
- **Paycom API for Faculty Absences** — Amy's rep contacted; awaiting credentials. Short-term option: read Amy's Google Sheet (already populated by a GAS scraping Paycom Slack messages).
- **Day of Learning BCC email** for Veracross gift tracking (Emily/Sara).
- **Cooper Fund Slack channel ID** (Emily) — needed for `@CooperFundChannel` mention flow.
- **HS principal onboarding** — needs HS principal email, name, title from Becca.
- **Rise Vision / Digital Signage** — screen URLs from RBK for 5–6 campus displays.

### Stakeholder meetings pending
- **Yael + Ilana** (Communications team) — Emily to push to schedule.
- **Sara Hasson** — Big Bold Future query structure for Capital Campaign + Guardian Circle BBF column refinement.
- **Sara Hasson** — Veracross Campaign naming cleanup (RBK wants fewer top-level campaigns with subcategories).

---

## Horizon (Big Ideas, Not Yet Scoped)

### Email pipeline
- **Firebase + Gmail API pivot** — move triage off Google Apps Script entirely. Currently GAS calls OpenAI to categorize/summarize and posts to the webhook. Migrating to Cloud Functions unblocks debugging from Becca's env (no more Emily-in-the-loop screen-share sessions) and supports multi-tenancy. Migration plan: stand up test Firebase under Becca's Gmail → replicate triage as Cloud Function → replace Drafts Ready sync first → deprecate GAS.
- **Compose new email from Command Center** (not just replies) — already drafted partially via the Compose modal; needs full thread support.
- **Email thread display fix** for forwarded emails — body extraction issue (Sarah Jabbour example).
- **Travel section** in inbox + travel-sender additions to triage prompt.
- **Emily Action queue redefinition** — current triage prompt doesn't correctly identify what Emily actually handles.
- **Label-to-Task pipeline** — when Emily applies "RBK Action" label to a Gmail message, auto-create a task. Replace the email section on the dashboard entirely; RBK reads in Gmail, task tells him to look.
- **Email threads linked to projects** — tag email threads with a project label; all related emails surface under that project.
- **Hide Emily's Queue** — RBK doesn't use it; repurpose or remove.

### Platform-level features
- **Platform-level notifications** — browser/mobile push for urgent items, new drafts, due-today tasks. Firebase Cloud Messaging pairs naturally with the email pipeline pivot.
- **Platform-level tasks aggregation** — cross-module Tasks view that pulls from Inbox, Agenda, Simchas, Development, Admissions, Recruiting in one place.
- **Three-tier permissions** — current model is workspace-level + module-level + sub-permission. Three-tier would add a data-row-level layer for things like "Sara can see Capital Campaign giving for the Levine household but not the Schreck household." Not currently scoped; deferred until concrete need.
- **Data-level division scoping** — beyond grade filtering, scope gifts / projects / contacts by division (Academy vs HS). Currently division filters only apply to enrollment data.
- **Home-screen permission-scoped widgets** — each user's home page shows widgets matching their allowed_modules. Currently Home is mostly static (announcements, schedule, tasks, week-at-SAR).

### Slack AI Assistant (Per-User Morning Briefing)

**The highest-leverage feature on the roadmap.** Each staff member gets a personalized Slack DM every morning with what they need to know and act on today. No one has to open the Command Center to get value from it. The dashboards (the surfaces layer) become a place you go for detail; the briefing (the delivery layer) is what reaches you proactively.

**Phase 1 — Morning Briefing (read-only).** A Cloud Function runs at 7:30am ET on school days. For each `workspace_member` with a `slack_user_id` set, it builds a personalized briefing using:
- Google Calendar events today (per-user OAuth)
- Command Center tasks due today / overdue
- Module-specific data from Supabase (gifts pending thank-yous, absences above threshold, requests in queue, etc.)

Claude synthesizes everything into a concise, friendly, actionable Slack DM.

*Per-user briefing content:*
- **RBK** — calendar, urgent tasks, donor thank-yous due, absence alerts
- **Emily** — tasks queue, drafts waiting for RBK
- **Randy** — pending media requests, events needing coverage this week
- **Yael / Alana** — comms requests in queue, upcoming send dates
- **Amy** — today's absence log, Paycom pending
- **Debra May** — admissions/enrollment changes, recruiting updates
- **Becca** — system health, anything flagged

**Phase 2 — Conversational (read/write).** User can reply to the bot. Bot can add tasks, mark items done, check calendar, look up data. Uses conversation history per user. Claude decides what action to take from the user's message.

**Phase 3 — Proactive follow-up.** Bot notices stale items (request sitting 48 hours, overdue task, donor not thanked) and follows up without being asked. Uses the same data the morning briefing draws from, but watches for inactivity.

**Phase 1 dependencies (all in hand except the Slack ID collection)**:
- `slack_user_id` set for each member (currently have RBK: `U04NBR22Y`, Emily: `U05M5KT86GK` — see Near-Term for the collection task)
- Per-user Google Calendar OAuth — already built (`getValidGoogleToken`)
- Claude API — already integrated (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` per workspace)
- Slack bot token — stored in `workspace_integrations.slack.credentials.botToken`

Phase 1 ships unblocked. Phase 2 and Phase 3 are sequenced on top of it — same Cloud Function infra, expanded scope.

### Development advanced features (from Heidi)
- **End-of-year snapshot** — capture all Development metrics on Aug 31 annually; powers historical YoY without needing the raw 5-year-deep gift table.
- **Constituent relationship view** — "runtime left" per donor (years until youngest child graduates). Drives outreach prioritization.
- **Segment giving rates for marketing** — "X% of alumni give", etc.
- **Cross-reference Guardian Circle with Capital giving** — who hasn't been asked for BBF?
- **YoY segment comparison via role snapshots** — current segment-level YoY is disabled because Veracross roles shift annually. Fix would store an annual role snapshot so historical bucket assignments stay stable.
- **Per-constituent year-over-year giving trend** in Guardian Circle sidebar (placeholder exists: "Full history coming soon").
- **"Days out from event" tracking** for dinner/Shavuot (Sarah Jabbour has a spreadsheet).
- **Sweet spot analysis** — donor segments with high giving rate × high yield × low outreach. Future analytical layer.

### Other platform expansion
- **High school dashboard expansion** — propose meeting with RBK + HS principal once onboarded. Goal: HS principal has their own scoped view (HS Absences, HS Admissions, HS Recruiting).
- **Rise Vision / Digital Signage** — display URLs for 5–6 campus screens; real-time status dashboard.
- **Multi-school SaaS** — peer institution onboarding. Workspaces table already supports this; need a sign-up flow + per-workspace Gmail/Calendar OAuth.
- **iOS / native mobile app** — after web stabilizes. PWA already installable.
- **Analytics layer** — email volume trends, response times, busiest days for RBK.
- **KyberAccess / KyberGate** — Becca's interest in security-tier integrations; deferred.
- **Ramp (replacing Procurify)** — purchase approvals workflow if SAR moves payment rails.

### Operational ideas
- **Shabbos print queue** — RBK drops article links during the week; Emily prints them Friday afternoon.
- **App name decision** — Debra May and Becca both dislike "Command Center". Becca suggested "Beacon" (but Veracross uses that). Ask RBK.
- **Rename "Community" sidebar group → "Academics"** (current placement; Simchas would move elsewhere).
- **Student Logs page** — link to Veracross Axiom query #1473847 (weekly behavior log summary) under Academics.

### Future Israel/Cooper enhancements
- **Israel Fund historical backfill from CSV** — Emily exports 2023–2024 gifts from Veracross UI; we import via a script. Workaround until Veracross fixes the API.
- **Cooper Fund / Israel Fund source-spreadsheet link** in the UI, permissions-gated (Heidi's suggestion).

---

## Open Questions

- **App name** — what does RBK actually want it called?
- **Sub-permissions for owners with `allowed_modules = null`** — Emily and Becca have `null` (full-access shortcut). The new `israel_fund_editor` sub-permission falls back to email check for them. Long-term: do we replace the null shortcut with explicit per-module objects so sub-permissions are uniform?
- **Lapsed Donors visibility** — show year-round, or hide until Shavuot per Becca's earlier note?
- **Heidi transition** — Heidi is leaving. Israel Fund data flow is now live, so the pipeline doesn't depend on her. But what about Big Bold Future / Capital Campaign cross-references that were on her side? Confirm who owns those queries post-transition.
- **HS principal onboarding timing** — when does the HS principal start using the app? Earlier triggers the division-isolation work.
- **Feature Flags rollout cadence** — Development Overview is on `development_overview` testing flag and granted to Becca only. When do we promote workspace-wide? Same question for any other features we mark as testing-only by default.
- **Data accuracy ownership** — Cooper Fund still has a $38K gap vs Leora's ground truth. Israel Fund will have a balance discrepancy until the Veracross historical gap is resolved. Who validates each FY26 close?
- **Mobile vs desktop priority** — RBK uses desktop primarily. Emily uses both. Do we keep iterating mobile responsiveness or focus on desktop polish given actual usage?
- **Cooper vs Israel Fund gift_type interpretation** — Cooper treats gift_type 3/5 as soft credits (excludes them). Israel treats 3 as a real pledge payment + 5 as a soft credit (includes both). Reconcile when the deviation is verified against Leora + Emily's ground truth.

---

## SaaS Architecture Phases (Complete History)

For implementation detail see `SAAS_ARCHITECTURE.md` and `RBKCC_HANDOFF_2026-05-23.md`. Summary of the multi-tenant refactor that happened April–May 2026:

- **Phase A — Schema Foundations** (rev 00456) — `workspace_members` gained `assistant_to`, `assignee_key`, `slack_user_id`, `divisions text[]`, `title`, `email_identity_html`. Renamed `ls` → `academy`. Lookup helpers in `lib/assignees.ts`, `lib/getWorkspaceMemberByAssignee.ts`, `lib/divisions.ts`. Slack lookups moved from hardcoded constants to DB. Backfilled all 9 members.
- **Phase B — Tasks Generalized** (rev 00463-00465) — Tasks page bidirectional (principal/assistant pairs). Fixed `assistant_to` pointer direction. Session gained `currentMember`, `assistant`, `principal`. Assistant picker in Admin → Users.
- **Phase C — Email/Calendar De-RBK-ified** (rev 00467) — Email from address + signature from `workspace_members.email_identity_html`. `session.accessToken` retired across 8 Gmail routes (all use `getValidGoogleToken()` now). `rbkCalendarId` hardcode removed; uses `primary`. Per-workspace owner Gmail callback.
- **Phase D — HS Division Filter** (rev 00469-00471) — Dynamic `getGradeFilterForMember(divisions)`. `HS_GRADING_PERIODS = [24, 29]` corrected. Impersonation-aware `getEffectiveDivisions(session)`. Division toggle on multi-division UI.
- **Phase E — Cleanup** (rev 00475) — Renamed `rbk_action` → `owner_action`, `eg_action` → `assistant_action` across DB (2,623 rows), Cloud Function, and client code. `workspaces.brand jsonb` added; SAR backfilled. Zero remaining `kraussb` / `binikrauss` hardcodes in `app/` or `lib/`.
- **Phase F — SaaS Self-Service API Keys** (rev 00481) — `workspace_integrations` table with RLS. `lib/getIntegration.ts` with 5-min cache and env-var fallback. Helper functions per integration type. Admin → Integrations tab with 7 cards. "Seed from environment" migrate endpoint.
- **Phase G (planned)** — Rise Vision; cloud-function workspace-awareness; credential encryption (`pgsodium` / KMS).

Plus the Sprint 4-5 layer that came after the formal phases:
- **Sprint 4** — Guardian Circle BBF column + role pill + grade chips + aging-out flag + donor sidebar drawer.
- **Sprint 5** — Development Overview landing tab + Testing/Preview + Feature Flags admin.

---

## Related Docs

- `CLAUDE_CONTEXT.md` — implementation-level source of truth; updated every deploy. Read first when working in the codebase.
- `RBKCC_MASTER_TODO.md` — active working TODO list. Updated every session.
- `SAAS_ARCHITECTURE.md` — multi-tenant table model + module registry + auth flow + Gmail pipeline migration plan.
- `RBKCC_HANDOFF_2026-05-23.md` — *archived*. Snapshot of the SaaS Phase A–F refactor.
- `RBKCC_TODO_2026-05-15.md` — *archived*. Pre-master-TODO list, superseded.
- `RBKCC_Phase3_Build_Plan.md` / `Phase4` / `Phase5` — reference-only build plans. Don't add to these; capture in the master TODO instead.
