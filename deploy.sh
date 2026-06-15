#!/bin/bash
set -e

# RBK Command Center — Deploy Script
# Works around Firebase CLI bug where "replace Run service" fails with 409
# (revision name collision between function update and hosting finalization).
#
# Flow:
#   1. Build Next.js app
#   2. Run firebase deploy --only hosting (ignoring the expected replace error)
#   3. Manually finalize the hosting version via REST API
#   4. Create a new release pointing to it
#   5. Restore allUsers IAM on the Cloud Run service
#   6. Optionally deploy 1st-gen Cloud Functions

PROJECT="rbk-cmd-center"
REGION="us-east1"
SERVICE="ssrrbkcmdcenter"
SITE="rbk-cmd-center"

# Load secrets from .env.local so $ANTHROPIC_API_KEY (etc.) are available below.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

echo "=== Building Next.js app ==="
npm run build

echo ""
echo "=== Deploying to Firebase Hosting ==="
# Run firebase deploy; it will fail at "replace Run service" but the function
# and hosting files are already uploaded by that point.
npx firebase deploy --only hosting 2>&1 || true

echo ""
echo "=== Finalizing hosting version manually ==="
TOKEN=$(gcloud auth print-access-token)

# Find the most recent CREATED (unfinalized) version
VERSION_ID=$(curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions?pageSize=1&filter=status%3D%22CREATED%22" \
  | python3 -c "import sys,json; vs=json.load(sys.stdin).get('versions',[]); print(vs[0]['name'].split('/')[-1] if vs else '')")

if [ -z "$VERSION_ID" ]; then
  echo "No unfinalized version found — hosting may have succeeded normally."
else
  echo "Found unfinalized version: $VERSION_ID"

  # Patch in the Cloud Run rewrite config
  curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" \
    -d "{\"config\":{\"rewrites\":[{\"glob\":\"/**\",\"run\":{\"serviceId\":\"${SERVICE}\",\"region\":\"${REGION}\"}}]}}" \
    "https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions/${VERSION_ID}?updateMask=config" > /dev/null

  # Finalize the version
  curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" \
    -d '{"status":"FINALIZED"}' \
    "https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions/${VERSION_ID}?updateMask=status" > /dev/null

  # Create a release
  RELEASE=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT" \
    -H "Content-Type: application/json" \
    "https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/releases?versionName=sites/${SITE}/versions/${VERSION_ID}")

  RELEASE_NAME=$(echo "$RELEASE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name','ERROR'))" 2>/dev/null || echo "ERROR")
  echo "Release created: $RELEASE_NAME"
fi

echo ""
echo "=== Restoring allUsers IAM on Cloud Run ==="
gcloud run services add-iam-policy-binding "$SERVICE" \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --project="$PROJECT" \
  --quiet 2>&1 | tail -1

echo ""
echo "=== Deploying 1st-gen Cloud Functions ==="
cd functions && npm run build && cd ..
npx firebase deploy --only functions 2>&1 | tail -5

echo ""
echo "=== Forcing Cloud Run revision update ==="
# --min-instances=1 keeps one container always warm, eliminating ~3-8s cold starts
# after the service has been idle. Costs ~$5-15/mo for a small always-on instance.
# --no-cpu-throttling keeps CPU allocated even after the HTTP response is sent, so
# fire-and-forget background work (e.g. Buzz's Slack handler calling the Anthropic
# API after the 200 ack to Slack) actually runs to completion instead of being
# frozen/aborted post-ack. Without this, Buzz intermittently fell through to its
# "Something's off on my end" error fallback.
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --min-instances=1 \
  --no-cpu-throttling \
  --memory=512Mi \
  --update-labels=forcedeploy=$(date +%s) \
  --update-env-vars="INTERNAL_SYNC_SECRET=0395162bea09e40d074331d0d7da73adb5abc94e04f08a46442b761f9c964dc3,SYNC_SECRET=rbk-sync-2026,LEVER_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImhpcmUyXzEifQ.eyJqdGkiOiI2YmYxOGQwYy1mNmQ0LTRjZjEtODdkMC01NGZjYTQ0NTc3MWMiLCJpc3MiOiJodHRwczovL2xldmVyLmNvLyIsInN1YiI6IjgwODY5MGM2LTg1NTgtNDdlYy04Mjk4LWYyMWZjYTEyOTAxYSIsImF1ZCI6Imh0dHBzOi8vYXBpLmxldmVyLmNvIiwiaWF0IjoxNzc3OTMzNTA2NzM3LCJodHRwczovL2FwaS5sZXZlci5jby9jcmVkZW50aWFsSWQiOiIyZjllMDU4MC02OTNiLTQwZjYtOGIzOC1lYTZiYWNiYjk5MTUiLCJodHRwczovL2FwaS5sZXZlci5jby9hY2NvdW50SWQiOiJiYzU2NDlmNC0wMDU2LTRhMjItYTQxMy01ZTlkNmYyMjBmYjgiLCJodHRwczovL2FwaS5sZXZlci5jby9yZWdpb24iOiJnbG9iYWwiLCJodHRwczovL2FwaS5sZXZlci5jby9iYXNlVXJpIjoiaHR0cHM6Ly9hcGkubGV2ZXIuY28ifQ.E-2DacDW8ElI531fAr0Ty2sO8QeYM92A29mUf0qClrw,ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY,SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN,COOPER_RECONCILIATION_SHEET_ID=$COOPER_RECONCILIATION_SHEET_ID,ISRAEL_GRANTS_SHEET_ID=$ISRAEL_GRANTS_SHEET_ID,VERACROSS_PROGRAMS_CLIENT_ID=$VERACROSS_PROGRAMS_CLIENT_ID,VERACROSS_PROGRAMS_CLIENT_SECRET=$VERACROSS_PROGRAMS_CLIENT_SECRET"

echo ""
echo "=== Verifying site ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://${SITE}.web.app/")
if [ "$STATUS" = "307" ] || [ "$STATUS" = "200" ]; then
  echo "Site is UP (HTTP $STATUS)"
else
  echo "WARNING: Site returned HTTP $STATUS — may need manual investigation"
fi

echo ""
echo "=== Deploy complete ==="
