// ===== app.js — Dictation Typer Online Companion Page =====
// Communicates with the Chrome extension via bridge.js (content script).
// All chrome.storage and chrome.scripting calls go through the bridge.

'use strict';

// ===== Storage keys =====
const STORAGE_TEXT_KEY     = 'dictation_saved_text';
const STORAGE_MESSAGES_KEY = 'dictation_messages_sent';
const STORAGE_LOG_KEY      = 'dictation_message_log';
const STORAGE_RULES_KEY    = 'dictation_custom_rules';
const STORAGE_TARGET_TAB   = 'dictation_target_tab';
const MAX_CHARS            = 200;

// ===== Element references =====
const mainTextEl       = document.getElementById('mainText');
const charCounterEl    = document.getElementById('charCounter');
const startBtn         = document.getElementById('startBtn');
const stopBtn          = document.getElementById('stopBtn');
const speedSelect      = document.getElementById('speedSelect');
const appendMode       = document.getElementById('appendMode');
const typingIndicator  = document.getElementById('typingIndicator');
const statusPill       = document.getElementById('statusPill');
const pageAlertEl      = document.getElementById('pageAlert');
const messageCounterEl = document.getElementById('messageCounter');
const increaseBtn      = document.getElementById('increaseBtn');
const decreaseBtn      = document.getElementById('decreaseBtn');
const resetBtn         = document.getElementById('resetBtn');
const clearTextBtn     = document.getElementById('clearTextBtn');
const setTargetBtn     = document.getElementById('setTargetBtn');
const targetLabelEl    = document.getElementById('targetLabel');
const toggleRulesBtn   = document.getElementById('toggleRules');
const rulesSectionEl   = document.getElementById('rulesSection');
const customRulesListEl= document.getElementById('customRulesList');
const newRuleInputEl   = document.getElementById('newRuleInput');
const addRuleBtnEl     = document.getElementById('addRuleBtn');
const toggleLogBtn     = document.getElementById('toggleLog');
const logSectionEl     = document.getElementById('logSection');
const logListEl        = document.getElementById('logList');
const exportLogBtn     = document.getElementById('exportLogBtn');
const clearLogBtn      = document.getElementById('clearLogBtn');
const extStatusEl      = document.getElementById('extStatus');
const notConnectedBanner = document.getElementById('notConnectedBanner');

let extensionConnected = false;
let lastTypedText = '';
let requestCounter = 0;
const pendingRequests = {};

// ===== Bridge communication =====
function sendToExtension(action, data = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestCounter;
    pendingRequests[requestId] = { resolve, reject };
    setTimeout(() => {
      if (pendingRequests[requestId]) {
        delete pendingRequests[requestId];
        reject(new Error('Extension timeout'));
      }
    }, 5000);
    window.postMessage({ source: 'dictation-page', action, requestId, ...data }, '*');
  });
}

// ===== Listen for messages from bridge.js =====
window.addEventListener('message', (event) => {
  if (!event.data || event.data.source !== 'dictation-bridge') return;
  const msg = event.data;

  // Extension responded to ping — now we know it's connected
  if (msg.action === 'extensionReady') {
    if (extensionConnected) return; // ignore duplicates
    extensionConnected = true;
    extStatusEl.textContent = '✅ Extension connected';
    extStatusEl.className = 'ext-status connected';
    notConnectedBanner.style.display = 'none';
    startBtn.disabled = false;
    loadSavedState();
    return;
  }

  // finishedTyping broadcast from background
  if (msg.action === 'finishedTyping') {
    messageCounterEl.textContent = 'Messages Sent: ' + msg.count;
    if (lastTypedText) saveToLog(lastTypedText);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    scheduleStatusFade();
    return;
  }

  // Resolve pending request
  if (msg.requestId && pendingRequests[msg.requestId]) {
    const { resolve } = pendingRequests[msg.requestId];
    delete pendingRequests[msg.requestId];
    resolve(msg);
  }
});

// ===== Ping bridge repeatedly until connected =====
// Fixes timing issue: bridge.js may load before or after app.js
let pingInterval = null;
let pingAttempts = 0;
const MAX_PING_ATTEMPTS = 10; // try for ~5 seconds

function startPinging() {
  pingInterval = setInterval(() => {
    if (extensionConnected) {
      clearInterval(pingInterval);
      return;
    }
    pingAttempts++;
    window.postMessage({ source: 'dictation-page', action: 'ping' }, '*');

    if (pingAttempts >= MAX_PING_ATTEMPTS) {
      clearInterval(pingInterval);
      if (!extensionConnected) {
        extStatusEl.textContent = '❌ Extension not detected';
        extStatusEl.className = 'ext-status disconnected';
        notConnectedBanner.style.display = 'block';
      }
    }
  }, 500);
}

// Start pinging after a short delay to let bridge.js initialise
setTimeout(startPinging, 300);

// ===== Alert =====
let alertTimeout = null;
function showAlert(msg) {
  pageAlertEl.textContent = msg;
  pageAlertEl.style.display = 'block';
  pageAlertEl.style.opacity = '1';
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    pageAlertEl.style.opacity = '0';
    setTimeout(() => { pageAlertEl.style.display = 'none'; pageAlertEl.style.opacity = '1'; }, 400);
  }, 3500);
}

// ===== Char counter =====
function updateCharCounter() {
  const len = mainTextEl.value.length;
  charCounterEl.textContent = len + ' / ' + MAX_CHARS;
  charCounterEl.style.color = len > MAX_CHARS ? 'red' : '#888';
}
mainTextEl.addEventListener('input', () => {
  updateCharCounter();
  sendToExtension('storageSet', { data: { [STORAGE_TEXT_KEY]: mainTextEl.value } }).catch(() => {});
});

// ===== Load saved state =====
async function loadSavedState() {
  try {
    const res = await sendToExtension('storageGet', { keys: [STORAGE_TEXT_KEY, STORAGE_MESSAGES_KEY, STORAGE_LOG_KEY, STORAGE_RULES_KEY] });
    if (res.success && res.data) {
      mainTextEl.value = res.data[STORAGE_TEXT_KEY] || '';
      messageCounterEl.textContent = 'Messages Sent: ' + (res.data[STORAGE_MESSAGES_KEY] || 0);
      updateCharCounter();
      renderLog(res.data[STORAGE_LOG_KEY] || []);
      renderCustomRules(res.data[STORAGE_RULES_KEY] || []);
    }
    await refreshTargetLabel();
  } catch (e) { console.error('loadSavedState', e); }
}

// ===== Target tab lock =====
async function refreshTargetLabel() {
  try {
    const res = await sendToExtension('getTargetTab');
    if (!res.success || !res.tab) {
      targetLabelEl.textContent = 'No tab locked — click "🎯 Lock to Tab" to set your platform tab';
      targetLabelEl.style.color = '#b30000';
      setTargetBtn.textContent = '🎯 Lock to Tab';
    } else {
      targetLabelEl.textContent = '🔒 Locked: ' + (res.tab.title || '').substring(0, 50);
      targetLabelEl.style.color = '#007946';
      setTargetBtn.textContent = '🔄 Change Lock';
    }
  } catch (e) { console.error('refreshTargetLabel', e); }
}

let lockCountdownInterval = null;

setTargetBtn.addEventListener('click', async () => {
  if (!extensionConnected) { showAlert('⚠️ Extension not connected.'); return; }

  if (lockCountdownInterval) {
    clearInterval(lockCountdownInterval);
    lockCountdownInterval = null;
    setTargetBtn.textContent = '🎯 Lock to Tab';
    targetLabelEl.textContent = 'Lock cancelled. Click again when ready.';
    targetLabelEl.style.color = '#888';
    return;
  }

  let seconds = 5;
  targetLabelEl.style.color = '#856404';
  targetLabelEl.textContent = 'Switch to your platform tab now... locking in ' + seconds + 's  (click to cancel)';
  setTargetBtn.textContent = '✕ Cancel';

  lockCountdownInterval = setInterval(async () => {
    seconds--;
    if (seconds > 0) {
      targetLabelEl.textContent = 'Switch to your platform tab now... locking in ' + seconds + 's  (click to cancel)';
      return;
    }

    clearInterval(lockCountdownInterval);
    lockCountdownInterval = null;

    try {
      const res = await sendToExtension('getAllTabs');
      if (!res.success) { showAlert('Could not get tabs. Try again.'); return; }

      const pageUrl = window.location.href;
    const candidates = res.tabs.filter(t =>
      t.url &&
      !t.url.includes('https://lexydu.github.io/Dictation-Typer-Extention-Popup-Online-Quillbot-Grammarly-Version-1.6') &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('chrome-extension://') &&
        !t.url.startsWith('chrome://') &&
        !t.url.startsWith('chrome-extension://')
      );

      if (!candidates.length) {
        targetLabelEl.textContent = 'No valid tab found. Open your platform tab first.';
        targetLabelEl.style.color = '#b30000';
        setTargetBtn.textContent = '🎯 Lock to Tab';
        return;
      }

      candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      const target = candidates[0];

      await sendToExtension('storageSet', {
        data: { [STORAGE_TARGET_TAB]: { id: target.id, title: target.title || target.url } }
      });

      await refreshTargetLabel();
      showAlert('🔒 Locked to: "' + (target.title || target.url).substring(0, 40) + '"');
    } catch (e) {
      console.error('Lock error', e);
      targetLabelEl.textContent = 'Something went wrong. Please try again.';
      targetLabelEl.style.color = '#b30000';
      setTargetBtn.textContent = '🎯 Lock to Tab';
    }
  }, 1000);
});

// ===== Validation =====
async function validateTextRules(text) {
  if (!text.includes('?')) { showAlert('⚠️ Your message does not contain a question!'); return false; }
  if (text.toLowerCase().includes('my dick')) { showAlert('⚠️ Inappropriate phrase detected!'); return false; }
  if (text.length < 150) { showAlert('⚠️ Your message is too short! (Minimum 150 characters)'); return false; }
  try {
    const res = await sendToExtension('storageGet', { keys: [STORAGE_RULES_KEY] });
    const phrases = (res.success && res.data && res.data[STORAGE_RULES_KEY]) || [];
    for (const phrase of phrases) {
      if (phrase && text.toLowerCase().includes(phrase.toLowerCase())) {
        showAlert('⚠️ Banned phrase detected: "' + phrase + '"');
        return false;
      }
    }
  } catch (e) { console.error('validate error', e); }
  return true;
}

// ===== Status =====
let dotsInterval = null;
function startStatusIndicator() {
  clearInterval(dotsInterval);
  typingIndicator.style.display = 'block';
  statusPill.textContent = 'Typing...';
  statusPill.className = 'status-pill typing';
  let dots = 0;
  typingIndicator.textContent = 'Typing';
  dotsInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    typingIndicator.textContent = 'Typing' + '.'.repeat(dots);
  }, 500);
}
function scheduleStatusFade() {
  clearInterval(dotsInterval);
  setTimeout(() => {
    typingIndicator.style.display = 'none';
    typingIndicator.textContent = '';
    statusPill.textContent = 'Ready';
    statusPill.className = 'status-pill';
  }, 2500);
}

// ===== Start =====
startBtn.addEventListener('click', async () => {
  if (!extensionConnected) { showAlert('⚠️ Extension not connected.'); return; }
  const text = mainTextEl.value || '';
  if (!await validateTextRules(text)) return;

  const targetRes = await sendToExtension('getTargetTab').catch(() => null);
  if (!targetRes || !targetRes.tab) {
    showAlert('⚠️ No tab locked. Click "🎯 Lock to Tab" first.');
    return;
  }

  lastTypedText = text;
  let delayRange;
  const speed = speedSelect.value;
  if (speed === 'superfast') delayRange = [4, 8];
  else if (speed === 'fast') delayRange = [8, 10];
  else if (speed === 'normal') delayRange = [50, 200];
  else delayRange = [100, 400];

  startBtn.disabled = true;
  stopBtn.disabled = false;
  startStatusIndicator();

  try {
    const res = await sendToExtension('startTyping', { text, delayRange, appendMode: !!appendMode.checked });
    if (!res.success) {
      // Show the specific error message from background.js
      const errorMsg = res.message || 'Failed to type. Try relocking your tab.';
      showAlert('⚠️ ' + errorMsg);

      // If lock is stale, clear it from UI too
      if (res.error === 'TAB_CLOSED' || res.error === 'NO_LOCK') {
        targetLabelEl.textContent = 'Tab lock lost — please lock again';
        targetLabelEl.style.color = '#b30000';
        setTargetBtn.textContent = '🎯 Lock to Tab';
        await sendToExtension('storageSet', { data: { [STORAGE_TARGET_TAB]: null } }).catch(() => {});
      }

      startBtn.disabled = false;
      stopBtn.disabled = true;
      scheduleStatusFade();
      return;
    }
  } catch (err) {
    console.error('Start typing error', err);
    showAlert('⚠️ Could not reach extension. Please reload the page.');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    scheduleStatusFade();
  }
});

// ===== Stop =====
stopBtn.addEventListener('click', async () => {
  await sendToExtension('stopTyping').catch(() => {});
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusPill.textContent = 'Stopped';
  statusPill.className = 'status-pill stopped';
  scheduleStatusFade();
});

// ===== Clear text =====
clearTextBtn.addEventListener('click', async () => {
  if (!confirm('Clear all saved text?')) return;
  mainTextEl.value = '';
  updateCharCounter();
  await sendToExtension('storageSet', { data: { [STORAGE_TEXT_KEY]: '' } }).catch(() => {});
  showAlert('✔️ Text cleared!');
});

// ===== Counter =====
async function updateMessageDisplay(val) {
  messageCounterEl.textContent = 'Messages Sent: ' + val;
  await sendToExtension('storageSet', { data: { [STORAGE_MESSAGES_KEY]: val } }).catch(() => {});
}
increaseBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_MESSAGES_KEY] });
  updateMessageDisplay(Number((res.data && res.data[STORAGE_MESSAGES_KEY]) || 0) + 1);
});
decreaseBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_MESSAGES_KEY] });
  const n = Number((res.data && res.data[STORAGE_MESSAGES_KEY]) || 0);
  if (n > 0) updateMessageDisplay(n - 1);
});
resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset Messages Sent to 0?')) return;
  await sendToExtension('storageSet', { data: { [STORAGE_MESSAGES_KEY]: 0 } }).catch(() => {});
  messageCounterEl.textContent = 'Messages Sent: 0';
});

// ===== Log =====
function renderLog(log) {
  logListEl.innerHTML = '';
  if (!log || !log.length) { logListEl.innerHTML = '<div class="log-empty">No messages logged yet.</div>'; return; }
  log.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = '<div class="log-meta">#' + (log.length - i) + ' — ' + new Date(entry.timestamp).toLocaleString() + '</div>' +
      '<div class="log-text">' + entry.text.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>';
    logListEl.appendChild(div);
  });
}
async function saveToLog(text) {
  try {
    const res = await sendToExtension('storageGet', { keys: [STORAGE_LOG_KEY] });
    const log = (res.success && res.data && res.data[STORAGE_LOG_KEY]) || [];
    log.unshift({ text, timestamp: new Date().toISOString() });
    await sendToExtension('storageSet', { data: { [STORAGE_LOG_KEY]: log } });
    renderLog(log);
  } catch (e) { console.error('saveToLog', e); }
}
toggleLogBtn.addEventListener('click', () => {
  const h = logSectionEl.style.display === 'none';
  logSectionEl.style.display = h ? 'block' : 'none';
  toggleLogBtn.textContent = h ? '▲' : '▼';
});
exportLogBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_LOG_KEY] }).catch(() => null);
  const log = (res && res.data && res.data[STORAGE_LOG_KEY]) || [];
  if (!log.length) { showAlert('No messages to export.'); return; }
  const lines = log.map((e, i) => '#' + (log.length - i) + ' — ' + new Date(e.timestamp).toLocaleString() + '\n' + e.text + '\n');
  const blob = new Blob([lines.join('\n---\n\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dictation_log_' + Date.now() + '.txt'; a.click();
  URL.revokeObjectURL(url);
});
clearLogBtn.addEventListener('click', async () => {
  if (!confirm('Clear all logged messages?')) return;
  await sendToExtension('storageSet', { data: { [STORAGE_LOG_KEY]: [] } }).catch(() => {});
  renderLog([]);
  showAlert('✔️ Log cleared!');
});

// ===== Rules =====
function renderCustomRules(rules) {
  customRulesListEl.innerHTML = '';
  if (!rules || !rules.length) { customRulesListEl.innerHTML = '<div class="rule-empty">No custom rules yet.</div>'; return; }
  rules.forEach((phrase, i) => {
    const div = document.createElement('div');
    div.className = 'rule-row rule-custom';
    div.innerHTML = '<span class="rule-custom-text">🚫 Banned: "' + phrase + '"</span><button class="rule-remove">✕</button>';
    div.querySelector('.rule-remove').addEventListener('click', () => removeCustomRule(i));
    customRulesListEl.appendChild(div);
  });
}
async function removeCustomRule(index) {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_RULES_KEY] });
  const rules = (res.success && res.data && res.data[STORAGE_RULES_KEY]) || [];
  rules.splice(index, 1);
  await sendToExtension('storageSet', { data: { [STORAGE_RULES_KEY]: rules } });
  renderCustomRules(rules);
  showAlert('✔️ Rule removed.');
}
toggleRulesBtn.addEventListener('click', () => {
  const h = rulesSectionEl.style.display === 'none';
  rulesSectionEl.style.display = h ? 'block' : 'none';
  toggleRulesBtn.textContent = h ? '▲' : '▼';
});
addRuleBtnEl.addEventListener('click', async () => {
  const phrase = newRuleInputEl.value.trim();
  if (!phrase) { showAlert('Enter a phrase to ban.'); return; }
  const res = await sendToExtension('storageGet', { keys: [STORAGE_RULES_KEY] });
  const rules = (res.success && res.data && res.data[STORAGE_RULES_KEY]) || [];
  if (rules.map(r => r.toLowerCase()).includes(phrase.toLowerCase())) { showAlert('Already in your rules.'); return; }
  rules.push(phrase);
  await sendToExtension('storageSet', { data: { [STORAGE_RULES_KEY]: rules } });
  renderCustomRules(rules);
  newRuleInputEl.value = '';
  showAlert('✔️ Banned: "' + phrase + '"');
});
newRuleInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') addRuleBtnEl.click(); });

// Also update popup button to open this page
updateCharCounter();
