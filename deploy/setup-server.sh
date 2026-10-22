#!/usr/bin/env bash
# 서버 최초 1회 설정 (Ubuntu/Debian). root 또는 sudo 로 실행.
#
#   기존 사이트에 /fortune/ 로 붙일 때 (Nginx 설정은 건드리지 않음):
#     sudo REPO_URL=git@github.com:heewon0924-cmyk/jikding-fortune.git bash setup-server.sh
#   새 (서브)도메인으로 따로 띄울 때:
#     sudo REPO_URL=... DOMAIN=fortune.example.com bash setup-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:?REPO_URL 을 지정하세요}"
DOMAIN="${DOMAIN:-}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # 기본: 이 스크립트가 들어 있는 저장소
APP_USER="${APP_USER:-fortune}"
BRANCH="${BRANCH:-main}"

echo "▶ 패키지 설치"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v git >/dev/null || apt-get install -y git
# Nginx 가 이미 있으면(기존 사이트 운영 중) 그대로 쓴다
command -v nginx >/dev/null || apt-get install -y nginx

echo "▶ 서비스 계정"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"

echo "▶ 코드 받기 → $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git config --global --add safe.directory "$APP_DIR"
cd "$APP_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ⚠ $APP_DIR/.env 를 만들었습니다. GEMINI_API_KEY 를 넣고 'systemctl restart jikding-fortune' 하세요."
fi
chmod 600 .env
npm ci --omit=dev
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "▶ systemd"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" -e "s#__NODE__#$(command -v node)#g" \
  deploy/jikding-fortune.service > /etc/systemd/system/jikding-fortune.service
systemctl daemon-reload
systemctl enable --now jikding-fortune

echo "▶ Nginx"
if [ -n "$DOMAIN" ]; then
  if [ -e /etc/nginx/sites-available/jikding-fortune ]; then
    echo "  /etc/nginx/sites-available/jikding-fortune 이 이미 있어 그대로 둡니다."
  else
    sed "s#__DOMAIN__#$DOMAIN#g" deploy/nginx-fortune.conf > /etc/nginx/sites-available/jikding-fortune
    ln -sf /etc/nginx/sites-available/jikding-fortune /etc/nginx/sites-enabled/jikding-fortune
  fi
  nginx -t && systemctl reload nginx
else
  echo "  DOMAIN 이 없어 Nginx 설정은 건드리지 않았습니다."
  echo "  기존 사이트의 server { } 안에 $APP_DIR/deploy/nginx-fortune-location.conf 내용을 붙여 넣고"
  echo "  sudo nginx -t && sudo systemctl reload nginx  →  https://기존주소/fortune/"
fi

sleep 1
curl -fsS http://127.0.0.1:3000/api/health && echo
echo "✅ 완료."
[ -n "$DOMAIN" ] && echo "   HTTPS: sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
exit 0
