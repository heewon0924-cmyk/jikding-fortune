#!/usr/bin/env bash
# 서버 최초 1회 설정 (Ubuntu/Debian). 저장소를 내 계정으로 clone 한 뒤 sudo 로 실행.
#
#   git clone git@github.com:heewon0924-cmyk/malgeumi.git ~/malgeumi   (키 별칭을 쓰면 github-별칭:heewon0924-cmyk/malgeumi.git)
#   sudo bash ~/malgeumi/deploy/setup-server.sh                 # 기존 사이트에 /fortune/ 로 붙일 때
#   sudo DOMAIN=fortune.example.com bash ~/malgeumi/deploy/setup-server.sh   # 새 (서브)도메인일 때
#
# 앱은 저장소 주인 계정(예: ubuntu)으로 실행된다. 그래서 권한을 따로 고칠 일이 없다.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # 기본: 이 스크립트가 들어 있는 저장소
APP_USER="${APP_USER:-$(stat -c %U "$APP_DIR")}"           # 기본: 저장소 주인
DOMAIN="${DOMAIN:-}"

[ "$(id -u)" -eq 0 ] || { echo "sudo 로 실행하세요: sudo bash $0"; exit 1; }
[ -d "$APP_DIR/.git" ] || { echo "$APP_DIR 가 git 저장소가 아닙니다. 먼저 git clone 하세요."; exit 1; }
if [ "$APP_USER" = root ]; then
  echo "저장소가 root 소유입니다. 내 계정으로 바꾼 뒤 다시 실행하세요:"
  echo "  sudo chown -R \$USER:\$USER $APP_DIR"
  exit 1
fi
as_app() { sudo -u "$APP_USER" -H "$@"; }

echo "▶ 패키지 설치 (없는 것만)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx
echo "  node $(node -v), $(nginx -v 2>&1)"

echo "▶ 앱 준비 ($APP_DIR, 실행 계정: $APP_USER)"
cd "$APP_DIR"
if [ ! -f .env ]; then
  as_app cp .env.example .env
  echo "  ⚠ .env 를 만들었습니다. GEMINI_API_KEY 를 넣고 'sudo systemctl restart malgeumi' 하세요."
fi
chmod 600 .env
as_app npm ci --omit=dev

echo "▶ systemd"
# 예전 이름(jikding-fortune)으로 등록된 서비스가 있으면 정리한다
if [ -e /etc/systemd/system/jikding-fortune.service ]; then
  echo "  예전 서비스 jikding-fortune 을 멈추고 지웁니다"
  systemctl disable --now jikding-fortune || true
  rm -f /etc/systemd/system/jikding-fortune.service
fi
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__APP_USER__#$APP_USER#g" -e "s#__NODE__#$(command -v node)#g" \
  deploy/malgeumi.service > /etc/systemd/system/malgeumi.service
systemctl daemon-reload
systemctl enable malgeumi
systemctl restart malgeumi

echo "▶ Nginx"
if [ -n "$DOMAIN" ]; then
  if [ -e /etc/nginx/sites-available/malgeumi ]; then
    echo "  /etc/nginx/sites-available/malgeumi 이 이미 있어 그대로 둡니다."
  else
    sed "s#__DOMAIN__#$DOMAIN#g" deploy/nginx-fortune.conf > /etc/nginx/sites-available/malgeumi
    ln -sf /etc/nginx/sites-available/malgeumi /etc/nginx/sites-enabled/malgeumi
  fi
  nginx -t && systemctl reload nginx
else
  echo "  DOMAIN 이 없어 Nginx 설정은 건드리지 않았습니다."
  echo "  기존 사이트의 server { } 안에 $APP_DIR/deploy/nginx-fortune-location.conf 내용을 붙여 넣고"
  echo "  sudo nginx -t && sudo systemctl reload nginx  →  https://기존주소/fortune/"
fi

for _ in $(seq 1 10); do
  curl -fsS http://127.0.0.1:3000/api/health && echo && break
  sleep 1
done || true
echo "✅ 완료."
[ -n "$DOMAIN" ] && echo "   HTTPS: sudo certbot --nginx -d $DOMAIN"
exit 0
