# RBK Command Center

> Custom email triage dashboard for Rabbi Krauss (RBK) and Emily Gray (EG)

A modern web application that receives emails from Google Apps Script, categorizes them using AI, stores them in a database, and presents them in a beautiful, actionable dashboard.

## 🎯 Project Overview

This system replaces Monday.com + Zapier with a custom-built solution that:
- **Saves $420-720/year** in subscription costs
- **Provides better control** over data and features
- **Enables future enhancements** (mobile app, calendar integration, etc.)

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

## 🚀 Tech Stack

| Layer | Technology | Why? |
|-------|-----------|------|
| **Frontend** | Next.js 14 + React | Modern, fast, server-side rendering |
| **Styling** | Tailwind CSS | Rapid UI development, mobile-first |
| **Database** | Supabase (PostgreSQL) | Relational data, real-time, free tier |
| **API** | Next.js API Routes | Serverless, same codebase as frontend |
| **Hosting** | Vercel | Auto-deploy, CDN, free tier |
| **Email Processing** | Google Apps Script | Direct Gmail access, AI analysis |
| **AI** | OpenAI GPT-4o-mini | Email categorization and drafts |

---

## 📁 Project Structure

```
rbk-command-center/
├── app/
│   ├── api/
│   │   └── webhook/
│   │       └── email/
│   │           └── route.ts          # Webhook endpoint for Apps Script
│   ├── layout.tsx                     # Root layout
│   └── page.tsx                       # Main dashboard (email list)
├── lib/
│   └── supabase.ts                    # Supabase client setup
├── types/
│   └── database.ts                    # TypeScript types for database
├── supabase-schema.sql                # Database schema (run in Supabase)
├── .env.local                         # Environment variables (not in git)
├── SUPABASE_SETUP.md                  # Guide to set up Supabase
├── DEPLOYMENT_GUIDE.md                # Guide to deploy to Vercel
├── package.json                       # Dependencies
└── README.md                          # You are here!
```

---

## 📊 Database Schema

### `emails` table
Stores all triaged emails with AI analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `thread_id` | TEXT | Gmail thread ID (for reply threading) |
| `message_id` | TEXT | Gmail message ID (unique) |
| `from_email` | TEXT | Sender email address |
| `from_name` | TEXT | Sender name |
| `subject` | TEXT | Email subject |
| `body_text` | TEXT | Email body (plain text) |
| `priority` | ENUM | `rbk_action`, `eg_action`, `invitation`, etc. |
| `summary` | TEXT | AI-generated summary |
| `action_needed` | TEXT | What needs to be done |
| `draft_reply` | TEXT | AI-generated draft response |
| `assigned_to` | ENUM | `rbk` or `emily` |
| `status` | ENUM | `pending`, `in_progress`, `done`, `archived` |
| `received_at` | TIMESTAMP | When email was received |

### Other tables
- `tasks` - Manual tasks (future)
- `calendar_events` - Google Calendar sync (future)
- `daily_briefing` - Morning summary (future)

---

## 🎨 Features (Phase 1 - MVP)

### ✅ Implemented
- [x] Webhook API endpoint to receive emails from Apps Script
- [x] Supabase database with full schema
- [x] Email list dashboard with priority badges
- [x] 7 email categories with color-coded labels
- [x] Stats overview (emails per category)
- [x] Duplicate email detection
- [x] Responsive design (works on mobile)
- [x] Environment variable configuration
- [x] Error handling and logging

### 🚧 Coming Soon (Phase 2+)
- [ ] User authentication (Google OAuth)
- [ ] Send reply from dashboard (threaded in Gmail)
- [ ] Mark emails as done/archived
- [ ] Filter by priority/status/assigned_to
- [ ] Search emails by subject/sender
- [ ] Mobile PWA (installable on phone)
- [ ] Real-time updates (no page refresh)
- [ ] Daily briefing generation
- [ ] Calendar integration
- [ ] Dark mode

---

## 🛠️ Setup Instructions

### Prerequisites
- Node.js 20+ installed
- Supabase account (free)
- Vercel account (free)
- OpenAI API key

### Quick Start

1. **Clone the repository:**
   ```bash
   cd /home/user/GoogleApps/rbk-command-center
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up Supabase:**
   - Follow instructions in `SUPABASE_SETUP.md`
   - Copy API keys to `.env.local`

4. **Configure environment variables:**
   ```bash
   # Edit .env.local and fill in your values
   nano .env.local
   ```

5. **Run development server:**
   ```bash
   npm run dev
   ```

6. **Deploy to Vercel:**
   - Follow instructions in `DEPLOYMENT_GUIDE.md`

---

## 🔐 Environment Variables

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

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

⚠️ **Never commit `.env.local` to git!** (already in `.gitignore`)

---

## 📡 API Endpoints

### `POST /api/webhook/email`
Receives emails from Google Apps Script.

**Headers:**
```
Authorization: Bearer YOUR_WEBHOOK_SECRET
Content-Type: application/json
```

**Payload:**
```json
{
  "thread_id": "18c5f2e3d1234567",
  "message_id": "18c5f2e3d7654321",
  "from": "John Doe <john@example.com>",
  "to": "kraussb@saracademy.org",
  "subject": "Meeting Request",
  "body": "Email body text...",
  "date": "2026-02-05T14:30:00Z",
  "priority": "rbk_action",
  "category": "scheduling",
  "summary": "John requesting meeting next week",
  "action_needed": "Schedule meeting",
  "draft_reply": "Thank you for reaching out...",
  "assigned_to": "rbk"
}
```

**Response:**
```json
{
  "status": "success",
  "email_id": "uuid-here",
  "message": "Email processed and stored"
}
```

### `GET /api/webhook/email`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Email webhook endpoint is ready",
  "timestamp": "2026-02-05T14:30:00.000Z"
}
```

---

## 🧪 Testing

### Test the webhook locally

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Send a test POST request:**
   ```bash
   curl -X POST http://localhost:3000/api/webhook/email \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your_webhook_secret" \
     -d '{
       "thread_id": "test123",
       "message_id": "msg123",
       "from": "Test <test@example.com>",
       "to": "kraussb@saracademy.org",
       "subject": "Test Email",
       "body": "This is a test",
       "date": "2026-02-05T14:30:00Z",
       "priority": "fyi",
       "category": "test",
       "summary": "Test email",
       "assigned_to": "rbk"
     }'
   ```

3. **Check Supabase:** Email should appear in `emails` table

---

## 📈 Monitoring

### Vercel Logs
- Go to [Vercel Dashboard](https://vercel.com/dashboard)
- Click project → **Logs** tab
- See all webhook requests and errors

### Supabase Logs
- Go to [Supabase Dashboard](https://app.supabase.com)
- Click **Logs** in left sidebar
- See all database queries

### Apps Script Logs
- Go to [Apps Script](https://script.google.com)
- Click **Executions** in left sidebar
- See all script runs and webhook sends

---

## 💰 Cost Analysis

### Current System (Monday.com + Zapier)
- **Monday.com:** $24-48/month
- **Zapier:** $20-30/month
- **Total:** $44-78/month = **$528-936/year**

### New System (Custom App)
- **Vercel:** $0/month (free tier)
- **Supabase:** $0/month (free tier)
- **OpenAI:** $5-20/month
- **Total:** $5-20/month = **$60-240/year**

### 💸 Annual Savings: $468-696

---

## 🗺️ Roadmap

### Phase 1: Foundation (COMPLETED ✅)
- [x] Next.js project setup
- [x] Supabase database schema
- [x] Webhook API endpoint
- [x] Basic email dashboard
- [x] Vercel deployment

### Phase 2: Core Features (2-3 weeks)
- [ ] User authentication
- [ ] Email detail view
- [ ] Send reply functionality
- [ ] Status management (mark as done)
- [ ] Filtering and search

### Phase 3: Mobile & Real-time (1-2 weeks)
- [ ] Progressive Web App (PWA)
- [ ] Real-time updates (Supabase subscriptions)
- [ ] Push notifications
- [ ] Offline support

### Phase 4: Advanced Features (2-3 weeks)
- [ ] Daily briefing generation
- [ ] Google Calendar integration
- [ ] Task management
- [ ] Analytics dashboard

### Phase 5: Polish & Launch (1 week)
- [ ] Performance optimization
- [ ] Mobile testing
- [ ] User feedback implementation
- [ ] Soft launch with RBK

---

## 🤝 Contributing

This is a private project for RBK. If you have access and want to contribute:

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Test locally: `npm run dev`
4. Commit: `git commit -m "Add your feature"`
5. Push: `git push origin feature/your-feature`
6. Create Pull Request on GitHub

---

## 📝 License

Private project - All rights reserved

---

## 📞 Support

For issues or questions:
- **Technical issues:** Check `DEPLOYMENT_GUIDE.md` troubleshooting section
- **Feature requests:** Create GitHub issue
- **Urgent bugs:** Contact project maintainer

---

**Built with ❤️ for RBK and Emily**

*Last updated: February 5, 2026*
