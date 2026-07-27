#!/usr/bin/env bash
# Node app deployment over SSH (upload release, install deps, restart PM2)
# Usage: ./deploy.sh [--dry-run]

set -euo pipefail

DEPLOY_HOST="198.54.115.138"
DEPLOY_PORT="21098"
DEPLOY_USER="leehbcmz"
REMOTE_APP_DIR="apps/liverpool-rummy"
PM2_APP_NAME="liverpool-rummy"

# Use CloudLinux Node 10 binaries directly in non-interactive SSH.
REMOTE_NPM_BIN="/opt/alt/alt-nodejs10/root/usr/bin/npm"
REMOTE_PM2_BIN="/home/leehbcmz/nodevenv/liverpoolrummy/10/lib/bin/pm2"

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
NPM_BIN='${REMOTE_NPM_BIN}'
PM2_BIN='${REMOTE_PM2_BIN}'
NODE_BIN_DIR='/opt/alt/alt-nodejs10/root/usr/bin'
REMOTE_APP_ROOT=\"\${HOME}/\${REMOTE_APP_DIR}\"
export PATH=\"\${NODE_BIN_DIR}:\${PATH}\"

if [[ ! -x \"\${NPM_BIN}\" ]]; then
  echo 'npm binary not found at '"\${NPM_BIN}"'.'
  exit 1
fi

mkdir -p \"\${REMOTE_APP_ROOT}/releases\" \"\${REMOTE_APP_ROOT}/shared\"
RELEASE_DIR=\"\${REMOTE_APP_ROOT}/releases/\${RELEASE_ID}\"
mkdir -p \"\${RELEASE_DIR}\"

tar -xzf \"\${REMOTE_ARCHIVE}\" -C \"\${RELEASE_DIR}\"

if [[ -f \"\${REMOTE_APP_ROOT}/shared/.env\" ]]; then
  ln -sfn \"\${REMOTE_APP_ROOT}/shared/.env\" \"\${RELEASE_DIR}/.env\"
else
  echo 'Missing shared .env file at '"\${REMOTE_APP_ROOT}/shared/.env"'.'
  echo 'Create it with DATABASE_URL before first deploy.'
  exit 1
fi

cd \"\${RELEASE_DIR}\"
if [[ -f package-lock.json ]]; then
  if ! \"\${NPM_BIN}\" ci --omit=dev; then
    rm -f package-lock.json
    \"\${NPM_BIN}\" install --production --no-package-lock
  fi
else
  \"\${NPM_BIN}\" install --production --no-package-lock
fi

ln -sfn \"\${RELEASE_DIR}\" \"\${REMOTE_APP_ROOT}/current\"

if [[ ! -x \"\${PM2_BIN}\" ]]; then
  echo 'PM2 binary not found at '"\${PM2_BIN}"'.'
  echo 'Install PM2 in your user environment and re-run deploy.'
  exit 1
fi

cd \"\${REMOTE_APP_ROOT}/current\"
"\${PM2_BIN}" delete "\${PM2_APP_NAME}" >/dev/null 2>&1 || true
"\${PM2_BIN}" start app.js --name "\${PM2_APP_NAME}" --update-env
\"\${PM2_BIN}\" save || true

rm -f \"\${REMOTE_ARCHIVE}\"
"

if [[ "$DRY_RUN" == false ]]; then
  run_local rm -f "${LOCAL_ARCHIVE}"
fi

echo ""
echo "Deployment complete."
