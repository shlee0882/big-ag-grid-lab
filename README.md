# Big AG Grid Lab

대용량 데이터 환경에서 **AG Grid 기반 관리자 리스트 화면**을 설계하고,  
필터·정렬·페이징 전략에 따른 **성능 병목을 실험으로 검증**한 프로젝트입니다.

단순 구현이 아니라,  
**어디서 느려지는지 → 왜 그런지 → 어떤 선택을 했는지**를  
수치와 실험 결과를 테스트하는 것을 목표로 했습니다.

실무에서 자주 마주치는 그리드 기반 관리 화면을 실제 서비스 환경과 유사하게 구성하는 것을 목표로 했습니다.

---

## 🔧 Tech Stack

### Frontend
- React
- AG Grid (Community)
- TypeScript
- AbortController
- Debounce

### Backend
- Node.js
- Express
- SQLite

---

## 📌 핵심 목표

- 대용량(50만 건) 데이터에서 **관리자 리스트 화면의 성능 특성 이해**
- COUNT, OFFSET, Cursor 페이징의 **실제 비용을 수치로 검증**
- 운영 환경에서 발생하는 **요청 경합(race condition)** 해결
- UX와 성능 사이의 **의사결정 기준 명확화**

---

## 🧱 전체 아키텍처

```
[ AG Grid ]
    ↓ (page / sort / search / status)
[ API Server ]
    ↓ (WHERE / ORDER BY / LIMIT / OFFSET)
[ SQLite ]
```

- 필터/정렬/페이징은 **프론트 가공이 아닌 DB 쿼리로 처리**
- 서버는 단순 중계가 아니라 **병목 제거를 위한 판단 지점**으로 동작

---

## 🔍 구현 기능 요약

- 서버 사이드 페이징 / 정렬 / 검색
- COUNT(*) 캐시 (TTL 기반)
- OFFSET 기반 페이징
- Cursor 기반 페이징 (비교 실험용)
- 디바운스 기반 자동 검색 (검색 버튼 없음)
- AbortController를 이용한 요청 취소 + 최신 요청만 반영

---

## 🧪 성능 실험 & 결과

### 1️⃣ COUNT 병목 확인 → 캐시 적용

검색 조건이 포함될 경우 COUNT(*)가 병목이 되는 것을 확인함.

| Scenario | countTimeMs |
|--------|-------------|
| search=User 1 (cache miss) | ~164ms |
| search=User 1 (cache hit) | ~0ms |

**판단**
- totalCount는 UX 목적 값
- 실시간 정확성보다 **리스트 반응 속도가 중요**

👉 동일 조건에 대해 **서버 메모리 캐시(TTL 30s)** 적용

---

### 2️⃣ OFFSET 기반 페이징의 한계

pageSize=100 기준, deep page로 갈수록 OFFSET 비용이 급증함을 확인함.

| page | offset | queryTimeMs |
|-----:|-------:|------------:|
| 1000 | 99,900 | 11ms |
| 2000 | 199,900 | 21ms |
| 3000 | 299,900 | 275ms |
| 4000 | 399,900 | 284ms |

**해석**
- OFFSET이 커질수록 DB는 앞의 row를 스캔하고 버리는 비용 증가
- 약 30만 offset 이후부터 급격한 성능 저하 발생

---

### 3️⃣ Cursor 페이징 비교 실험

createdAt + id 기반 Cursor 페이징 엔드포인트 추가:

/api/users-cursor?pageSize=100
/api/users-cursor?cursorCreatedAt=...&cursorId=...

| pageSize | queryTimeMs |
|---------:|------------:|
| 100 | ~1ms |
| 2000 | ~10ms |
| 4000 | ~10ms |

**결론**
- Cursor 방식은 deep page 개념이 없어 **응답 시간이 일정**
- 연속 스크롤/로그/피드형 화면에 적합

---

## ⚖️ OFFSET vs Cursor 의사결정

| 항목 | OFFSET | Cursor |
|---|---|---|
| 페이지 점프 | 가능 | 불가 |
| deep page 성능 | ❌ | ✅ |
| UX | 관리자 화면에 적합 | 피드/로그에 적합 |

> 화면 성격에 따라 페이징 전략을 선택해야 함을 실험으로 확인

---

## 🚦 요청 경합(race condition) 해결

### 문제
- 검색어를 빠르게 변경하면 요청이 겹쳐 도착
- 늦게 도착한 응답이 최신 결과를 덮어쓰는 현상 발생

### 해결
- **Debounce(350ms)**: 입력이 멈춘 시점에만 요청
- **AbortController**: 이전 요청 취소
- **요청 ID 비교**: 최신 요청만 화면 반영

```ts
if (myReqId !== reqIdRef.current) return;
```

👉 검색어 연타 시에도 항상 마지막 입력 결과만 표시

---

### 🧠 주요 의사결정 정리

- 필터/정렬/페이징은 DB 쿼리로 위임
- COUNT는 캐시 대상으로 판단
- OFFSET 한계를 수치로 확인 후 Cursor 비교 실험
- UX 안정성을 위해 요청 취소 + 디바운스 적용
---
## 📁 프로젝트 구조 - 모노 레포
```text
root
├─ api/        # 백엔드 API (SQLite 기반)
    ├─ src
    │   ├─ index.js
    │   ├─ seed.js
└─ web/        # 프론트엔드 (AG Grid 기반 UI)
    ├─ src
    │   ├─ App.tsx
    │   └─ components
```
---
## 🚀 실행 방법
```text
# API
cd api
node src/seed.js
npm run dev

# WEB
cd web
npm run dev
```
---
## ✍️ 마무리

- 이 프로젝트는 AG Grid를 사용해 
대용량 리스트에서 어떤 지점이 느려지고 왜 그런지 이해하며
어떤 선택을 했는지 테스트를 기록, 증명하기 위한 프로젝트입니다.
---

## 🚀 Deployment Environment

본 프로젝트는 **Frontend / Backend 분리 배포 구조**로 구성되어 있으며,  
실제 서비스 운영 환경을 가정한 배포 흐름을 검증하는 것을 목표로 함.

### Frontend
- **Platform**: Vercel
- **Deployment Type**: Production / Preview 환경 분리
- **CI/CD**: GitHub Repository 연동
  - `main` 브랜치 기준 Production 자동 배포
  - Commit / PR 단위 Preview 배포
- **URL**
  - https://big-ag-grid-lab.vercel.app/

### Backend
- **Platform**: Render
- **Runtime**: Node.js
- **Database**: SQLite
- **Deployment Type**: 단일 API 서버
- **CI/CD**: GitHub 연동 자동 배포
- **URL**
  - https://big-ag-grid-lab.onrender.com/api/users

> ⚠️ **Render Free Tier 사용 안내**  
> Backend는 Render 무료 플랜을 사용하고 있으며,  
> 일정 시간 요청이 없을 경우 서버가 sleep 상태로 전환될 수 있음.  
> 최초 요청 시 지연이 발생할 수 있으나, 재요청 시 정상적으로 동작함.
