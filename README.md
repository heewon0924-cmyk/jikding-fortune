# 🔮 오늘의 직딩 운세 뽑기

버튼을 누르면 AI가 직장인 공감 운세 한두 줄과 B급 캐릭터 그림을 만들어 카드로 보여 주는 모바일 웹앱입니다.
빌드 과정이 없습니다. `server.js` 하나와 `public/index.html` 하나로 돌아갑니다.

```
jikding-fortune/
├── server.js                      Express 백엔드 (Gemini 텍스트 + Imagen/Gemini 이미지, API 키 은닉)
├── public/index.html              모바일 프론트엔드 (Vanilla JS, CSS 내장)
├── .env.example                   환경 변수 예시
├── deploy/
│   ├── setup-server.sh            서버 최초 1회 설정 (Node, Nginx, systemd, clone)
│   ├── deploy.sh                  새 버전 배포 (pull → npm ci → 재시작 → 헬스 체크, 실패 시 롤백)
│   ├── jikding-fortune.service    systemd 템플릿
│   └── nginx-fortune.conf         Nginx 리버스 프록시 템플릿
```

## 먼저 알아 둘 것: 무료 티어와 모델

명세에 적힌 모델 두 개는 그대로 쓸 수 없어서 기본값을 바꿨습니다.

| 용도 | 명세 | 실제 기본값 | 이유 |
|---|---|---|---|
| 운세 텍스트 | `gemini-1.5-flash` | `gemini-2.5-flash` | 1.5 계열은 서비스가 종료됐습니다. 2.5 Flash에도 무료 티어가 있습니다. |
| 이미지 | Imagen 3 | `imagen-3.0-generate-002` (설정 가능) | Imagen API는 **결제 계정에서만** 호출됩니다. 무료 키로는 거절됩니다. |

그래서 서버는 이렇게 동작합니다.

- **텍스트**는 무료 키로 Gemini를 호출합니다.
- **이미지**는 설정한 모델(`IMAGE_MODEL`)로 시도합니다. 결제가 안 된 키라서 거절되거나 한도를 넘거나 시간이 초과되면, 운세 분위기에 맞춘 **내장 SVG 캐릭터**로 바로 대체합니다. 앱이 멈추거나 에러 화면이 뜨는 일은 없습니다.
- 돈이 나갈 일을 아예 없애려면 `IMAGE_ENABLED=false`로 두면 됩니다. 텍스트만 AI가 쓰고 그림은 항상 내장 캐릭터로 나옵니다.
- 결제를 연결했다면 `IMAGE_MODEL`을 `imagen-3.0-generate-002`, `imagen-4.0-generate-001`, `gemini-2.5-flash-image` 중에서 고르면 됩니다. `imagen-*`은 `:predict`로, 그 밖의 모델은 `:generateContent`로 서버가 알아서 호출합니다.
- `GEMINI_API_KEY`를 비워 두면 내장 문구 8종과 내장 그림으로 동작하는 **데모 모드**가 됩니다. UI 확인용으로 쓰면 됩니다.

> 무료 티어의 한도와 지원 모델은 Google이 자주 바꿉니다. 키를 넣은 뒤 아래 **확인** 절차로 실제 동작을 한 번 보세요.

무료 한도를 지키는 장치도 넣어 두었습니다(`.env`에서 조정합니다).
- IP 하나당 분당 `RATE_LIMIT_PER_MIN`회(기본 6회)
- 서버 전체 하루 텍스트 `DAILY_TEXT_LIMIT`회, 이미지 `DAILY_IMAGE_LIMIT`회. 한도를 넘으면 내장 콘텐츠로 응답합니다.

## 프롬프트 룰 (server.js에 들어 있음)

- **운세**(`buildFortunePrompt`): 시니컬하지만 귀여운 직장인 유머로 씁니다. 월요병, 커피, 빌드 오류, 칼퇴 실패 같은 키워드를 쓰고, 2문장을 넘기지 않습니다. 응답은 JSON 스키마로 강제하며 운세, 제목, 지수 2개, 행운 아이템, 기분(mood), 영어 장면 묘사를 받습니다.
- **이미지**(`buildImagePrompt`): 스타일은 `"Cute 2D cartoon sticker illustration, clean vector style, humorous character"`로 고정합니다. 글자, 숫자, 말풍선, 로고를 금지해서 캐릭터의 표정과 상황 묘사에만 집중하게 합니다.

## 로컬 실행

```bash
git clone git@github.com:heewon0924-cmyk/jikding-fortune.git
cd jikding-fortune
cp .env.example .env      # GEMINI_API_KEY 입력 (https://aistudio.google.com/apikey)
npm install
npm start                 # http://127.0.0.1:3000
```

휴대폰으로 같은 와이파이에서 테스트하려면 `.env`에 `HOST=0.0.0.0`을 넣고 `http://<PC IP>:3000`으로 접속하세요.

## 클라우드 서버 배포

모든 것은 내 클라우드 서버 안에서 돌아갑니다. 서버에는 이 저장소가 내 계정으로 clone되어 있습니다. 아래 예시는 `~/jikding-fortune`이지만, 다른 경로에 두어도 스크립트가 자기 위치를 기준으로 동작합니다. systemd가 앱을 띄우고, Nginx가 80/443 요청을 받아 앱으로 넘깁니다.
코드를 고쳐 GitHub에 push한 뒤 서버에서 `deploy.sh`를 한 번 실행하면 새 버전이 반영됩니다.

```
[폰 브라우저] ─HTTPS─▶ Nginx :443 ─▶ node server.js 127.0.0.1:3000 ─▶ Google AI API

[PC] git push ─▶ GitHub ◀─ git pull ─ [서버] sudo deploy.sh (pull · npm ci · restart · health check)
```

### 1. 서버가 저장소를 읽을 수 있게 하기 (private 저장소라서 필요)

내 계정(예: `ubuntu`)으로 키를 만들고, 공개키를 GitHub 저장소 **Settings → Deploy keys**에 **읽기 전용**으로 등록합니다. sudo는 쓰지 않습니다.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/jikding_deploy
printf 'Host github.com\n  IdentityFile ~/.ssh/jikding_deploy\n' >> ~/.ssh/config
cat ~/.ssh/jikding_deploy.pub         # 이 내용을 Deploy keys 에 붙여넣기
ssh -T git@github.com                 # "successfully authenticated" 확인
```

### 2. 최초 설정 (한 번만)

```bash
git clone git@github.com:heewon0924-cmyk/jikding-fortune.git ~/jikding-fortune   # sudo 없이
sudo bash ~/jikding-fortune/deploy/setup-server.sh
nano ~/jikding-fortune/.env           # GEMINI_API_KEY 입력
sudo systemctl restart jikding-fortune
```

앱은 **저장소 주인 계정**(여기서는 `ubuntu`)으로 실행됩니다. 그래서 따로 권한을 고칠 일이 없습니다.

`setup-server.sh`는 앱을 `127.0.0.1:3000`에 띄우는 것까지 합니다.
- Node 20과 Nginx는 **없을 때만** 설치합니다.
- `.env`를 만듭니다.
- systemd 서비스를 등록합니다.

`DOMAIN`을 주지 않으면 Nginx 설정은 건드리지 않습니다.

### 3. Nginx에 연결하기

이미 다른 사이트(예: 폭풍을 부르는 섬)를 서비스하고 있다면 Nginx를 다시 설치할 필요가 없습니다. 둘 중 하나를 고르세요.

**A. 기존 주소 아래 `/fortune/`으로 붙이기 (도메인 추가 없음, 인증서 그대로)**

기존 사이트 설정(`/etc/nginx/sites-available/island` 등)의 `server { }` 블록 안, `location / {` 위에
`deploy/nginx-fortune-location.conf`의 내용을 붙여 넣습니다.

```bash
sudo nano /etc/nginx/sites-available/island     # 붙여 넣기
sudo nginx -t && sudo systemctl reload nginx
# → https://기존주소/fortune/
```

certbot이 만든 `listen 443` 블록이 따로 있다면, 그 블록 안에 붙여 넣어야 HTTPS에서 열립니다.

**B. 서브도메인으로 따로 띄우기 (예: `fortune.내도메인`)**

DNS에 서브도메인 A 레코드를 서버 IP로 추가한 다음 실행합니다.

```bash
sudo DOMAIN=fortune.내도메인 bash ~/jikding-fortune/deploy/setup-server.sh
sudo certbot --nginx -d fortune.내도메인          # certbot 은 기존 사이트 때 이미 설치됨
```

**방화벽**: 기존 사이트가 이미 80/443을 열어 두었으니 추가로 열 포트는 없습니다. 3000 포트는 열지 마세요(앱은 127.0.0.1에서만 받습니다).
휴대폰의 클립보드 복사와 공유 창은 **HTTPS에서만** 확실하게 동작합니다.

### 4. 업데이트 배포 / 운영 명령

```bash
sudo bash ~/jikding-fortune/deploy/deploy.sh   # 최신 main 배포 (헬스 체크 실패 시 직전 커밋으로 자동 롤백)
sudo journalctl -u jikding-fortune -f          # 로그
sudo systemctl restart jikding-fortune         # .env 바꾼 뒤
```

`.env`는 git에 올라가지 않고 서버에만 있습니다. 배포할 때도 건드리지 않습니다.

## 확인

```bash
curl -s https://기존주소/fortune/api/health      # B 방식이면 https://fortune.내도메인/api/health
# {"ok":true,"hasKey":true,"textModel":"gemini-2.5-flash","imageModel":"imagen-3.0-generate-002",...}

curl -s -X POST https://기존주소/fortune/api/fortune \
  -H 'content-type: application/json' -d '{}' | head -c 400
```

응답의 `textSource`와 `imageSource`가 `"ai"`면 AI가 만든 결과이고, `"fallback"`이면 내장 콘텐츠입니다. `notes`에 `image-quota-or-billing`이 찍혀 있으면 이미지 모델이 결제나 한도 문제로 거절한 것입니다. 이유는 `journalctl -u jikding-fortune`에 그대로 남습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/fortune` | body 없음 → `{ id, title, fortune, indices[{label,value}], luckyItem, mood, image(dataURL), textSource, imageSource }` |
| `GET` | `/api/fortune/:id` | 공유 링크용. 최근 `KEEP_RESULTS`개를 메모리에 보관합니다(재시작하면 사라짐). |
| `GET` | `/api/health` | 키 유무, 모델, 오늘 사용량 |

공유 버튼은 운세 텍스트와 `https://도메인/?id=...` 링크를 함께 복사합니다. 링크를 연 사람은 같은 결과 카드를 보고, 다시 뽑기로 자기 운세를 뽑을 수 있습니다.
