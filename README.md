# 지원사업 이음 AI

> 공공데이터와 AI로 **우리 회사가 받을 수 있는 고용지원사업**을 진단하고, **근로계약 조건을 1차 점검**하는 웹 서비스 (MVP)

- **배포 URL**: https://(배포 후 입력).vercel.app
- **서비스 기획서**: [docs/service-plan.md](docs/service-plan.md)
- **스크린샷**: [docs/screenshots/](docs/screenshots/)

## 1. 서비스 소개

중소기업은 고용지원사업이 수십 개라 "우리가 대상인지"부터 판단하기 어렵고, 한 사업에 참여한 뒤 이어서 받을 수 있는 사업을 놓치기 쉽습니다. 이 서비스는 다음 세 가지를 제공합니다.

| 메뉴 | 기능 | AI 사용 |
|---|---|---|
| **AI 기업 진단** | 업종·규모·계획 입력 → 공공데이터에서 후보 선별 → AI가 맞춤 추천과 **연계 로드맵** 작성 | ✅ |
| **지원사업 찾기** | 행정안전부 공공서비스(혜택) 정보에서 사업주 대상 사업 검색 | – |
| **근로계약 점검** | 근로조건 입력 → 규칙 엔진이 최저임금·근로시간·휴게 점검 → AI가 쉬운 설명 | ✅ |
| 홈 / 서비스 안내 | 서비스 소개, 동작 방식, FAQ, 데이터 출처, 연동 상태 | – |

**설계 원칙: "AI는 정리와 설명, 판단은 규칙과 사람"**
- AI는 서버가 넘긴 공공데이터 후보 안에서만 추천합니다. 목록에 없는 사업을 답하면 서버가 **자동으로 제거**합니다.
- 사업명·링크는 AI가 쓴 글이 아니라 **공공데이터 원본**으로 표시합니다.
- 최저임금 환산 같은 **숫자 계산은 코드**가 하고, AI는 결과를 설명만 합니다.

## 2. 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프론트엔드 | HTML, CSS, JavaScript (프레임워크 없음), Pretendard 웹폰트 |
| 백엔드 | Vercel Serverless Functions (Python 3, 표준 라이브러리만 사용) |
| AI | Claude API 또는 Google Gemini API (환경 변수로 선택) |
| 공공데이터 | 행정안전부_대한민국 공공서비스(혜택) 정보 (공공데이터포털 data.go.kr) |
| 배포 | GitHub + Vercel |

## 3. 폴더 구조

```
├─ index.html            # 화면 (섹션 5개, 해시(#) 메뉴 이동)
├─ css/style.css         # 디자인, 반응형(900px·720px), 다크 모드
├─ js/app.js             # 메뉴 이동, 입력 검증, fetch 호출, 결과 표시, 실패 안내
├─ images/favicon.svg
├─ api/                  # 백엔드: 파일 1개 = 함수 1개 (Vercel이 /api/파일명 주소로 실행)
│  ├─ diagnose.py        # POST /api/diagnose  AI 기업 진단
│  ├─ check.py           # POST /api/check     근로계약 점검
│  ├─ programs.py        # GET  /api/programs  지원사업 목록(공공데이터)
│  └─ health.py          # GET  /api/health    연동 상태(키 설정 여부만)
├─ core/                 # 함수들이 함께 쓰는 공용 모듈 (함수로 실행되지 않음)
│  ├─ ai.py              # AI 호출 (Claude/Gemini)
│  ├─ publicdata.py      # 공공데이터 호출·캐시·후보 선별
│  ├─ labor.py           # 근로조건 규칙 엔진
│  ├─ common.py          # JSON 처리, 오류, 요청 제한
│  └─ sample.py          # 공공데이터 미연결 시 예시 데이터
├─ tests/test_api.py     # 핵심 로직 테스트
├─ dev_server.py         # 로컬 실행용 서버 (Vercel CLI 없이)
├─ requirements.txt      # 파이썬 패키지 (표준 라이브러리만 써서 비어 있음)
├─ vercel.json           # 함수 실행 시간, 함께 묶을 파일(core/) 등 배포 설정
└─ .env.example          # 환경 변수 이름 예시 (실제 키는 넣지 않음)
```

## 4. 환경 변수(키) 설정

API 키는 **코드·README·스크린샷에 절대 넣지 않고** 환경 변수로만 관리합니다.

| 이름 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | 둘 중 하나 | [Google AI Studio](https://aistudio.google.com/apikey)에서 발급 (무료 사용 구간 있음) |
| `ANTHROPIC_API_KEY` | 둘 중 하나 | [Claude Console](https://console.anthropic.com/settings/keys)에서 발급 (유료). 둘 다 있으면 Claude 우선 |
| `AI_MODEL` | 선택 | 모델 바꾸기. 기본값 Claude `claude-haiku-4-5-20251001`, Gemini `gemini-flash-latest` |
| `DATA_GO_KR_KEY` | 선택 | 공공데이터포털 일반 인증키(Decoding). 없으면 내장 예시 데이터로 동작 |

- **로컬**: `.env.example`을 복사해 `.env`를 만들고 값을 채웁니다. `.env`는 `.gitignore`에 있어 GitHub에 올라가지 않습니다.
- **Vercel**: Project → Settings → Environment Variables에 같은 이름으로 등록한 뒤 **재배포**합니다.
- **키가 유출됐다면**: 즉시 발급처에서 키를 폐기·재발급하고 Vercel 값을 바꾼 뒤 재배포합니다. 커밋에 키가 올라갔다면 해당 커밋 이력도 정리합니다.

## 5. 실행 방법

### 로컬 실행
```bash
python dev_server.py          # http://127.0.0.1:3000
python -m pytest tests        # 테스트 (pytest 설치 필요: pip install pytest)
```
`dev_server.py`는 Vercel과 같은 방식으로 `/api/이름` 요청을 `api/이름.py`의 `handler`에 넘겨 줍니다. (Vercel CLI가 있다면 `vercel dev`도 사용 가능)

### 배포 (GitHub + Vercel)
1. 이 저장소를 GitHub에 올립니다.
2. [vercel.com](https://vercel.com) → Add New → Project → GitHub 저장소 선택 → Import
3. Framework Preset은 **Other** 그대로, Environment Variables에 위 키 등록 → Deploy
4. 배포 후 `https://(주소)/api/health`에서 `"ai": "gemini"` 또는 `"claude"`가 나오면 연동 완료
5. 코드를 고쳐 GitHub에 push하면 Vercel이 자동으로 재배포합니다.

## 6. 동작 흐름 (fetch → 서버 함수 → AI → 화면)

```
[사용자 입력] → js/app.js 가 빈 값 검사
     → fetch('/api/diagnose', {method:'POST', body: JSON})
     → Vercel이 api/diagnose.py 의 handler 실행 (서버에서만 API 키 사용)
          ① 공공데이터 API에서 사업주 대상 사업 조회 (6시간 캐시)
          ② 입력한 계획과 관련 있는 후보 12개를 규칙으로 선별
          ③ AI에게 "후보 목록 안에서만" 추천·로드맵 작성 요청
          ④ 후보에 없는 사업 제거, 사업명·링크는 원본으로 교체
     → JSON 응답 → app.js 가 결과 카드로 표시
```
API 키는 서버(Vercel 함수)에서만 쓰이므로 브라우저 개발자 도구로도 볼 수 없습니다.

## 7. 실패 처리

| 상황 | 사용자에게 보이는 안내 |
|---|---|
| 빈 입력(필수값 누락) | "필수값을 입력하세요: 업종, 상시근로자 수 …" + 해당 칸 빨간 표시 (서버도 400으로 한 번 더 검사) |
| AI API 오류(4xx/5xx) | "AI 서비스 오류가 발생했습니다. 잠시 후 다시 시도하세요. (오류 코드 502)" |
| 지연(8초 이상) | "AI 응답이 평소보다 늦어지고 있어요. 조금만 기다려 주세요" |
| 시간 초과 | 서버 25초 / 브라우저 45초 초과 시 "응답 시간이 초과되었습니다" |
| AI 키 미설정 | "AI 기능이 아직 설정되지 않았습니다" (근로계약 점검은 규칙 결과는 그대로 표시) |
| 요청 과다·긴 입력 | 1분 10회 초과 시 429 안내, 20KB 초과 입력은 413 안내 |
| 공공데이터 실패 | 내장 예시 데이터로 자동 전환하고 화면에 "예시 데이터" 표시 |

## 8. 한계와 다음 단계
- 진단은 참고용 1차 안내이며 실제 자격·금액은 소관기관이 확정합니다.
- 요청 제한은 서버 인스턴스별 메모리 방식이라 완벽하지 않습니다.
- 다음 단계: 근로자 자격 셀프체크, 계약서 사진 인식, 고용24 OpenAPI(채용정보·임금체불 명단공개 사업주 여부) 연동.

## 9. 데이터 출처
- 행정안전부_대한민국 공공서비스(혜택) 정보 — 공공데이터포털 (출처 표시: 행정안전부)
- 최저임금: 고용노동부 고시 (2024년 9,860원 / 2025년 10,030원 / 2026년 10,320원)
