# Chrome Audio Analyzer (Beat Lens) — Claude Code Project

## 프로젝트 개요
Chrome Extension (Manifest V3) — 브라우저 탭 오디오를 실시간 분석하여 BPM과 Key를 표시.
타겟: DJ, 프로듀서, 음악 분석가. 장르: Trap, Drill, Hip-Hop, House.

## 아키텍처
```
sidepanel.js (UI) → background.js (SW) → offscreen.js (DSP)
                                        → backend/ (FastAPI + Demucs)
```

## 에이전트 팀 구성 (6명)

| 에이전트 | 담당 파일 | 역할 |
|---|---|---|
| `@dsp-engineer` | offscreen.js, audio-worklet-processor.js | BPM/Key DSP 알고리즘 |
| `@extension-architect` | background.js, manifest.json, offscreen.html | MV3 인프라, 메시지 라우팅 |
| `@ui-designer` | sidepanel.*, popup.*, content-script.js | 시각 레이어 전체 |
| `@product-manager` | DOCS/ 전체 | 스펙 게이트키퍼, 문서 소유 |
| `@qa-debug` | DOCS/06_QA/, test/ | 회귀 테스트, 계층 간 버그 추적 |
| `@backend-engineer` | backend/ 전체 | FastAPI, Demucs 스템 분리 |

## 파일 소유권 규칙 (절대 준수)
- 각 에이전트는 자신의 담당 파일만 수정
- 타 에이전트 파일 수정 필요 시 해당 에이전트에게 요청
- `@product-manager`는 코드 수정 금지, DOCS만 소유

## 워크플로우
1. **spec-gate** — 구현 전 DOCS에 스펙 존재 여부 확인. 없으면 `@product-manager`가 작성
2. **integrity-sync** — 코드 수정 후 영향받는 문서 동기화
3. **cross-doc-validation** — 문서 간 충돌 검증

## 코딩 컨벤션
- offscreen.js 루프 내 GC 유발 할당 금지 (new Array, .map, .filter)
- Float32Array 재사용, subarray/mutation으로 처리
- 모든 async 경계에 try/catch 필수
- CSS 값은 CSS custom properties로만 관리
- Python: type hints 필수, async def 기본

## 커밋 규칙
- 커밋 메시지는 한글로 작성
- 담당 에이전트 태그 포함: `[@dsp-engineer] BPM 옥타브 보정 로직 수정`
