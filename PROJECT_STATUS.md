# 🎯 Chrome Audio Analyzer — Project Status & Progress Tracker

> **마지막 업데이트**: 2026-03-31  
> **전체 진행률**: █████████░ **~85%** (핵심 기능 구현 완료, 정밀도 최적화 & QA 진행 중)

---

## 📊 프로젝트 개요

| 항목 | 내용 |
|---|---|
| **프로젝트 명** | Audio Analyzer — BPM & Key Detector |
| **타입** | Chrome Extension (Manifest V3) |
| **타겟 유저** | DJ, 프로듀서, 음악 분석가 |
| **핵심 기능** | 브라우저 탭 오디오 실시간 BPM/Key 감지 |
| **타겟 장르** | Trap, Drill, Hip-Hop, House 등 |

---

## 🏗️ 아키텍처 & 파일 구조

```
audio-analyzer-extension/
├── manifest.json          ✅ MV3 설정 완료
├── background.js          ✅ Service Worker (tabCapture + offscreen 제어)
├── offscreen.html         ✅ Offscreen 문서 셸
├── offscreen.js           ✅ DSP 엔진 (688줄, 핵심 분석 로직)
├── content-script.js      ✅ YouTube 오버레이 토글 버튼
├── popup.html             ✅ 팝업 UI (Dark Mode)
├── popup.js               ✅ 팝업 상태 관리
├── lib/
│   └── meyda.min.js       ✅ Chroma 추출 라이브러리
├── icons/                 ✅ 16/48/128px 아이콘
├── DOCS/                  📄 설계 문서 (6개 카테고리)
└── .agents/               🤖 에이전트 시스템 (3명 + 4 워크플로우)
```

---

## ✅ 컴포넌트별 진행 상황

### 1. Extension Architecture (`@extension_architect`)
| 항목 | 상태 | 비고 |
|---|---|---|
| `manifest.json` MV3 설정 | ✅ 완료 | tabCapture, activeTab, offscreen 권한 |
| `background.js` Service Worker | ✅ 완료 | 메시지 라우팅, 생명주기 관리 |
| Offscreen Document 관리 | ✅ 완료 | 생성/삭제, 중복 방지 |
| TabCapture → Offscreen 스트림 전달 | ✅ 완료 | streamId 기반 |
| SPA 환경 URL/Title 변경 감지 | ✅ 완료 | `tabs.onUpdated` → `reset-analysis` |
| 탭 닫힘 시 자동 정리 | ✅ 완료 | `tabs.onRemoved` |
| `chrome.storage.session` 상태 영속화 | ❌ 미구현 | Service Worker 재시작 시 상태 유실 가능 |

### 2. DSP Engine (`@dsp_engineer`)
| 항목 | 상태 | 비고 |
|---|---|---|
| 오디오 캡처 & 패스스루 | ✅ 완료 | `<audio>` 엘리먼트로 사용자 소리 유지 |
| 3-채널 필터 분리 | ✅ 완료 | Raw(키), HP 200Hz(BPM), LP 100Hz(베이스 토닉) |
| Ring Buffer (5초 윈도우) | ✅ 완료 | `Float32Array` 순환 버퍼 |
| **BPM: Envelope Autocorrelation** | ✅ 완료 | Max-Pooling → Log Whitening → AC |
| BPM: Harmonic Comb Summation | ✅ 완료 | 1x/2x/0.5x/0.25x 배수 합산 |
| BPM: 옥타브 보정 (느린/빠른) | ✅ 완료 | doubleLag/halfLag 보정 |
| BPM: Tresillo 보정 | ✅ 완료 | 3:2 패턴 오탐 방지 |
| BPM: Parabolic Interpolation | ✅ 완료 | sub-bin 정밀도 |
| BPM: Median Filter (16회) | ✅ 완료 | 순간 스파이크 억제 |
| BPM: EMA Lag 안정화 | ✅ 완료 | 0.85/0.15 비율 |
| **Key: L2-Normalized Chroma Gating** | ✅ 완료 | Meyda chroma + HPCP 하드 게이팅 |
| Key: 5-Mode 프로파일 매칭 | ✅ 완료 | Major/Minor/Dorian/Mixolydian/Phrygian |
| Key: Bass Tonic Detection (F0 자기상관) | ✅ 완료 | LP 버퍼 → 피치 클래스 투표 |
| Key: 관계조 Disambiguation | ✅ 완료 | 베이스 투표 기반 2등 후보 비교 |
| Key: Stability Gate (3연속) | ✅ 완료 | 3회 연속 동일해야 stableKey 교체 |
| Key: EWMA 누적 평균 | ✅ 완료 | 전곡 누적으로 안정성 확보 |
| 곡 변경 시 누적 데이터 초기화 | ✅ 완료 | `resetAccumulators()` |

### 3. Frontend UI (`@frontend_developer`)
| 항목 | 상태 | 비고 |
|---|---|---|
| 팝업 UI (Dark Mode) | ✅ 완료 | 340px, 그라디언트 배경 |
| BPM/Key 카드 레이아웃 | ✅ 완료 | 2-column flex |
| 상태 인디케이터 (dot + text) | ✅ 완료 | analyzing/error/idle |
| Start/Stop 버튼 토글 | ✅ 완료 | |
| 팝업 Hydration (재오픈 시 복구) | ✅ 완료 | `get-status` 메시지 |
| Content Script 오버레이 버튼 | ✅ 완료 | YouTube 고정 위치 토글 |
| 2등 키(secondary key) 표시 | ✅ 완료 | key-secondary 필드 |
| BPM Pulse 애니메이션 | ⚠️ 제한적 | 카드 active 효과만, BPM 동기 바운스 없음 |
| 디자인 고급화 (네온/글래스모피즘) | ❌ 미구현 | UI_UX_GUIDELINES 대비 부족 |

### 4. 문서 & 에이전트 시스템
| 항목 | 상태 | 비고 |
|---|---|---|
| PRD | ✅ 완료 | 개요 + 유저 스토리 |
| UI/UX Guidelines | ✅ 완료 | 디자인 토큰 정의 |
| Code Conventions | ✅ 완료 | 성능/보안 규칙 |
| Algorithm Spec | ✅ 완료 | BPM/Key 파이프라인 명세 |
| System Handover | ✅ 완료 | 아키텍처 통신 플로우 |
| QA Test Scenarios | ✅ 완료 | BPM/Key 테스트 시나리오 + 회귀 체크리스트 |
| 에이전트 3명 설정 | ✅ 완료 | DSP, Architect, Frontend |
| 워크플로우 4개 | ✅ 완료 | dispatch/spec-gate/integrity-sync/cross-doc |

---

## 🔴 남은 작업 (TODO)

### 🎯 높은 우선 순위
- [x] **Key 감지 정확도 개선** — B Minor ↔ F# Major 등 관계조 오탐 이슈 (Phase 1 & 3 완료: EDMA/Shaath + Polyphony + CQT HPCP)
- [x] **BPM 안정성 강화** — 특정 Trap/Drill 트랙에서 불안정한 경우 존재 (Phase 1 완료: Buffer 10s + Mel Spectral Flux)
- [ ] **실제 트랙 테스트 & 벤치마크** — QA TEST_SCENARIOS.md 기반으로 체계적 검증 필요 (Node.js 테스트 파이프라인으로 기본 검증 완료)
- [x] **ScriptProcessor → AudioWorklet 마이그레이션** — ScriptProcessor는 deprecated, 성능/안정성 위해 전환 권장 (Phase 2 완료)

### 🟡 중간 우선 순위
- [x] **UI 고급화** — BPM 싱크 바운스 애니메이션 (적용 완료), 네온/글래스모피즘 효과는 제외하고 기존 테마 유지.
- [x] **`chrome.storage.session` 상태 영속화** — SW 재시작 시 분석 상태 복구 (적용 완료: 'active stream' 에러 해결)
- [ ] **다중 사이트 지원** — 현재 YouTube만 content_scripts 타겟. SoundCloud, Spotify Web 등
- [ ] **SECURITY_POLICY.md 문서 작성** — `DOCS/03_Engineering/` 에 아직 없음 (AGENT 참조하지만 파일 미존재)

### 🟢 낮은 우선 순위
- [ ] **옵션 페이지** — 사용자 설정 (BPM 범위, 분석 주기 등)
- [ ] **한/영 전환** — UI 텍스트 현재 한국어 + 영어 혼재
- [ ] **아이콘 리디자인** — 현재 아이콘 품질 미확인
- [ ] **Chrome Web Store 배포 준비** — 스크린샷, 설명문, 심사 대응

---

## 🤖 에이전트 시스템 요약

| 에이전트 | 담당 파일 | 참조 문서 |
|---|---|---|
| `@dsp_engineer` | `offscreen.js` | ALGORITHM_SPEC.md, CODE_CONVENTIONS.md |
| `@extension_architect` | `background.js`, `manifest.json` | SYSTEM_HANDOVER.md, SECURITY_POLICY.md (미작성) |
| `@frontend_developer` | `popup.html`, `popup.js` | UI_UX_GUIDELINES.md, PRD.md |

### 워크플로우
1. **agent-dispatch.md** — 작업에 맞는 에이전트 소환
2. **spec-gate.md** — 코딩 전 문서 존재 여부 확인
3. **integrity-sync.md** — 코드 수정 후 문서 동기화
4. **cross-doc-validation.md** — 문서 간 충돌 검증

---

## 📝 이전 대화 히스토리 (맥락)

| 날짜 | 주제 | 핵심 내용 |
|---|---|---|
| 03/23~24 | 초기 개발 | 전체 아키텍처 구축, MV3 설정, DSP 엔진 기초 |
| 03/25 오전 | DSP 최적화 | BPM/Key 정밀도 개선, Trap/Drill 특화 튜닝 |
| 03/25 오후 | Notion MCP 연동 | MCP 서버 설정, npx PATH 이슈 해결, 연결 확인 |
| 03/31 | DSP 프로 수준 고도화 | Phase 1 (EDMA+Mel Flux), Phase 2 (AudioWorklet), Phase 3 (CQT HPCP) 구현 완료 |

---

> 💡 **이 파일을 새 대화 시작 시 참조하면 전체 맥락을 즉시 파악할 수 있습니다.**  
> 작업 진행 시 해당 항목의 체크박스를 `[x]`로 업데이트하세요.
