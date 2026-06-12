# Command Center — SaaS Architecture Reference

**This file is the source of truth for multi-tenancy, the module system, and the Gmail pipeline migration.**
Read this alongside CLAUDE_CONTEXT.md at the start of any session touching auth, workspaces, email pipeline, or modules.

**Last updated:** April 14, 2026

---

## Core Principle

The app is a multi-tenant SaaS. Every feature is scoped to a workspace. Nothing is hardcoded for RBK. The word "principal" is gone — the universal term is **owner**.

---

## Tenant Model

- **Single Supabase project** with `workspace_id` on every table + Row Level Security (RLS)
- One workspace = one command center instance (one owner + their assistants/viewers + their data)
- Users sign in with their own Google account via Firebase Auth
- A `workspace_members` row links each user to a workspace with a role

### Roles
| Role | Access |
|------|--------|
| `owner` | The executive whose Gmail/calendar is being managed. Full access to all workspace modules. |
| `assistant` | Full access to owner's workspace data (e.g. Emily). Same visibility as owner. |
| `viewer` | Scoped read-only access to specific modules only. Cannot see email, tasks, agenda, or projects. Auto-redirects to first allowed module on sign-in. Sidebar hides Daily + Operations sections. No workspace switcher. |

**Key behavior:** Emily signs in with her own Google account. Her `workspace_members` row gives her access to RBK's workspace data in Supabase. She does NOT need RBK's Gmail credentials — she sees his data, not his inbox directly.

---

## Tables (Live in Production)

All tables created and live. See `PHASE2_MIGRATION.sql` for original migration and `PHASE6_RLS.sql` for RLS policies. Both run in Supabase SQL Editor on April 5, 2026.

### `workspaces`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Workspace identifier |
| `name` | text | Display name (e.g. "SAR Academy — RBK") |
| `owner_email` | text | Owner's email for Gmail pipeline |
| `gmail_refresh_token` | text | Owner's Gmail OAuth refresh token (encrypted) |
| `modules` | jsonb | Feature flags: `{ "absences": true, "admissions": true, ... }` |
| `module_config` | jsonb | Per-module settings (see Module System below) |
| `created_at` | timestamptz | Auto-set |

### `workspace_members`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Row identifier |
| `workspace_id` | uuid FK | References workspaces(id) |
| `user_id` | text | Firebase UID (PLACEHOLDER values auto-replaced on first sign-in) |
| `email` | text | User's email |
| `role` | text | `'owner'` \| `'assistant'` \| `'viewer'` |
| `display_name` | text | Display name in the app |
| `allowed_modules` | jsonb DEFAULT NULL | NULL = no restriction (owner/assistant sees all). Set = viewer sees only these modules. Implemented via `lib/modules.ts` `getEffectiveModules()`. |
| `created_at` | timestamptz | Auto-set |

### Table Migration Status

All 8 data tables have `workspace_id` column. All existing RBK data backfilled with seed workspace `a1b2c3d4-e5f6-7890-abcd-ef1234567890`. RLS enabled on all 10 tables (8 data + workspaces + workspace_members). Workspace-scoped isolation policies applied via `PHASE6_RLS.sql` (run April 5, 2026).

Migrated tables: `emails`, `agenda_notes`, `agenda_items`, `projects`, `gemara_items`, `important_docs`, `recurring_topics`, `attendance_cache`.

---

## Module System

Modules are optional feature sets toggled per workspace via `workspaces.modules` (JSONB feature flags). The sidebar, nav routes, and API routes all check module flags before rendering or executing.

For viewers with `allowed_modules` set on their `workspace_members` row, `getEffectiveModules(modules, allowedModules)` computes the intersection: only modules that are both workspace-enabled AND member-allowed are visible. Owners/assistants have `allowed_modules = NULL` and see all workspace modules.

### Module Registry
| Module key | Type | Description |
|------------|------|-------------|
| `absences` | School | Student absences from Veracross. Config: `provider`, `school_route`. |
| `admissions` | School | Admissions & Enrollment page. Veracross API. Added April 14, 2026. |
| `faculty_absences` | School | Faculty absences from Paycom/Google Sheet. |
| `simchas` | Community | Bar/Bat Mitzvahs + Shivas weekly view. Config: `ical_url`. |
| `gemara` | Custom card | Dashboard resource board card. Config: `card_title`. |
| `calendar` | Core | Google Calendar. On by default. |
| `projects` | Core | Kanban board. On by default. |
| `tasks` | Core | Tasks page. On by default. |
| `agenda` | Core | Meeting agenda. On by default. |

### Example `modules` value
```json
{ "absences": true, "admissions": true, "simchas": true, "gemara": true, "faculty_absences": false }
```

### Example `module_config` value
```json
{
  "absences": { "provider": "veracross", "school_route": "sar" },
  "simchas": { "ical_url": "barbatmitzvah@saracademy.org" },
  "gemara": { "card_title": "Gemara Resources" },
  "inbox": { "owner_label": "RBK", "assistant_label": "Emily" }
}
```

The `inbox` config controls label display in the All Emails page category dropdown ("RBK Action" / "Emily Action" instead of generic "Owner" / "Assistant").

---

## Auth Flow

1. User signs in with Google OAuth (Firebase Auth)
2. `auth/session/route.ts` queries `workspace_members` by Firebase UID (primary) or email (fallback for first sign-in)
3. If user email exists in `workspace_members` but UID is `PLACEHOLDER_*`: auto-replaces with real Firebase UID
4. If email not in `ALLOWED_EMAILS` env var, falls back to checking `workspace_members` table — any email with a row is allowed to sign in
5. Fetches workspace details: `modules`, `module_config`, `allowed_modules`, `role`, `display_name` from workspaces + workspace_members tables
6. Session cookie includes: `workspace_id`, `role`, `modules`, `module_config`, `allowed_modules`, `workspaces[]` array, `accessToken`, user info
7. `AuthProvider.tsx` reads session via `GET /api/auth/session/workspace`, computes `effectiveModules = getEffectiveModules(modules, allowedModules)`
8. `effectiveModules` used everywhere for sidebar nav gating and page content visibility
9. Workspace switcher in sidebar for users with multiple `workspace_members` rows (hidden for viewers)
10. `/api/auth/switch-workspace` rewrites session cookie with new workspace context including `allowed_modules`
11. Viewers auto-redirect to first allowed module on login (priority: admissions → absences → recruiting → simchas → projects)

### Gmail OAuth for Owners ✅ CONSENT FLOW COMPLETE
- Owner navigates to `/api/auth/gmail-consent` → redirected to Google with `gmail.readonly + gmail.modify + gmail.send` scopes
- `access_type: 'offline'` + `prompt: 'consent'` ensures Google returns a refresh token
- `/api/auth/gmail-callback` exchanges code for tokens, saves `refresh_token` to `workspaces.gmail_refresh_token` via `supabaseAdmin`
- `workspaceId` passed as `state` param through the OAuth flow
- Firebase Cloud Functions use this token to access Gmail on a schedule
- Assistants (Emily) do NOT grant Gmail scopes for the owner's inbox — they sign in as themselves
- **Setup required:** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` must be in `.env.local`, redirect URI must be in Google Cloud Console (see `GMAIL_OAUTH_SETUP.md`)

---

## Gmail Pipeline Migration

### Current state
- Firebase Cloud Functions (`triageGmail`, `syncDraftsReady`) are the primary pipeline
- Google Apps Script still running in parallel for RBK as backup
- Full MIME body parsing, no truncation, forwarded emails handled correctly

### Migration Phases

**Phase 1 — Gmail thread fetch** ✅ COMPLETE
- ✅ `gmail.readonly` scope added to OAuth flow
- ✅ `/api/gmail/thread/[threadId]` route fetches full raw thread from Gmail API on demand
- ✅ `ExpandedEmailPanel` fetches full thread on email open, falls back to Supabase on failure

**Phase 2 — Multi-tenant foundation** ✅ COMPLETE (SQL run April 5, 2026)
- ✅ `workspaces` + `workspace_members` tables created, `workspace_id` added to all 8 data tables
- ✅ Auth flow loads workspace context on sign-in
- ✅ `useWorkspace()` hook available on client
- ✅ Seed workspace: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- ✅ RLS enabled on all 10 tables (Phase 6, SQL run April 5, 2026)

**Phase 3 — Workspace-scoped routes + Cloud Functions** ✅ COMPLETE
- ✅ All API routes filter by `workspace_id`
- ✅ `triageGmail` + `syncDraftsReady` Cloud Functions loop all workspaces with non-null `gmail_refresh_token`
- ✅ Per-workspace error handling, log lines prefixed with `[owner_email]`
- ✅ `WORKSPACE_ID` env var removed — workspace discovery is dynamic
- ✅ GAS still running in parallel as backup

**Phase 4 — Module system** ✅ COMPLETE
- ✅ Sidebar + page content gated by `effectiveModules` (not raw `modules`)
- ✅ Community section hidden when all community modules disabled
- ✅ API routes for absences, simchas, gemara return 403 when module disabled
- ✅ Fails open when modules is null — all items visible by default
- ✅ Core items (Dashboard, Emails, Agenda, Tasks, Projects, Emily's Queue) visible for owner/assistant, hidden for viewers with `allowedModules`

**Phase 5 — Viewer role + allowed_modules** ✅ COMPLETE (April 13-14, 2026)
- ✅ `allowed_modules` column added to `workspace_members`
- ✅ `lib/modules.ts` `getEffectiveModules()` computes intersection
- ✅ Auth routes fetch and pass through `allowed_modules`
- ✅ Viewer auto-redirect to first allowed module
- ✅ Daily + Operations sections hidden for viewers
- ✅ Workspace switcher hidden for viewers
- ✅ Three viewer accounts live: Debra Eis (admissions+absences), Emily Daniel (admissions), Amy Hyman (recruiting+faculty_absences)
- ✅ Auth allowlist: any email in `workspace_members` can sign in (not just `ALLOWED_EMAILS` env var)

**Phase 6 (next) — Settings UI, invite flow, self-serve onboarding**
- Workspace settings page (enable/disable modules)
- Invite flow for adding assistants/viewers
- Self-serve workspace creation for new owners

---

## Dev / Test Environment

- **Dev workspace** in the SAME Supabase project (not a separate project)
  - Workspace ID: `b2c3d4e5-f6a7-8901-bcde-f12345678901`
  - Name: "Becca — Dev"
- Becca (`rglassberg@saracademy.org`) is owner of dev workspace, assistant on RBK's workspace
- Gmail refresh token saved and working — Cloud Functions process dev workspace on the same schedule as prod
- Workspace switcher lets Becca toggle between RBK's and her dev workspace
- Same Supabase project, same Firebase project (`rbk-cmd-center`) — dev workspace is just another row
- **Firebase project `rbk-cmd-center-dev`:** NOT yet set up. Using prod Firebase project for dev testing. Separate project deferred.

---

## Build Order (Canonical Sequence)

| Step | Status | Work |
|------|--------|------|
| 1 | ✅ Done | Gmail thread fetch — `/api/gmail/thread/[threadId]` + ExpandedEmailPanel |
| 2 | ✅ Done (April 5) | `workspaces` + `workspace_members` + RLS — schema, migration, seed data |
| 3 | ✅ Done (April 5) | Scope all API routes + Dashboard queries to `workspace_id` |
| 4 | ✅ Done (April 5) | Dev workspace live (same project). Gmail connected. Pipeline flowing. |
| 5 | ✅ Done (April 5) | Cloud Functions replace GAS (multi-workspace loop). GAS still running as backup. |
| 6 | ✅ Done (April 5) | Module flags in sidebar + API routes. RLS policies applied. |
| 7 | ✅ Done (April 13-14) | Viewer role + `allowed_modules` + auth allowlist + effective modules |
| 8 | 🔲 Next | Settings UI, invite flow, self-serve onboarding |

**Rule:** Each step must be additive or backward-compatible. RBK and Emily are never disrupted. The live app stays functional throughout.

---

## Decisions Made

- **Tenant isolation:** Single Supabase project with `workspace_id` + RLS (not separate projects per tenant)
- **Refresh token storage:** `workspaces.gmail_refresh_token` in Supabase (encrypted)
- **Direct write:** Firebase Cloud Function writes directly to Supabase (skips webhook round-trip). Confirmed working in Phase 3.
- **GAS deprecation:** Keep running during migration. Only deprecate after Cloud Functions proven end-to-end.
- **"Principal" terminology:** Gone. Universal terms are `owner` (the executive) and `assistant`.
- **Dev environment:** Same Supabase + Firebase project as prod, dev workspace is just another row. No separate project needed. Chosen April 5, 2026.
- **Cloud Functions multi-workspace:** `triageGmail` and `syncDraftsReady` loop all workspaces with non-null `gmail_refresh_token`. `WORKSPACE_ID` env var removed.
- **Session cookie budget:** `__session` cookie must stay under 4KB. `idToken` not stored (only used during POST). `workspaces[]` array is minimal: `{ id, name, role }` only — modules/module_config stored at top level for active workspace only.
- **Viewer role:** `allowed_modules` on `workspace_members` (not a separate permissions table) — simpler. Chosen April 13, 2026.
- **Module key for admissions:** `"admissions"` added to workspace modules JSONB. April 14, 2026.
- **Auth allowlist:** Any email in `workspace_members` is allowed to sign in — not limited to hardcoded `ALLOWED_EMAILS` env var. April 14, 2026.
- **Inbox labels:** Configurable per workspace via `module_config.inbox.owner_label` / `module_config.inbox.assistant_label`. RBK's workspace uses "RBK" / "Emily".

---

## Open Questions

- ~~**`prompt: 'consent'` still TEMPORARY**~~ — RESOLVED 2026-04-20. Login uses `'select_account'`, refresh uses `'none'`. Gmail owner consent flow keeps `'consent'` intentionally.
- **Workspace settings UI** (`/settings` page) — needed for Phase 8 self-serve
- **Self-serve onboarding** for new workspaces — Phase 8
- **Separate Firebase project for dev** (`rbk-cmd-center-dev`) — deferred, using prod project with dev workspace row instead
- **GAS deprecation timing:** Cloud Functions are the primary pipeline but GAS still active for RBK as backup — confirm when safe to turn off
- **"Decoding Firebase session cookie failed"** log noise in Cloud Run — not blocking (all routes returning 200). Firebase framework adapter tries to decode `__session` as JWT but it stores plain JSON. Cosmetic only.
