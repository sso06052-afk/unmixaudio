# 🔄 WORKFLOW: Integrity Sync ("코드가 바뀌면, 문서도 바뀐다")

코드나 시스템 구조가 크게 변경될 경우, AI는 반드시 문서 파편화를 방지하기 위해 문서를 최신화해야 합니다.

## 동기화 트리거
1. **새로운 알고리즘 추가/변경** (e.g. BPM 분석 수식 변경)
   - ➔ `DOCS/04_Technical_Spec/ALGORITHM_SPEC.md` 업데이트 감지
2. **Manifest 권한 변경 / 브라우저 통신 플로우 변경**
   - ➔ `DOCS/05_System_Architecture/SYSTEM_HANDOVER.md` 업데이트 감지
3. **UI/UX 레이아웃이나 애니메이션 규칙 변경**
   - ➔ `DOCS/02_Design/UI_UX_GUIDELINES.md` 업데이트 감지

작업 완료 후 AI는 변경된 DOCS 리스트를 사용자에게 요약해 주어야 합니다.
> `[INTEGRITY-SYNC ✅ 완료] 변경된 로직에 맞춰 DOCS/04_Technical_Spec/ALGORITHM_SPEC.md 파일을 최신화했습니다.`
