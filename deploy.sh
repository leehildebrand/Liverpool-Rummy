#!/usr/bin/env bash
# Node app deployment over SSH (upload release, install deps, restart PM2)
# Usage: ./deploy.sh [--dry-run]

set -euo pipefail

DEPLOY_HOST="198.54.115.138"
DEPLOY_PORT="21098"
DEPLOY_USER="leehbcmz"
REMOTE_APP_DIR="apps/liverpool-rummy"
PM2_APP_NAME="liverpool-rummy"

LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
RELEASE_ID="$(date +%Y%m%d%H%M%S)"
ARCHIVE_NAME="liverpool-rummy-${RELEASE_ID}.tgz"
LOCAL_ARCHIVE="/tmp/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"
DRY_RUN=false

run_local() {
  echo "+ $*"
  if [[ "$DRY_RUN" == false ]]; then
    "$@"
  fi
}

run_ssh() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "+ ssh -p ${DEPLOY_PORT} ${DEPLOY_USER}@${DEPLOY_HOST} <remote-script>"
    return 0
  fi

  ssh -p "${DEPLOY_PORT}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
}

if [[ $# -gt 1 ]]; then
  echo "Usage: ./deploy.sh [--dry-run]"
  exit 1
fi

if [[ $# -eq 1 ]]; then
  if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
  else
    echo "Usage: ./deploy.sh [--dry-run]"
    exit 1
  fi
fi

echo ""
echo "Deploying Node app to ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_APP_DIR}"
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry-run mode: printing commands only."
else
  echo "Release id: ${RELEASE_ID}"
fi
echo ""

run_local tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.DS_Store' \
  --exclude='*.log' \
  --exclude='deploy.sh' \
  -czf "${LOCAL_ARCHIVE}" \
  -C "${LOCAL_DIR}" .

if [[ "$DRY_RUN" == false ]]; then
  run_local scp -P "${DEPLOY_PORT}" "${LOCAL_ARCHIVE}" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"
else
  echo "+ scp -P ${DEPLOY_PORT} ${LOCAL_ARCHIVE} ${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"
fi

run_ssh "
set -euo pipefail
REMOTE_APP_DIR='${REMOTE_APP_DIR}'
PM2_APP_NAME='${PM2_APP_NAME}'
RELEASE_ID='${RELEASE_ID}'
REMOTE_ARCHIVE='${REMOTE_ARCHIVE}'

mkdir -p \"\${REMOTE_APP_DIR}/releases\" \"\${REMOTE_APP_DIR}/shared\"
RELEASE_DIR=\"\${REMOTE_APP_DIR}/releases/\${RELEASE_ID}\"
mkdir -p \"\${RELEASE_DIR}\"

tar -xzf \"\${REMOTE_ARCHIVE}\" -C \"\${RELEASE_DIR}\"

if [[ -f \"\${REMOTE_APP_DIR}/shared/.env\" ]]; then
  ln -sfn \"\${REMOTE_APP_DIR}/shared/.env\" \"\${RELEASE_DIR}/.env\"
else
  echo 'Missing shared .env file at '\"\${REMOTE_APP_DIR}/shared/.env\"'.'
  echo 'Create it with DATABASE_URL before first deploy.'
  exit 1
fi

cd \"\${RELEASE_DIR}\"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev || npm ci --production
else
  npm install --omit=dev || npm install --production
fi

ln -sfn \"\${RELEASE_DIR}\" \"\${REMOTE_APP_DIR}/current\"

if command -v pm2 >/dev/null 2>&1; then
  cd \"\${REMOTE_APP_DIR}/current\"
  if pm2 describe \"\${PM2_APP_NAME}\" >/dev/null 2>&1; then
    pm2 restart \"\${PM2_APP_NAME}\" --update-env
  else
    pm2 start server.js --name \"\${PM2_APP_NAME}\" --update-env
  fi
  pm2 save || true
else
  echo 'PM2 is not installed on the server. Install PM2 or replace restart logic in deploy.sh.'
  exit 1
fi

rm -f \"\${REMOTE_ARCHIVE}\"
"

if [[ "$DRY_RUN" == false ]]; then
  run_local rm -f "${LOCAL_ARCHIVE}"
fi

echo ""
echo "Deployment complete."
