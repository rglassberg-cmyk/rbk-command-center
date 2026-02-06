# RBK Command Center

> Custom email triage dashboard for Rabbi Krauss (RBK) and Emily Gray (EG)

A modern web application that receives emails from Google Apps Script, categorizes them using AI, stores them in a database, and presents them in a beautiful, actionable dashboard.

## Project Overview

This system replaces Monday.com + Zapier with a custom-built solution that:
- **Saves $420-720/year** in subscription costs
- **Provides better control** over data and features
- **Enables collaborative workflow** between RBK and Emily

### The Flow

```
Gmail → Apps Script (AI Triage) → Custom API → Supabase → Next.js Dashboard
```

1. **Gmail:** RBK receives emails at `kraussb@saracademy.org`
2. **Apps Script:** Runs every 15 minutes, analyzes emails with OpenAI
3. **Custom API:** Receives webhook from Apps Script
4. **Supabase:** Stores emails in PostgreSQL database
5. **Next.js Dashboard:** Displays emails with filtering, stats, and actions

---

## Tech Stack

| Layer | Technology | Why? |
|-------|-----------|------|
| **Frontend** | Next.js 16 + React | Modern, fast, server-side rendering |
| **Styling** | Tailwind CSS | Rapid UI development, mobile-first |
| **Database** | Supabase (PostgreSQL) | Relational data, real-time, free tier |
| **API** | Next.js API Routes | Serverless, same codebase as frontend |
| **Auth** | NextAuth.js + Google OAuth | Secure login with Google accounts |
| **Hosting** | Vercel | Auto-deploy, CDN, free tier |
| **Email Processing** | Google Apps Script | Direct Gmail access, AI analysis |
| **AI** | OpenAI GPT-4o-mini | Email categorization and drafts |

---

## Features

### Authentication
- **Google OAuth Login** - Sign in with authorized Google accounts only
- **User Tracking** - See who made edits and status changes
- **Protected Routes** - Dashboard requires authentication

### Email Dashboard
- **Priority Categories** - 7 color-coded email priorities (RBK Action, EG Action, Invitation, Meeting, Important, Review, FYI)
- **Stats Overview** - Quick glance at email counts per category
- **Search** - Find emails by subject, sender, or summary
- **Filters** - Filter by status, priority, or assigned person
- **Expandable Details** - Click to see full email content, action needed, and draft reply

### Draft Management
- **AI-Generated Drafts** - Automatic reply suggestions from Apps Script
- **Editable Drafts** - Emily can edit and refine draft replies
- **Draft Status Workflow:**
  - `Not Started` - Original AI draft
  - `Editing` - Draft is being worked on
  - `Draft Ready` - Ready for RBK to review
  - `Approved` - RBK has approved the draft
- **Copy Draft** - One-click copy to clipboard

### Meeting Agenda
- **Flag for Meeting** - Add emails to the morning meeting agenda
- **Agenda Section** - Yellow banner at top shows all flagged items
- **Clear Agenda** - Remove all items after meeting
- **Visual Indicators** - "Agenda" badge on flagged emails

### Status Management
- **Status Options:** Pending, In Progress, Done, Archived
- **Quick Actions** - Start Working, Mark Done, Archive, Reopen
- **Visual Feedback** - Done/Archived emails show with strikethrough

### Mobile Ready
- **Progressive Web App (PWA)** - Install on iPhone/Android home screen
- **Responsive Design** - Works on all screen sizes
- **Touch Friendly** - Large tap targets for mobile use

---

## Project Structure

```
rbk-command-center/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # NextAuth API handler
│   │   ├── emails/
│   │   │   ├── [id]/
│   │   │   │   ├── draft/route.ts       # Save/update drafts
│   │   │   │   └── flag/route.ts        # Flag for meeting
│   │   │   └── status/route.ts          # Update email status
│   │   ├── health/route.ts              # Health check endpoint
│   │   └── webhook/email/route.ts       # Webhook for Apps Script
│   ├── components/
│   │   ├── AuthProvider.tsx             # NextAuth session provider
│   │   └── EmailDashboard.tsx           # Main dashboard component
│   ├── login/page.tsx                   # Login page
│   ├── layout.tsx                       # Root layout with auth
│   └── page.tsx                         # Main dashboard page
├── lib/
│   ├── auth.ts                          # NextAuth configuration
│   └── supabase.ts                      # Supabase client setup
├── public/
│   ├── manifest.json                    # PWA manifest
│   ├── icon-192.png                     # App icon (192x192)
│   └── icon-512.png                     # App icon (512x512)
├── middleware.ts                        # Route protection (deprecated in Next.js 16)
├── .env.local                           # Environment variables (not in git)
├── SUPABASE_SETUP.md                    # Guide to set up Supabase
├── DEPLOYMENT_GUIDE.md                  # Guide to deploy to Vercel
└── README.md                            # You are here!
```

---

## Database Schema

### `emails` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `thread_id` | TEXT | Gmail thread ID |
| `message_id` | TEXT | Gmail message ID (unique) |
| `from_email` | TEXT | Sender email address |
| `from_name` | TEXT | Sender name |
| `subject` | TEXT | Email subject |
| `body_text` | TEXT | Email body (plain text) |
| `priority` | ENUM | `rbk_action`, `eg_action`, `invitation`, etc. |
| `summary` | TEXT | AI-generated summary |
| `action_needed` | TEXT | What needs to be done |
| `draft_reply` | TEXT | AI-generated draft response |
| `edited_draft` | TEXT | User-edited draft |
| `draft_status` | ENUM | `not_started`, `editing`, `draft_ready`, `approved` |
| `draft_edited_by` | TEXT | Email of who edited the draft |
| `draft_edited_at` | TIMESTAMP | When draft was last edited |
| `assigned_to` | ENUM | `rbk` or `emily` |
| `status` | ENUM | `pending`, `in_progress`, `done`, `archived` |
| `is_unread` | BOOLEAN | Whether email is unread |
| `flagged_for_meeting` | BOOLEAN | Whether flagged for meeting agenda |
| `flagged_by` | TEXT | Email of who flagged it |
| `flagged_at` | TIMESTAMP | When it was flagged |
| `meeting_notes` | TEXT | Notes for the meeting |
| `received_at` | TIMESTAMP | When email was received |
| `created_at` | TIMESTAMP | When record was created |

---

## Environment Variables

Create a `.env.local` file with these values:

```bash
# Supabase (get from Supabase → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Webhook security (generate with: openssl rand -base64 32)
WEBHOOK_SECRET=your_secure_random_string

# OpenAI API
OPENAI_API_KEY=sk-...

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx

# NextAuth
NEXTAUTH_SECRET=your_random_secret  # generate with: openssl rand -base64 32
NEXTAUTH_URL=https://rbk-command-center.vercel.app

# Allowed users (comma-separated email addresses)
ALLOWED_EMAILS=rbk@saracademy.org,emily@saracademy.org

# App URL
NEXT_PUBLIC_APP_URL=https://rbk-command-center.vercel.app
```

**Never commit `.env.local` to git!** (already in `.gitignore`)

---

## API Endpoints

### `POST /api/webhook/email`
Receives emails from Google Apps Script.

**Headers:**
```
Authorization: Bearer YOUR_WEBHOOK_SECRET
Content-Type: application/json
```

### `PATCH /api/emails/status`
Update email status.

**Body:**
```json
{ "id": "uuid", "status": "done" }
```

### `PATCH /api/emails/[id]/draft`
Save or update draft reply.

**Body:**
```json
{ "edited_draft": "Reply text...", "draft_status": "draft_ready" }
```

### `PATCH /api/emails/[id]/flag`
Flag or unflag for meeting.

**Body:**
```json
{ "flagged_for_meeting": true }
```

### `GET /api/health`
Health check endpoint.

---

## Setup Instructions

### Prerequisites
- Node.js 20+ installed
- Supabase account (free)
- Vercel account (free)
- Google Cloud Console project with OAuth credentials
- OpenAI API key

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rglassberg-cmyk/rbk-command-center.git
   cd rbk-command-center
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up Supabase:**
   - Follow instructions in `SUPABASE_SETUP.md`
   - Copy API keys to `.env.local`

4. **Set up Google OAuth:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create OAuth 2.0 credentials
   - Add redirect URI: `https://your-domain.vercel.app/api/auth/callback/google`
   - Copy Client ID and Secret to `.env.local`

5. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

6. **Run development server:**
   ```bash
   npm run dev
   ```

7. **Deploy to Vercel:**
   - Follow instructions in `DEPLOYMENT_GUIDE.md`

---

## Deploying Updates

To deploy new changes:

```bash
# Build locally to check for errors
npm run build

# Deploy to Vercel (if git integration has issues)
mv .git .git_backup
npx vercel --prod
mv .git_backup .git
```

---

## Roadmap

### Completed
- [x] Next.js project setup
- [x] Supabase database schema
- [x] Webhook API endpoint
- [x] Email dashboard with search/filters
- [x] Status management (pending, in progress, done, archived)
- [x] Google OAuth authentication
- [x] Editable drafts with status workflow
- [x] Meeting agenda feature
- [x] Progressive Web App (PWA)
- [x] Vercel deployment

### Coming Soon
- [ ] Google Calendar integration (today's schedule)
- [ ] Real-time updates (Supabase subscriptions)
- [ ] Push notifications
- [ ] Daily briefing generation
- [ ] Two-way Gmail sync (mark as read, send replies)

---

## Cost Analysis

### Previous System (Monday.com + Zapier)
- **Monday.com:** $24-48/month
- **Zapier:** $20-30/month
- **Total:** $44-78/month = **$528-936/year**

### Current System (Custom App)
- **Vercel:** $0/month (free tier)
- **Supabase:** $0/month (free tier)
- **OpenAI:** $5-20/month
- **Total:** $5-20/month = **$60-240/year**

### Annual Savings: $468-696

---

## Support

For issues or questions:
- **Technical issues:** Check `DEPLOYMENT_GUIDE.md` troubleshooting section
- **Feature requests:** Create GitHub issue
- **Urgent bugs:** Contact project maintainer

---

**Built for RBK and Emily**

*Last updated: February 6, 2026*
