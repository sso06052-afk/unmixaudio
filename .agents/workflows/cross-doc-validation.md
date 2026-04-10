# 🔍 WORKFLOW: Cross-Doc Validation (상호 검증)

AI는 문서를 수정하거나 코드를 짤 때 기존에 등록된 모든 SDD 문서 사이에 충돌이 없는지 검사해야 합니다.

## 검증 대상 예시
- `PRD.md`에는 '저사양 모바일 지원'이라고 적혀 있는데, `ALGORITHM_SPEC.md`에 무거운 '500Hz 실시간 FFT 반복' 처리를 추가하려고 시도하는 경우.
- `SYSTEM_HANDOVER.md`에는 Offscreen이 상태를 갖지 않는다고 명시되어 있는데, 코드에서 Offscreen에 `sessionStorage`를 의도하는 경우.

## 발생 시 동작
모순 발견 시 작업을 멈추고 **어떤 문서가 기준(Source of Truth)이 되어야 할지** 사용자에게 질문합니다.
> `[CROSS-DOC 충돌 ⚠] ALGORITHM_SPEC.md의 알고리즘은 CODE_CONVENTIONS.md에 명시된 성능 예산(Performance Budget) 5ms를 초과할 위험이 있습니다. 어떤 문서를 수정할까요?`
