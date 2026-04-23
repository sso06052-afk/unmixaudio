// sandbox.js — Essentia WASM + TempoCNN ML runner
// CSP here allows eval/new Function → Emscripten WASM glue works
// Communicates with offscreen.js via postMessage (iframe parent)

let essentia = null;
let essentiaReady = false;
let wasmModule = null;
let SAMPLE_RATE = 44100;

// ── TempoCNN (ML BPM detection) ──────────────────────────────
// EssentiaTFInputExtractor 사용 안 함 (WASM 빌드에 TFInputExtractor 없음)
// → TF.js tf.signal.stft로 mel spectrogram 직접 계산
let tempoCNNModel = null;
let melFilterMatrix = null; // [513, 40] — 한 번만 빌드, 재사용

// TempoCNN output: 256-class softmax, linear BPM range 30→285
// classifier.py 원 소스 스펙: index 0=30BPM, index 255=285BPM, 1BPM 간격 256 클래스
const BPM_BINS = Float32Array.from({length: 256}, (_, i) => 30 + i);

async function initTempoCNN() {
  if (!window.tf) { console.warn('[sandbox] TF.js 없음, BPM은 RhythmExtractor fallback'); return; }
  try {
    // sandbox iframe에 WebGL 없음 → CPU 백엔드 강제 (fragment shader 오류 방지)
    await tf.setBackend('cpu');
    await tf.ready();
    console.log('[sandbox] TF.js backend:', tf.getBackend());
    tempoCNNModel = await tf.loadGraphModel('lib/tempocnn/model.json');
    console.log('[sandbox] TempoCNN ready');
  } catch(e) {
    console.warn('[sandbox] TempoCNN 로드 실패:', e.message);
    tempoCNNModel = null;
  }
}

// Mel filterbank 행렬 [numSpecBins, numMelBands] — TF.js tensor
function buildMelFilterTensor(numMelBands, fftSize, sampleRate, fMin, fMax) {
  const numBins = fftSize / 2 + 1;
  const melMin = 2595 * Math.log10(1 + fMin / 700);
  const melMax = 2595 * Math.log10(1 + fMax / 700);
  const melToHz = m => 700 * (Math.pow(10, m / 2595) - 1);
  const melPoints = [];
  for (let i = 0; i <= numMelBands + 1; i++) {
    melPoints.push(melMin + (melMax - melMin) * i / (numMelBands + 1));
  }
  const binPoints = melPoints.map(m => Math.floor(melToHz(m) * fftSize / sampleRate));
  const matrix = new Float32Array(numBins * numMelBands);
  for (let b = 0; b < numMelBands; b++) {
    const lo = binPoints[b], center = binPoints[b + 1], hi = binPoints[b + 2];
    for (let k = lo; k < center && k < numBins; k++) {
      if (k >= 0) matrix[k * numMelBands + b] = (k - lo) / Math.max(1, center - lo);
    }
    for (let k = center; k <= hi && k < numBins; k++) {
      if (k >= 0) matrix[k * numMelBands + b] = (hi - k) / Math.max(1, hi - center);
    }
    // Slaney normalization: 2.0 / bandwidth_hz (librosa norm='slaney' 기본값 동일)
    const loHz = melToHz(melPoints[b]);
    const hiHz = melToHz(melPoints[b + 2]);
    const norm = 2.0 / Math.max(1e-8, hiHz - loHz);
    for (let k = 0; k < numBins; k++) {
      matrix[k * numMelBands + b] *= norm;
    }
  }
  return tf.tensor2d(matrix, [numBins, numMelBands]);
}

// 48000Hz → 11025Hz 다운샘플 (가중 평균 anti-aliasing)
// Math.ceil(ratio) 올림 방식은 48kHz에서 ratio=4.354 → step=5로 경계 샘플 중복 참조,
// 주기적 시간 왜곡 발생 → 실수 ratio 기반 가중 평균으로 수정
function resampleTo11025(pcm, fromRate) {
  const ratio = fromRate / 11025;
  const outLen = Math.floor(pcm.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = i * ratio;
    const e = s + ratio;
    const si = Math.floor(s);
    const ei = Math.min(Math.ceil(e), pcm.length);
    let sum = 0, weight = 0;
    for (let j = si; j < ei; j++) {
      const lo = Math.max(s, j);
      const hi = Math.min(e, j + 1);
      const w = hi - lo;
      sum += pcm[j] * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

async function detectBPMTempoCNN(pcm, sampleRate) {
  if (!tempoCNNModel || !window.tf) return null;
  const TARGET_SR = 11025, FRAME_SIZE = 1024, HOP_SIZE = 512;
  const MEL_BANDS = 40, PATCH_SIZE = 256;

  try {
    const resampled = resampleTo11025(pcm, sampleRate);

    // Mel filterbank 최초 1회 빌드
    if (!melFilterMatrix) {
      melFilterMatrix = buildMelFilterTensor(MEL_BANDS, FRAME_SIZE, TARGET_SR, 20, 5000); // TempoCNN 원 소스(feature.py) 스펙: fMax=5000Hz
    }

    // tf.signal.stft → magnitude → mel → log
    const signal = tf.tensor1d(resampled);
    // stft shape: [numFrames, FRAME_SIZE/2+1] (complex)
    const stft = tf.signal.stft(signal, FRAME_SIZE, HOP_SIZE, FRAME_SIZE, tf.signal.hannWindow);
    signal.dispose();

    const mag = stft.abs(); // [numFrames, 513]
    stft.dispose();

    const power = mag.square(); // power spectrum = magnitude^2 (librosa melspectrogram 입력)
    mag.dispose();

    const mel = power.matMul(melFilterMatrix); // [numFrames, 40]
    power.dispose();

    // power_to_db: 10 * log10(max(mel, 1e-7)) — librosa power_to_db(ref=1.0, amin=1e-7) 동일
    const logMel = mel.clipByValue(1e-7, Infinity).log().mul(10 / Math.LN10);
    mel.dispose();

    const WINDOW_HOP = 128; // 원본 feature.py 스펙 (50% overlap)
    const numFrames = logMel.shape[0];
    const numPatches = Math.max(0, Math.floor((numFrames - PATCH_SIZE) / WINDOW_HOP) + 1);

    if (numPatches === 0) {
      logMel.dispose();
      console.warn(`[sandbox] TempoCNN: frames ${numFrames} < patch ${PATCH_SIZE}, fallback`);
      return null;
    }

    // 전체 log mel 데이터를 한 번에 가져옴
    const logMelData = await logMel.array(); // [numFrames][40]
    logMel.dispose();

    const accPred = new Float32Array(256);
    for (let p = 0; p < numPatches; p++) {
      const off = p * WINDOW_HOP;  // hop=128 (50% overlap)
      // [patchSize, melBands] → [1, melBands, patchSize, 1] (model 입력 포맷)
      const patchData = new Float32Array(MEL_BANDS * PATCH_SIZE);
      for (let t = 0; t < PATCH_SIZE; t++) {
        const frame = logMelData[off + t];
        for (let b = 0; b < MEL_BANDS; b++) {
          patchData[b * PATCH_SIZE + t] = frame[b];
        }
      }
      const inp = tf.tensor4d(patchData, [1, MEL_BANDS, PATCH_SIZE, 1]);
      const out = tempoCNNModel.execute({input: inp});
      const pred = await out.data(); // Float32Array(256) softmax
      for (let i = 0; i < 256; i++) accPred[i] += pred[i];
      inp.dispose();
      if (out && typeof out.dispose === 'function') out.dispose();
    }

    // Weighted average → BPM
    let wSum = 0, bpmSum = 0;
    for (let i = 0; i < 256; i++) { wSum += accPred[i]; bpmSum += accPred[i] * BPM_BINS[i]; }
    const bpm = wSum > 0 ? bpmSum / wSum : null;
    if (bpm) console.log(`[sandbox] TempoCNN BPM=${bpm.toFixed(1)} (${numPatches} patches)`);
    return bpm;
  } catch(e) {
    console.error('[sandbox] TempoCNN 에러:', e);
    return null;
  }
}

// ── RMS 정규화 ──────────────────────────────────────────────
function normalizeRMS(pcm, target) {
  let rms = 0;
  for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
  rms = Math.sqrt(rms / pcm.length);
  if (rms < 1e-6) return pcm;
  const scale = target / rms;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * scale;
  return out;
}

// ── Essentia 초기화 ──────────────────────────────────────────
async function initEssentia() {
  if (essentiaReady) return;
  try {
    wasmModule = await EssentiaWASM();
    essentia = new Essentia(wasmModule);
    essentiaReady = true;
    window.parent.postMessage({ type: 'sandbox-ready' }, '*');
    console.log('[sandbox] Essentia version:', essentia.version);
    await initTempoCNN(); // TF.js 로드 완료 후 모델 초기화
  } catch(err) {
    window.parent.postMessage({ type: 'sandbox-error', error: String(err) }, '*');
  }
}

initEssentia();

// ── 메시지 수신 ──────────────────────────────────────────────
window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'analyze') {
    if (!essentiaReady) {
      window.parent.postMessage({ type: 'sandbox-error', error: 'Essentia not ready' }, '*');
      return;
    }
    SAMPLE_RATE = msg.sampleRate || 44100;
    const bufLen = msg.rawBuffer ? msg.rawBuffer.byteLength / 4 : 0;
    console.log(`[sandbox-analyze] sampleRate=${SAMPLE_RATE} bufLen=${bufLen} dur=${(bufLen/SAMPLE_RATE).toFixed(1)}s`);
    const result = {};

    // ── Key Detection ─────────────────────────────────────────
    // rawBuffer = HPSS harmonic 성분 (offscreen.js에서 전처리됨)
    // pcpThreshold: 0.05 — 약한 배음 유지 (단조 특유의 flat 3rd/6th/7th 보존)
    // 3 프로파일 앙상블: bgate + temperley + edma
    try {
      // ① HPSS harmonic 버퍼 사용 — 808 타악기 성분 제거
      const raw = normalizeRMS(new Float32Array(msg.hpBuffer), 0.1);
      const audioVec = essentia.arrayToVector(raw);

      // bgate: Beatport(EDM) 데이터 기반 / edma: EDM 코퍼스 자동 추출 (Faraldo et al. 2017, EDM에서 edma > temperley)
      // krumhansl: 팝 일반 심리음향 프로파일 (다양한 장르 커버) / temperley: 유럽 클래식 코퍼스 기반 → EDM/Hip-Hop 부적합으로 교체
      const KEY_PROFILES = ['bgate', 'edma', 'krumhansl'];
      const profileResults = [];
      for (const profile of KEY_PROFILES) {
        const r = essentia.KeyExtractor(
          audioVec,
          true,     // averageDetuningCorrection
          4096,     // frameSize
          2048,     // hopSize
          36,       // hpcpSize
          3500,     // maxFrequency
          60,       // maximumSpectralPeaks
          250,      // minFrequency — 808 1차 배음(258Hz) 차단, 멜로디 저음(250Hz+) 보존 (② 500→250)
          0.05,     // pcpThreshold
          profile,
          SAMPLE_RATE,
          0.0001,
          440,
          'cosine',
          'hann'
        );
        console.log(`[key-profile] ${profile}: ${r.key} ${r.scale} strength=${r.strength.toFixed(3)}`);
        profileResults.push({ key: r.key, scale: r.scale, strength: r.strength });
      }
      audioVec.delete();

      // 다수결: 2개 이상 같은 key+scale → 그거 채택, 전부 다르면 strength 최고값
      const votes = {};
      for (const r of profileResults) {
        const label = `${r.key} ${r.scale}`;
        if (!votes[label]) votes[label] = { key: r.key, scale: r.scale, count: 0, maxStrength: 0 };
        votes[label].count++;
        if (r.strength > votes[label].maxStrength) votes[label].maxStrength = r.strength;
      }

      // 다수결 먼저 수행 (penalty 없이) — 이전 코드는 다수결 이전에 votes와 profileResults 양쪽에
      // penalty를 적용하여 다수결 로직을 무력화했음. 순서 수정.
      let bestKey = null, bestScale = null, bestStrength = -1;
      for (const v of Object.values(votes)) {
        if (v.count >= 2 && v.maxStrength > bestStrength) {
          bestStrength = v.maxStrength; bestKey = v.key; bestScale = v.scale;
        }
      }
      if (!bestKey) {
        for (const r of profileResults) {
          if (r.strength > bestStrength) { bestStrength = r.strength; bestKey = r.key; bestScale = r.scale; }
        }
      }

      // bass tonic soft constraint — 다수결 결과에만 적용
      // 상대조 예외: Major의 relative minor는 장조 루트에서 9반음 위 (예: C Major → A Minor)
      // 반대로 minor의 relative major는 단조 루트에서 3반음 위 (예: A Minor → C Major: (9+3)%12=0)
      const bassTonic = (msg.bassTonic !== undefined && msg.bassTonic >= 0) ? msg.bassTonic : -1;
      const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      if (bassTonic >= 0 && bestKey) {
        const rootIdx = NOTE_NAMES.indexOf(bestKey);
        const isRootMatch = rootIdx === bassTonic;
        // 상대조: Major의 relative minor root = (bassTonic + 9) % 12
        //         minor의 relative major root = (bassTonic + 3) % 12
        const isRelativeMatch = (bestScale === 'minor' && rootIdx === (bassTonic + 9) % 12) ||
                                (bestScale === 'major' && rootIdx === (bassTonic + 3) % 12);
        if (!isRootMatch && !isRelativeMatch) {
          bestStrength *= 0.75; // 페널티 완화 (0.6→0.75): 다수결 이후 적용이라 영향 최소화
        }
        console.log(`[bass-constraint] tonic=${NOTE_NAMES[bassTonic]} result=${bestKey} ${bestScale} rootMatch=${isRootMatch} relMatch=${isRelativeMatch}`);
      }
      console.log(`[key-final] ${bestKey} ${bestScale} strength=${bestStrength.toFixed(3)}`);
      result.key = bestKey;
      result.scale = bestScale;
      result.strength = bestStrength;
    } catch(e) {
      result.keyError = String(e);
      console.error('[sandbox] KeyExtractor:', e);
    }

    // ── BPM Detection ─────────────────────────────────────────
    // TempoCNN (ML) 우선, 실패 시 RhythmExtractor2013 fallback
    try {
      const rawForBPM = normalizeRMS(new Float32Array(msg.hpBuffer), 0.1);
      let bpmValue = await detectBPMTempoCNN(rawForBPM, SAMPLE_RATE);

      if (bpmValue !== null) {
        result.bpm = bpmValue;
      } else {
        // Fallback: RhythmExtractor2013
        const hpVec = essentia.arrayToVector(rawForBPM);
        const rhythmResult = essentia.RhythmExtractor2013(hpVec, 220, 'multifeature', 50);
        hpVec.delete();
        // RhythmExtractor2013은 sampleRate를 직접 받아 내부 처리 후 샘플레이트 독립적 BPM 반환
        // 추가 보정 불필요 — 48kHz 환경에서 (SAMPLE_RATE/44100) 곱하면 BPM 8.8% 부풀림 발생
        result.bpm = rhythmResult.bpm;
        console.log(`[sandbox] RhythmExtractor fallback BPM=${result.bpm.toFixed(1)}`);
      }
    } catch(e) {
      result.bpmError = String(e);
      console.error('[sandbox] BPM:', e);
    }

    window.parent.postMessage({ type: 'analysis-result', result }, '*');
  }
});
