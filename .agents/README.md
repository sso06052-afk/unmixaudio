# Chrome Audio Analyzer - Agent System Instructions

이 디렉토리는 AI 에이전트들이 시스템에 접근할 때 할당받는 **역할(Persona)**과 **공통 워크플로우(Workflows)**가 정의된 곳입니다. 프롬프트에 불필요한 맥락을 최소화하고, 역할별 특화 지식만을 효과적으로 주입하기 위해 사용됩니다.

## 👥 Available Agents

| 프롬프트 태그 | 역할명 | 담당 영역 | 진입점 |
|---|---|---|---|
| `@dsp_engineer` | DSP & Audio Engineer | `offscreen.js`, 오디오 PCM 신호 분석 로직, 알고리즘 구현 | `.agents/dsp-engineer/AGENT.md` |
| `@extension_architect` | Extension Architect | `background.js`, `manifest.json`, Service Worker 생명주기 제어 | `.agents/extension-architect/AGENT.md` |
| `@frontend_developer` | Frontend UI Developer | `popup.html`, 옵션 페이지, 상태 시각화 | `.agents/frontend-developer/AGENT.md` |

## 🛠️ Workflows
모든 에이전트는 작업을 시작할 때 아래의 범용 워크플로우를 따릅니다.
1. `agent-dispatch.md`: 현재 작업에 맞는 적절한 에이전트를 소환합니다.
2. `spec-gate.md`: "코딩 전 문서 존재 여부 확인" (문서 무결성 확인용).
3. `integrity-sync.md`: 코드를 수정한 후 영향을 받는 문서를 함께 업데이트.
4. `cross-doc-validation.md`: 문서 간 내용이 충돌하지 않는지 상호 검증.
