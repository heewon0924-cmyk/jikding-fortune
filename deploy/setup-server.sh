#!/usr/bin/env bash
# 서버 최초 1회 설정 (Ubuntu/Debian). root 또는 sudo 로 실행.
#   sudo REPO_URL=git@github.com:heewon0924-cmyk/jikding-fortune.git DOMAIN=fortune.example.com bash setup-server.sh
set -euo pipefail

REPO_URL="${REPO_URL:?REPO_URL 을 지정하세요}"
DOMAIN="${DOMAIN:-_}"
APP_DIR="${APP_DIR:-/opt/jikding-fortune}"
APP_USER="${APP_USER:-fortune}"
BRANCH="${BRANCH:-main}"

echo "▶ 패키지 설치"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git nginx

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
sed "s#__DOMAIN__#$DOMAIN#g" deploy/nginx-fortune.conf > /etc/nginx/sites-available/jikding-fortune
ln -sf /etc/nginx/sites-available/jikding-fortune /etc/nginx/sites-enabled/jikding-fortune
nginx -t && systemctl reload nginx

sleep 1
curl -fsS http://127.0.0.1:3000/api/health && echo
echo "✅ 완료. HTTPS: sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
