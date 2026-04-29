# Bug Reports — Chrome Audio Analyzer

**담당**: @qa-debug
**최종 업데이트**: 2026-04-23

---

## BUG-001: RhythmExtractor2013 fallback BPM 보정 수식 역방향 오류

**증상**: 48000Hz 환경에서 RhythmExtractor fallback BPM이 약 9% 높게 출력됨 (e.g., 실제 120BPM → 130.6BPM)
**재현 방법**:
1. TempoCNN 모델 로드 실패 상황 유도 (lib/tempocnn/model.json 제거)
2. 48000Hz AudioContext에서 분석 시작
3. RhythmExtractor fallback 결과 확인

**예상 동작**: 44100Hz 기반으로 동작하는 Essentia RhythmExtractor 결과를 그대로 사용 (보정 불필요)
**실제 동작**: `rhythmResult.bpm * (SAMPLE_RATE / 44100)` — SAMPLE_RATE=48000이면 1.0884 배율 곱해 BPM 오증가
**근본 원인**: Essentia RhythmExtractor2013은 입력 PCM의 샘플레이트를 인자로 받아서 내부에서 직접 처리함. 결과 BPM은 이미 입력 샘플레이트 기준으로 정규화된 값이므로 추가 보정이 불필요. 반면 이 코드는 입력이 44100Hz가 아닌 경우 오히려 비율만큼 BPM을 부풀림.
**의심 계층**: Offscreen → Sandbox
**담당 에이전트**: @dsp-engineer
**관련 코드**: sandbox.js:278
**영향도**: High

---

## BUG-002: TempoCNN BPM_BINS 수식 오류 — BPM 범위 286BPM이 아닌 287BPM으로 산출

**증상**: 256번째 BPM bin(index 255)이 30 + 255*(256/255) = 30 + 256.0 = 286.0이 아닌 286.0으로 계산되나, 중간 bin 간격이 불균일해짐
**재현 방법**: `BPM_BINS[255]` 출력 확인

**예상 동작**: TempoCNN 공식 스펙상 BPM bins는 30~286 균등 분포. bin i의 값 = 30 + i * (256/255) 이지만 이때 bin 0 = 30, bin 255 = 30 + 255*(256/255) = 30 + 256 = 286 — 계산은 수치적으로 맞음.
**실제 동작**: 계산 자체는 286으로 수렴하나, `256/255 ≒ 1.00392`씩 증가하므로 bin 간격이 TempoCNN 원 논문 스펙(1BPM 간격)과 다름. 원 모델의 출력 class는 30BPM 시작 1BPM 간격 256개(30~285)임. 현 코드는 마지막 bin을 286으로 약간 늘려 전체를 stretching함.
**의심 계층**: Sandbox
**담당 에이전트**: @dsp-engineer
**관련 코드**: sandbox.js:17
**영향도**: Medium — 고BPM 구간(250BPM 이상)에서 추정값이 최대 1BPM 쪽으로 편향

---

## BUG-003: resampleTo11025 — step 계산에 Math.ceil 사용으로 aliasing 발생

**증상**: 48000Hz → 11025Hz 다운샘플 시 ratio=4.354, step=Math.ceil(4.354)=5로 실제 구간보다 넓은 윈도우로 평균화. 이는 저역 aliasing이 아니라 미세한 시간축 왜곡을 유발.
**재현 방법**: 48000Hz 입력으로 분석 후 resampleTo11025 내부 step 값 로그 확인

**예상 동작**: step은 ratio를 정확히 반영해야 함. 이상적으로는 폴리페이즈 필터나 선형보간 사용
**실제 동작**: `step = Math.ceil(ratio)` → 44100Hz에서는 ratio=4.0, step=4 (정확). 48000Hz에서는 ratio≈4.354, step=5. 마지막 `(e-s)` 나눗셈으로 일부 보정되나 윈도우 경계가 정확하지 않아 주기적 시간 왜곡이 발생함.
**의심 계층**: Sandbox
**담당 에이전트**: @dsp-engineer
**관련 코드**: sandbox.js:63
**영향도**: Medium — 48000Hz 환경에서 TempoCNN 입력 품질 저하, 특히 빠른 BPM(>160) 패치에서 오탐 가능성

---

## BUG-004: KeyExtractor minFrequency=55Hz — bass tonic 분석 대역 중복 오염

**증상**: Key 분석에 55Hz 이하까지 포함되어 킥드럼 fundamental(60~80Hz)이 HPCP에 영향을 줌
**재현 방법**: Trap/House 장르에서 강한 킥이 있는 트랙 분석 시 Key 오탐 확인

**예상 동작**: HPSS harmonic 버퍼를 이미 전처리해서 보내고 있으므로 KeyExtractor minFrequency는 C2(65Hz) 이상인 100~200Hz 수준으로 설정하는 것이 일관적
**실제 동작**: minFrequency=55Hz로 설정 — Essentia 기본값(55Hz)을 그대로 사용. HPSS가 킥을 완전히 제거하지 못했을 경우(L_PERC=31이지만 완벽하지 않음) 잔류 킥 에너지가 F#/G 피치클래스에 집중되어 Key 오탐 유발 가능.
**의심 계층**: Sandbox
**담당 에이전트**: @dsp-engineer
**관련 코드**: sandbox.js:209
**영향도**: Medium

---

## BUG-005: bass tonic penalty가 다수결 이후가 아닌 이전에 적용됨 — 다수결 논리 무력화

**증상**: 3개 프로파일 중 2개가 "A Minor"로 일치했는데 bass tonic이 C이면, A Minor의 maxStrength에 0.6 페널티가 적용되어 다수결(count>=2) 조건을 통과해도 strength가 낮아짐. 최종 선택 시 count<2인 "C Major"가 더 높은 strength로 선택될 수 있음.
**재현 방법**:
1. A Minor 곡 분석 (Bass tonic HPS가 C를 잘못 감지하는 경우)
2. 3 프로파일이 모두 A Minor를 반환하는 상황에서 bassTonic=0(C)이면
3. votes["A minor"].maxStrength *= 0.6, r.strength *= 0.6 적용
4. 다수결 통과(count=3)하더라도 최종 비교에서 strength가 낮아진 상태

**예상 동작**: bass tonic penalty는 다수결이 완전히 동점(count 동일)일 때의 tiebreaker로만 사용해야 함
**실제 동작**: 다수결 집계(count) 이전에 votes와 profileResults 양쪽에 페널티를 적용 (sandbox.js:237-243). 다수결 우선 채택(count>=2 분기) 내부에서도 maxStrength를 비교하므로, penalty가 적용된 후의 strength로 우선 후보를 고름. 결국 bass tonic 오탐 시 정확히 일치한 다수결 결과를 뒤집을 수 있음.
**의심 계층**: Sandbox
**담당 에이전트**: @dsp-engineer
**관련 코드**: sandbox.js:235-255
**영향도**: High

---

## BUG-006: keyVotes 누적이 무한 증가 — 초기화 조건 불충분

**증상**: 곡이 바뀌어도 이전 곡의 keyVotes가 남아 새 곡의 Key 판정을 오염시킴
**재현 방법**:
1. 곡 A (C Major) 분석 → keyVotes에 "C Major": 3.5 누적
2. reset-analysis 없이 탭에서 새 곡 B (A Minor) 재생 시작
3. 초기 분석에서 "A Minor"가 감지되어도 누적값이 C Major를 이길 때까지 수십 사이클 필요

**예상 동작**: 곡 교체 시 keyVotes 초기화
**실제 동작**: keyVotes는 `resetAccumulators()` 호출 시에만 초기화됨 (offscreen.js:268). 그러나 탭 URL이 바뀌지 않고 동일 탭에서 새 트랙이 재생되는 경우(SPA, 유튜브 플레이리스트 등) reset-analysis 메시지가 전달되지 않으면 keyVotes 누적이 지속됨.
**의심 계층**: Background (reset 트리거 미전달) / Offscreen (keyVotes 누적 무한)
**담당 에이전트**: @extension-architect (트리거 누락), @dsp-engineer (keyVotes decay 필요)
**관련 코드**: offscreen.js:168, offscreen.js:268
**영향도**: High

---

## BUG-007: octave correction 조건이 >140BPM에만 적용 — 저BPM 2배 오탐 미처리

**증상**: 70~90BPM 발라드/힙합에서 BPM이 140~180으로 표시될 수 있음 (2배 오탐)
**재현 방법**: 75BPM 발라드 트랙 재생 → 150BPM 표시 여부 확인

**예상 동작**: 저BPM 2배 오탐도 교정해야 함 (bestBpm이 140보다 크고 halfBPM이 70~100 사이면 절반 선택)
**실제 동작**: offscreen.js:851-861의 octave correction 블록은 `coarseBpm > 140` 조건만 처리. 즉 2배 오탐(실제 75 → 감지 150)에 대한 교정은 있으나, BPM_MIN=50 기준으로 50~70BPM 구간에서 2배 오탐(100~140BPM으로 표시)이 발생해도 교정 로직이 실행되지 않음. 또한 교정 임계 `halfAC > fullAC * 0.55`가 절반 선택에 충분히 민감하지 않을 수 있음.
**의심 계층**: Offscreen
**담당 에이전트**: @dsp-engineer
**관련 코드**: offscreen.js:851-861
**영향도**: Medium

---

## BUG-008: HPSS computeHPSSHarmonic — numFrames < L_HARM 시 원본 반환, Key 분석 오염

**증상**: 짧은 버퍼(13초 최소 조건 직후) 입력 시 HPSS를 건너뛰고 원본 버퍼를 KeyExtractor에 전달
**재현 방법**: accumLen이 정확히 13초 직후 (약 573,300샘플 @ 44100Hz)인 시점에 분석 트리거 확인

**예상 동작**: numFrames >= L_HARM이 보장될 만한 최소 버퍼 크기로 호출해야 함. L_HARM=11, FFT_SIZE=2048, HOP_SIZE=512이면 최소 (11+1)*512+2048 = 8,192샘플(0.2초)이면 충분. 13초면 절대 미달 불가.
**실제 동작**: `if (numFrames < L_HARM) return buffer` (offscreen.js:511). 이 경우 HPSS를 건너뛰고 원본 버퍼(percussive 성분 포함)를 harmonic 버퍼로 반환. 따라서 KeyExtractor에 킥/스네어가 포함된 원본이 전달됨. 단 13초 조건 통과 시 numFrames는 충분히 크므로 실제 발생 빈도는 낮음 — 그러나 엣지케이스 발생 시 Key 오탐.
**의심 계층**: Offscreen
**담당 에이전트**: @dsp-engineer
**관련 코드**: offscreen.js:511
**영향도**: Low

---

## BUG-009: essentiaHasRun 플래그 — 첫 Essentia 결과 수신 전 로컬 DSP 결과 완전 억제

**증상**: 분석 시작 후 최초 13초 동안 BPM/Key가 전혀 표시되지 않음. 로컬 DSP fallback이 완전히 비활성화됨.
**재현 방법**:
1. 분석 시작
2. 13초 대기 (TempoCNN 패치 최소 조건)
3. 추가로 ESSENTIA_EVERY=5 사이클(10초) 대기 후 첫 Essentia 결과 수신 전까지
4. 로컬 DSP 결과가 sendResults()로 전달되지 않음 확인

**예상 동작**: Essentia 결과 대기 중에도 로컬 DSP fallback이 동작해서 BPM/Key를 표시해야 함
**실제 동작**: `if (!essentiaHasRun) return;` (offscreen.js:471)로 Essentia 첫 결과 전까지 sendResults() 호출이 차단됨. 이 의도는 두 소스 혼합 방지이나, 결과적으로 사용자는 최소 23초(13+10) 동안 UI에서 아무 결과도 볼 수 없음.
**의심 계층**: Offscreen
**담당 에이전트**: @dsp-engineer, @ui-designer
**관련 코드**: offscreen.js:471
**영향도**: High — 사용자 경험 직접 영향

---

## BUG-010: matchKeyProfile bass tonic penalty — relative major/minor 모두 동일 penalty

**증상**: A Minor와 C Major는 같은 음계(상대조)이나, C Major 루트가 bassTonic=C(0)로 감지되면 C Major는 penalty 없고 A Minor는 penalty 적용. 올바른 동작처럼 보이나, bassTonic 오탐 시 상대조 선택이 영구적으로 반전됨.
**재현 방법**: C 피아노 코드가 있는 곡에서 HPS가 C를 bassTonic으로 감지, A Minor 곡 판정 시도

**예상 동작**: 상대조 관계(장단조 6음 차이)를 인식하여 penalty를 완화하거나, penalty 적용 전 confidence margin을 확인해야 함
**실제 동작**: `if (bassTonic >= 0 && rootShift !== bassTonic) corr *= 0.7;` (offscreen.js:699-701). 상대조 관계에 대한 예외 없음. bassTonic 감지 정확도에 Key 정확도가 전적으로 의존하게 됨.
**의심 계층**: Offscreen
**담당 에이전트**: @dsp-engineer
**관련 코드**: offscreen.js:699-701
**영향도**: Medium
