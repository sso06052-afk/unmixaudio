// sidepanel.js — UI logic for UnmixAudio Side Panel

const $ = (id) => document.getElementById(id);

// ── Analyzer elements ──────────────────────────────────────────────────────
const startBtn     = $('start-btn');
const stopBtn      = $('stop-btn');
const saveBtn      = $('save-btn');
const resetBtn     = $('reset-btn');
const bpmValue     = $('bpm-value');
const keyValue     = $('key-value');
const keySecondary = $('key-secondary');
const keyCard      = $('key-card');
const statusDot    = $('status-dot');
const statusText   = $('status-text');
const bpmAlts      = $('bpm-alts');
const viewAnalyzer = $('view-analyzer');
const viewLibrary  = $('view-library');
const viewStems    = $('view-stems');
const libraryList  = $('library-list');
const tabBtns      = document.querySelectorAll('.tab-btn');

// ── New UI elements ───────────────────────────────────────────────────────
const nowPlaying       = $('now-playing');
const nowPlayingTitle  = $('now-playing-title');
const analysisDuration = $('analysis-duration');
const camelotValue     = $('camelot-value');
const camelotDesc      = $('camelot-desc');
const statConfidence   = $('stat-confidence');
const statDuration     = $('stat-duration');
const metroArm         = $('metro-arm');
const bpmChunks        = $('bpm-chunks');
const bpmDecimal       = $('bpm-decimal');
const confFill         = $('conf-fill');
const confPct          = $('conf-pct');
const keyConf          = $('key-conf');
const wheelSection     = $('camelot-wheel-section');
const wheelSvg         = $('camelot-wheel-svg');

// ── Stems elements ─────────────────────────────────────────────────────────
const denoiseRow        = $('denoise-row');
const denoiseTrack      = $('denoise-track');
const modelSelect       = $('model-select');
const stemsModeBtns     = document.querySelectorAll('.stems-mode-btn');
const stemsPanelCapture = $('stems-panel-capture');
const stemsPanelUpload  = $('stems-panel-upload');

const recStatusDot   = $('rec-status-dot');
const recStatusText  = $('rec-status-text');
const recTimer       = $('rec-timer');
const recProgressWrap= $('rec-progress-wrap');
const recStartBtn    = $('rec-start-btn');
const recStopBtn     = $('rec-stop-btn');

const fileDropArea   = $('file-drop-area');
const fileInput      = $('file-input');
const fileSelectedName = $('file-selected-name');
const uploadProgressWrap = $('upload-progress-wrap');
const uploadProgressBar  = $('upload-progress-bar');
const uploadExtractBtn   = $('upload-extract-btn');

const stemsError  = $('stems-error');
const stemsResult = $('stems-result');

// ── State ──────────────────────────────────────────────────────────────────
let isAnalyzing   = false;
let hasBpm        = false;
let isRecording   = false;
let recTimerInterval = null;
let recSeconds    = 0;
let selectedFile  = null;
let denoiseEnabled = true;
let pollInterval  = null;

// ── Analysis duration timer ───────────────────────────────────────────────
let analysisDurationInterval = null;
let analysisSeconds = 0;

// ── Metronome state ───────────────────────────────────────────────────────
let metroActive = false;

// ── Scale Notes mapping ───────────────────────────────────────────────────

const SCALE_NOTES = {
  // Major
  'C Major':  ['C','D','E','F','G','A','B'],
  'G Major':  ['G','A','B','C','D','E','F#'],
  'D Major':  ['D','E','F#','G','A','B','C#'],
  'A Major':  ['A','B','C#','D','E','F#','G#'],
  'E Major':  ['E','F#','G#','A','B','C#','D#'],
  'B Major':  ['B','C#','D#','E','F#','G#','A#'],
  'F# Major': ['F#','G#','A#','B','C#','D#','E#'],
  'Gb Major': ['Gb','Ab','Bb','Cb','Db','Eb','F'],
  'Db Major': ['Db','Eb','F','Gb','Ab','Bb','C'],
  'Ab Major': ['Ab','Bb','C','Db','Eb','F','G'],
  'Eb Major': ['Eb','F','G','Ab','Bb','C','D'],
  'Bb Major': ['Bb','C','D','Eb','F','G','A'],
  'F Major':  ['F','G','A','Bb','C','D','E'],
  // Minor
  'A Minor':  ['A','B','C','D','E','F','G'],
  'E Minor':  ['E','F#','G','A','B','C','D'],
  'B Minor':  ['B','C#','D','E','F#','G','A'],
  'F# Minor': ['F#','G#','A','B','C#','D','E'],
  'C# Minor': ['C#','D#','E','F#','G#','A','B'],
  'G# Minor': ['G#','A#','B','C#','D#','E','F#'],
  'D# Minor': ['D#','F','F#','G#','A#','B','C#'],
  'Eb Minor': ['Eb','F','Gb','Ab','Bb','Cb','Db'],
  'Bb Minor': ['Bb','C','Db','Eb','F','Gb','Ab'],
  'F Minor':  ['F','G','Ab','Bb','C','Db','Eb'],
  'C Minor':  ['C','D','Eb','F','G','Ab','Bb'],
  'G Minor':  ['G','A','Bb','C','D','Eb','F'],
  'D Minor':  ['D','E','F','G','A','Bb','C'],
};

function getScaleNotes(key) {
  if (!key) return [];
  if (SCALE_NOTES[key]) return SCALE_NOTES[key];
  // shorthand aliases: 'Am' → 'A Minor', 'C#m' → 'C# Minor', 'F#' → 'F# Major'
  const normalized = key
    .replace(/([A-G][b#]?)m$/, '$1 Minor')
    .replace(/^([A-G][b#]?)$/, '$1 Major');
  return SCALE_NOTES[normalized] || [];
}

function renderScaleNotes(key, confidence) {
  const notesEl = $('scale-notes');
  const pillsEl = $('scale-pills');
  const confEl  = $('scale-confidence');
  if (!notesEl || !pillsEl) return;
  const notes = getScaleNotes(key);
  if (!notes.length) { notesEl.style.display = 'none'; return; }
  const root = notes[0];
  pillsEl.innerHTML = notes
    .map(n => `<div class="scale-pill${n === root ? ' root' : ''}">${n}</div>`)
    .join('');
  if (confEl && confidence !== undefined) {
    confEl.textContent = `Key Confidence · ${Math.round(confidence * 100)}%`;
  }
  notesEl.style.display = 'block';
}

// ── Camelot Wheel mapping ─────────────────────────────────────────────────
// offscreen.js 출력: 'X Major' | 'X Minor' | 'X Harmonic Minor'
// KEY_NAMES = [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]
const CAMELOT_MAP = {
  // 1A/1B — G# Minor / B Major
  'G# Minor':'1A', 'G# Harmonic Minor':'1A', 'G#m':'1A', 'Ab Minor':'1A', 'Abm':'1A',
  'B Major': '1B',

  // 2A/2B — D# Minor / F# Major
  'D# Minor':'2A', 'D# Harmonic Minor':'2A', 'D#m':'2A', 'Eb Minor':'2A', 'Ebm':'2A',
  'F# Major':'2B', 'Gb Major':'2B', 'F#':'2B', 'Gb':'2B',

  // 3A/3B — A# Minor / Db Major
  'A# Minor':'3A', 'A# Harmonic Minor':'3A', 'A#m':'3A', 'Bb Minor':'3A', 'Bbm':'3A',
  'Db Major':'3B', 'C# Major':'3B', 'Db':'3B',

  // 4A/4B — F Minor / Ab Major
  'F Minor': '4A', 'F Harmonic Minor': '4A', 'Fm': '4A',
  'Ab Major':'4B', 'G# Major':'4B', 'Ab':'4B',

  // 5A/5B — C Minor / Eb Major
  'C Minor': '5A', 'C Harmonic Minor': '5A', 'Cm': '5A',
  'Eb Major':'5B', 'D# Major':'5B', 'Eb':'5B',

  // 6A/6B — G Minor / Bb Major
  'G Minor': '6A', 'G Harmonic Minor': '6A', 'Gm': '6A',
  'Bb Major':'6B', 'A# Major':'6B', 'Bb':'6B',

  // 7A/7B — D Minor / F Major
  'D Minor': '7A', 'D Harmonic Minor': '7A', 'Dm': '7A',
  'F Major': '7B', 'F': '7B',

  // 8A/8B — A Minor / C Major
  'A Minor': '8A', 'A Harmonic Minor': '8A', 'Am': '8A',
  'C Major': '8B', 'C': '8B',

  // 9A/9B — E Minor / G Major
  'E Minor': '9A', 'E Harmonic Minor': '9A', 'Em': '9A',
  'G Major': '9B', 'G': '9B',

  // 10A/10B — B Minor / D Major
  'B Minor': '10A', 'B Harmonic Minor': '10A', 'Bm': '10A',
  'D Major': '10B', 'D': '10B',

  // 11A/11B — F# Minor / A Major
  'F# Minor':'11A', 'F# Harmonic Minor':'11A', 'F#m':'11A', 'Gb Minor':'11A',
  'A Major': '11B', 'A': '11B',

  // 12A/12B — C# Minor / E Major
  'C# Minor':'12A', 'C# Harmonic Minor':'12A', 'C#m':'12A', 'Db Minor':'12A',
  'E Major': '12B', 'E': '12B',
};

function getCamelot(key) {
  if (!key) return '—';
  return CAMELOT_MAP[key] || '—';
}

// Reverse map: Camelot code → key name
const CAMELOT_REVERSE = {};
for (const [k, v] of Object.entries(CAMELOT_MAP)) {
  if (!CAMELOT_REVERSE[v]) CAMELOT_REVERSE[v] = k;
}

function getCompatibleKeys(camelotCode) {
  if (!camelotCode || camelotCode === '—') return [];
  const match = camelotCode.match(/^(\d+)([AB])$/);
  if (!match) return [];
  const num = parseInt(match[1], 10);
  const mode = match[2];
  const opposite = mode === 'A' ? 'B' : 'A';
  const prev = ((num - 2 + 12) % 12) + 1;
  const next = (num % 12) + 1;
  const codes = [
    `${num}${mode}`,     // same (self)
    `${num}${opposite}`, // relative major/minor
    `${prev}${mode}`,    // -1 semitone (energy down)
    `${next}${mode}`,    // +1 semitone (energy up)
  ];
  return codes.map(c => ({ code: c, key: CAMELOT_REVERSE[c] || c })).filter(x => x.key !== CAMELOT_REVERSE[camelotCode]);
}
// ── Camelot Wheel SVG Renderer ────────────────────────────────────────────
const CAMELOT_WHEEL_ORDER = [
  { code: '1', a: 'G#m', b: 'B' },
  { code: '2', a: 'D#m', b: 'F#' },
  { code: '3', a: 'A#m', b: 'Db' },
  { code: '4', a: 'Fm',  b: 'Ab' },
  { code: '5', a: 'Cm',  b: 'Eb' },
  { code: '6', a: 'Gm',  b: 'Bb' },
  { code: '7', a: 'Dm',  b: 'F' },
  { code: '8', a: 'Am',  b: 'C' },
  { code: '9', a: 'Em',  b: 'G' },
  { code: '10', a: 'Bm', b: 'D' },
  { code: '11', a: 'F#m', b: 'A' },
  { code: '12', a: 'C#m', b: 'E' },
];

function renderCamelotWheel(activeCode) {
  if (!wheelSvg) return;
  const cx = 85, cy = 85;
  const rOuter = 82, rMid = 56, rInner = 30;
  const activeNum = parseInt(activeCode);
  const activeSide = activeCode.replace(/\d+/, '');
  const sliceAngle = Math.PI * 2 / 12;

  let svg = '';
  CAMELOT_WHEEL_ORDER.forEach((seg, i) => {
    const startAngle = i * sliceAngle - Math.PI / 2 - sliceAngle / 2;
    const endAngle = startAngle + sliceAngle;
    const num = parseInt(seg.code);
    const diff = Math.min(Math.abs(num - activeNum), 12 - Math.abs(num - activeNum));
    const isActive = num === activeNum;
    const isAdjacent = diff === 1;

    // Outer ring (B - Major)
    const bActive = isActive && activeSide === 'B';
    const bFill = bActive ? 'var(--ac)' : isAdjacent ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
    const bTextFill = bActive ? '#000' : isAdjacent ? 'var(--t2)' : 'var(--t3)';
    svg += arcSlice(cx, cy, rMid, rOuter, startAngle, endAngle, bFill, bActive ? 'none' : 'var(--border2)');
    const bMid = (startAngle + endAngle) / 2;
    const bR = (rMid + rOuter) / 2;
    svg += `<text x="${cx + bR * Math.cos(bMid)}" y="${cy + bR * Math.sin(bMid)}" fill="${bTextFill}" font-size="9" font-weight="600" font-family="Roboto Condensed,sans-serif" text-anchor="middle" dominant-baseline="central">${seg.code}B</text>`;

    // Inner ring (A - Minor)
    const aActive = isActive && activeSide === 'A';
    const aFill = aActive ? 'var(--ac)' : isAdjacent ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
    const aTextFill = aActive ? '#000' : isAdjacent ? 'var(--t2)' : 'var(--t3)';
    svg += arcSlice(cx, cy, rInner, rMid, startAngle, endAngle, aFill, aActive ? 'none' : 'var(--border2)');
    const aMid = (startAngle + endAngle) / 2;
    const aR = (rInner + rMid) / 2;
    svg += `<text x="${cx + aR * Math.cos(aMid)}" y="${cy + aR * Math.sin(aMid)}" fill="${aTextFill}" font-size="9" font-weight="600" font-family="Roboto Condensed,sans-serif" text-anchor="middle" dominant-baseline="central">${seg.code}A</text>`;
  });

  // Center circle with active code
  svg += `<circle cx="${cx}" cy="${cy}" r="${rInner - 2}" fill="var(--sunken)" stroke="var(--border2)" stroke-width="1"/>`;
  svg += `<text x="${cx}" y="${cy - 4}" fill="var(--ac)" font-size="16" font-weight="700" font-family="Roboto Condensed,sans-serif" text-anchor="middle" dominant-baseline="central">${activeCode}</text>`;
  svg += `<text x="${cx}" y="${cy + 12}" fill="var(--t2)" font-size="7" font-family="Inter,sans-serif" text-anchor="middle" dominant-baseline="central">CAMELOT</text>`;

  wheelSvg.innerHTML = svg;
}

function arcSlice(cx, cy, r1, r2, startAngle, endAngle, fill, stroke) {
  const x1o = cx + r2 * Math.cos(startAngle);
  const y1o = cy + r2 * Math.sin(startAngle);
  const x2o = cx + r2 * Math.cos(endAngle);
  const y2o = cy + r2 * Math.sin(endAngle);
  const x1i = cx + r1 * Math.cos(endAngle);
  const y1i = cy + r1 * Math.sin(endAngle);
  const x2i = cx + r1 * Math.cos(startAngle);
  const y2i = cy + r1 * Math.sin(startAngle);
  return `<path d="M${x1o},${y1o} A${r2},${r2} 0 0,1 ${x2o},${y2o} L${x1i},${y1i} A${r1},${r1} 0 0,0 ${x2i},${y2i} Z" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`;
}

let pollRetries   = 0;
const POLL_MAX_RETRIES = 60; // 3분 (3s × 60) 초과 시 타임아웃

// 프로덕션 배포 시 실제 서버 URL로 교체
// chrome.storage.sync으로 사용자 설정 가능하도록 구조화
const API_BASE_DEFAULT = 'https://unmixaudio-production.up.railway.app';
let API_BASE = API_BASE_DEFAULT;
chrome.storage.sync.get(['apiBase'], (d) => {
  if (d.apiBase) API_BASE = d.apiBase;
});

// ── Theme Toggle ──────────────────────────────────────────────────────────

const themeToggle = $('theme-toggle');
const themeIcon   = $('theme-icon');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (themeIcon) themeIcon.innerHTML = theme === 'light' ? '&#9728;' : '&#9789;';
}

// Load saved theme
chrome.storage.local.get(['theme'], ({ theme }) => {
  applyTheme(theme || 'dark');
});

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    chrome.storage.local.set({ theme: next });
  });
}

// ── Tab Switching ──────────────────────────────────────────────────────────

function switchTab(tabName) {
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  viewAnalyzer.style.display = tabName === 'analyzer' ? 'block' : 'none';
  viewLibrary.style.display  = tabName === 'library'  ? 'block' : 'none';
  viewStems.style.display    = tabName === 'stems'    ? 'block' : 'none';
  if (tabName === 'library') loadLibrary();
  if (tabName === 'stems')   syncStemsRecordBtn();
}

tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ── Denoise Toggle ─────────────────────────────────────────────────────────

denoiseRow.addEventListener('click', () => {
  denoiseEnabled = !denoiseEnabled;
  denoiseTrack.classList.toggle('on', denoiseEnabled);
});

// ── Stems Mode Toggle ──────────────────────────────────────────────────────

function switchStemsMode(mode) {
  stemsModeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  stemsPanelCapture.classList.toggle('active', mode === 'capture');
  stemsPanelUpload.classList.toggle('active', mode === 'upload');
  clearStemsResult();
}

stemsModeBtns.forEach(btn => btn.addEventListener('click', () => switchStemsMode(btn.dataset.mode)));

// Show/hide guitar+piano cards based on selected model
modelSelect.addEventListener('change', () => {
  const is6s = modelSelect.value === 'htdemucs_6s';
  $('stem-guitar').style.display = is6s ? 'flex' : 'none';
  $('stem-piano').style.display  = is6s ? 'flex' : 'none';
  clearStemsResult();
});

// ── Analyzer UI Helpers ────────────────────────────────────────────────────

function setStatus(state, text) {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (state === 'analyzing') statusDot.classList.add('live');
  if (state === 'error')     statusDot.classList.add('err');
}

function setAnalyzingUI(active) {
  isAnalyzing = active;
  startBtn.style.display = active ? 'none' : 'block';
  stopBtn.style.display  = active ? 'block' : 'none';
  resetBtn.style.display = active ? 'inline-block' : 'none';
  keyCard.classList.toggle('active', active);

  if (active) {
    // Start analysis duration timer
    analysisSeconds = 0;
    analysisDurationInterval = setInterval(() => {
      analysisSeconds++;
      const m = Math.floor(analysisSeconds / 60);
      const s = String(analysisSeconds % 60).padStart(2, '0');
      if (analysisDuration) analysisDuration.textContent = `${m}:${s}`;
      if (statDuration) statDuration.textContent = `${m}:${s}`;
    }, 1000);
    bpmValue.classList.remove('idle');
    keyValue.classList.remove('idle');
    // Fetch now-playing title
    fetchNowPlaying();
  } else {
    hasBpm = false;
    saveBtn.style.display = 'none';
    setStatus('idle', 'Idle');
    stopMetronome();
    clearInterval(analysisDurationInterval);
    analysisDurationInterval = null;
    bpmValue.classList.add('idle');
    keyValue.classList.add('idle');
    if (nowPlaying) nowPlaying.classList.remove('visible');
    // Reset stats
    if (camelotValue) camelotValue.textContent = '—';
    if (bpmDecimal) bpmDecimal.textContent = '';
    if (bpmChunks) bpmChunks.textContent = '';
    if (camelotDesc) camelotDesc.textContent = '';
    if (confFill) confFill.style.width = '0%';
    if (confPct) confPct.textContent = '';
    if (keyConf) keyConf.style.display = 'none';
    if (wheelSection) wheelSection.style.display = 'none';
    const compatKeysEl = $('compat-keys');
    if (compatKeysEl) compatKeysEl.classList.remove('visible');
    const scaleNotesEl = $('scale-notes');
    if (scaleNotesEl) scaleNotesEl.style.display = 'none';
  }
  syncStemsRecordBtn();
}

function fetchNowPlaying() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const yt = tabs.find(t => t.url?.includes('youtube.com'));
    if (yt && nowPlaying && nowPlayingTitle) {
      // Clean YouTube title — remove " - YouTube" suffix
      let title = yt.title || '';
      title = title.replace(/\s*[-–]\s*YouTube\s*$/i, '');
      nowPlayingTitle.textContent = title;
      nowPlaying.classList.add('visible');
    }
  });
}

function syncStemsRecordBtn() {
  if (recStartBtn) {
    recStartBtn.disabled = !isAnalyzing || isRecording;
    if (!isAnalyzing && !isRecording) {
      setRecStatus('idle', 'Start Analysis first, then record');
    }
  }
}

function updateMetrics(data) {
  requestAnimationFrame(() => {
    if (data.bpm !== null && data.bpm !== undefined) {
      const bpmFloat = data.bpm;
      const bpmInt = Math.floor(bpmFloat);
      const bpmFrac = Math.round((bpmFloat - bpmInt) * 10);
      const parsedBpm = bpmFrac >= 5 ? bpmInt + 1 : bpmInt;  // 반올림된 정수
      bpmValue.textContent = parsedBpm;
      bpmValue.classList.remove('idle');
      if (bpmDecimal) bpmDecimal.textContent = '.' + bpmFrac;
      if (parsedBpm > 0) {
        startMetronome(parsedBpm);
        if (bpmAlts) {
          bpmAlts.innerHTML = `<span>&uarr; ${parsedBpm * 2}</span><span>&darr; ${Math.round(parsedBpm / 2)}</span>`;
        }
        if (isAnalyzing && !hasBpm) {
          hasBpm = true;
          saveBtn.style.display = 'block';
        }
      } else {
        stopMetronome();
        if (bpmAlts) bpmAlts.innerHTML = '';
        if (bpmDecimal) bpmDecimal.textContent = '';
      }
    }
    // Chunks info
    if (data.bpmChunks !== undefined && bpmChunks) {
      const secs = data.bpmChunks * 2;
      bpmChunks.textContent = `${data.bpmChunks} chunks · ${secs}s`;
    }
    if (data.key !== null && data.key !== undefined) {
      keyValue.textContent = data.key;
      keyValue.classList.remove('idle');
      renderScaleNotes(data.key, data.confidence);
      const camelot = getCamelot(data.key);
      if (camelotValue) camelotValue.textContent = camelot;
      // Camelot description
      if (camelotDesc && camelot !== '—') {
        camelotDesc.textContent = CAMELOT_REVERSE[camelot] || data.key;
      }
      // Camelot Wheel
      if (wheelSection && wheelSvg && camelot !== '—') {
        wheelSection.style.display = 'flex';
        renderCamelotWheel(camelot);
      }
      // Compatible Keys
      const compatKeysEl  = $('compat-keys');
      const compatValsEl  = $('compat-values');
      if (compatKeysEl && compatValsEl) {
        const compat = getCompatibleKeys(camelot);
        if (compat.length) {
          compatValsEl.innerHTML = compat
            .map(c => `<span class="compat-tag">${c.code} · ${c.key}</span>`)
            .join('');
          compatKeysEl.classList.add('visible');
        } else {
          compatKeysEl.classList.remove('visible');
        }
      }
    }
    if (keySecondary) {
      keySecondary.textContent = (data.secondKey && data.secondKey !== data.key)
        ? data.secondKey : '';
    }
    // Confidence bar + stat
    if (data.confidence !== undefined) {
      const pct = Math.round(data.confidence * 100);
      if (statConfidence) statConfidence.textContent = pct + '%';
      if (confFill) confFill.style.width = pct + '%';
      if (confPct) confPct.textContent = pct + '%';
      if (keyConf) keyConf.style.display = 'flex';
    }
  });
}

// ── Metronome ─────────────────────────────────────────────────────────────

function startMetronome(bpm) {
  if (bpm <= 0 || !metroArm) return;
  const beatDur = (60 / bpm) + 's';
  metroArm.style.setProperty('--beat-duration', beatDur);
  if (!metroActive) {
    metroArm.classList.add('ticking');
    metroActive = true;
  }
}

function stopMetronome() {
  if (metroArm) {
    metroArm.classList.remove('ticking');
    metroArm.style.removeProperty('--beat-duration');
  }
  metroActive = false;
}

// ── Message Handling ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'analysis-result' && message.data) {
    updateMetrics(message.data);
    setStatus('analyzing', 'Analyzing...');
  }

  if (message.type === 'capture-error') {
    setStatus('error', message.error || 'Error');
    setAnalyzingUI(false);
  }

  if (message.type === 'capture-stopped') {
    setAnalyzingUI(false);
    requestAnimationFrame(() => {
      bpmValue.textContent = '—';
      bpmValue.classList.add('idle');
      keyValue.textContent = '—';
      keyValue.classList.add('idle');
      if (keySecondary) keySecondary.textContent = '';
      if (bpmAlts) bpmAlts.innerHTML = '';
      if (camelotValue) camelotValue.textContent = '—';
      if (analysisDuration) analysisDuration.textContent = '0:00';
      if (bpmDecimal) bpmDecimal.textContent = '';
      if (bpmChunks) bpmChunks.textContent = '';
      if (camelotDesc) camelotDesc.textContent = '';
      if (confFill) confFill.style.width = '0%';
      if (confPct) confPct.textContent = '';
      if (keyConf) keyConf.style.display = 'none';
      if (wheelSection) wheelSection.style.display = 'none';
      const compatKeysEl = $('compat-keys');
      if (compatKeysEl) compatKeysEl.classList.remove('visible');
      const scaleNotesEl = $('scale-notes');
      if (scaleNotesEl) scaleNotesEl.style.display = 'none';
    });
  }

  if (message.type === 'recording-complete') {
    stopRecordingUI();
    const { audioBase64, mimeType } = message;
    const blob = base64ToBlob(audioBase64, mimeType || 'audio/webm');
    uploadForStemSeparation(blob, 'recording.webm', selectedModel());
  }

  if (message.type === 'recording-error') {
    stopRecordingUI();
    showStemsError(message.error || 'Recording failed');
  }

  if (message.type === 'recording-interrupted') {
    stopRecordingUI();
    showToast('Recording stopped — video changed');
  }

  if (message.type === 'focus-stems-tab') {
    switchTab('stems');
  }
});

// ── Analyzer Buttons ───────────────────────────────────────────────────────

startBtn.addEventListener('click', () => {
  startBtn.disabled = true;
  setStatus('idle', 'Requesting capture...');

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const youtubeTab = tabs.find(t => t.url?.includes('youtube.com'));
    if (!youtubeTab) {
      startBtn.disabled = false;
      setStatus('error', 'Focus a YouTube tab first, then try again');
      return;
    }
    _captureTab(youtubeTab.id);
  });
});

function _captureTab(tabId) {
  chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
    startBtn.disabled = false;
    if (chrome.runtime.lastError || !streamId) {
      setStatus('error', chrome.runtime.lastError?.message || 'Capture failed');
      return;
    }
    chrome.runtime.sendMessage({ type: 'start-with-stream', streamId, tabId }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        setStatus('error', response?.error || 'Failed to start analysis');
        return;
      }
      setAnalyzingUI(true);
      setStatus('analyzing', 'Analyzing...');
    });
  });
}

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop-capture' }, () => {
    setAnalyzingUI(false);
    requestAnimationFrame(() => {
      bpmValue.textContent = '—';
      bpmValue.classList.add('idle');
      keyValue.textContent = '—';
      keyValue.classList.add('idle');
      if (camelotValue) camelotValue.textContent = '—';
      const compatKeysEl = $('compat-keys');
      if (compatKeysEl) compatKeysEl.classList.remove('visible');
      const scaleNotesEl = $('scale-notes');
      if (scaleNotesEl) scaleNotesEl.style.display = 'none';
    });
  });
});

resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reset-analysis' }).catch(() => {});
  requestAnimationFrame(() => {
    bpmValue.textContent = '—';
    bpmValue.classList.add('idle');
    keyValue.textContent = '—';
    keyValue.classList.add('idle');
    if (camelotValue) camelotValue.textContent = '—';
  });
});

saveBtn.addEventListener('click', () => {
  saveBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'save-to-library' }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      saveBtn.disabled = false;
      return;
    }
    const original = saveBtn.textContent;
    saveBtn.textContent = 'Saved ✓';
    setTimeout(() => {
      saveBtn.textContent = original;
      saveBtn.disabled = false;
    }, 1500);
  });
});

// ── Library Sort ──────────────────────────────────────────────────────────

let librarySortBy = 'date';
let librarySortAsc = false; // default descending (newest first)

const sortBtns = document.querySelectorAll('.sort-btn');
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const sort = btn.dataset.sort;
    if (librarySortBy === sort) {
      librarySortAsc = !librarySortAsc; // toggle direction
    } else {
      librarySortBy = sort;
      librarySortAsc = sort === 'bpm' || sort === 'key'; // BPM/Key default ascending
    }
    sortBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.sort === librarySortBy);
      b.querySelector('.sort-arrow')?.remove();
    });
    const arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    arrow.innerHTML = librarySortAsc ? ' &#9650;' : ' &#9660;';
    btn.appendChild(arrow);
    loadLibrary();
  });
});

function sortLibraryItems(items) {
  return [...items].sort((a, b) => {
    let cmp = 0;
    if (librarySortBy === 'date') {
      cmp = (a.savedAt || 0) - (b.savedAt || 0);
    } else if (librarySortBy === 'bpm') {
      cmp = (a.bpm || 0) - (b.bpm || 0);
    } else if (librarySortBy === 'key') {
      cmp = (a.key || '').localeCompare(b.key || '');
    }
    return librarySortAsc ? cmp : -cmp;
  });
}

// ── Library ────────────────────────────────────────────────────────────────

function loadLibrary() {
  chrome.storage.local.get(['library'], ({ library }) => {
    const items = sortLibraryItems(library || []);
    libraryList.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'library-empty';
      empty.textContent = 'No saved tracks';
      libraryList.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'library-item';

      const thumb = document.createElement('img');
      thumb.className = 'library-item-thumb';
      thumb.src = `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;
      thumb.alt = '';
      thumb.onerror = () => { thumb.style.visibility = 'hidden'; };

      const info = document.createElement('div');
      info.className = 'library-item-info';

      const title = document.createElement('div');
      title.className = 'library-item-title';
      title.textContent = item.title || 'Unknown title';

      const meta = document.createElement('div');
      meta.className = 'library-item-meta';
      const keyLabel = item.key || '—';
      meta.textContent = item.bpm ? `${item.bpm} BPM · ${keyLabel}` : keyLabel;

      info.appendChild(title);
      info.appendChild(meta);

      const del = document.createElement('button');
      del.className = 'library-item-delete';
      del.textContent = '×';
      del.title = 'Remove';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLibraryItem(item.videoId);
      });

      el.appendChild(thumb);
      el.appendChild(info);
      el.appendChild(del);
      el.addEventListener('click', () => chrome.tabs.create({ url: item.url }));

      libraryList.appendChild(el);
    });
  });
}

function deleteLibraryItem(videoId) {
  chrome.storage.local.get(['library'], ({ library }) => {
    const updated = (library || []).filter(item => item.videoId !== videoId);
    chrome.storage.local.set({ library: updated }, () => loadLibrary());
  });
}

// ── Stems: Recording ───────────────────────────────────────────────────────

function setRecStatus(state, text) {
  recStatusDot.className = 'stems-status-dot';
  if (state === 'recording') recStatusDot.classList.add('recording');
  if (state === 'processing') recStatusDot.classList.add('processing');
  if (state === 'done') recStatusDot.classList.add('done');
  recStatusText.textContent = text;
}

function startRecordingUI() {
  isRecording = true;
  recSeconds = 0;
  recStartBtn.style.display = 'none';
  recStopBtn.style.display  = 'block';
  recTimer.style.display    = 'inline';
  recTimer.textContent      = '0:00';
  setRecStatus('recording', 'Recording tab audio...');
  recTimerInterval = setInterval(() => {
    recSeconds++;
    const m = Math.floor(recSeconds / 60);
    const s = String(recSeconds % 60).padStart(2, '0');
    recTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopRecordingUI() {
  isRecording = false;
  clearInterval(recTimerInterval);
  recTimerInterval = null;
  recStartBtn.style.display = 'block';
  recStopBtn.style.display  = 'none';
  recTimer.style.display    = 'none';
  recProgressWrap.classList.add('visible');
  setRecStatus('processing', 'Uploading & processing...');
  syncStemsRecordBtn();
}

recStartBtn.addEventListener('click', () => {
  if (!isAnalyzing) return;
  clearStemsResult();
  chrome.runtime.sendMessage({ type: 'start-recording' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showStemsError('Could not start recording');
      return;
    }
    startRecordingUI();
  });
});

recStopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop-recording' });
  // UI update happens when 'recording-complete' message arrives
});

// helper: currently selected model
function selectedModel() {
  return modelSelect ? modelSelect.value : 'htdemucs';
}

// ── Stems: File Upload ─────────────────────────────────────────────────────

fileDropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  selectedFile = file;
  fileSelectedName.textContent = file.name;
  fileSelectedName.style.display = 'block';
  uploadExtractBtn.disabled = false;
});

fileDropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDropArea.classList.add('drag-over');
});

fileDropArea.addEventListener('dragleave', () => {
  fileDropArea.classList.remove('drag-over');
});

fileDropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('audio/')) return;
  selectedFile = file;
  fileSelectedName.textContent = file.name;
  fileSelectedName.style.display = 'block';
  uploadExtractBtn.disabled = false;
});

uploadExtractBtn.addEventListener('click', () => {
  if (!selectedFile) return;
  clearStemsResult();
  uploadProgressWrap.classList.add('visible');
  uploadProgressBar.style.width = '0%';
  uploadExtractBtn.disabled = true;
  uploadForStemSeparation(selectedFile, selectedFile.name, selectedModel());
});

// ── Stems: API Client ──────────────────────────────────────────────────────

async function uploadForStemSeparation(blob, filename, model = 'htdemucs') {
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('model', model);
  formData.append('denoise', denoiseEnabled ? 'true' : 'false');

  try {
    const res = await fetchWithProgress(
      `${API_BASE}/api/v1/extract-stems`,
      { method: 'POST', body: formData },
      (pct) => {
        uploadProgressBar.style.width = pct + '%';
        recProgressWrap.querySelector('.progress-bar')?.style && (
          recProgressWrap.querySelector('.progress-bar').style.width = pct + '%'
        );
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${res.status}`);
    }

    const { job_id } = await res.json();
    startPolling(job_id);

  } catch (err) {
    showStemsError(err.message || 'Upload failed');
    resetStemsUploadUI();
  }
}

function fetchWithProgress(url, options, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || 'POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: () => Promise.resolve(JSON.parse(xhr.responseText)),
      });
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(options.body);
  });
}

function startPolling(jobId) {
  setRecStatus('processing', 'Processing stems...');
  clearInterval(pollInterval);
  pollRetries = 0;
  pollInterval = setInterval(async () => {
    pollRetries++;
    if (pollRetries > POLL_MAX_RETRIES) {
      clearInterval(pollInterval);
      pollInterval = null;
      showStemsError('Processing timed out. Please try again.');
      resetStemsUploadUI();
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/v1/extract-stems/${jobId}`);
      if (!res.ok) throw new Error(`Poll error ${res.status}`);
      const data = await res.json();

      if (data.status === 'complete' && data.stems) {
        clearInterval(pollInterval);
        pollInterval = null;
        displayStemResults(data.stems);
      } else if (data.status === 'failed') {
        clearInterval(pollInterval);
        pollInterval = null;
        showStemsError(data.error || 'Processing failed');
        resetStemsUploadUI();
      }
    } catch (err) {
      clearInterval(pollInterval);
      pollInterval = null;
      showStemsError('Lost connection to server');
      resetStemsUploadUI();
    }
  }, 3000);
}

// stem URL store: { vocals: url, drums: url, ... }
let stemUrls = {};

function displayStemResults(stems) {
  stemUrls = stems;
  recProgressWrap.classList.remove('visible');
  uploadProgressWrap.classList.remove('visible');
  setRecStatus('done', 'Stems ready');
  recStartBtn.disabled = !isAnalyzing;

  const is6s = selectedModel() === 'htdemucs_6s';
  $('stem-guitar').style.display = is6s ? 'flex' : 'none';
  $('stem-piano').style.display  = is6s ? 'flex' : 'none';

  stemsResult.classList.add('visible');
  notifyStemsReady();
}

function notifyStemsReady() {
  const stemCount = Object.keys(stemUrls).length;
  chrome.notifications.create('stems-ready', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Stems Ready',
    message: `${stemCount} stems extracted. Click to download.`,
    priority: 1,
    buttons: [{ title: 'Open Stems' }],
  });
}

// Download via blob fetch (cross-origin <a download> doesn't work in extensions)
async function downloadStem(stemName, url) {
  const btn = $(`stem-${stemName}-dl`);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    const nameInput = $(`stem-${stemName}-name`);
    const rawName = (nameInput?.value?.trim() || stemName).replace(/\.wav$/i, '');
    a.download = `${rawName}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    btn.textContent = 'Done ✓';
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
  } catch (err) {
    btn.textContent = 'Error';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = originalText; }, 2000);
    showStemsError('Download failed: ' + err.message);
  }
}

// Wire up download buttons
['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'].forEach(name => {
  const btn = $(`stem-${name}-dl`);
  if (btn) btn.addEventListener('click', () => {
    if (stemUrls[name]) downloadStem(name, stemUrls[name]);
  });
});

function showStemsError(msg) {
  stemsError.textContent = msg;
  stemsError.classList.add('visible');
}

let _toastTimeout = null;
function showToast(msg) {
  let toast = document.getElementById('sp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(30,30,30,0.95)', 'color:#E8EAED', 'font-size:12px',
      'font-weight:500', 'padding:8px 16px', 'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.12)', 'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
      'z-index:9999', 'pointer-events:none', 'white-space:nowrap',
      'transition:opacity 0.2s',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function clearStemsResult() {
  stemUrls = {};
  stemsResult.classList.remove('visible');
  stemsError.classList.remove('visible');
  stemsError.textContent = '';
  recProgressWrap.classList.remove('visible');
}

function resetStemsUploadUI() {
  uploadProgressWrap.classList.remove('visible');
  uploadExtractBtn.disabled = !selectedFile;
  recProgressWrap.classList.remove('visible');
  if (!isRecording) setRecStatus('idle', isAnalyzing ? 'Ready to record' : 'Start Analysis first, then record');
}

// ── Utils ──────────────────────────────────────────────────────────────────

function base64ToBlob(base64, mimeType) {
  const bytes = atob(base64);
  const ab = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) view[i] = bytes.charCodeAt(i);
  return new Blob([ab], { type: mimeType });
}

// ── On side panel open: hydrate state ─────────────────────────────────────

chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response && response.isAnalyzing) {
    setAnalyzingUI(true);
    setStatus('analyzing', 'Analyzing...');
    if (response.lastResult) updateMetrics(response.lastResult);
    fetchNowPlaying();
    return;
  }

  // Opened via overlay button — auto-capture using pendingCaptureTabId
  chrome.storage.session.get(['pendingCaptureTabId'], (data) => {
    if (chrome.runtime.lastError || !data.pendingCaptureTabId) return;
    const tabId = data.pendingCaptureTabId;
    chrome.storage.session.remove(['pendingCaptureTabId']);
    startBtn.disabled = true;
    setStatus('idle', 'Requesting capture...');
    _captureTab(tabId);
  });
});
