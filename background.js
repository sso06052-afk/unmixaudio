// background.js — Service Worker: tabCapture + offscreen document control

let isAnalyzing = false;
let lastResult = null;
let capturedTabId = null;

// Service Worker 시작 시 최신 상태 복구
// storageReady: SW 재기동 직후 capturedTabId가 null인 상태에서 메시지가 오는 경쟁 조건 방지
const storageReady = chrome.storage.session.get(['isAnalyzing', 'capturedTabId']).then((data) => {
  if (data.isAnalyzing !== undefined) {
    isAnalyzing = data.isAnalyzing;
    capturedTabId = data.capturedTabId;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ping') { sendResponse({ ok: true }); return false; }

  if (message.type === 'start-with-stream') {
    // popup 또는 content-script에서 getMediaStreamId 호출 후 streamId를 SW로 전달
    // content-script 발신이면 message.tabId가 없으므로 sender.tab?.id 사용
    handleStartWithStream(message.streamId, message.tabId || sender.tab?.id, sendResponse);
    return true;
  }

  if (message.type === 'open-popup-for-capture') {
    // content-script 오버레이 클릭 시 호출 — Side Panel을 열고 auto-start 플래그 저장
    const tabId = sender.tab?.id;
    chrome.storage.session.set({ pendingCaptureTabId: tabId }, () => {
      chrome.sidePanel.open({ windowId: sender.tab.windowId })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
    });
    return true;
  }

  if (message.type === 'stop-capture') {
    handleStopCapture(sendResponse);
    return true;
  }

  if (message.type === 'get-status') {
    // 혹시 초기화 전에 불릴 수 있으므로 session storage에서도 읽어서 확실히 전달
    chrome.storage.session.get(['isAnalyzing']).then((data) => {
      sendResponse({ isAnalyzing: data.isAnalyzing || isAnalyzing, lastResult });
    });
    return true; // async response
  }

  if (message.type === 'analysis-result') {
    lastResult = message.data;
    // Forward to popup (may fail if popup is closed — that's ok)
    chrome.runtime.sendMessage(message).catch(() => {});
    // storageReady 대기 후 전달: SW 재기동 직후 capturedTabId가 null일 수 있음
    storageReady.then(() => {
      if (capturedTabId) {
        chrome.tabs.sendMessage(capturedTabId, message).catch(() => {});
      }
    });
    return false;
  }

  if (message.type === 'save-to-library') {
    handleSaveToLibrary(sendResponse);
    return true;
  }

  if (message.type === 'start-recording') {
    if (!isAnalyzing) {
      sendResponse({ ok: false, error: 'Not analyzing' });
      return false;
    }
    chrome.runtime.sendMessage({ type: 'start-recording' }).catch(() => {});
    chrome.storage.session.set({ isRecording: true });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'stop-recording') {
    chrome.runtime.sendMessage({ type: 'stop-recording' }).catch(() => {});
    return false;
  }

  if (message.type === 'recording-complete') {
    chrome.storage.session.set({ isRecording: false });
    // Forward base64 blob to side panel
    chrome.runtime.sendMessage({
      type: 'recording-complete',
      audioBase64: message.audioBase64,
      mimeType: message.mimeType,
    }).catch(() => {});
    return false;
  }

  if (message.type === 'recording-error') {
    chrome.storage.session.set({ isRecording: false });
    chrome.runtime.sendMessage({ type: 'recording-error', error: message.error }).catch(() => {});
    return false;
  }

  if (message.type === 'offscreen-error') {
    isAnalyzing = false;
    lastResult = null;
    const errorMsg = { type: 'capture-error', error: message.error };
    chrome.runtime.sendMessage(errorMsg).catch(() => {});
    storageReady.then(() => {
      if (capturedTabId) {
        chrome.tabs.sendMessage(capturedTabId, errorMsg).catch(() => {});
      }
    });
    return false;
  }
});

async function handleStartWithStream(streamId, tabId, sendResponse) {
  try {
    capturedTabId = tabId;
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ type: 'start-analysis', streamId, tabId });
    isAnalyzing = true;
    lastResult = null;
    chrome.storage.session.set({ isAnalyzing: true, capturedTabId: tabId });
    sendResponse({ success: true });
  } catch (err) {
    console.error('[background] start-with-stream error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleStopCapture(sendResponse) {
  try {
    const stoppedTabId = capturedTabId;
    chrome.runtime.sendMessage({ type: 'stop-analysis' }).catch(() => {});
    isAnalyzing = false;
    lastResult = null;
    capturedTabId = null;
    // Clear session storage
    chrome.storage.session.set({ isAnalyzing: false, capturedTabId: null });

    // Close offscreen document
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }

    chrome.runtime.sendMessage({ type: 'capture-stopped' }).catch(() => {});
    if (stoppedTabId) {
      chrome.tabs.sendMessage(stoppedTabId, { type: 'capture-stopped' }).catch(() => {});
    }
    if (sendResponse) sendResponse({ success: true });
  } catch (err) {
    console.error('[background] Stop error:', err);
    if (sendResponse) sendResponse({ success: false, error: err.message });
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Tab audio capture and real-time BPM/Key analysis using Web Audio API'
  });
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  return contexts.length > 0;
}

async function handleSaveToLibrary(sendResponse) {
  try {
    if (!lastResult || !lastResult.bpm) {
      sendResponse({ success: false, error: 'No analysis result yet' });
      return;
    }
    if (!capturedTabId) {
      sendResponse({ success: false, error: 'No captured tab' });
      return;
    }
    const tab = await chrome.tabs.get(capturedTabId);
    const videoId = new URL(tab.url).searchParams.get('v');
    if (!videoId) {
      sendResponse({ success: false, error: 'Could not extract video ID' });
      return;
    }
    const item = {
      videoId,
      title: tab.title || 'Unknown title',
      url: tab.url,
      bpm: Math.round(lastResult.bpm),
      key: lastResult.key || null,
      secondKey: lastResult.secondKey || null,
      savedAt: Date.now()
    };
    const { library } = await chrome.storage.local.get(['library']);
    const items = library || [];
    const idx = items.findIndex(i => i.videoId === videoId);
    if (idx >= 0) {
      items[idx] = item; // update existing entry
    } else {
      items.unshift(item); // prepend new entry
    }
    await chrome.storage.local.set({ library: items });
    sendResponse({ success: true });
  } catch (err) {
    console.error('[background] save-to-library error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// 익스텐션 아이콘 클릭 → Side Panel 열기
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

// 스템 완료 알림 클릭 → 사이드패널 열고 Stems 탭 포커스
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== 'tracks-ready') return;
  chrome.notifications.clear(notificationId);
  chrome.windows.getLastFocused({ populate: true }, (win) => {
    if (win) {
      chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'focus-stems-tab' }).catch(() => {});
    }
  });
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  if (notificationId !== 'tracks-ready') return;
  chrome.notifications.clear(notificationId);
  chrome.windows.getLastFocused({ populate: true }, (win) => {
    if (win) {
      chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'focus-stems-tab' }).catch(() => {});
    }
  });
});

// Clean up if the captured tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === capturedTabId) {
    handleStopCapture(null);
  }
});

// 유튜브 등 SPA 환경에서 영상(URL) 또는 제목이 바뀔 때 분석기 초기화 메시지 전송
// - URL 변경: 유튜브 일반 탐색, SPA 라우트 변경
// - title 변경: 유튜브 재생목록 자동 다음 곡, Spotify 등 URL 불변 서비스
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === capturedTabId && isAnalyzing) {
    if (changeInfo.url || changeInfo.title) {
      chrome.runtime.sendMessage({ type: 'reset-analysis' }).catch(() => {});

      // 녹음 중 탭 이동 시 자동 중단 — 두 영상 오디오 혼합 방지
      chrome.storage.session.get(['isRecording'], (data) => {
        if (data.isRecording) {
          chrome.runtime.sendMessage({ type: 'stop-recording' }).catch(() => {});
          chrome.storage.session.set({ isRecording: false });
          chrome.runtime.sendMessage({ type: 'recording-interrupted' }).catch(() => {});
        }
      });
    }
  }
});
