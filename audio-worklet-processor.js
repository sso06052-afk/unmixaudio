/**
 * audio-worklet-processor.js
 * 
 * AudioWorklet Processor — 3-채널 링버퍼 축적기
 * Raw (Key용), Highpass (BPM용), Lowpass (베이스 토닉 F0용)
 * 
 * ScriptProcessor 대비 장점:
 *  - 전용 오디오 렌더링 스레드 실행 (메인스레드 UI와 경쟁 없음)
 *  - 3ms 렌더 예산 내 안정적 처리 → 프레임 드롭/크로마 오염 제거
 *  - Chrome MV3 기준 권장 방식
 */
class AudioRingBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const { bufferSize, highpassFreq, lowpassFreq, sampleRate } = options.processorOptions;

    this._bufSize = bufferSize;

    // ── 3채널 링버퍼 ──────────────────────────────────────
    this._raw = new Float32Array(bufferSize);
    this._hp  = new Float32Array(bufferSize);
    this._lp  = new Float32Array(bufferSize);
    this._idx = 0; // 단일 공유 인덱스 (3채널 동기화)

    // ── Highpass 2차 Butterworth Biquad ───────────────────
    // RBJ cookbook: Q=1/√2 (-12dB/oct) — 1차 대비 808 베이스 감쇠 2배
    // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
    {
      const omega  = 2 * Math.PI * highpassFreq / sampleRate;
      const alpha  = Math.sin(omega) / (2 * Math.SQRT1_2); // Q = 1/√2
      const cosW   = Math.cos(omega);
      const a0inv  = 1 / (1 + alpha);
      this._hpB0 =  (1 + cosW) / 2 * a0inv;
      this._hpB1 = -(1 + cosW)     * a0inv;
      this._hpB2 =  (1 + cosW) / 2 * a0inv;
      this._hpA1 = -2 * cosW        * a0inv;
      this._hpA2 =  (1 - alpha)     * a0inv;
    }
    this._hpX1 = 0; this._hpX2 = 0; // x[n-1], x[n-2]
    this._hpY1 = 0; this._hpY2 = 0; // y[n-1], y[n-2]

    // ── Lowpass 1차 IIR ───────────────────────────────────
    const dt = 1 / sampleRate;
    const lpRC = 1 / (2 * Math.PI * lowpassFreq);
    this._lpAlpha = dt / (lpRC + dt); // ≈ 0.0142 @ 100Hz/44.1kHz
    this._lpOut   = 0; // 이전 LP 출력 샘플

    // ── flush 타이머 ──────────────────────────────────────
    // FLUSH_INTERVAL_FRAMES 마다 메인에 포인터 전달 (실제 복사 없음)
    this._FLUSH_EVERY = Math.ceil(sampleRate * 2); // 2초마다
    this._frameCount = 0;
  }

  /**
   * 128-sample 청크마다 Web Audio 엔진이 호출
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true; // keep alive

    const inCh = input[0]; // mono
    const N = inCh.length; // 항상 128 샘플

    for (let i = 0; i < N; i++) {
      const x = inCh[i];

      // RAW
      this._raw[this._idx] = x;

      // HIGHPASS (2차 Butterworth Biquad, -12dB/oct)
      const hpOut = this._hpB0 * x + this._hpB1 * this._hpX1 + this._hpB2 * this._hpX2
                  - this._hpA1 * this._hpY1 - this._hpA2 * this._hpY2;
      this._hpX2 = this._hpX1; this._hpX1 = x;
      this._hpY2 = this._hpY1; this._hpY1 = hpOut;
      this._hp[this._idx] = hpOut;

      // LOWPASS (1차 IIR)   y[n] = α*x[n] + (1-α)*y[n-1]
      const lpOut = this._lpAlpha * x + (1 - this._lpAlpha) * this._lpOut;
      this._lp[this._idx] = lpOut;
      this._lpOut = lpOut;

      this._idx = (this._idx + 1) % this._bufSize;
    }

    this._frameCount += N;

    // ── 2초마다 main thread에 현재 포인터 전달 ────────────────
    if (this._frameCount >= this._FLUSH_EVERY) {
      this._frameCount = 0;

      // SharedArrayBuffer가 없으면 TypedArray 복사로 전달
      // 10초 버퍼 전체를 linearize해서 보낸다
      const raw = new Float32Array(this._bufSize);
      const hp  = new Float32Array(this._bufSize);
      const lp  = new Float32Array(this._bufSize);

      // idx 기준으로 순서대로 꺼내기 (oldest → newest)
      const idx = this._idx;
      for (let i = 0; i < this._bufSize; i++) {
        const src = (idx + i) % this._bufSize;
        raw[i] = this._raw[src];
        hp[i]  = this._hp[src];
        lp[i]  = this._lp[src];
      }

      // Transferable로 복사 오버헤드 최소화
      this.port.postMessage(
        { type: 'chunk', raw: raw.buffer, hp: hp.buffer, lp: lp.buffer },
        [raw.buffer, hp.buffer, lp.buffer]
      );
    }

    return true; // keep processor alive
  }
}

registerProcessor('audio-ring-buffer-processor', AudioRingBufferProcessor);
