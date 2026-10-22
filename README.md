# 🔮 오늘의 운세 뽑기

버튼을 누르면 B급 캐릭터 그림 한 장과, 그 그림에 맞춰 AI가 쓴 가볍고 재치 있는 운세 한두 줄을 카드로 보여 주는 모바일 웹앱입니다.
빌드 과정이 없습니다. `server.js` 하나와 `public/index.html` 하나로 돌아갑니다.

```
malgeumi/
├── server.js                      Express 백엔드 (그림 고르기 + Gemini 운세, API 키 은닉)
├── public/index.html              모바일 프론트엔드 (Vanilla JS, CSS 내장)
├── public/img/                    캐릭터 그림 (scenes.json 의 id 와 같은 파일 이름)
├── scenes/
│   ├── scenes.json                그림 장면 40개 (주제 8개 × 5, 기분, 한국어 설명, 영어 프롬프트)
│   ├── PROMPTS.md                 Gemini 앱에 붙여 넣을 프롬프트 모음 (make-prompts.js 가 만듦)
│   └── make-prompts.js            scenes.json → PROMPTS.md
├── .env.example                   환경 변수 예시
├── deploy/
│   ├── setup-server.sh            서버 최초 1회 설정 (Node, Nginx, systemd, clone)
│   ├── deploy.sh                  새 버전 배포 (pull → npm ci → 재시작 → 헬스 체크, 실패 시 롤백)
│   ├── malgeumi.service    systemd 템플릿
│   ├── nginx-malgeumi.conf        말그미 사이트 템플릿 (/fortune/ → 앱)
│   └── nginx-fortune-location.conf  다른 사이트에 /fortune/ 만 붙일 때 쓰는 조각
```

## 동작 방식과 비용

1. 버튼을 누르면 서버가 `public/img/`에 있는 그림 중 하나를 고릅니다. 최근에 나온 그림은 피합니다.
2. 그 그림의 장면 설명(`scenes.json`의 `ko`)을 함께 보내서, Gemini가 **그 그림에 맞는** 운세를 씁니다.
3. 그림과 운세를 카드로 보여 줍니다.

**비용은 0원입니다.**
- **운세 문구**: `gemini-2.5-flash` 무료 티어를 씁니다. 명세의 `gemini-1.5-flash`는 서비스가 종료돼서 바꿨습니다. 결제 계정이 연결되지 않은 프로젝트의 키를 쓰면 요금이 나가지 않고, 한도를 넘으면 요청이 거절될 뿐입니다.
- **그림**: API로 만들지 않습니다. Gemini 앱에서 미리 만들어 넣어 둡니다(아래 **그림 넣기**). Imagen API는 결제 계정 전용이라 쓰지 않습니다.

**실패해도 멈추지 않습니다.**
- 키가 없거나, Gemini가 실패하거나, 하루 한도를 넘으면 **그림 주제에 맞춘 내장 문구**로 응답합니다. 그래서 그림과 문구가 어긋나지 않습니다.
- 그림이 하나도 없으면 기분별 **내장 SVG 캐릭터**를 보여 줍니다.

**무료 한도를 지키는 장치** (`.env`에서 조정)
- IP 하나당 분당 `RATE_LIMIT_PER_MIN`회(기본 6회)
- 서버 전체 하루 Gemini 호출 `DAILY_TEXT_LIMIT`회(기본 200회)

## 그림 넣기

1. [`scenes/PROMPTS.md`](scenes/PROMPTS.md)의 프롬프트를 하나씩 Gemini 앱에 붙여 넣어 그림을 만듭니다.
2. 마음에 드는 그림을 **적힌 이름 그대로** 저장합니다. 예: `coffee-01.png`. 확장자는 png·jpg·webp 모두 됩니다.
3. 저장한 그림을 저장소의 `public/img/`에 올립니다. GitHub 웹에서 `public/img` 폴더로 들어가 **Add file → Upload files**를 쓰면 됩니다.
4. 서버에서 `sudo bash ~/malgeumi/deploy/deploy.sh`를 실행합니다.

40장을 다 채우지 않아도 됩니다. 올린 그림만으로 동작하고, 새 그림은 1분 안에 반영됩니다.
장면을 바꾸거나 추가하려면 `scenes/scenes.json`을 고친 뒤 `node scenes/make-prompts.js`로 `PROMPTS.md`를 다시 만듭니다.

## 프롬프트 룰 (server.js의 `buildFortunePrompt`)

- 가볍고 재치 있는 일상 운세로 씁니다. 돈, 연애, 건강, 사람 관계, 사소한 행운, 휴식, 먹을 것이 소재이고, 일·공부 이야기는 가끔만 섞습니다. 2문장을 넘기지 않습니다.
- 고른 그림의 장면을 알려 주고, 그 상황을 읽는 사람의 하루로 바꿔 쓰게 합니다.
- 응답은 JSON 스키마로 강제합니다. 운세, 제목, 분야별 운(금전·연애·건강·대인) 점수, 행운의 아이템·색·숫자, 한 줄 조언을 받습니다.
- 그림 프롬프트(`scenes.json`의 `style`)는 `"Cute 2D cartoon sticker illustration, clean vector style, humorous character"`로 고정합니다. 글자, 숫자, 말풍선을 금지해서 표정과 상황 묘사에만 집중하게 합니다.

## 로컬 실행

```bash
git clone git@github.com:heewon0924-cmyk/malgeumi.git
cd malgeumi
cp .env.example .env      # GEMINI_API_KEY 입력 (https://aistudio.google.com/apikey)
npm install
npm start                 # http://127.0.0.1:3000
```

휴대폰으로 같은 와이파이에서 테스트하려면 `.env`에 `HOST=0.0.0.0`을 넣고 `http://<PC IP>:3000`으로 접속하세요.

## 클라우드 서버 배포

모든 것은 내 클라우드 서버 안에서 돌아갑니다. 서버에는 이 저장소가 내 계정으로 clone되어 있습니다. 아래 예시는 `~/malgeumi`이지만, 다른 경로에 두어도 스크립트가 자기 위치를 기준으로 동작합니다. systemd가 앱을 띄우고, Nginx가 80/443 요청을 받아 앱으로 넘깁니다.
코드를 고쳐 GitHub에 push한 뒤 서버에서 `deploy.sh`를 한 번 실행하면 새 버전이 반영됩니다.

```
[폰 브라우저] ─HTTPS─▶ Nginx :443 ─▶ node server.js 127.0.0.1:3000 ─▶ Google AI API

[PC] git push ─▶ GitHub ◀─ git pull ─ [서버] sudo deploy.sh (pull · npm ci · restart · health check)
```

### 1. 서버가 저장소를 읽을 수 있게 하기 (private 저장소라서 필요)

내 계정(예: `ubuntu`)으로 키를 만들고, 공개키를 GitHub 저장소 **Settings → Deploy keys**에 **읽기 전용**으로 등록합니다. sudo는 쓰지 않습니다.
`github-malgeumi`라는 별칭을 따로 두면 이 서버에서 다른 GitHub 키를 쓰고 있어도 섞이지 않습니다.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/malgeumi_deploy -C "malgeumi-server"
cat >> ~/.ssh/config <<'EOF'

Host github-malgeumi
  HostName github.com
  User git
  IdentityFile ~/.ssh/malgeumi_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/malgeumi_deploy.pub        # 이 내용을 Deploy keys 에 붙여넣기
ssh -T github-malgeumi                # "successfully authenticated" 확인
```

### 2. 최초 설정 (한 번만)

```bash
git clone github-malgeumi:heewon0924-cmyk/malgeumi.git ~/malgeumi   # sudo 없이
sudo bash ~/malgeumi/deploy/setup-server.sh
nano ~/malgeumi/.env           # GEMINI_API_KEY 입력
sudo systemctl restart malgeumi
```

앱은 **저장소 주인 계정**(여기서는 `ubuntu`)으로 실행됩니다. 그래서 따로 권한을 고칠 일이 없습니다.

`setup-server.sh`는 앱을 `127.0.0.1:3000`에 띄우는 것까지 합니다.
- Node 20과 Nginx는 **없을 때만** 설치합니다.
- `.env`를 만듭니다.
- systemd 서비스를 등록합니다.

`DOMAIN`을 주지 않으면 Nginx 설정은 건드리지 않습니다.

### 3. 말그미 사이트 만들기 (Nginx)

기존 사이트(`sangdan`, `default`)는 그대로 두고 `malgeumi` 사이트를 새로 만듭니다. sslip.io를 쓰면 `malgeumi.161.33.130.92.sslip.io`처럼 IP 앞에 이름만 붙여도 이 서버로 연결되니, 도메인을 사거나 DNS를 설정할 필요가 없습니다.

```bash
sudo DOMAIN=malgeumi.161.33.130.92.sslip.io bash ~/malgeumi/deploy/setup-server.sh
sudo certbot --nginx -d malgeumi.161.33.130.92.sslip.io
# → https://malgeumi.161.33.130.92.sslip.io/fortune/
```

- `deploy/nginx-malgeumi.conf`가 `/etc/nginx/sites-available/malgeumi`로 설치됩니다. `/`는 `/fortune/`으로 보내고, `/fortune/`은 운세 앱(127.0.0.1:3000)으로 넘깁니다.
- 한 번 설치한 사이트 파일은 다시 실행해도 덮어쓰지 않습니다. certbot이 추가한 HTTPS 설정을 지키기 위해서입니다.
- 나중에 앱을 더 만들면 이 파일의 `server { }` 안에 `location /다른앱/`을 추가하면 됩니다.
- 이미 있는 다른 사이트 아래에 붙이고 싶다면, 그 사이트의 `server { }` 안에 `deploy/nginx-fortune-location.conf` 내용을 붙여 넣어도 됩니다.

**방화벽**: 80/443은 기존 사이트 때문에 이미 열려 있습니다. 3000 포트는 열지 마세요(앱은 127.0.0.1에서만 받습니다).
휴대폰의 클립보드 복사와 공유 창은 **HTTPS에서만** 확실하게 동작합니다.

### 4. 업데이트 배포 / 운영 명령

```bash
sudo bash ~/malgeumi/deploy/deploy.sh   # 최신 main 배포 (헬스 체크 실패 시 직전 커밋으로 자동 롤백)
sudo journalctl -u malgeumi -f          # 로그
sudo systemctl restart malgeumi         # .env 바꾼 뒤
```

`.env`는 git에 올라가지 않고 서버에만 있습니다. 배포할 때도 건드리지 않습니다.

## 확인

```bash
curl -s https://malgeumi.161.33.130.92.sslip.io/fortune/api/health
# {"ok":true,"hasKey":true,"textModel":"gemini-2.5-flash","scenes":"12/40",...}   ← 그림 12장이 들어가 있음

curl -s -X POST https://malgeumi.161.33.130.92.sslip.io/fortune/api/fortune \
  -H 'content-type: application/json' -d '{}' | head -c 400
```

- `textSource`가 `"ai"`면 Gemini가 쓴 운세이고, `"fallback"`이면 내장 문구입니다. 실패한 이유는 `journalctl -u malgeumi`에 남습니다.
- `imageSource`가 `"scene"`이면 미리 넣어 둔 그림이고, `"fallback"`이면 그림이 없어서 내장 SVG를 쓴 것입니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/fortune` | body 없음 → `{ id, title, fortune, indices[{label,value}], luckyItem, luckyColor, luckyNumber, advice, mood, image(그림 경로 또는 SVG dataURL), sceneId, textSource, imageSource }` |
| `GET` | `/api/fortune/:id` | 공유 링크용. 최근 `KEEP_RESULTS`개를 메모리에 보관합니다(재시작하면 사라짐). |
| `GET` | `/api/health` | 키 유무, 모델, 들어간 그림 수, 오늘 사용량 |

공유 버튼은 운세 텍스트와 `https://도메인/?id=...` 링크를 함께 복사합니다. 링크를 연 사람은 같은 결과 카드를 보고, 다시 뽑기로 자기 운세를 뽑을 수 있습니다.
