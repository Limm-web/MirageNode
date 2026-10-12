#!/usr/bin/env bash
# ============================================================
# MIRAGE-NODE :: Deploy ke Google Cloud (Cloud Run + Firestore)
# Pakai:  GOOGLE_CLOUD_PROJECT=<project-id> bash deploy_cloudrun.sh
# Note: Docker-based decoy spawning only fully works on VM/GCE modes;
#       on Cloud Run the gateway still functions (Sentinel+Firestore+
#       blacklist) while the Architect degrades gracefully.
# ============================================================
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT terlebih dahulu}"
REGION="${REGION:-asia-southeast2}"
SERVICE="mirage-gateway"

echo "==> Project: $PROJECT_ID | Region: $REGION"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com

echo "==> Preparing Firestore"
gcloud firestore databases create --location="$REGION" 2>/dev/null || echo "    (database already exists)"

# TTL policy: entri blacklist kedaluwarsa otomatis di sisi database.
# Run once; if the CLI fails, set it via Console -> Firestore -> TTL.
echo "==> Enabling TTL on the 'blacklist' collection (expiresAt field)"
gcloud firestore fields ttls update expiresAt --collection-group=blacklist --enable-ttl 2>/dev/null \
  || echo "    (set it manually in the Console if this command is not supported yet)"

echo ">>> CREDENTIAL-SAFE OPTION (recommended): store the key as a Secret"
echo "    gcloud secrets create gemini-api-key --data-file=-   # paste key, Ctrl-D"
echo "    add to deploy: --set-secrets=GEMINI_API_KEY=gemini-api-key:latest"
echo "    (this script uses plain env vars for demo simplicity)"

echo "==> Build image"
gcloud builds submit --tag "gcr.io/$PROJECT_ID/$SERVICE"

echo "==> Deploy ke Cloud Run"
read -rp "Paste GEMINI_API_KEY to embed as a service env var [leave empty when using Secret Manager]: " API_KEY || true
EXTRA_ARGS=()
if [[ -n "${API_KEY:-}" ]]; then
  EXTRA_ARGS+=(--set-env-vars "GEMINI_API_KEY=${API_KEY}")
fi

gcloud run deploy "$SERVICE" \
  --image "gcr.io/$PROJECT_ID/$SERVICE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 512Mi \
  --set-env-vars "FIRESTORE_PROJECT_ID=${PROJECT_ID},GEMINI_MODEL=gemini-3.5-flash,BLACKLIST_TTL_HOURS=24,MAX_BODY_BYTES=1048576" \
  "${EXTRA_ARGS[@]+${EXTRA_ARGS[@]}}"

echo ""
echo "DONE. Screenshots of Cloud Run dashboard + Firestore Console = video evidence."
