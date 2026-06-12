# Gmail OAuth Setup

Before the consent flow will work, complete these setup steps.

## 1. Add environment variables

Add these to `.env.local` (get values from Google Cloud Console → APIs & Services → Credentials):

```
GOOGLE_CLIENT_ID=<your-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-oauth-client-secret>
```

These are the **Web application** OAuth 2.0 Client ID credentials, NOT the Firebase service account.

## 2. Add redirect URI to Google Cloud Console

1. Go to https://console.cloud.google.com
2. Select the **rbk-cmd-center** project
3. Go to **APIs & Services → Credentials**
4. Click on the OAuth 2.0 Client ID used by this app
5. Under "Authorized redirect URIs", add:
   ```
   https://rbk-cmd-center.web.app/api/auth/gmail-callback
   ```
6. Click **Save**

## 3. Enable the Gmail API

1. In Google Cloud Console, go to **APIs & Services → Library**
2. Search for "Gmail API"
3. Click **Enable** (if not already enabled)

## 4. Trigger the consent flow for RBK

1. Sign in to the app as RBK (or have RBK sign in)
2. Navigate to: https://rbk-cmd-center.web.app/api/auth/gmail-consent
3. Google consent screen will appear — approve all Gmail permissions
4. You'll be redirected back to the app with `gmailConnected=true` in the URL
5. The refresh token is now saved in the `workspaces` table

## Troubleshooting

- **"No refresh token returned"** — Google only returns a refresh token on the first consent, or when `prompt=consent` is set (which we do). If you still don't get one, go to https://myaccount.google.com/permissions, revoke access for the app, and try the consent flow again.
- **401 on /api/auth/gmail-consent** — The user must be signed in with a valid session and have a workspace. Sign in first, then navigate to the consent URL.
- **Redirect URI mismatch** — Make sure the URI in Google Cloud Console exactly matches: `https://rbk-cmd-center.web.app/api/auth/gmail-callback`
