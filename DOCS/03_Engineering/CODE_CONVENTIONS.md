# 💻 Code Conventions

**목적**: 코드 작성 시 일관성을 유지하고 성능 예산(Performance Budget)을 관리

## 1. 규칙 (Rules)
- **언어**: Vanilla JavaScript (ESNext)
- **성능 관리 (Performance)**:
  - `Float32Array`와 같은 오디오 버퍼 조작은 반드시 재할당 없이 `subarray` 및 값 업데이트(Mutation)로 처리. (가비지 컬렉터 스파이크 방지)
  - DOM 조작은 반드시 `requestAnimationFrame` 주기를 따름.

## 2. 보안 가이드라인 (Security)
- `manifest.json`에서 `unsafe-eval` 또는 불필요한 호스트 패턴 (`<all_urls>`) 지양.
- `activeTab` 권한 체계 준수.
