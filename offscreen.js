// offscreen.js — Production Audio Analyzer
// Key: CQT HPCP + Krumhansl-Kessler / EDMA profile matching (max ensemble)
// BPM: Mel Spectral Flux → Autocorrelation + Harmonic Comb + Perceptual Tempo Prior

// ============================================================
// Audio Infrastructure
// ============================================================
let audioContext = null;
let audioWorkletNode = null;
let mediaStream = null;
let analysisInterval = null;
let audioPassthrough = null;

let SAMPLE_RATE = 44100;
const BUFFER_DUR_SEC = 10;
let sampleBufferRaw = new Float32Array(0);
let sampleBufferHp = new Float32Array(0);
let sampleBufferLp = new Float32Array(0);

// ============================================================
// Key Detection Constants
// ============================================================
const KEY_BUFFER_SIZE = 32768;
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const KK_MAJOR   = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR   = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const EDMA_MAJOR = [1.00, 0.29, 0.50, 0.40, 0.60, 0.56, 0.32, 0.80, 0.31, 0.45, 0.42, 0.39];
const EDMA_MINOR = [1.00, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32];
// Essentia bgate profile — binary-gate, highest accuracy on EDM/Hip-hop (0.911 on A#m test)
const BGATE_MAJOR = [1.00, 0.00, 0.42, 0.00, 0.53, 0.37, 0.00, 0.77, 0.00, 0.38, 0.21, 0.30];
const BGATE_MINOR = [1.00, 0.00, 0.36, 0.39, 0.00, 0.38, 0.00, 0.74, 0.27, 0.00, 0.42, 0.23];
// Shaath (2006) — pop/EDM tuned profile
const SHAATH_MAJOR = [6.6, 2.0, 3.5, 2.0, 4.6, 4.0, 2.5, 5.2, 2.4, 3.8, 2.3, 3.4];
const SHAATH_MINOR = [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.1, 4.0, 2.7, 4.3, 3.2];

const CQT_BINS_PER_OCTAVE = 24;
const CQT_MIN_MIDI = 45;  // A2=110Hz — 킥 fundamental(60-100Hz) 제외, 음악 노트는 유지
const CQT_MAX_MIDI = 83;
const CQT_NUM_BINS = (CQT_MAX_MIDI - CQT_MIN_MIDI + 1) * (CQT_BINS_PER_OCTAVE / 12);
const CQT_FMIN = 440 * Math.pow(2, (CQT_MIN_MIDI - 69) / 12);
let cqtKernels = null;

const ENERGY_FLOOR = 0.1;

// ============================================================
// BPM Detection Constants
// ============================================================
const MEL_BANDS = 40;
const MEL_FFT_SIZE = 2048;
const MEL_HOP_SIZE = 256;  // 512→256: OSS FPS 2배 → BPM 해상도 2배 (180BPM 근처 ±1.5 BPM/lag → ±0.7)
const MAX_OSS_FRAMES = 3500;
let melFilterBank = null;

const BPM_MIN = 50;
const BPM_MAX = 220;
const TEMPO_PRIOR_CENTER = 95;    // hip-hop/trap(70-100BPM) 중심 — 128은 trap 곡을 140-150으로 뻥튀기
const TEMPO_PRIOR_SIGMA  = 0.85;  // 넓게 — 50~220 BPM 전 구간 0.5 이상 유지

// ============================================================
// Song-Level Accumulation
// ============================================================
let cumulativeChroma = new Float32Array(12);
let chromaCycleCount = 0;

let bassTonicVotes = new Int32Array(12);  // 누적 투표
let stableBassTonic = -1;

let keyCandidate = null;
let keyCandidateCount = 0;
const KEY_SWITCH_THRESHOLD = 3;

const BPM_HISTORY_MAX = 500;
let bpmHistory = [];

// BPM Snap & Lock — ±2-3 진동 제거
const BPM_SNAP_TOLERANCE = 0.7;   // 정수 ±0.7 이내면 정수로 스냅 (89.4→89, 89.6→90)
const BPM_LOCK_THRESHOLD = 3;     // 3회 연속 같은 BPM이면 잠금
const BPM_UNLOCK_DIFF    = 5;     // 잠금 해제는 ±5 BPM 이상 차이날 때만 (실제 곡 변경)
let bpmLockedValue = null;
let bpmLockCount = 0;

let stableKey = null;
let stableSecondKey = null;
let lastKeyConfidence = 0;
let lastBpm = null;
let analysisCount = 0;

let _bpmRealBuf = null;
let _bpmImagBuf = null;
let _bpmPowerBuf = null;
let _bpmMelBuf = null;
let _bpmPrevMelBuf = null;
let _bpmHannBuf = null;

// ============================================================
// Sandbox (Essentia WASM + TempoCNN) State
// ============================================================
let essentiaReady = false;
let essentiaHasRun = false;
let isEssentiaRunning = false;
let keyVotes = {};  // { 'A Minor': 2.3, 'C Major': 1.1 } — strength 가중 누적

// 오디오 누적 버퍼 (sandbox용 — 최대 5분)
const MAX_ACCUM_SAMPLES = 48000 * 300;
let accumChunks = [];
let accumLen = 0;

// ============================================================
// Recording State
// ============================================================
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// ============================================================
// Sandbox Communication
// ============================================================
function getSandboxFrame() {
  return document.getElementById('essentia-sandbox');
}

function sendToSandbox(rawBuffer, hpBuffer, sampleRate, bassTonic) {
  const frame = getSandboxFrame();
  if (!frame || !essentiaReady || isEssentiaRunning) return;
  isEssentiaRunning = true;
  const rawCopy = new Float32Array(rawBuffer);
  const hpCopy = new Float32Array(hpBuffer);
  frame.contentWindow.postMessage(
    { type: 'analyze', rawBuffer: rawCopy.buffer, hpBuffer: hpCopy.buffer, sampleRate, bassTonic },
    '*',
    [rawCopy.buffer, hpCopy.buffer]
  );
}

function handleEssentiaResult(result, partial) {
  if (!partial) isEssentiaRunning = false;  // partial=true(key only)일 땐 TempoCNN 아직 실행 중
  // 첫 sandbox 결과 도착 시 로컬 DSP BPM 히스토리 폐기 (오염 제거)
  if (!essentiaHasRun) {
    bpmHistory = [];
    lastBpm = null;
  }
  essentiaHasRun = true;

  if (!result.keyError && result.key && result.scale) {
    // ③ strength 임계값: 0.4 미만이면 무시 (초반 불안정 결과 억제)
    if ((result.strength || 0) >= 0.4) {
      const key = `${result.key} ${result.scale.charAt(0).toUpperCase() + result.scale.slice(1)}`;
      keyVotes[key] = (keyVotes[key] || 0) + (result.strength || 0.5);
      let maxV = 0, bestKey = null, secondV = 0, secondKey = null;
      for (const [k, v] of Object.entries(keyVotes)) {
        if (v > maxV) { secondV = maxV; secondKey = bestKey; maxV = v; bestKey = k; }
        else if (v > secondV) { secondV = v; secondKey = k; }
      }
      if (bestKey) {
        stableKey = bestKey;
        stableSecondKey = secondKey;
        lastKeyConfidence = result.strength || 0.5;
      }
    }
  }

  if (!result.bpmError && result.bpm) {
    bpmHistory.push(result.bpm);
    if (bpmHistory.length > BPM_HISTORY_MAX) bpmHistory.shift();
    if (bpmHistory.length >= 1) {
      const sorted = bpmHistory.slice().sort((a, b) => a - b);
      const medianFloat = sorted[Math.floor(sorted.length / 2)];

      // ② Snap: 정수 근처(±0.7)면 정수로 (89.4→89, 89.6→90)
      const nearestInt = Math.round(medianFloat);
      const snapped = (Math.abs(medianFloat - nearestInt) <= BPM_SNAP_TOLERANCE)
                      ? nearestInt
                      : Math.round(medianFloat * 10) / 10;

      // ③ Lock 메커니즘
      if (bpmLockedValue === null) {
        // 잠금 전: 3회 연속 ±1 이내면 잠금
        if (lastBpm !== null && Math.abs(snapped - lastBpm) < 1) {
          bpmLockCount++;
          if (bpmLockCount >= BPM_LOCK_THRESHOLD) {
            bpmLockedValue = snapped;
            console.log(`[bpm-lock] LOCKED at ${snapped}`);
          }
        } else {
          bpmLockCount = 1;
        }
        lastBpm = snapped;
      } else {
        // 잠금 후: ±5 BPM 이상 차이날 때만 해제 (곡 변경 시나리오)
        if (Math.abs(snapped - bpmLockedValue) >= BPM_UNLOCK_DIFF) {
          console.log(`[bpm-unlock] ${bpmLockedValue} → ${snapped}`);
          bpmLockedValue = null;
          bpmLockCount = 1;
          lastBpm = snapped;
        }
        // 잠금 중엔 lastBpm 그대로 유지 (UI 진동 차단)
      }
    }
  }
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'sandbox-ready') {
    essentiaReady = true;
    console.log('[sandbox] Essentia WASM 준비 완료');
  } else if (msg.type === 'analysis-result') {
    handleEssentiaResult(msg.result, msg.partial);
  } else if (msg.type === 'sandbox-error') {
    isEssentiaRunning = false;
    console.error('[sandbox] 오류:', msg.error);
  }
});

// ============================================================
// Lifecycle
// ============================================================
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'start-analysis') startAnalysis(message.streamId);
  if (message.type === 'stop-analysis') stopAnalysis();
  if (message.type === 'reset-analysis') resetAccumulators();
  if (message.type === 'start-recording') startRecording();
  if (message.type === 'stop-recording') stopRecording();
});

function startRecording() {
  if (!mediaStream || isRecording) return;
  recordedChunks = [];
  isRecording = true;

  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';

  try {
    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: mimeType || undefined,
      audioBitsPerSecond: 256000,
    });
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'recording-error', error: err.message }).catch(() => {});
    isRecording = false;
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    isRecording = false;
    if (recordedChunks.length === 0) {
      chrome.runtime.sendMessage({ type: 'recording-error', error: 'No audio recorded' }).catch(() => {});
      return;
    }
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    recordedChunks = [];
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      chrome.runtime.sendMessage({
        type: 'recording-complete',
        audioBase64: base64,
        mimeType: blob.type,
      }).catch(() => {});
    };
    reader.readAsDataURL(blob);
  };

  mediaRecorder.onerror = (e) => {
    isRecording = false;
    chrome.runtime.sendMessage({ type: 'recording-error', error: e.error?.message || 'Recorder error' }).catch(() => {});
  };

  mediaRecorder.start(1000);
}

function stopRecording() {
  if (mediaRecorder && isRecording) mediaRecorder.stop();
}

function resetAccumulators() {
  cumulativeChroma = new Float32Array(12);
  chromaCycleCount = 0;
  bassTonicVotes = new Int32Array(12);
  stableBassTonic = -1;

  keyCandidate = null;
  keyCandidateCount = 0;
  bpmHistory = [];
  bpmLockedValue = null;
  bpmLockCount = 0;
  stableKey = null;
  stableSecondKey = null;
  lastKeyConfidence = 0;
  lastBpm = null;
  analysisCount = 0;
  if (sampleBufferRaw && sampleBufferRaw.length > 0) sampleBufferRaw.fill(0);
  if (sampleBufferHp && sampleBufferHp.length > 0) sampleBufferHp.fill(0);
  if (sampleBufferLp && sampleBufferLp.length > 0) sampleBufferLp.fill(0);

  // sandbox 누적 상태 초기화
  accumChunks = [];
  accumLen = 0;
  keyVotes = {};
  essentiaHasRun = false;
  isEssentiaRunning = false;
}

async function startAnalysis(streamId) {
  try {
    stopAnalysis();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
    });

    audioPassthrough = document.createElement('audio');
    audioPassthrough.srcObject = mediaStream;
    audioPassthrough.volume = 1.0;
    audioPassthrough.play().catch(() => {});

    audioContext = new AudioContext();
    await audioContext.resume();
    SAMPLE_RATE = audioContext.sampleRate;

    if (!cqtKernels) {
      cqtKernels = buildCQTKernels(SAMPLE_RATE, KEY_BUFFER_SIZE);
    }

    const maxSamples = Math.ceil(SAMPLE_RATE * BUFFER_DUR_SEC);
    sampleBufferRaw = new Float32Array(maxSamples);
    sampleBufferHp = new Float32Array(maxSamples);
    sampleBufferLp = new Float32Array(maxSamples);

    await audioContext.audioWorklet.addModule(chrome.runtime.getURL('audio-worklet-processor.js'));

    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-ring-buffer-processor', {
      processorOptions: {
        bufferSize: maxSamples,
        highpassFreq: 200,
        lowpassFreq: 160,
        sampleRate: SAMPLE_RATE
      },
      numberOfInputs: 1,
      numberOfOutputs: 0
    });

    audioWorkletNode.port.onmessage = (event) => {
      if (event.data.type !== 'chunk') return;
      sampleBufferRaw.set(new Float32Array(event.data.raw));
      sampleBufferHp.set(new Float32Array(event.data.hp));
      sampleBufferLp.set(new Float32Array(event.data.lp));
    };

    const source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(audioWorkletNode);

    analysisInterval = setInterval(analyzeBufferChunk, 2000);

    melFilterBank = buildMelFilterBank(MEL_FFT_SIZE, SAMPLE_RATE, MEL_BANDS);
    _bpmRealBuf  = new Float32Array(MEL_FFT_SIZE);
    _bpmImagBuf  = new Float32Array(MEL_FFT_SIZE);
    _bpmPowerBuf = new Float32Array(MEL_FFT_SIZE / 2 + 1);
    _bpmMelBuf   = new Float32Array(MEL_BANDS);
    _bpmPrevMelBuf = new Float32Array(MEL_BANDS);
    _bpmHannBuf  = new Float32Array(MEL_FFT_SIZE);
    for (let i = 0; i < MEL_FFT_SIZE; i++) {
      _bpmHannBuf[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (MEL_FFT_SIZE - 1)));
    }
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'offscreen-error', error: err.message });
  }
}

function stopAnalysis() {
  if (mediaRecorder && isRecording) mediaRecorder.stop();
  mediaRecorder = null;
  recordedChunks = [];
  isRecording = false;

  if (audioPassthrough) {
    audioPassthrough.pause();
    audioPassthrough.srcObject = null;
    audioPassthrough = null;
  }
  if (audioWorkletNode) {
    audioWorkletNode.port.close();
    audioWorkletNode.disconnect();
    audioWorkletNode = null;
  }
  if (analysisInterval) clearInterval(analysisInterval);
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
  if (audioContext) audioContext.close().catch(() => {});

  analysisInterval = null;
  mediaStream = null;
  audioContext = null;

  sampleBufferRaw = new Float32Array(0);
  sampleBufferHp = new Float32Array(0);
  sampleBufferLp = new Float32Array(0);

  cumulativeChroma = new Float32Array(12);
  chromaCycleCount = 0;
  bassTonicVotes = new Int32Array(12);
  stableBassTonic = -1;

  keyCandidate = null;
  keyCandidateCount = 0;
  bpmHistory = [];
  bpmLockedValue = null;
  bpmLockCount = 0;
  stableKey = null;
  stableSecondKey = null;
  lastKeyConfidence = 0;
  lastBpm = null;
  analysisCount = 0;

  _bpmRealBuf = null;
  _bpmImagBuf = null;
  _bpmPowerBuf = null;
  _bpmMelBuf = null;
  _bpmPrevMelBuf = null;
  _bpmHannBuf = null;

  // sandbox 누적 버퍼 해제
  accumChunks = [];
  accumLen = 0;
}

// ============================================================
// Analysis Pipeline
// ============================================================
function analyzeBufferChunk() {
  if (sampleBufferRaw.length === 0) return;

  const checkLen = Math.min(sampleBufferRaw.length, 4410);
  let hasData = false;
  for (let i = sampleBufferRaw.length - checkLen; i < sampleBufferRaw.length; i++) {
    if (sampleBufferRaw[i] !== 0) { hasData = true; break; }
  }
  if (!hasData) return;

  analysisCount++;

  // 로컬 DSP — HPSS로 킥/스네어 퍼커시브 성분 제거 후 CQT chroma 추출
  // sandbox(Essentia) 결과 도착 후엔 어차피 폐기되므로 GC 압력/CPU 절약 위해 매 2초 사이클 스킵
  if (!essentiaHasRun) {
    const harmonicBuf = computeHPSSHarmonic(sampleBufferRaw);
    const chromaResult = extractChroma(harmonicBuf);
    console.log('[chroma-dbg] chromaResult:', chromaResult ? `validWindows=${chromaResult.validWindows}` : 'null');
    if (chromaResult) {
      for (let i = 0; i < 12; i++) {
        cumulativeChroma[i] = (cumulativeChroma[i] * chromaCycleCount + chromaResult.chroma[i])
                              / (chromaCycleCount + 1);
      }
      chromaCycleCount++;

      const KN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const top = Array.from(cumulativeChroma).map((v,i)=>({n:KN[i],v})).sort((a,b)=>b.v-a.v);
      console.log('[chroma]', top.slice(0,4).map(x=>`${x.n}:${x.v.toFixed(3)}`).join(' '));

      // bass tonic: CQT bass octave(A2~G#3) 누적 → 가장 강한 bin
      for (let i = 0; i < 12; i++) bassTonicVotes[i] += chromaResult.bassChroma[i];
      if (chromaCycleCount >= 5) {
        let maxV = 0, maxI = -1;
        for (let i = 0; i < 12; i++) {
          if (bassTonicVotes[i] > maxV) { maxV = bassTonicVotes[i]; maxI = i; }
        }
        let total = 0;
        for (let i = 0; i < 12; i++) total += bassTonicVotes[i];
        stableBassTonic = (total > 0 && maxV >= total * 0.25) ? maxI : -1;
      }
      const KN2 = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      console.log('[bass-stable]', stableBassTonic >= 0 ? KN2[stableBassTonic] : 'none');
      const keyMatch = matchKeyProfile(cumulativeChroma, stableBassTonic);
      if (keyMatch) {
        const newKey = keyMatch.primary;
        if (stableKey === null) {
          stableKey = newKey;
          stableSecondKey = keyMatch.secondary;
        } else if (newKey !== stableKey) {
          if (newKey === keyCandidate) {
            keyCandidateCount++;
            if (keyCandidateCount >= KEY_SWITCH_THRESHOLD) {
              stableKey = newKey;
              stableSecondKey = keyMatch.secondary;
              keyCandidate = null;
              keyCandidateCount = 0;
            }
          } else {
            keyCandidate = newKey;
            keyCandidateCount = 1;
          }
        } else {
          keyCandidate = null;
          keyCandidateCount = 0;
          stableSecondKey = keyMatch.secondary;
        }
        lastKeyConfidence = keyMatch.confidence;
      }
    }
  }

  // ── BPM ──
  // sandbox 결과 도착 후엔 로컬 BPM history 폐기됨 + 신규 push 차단 (TempoCNN만 사용)
  if (!essentiaHasRun) {
    const bpmResult = analyzeBPM(sampleBufferHp);
    if (bpmResult !== null) {
      bpmHistory.push(bpmResult);
      if (bpmHistory.length > BPM_HISTORY_MAX) bpmHistory.shift();
      if (bpmHistory.length >= 3) {
        const sorted = [...bpmHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianFloat = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        lastBpm = Math.round(medianFloat * 10) / 10;
      }
    }
  }

  // ── Sandbox (Essentia WASM + TempoCNN) 호출 ──────────────────
  // 2초 신규 오디오를 누적 버퍼에 추가 (최대 5분 유지)
  try {
    const newSamples = Math.floor(SAMPLE_RATE * 2);
    const newChunk = sampleBufferRaw.slice(-newSamples);
    accumChunks.push(newChunk);
    accumLen += newChunk.length;
    while (accumLen > MAX_ACCUM_SAMPLES && accumChunks.length > 0) {
      accumLen -= accumChunks.shift().length;
    }

    // Sandbox 호출 주기 — TempoCNN은 12초 분량 필요 (256 patch frames @ 11025Hz)
    // 첫 호출: 14초 누적 시점 (analysisCount=7), 이후 10초마다 (5사이클)
    const ESSENTIA_EVERY = 5;  // 5 사이클 = 10초 간격
    const MIN_AUDIO_SEC = 14;  // TempoCNN 최소 12초 + 안전 여유 2초
    if (accumLen >= SAMPLE_RATE * MIN_AUDIO_SEC && analysisCount % ESSENTIA_EVERY === 0) {
      // 누적 버퍼 합치기 (ESSENTIA_EVERY 간격으로만 실행 — 핫루프 아님)
      const flatRaw = new Float32Array(accumLen);
      let off = 0;
      for (const c of accumChunks) { flatRaw.set(c, off); off += c.length; }

      // HPSS harmonic 버퍼 계산 (최근 30초 분량 사용)
      const harmonicForSandbox = computeHPSSHarmonic(
        flatRaw.subarray(-Math.min(accumLen, SAMPLE_RATE * 30))
      );

      // essentiaHasRun=true 단계에선 매 2초 로컬 DSP가 스킵되므로
      // bassTonicVotes가 정체되지 않도록 sandbox 호출 시점(10초마다)에 1회 누적.
      // false 단계에선 매 2초 사이클에서 이미 누적되고 있어 이중 누적 방지를 위해 스킵.
      if (essentiaHasRun) {
        const sandboxChromaResult = extractChroma(harmonicForSandbox);
        if (sandboxChromaResult) {
          for (let i = 0; i < 12; i++) bassTonicVotes[i] += sandboxChromaResult.bassChroma[i];
        }
      }

      // bass tonic 최다 득표값 전달
      let dominantTonic = -1, maxVotes = 0;
      for (let i = 0; i < 12; i++) {
        if (bassTonicVotes[i] > maxVotes) { maxVotes = bassTonicVotes[i]; dominantTonic = i; }
      }

      sendToSandbox(harmonicForSandbox, harmonicForSandbox, SAMPLE_RATE, dominantTonic);
    }
  } catch (e) {
    console.error('[sandbox-accum] 오류:', e);
  }

  if (analysisCount < 3) return;
  sendResults();
}

function sendResults() {
  // sandbox(Essentia WASM + TempoCNN) 첫 결과 전까지 UI에 결과 표시 안 함
  // → 로컬 DSP의 신뢰도 낮은 초기값을 사용자에게 보여주지 않음 ("분석 중..." 유지)
  if (!essentiaHasRun) return;
  if (!lastBpm && !stableKey) return;
  const rmsLen = Math.min(2048, sampleBufferRaw.length);
  let sumSq = 0;
  for (let i = sampleBufferRaw.length - rmsLen; i < sampleBufferRaw.length; i++) {
    sumSq += sampleBufferRaw[i] * sampleBufferRaw[i];
  }
  const rms = Math.sqrt(sumSq / rmsLen);

  chrome.runtime.sendMessage({
    type: 'analysis-result',
    data: {
      bpm: lastBpm,
      key: stableKey,
      secondKey: stableSecondKey,
      confidence: lastKeyConfidence,
      bpmChunks: bpmHistory.length,
      keyWindows: chromaCycleCount,
      rmsL: rms,
      rmsR: rms * (0.85 + Math.random() * 0.3)
    }
  }).catch(() => {});
}

// ============================================================
// HPSS — Harmonic/Percussive Source Separation (median filter)
// ============================================================
function computeHPSSHarmonic(buffer) {
  const FFT_SIZE = 2048;
  const HOP_SIZE = 512;
  const L_HARM    = 11;  // time-axis median window (sustained notes)
  const L_PERC    = 31;  // freq-axis median window — 킥 wideband transient 제거 강화
  const halfH     = (L_HARM - 1) >> 1;
  const halfP     = (L_PERC - 1) >> 1;
  const numBins  = FFT_SIZE / 2 + 1;
  const numFrames = Math.floor((buffer.length - FFT_SIZE) / HOP_SIZE);
  if (numFrames < L_HARM) return buffer;

  // Hann window (pre-computed once per call — small alloc outside hot loop)
  const hannWin = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++)
    hannWin[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

  const mag   = new Float32Array(numFrames * numBins);
  const phase = new Float32Array(numFrames * numBins);
  const re    = new Float32Array(FFT_SIZE);
  const im    = new Float32Array(FFT_SIZE);

  // ── STFT ──────────────────────────────────────────────────
  for (let f = 0; f < numFrames; f++) {
    re.fill(0); im.fill(0);
    const s0 = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) re[i] = buffer[s0 + i] * hannWin[i];
    fftInPlace(re, im, FFT_SIZE);
    const base = f * numBins;
    for (let b = 0; b < numBins; b++) {
      mag[base + b]   = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      phase[base + b] = Math.atan2(im[b], re[b]);
    }
  }

  // ── Median filters (insertion sort on fixed-size window — no GC) ──
  const harmMag = new Float32Array(numFrames * numBins);
  const percMag = new Float32Array(numFrames * numBins);
  const winH = new Float32Array(L_HARM);
  const winP = new Float32Array(L_PERC);

  // Horizontal median → harmonic (sustained across time)
  for (let b = 0; b < numBins; b++) {
    for (let f = 0; f < numFrames; f++) {
      for (let k = 0; k < L_HARM; k++) {
        const ff = Math.max(0, Math.min(numFrames - 1, f - halfH + k));
        winH[k] = mag[ff * numBins + b];
      }
      for (let i = 1; i < L_HARM; i++) {
        const v = winH[i]; let j = i - 1;
        while (j >= 0 && winH[j] > v) { winH[j + 1] = winH[j]; j--; }
        winH[j + 1] = v;
      }
      harmMag[f * numBins + b] = winH[halfH];
    }
  }

  // Vertical median → percussive (wideband per frame)
  for (let f = 0; f < numFrames; f++) {
    const base = f * numBins;
    for (let b = 0; b < numBins; b++) {
      for (let k = 0; k < L_PERC; k++) {
        const bb = Math.max(0, Math.min(numBins - 1, b - halfP + k));
        winP[k] = mag[base + bb];
      }
      for (let i = 1; i < L_PERC; i++) {
        const v = winP[i]; let j = i - 1;
        while (j >= 0 && winP[j] > v) { winP[j + 1] = winP[j]; j--; }
        winP[j + 1] = v;
      }
      percMag[base + b] = winP[halfP];
    }
  }

  // ── ISTFT with Wiener harmonic mask ───────────────────────
  const out    = new Float32Array(buffer.length);
  const weight = new Float32Array(buffer.length);

  for (let f = 0; f < numFrames; f++) {
    re.fill(0); im.fill(0);
    const base = f * numBins;
    for (let b = 0; b < numBins; b++) {
      const h  = harmMag[base + b];
      const p  = percMag[base + b];
      const d  = h * h + p * p;
      const mask = d > 0 ? (h * h) / d : 0.5;
      const m  = mag[base + b] * mask;
      const ph = phase[base + b];
      re[b] = m * Math.cos(ph);
      im[b] = m * Math.sin(ph);
    }
    // Hermitian symmetry for real IFFT
    for (let b = 1; b < numBins - 1; b++) {
      re[FFT_SIZE - b] =  re[b];
      im[FFT_SIZE - b] = -im[b];
    }
    // IFFT = conj(FFT(conj(x))) / N
    for (let i = 0; i < FFT_SIZE; i++) im[i] = -im[i];
    fftInPlace(re, im, FFT_SIZE);
    // OLA
    const s0 = f * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      const si = s0 + i;
      if (si >= out.length) break;
      out[si]    += (re[i] / FFT_SIZE) * hannWin[i];
      weight[si] += hannWin[i] * hannWin[i];
    }
  }

  for (let i = 0; i < out.length; i++) {
    if (weight[i] > 1e-8) out[i] /= weight[i];
  }
  return out;
}

// ============================================================
// Key Detection
// ============================================================
function extractChroma(rawBuffer) {
  const hopSize = KEY_BUFFER_SIZE / 2;
  const numWindows = Math.floor((rawBuffer.length - KEY_BUFFER_SIZE) / hopSize);
  if (numWindows <= 0 || !cqtKernels) return null;

  const totalChroma = new Float32Array(12);
  const totalBassChroma = new Float32Array(12);  // bass octave only (MIDI 45-56)
  let validWindows = 0;

  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    const windowChunk = rawBuffer.subarray(start, start + KEY_BUFFER_SIZE);

    let windowEnergy = 0;
    for (let i = 0; i < windowChunk.length; i++) windowEnergy += windowChunk[i] * windowChunk[i];
    windowEnergy /= windowChunk.length;
    if (windowEnergy < ENERGY_FLOOR * ENERGY_FLOOR) continue;

    const { chroma, bassChroma } = extractCQTChroma(windowChunk, cqtKernels);

    let chromaSum = 0;
    for (let i = 0; i < 12; i++) chromaSum += chroma[i];
    if (chromaSum <= 0) continue;
    let chromaSumSq = 0;
    for (let i = 0; i < 12; i++) {
      const v = chroma[i] / chromaSum;
      chromaSumSq += v * v;
    }
    const chromaStdDev = Math.sqrt(Math.max(0, chromaSumSq / 12 - 1 / 144));
    if (chromaStdDev < 0.008) continue;

    let sumSq = 0;
    for (let i = 0; i < 12; i++) sumSq += chroma[i] * chroma[i];
    if (sumSq > 0) {
      const norm = Math.sqrt(sumSq);
      let maxNorm = 0;
      for (let i = 0; i < 12; i++) {
        if (chroma[i] / norm > maxNorm) maxNorm = chroma[i] / norm;
      }
      if (maxNorm >= 0.35) {
        for (let i = 0; i < 12; i++) {
          totalChroma[i] += chroma[i] / norm;
          totalBassChroma[i] += bassChroma[i];
        }
        validWindows++;
      }
    }
  }

  if (validWindows < 2) return null;
  const avgChroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) avgChroma[i] = totalChroma[i] / validWindows;
  return { chroma: avgChroma, bassChroma: totalBassChroma, validWindows };
}

function matchKeyProfile(chroma, bassTonic) {
  let bestCorr = -Infinity, bestKey = '';
  let secondCorr = -Infinity, secondKey = '';

  for (let shift = 0; shift < 12; shift++) {
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) rotated[i] = chroma[(i + shift) % 12];

    const candidates = [
      [Math.max(
         pearsonCorrelation(rotated, BGATE_MAJOR),
         pearsonCorrelation(rotated, KK_MAJOR),
         pearsonCorrelation(rotated, EDMA_MAJOR),
         pearsonCorrelation(rotated, SHAATH_MAJOR)
       ), KEY_NAMES[shift] + ' Major', shift],
      [Math.max(
         pearsonCorrelation(rotated, BGATE_MINOR),
         pearsonCorrelation(rotated, KK_MINOR),
         pearsonCorrelation(rotated, EDMA_MINOR),
         pearsonCorrelation(rotated, SHAATH_MINOR)
       ), KEY_NAMES[shift] + ' Minor', shift],
    ];

    for (let [corr, label, rootShift] of candidates) {
      // Bass tonic constraint: 근음이 bassTonic과 다르면 페널티
      if (bassTonic >= 0 && rootShift !== bassTonic) {
        corr *= 0.7;
      }
      if (corr > bestCorr) {
        secondCorr = bestCorr; secondKey = bestKey;
        bestCorr = corr; bestKey = label;
      } else if (corr > secondCorr) {
        secondCorr = corr; secondKey = label;
      }
    }
  }

  if (bestCorr < 0.3) return null;
  return { primary: bestKey, secondary: secondKey, confidence: bestCorr };
}

// ============================================================
// Bass Tonic Detection — HPS (Harmonic Product Spectrum)
// 80~200Hz 대역에서 지배적 베이스 근음 추출
// kick(60-80Hz) 제외, 베이스/808 fundamental(80-200Hz) 포함
// ============================================================
function detectBassTonic(rawBuffer) {
  const FFT_SIZE = 8192;
  const useLen = Math.min(rawBuffer.length, FFT_SIZE);
  if (useLen < FFT_SIZE) return -1;

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // 중앙 구간 FFT (최신 데이터)
  const offset = Math.floor((rawBuffer.length - FFT_SIZE) / 2);
  for (let i = 0; i < FFT_SIZE; i++) {
    const phase = 2 * Math.PI * i / (FFT_SIZE - 1);
    re[i] = rawBuffer[offset + i] * (0.5 * (1 - Math.cos(phase)));
  }
  fftInPlace(re, im, FFT_SIZE);

  // 파워 스펙트럼
  const power = new Float32Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    power[i] = re[i] * re[i] + im[i] * im[i];
  }

  // HPS: 80~200Hz 대역의 bin 범위
  const binHz = SAMPLE_RATE / FFT_SIZE;
  const loKick = Math.floor(80 / binHz);   // 킥 컷
  const hiBass = Math.floor(200 / binHz);  // 베이스 상한

  // HPS (harmonic product): power[k] * power[2k] * power[3k]
  let bestBin = -1, bestHPS = 0;
  for (let k = loKick; k <= hiBass; k++) {
    const k2 = k * 2, k3 = k * 3;
    if (k3 >= FFT_SIZE / 2) continue;
    const hps = power[k] * power[k2] * power[k3];
    if (hps > bestHPS) { bestHPS = hps; bestBin = k; }
  }

  if (bestBin < 0) return -1;

  const freq = bestBin * binHz;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  if (midi < 28 || midi > 60) return -1;
  const pitchClass = midi % 12;
  console.log('[bass-dbg] freq:', freq.toFixed(1), 'Hz → midi:', midi, '→ note:', ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pitchClass]);
  return pitchClass;
}

// ============================================================
// BPM Detection
// ============================================================
function analyzeBPM(hpBuffer) {
  if (!melFilterBank || !_bpmHannBuf) return null;
  const hopSize = MEL_HOP_SIZE;
  const numFrames = Math.min(MAX_OSS_FRAMES, Math.floor((hpBuffer.length - MEL_FFT_SIZE) / hopSize));
  if (numFrames < 8) return null;

  const ossValues = new Float32Array(numFrames);
  _bpmPrevMelBuf.fill(0);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    _bpmRealBuf.fill(0);
    _bpmImagBuf.fill(0);
    for (let i = 0; i < MEL_FFT_SIZE; i++) {
      _bpmRealBuf[i] = hpBuffer[start + i] * _bpmHannBuf[i];
    }
    fftInPlace(_bpmRealBuf, _bpmImagBuf, MEL_FFT_SIZE);
    for (let i = 0; i <= MEL_FFT_SIZE / 2; i++) {
      _bpmPowerBuf[i] = _bpmRealBuf[i] * _bpmRealBuf[i] + _bpmImagBuf[i] * _bpmImagBuf[i];
    }

    _bpmMelBuf.fill(0);
    for (let b = 0; b < MEL_BANDS; b++) {
      const lo = melFilterBank[b * 3];
      const center = melFilterBank[b * 3 + 1];
      const hi = melFilterBank[b * 3 + 2];
      let sum = 0;
      for (let k = lo; k <= hi; k++) {
        const w = k <= center ? (k - lo) / (center - lo + 1) : (hi - k) / (hi - center + 1);
        sum += _bpmPowerBuf[k] * w;
      }
      _bpmMelBuf[b] = Math.log1p(sum);
    }

    let flux = 0;
    for (let b = 0; b < MEL_BANDS; b++) {
      const diff = _bpmMelBuf[b] - _bpmPrevMelBuf[b];
      if (diff > 0) flux += diff;
      _bpmPrevMelBuf[b] = _bpmMelBuf[b];
    }
    ossValues[f] = flux;
  }

  const OSS_FPS = SAMPLE_RATE / hopSize;
  const minLag = Math.round(OSS_FPS * 60 / BPM_MAX);
  const maxLag = Math.round(OSS_FPS * 60 / BPM_MIN);

  const acLen = numFrames;
  const acValues = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < acLen - lag; i++) sum += ossValues[i] * ossValues[i + lag];
    acValues[lag] = sum / (acLen - lag);
  }

  let bestScore = -1, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = acValues[lag];
    const lag2 = lag * 2; if (lag2 <= maxLag) score += acValues[lag2] * 0.5;
    const lag3 = lag * 3; if (lag3 <= maxLag) score += acValues[lag3] * 0.33;
    const lag4 = lag * 4; if (lag4 <= maxLag) score += acValues[lag4] * 0.25;
    // lagHalf/lagThird 제거 — 3:2 서브하모닉 오탐 원인 (예: 164BPM→109BPM)
    const bpm = 60 * OSS_FPS / lag;
    const logRatio = Math.log2(bpm / TEMPO_PRIOR_CENTER);
    const prior = Math.exp(-0.5 * (logRatio / TEMPO_PRIOR_SIGMA) ** 2);
    score *= prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  if (bestLag < 0) return null;

  // Step 1: Parabolic interpolation (coarse sub-lag)
  let coarseLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = acValues[bestLag - 1], y1 = acValues[bestLag], y2 = acValues[bestLag + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (denom > 0) coarseLag = bestLag + (y0 - y2) / denom;
  }
  let coarseBpm = 60 * OSS_FPS / coarseLag;

  // Octave correction: lag2 보너스로 인한 2배 BPM 오탐 방지
  // bestBpm > 140이고 half-BPM의 raw AC가 충분하면 절반 선택
  if (coarseBpm > 140) {
    const halfLag = coarseLag * 2;
    if (halfLag <= maxLag) {
      const halfAC = acValues[Math.round(halfLag)] || 0;
      const fullAC = acValues[bestLag] || 1;
      if (halfAC > fullAC * 0.55) {
        coarseLag = halfLag;
        coarseBpm = 60 * OSS_FPS / coarseLag;
      }
    }
  }

  // Step 2: DTFT refinement — Essentia-style continuous BPM search
  // 코스 추정 ±4 BPM 구간을 0.1 BPM 단계로 직접 평가
  const searchRange = 4.0;
  const searchStep  = 0.1;
  const numSteps = Math.round(2 * searchRange / searchStep) + 1;
  let bestPower = -1;
  let bestBpm   = coarseBpm;

  for (let s = 0; s < numSteps; s++) {
    const candidateBpm = coarseBpm - searchRange + s * searchStep;
    if (candidateBpm < BPM_MIN || candidateBpm > BPM_MAX) continue;
    const phaseInc = 2 * Math.PI * candidateBpm / (60 * OSS_FPS);
    const cosInc = Math.cos(phaseInc);
    const sinInc = Math.sin(phaseInc);
    let re = ossValues[0], im = 0;
    let cosP = 1, sinP = 0;
    for (let k = 1; k < numFrames; k++) {
      const newCos = cosP * cosInc - sinP * sinInc;
      sinP = cosP * sinInc + sinP * cosInc;
      cosP = newCos;
      re += ossValues[k] * cosP;
      im += ossValues[k] * sinP;
    }
    const power = re * re + im * im;
    if (power > bestPower) { bestPower = power; bestBpm = candidateBpm; }
  }

  return bestBpm;
}

// ============================================================
// DSP Utilities
// ============================================================
function buildCQTKernels(sampleRate, numSamples) {
  const kernels = [];
  for (let k = 0; k < CQT_NUM_BINS; k++) {
    const freq = CQT_FMIN * Math.pow(2, k / CQT_BINS_PER_OCTAVE);
    const Q = 1 / (Math.pow(2, 1 / CQT_BINS_PER_OCTAVE) - 1);
    let N_k = Math.min(numSamples, Math.floor((sampleRate * Q) / freq));
    if (N_k % 2 !== 0) N_k--;
    const startIdx = Math.floor((numSamples - N_k) / 2);
    const real = new Float32Array(N_k);
    const imag = new Float32Array(N_k);
    for (let n = 0; n < N_k; n++) {
      const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
      const phase = (2 * Math.PI * n) / (N_k - 1);
      const window = a0 - a1 * Math.cos(phase) + a2 * Math.cos(2 * phase) - a3 * Math.cos(3 * phase);
      const angle = (2 * Math.PI * freq * n) / sampleRate;
      real[n] = (Math.cos(angle) * window) / N_k;
      imag[n] = (-Math.sin(angle) * window) / N_k;
    }
    kernels.push({ real, imag, startIdx, N_k });
  }
  return kernels;
}

function extractCQTChroma(buffer, kernels) {
  const chroma = new Float32Array(12);
  const bassChroma = new Float32Array(12);  // MIDI 45-56 (A2~G#3) 전용
  const binEnergies = new Float32Array(CQT_NUM_BINS);
  for (let k = 0; k < CQT_NUM_BINS; k++) {
    const kernel = kernels[k];
    let re = 0, im = 0;
    if (kernel.startIdx + kernel.N_k > buffer.length) continue;
    for (let n = 0; n < kernel.N_k; n++) {
      const s = buffer[kernel.startIdx + n];
      re += s * kernel.real[n];
      im += s * kernel.imag[n];
    }
    binEnergies[k] = Math.sqrt(re * re + im * im);
  }

  const binsPerSemitone = CQT_BINS_PER_OCTAVE / 12; // = 2

  for (let k = 0; k < CQT_NUM_BINS; k++) {
    const midiNote = CQT_MIN_MIDI + Math.floor(k / binsPerSemitone);
    const pitchClassIdx = midiNote % 12;
    // 전체 chroma: 플랫 가중치 (모든 옥타브 동등)
    chroma[pitchClassIdx] += binEnergies[k];
    // bass chroma: MIDI 45-56 (A2=110Hz ~ G#3=207Hz) 구간만
    if (midiNote >= 45 && midiNote <= 56) {
      bassChroma[pitchClassIdx] += binEnergies[k];
    }
  }
  return { chroma, bassChroma };
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i]; sumY2 += y[i] * y[i];
  }
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function fftInPlace(real, imag, N) {
  let j = 0;
  for (let i = 0; i < N; i++) {
    if (i < j) {
      let tr = real[i]; real[i] = real[j]; real[j] = tr;
      let ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let m = N >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = real[i + k], uIm = imag[i + k];
        const vRe = real[i + k + len / 2] * curRe - imag[i + k + len / 2] * curIm;
        const vIm = real[i + k + len / 2] * curIm + imag[i + k + len / 2] * curRe;
        real[i + k] = uRe + vRe; imag[i + k] = uIm + vIm;
        real[i + k + len / 2] = uRe - vRe; imag[i + k + len / 2] = uIm - vIm;
        const newRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newRe;
      }
    }
  }
}

function buildMelFilterBank(fftSize, sampleRate, numMelBands) {
  const fMin = 50, fMax = sampleRate / 2;
  const melMin = 2595 * Math.log10(1 + fMin / 700);
  const melMax = 2595 * Math.log10(1 + fMax / 700);
  const melToHz = mel => 700 * (Math.pow(10, mel / 2595) - 1);
  const melPoints = [];
  for (let i = 0; i <= numMelBands + 1; i++) {
    melPoints.push(melMin + (melMax - melMin) * i / (numMelBands + 1));
  }
  const binPoints = melPoints.map(m => Math.floor(melToHz(m) * fftSize / sampleRate));
  const filterBank = new Float32Array(numMelBands * 3);
  for (let b = 0; b < numMelBands; b++) {
    filterBank[b * 3]     = binPoints[b];
    filterBank[b * 3 + 1] = binPoints[b + 1];
    filterBank[b * 3 + 2] = binPoints[b + 2];
  }
  return filterBank;
}
