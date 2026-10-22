#!/usr/bin/env bash
# 새 버전 배포: 최신 코드 받기 → 의존성 → 재시작 → 헬스 체크. 실패하면 직전 커밋으로 되돌린다.
#   sudo bash ~/malgeumi/deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # 기본: 이 스크립트가 들어 있는 저장소
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"           # 기본: 저장소 주인
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행하세요: sudo bash $0"; exit 1; }
# git·npm 은 저장소 주인으로 돌린다 → 그 계정의 ~/.ssh 키를 쓰고, 파일 주인이 바뀌지 않는다
as_app() { sudo -u "$APP_USER" -H "$@"; }

cd "$APP_DIR"
PREV=$(as_app git rev-parse HEAD)
as_app git fetch --quiet origin "$BRANCH"
as_app git reset --hard --quiet "origin/$BRANCH"
NEXT=$(as_app git rev-parse HEAD)
echo "▶ $PREV → $NEXT"

install_and_restart() {
  if ! as_app git diff --quiet "$1" "$2" -- package-lock.json 2>/dev/null || [ ! -d node_modules ]; then
    as_app npm ci --omit=dev
  fi
  systemctl restart malgeumi
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
  echo "✅ 배포 완료 ($(as_app git log -1 --format='%h %s'))"
else
  echo "❌ 헬스 체크 실패 — $PREV 로 되돌립니다"
  journalctl -u malgeumi -n 30 --no-pager || true
  as_app git reset --hard --quiet "$PREV"
  install_and_restart "$NEXT" "$PREV"
  healthy && echo "↩ 롤백 완료"
  exit 1
fi
