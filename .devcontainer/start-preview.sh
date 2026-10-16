#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${CODESPACES:-}" != "true" || -z "${CODESPACE_NAME:-}" || -z "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo 'This launcher requires GitHub Codespaces.' >&2
  exit 1
fi
command -v gh >/dev/null || { echo 'GitHub CLI is required to enforce private access.' >&2; exit 1; }
# Fail closed: never start the app if private port visibility cannot be confirmed.
private_ready=false
for attempt in 1 2 3 4 5; do
  if gh codespace ports visibility 3000:private --codespace "$CODESPACE_NAME"; then
    private_ready=true
    break
  fi
  sleep 2
done
if [[ "$private_ready" != "true" ]]; then
  echo 'Private port access could not be enforced. App was not started.' >&2
  exit 1
fi
exec 9>/tmp/codex-team-preview.lock
if ! flock -n 9; then
  echo 'Preview is already running. Open port 3000 in the Ports tab.'
  exit 0
fi
if [[ ! -f web/dist/index.html ]]; then
  echo 'Frontend build is missing; run npm --prefix web ci --include=dev && npm run build.' >&2
  exit 1
fi
nohup node server/codespaces.js </dev/null >/tmp/codex-team-preview.log 2>&1 &
preview_pid=$!
for attempt in 1 2 3 4 5; do
  if curl --fail --silent http://127.0.0.1:3000/healthz >/dev/null; then
    printf 'المعاينة الخاصة جاهزة: https://%s-3000.%s\n' "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
    exit 0
  fi
  if ! kill -0 "$preview_pid" 2>/dev/null; then
    echo 'Preview stopped; inspect /tmp/codex-team-preview.log.' >&2
    exit 1
  fi
  sleep 1
done
echo 'Preview is still starting; inspect /tmp/codex-team-preview.log and port 3000.'
