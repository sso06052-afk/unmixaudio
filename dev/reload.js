// dev/reload.js — CDP 기반 익스텐션 핫리로드
// 사용법: npm run chrome:debug 으로 Chrome 먼저 실행 후 npm run dev:cdp

import { watch } from 'fs';

const FILES = [
  'popup.html',
  'popup.js',
  'content-script.js',
  'background.js',
  'offscreen.js',
];
const CDP_PORT = 9222;
let debounce;

async function reload() {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json`);
    const targets = await res.json();
    const sw = targets.find(
      (t) => t.type === 'service_worker' && t.url?.startsWith('chrome-extension://')
    );
    if (!sw?.webSocketDebuggerUrl) {
      console.log('[reload] Service Worker 타겟을 찾을 수 없음 — 익스텐션이 로드되어 있는지 확인');
      return;
    }
    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: 'chrome.runtime.reload()' },
      }));
      setTimeout(() => ws.close(), 300);
      console.log(`[reload] ✓ ${new Date().toLocaleTimeString()}`);
    };
    ws.onerror = () => console.log('[reload] WebSocket 연결 오류');
  } catch {
    console.log(`[reload] Chrome CDP 연결 실패 — 포트 ${CDP_PORT}로 Chrome이 실행 중인지 확인\n  → npm run chrome:debug`);
  }
}

FILES.forEach((f) => {
  watch(f, () => {
    clearTimeout(debounce);
    debounce = setTimeout(reload, 200);
  });
});

console.log('[hot-reload] 감시 시작:', FILES.join(', '));
console.log('[hot-reload] Chrome이 CDP 모드로 실행 중이어야 합니다 (npm run chrome:debug)');
