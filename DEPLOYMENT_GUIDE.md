# Deployment Guide - RBK Command Center

This guide will walk you through deploying your Next.js app to Vercel and connecting everything together.

## Prerequisites

Before you begin, make sure you have:
- ✅ Completed Supabase setup (database created with schema)
- ✅ Supabase API keys saved in `.env.local`
- ✅ GitHub account
- ✅ Vercel account (free tier is fine)

---

## Step 1: Push Code to GitHub

1. **Initialize git repository** (if not already done):
   ```bash
   cd /home/user/GoogleApps/rbk-command-center
   git init
   git add .
   git commit -m "Initial commit: RBK Command Center"
   ```

2. **Create a new GitHub repository:**
   - Go to [https://github.com/new](https://github.com/new)
   - Name: `rbk-command-center`
   - Description: "Email triage system for RBK"
   - Visibility: **Private** (recommended)
   - Click **"Create repository"**

3. **Push to GitHub:**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/rbk-command-center.git
   git branch -M main
   git push -u origin main
   ```

---

## Step 2: Deploy to Vercel

1. **Go to Vercel:**
   - Visit [https://vercel.com](https://vercel.com)
   - Sign in with your GitHub account

2. **Import Project:**
   - Click **"Add New..."** → **"Project"**
   - Select your `rbk-command-center` repository
   - Click **"Import"**

3. **Configure Project:**
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** `./` (default)
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `.next` (default)

4. **Add Environment Variables:**
   Click **"Environment Variables"** and add these:

   | Name | Value | Where to Get It |
   |------|-------|-----------------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase → Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` (long string) | Supabase → Settings → API → `anon` `public` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` (long string) | Supabase → Settings → API → `service_role` |
   | `WEBHOOK_SECRET` | Generate a random string | See below |
   | `OPENAI_API_KEY` | `sk-...` | OpenAI API Dashboard |

   **Generate WEBHOOK_SECRET:**
   Run this in your terminal to generate a secure random string:
   ```bash
   openssl rand -base64 32
   ```
   Copy the output and use it as `WEBHOOK_SECRET`.

5. **Deploy:**
   - Click **"Deploy"**
   - Wait 2-3 minutes for the build to complete
   - You'll get a URL like: `https://rbk-command-center-xxxxx.vercel.app`

---

## Step 3: Update Apps Script Configuration

Now that your API is live, update the Google Apps Script to send webhooks to it.

1. **Open Apps Script:**
   - Go to [https://script.google.com](https://script.google.com)
   - Open your `PrincipalEmailTriage_v2.4_FIXED` project

2. **Update Script Properties:**
   - Click **Project Settings** (gear icon) in left sidebar
   - Scroll to **Script Properties**
   - Add or update these properties:

   | Property | Value |
   |----------|-------|
   | `ZAPIER_WEBHOOK_URL` | `https://your-vercel-app.vercel.app/api/webhook/email` |
   | `WEBHOOK_SECRET` | (same value you used in Vercel) |

   **Important:** Replace `your-vercel-app` with your actual Vercel deployment URL!

3. **Deploy the updated script:**
   - Click **Deploy** → **Test deployments**
   - Or just save it (Ctrl/Cmd + S)

---

## Step 4: Test the Integration

### Test 1: Check if the API is live

1. Open your Vercel URL in a browser: `https://your-app.vercel.app`
2. You should see the RBK Command Center dashboard
3. It will show "No emails yet" (that's expected!)

### Test 2: Test the webhook endpoint

1. Visit: `https://your-app.vercel.app/api/webhook/email`
2. You should see:
   ```json
   {
     "status": "ok",
     "message": "Email webhook endpoint is ready",
     "timestamp": "2026-02-05T..."
   }
   ```

### Test 3: Send a test email

1. **Option A - Use a real email:**
   - Send a test email to `kraussb@saracademy.org`
   - Wait 15 minutes for the trigger to run
   - Check Vercel dashboard for emails

2. **Option B - Run script manually:**
   - In Apps Script, click **Run** → `triagePrincipalEmails`
   - Check the **Execution log** for webhook success
   - Refresh your Vercel app - email should appear!

---

## Step 5: Monitor and Debug

### Check Vercel Logs

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click your project → **Logs** tab
3. You'll see:
   - Incoming webhook requests
   - Database operations
   - Any errors

### Check Supabase Data

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **Table Editor** → `emails` table
3. You should see test emails appearing

### Check Apps Script Logs

1. In Apps Script, click **Executions** in left sidebar
2. Look for successful webhook sends (HTTP 200)
3. If you see errors, check the logs for details

---

## Common Issues

### Issue 1: "Unauthorized" error from webhook

**Cause:** `WEBHOOK_SECRET` doesn't match between Apps Script and Vercel

**Solution:**
- Verify both values are EXACTLY the same
- No extra spaces or line breaks
- Regenerate a new secret if needed:
  ```bash
  openssl rand -base64 32
  ```
- Update both Apps Script and Vercel

### Issue 2: "Database error" or "Invalid API key"

**Cause:** Supabase credentials incorrect in Vercel

**Solution:**
- Go to Vercel → Settings → Environment Variables
- Double-check `NEXT_PUBLIC_SUPABASE_URL` and keys
- Copy directly from Supabase (don't type manually)
- Redeploy: Vercel → Deployments → ... → Redeploy

### Issue 3: Emails not showing up

**Cause:** Could be several things

**Solution:**
1. Check Apps Script execution logs - did it run?
2. Check Vercel logs - did webhook receive data?
3. Check Supabase table - is data there?
4. Refresh the page (it's not real-time yet)

### Issue 4: Build fails on Vercel

**Cause:** TypeScript errors or missing dependencies

**Solution:**
- Check Vercel build logs for specific error
- Make sure all dependencies are in `package.json`
- Try building locally first:
  ```bash
  cd /home/user/GoogleApps/rbk-command-center
  npm run build
  ```

---

## Vercel Deployment Settings

### Recommended Settings

1. **Auto-deploy:** ✅ Enabled (deploys on every git push)
2. **Production Branch:** `main`
3. **Framework:** Next.js
4. **Node Version:** 20.x (default)

### Custom Domain (Optional)

1. Go to Vercel → Settings → Domains
2. Add a custom domain like `rbk.your-domain.com`
3. Follow DNS instructions to point domain to Vercel
4. Update Apps Script with new URL

---

## Security Checklist

Before going live:

- [ ] `.env.local` is in `.gitignore` (already done)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is kept secret
- [ ] `WEBHOOK_SECRET` is strong (32+ random characters)
- [ ] GitHub repository is private
- [ ] Vercel project is private
- [ ] Only authorized people have access to Vercel and Supabase

---

## What's Next?

After successful deployment:

1. ✅ **Monitor for 24 hours** - Check logs, verify emails flowing
2. ✅ **Test email replies** - We'll implement this in Phase 2
3. ✅ **Add authentication** - Protect the dashboard
4. ✅ **Build mobile PWA** - For RBK's phone access
5. ✅ **Add real-time updates** - Emails appear instantly

---

## Cost Summary

- **Vercel:** $0/month (free tier - up to 100GB bandwidth)
- **Supabase:** $0/month (free tier - 500MB database)
- **OpenAI:** ~$5-20/month (based on usage)
- **Total:** ~$5-20/month vs $40-80/month (Monday.com + Zapier)

**Savings:** $420-720/year! 🎉

---

## Need Help?

- **Vercel Docs:** https://vercel.com/docs
- **Next.js Docs:** https://nextjs.org/docs
- **Supabase Docs:** https://supabase.com/docs
- **Deployment Issues:** Check logs first (Vercel, Supabase, Apps Script)

---

**Estimated Deployment Time:** 30-45 minutes (first time)
**Difficulty:** Medium (straightforward if you follow steps carefully)
**Critical Step:** Environment variables - double-check these!
