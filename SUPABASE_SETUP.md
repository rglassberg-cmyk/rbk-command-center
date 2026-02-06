# Supabase Setup Guide

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign in or create a free account
3. Click **"New Project"**
4. Fill in the details:
   - **Name:** RBK Command Center
   - **Database Password:** Choose a strong password (save it somewhere safe)
   - **Region:** Choose closest to you (e.g., US East)
   - **Pricing Plan:** Free tier is perfect for this project
5. Click **"Create new project"**
6. Wait 2-3 minutes for provisioning to complete

## Step 2: Run the Database Schema

1. In your Supabase project, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open the file `/home/user/GoogleApps/rbk-command-center/supabase-schema.sql`
4. Copy the entire contents and paste into the SQL Editor
5. Click **"Run"** (or press Cmd/Ctrl + Enter)
6. You should see: `Success. No rows returned`

This creates:
- ✅ 4 tables: `emails`, `tasks`, `calendar_events`, `daily_briefing`
- ✅ Indexes for fast queries
- ✅ Auto-updating timestamps
- ✅ Row Level Security enabled
- ✅ Helper views and functions

## Step 3: Get Your API Keys

1. Click **"Settings"** (gear icon) in the left sidebar
2. Click **"API"** under Project Settings
3. You'll see:
   - **Project URL** - looks like: `https://xxxxx.supabase.co`
   - **Project API keys:**
     - `anon` / `public` - for client-side code (safe to expose)
     - `service_role` - for server-side code (NEVER expose publicly)

## Step 4: Update Environment Variables

1. Open `/home/user/GoogleApps/rbk-command-center/.env.local`
2. Replace the placeholder values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...your-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...your-service-role-key
```

3. Save the file

## Step 5: Verify the Setup

1. In Supabase, click **"Table Editor"** in the left sidebar
2. You should see 4 tables:
   - `emails` (0 rows)
   - `tasks` (0 rows)
   - `calendar_events` (0 rows)
   - `daily_briefing` (1 row - the welcome message)

3. Click on `daily_briefing` table
4. You should see today's date with the welcome message

## Step 6: Test the Connection

After you start the Next.js dev server, the webhook API will automatically connect to Supabase.

Run this command to start the development server:

```bash
cd /home/user/GoogleApps/rbk-command-center
npm run dev
```

Then open [http://localhost:3000/api/webhook/test](http://localhost:3000/api/webhook/test) in your browser.

If you see `{"status": "ok"}`, Supabase is connected!

## Common Issues

### Issue 1: "Connection refused"
**Solution:** Make sure you copied the correct Project URL (should end with `.supabase.co`)

### Issue 2: "Invalid API key"
**Solution:**
- Double-check you copied the full anon key (very long, starts with `eyJhbGc`)
- Make sure there are no extra spaces or line breaks
- The anon key is PUBLIC, the service_role key is SECRET

### Issue 3: "Permission denied"
**Solution:**
- Make sure you ran the SQL schema successfully
- Check that RLS policies were created (they allow all operations for now)

## Security Note

⚠️ The `.env.local` file contains sensitive keys.

**NEVER commit this file to git!**

It's already in `.gitignore`, but double-check before pushing.

## What's Next?

Once Supabase is set up, you're ready to:
1. ✅ Deploy the Next.js app to Vercel
2. ✅ Update the Apps Script to send webhooks to your API
3. ✅ Test the full email pipeline

---

**Estimated Setup Time:** 15-20 minutes
**Cost:** Free (Supabase free tier includes 500MB database + 2GB bandwidth)
