#!/usr/bin/env bash
# 새 버전 배포: 최신 코드 받기 → 의존성 → 재시작 → 헬스 체크. 실패하면 직전 커밋으로 되돌린다.
#   sudo bash <저장소 경로>/deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # 기본: 이 스크립트가 들어 있는 저장소
APP_USER="${APP_USER:-fortune}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

cd "$APP_DIR"
PREV=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
NEXT=$(git rev-parse HEAD)
echo "▶ $PREV → $NEXT"

install_and_restart() {
  if ! git diff --quiet "$1" "$2" -- package-lock.json 2>/dev/null || [ ! -d node_modules ]; then
    npm ci --omit=dev
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  systemctl restart jikding-fortune
}

healthy() {
  for _ in $(seq 1 10); do
    curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

install_and_restart "$PREV" "$NEXT"
if healthy; then
  echo "✅ 배포 완료 ($(git log -1 --format='%h %s'))"
else
  echo "❌ 헬스 체크 실패 — $PREV 로 되돌립니다"
  journalctl -u jikding-fortune -n 30 --no-pager || true
  git reset --hard --quiet "$PREV"
  install_and_restart "$NEXT" "$PREV"
  healthy && echo "↩ 롤백 완료"
  exit 1
fi
