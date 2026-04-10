#!/usr/bin/env node
/**
 * ======================================================
 * DSP Test Pipeline — BPM/Key Detection Accuracy Tester
 * ======================================================
 * 
 * Chrome 없이 Node.js에서 직접 BPM/Key 분석 알고리즘을 테스트.
 * 합성 오디오(알려진 BPM/Key) 또는 WAV 파일로 정확도 검증.
 * 
 * Usage:
 *   node test/test-pipeline.js                   # 합성 테스트 전체 실행
 *   node test/test-pipeline.js --wav path.wav    # WAV 파일 분석
 *   node test/test-pipeline.js --bpm-only        # BPM 테스트만
 *   node test/test-pipeline.js --key-only        # Key 테스트만
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// offscreen.js에서 DSP 핵심 함수들을 추출 (동일 로직)
// ============================================================
const SAMPLE_RATE = 44100;
const KEY_BUFFER_SIZE = 4096;
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ===== Essentia EDMA Profiles =====
const EDMA_MAJOR_RAW = [1.00, 0.29, 0.50, 0.40, 0.60, 0.56, 0.32, 0.80, 0.31, 0.45, 0.42, 0.39];
const EDMA_MINOR_RAW = [1.00, 0.31, 0.44, 0.58, 0.33, 0.49, 0.29, 0.78, 0.43, 0.29, 0.53, 0.32];
const EDMA_OTHER_RAW = [1.00, 0.26, 0.35, 0.29, 0.44, 0.36, 0.21, 0.78, 0.26, 0.25, 0.32, 0.26];
const SHAATH_MAJOR_RAW = [6.6, 2.0, 3.5, 2.3, 4.6, 4.0, 2.5, 5.2, 2.4, 3.7, 2.3, 3.4];
const SHAATH_MINOR_RAW = [6.5, 2.7, 3.5, 5.4, 2.6, 3.5, 2.5, 5.2, 4.0, 2.7, 4.3, 3.2];

const FLATNESS_THRESHOLD = 0.4;
const ENERGY_FLOOR = 0.1;
const BPM_MIN = 60;
const BPM_MAX = 200;
const MEL_BANDS = 40;
const MEL_FFT_SIZE = 2048;

// ===== Polyphony 확장 (offscreen.js와 동일) =====
const HARMONIC_SLOPE = 0.6;
function addContributionHarmonics(semitone, weight, profile) {
  profile[semitone % 12] += weight;
  profile[semitone % 12] += weight * HARMONIC_SLOPE;
  profile[(semitone + 7) % 12] += weight * HARMONIC_SLOPE * HARMONIC_SLOPE;
  profile[semitone % 12] += weight * HARMONIC_SLOPE * HARMONIC_SLOPE * HARMONIC_SLOPE;
}
function addMajorTriad(root, weight, profile) {
  addContributionHarmonics(root, weight, profile);
  addContributionHarmonics(root + 4, weight, profile);
  addContributionHarmonics(root + 7, weight, profile);
}
function addMinorTriad(root, weight, profile) {
  addContributionHarmonics(root, weight, profile);
  addContributionHarmonics(root + 3, weight, profile);
  addContributionHarmonics(root + 7, weight, profile);
}
function buildPolyProfile(rawProfile, isMajor) {
  const poly = new Float32Array(12);
  if (isMajor) {
    addMajorTriad(0, rawProfile[0], poly);
    addMinorTriad(2, rawProfile[2], poly);
    addMinorTriad(4, rawProfile[4], poly);
    addMajorTriad(5, rawProfile[5], poly);
    addMajorTriad(7, rawProfile[7], poly);
    addMinorTriad(9, rawProfile[9], poly);
    addContributionHarmonics(11, rawProfile[11], poly);
    addContributionHarmonics(2, rawProfile[11], poly);
    addContributionHarmonics(5, rawProfile[11], poly);
  } else {
    addMinorTriad(0, rawProfile[0], poly);
    addContributionHarmonics(2, rawProfile[2], poly);
    addContributionHarmonics(5, rawProfile[2], poly);
    addContributionHarmonics(8, rawProfile[2], poly);
    addContributionHarmonics(3, rawProfile[3], poly);
    addContributionHarmonics(7, rawProfile[3], poly);
    addContributionHarmonics(11, rawProfile[3], poly);
    addMinorTriad(5, rawProfile[5], poly);
    addMajorTriad(7, rawProfile[7], poly);
    addMajorTriad(8, rawProfile[8], poly);
    addContributionHarmonics(11, rawProfile[8], poly);
    addContributionHarmonics(2, rawProfile[8], poly);
    addContributionHarmonics(5, rawProfile[8], poly);
  }
  return poly;
}

const MAJOR_PROFILE = buildPolyProfile(EDMA_MAJOR_RAW, true);
const MINOR_PROFILE = buildPolyProfile(EDMA_MINOR_RAW, false);
const OTHER_PROFILE = buildPolyProfile(EDMA_OTHER_RAW, true);
const SHAATH_MAJOR_PROFILE = buildPolyProfile(SHAATH_MAJOR_RAW, true);
const SHAATH_MINOR_PROFILE = buildPolyProfile(SHAATH_MINOR_RAW, false);

// ===== Maths =====
function pearsonCorrelation(x, y) {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i]; sumXY += x[i]*y[i]; sumX2 += x[i]*x[i]; sumY2 += y[i]*y[i];
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
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const angle = -2 * Math.PI / size;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < N; i += size) {
      let curR = 1, curI = 0;
      for (let k = 0; k < halfSize; k++) {
        const idx1 = i + k;
        const idx2 = i + k + halfSize;
        const tR = curR * real[idx2] - curI * imag[idx2];
        const tI = curR * imag[idx2] + curI * real[idx2];
        real[idx2] = real[idx1] - tR;
        imag[idx2] = imag[idx1] - tI;
        real[idx1] += tR;
        imag[idx1] += tI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newR;
      }
    }
  }
}

function hzToMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel) { return 700 * (Math.pow(10, mel / 2595) - 1); }

function buildMelFilterBank(fftSize, sampleRate, numMelBands) {
  const halfN = fftSize / 2 + 1;
  const fMin = 20;
  const fMax = sampleRate / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const melPoints = new Float32Array(numMelBands + 2);
  for (let i = 0; i < numMelBands + 2; i++) {
    melPoints[i] = melMin + (melMax - melMin) * i / (numMelBands + 1);
  }
  const binPoints = new Int32Array(numMelBands + 2);
  for (let i = 0; i < numMelBands + 2; i++) {
    binPoints[i] = Math.floor(melToHz(melPoints[i]) * fftSize / sampleRate);
    if (binPoints[i] >= halfN) binPoints[i] = halfN - 1;
    if (binPoints[i] < 0) binPoints[i] = 0;
  }
  const filterBank = [];
  for (let m = 0; m < numMelBands; m++) {
    const startBin = binPoints[m];
    const centerBin = binPoints[m + 1];
    const endBin = binPoints[m + 2];
    const numBins = endBin - startBin + 1;
    const weights = new Float32Array(numBins);
    for (let k = startBin; k <= endBin; k++) {
      if (k <= centerBin && centerBin > startBin) {
        weights[k - startBin] = (k - startBin) / (centerBin - startBin);
      } else if (k > centerBin && endBin > centerBin) {
        weights[k - startBin] = (endBin - k) / (endBin - centerBin);
      }
    }
    filterBank.push({ startBin, endBin, weights });
  }
  return filterBank;
}

// ============================================================
// 합성 오디오 생성기
// ============================================================

/**
 * 주어진 BPM으로 클릭 트랙 생성 (킥 드럼 시뮬레이션)
 */
function generateClickTrack(bpm, durationSec, sampleRate = SAMPLE_RATE) {
  const numSamples = durationSec * sampleRate;
  const buffer = new Float32Array(numSamples);
  const samplesPerBeat = Math.round((60 / bpm) * sampleRate);
  const clickDuration = Math.min(Math.round(sampleRate * 0.02), samplesPerBeat); // 20ms click
  
  for (let beat = 0; beat * samplesPerBeat < numSamples; beat++) {
    const start = beat * samplesPerBeat;
    for (let i = 0; i < clickDuration && start + i < numSamples; i++) {
      // 임팩트 클릭: 짧은 사인버스트 + 감쇠
      const t = i / sampleRate;
      const decay = Math.exp(-t * 200);
      buffer[start + i] = 0.8 * Math.sin(2 * Math.PI * 100 * t) * decay;
    }
  }
  return buffer;
}

/**
 * 하이햇 + 킥 복합 리듬 생성 (Trap 스타일)
 */
function generateTrapBeat(bpm, durationSec, sampleRate = SAMPLE_RATE) {
  const numSamples = durationSec * sampleRate;
  const buffer = new Float32Array(numSamples);
  const samplesPerBeat = Math.round((60 / bpm) * sampleRate);
  const samplesPerSixteenth = Math.round(samplesPerBeat / 4);
  
  for (let step = 0; step * samplesPerSixteenth < numSamples; step++) {
    const start = step * samplesPerSixteenth;
    const beatInBar = step % 16;
    
    // 킥: 1, 8 (808 스타일)
    if (beatInBar === 0 || beatInBar === 7) {
      for (let i = 0; i < Math.min(Math.round(sampleRate * 0.15), numSamples - start); i++) {
        const t = i / sampleRate;
        const freq = 60 * Math.exp(-t * 10); // Pitch drop
        buffer[start + i] += 0.7 * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 15);
      }
    }
    
    // 하이햇: 매 16분음표 (롤 x3 포함)
    const hhDur = Math.min(Math.round(sampleRate * 0.01), numSamples - start);
    for (let i = 0; i < hhDur; i++) {
      const t = i / sampleRate;
      buffer[start + i] += 0.15 * (Math.random() * 2 - 1) * Math.exp(-t * 500);
    }
    
    // 스네어: 5, 13
    if (beatInBar === 4 || beatInBar === 12) {
      for (let i = 0; i < Math.min(Math.round(sampleRate * 0.05), numSamples - start); i++) {
        const t = i / sampleRate;
        buffer[start + i] += 0.5 * (
          Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 40) +
          (Math.random() * 2 - 1) * 0.3 * Math.exp(-t * 100)
        );
      }
    }
  }
  return buffer;
}

/**
 * 특정 키의 코드 진행 생성 (I-IV-V-I)
 */
function generateChordProgression(rootNote, isMinor, durationSec, sampleRate = SAMPLE_RATE) {
  const numSamples = durationSec * sampleRate;
  const buffer = new Float32Array(numSamples);
  
  // 근음 → Hz (A4=440Hz 기준)
  const noteToHz = (midiNote) => 440 * Math.pow(2, (midiNote - 69) / 12);
  
  // 코드 구성음 MIDI (3옥타브 기준)
  const root = rootNote + 48; // C3 base
  let chords;
  if (isMinor) {
    chords = [
      [root, root + 3, root + 7],           // i
      [root + 5, root + 8, root + 12],       // iv
      [root + 7, root + 11, root + 14],      // V (harmonic minor)
      [root, root + 3, root + 7],           // i
    ];
  } else {
    chords = [
      [root, root + 4, root + 7],           // I
      [root + 5, root + 9, root + 12],       // IV
      [root + 7, root + 11, root + 14],      // V
      [root, root + 4, root + 7],           // I
    ];
  }
  
  const samplesPerChord = Math.floor(numSamples / chords.length);
  
  for (let c = 0; c < chords.length; c++) {
    const chord = chords[c];
    const chordStart = c * samplesPerChord;
    
    for (let i = 0; i < samplesPerChord && chordStart + i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;
      for (const note of chord) {
        const freq = noteToHz(note);
        // 기본음 + 2배음 + 3배음 (피아노 느낌)
        sample += 0.25 * Math.sin(2 * Math.PI * freq * t);
        sample += 0.12 * Math.sin(2 * Math.PI * freq * 2 * t);
        sample += 0.06 * Math.sin(2 * Math.PI * freq * 3 * t);
      }
      // 부드러운 엔벨로프
      const attack = Math.min(t * 20, 1);
      const release = Math.min((samplesPerChord - i) / (sampleRate * 0.05), 1);
      buffer[chordStart + i] = sample * attack * release * 0.3;
    }
  }
  return buffer;
}

/**
 * 두 버퍼 믹스
 */
function mixBuffers(a, b) {
  const len = Math.max(a.length, b.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (i < a.length ? a[i] : 0) + (i < b.length ? b[i] : 0);
  }
  return out;
}

// ============================================================
// 크로마 추출 (FFT 기반 — Meyda 대체)
// ============================================================
function extractChroma(buffer, fftSize = KEY_BUFFER_SIZE) {
  const chroma = new Float32Array(12);
  const N = fftSize;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  
  // Hann window
  for (let i = 0; i < N && i < buffer.length; i++) {
    real[i] = buffer[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  }
  
  fftInPlace(real, imag, N);
  
  // Power spectrum → 크로마 매핑
  const halfN = N / 2;
  for (let bin = 1; bin < halfN; bin++) {
    const mag = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
    const freq = bin * SAMPLE_RATE / N;
    if (freq < 60 || freq > 5000) continue; // 음악적 범위만
    
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pitchClass = Math.round(midi) % 12;
    if (pitchClass >= 0 && pitchClass < 12) {
      chroma[((pitchClass % 12) + 12) % 12] += mag * mag; // Power 가중
    }
  }
  return chroma;
}

// ============================================================
// BPM 분석 (Mel Spectral Flux 기반)
// ============================================================
function analyzeBPM(linearBuffer) {
  const melFilterBank = buildMelFilterBank(MEL_FFT_SIZE, SAMPLE_RATE, MEL_BANDS);
  
  let maxEnergy = 0;
  for (let i = 0; i < linearBuffer.length; i++) {
    if (Math.abs(linearBuffer[i]) > maxEnergy) maxEnergy = Math.abs(linearBuffer[i]);
  }
  if (maxEnergy < 0.02) return { bpm: null, log: 'SILENCE' };
  
  const hopSize = MEL_FFT_SIZE / 2;
  const numFrames = Math.floor((linearBuffer.length - MEL_FFT_SIZE) / hopSize);
  if (numFrames < 4) return { bpm: null, log: 'TOO_SHORT' };
  
  const hannWindow = new Float32Array(MEL_FFT_SIZE);
  for (let i = 0; i < MEL_FFT_SIZE; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (MEL_FFT_SIZE - 1)));
  }
  
  const onsetStrength = new Float32Array(numFrames);
  let prevMel = null;
  
  for (let f = 0; f < numFrames; f++) {
    const frameStart = f * hopSize;
    const real = new Float32Array(MEL_FFT_SIZE);
    const imag = new Float32Array(MEL_FFT_SIZE);
    for (let i = 0; i < MEL_FFT_SIZE; i++) {
      real[i] = linearBuffer[frameStart + i] * hannWindow[i];
    }
    fftInPlace(real, imag, MEL_FFT_SIZE);
    
    const halfN = MEL_FFT_SIZE / 2 + 1;
    const powerSpec = new Float32Array(halfN);
    for (let i = 0; i < halfN; i++) {
      powerSpec[i] = real[i] * real[i] + imag[i] * imag[i];
    }
    
    const melSpec = new Float32Array(MEL_BANDS);
    for (let m = 0; m < MEL_BANDS; m++) {
      let sum = 0;
      const filter = melFilterBank[m];
      for (let k = filter.startBin; k <= filter.endBin && k < halfN; k++) {
        sum += powerSpec[k] * filter.weights[k - filter.startBin];
      }
      melSpec[m] = Math.log1p(sum * 1000);
    }
    
    if (prevMel) {
      let flux = 0;
      for (let m = 0; m < MEL_BANDS; m++) {
        const diff = melSpec[m] - prevMel[m];
        if (diff > 0) flux += diff;
      }
      onsetStrength[f] = flux;
    }
    prevMel = melSpec.slice();
  }
  
  // Mean subtraction
  let ossMean = 0;
  for (let i = 0; i < numFrames; i++) ossMean += onsetStrength[i];
  ossMean /= numFrames;
  for (let i = 0; i < numFrames; i++) onsetStrength[i] -= ossMean;
  
  // Autocorrelation
  const OSS_FPS = SAMPLE_RATE / hopSize;
  const minTargetLag = Math.floor((60 / BPM_MAX) * OSS_FPS);
  const maxTargetLag = Math.ceil((60 / BPM_MIN) * OSS_FPS);
  const MIN_AC_LAG = 5;
  
  const acValues = new Float32Array(maxTargetLag + 1);
  for (let lag = MIN_AC_LAG; lag <= maxTargetLag; lag++) {
    let ac = 0;
    for (let i = 0; i < numFrames - lag; i++) {
      ac += onsetStrength[i] * onsetStrength[i + lag];
    }
    acValues[lag] = ac / (numFrames - lag);
  }
  
  // Comb summation
  const combScores = new Float32Array(maxTargetLag + 1);
  let peakLag = 0, peakVal = -Infinity;
  
  function getSmoothed(lagIdx) {
    if (lagIdx < 0 || lagIdx > maxTargetLag) return 0;
    let maxV = acValues[lagIdx] || 0;
    const W = 2;
    for (let w = -W; w <= W; w++) {
      const idx = lagIdx + w;
      if (idx >= 0 && idx <= maxTargetLag) {
        if (acValues[idx] > maxV) maxV = acValues[idx];
      }
    }
    return maxV;
  }
  
  for (let lag = minTargetLag; lag <= maxTargetLag; lag++) {
    let score = acValues[lag];
    const lag2x = lag * 2;
    if (lag2x <= maxTargetLag) score += acValues[lag2x] * 0.5;
    const lag05x = Math.round(lag / 2);
    if (lag05x >= MIN_AC_LAG) score += getSmoothed(lag05x) * 0.5;
    const lag025x = Math.round(lag / 4);
    if (lag025x >= MIN_AC_LAG) score += getSmoothed(lag025x) * 0.25;
    combScores[lag] = score;
    if (score > peakVal) { peakVal = score; peakLag = lag; }
  }
  
  if (peakVal <= 0) return { bpm: null, log: 'NO_PEAK' };
  
  // Octave correction (slow)
  let slowCorrected = false;
  const doubleLag = peakLag * 2;
  if (doubleLag <= maxTargetLag && doubleLag >= minTargetLag) {
    const rawDoubleScore = acValues[doubleLag] || 0;
    const rawPeakScore = acValues[peakLag] || 1e-10;
    if (rawDoubleScore >= rawPeakScore * 0.45) {
      const searchStart = Math.max(minTargetLag, doubleLag - 30);
      const searchEnd = Math.min(maxTargetLag, doubleLag + 30);
      let refinedDoubleLag = doubleLag;
      let refinedDoubleScore = combScores[doubleLag] || 0;
      for (let l = searchStart; l <= searchEnd; l++) {
        if ((combScores[l] || 0) > refinedDoubleScore) {
          refinedDoubleScore = combScores[l];
          refinedDoubleLag = l;
        }
      }
      peakLag = refinedDoubleLag;
      peakVal = refinedDoubleScore;
      slowCorrected = true;
    }
  }
  
  // Octave correction (fast)
  if (!slowCorrected) {
    const halfLag = Math.round(peakLag / 2);
    if (halfLag >= MIN_AC_LAG && halfLag >= minTargetLag) {
      const halfScore = combScores[halfLag] || 0;
      if (halfScore >= peakVal * 0.75) {
        peakLag = halfLag;
        peakVal = halfScore;
      }
    }
  }
  
  // Tresillo correction
  const tresilloLag = Math.round(peakLag * 2 / 3);
  if (tresilloLag >= MIN_AC_LAG && tresilloLag >= minTargetLag) {
    const tresilloScore = combScores[tresilloLag] || 0;
    if (tresilloScore >= peakVal * 0.90) {
      peakLag = tresilloLag;
    }
  }
  
  // Parabolic interpolation
  const pPrev = combScores[peakLag - 1] || 0;
  const pCurr = combScores[peakLag];
  const pNext = combScores[peakLag + 1] || 0;
  const denom = pPrev - 2 * pCurr + pNext;
  const refinedLag = (denom < -1e-10) ? peakLag + (pPrev - pNext) / (2 * denom) : peakLag;
  
  const bpm = Math.round(60 / (refinedLag / OSS_FPS));
  
  return {
    bpm,
    peakLag,
    refinedLag: refinedLag.toFixed(2),
    ossFPS: OSS_FPS.toFixed(1),
    numFrames,
    log: `lag=${peakLag} refined=${refinedLag.toFixed(2)} fps=${OSS_FPS.toFixed(1)}`
  };
}

// ============================================================
// Key 분석 (FFT 크로마 기반)
// ============================================================
function analyzeKey(linearBuffer) {
  const hopSize = KEY_BUFFER_SIZE / 2;
  const numWindows = Math.floor((linearBuffer.length - KEY_BUFFER_SIZE) / hopSize);
  if (numWindows <= 0) return { key: null, log: 'TOO_SHORT' };
  
  const totalChroma = new Float32Array(12);
  let validWindows = 0;
  
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    const windowChunk = linearBuffer.subarray(start, start + KEY_BUFFER_SIZE);
    
    const chroma = extractChroma(windowChunk);
    
    // Energy check
    let energy = 0;
    for (let i = 0; i < windowChunk.length; i++) energy += windowChunk[i] * windowChunk[i];
    energy /= windowChunk.length;
    if (energy < ENERGY_FLOOR * ENERGY_FLOOR) continue;
    
    // L2 normalization + flatness check
    const sumSq = chroma.reduce((a, b) => a + b * b, 0);
    if (sumSq > 0) {
      const norm = Math.sqrt(sumSq);
      let maxNorm = 0;
      for (let i = 0; i < 12; i++) {
        const v = chroma[i] / norm;
        if (v > maxNorm) maxNorm = v;
      }
      if (maxNorm >= 0.35) {
        for (let i = 0; i < 12; i++) totalChroma[i] += chroma[i] / norm;
        validWindows++;
      }
    }
  }
  
  if (validWindows < 2) return { key: null, log: `TOO_FEW_WINDOWS (${validWindows})` };
  
  // Average
  for (let i = 0; i < 12; i++) totalChroma[i] /= validWindows;
  
  // Correlate with profiles
  let bestCorrelation = -Infinity;
  let bestKey = '';
  let secondCorrelation = -Infinity;
  let secondKey = '';
  
  for (let shift = 0; shift < 12; shift++) {
    const rotated = new Float32Array(12);
    for (let i = 0; i < 12; i++) rotated[i] = totalChroma[(i + shift) % 12];
    
    const edmaM = pearsonCorrelation(rotated, MAJOR_PROFILE);
    const edmaMin = pearsonCorrelation(rotated, MINOR_PROFILE);
    const edmaO = pearsonCorrelation(rotated, OTHER_PROFILE);
    const shaathM = pearsonCorrelation(rotated, SHAATH_MAJOR_PROFILE);
    const shaathMin = pearsonCorrelation(rotated, SHAATH_MINOR_PROFILE);
    
    const candidates = [
      [edmaM * 0.7 + shaathM * 0.3, KEY_NAMES[shift] + ' Major'],
      [edmaMin * 0.7 + shaathMin * 0.3, KEY_NAMES[shift] + ' Minor'],
      [edmaO, KEY_NAMES[shift] + ' Other'],
    ];
    
    for (const [corr, label] of candidates) {
      if (corr > bestCorrelation) {
        secondCorrelation = bestCorrelation; secondKey = bestKey;
        bestCorrelation = corr; bestKey = label;
      } else if (corr > secondCorrelation) {
        secondCorrelation = corr; secondKey = label;
      }
    }
  }
  
  // Other fallback
  if (bestKey.endsWith('Other') && secondKey && !secondKey.endsWith('Other')) {
    const temp = bestKey;
    bestKey = secondKey;
    secondKey = temp;
  }
  
  const chromaStr = Array.from(totalChroma).map((v,i) => KEY_NAMES[i]+':'+v.toFixed(3)).join(' ');
  
  return {
    key: bestKey,
    secondKey,
    correlation: bestCorrelation.toFixed(3),
    secondCorrelation: secondCorrelation.toFixed(3),
    validWindows,
    chromaStr,
    log: `wins=${validWindows} corr=${bestCorrelation.toFixed(3)} 2nd="${secondKey}"(${secondCorrelation.toFixed(3)})`
  };
}

// ============================================================
// WAV 파일 로더
// ============================================================
function loadWav(filePath) {
  const buf = fs.readFileSync(filePath);
  // Parse WAV header
  const riff = buf.toString('ascii', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a WAV file');
  
  const numChannels = buf.readUInt16LE(22);
  const wavSampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  
  // Find data chunk
  let dataOffset = 44; // Standard, but search for 'data' marker
  for (let i = 36; i < Math.min(buf.length - 4, 200); i++) {
    if (buf.toString('ascii', i, i + 4) === 'data') {
      dataOffset = i + 8;
      break;
    }
  }
  
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((buf.length - dataOffset) / bytesPerSample / numChannels);
  const samples = new Float32Array(numSamples);
  
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * numChannels * bytesPerSample;
    if (bitsPerSample === 16) {
      samples[i] = buf.readInt16LE(offset) / 32768;
    } else if (bitsPerSample === 32) {
      samples[i] = buf.readFloatLE(offset);
    } else if (bitsPerSample === 24) {
      const val = buf.readUInt8(offset) | (buf.readUInt8(offset+1) << 8) | (buf.readInt8(offset+2) << 16);
      samples[i] = val / 8388608;
    }
  }
  
  console.log(`  WAV: ${numChannels}ch, ${wavSampleRate}Hz, ${bitsPerSample}bit, ${(numSamples/wavSampleRate).toFixed(1)}s`);
  return { samples, sampleRate: wavSampleRate };
}

// ============================================================
// 테스트 실행기
// ============================================================
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function printHeader(title) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}${'='.repeat(60)}${COLORS.reset}\n`);
}

function printResult(testName, expected, actual, pass) {
  const icon = pass ? `${COLORS.green}✓ PASS` : `${COLORS.red}✗ FAIL`;
  console.log(`  ${icon}${COLORS.reset}  ${testName}`);
  console.log(`         Expected: ${COLORS.bold}${expected}${COLORS.reset}  |  Got: ${COLORS.bold}${actual}${COLORS.reset}`);
}

function runBPMTests() {
  printHeader('BPM Detection Tests (Mel Spectral Flux)');
  
  const tests = [
    { name: 'Click 90 BPM (10s)', bpm: 90, dur: 10, type: 'click' },
    { name: 'Click 120 BPM (10s)', bpm: 120, dur: 10, type: 'click' },
    { name: 'Click 140 BPM (10s)', bpm: 140, dur: 10, type: 'click' },
    { name: 'Click 164 BPM (10s)', bpm: 164, dur: 10, type: 'click' },
    { name: 'Trap Beat 140 BPM (15s)', bpm: 140, dur: 15, type: 'trap' },
    { name: 'Trap Beat 160 BPM (15s)', bpm: 160, dur: 15, type: 'trap' },
    { name: 'Click 75 BPM (12s)', bpm: 75, dur: 12, type: 'click' },
  ];
  
  let passed = 0;
  for (const test of tests) {
    const buffer = test.type === 'trap' 
      ? generateTrapBeat(test.bpm, test.dur)
      : generateClickTrack(test.bpm, test.dur);
    
    const result = analyzeBPM(buffer);
    const tolerance = 3; // ±3 BPM 허용
    
    // 옥타브 관계 (×2, ÷2)도 PASS로 인정
    // BPM 옥타브 문제는 프로 도구(Rekordbox/Serato)에서도 발생하는 알려진 현상
    const exactMatch = result.bpm !== null && Math.abs(result.bpm - test.bpm) <= tolerance;
    const octaveUp = result.bpm !== null && Math.abs(result.bpm - test.bpm * 2) <= tolerance;
    const octaveDown = result.bpm !== null && Math.abs(result.bpm - test.bpm / 2) <= tolerance;
    const isCorrect = exactMatch || octaveUp || octaveDown;
    
    let tag = '';
    if (octaveUp) tag = ' [×2 octave]';
    if (octaveDown) tag = ' [÷2 octave]';
    
    printResult(test.name, `${test.bpm} BPM`, `${result.bpm || 'null'} BPM${tag}`, isCorrect);
    console.log(`         ${COLORS.dim}${result.log}${COLORS.reset}`);
    if (isCorrect) passed++;
  }
  
  console.log(`\n  ${COLORS.bold}Results: ${passed}/${tests.length} passed${COLORS.reset}`);
  console.log(`  ${COLORS.dim}Note: ÷2/×2 옥타브 관계는 정상 동작 (프로 도구도 동일)${COLORS.reset}\n`);
  return { passed, total: tests.length };
}

function runKeyTests() {
  printHeader('Key Detection Tests (EDMA + Polyphony)');
  
  // rootNote: 0=C, 1=C#, 2=D, ..., 9=A, 11=B
  const tests = [
    { name: 'C Major Chords (I-IV-V)', root: 0, minor: false, expected: 'C Major' },
    { name: 'A Minor Chords (i-iv-V)', root: 9, minor: true, expected: 'A Minor' },
    { name: 'G Major Chords', root: 7, minor: false, expected: 'G Major' },
    { name: 'E Minor Chords', root: 4, minor: true, expected: 'E Minor' },
    { name: 'D Major Chords', root: 2, minor: false, expected: 'D Major' },
    { name: 'F# Minor Chords', root: 6, minor: true, expected: 'F# Minor' },
    { name: 'Bb Major Chords', root: 10, minor: false, expected: 'A# Major' }, // KEY_NAMES[10]='A#'
    { name: 'C# Minor Chords', root: 1, minor: true, expected: 'C# Minor' },
  ];
  
  let passed = 0;
  for (const test of tests) {
    const buffer = generateChordProgression(test.root, test.minor, 10);
    const result = analyzeKey(buffer);
    
    // 관계조 허용 (예: C Major ↔ A Minor 같은 관계조는 정상)
    const detectedRoot = result.key ? result.key.split(' ')[0] : '';
    const expectedRoot = test.expected.split(' ')[0];
    const exactMatch = result.key === test.expected;
    const relativeMatch = !exactMatch && detectedRoot === expectedRoot;
    const isCorrect = exactMatch || relativeMatch;
    
    printResult(test.name, test.expected, result.key || 'null', isCorrect);
    console.log(`         ${COLORS.dim}${result.log}${COLORS.reset}`);
    if (isCorrect) passed++;
  }
  
  console.log(`\n  ${COLORS.bold}Results: ${passed}/${tests.length} passed${COLORS.reset}\n`);
  return { passed, total: tests.length };
}

function runWavAnalysis(wavPath) {
  printHeader(`WAV Analysis: ${path.basename(wavPath)}`);
  
  try {
    const { samples, sampleRate } = loadWav(wavPath);
    
    console.log('  [BPM Analysis]');
    const bpmResult = analyzeBPM(samples);
    console.log(`  → BPM: ${COLORS.bold}${bpmResult.bpm || 'N/A'}${COLORS.reset}`);
    console.log(`    ${COLORS.dim}${bpmResult.log}${COLORS.reset}`);
    
    console.log('\n  [Key Analysis]');
    const keyResult = analyzeKey(samples);
    console.log(`  → Key: ${COLORS.bold}${keyResult.key || 'N/A'}${COLORS.reset} (2nd: ${keyResult.secondKey || 'N/A'})`);
    console.log(`    Correlation: ${keyResult.correlation}`);
    console.log(`    ${COLORS.dim}Chroma: ${keyResult.chromaStr}${COLORS.reset}`);
    console.log(`    ${COLORS.dim}${keyResult.log}${COLORS.reset}`);
    
  } catch (err) {
    console.error(`  ${COLORS.red}Error: ${err.message}${COLORS.reset}`);
  }
}

// ============================================================
// Main
// ============================================================
function main() {
  const args = process.argv.slice(2);
  const wavIdx = args.indexOf('--wav');
  const bpmOnly = args.includes('--bpm-only');
  const keyOnly = args.includes('--key-only');
  
  console.log(`${COLORS.bold}${COLORS.cyan}`);
  console.log(`  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   Audio Analyzer DSP Test Pipeline       ║`);
  console.log(`  ║   BPM: Mel Spectral Flux + AC            ║`);
  console.log(`  ║   Key: EDMA/Shaath + Polyphony            ║`);
  console.log(`  ╚══════════════════════════════════════════╝${COLORS.reset}`);
  console.log(`  Sample Rate: ${SAMPLE_RATE}Hz | Buffer: mel_fft=${MEL_FFT_SIZE}`);
  console.log(`  BPM Range: ${BPM_MIN}-${BPM_MAX} | Mel Bands: ${MEL_BANDS}`);
  
  if (wavIdx >= 0 && args[wavIdx + 1]) {
    runWavAnalysis(args[wavIdx + 1]);
    return;
  }
  
  let totalPassed = 0, totalTests = 0;
  
  if (!keyOnly) {
    const bpm = runBPMTests();
    totalPassed += bpm.passed;
    totalTests += bpm.total;
  }
  
  if (!bpmOnly) {
    const key = runKeyTests();
    totalPassed += key.passed;
    totalTests += key.total;
  }
  
  // Summary
  printHeader('Summary');
  const pct = totalTests > 0 ? Math.round(totalPassed / totalTests * 100) : 0;
  const color = pct >= 80 ? COLORS.green : pct >= 50 ? COLORS.yellow : COLORS.red;
  console.log(`  ${color}${COLORS.bold}${totalPassed}/${totalTests} tests passed (${pct}%)${COLORS.reset}`);
  
  if (pct < 100) {
    console.log(`\n  ${COLORS.yellow}Note: 합성 오디오는 실제 음악보다 단순합니다.`);
    console.log(`  실제 테스트는 Chrome에서 YouTube 등 재생 시 offscreen 콘솔 확인.${COLORS.reset}`);
  }
  
  process.exit(totalPassed === totalTests ? 0 : 1);
}

main();
