// content-script.js — YouTube 오버레이 토글 버튼

(function () {
  // 중복 주입 방지
  if (document.getElementById('audio-analyzer-overlay')) return;

  let isAnalyzing = false;

  // ── 버튼 생성 ──────────────────────────────────────────────────────────────
  const btn = document.createElement('div');
  btn.id = 'audio-analyzer-overlay';
  btn.innerHTML = `
    <span id="aa-bars"><span class="aa-bar"></span><span class="aa-bar"></span><span class="aa-bar"></span></span>
    <span id="aa-label">Analyzer</span>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #audio-analyzer-overlay {
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      cursor: pointer;
      user-select: none;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      font-weight: 500;
      color: #aaa;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    #audio-analyzer-overlay:hover {
      background: rgba(30, 30, 30, 0.95);
      border-color: rgba(255,255,255,0.2);
    }
    #aa-bars {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 10px;
      flex-shrink: 0;
    }
    .aa-bar {
      width: 2px;
      height: 3px;
      border-radius: 1px;
      background: #555;
      transition: background 0.2s;
    }
    #audio-analyzer-overlay.analyzing {
      color: #e8e8e8;
      border-color: rgba(200, 208, 217, 0.3);
    }
    #audio-analyzer-overlay.analyzing .aa-bar {
      background: #C8D0D9;
      animation: aa-bar-bounce var(--aa-beat, 0.5s) cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    #audio-analyzer-overlay.analyzing .aa-bar:nth-child(2) { animation-delay: 80ms; }
    #audio-analyzer-overlay.analyzing .aa-bar:nth-child(3) { animation-delay: 160ms; }
    #audio-analyzer-overlay.error {
      color: #f87171;
      border-color: rgba(248, 113, 113, 0.3);
    }
    #audio-analyzer-overlay.error .aa-bar {
      background: #f87171;
    }
    @keyframes aa-bar-bounce {
      0%, 100% { height: 3px; }
      50% { height: 10px; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(btn);

  // ── 상태 렌더링 ────────────────────────────────────────────────────────────
  const label = document.getElementById('aa-label');

  function setState(state, data) {
    btn.className = '';
    if (state === 'analyzing') {
      isAnalyzing = true;
      btn.classList.add('analyzing');
      if (data && (data.bpm || data.key)) {
        const bpm = data.bpm ? Math.round(data.bpm) + ' BPM' : '…';
        const key = data.key || '—';
        label.textContent = `${bpm} · ${key}`;
        if (data.bpm) btn.style.setProperty('--aa-beat', (60 / Math.round(data.bpm)) + 's');
      } else {
        label.textContent = 'Analyzing…';
      }
    } else if (state === 'error') {
      isAnalyzing = false;
      btn.classList.add('error');
      label.textContent = 'Error';
    } else {
      isAnalyzing = false;
      label.textContent = 'Analyzer';
      btn.style.removeProperty('--aa-beat');
    }
  }

  // ── 클릭 토글 ──────────────────────────────────────────────────────────────
  let pendingClick = false; // 더블클릭 race condition 방지
  btn.addEventListener('click', () => {
    if (pendingClick) return;
    if (isAnalyzing) {
      chrome.runtime.sendMessage({ type: 'stop-capture' }).catch(() => {});
      setState('idle');
    } else {
      // chrome.tabCapture는 content script에서 undefined — popup에 위임
      // background가 chrome.action.openPopup()으로 팝업을 열고, 팝업이 자동 캡처 시작
      pendingClick = true;
      label.textContent = 'Requesting…';
      chrome.runtime.sendMessage({ type: 'open-popup-for-capture' }, (res) => {
        pendingClick = false;
        if (chrome.runtime.lastError || !res?.ok) {
          label.textContent = 'Click extension icon';
          setTimeout(() => setState('idle'), 2000);
        } else {
          setState('analyzing'); // popup starts capture; values update on analysis-result
        }
      });
    }
  });

  // ── 메시지 수신 (background → content script) ──────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'analysis-result') {
      setState('analyzing', message.data);
    } else if (message.type === 'capture-stopped') {
      setState('idle');
    } else if (message.type === 'capture-error') {
      setState('error');
    }
  });

  // ── 초기 상태 복원 (팝업이 켜놓은 상태에서 유튜브 탭 전환 시) ─────────────
  chrome.runtime.sendMessage({ type: 'get-status' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.isAnalyzing) {
      setState('analyzing', res.lastResult);
    }
  });
})();
