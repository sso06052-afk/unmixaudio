# 📄 Product Requirements Document (PRD)

**프로젝트 명**: UnmixAudio
**목표**: 브라우저 탭 오디오를 실시간으로 캡처하고 고정밀 BPM/Key를 분석하며, AI 스템 분리를 제공하는 확장 프로그램

## 1. 개요 (Overview)
- 확장 프로그램 아이콘 클릭 시 **Side Panel**이 열리고 활성화 탭의 오디오를 분석하기 시작합니다.
- Side Panel은 탭을 전환해도 닫히지 않아 분석 결과를 지속적으로 확인할 수 있습니다.
- 분석된 BPM/Key 결과는 실시간으로 Side Panel에 나타납니다.
- YouTube 페이지에서는 오버레이 버튼을 통해 빠르게 분석을 시작/중지할 수 있습니다.

## 2. 유저 스토리 (User Stories)
- **사용자**: DJ, 프로듀서, 음악 분석가 등.
- "스트리밍 사이트(YouTube, SoundCloud)에서 틀고 있는 음악의 BPM과 Key를 즉각적으로 알고 싶다."
- "분석한 곡들을 라이브러리에 저장해서 나중에 참고하고 싶다."
- "현재 듣고 있는 곡을 보컬/드럼/베이스/기타로 분리해서 추출하고 싶다."
- "로컬에 가지고 있는 오디오 파일도 스템 분리할 수 있으면 좋겠다."

## 3. 핵심 기능 (Core Features)

### 3-1. BPM / Key 실시간 분석
- tabCapture로 탭 오디오 스트림 획득
- 오프스크린 DSP 엔진에서 2초 간격으로 BPM/Key 분석
- Side Panel 및 YouTube 오버레이에 실시간 표시

### 3-2. Library
- 분석 결과(BPM, Key, 제목, URL)를 로컬 스토리지에 저장
- 저장된 트랙 목록 조회/삭제

### 3-3. AI 스템 분리
- **탭 녹음 방식**: 현재 탭 오디오를 WebM/Opus(256kbps)로 녹음 → 백엔드 전송
- **파일 업로드 방식**: 로컬 오디오 파일 직접 업로드 → 백엔드 전송
- 백엔드에서 Demucs로 Vocals / Drums / Bass / Other 분리
- 분리된 각 스템 다운로드 제공

## 4. 비기능 요구사항
- Chrome MV3 준수, Chrome Web Store 배포 가능 (ToS 위반 없음)
- Side Panel: 탭 전환 시에도 분석 상태 유지
- 스템 분리 처리 중 BPM/Key 분석 동시 작동
