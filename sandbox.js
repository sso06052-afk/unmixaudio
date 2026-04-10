// sandbox.js — Essentia WASM runner (inside Chrome Extension sandbox page)
// CSP here allows eval/new Function, so Essentia WASM glue code works.
// Communicates with offscreen.js via postMessage.

let essentia = null;
let essentiaReady = false;
let SAMPLE_RATE = 44100;

// Initialize Essentia WASM
async function initEssentia() {
  if (essentiaReady) return;
  const wasmModule = await EssentiaWASM();
  essentia = new Essentia(wasmModule);
  essentiaReady = true;
  // Notify offscreen that sandbox is ready
  window.parent.postMessage({ type: 'sandbox-ready' }, '*');
}

initEssentia().catch(err => {
  window.parent.postMessage({ type: 'sandbox-error', error: String(err) }, '*');
});

// Handle analysis requests from offscreen.js
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'analyze') {
    if (!essentiaReady) {
      window.parent.postMessage({ type: 'sandbox-error', error: 'Essentia not ready' }, '*');
      return;
    }
    SAMPLE_RATE = msg.sampleRate || 44100;
    const result = {};

    // ── Key Detection ──
    try {
      const audioVec = essentia.arrayToVector(new Float32Array(msg.rawBuffer));
      const keyResult = essentia.KeyExtractor(
        audioVec,
        true,        // averageDetuningCorrection
        4096,        // frameSize
        4096,        // hopSize
        12,          // hpcpSize
        3500,        // maxFrequency
        60,          // maximumSpectralPeaks
        25,          // minFrequency
        0.2,         // pcpThreshold
        'edma',      // profileType — EDM/Hip-hop 특화
        SAMPLE_RATE,
        0.0001,      // spectralPeaksThreshold
        440,         // tuningFrequency
        'cosine',    // weightType
        'hann'       // windowType
      );
      audioVec.delete();
      result.key = keyResult.key;
      result.scale = keyResult.scale;
      result.strength = keyResult.strength;
    } catch (e) {
      result.keyError = String(e);
    }

    // ── BPM Detection ──
    try {
      const hpVec = essentia.arrayToVector(new Float32Array(msg.hpBuffer));
      const bpmResult = essentia.PercivalBpmEstimator(
        hpVec,
        1024,        // frameSize
        2048,        // frameSizeOSS
        128,         // hopSize
        128,         // hopSizeOSS
        220,         // maxBPM
        50,          // minBPM
        SAMPLE_RATE
      );
      hpVec.delete();
      result.bpm = bpmResult.bpm;
    } catch (e) {
      result.bpmError = String(e);
    }

    window.parent.postMessage({ type: 'analysis-result', result }, '*');
  }
});
