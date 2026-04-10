# 🏗️ System Handover (Architecture Overview)

**목적**: 컴포넌트 간 프로세스 통신과 생명주기를 정의.

## 1. 아키텍처 다이어그램 (텍스트 요약)

- **Side Panel (`sidepanel.js`)**: 아이콘 클릭 또는 오버레이 클릭으로 열리며, 탭 전환 후에도 유지되는 Persistent View.
  - Analyzer 탭: BPM/Key 실시간 표시
  - Library 탭: 저장된 트랙 목록
  - Stems 탭: 스템 분리 UI (녹음 / 파일 업로드)
- **Service Worker (`background.js`)**: 메시지 라우터 + Side Panel 생명주기 관리 + offscreen 관리.
- **Offscreen Document (`offscreen.js`)**: AudioContext + DSP 엔진(BPM/Key) + MediaRecorder(녹음)를 동시에 실행하는 심장.
- **Content Script (`content-script.js`)**: YouTube 페이지에 오버레이 버튼 주입. 클릭 시 Side Panel을 열고 캡처 시작.
- **Backend (FastAPI)**: 오디오 파일을 받아 Supabase Storage 업로드 후 Demucs 스템 분리 큐 실행.

## 2. 데이터 흐름 (Data Flow)

### BPM/Key 분석 흐름
1. `Side Panel` → `start-with-stream` → `Background`
2. `Background` → offscreen 문서 생성 → `start-analysis` → `Offscreen`
3. `Offscreen` → (분석 데이터 매 2초) → `analysis-result` → `Background`
4. `Background` → `Side Panel` + `Content Script` (오버레이 업데이트)

### 스템 분리 흐름 (탭 녹음)
1. `Side Panel` → `start-recording` → `Background` → `Offscreen`
2. `Offscreen`: MediaRecorder로 기존 스트림 녹음 (BPM/Key 분석 동시 진행)
3. 녹음 완료 → base64 blob → `Background` → `Side Panel`
4. `Side Panel` → FormData POST → `FastAPI /api/v1/extract-stems`
5. 3초 간격 폴링 → 완료 시 스템 다운로드 URL 표시

### 스템 분리 흐름 (파일 업로드)
1. `Side Panel`: `<input type="file">` → blob → FormData POST → `FastAPI /api/v1/extract-stems`
2. 3초 간격 폴링 → 완료 시 스템 다운로드 URL 표시

## 3. 컴포넌트 파일 맵

| 파일 | 역할 |
|------|------|
| `manifest.json` | MV3 권한, side_panel 설정, service worker |
| `sidepanel.html` | Side Panel UI (CSS 인라인, 3탭 레이아웃) |
| `sidepanel.js` | UI 로직, API 클라이언트, 메시지 핸들러 |
| `background.js` | 메시지 라우터, offscreen 관리, sidePanel.open |
| `offscreen.js` | DSP 엔진 + MediaRecorder 녹음 |
| `offscreen.html` | Offscreen 문서 쉘 |
| `content-script.js` | YouTube 오버레이 버튼 |
| `audio-worklet-processor.js` | 3채널 링버퍼 (Raw/HP/LP) |
| `backend/` | FastAPI + Supabase + Demucs 스켈레톤 |

## 4. 스토리지 구조

**Chrome Session Storage**: `isAnalyzing`, `capturedTabId`, `pendingCaptureTabId`, `isRecording`

**Chrome Local Storage**: `library[]` (videoId, title, url, bpm, key, secondKey, savedAt)
