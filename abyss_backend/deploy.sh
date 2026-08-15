#!/bin/bash

# =====================================================
# Stop Script on Error
# =====================================================
set -euo pipefail

# =====================================================
# Build Variables
# =====================================================
export IMAGE_TAG=$BITBUCKET_BUILD_NUMBER

# Health check & rollback configuration (overridable via Bitbucket vars)
HEALTH_CHECK_TIMEOUT=${HEALTH_CHECK_TIMEOUT:-300}   # 5 min total wait
HEALTH_CHECK_INTERVAL=${HEALTH_CHECK_INTERVAL:-15}   # poll every 15s
DEPLOY_WARMUP=${DEPLOY_WARMUP:-60}                   # wait before first check

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# =====================================================
# Cleanup — always runs on exit (success or failure)
# Ensures gcp-key.json is never left on the runner disk
# =====================================================
trap 'rm -f gcp-key.json && log "Cleaned up credentials."' EXIT

# =====================================================
# Install Required Packages
# =====================================================
apt-get update && apt-get install -y curl

# =====================================================
# Snapshot Full Env from Dokploy (IMAGE_TAG + CONFIG_JSON + all vars)
# Required Bitbucket vars: DOKPLOY_API_URL, DOKPLOY_API_KEY, COMPOSE_ID
#
# Rollback restores the ENTIRE env, not just IMAGE_TAG — so if CONFIG_JSON
# or any other runtime var caused the failure, the rollback is still valid.
# =====================================================
ROLLBACK_PAYLOAD=""
PREVIOUS_IMAGE_TAG=""

if [ -n "${DOKPLOY_API_URL:-}" ] && [ -n "${DOKPLOY_API_KEY:-}" ] && [ -n "${COMPOSE_ID:-}" ]; then
  log "Snapshotting full env from Dokploy (IMAGE_TAG + CONFIG_JSON + all vars)..."
  COMPOSE_RESPONSE=$(curl -sf \
    --max-time 15 \
    -H "x-api-key: $DOKPLOY_API_KEY" \
    "$DOKPLOY_API_URL/api/compose.one?composeId=$COMPOSE_ID" 2>/dev/null) || COMPOSE_RESPONSE=""

  if [ -n "$COMPOSE_RESPONSE" ]; then
    # Parse multiline KEY=VALUE env string into a properly escaped JSON webhook payload.
    # Using Python so CONFIG_JSON (a nested JSON blob) is encoded safely without shell quoting issues.
    ROLLBACK_PAYLOAD=$(echo "$COMPOSE_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    env_str = data.get('env', '')
    env_dict = {}
    for line in env_str.splitlines():
        line = line.strip()
        if '=' in line:
            key, val = line.split('=', 1)
            env_dict[key.strip()] = val
    print(json.dumps({'env': env_dict}))
except Exception:
    pass
" 2>/dev/null) || ROLLBACK_PAYLOAD=""

    # Extract IMAGE_TAG from the payload for logging only
    PREVIOUS_IMAGE_TAG=$(echo "$ROLLBACK_PAYLOAD" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('env', {}).get('IMAGE_TAG', ''))
except Exception:
    pass
" 2>/dev/null) || PREVIOUS_IMAGE_TAG=""
  fi

  if [ -n "$ROLLBACK_PAYLOAD" ]; then
    log "Env snapshot captured. Rollback target: IMAGE_TAG=$PREVIOUS_IMAGE_TAG"
  else
    log "WARNING: Could not snapshot env from Dokploy — rollback will be manual if needed"
  fi
else
  log "WARNING: DOKPLOY_API_URL/DOKPLOY_API_KEY/COMPOSE_ID not set — rollback will be manual if needed"
fi

# =====================================================
# Authenticate with Google Cloud
# =====================================================
echo "$GCP_KEY" > gcp-key.json
gcloud auth activate-service-account --key-file=gcp-key.json
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet

# =====================================================
# Build Docker Image
# =====================================================
log "Building image: $IMAGE_NAME:$IMAGE_TAG"
docker build --no-cache -t "$IMAGE_NAME:latest" .

# =====================================================
# Tag and Push
# =====================================================
docker tag "$IMAGE_NAME:latest" "$IMAGE_NAME:$IMAGE_TAG"
docker push "$IMAGE_NAME:latest"
docker push "$IMAGE_NAME:$IMAGE_TAG"
log "Pushed: $IMAGE_NAME:$IMAGE_TAG"

# =====================================================
# Dokploy helpers — two-step deploy pattern:
#   1. compose.update (COMPOSE_ID) — write new IMAGE_TAG into Dokploy env
#   2. webhook (WEBHOOK)           — trigger redeploy with current env
# Both forward deploy and rollback use the same pattern.
# Pipeline exports COMPOSE_ID from COMPOSE_ID_DEV/UAT/PROD
#                  WEBHOOK      from DOKPLOY_WEBHOOK_URL_DEV/UAT/PROD
# =====================================================
dokploy_save_env() {
  # $1 = KEY=VALUE newline-separated env string
  local env_string="$1"
  local body http_code resp_body

  body=$(printf '%s' "$env_string" | COMPOSE_ID="$COMPOSE_ID" python3 -c "
import json, sys, os
env_str = sys.stdin.read()
print(json.dumps({'composeId': os.environ['COMPOSE_ID'], 'env': env_str}))
" 2>&1) || { log "ERROR: Failed to build env payload: $body"; return 1; }

  resp_body=$(echo "$body" | curl -s \
    -o /tmp/dokploy_save_resp.txt \
    -w "%{http_code}" \
    -X POST "$DOKPLOY_API_URL/api/compose.update" \
    -H "x-api-key: $DOKPLOY_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- 2>&1)
  http_code="$resp_body"
  log "compose.update → HTTP $http_code | $(cat /tmp/dokploy_save_resp.txt 2>/dev/null | head -c 300)"

  [ "$http_code" = "200" ] || return 1
}

dokploy_deploy() {
  local resp_body http_code
  # WEBHOOK = https://dokploy.host/api/deploy/compose/<refreshToken>
  # Set via DOKPLOY_WEBHOOK_URL_DEV/UAT/PROD Bitbucket vars → exported as WEBHOOK.
  # We update the env via compose.update first, then trigger this webhook —
  # it deploys with the current env, which now has the correct IMAGE_TAG.
  resp_body=$(curl -s \
    -o /tmp/dokploy_deploy_resp.txt \
    -w "%{http_code}" \
    -X POST "$WEBHOOK" 2>&1)
  http_code="$resp_body"
  log "webhook deploy → HTTP $http_code | $(cat /tmp/dokploy_deploy_resp.txt 2>/dev/null | head -c 300)"
  [ "$http_code" = "200" ] || return 1
}

# =====================================================
# Trigger Dokploy Deployment
# CONFIG_JSON is passed from Bitbucket secured variable so config changes
# are versioned alongside code — no manual edits needed in Dokploy UI.
# We merge the new IMAGE_TAG into the existing env snapshot so all other
# vars (DB creds, feature flags, etc.) are preserved unchanged.
# =====================================================
log "Triggering Dokploy deployment (IMAGE_TAG=$IMAGE_TAG)..."

NEW_ENV=$(echo "${ROLLBACK_PAYLOAD:-{\"env\":{}}}" | IMAGE_TAG="$IMAGE_TAG" python3 -c "
import json, sys, os
try:
    data = json.load(sys.stdin)
    env_dict = data.get('env', {})
except Exception:
    env_dict = {}
env_dict['IMAGE_TAG'] = os.environ['IMAGE_TAG']
config = os.environ.get('CONFIG_JSON', '')
if config:
    env_dict['CONFIG_JSON'] = config
print('\n'.join(f'{k}={v}' for k, v in env_dict.items()))
") || NEW_ENV="IMAGE_TAG=$IMAGE_TAG"

dokploy_save_env "$NEW_ENV" || { log "ERROR: Failed to update Dokploy env"; exit 1; }
log "Dokploy env updated (IMAGE_TAG=$IMAGE_TAG)"

dokploy_deploy || { log "ERROR: Failed to trigger Dokploy deployment"; exit 1; }
log "Deployment triggered."

# =====================================================
# Rollback Helper
# =====================================================
rollback() {
  local reason="$1"
  log "ROLLBACK INITIATED: $reason"

  if [ -n "$ROLLBACK_PAYLOAD" ]; then
    log "Restoring env snapshot (IMAGE_TAG=$PREVIOUS_IMAGE_TAG)..."

    RESTORE_ENV=$(echo "$ROLLBACK_PAYLOAD" | python3 -c "
import json, sys
data = json.load(sys.stdin)
env_dict = data.get('env', {})
print('\n'.join(f'{k}={v}' for k, v in env_dict.items()))
" 2>/dev/null) || RESTORE_ENV="IMAGE_TAG=$PREVIOUS_IMAGE_TAG"

    dokploy_save_env "$RESTORE_ENV" && \
      log "Dokploy env restored (IMAGE_TAG=$PREVIOUS_IMAGE_TAG)" || \
      log "WARNING: Failed to restore env — check Dokploy manually"

    dokploy_deploy && \
      log "Rollback deployment triggered — IMAGE_TAG=$PREVIOUS_IMAGE_TAG" || \
      log "ERROR: Rollback deploy trigger failed. Go to Dokploy UI → Deploy manually."
  else
    log "ERROR: No env snapshot available. Manual rollback required."
    log "  Ensure DOKPLOY_API_URL, DOKPLOY_API_KEY, COMPOSE_ID are set in Bitbucket vars."
    log "  Check GAR for available image tags: $IMAGE_NAME"
  fi

  exit 1
}

# =====================================================
# Rollback Test Hook
# Set ROLLBACK_TEST=true in Bitbucket vars to force an immediate rollback
# after deploy — verifies the rollback mechanism without changing app code.
# Remove the variable after testing.
# =====================================================
if [ "${ROLLBACK_TEST:-false}" = "true" ]; then
  rollback "ROLLBACK_TEST=true — forced rollback to IMAGE_TAG=$PREVIOUS_IMAGE_TAG"
fi

# =====================================================
# Health Check Loop (post-deployment verification)
# =====================================================
if [ -n "${HEALTH_CHECK_URL:-}" ]; then
  log "Warming up — waiting ${DEPLOY_WARMUP}s before health checks..."
  sleep "$DEPLOY_WARMUP"

  log "Health checking: $HEALTH_CHECK_URL"
  log "  Timeout: ${HEALTH_CHECK_TIMEOUT}s | Interval: ${HEALTH_CHECK_INTERVAL}s"
  ELAPSED=0

  while true; do
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")

    if [ "$HTTP_STATUS" = "200" ]; then
      log "Health check PASSED (HTTP $HTTP_STATUS) after ${ELAPSED}s"
      break
    fi

    if [ "$ELAPSED" -ge "$HEALTH_CHECK_TIMEOUT" ]; then
      rollback "Health check failed after ${HEALTH_CHECK_TIMEOUT}s (last HTTP status: $HTTP_STATUS)"
    fi

    log "Health check: HTTP $HTTP_STATUS — retry in ${HEALTH_CHECK_INTERVAL}s (${ELAPSED}/${HEALTH_CHECK_TIMEOUT}s elapsed)"
    sleep "$HEALTH_CHECK_INTERVAL"
    ELAPSED=$((ELAPSED + HEALTH_CHECK_INTERVAL))
  done
else
  log "HEALTH_CHECK_URL not configured — skipping post-deploy verification"
  log "Set HEALTH_CHECK_URL in Bitbucket variables to enable automatic rollback"
fi

# =====================================================
# Deployment Completed
# =====================================================
log "Deployment complete. IMAGE_TAG=$IMAGE_TAG"
