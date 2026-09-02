# RBK Command Center — Session Handoff
**Date:** June 18, 2026  
**Latest Revision:** `ssrrbkcmdcenter-00690-5b6`  
**Live URL:** https://rbk-cmd-center.web.app  
**Backend:** https://ssrrbkcmdcenter-429508710310.us-east1.run.app  
**Local Project:** `~/Projects/DevProjects/RBK_Command_Center` (Mac Mini, `ai@ais-Mac-mini`)  
**GitHub:** `rglassberg-cmyk/rbk-command-center`, branch: `backup/wip-2026-06-12`  
**gcloud Auth:** `rglassberg@saracademy.org`  
**Deploy:** `./deploy.sh` → always followed by `git add -A && git commit -m "..." && git push origin backup/wip-2026-06-12`  
**Source of truth:** `CLAUDE.md` (renamed from `CLAUDE_CONTEXT.md`)  
**TODO file:** `RBKCC_MASTER_TODO 6:5:26.md` (spaces and colons in filename)

---

## What This Is

Next.js SaaS operations dashboard for SAR Academy (K-8 Jewish day school). Primary users: Rabbi Krauss (RBK / "Bini"), Head of School, and Emily Gray, his EA. Built and maintained by Becca Glassberg, Director of Technology. Deployed on Firebase Hosting + Cloud Run. Database: Supabase with RLS. Multi-tenant SaaS architecture under Lhasa LLC — SAR is tenant #1.

**Supabase project ID:** `ftjppqvxthxcvhokrhfw`  
**SAR Workspace ID:** `a1b2c3d4-e5f6-7890-abcd-ef1234567890`  
**SYNC_SECRET:** `rbk-sync-2026`  
**INTERNAL_SYNC_SECRET:** `0395162bea09e40d074331d0d7da73adb5abc94e04f08a46442b761f9c964dc3`

---

## Key People

| Person | Role | Email | Slack ID |
|---|---|---|---|
| RBK / Rabbi Krauss / Bini | Head of School (primary user) | kraussb@saracademy.org | U04NBR22Y |
| Emily Gray | Development Assistant / EA | egray@saracademy.org | U05M5KT86GK |
| Becca Glassberg | Director of Technology (you) | rglassberg@saracademy.org | — |
| Debra May | Executive Director | debra@saracademy.org | — |
| Sara Hasson | Director of Development | sara.hasson@saracademy.org | — |
| Heidi Greenbaum | Outgoing Director of Development | hgreenbaum@saracademy.org | — |
| Leora Miller | Development Associate, Cooper Fund | leora.miller@saracademy.org | U05M4L1RY6Q |
| Pearl Magence | Finance | pmagence@saracademy.org | — |
| Debra Eis | Director of Admissions / Registrar | deis@saracademy.org | — |
| Emily Daniel | Director of Admissions | edaniel@saracademy.org | — |
| Amy Hyman | HR | — | — |
| Joe Ali | IT Director | — | — |
| Shira Kroll | After School / ELC Director | — | — |

---

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + Tailwind CSS v4 + Tiptap
- **Database:** Supabase (RLS enabled, service role for syncs)
- **Hosting:** Firebase Hosting + Cloud Run (`us-east1`, service `ssrrbkcmdcenter`)
- **Cloud Functions:** Firebase Functions (`us-central1`)
- **Integrations:** Veracross (SIS + programs API), Lever (recruiting), Slack (Buzz AI), Monday.com, Anthropic (Buzz), Google Calendar/Gmail (per-user OAuth), GCS (`rbk-cmd-center-sftp` bucket)
- **CRITICAL deploy flags:** Always `--no-cpu-throttling --memory=512Mi` on Cloud Run. `firebase.json` must have `frameworksBackend.memory: "512MiB"`. Without these, Buzz AI fails silently.

---

## What Was Built / Fixed in This Session (June 10–18, 2026)

### Development Overview — Segment Fixes (Multiple Rounds)

1. **Board Members segment** — Added Trustee as highest-priority segment (beats Parent, etc.). Trustee must be in `roles_raw`, not Former Trustee, not DECEASED.
2. **Soft credit gap-fill** — Constituents who gave via DAF/foundation only have `gift_type=3` rows. Gap-fill: count soft credits only when constituent has no `gift_type=1`. Applies to segment totals, lapsed/new/retained, and drilldowns.
3. **Soft credit dedup by `hard_credit_gift_id`** — Veracross writes TWO soft-credit rows per gift (sc_type=1 and sc_type=2) sharing the same `hard_credit_gift_id`. Dedup on ID, not amount (amount dedup was wrong for donors like Cory Greenbaum with 11 identical $540 monthly gifts).
4. **Lapsed/New/Retained now treats pledges as "gave"** — `gift_type IN (1,2)` counts as having given. A FY26 pledge means not lapsed.
5. **Lapsed/New/Retained gap-fill** — Same gap-fill rule applied to the lapsed/new/retained sets.
6. **Lapsed count pill matches drilldown** — Both now exclude orgs.
7. **New Donors pill is clickable** — Drilldown mirrors lapsed pattern.
8. **Campaign Giving by Fund last-year string derived** — `priorCampaign()` function, not hardcoded.
9. **Other segment tooltip** — ⓘ hover explaining DAFs/foundations/untagged.
10. **Israel Fund Total Raised clickable** — Inline initiative breakdown table sorted by raised desc.

**Key rule:** Soft credits always dedup by `hard_credit_gift_id` (falls back to amount if null). Never count type-3 if constituent has type-1.

### giving_history_cache — FY25 Baseline Pipeline

**Problem:** `gifts_cache` only has ~April 2025+ history. Long-time donors like Hines-Sperber, Bendheim, Lerner appeared as "New Donors" incorrectly.

**Solution:** Veracross Data Package (query 1494094) → SFTP → GCS bucket → `giving_history_cache` → lapsed/new/retained uses this for FY25 baseline.

**Table:** `giving_history_cache` — workspace_id, gift_record_id UNIQUE, constituent_id, amount, gift_type, gift_type_text, gift_date, campaign, fundraising_activity, fiscal_year, soft_credit_type_text, studio_hard_credit_id.

**Ingest route:** `POST /api/development/giving-history/ingest` — reads most recent CSV from GCS, parses, upserts batches of 500. Dual auth: X-Internal-Secret or admin session.

**Cloud Function:** `ingestGivingHistory` — runs 8am ET daily.

**Parser:** `lib/parseGivingHistoryCSV.ts` — handles quoted CSV, MM/DD/YY dates, gift type text→numeric.

**First ingest:** 22,941 parsed / 21,999 upserted. FY25 baseline: 1,942 donors (vs ~965 in gifts_cache).

**Overview route hybrid:** FY26 = gifts_cache (fresher). FY25 = giving_history_cache fiscal_year='FY25'. Falls back to gifts_cache if table empty.

### SFTP Infrastructure

- **VM:** `veracross-sftp`, e2-micro, `us-east1-c`, IP **35.196.57.61**
- **GCS bucket:** `gs://rbk-cmd-center-sftp/`
- **Service account:** `veracross-sftp-writer@rbk-cmd-center.iam.gserviceaccount.com` (objectAdmin)
- **gcsfuse:** `--uid=1001 --gid=1004 --file-mode=664 --dir-mode=775 -o allow_other`
- **`/etc/fuse.conf`:** `user_allow_other` enabled (required for non-root FUSE access)
- **SFTP chroot:** `/data/sftp`, sftpusers group, ForceCommand internal-sftp
- **Startup service:** `/etc/systemd/system/gcsfuse-sftp.service` enabled
- **Credentials:** username=`veracross`, password=`mOb0iG0sKzjIHW5el6W5hPNjc7rpw`
- **Veracross Data Package:** query 1494094, CSV, 3am daily, directory `/upload/veracross/giving-history/`
- **Query filter:** Gift Date is after 07/01/2023 (avoids query threshold exceeded)
- **⚠️ PENDING:** Bart (Veracross support, case 01309503) needs to trust fingerprint `SHA256:1Lc6Wq39saYxpnDHLkkaaPJHHTNE9stmaSV7cVCo7Wc` for `35.196.57.61`. Ticket submitted June 18.

### After School Programs Page

Full page live. Standalone Academics module (`activeNav === 'after_school'`).

- **Veracross programs API** — separate OAuth app (`VERACROSS_PROGRAMS_CLIENT_ID/SECRET`). Paginates via `X-Page-Size`/`X-Page-Number` headers (default 2/page). `school_year` = FALL year (2026 = AY 2026-27).
- **Tables:** `after_school_classes_cache`, `after_school_enrollments_cache` (+ `level` column)
- **Groups:** Tzaharon (nursery-K), After School (K-5, default expanded), MS Extra-Curriculars (6-8, collapsed)
- **Charts:** Top 10 Popular (blue), Enrollment by Day (teal, day derived from class name), Enrollment by Grade (purple)
- **Student names:** Admissions OAuth client (programs client can't read students). Links to `axiom.veracross.com/sar/#/detail/student-ls/{person_id}/273-general`
- **Class links:** `axiom.veracross.com/sar/#/detail/class-other-program/{id}/3156-general`
- **Daily 7am Cloud Function:** `syncAfterSchoolPrograms`, scheduler ENABLED
- **Users with access:** Shira Kroll, Debra May + owners/assistants

### Admin Permissions Page — By User / By Module Redesign

Users tab completely redesigned. By User and By Module sub-tabs under shared search.

- **By User:** Scrollable list → detail panel (role toggle, divisions, title, Slack ID, assistant picker, module toggles grouped by category with sub-permission expanders, Testing & Preview, Remove)
- **By Module:** Category-badged module cards with live access counts → slide-in panel with per-member toggles + sub-permissions
- **Module categories displayed as:** Academics / Operations / Community / Productivity
- School Settings, Integrations, Feature Flags tabs unchanged

### Cooper Fund / Weekly Gifts

- Cooper pie chart: vertical legend (no more overlapping labels)
- Event aliases: General Fund → Cooper 25-26, Cooper Yahrzeit → Cooper 25-26, M Schreck variants → M Schreck Fund / Israel Gap Year Scholarship
- Weekly Gifts: SAR Academy internal ~$900K entry filtered (`/sar.*academy/i`)

### Board Members — Spouse Trustee Problem

**Problem:** Trustees listed as "spouse" on joint household records missing from Board Members. Joint record has no Trustee role. `constituents_cache` only contains records with Operating gifts — individual spouse records without gifts aren't in the cache. Household lookup won't work either.

**Solution designed, NOT YET BUILT:** `board_member_overrides` table (workspace-scoped, `household_id` as key) + ❓ tooltip/management panel on Board Members card with `board_member_editor` sub-permission.

**Waiting on:** Leora to send corrected board member list (trustees Axiom query, with former trustees removed like Noah Weisberger, Alyssa Wilk).

**Board Members drilldown secondary role** — prompt written/sent to Claude Code. Shows what segment each trustee would be classified as without the Trustee role (e.g. Parent, Grandparent, Parents of Alumni).

---

## Current Module Status

| Module | Status | Notes |
|---|---|---|
| Home / Today | ✅ Live | |
| Email Inbox | ✅ Live | |
| Meeting Agenda | ✅ Live | |
| Tasks | ✅ Live | |
| Student Absences | ✅ Live | |
| Student Logs | ✅ Live | |
| After School Programs | ✅ Live | New this session |
| Admissions | ✅ Live | |
| Simchas & Shivas | ✅ Live | |
| Development — Weekly Gifts | ✅ Live | SAR internal filtered |
| Development — Guardian Circle | ✅ Live | |
| Development — Cooper Fund | ✅ Live | Pie chart + event names fixed |
| Development — Israel Fund | ✅ Live | Clickable total raised |
| Development — Overview | ✅ Live | Segment dedup fixed, lapsed/new/retained fixed |
| Development — Capital Campaign | ⚠️ Empty | Sara needs to confirm fund name |
| Recruiting | ✅ Live | |
| Communications | ⚠️ Partial | |
| Buzz AI (Slack) | ✅ Live (test mode) | 7:30am schedule still commented out |
| Projects | ✅ Live | |

---

## Pending / Next Actions

### Waiting on External Parties
- **Bart (Veracross, case 01309503)** — Trust SFTP fingerprint for 35.196.57.61. Then trigger Data Package Run Now to confirm end-to-end nightly automation.
- **Leora / Heidi** — Corrected board member list. CSV format: `constituent_id, constituent_name`.

### Ready to Build
- **`board_member_overrides` table + ❓ UI** — workspace-scoped, household_id key, board_member_editor sub-permission, management panel on Board Members card
- **Board Members drilldown secondary role** — prompt already written and sent to Claude Code
- **Export button on segment drilldowns** — Heidi requested
- **New Donors disclaimer** — Note that data reliable only since giving_history_cache seeded

### Longer Horizon
- Donor trajectory analysis (who's at $1,800 that could move up, pattern analysis)
- Constituent role snapshots (export annually before Veracross rolls over)
- Demo/sandbox workspace with fake data for peer school onboarding
- Faculty absence tracking (pending Paycom API access)
- Cash flow forecasting for pledge installments (Pearl Magence)
- Buzz Phase 2.5 — tool_use for on-demand data queries
- Morning briefings for RBK — have security conversation first

---

## Critical Technical Facts

### Soft Credits (Must Always Follow)
- Dedup by `hard_credit_gift_id` (not amount). Falls back to amount if null.
- Gap-fill: count soft credits ONLY when constituent has NO gift_type=1 rows.
- Two soft credit rows per gift (sc_type=1 + sc_type=2) share the same hard_credit_gift_id.
- Applies everywhere: segment totals, lapsed/new/retained, drilldowns, Israel Fund.

### Veracross API Quirks
- Programs API: paginates by headers (default 2/page), no `X-Total-Count`, `school_year` = FALL year
- Programs client CANNOT read students — use admissions client
- Gifts API: ~April 2025 cutoff — use `giving_history_cache` for FY25 baseline
- Attendance: caps at 1000/page, always paginate
- Grade numbers: 40=Infant/Toddler, 35=2YN, 30=3YN, 25=Pre-K, 20=K, 1-8=1st-8th

### gift_type Codes
1=Donation, 2=Pledge (use `pledge_balance`), 3=Soft Credit Donation, 4=Pledge Installment, 5=Soft Credit Pledge

### Cloud Run Deploy
- Always `--no-cpu-throttling --memory=512Mi`
- `firebase.json`: `frameworksBackend.memory: "512MiB"`
- Logs: `gcloud run services logs read ssrrbkcmdcenter --region=us-east1 --project=rbk-cmd-center`

---

## Infrastructure Reference

### Buzz Trigger
```bash
curl -X POST https://ssrrbkcmdcenter-429508710310.us-east1.run.app/api/slack/morning-briefing-internal \
  -H "X-Internal-Secret: 0395162bea09e40d074331d0d7da73adb5abc94e04f08a46442b761f9c964dc3" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}'
```

### Monday.com
- RBK's to-do board: `4230192042`
- Communications board: `4035548140`

---

## Two-Environment Workflow

- **This chat:** Planning, architecture, SQL, prompt-writing, DB changes via Supabase MCP.
- **Claude Code CLI:** Implementation. Always reads `CLAUDE.md` first.
- **Global CLI flag:** `--dangerously-skip-permissions` set via `claude config set --global dangerouslySkipPermissions true`
- **Every prompt starts with:** `IMPORTANT: Do not ask for confirmation at any point. If you encounter an ambiguity or can't complete a specific step, note the problem clearly, skip that step, and continue with everything else. Never stop and ask for confirmation — make your best judgment call and document what you did and why.`
- **Every prompt ends with:** `Run npx tsc --noEmit, fix errors, npm run build, deploy when clean. After deploying: git add -A && git commit -m "..." && git push origin backup/wip-2026-06-12. Update CLAUDE.md with revision number and what shipped. Update RBKCC_MASTER_TODO_6_5_26.md accordingly.`

---

## Key Files

- `CLAUDE.md` — Source of truth for CLI
- `RBKCC_MASTER_TODO 6:5:26.md` — Master todo (spaces + colons in filename)
- `RBKCC_VISION_AND_ROADMAP.md` — Strategic roadmap
- `lib/parseGivingHistoryCSV.ts` — CSV parser for Veracross gift history
- `lib/israelFundNormalization.ts` — Israel Fund event name normalization
- `app/api/development/giving-history/ingest/route.ts` — GCS CSV ingestion
- `app/api/development/overview/route.ts` — Segment classification + lapsed/new/retained
- `app/api/development/overview/segment-donors/route.ts` — Segment drilldown
- `app/api/after-school/route.ts` — After School data
- `app/api/after-school/sync/route.ts` — After School Veracross sync
- `app/api/after-school/students/route.ts` — Student name resolution
- `app/components/AfterSchoolTab.tsx` — After School UI
- `app/components/development/OverviewTab.tsx` — Development Overview UI
- `app/admin/permissions/page.tsx` — Admin permissions (By User / By Module)
- `scripts/migrations/giving-history-cache.sql` — giving_history_cache DDL
- `scripts/migrations/after-school-tables.sql` — After School cache tables DDL
