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
const STORAGE_SPEED_KEY    = 'dictation_speed';
const STORAGE_APPEND_KEY   = 'dictation_append_mode';
const STORAGE_THEME_KEY    = 'dictation_theme';
const MAX_CHARS            = 200;

// ===== Element references =====
const mainTextEl       = document.getElementById('mainText');
const charCounterEl    = document.getElementById('charCounter');
const wordCounterEl    = document.getElementById('wordCounter');
const saveStatusEl     = document.getElementById('saveStatus');
const startBtn         = document.getElementById('startBtn');
const stopBtn          = document.getElementById('stopBtn');
const speedSelect      = document.getElementById('speedSelect');
const appendMode       = document.getElementById('appendMode');
const typingIndicator  = document.getElementById('typingIndicator');
const statusPill       = document.getElementById('statusPill');
const pageAlertEl      = document.getElementById('pageAlert');
const messageCounterEl = document.getElementById('messageCounter');
const messageCountInputEl = document.getElementById('messageCountInput');
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
const emojiBtn = document.getElementById('emojiBtn');
const emojiPanel = document.getElementById('emojiPanel');
const themeBtn = document.getElementById('themeBtn');
const logSearchInput = document.getElementById('logSearchInput');
const copyAllLogBtn = document.getElementById('copyAllLogBtn');
const exportRulesBtn = document.getElementById('exportRulesBtn');
const importRulesBtn = document.getElementById('importRulesBtn');
const importRulesInput = document.getElementById('importRulesInput');

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
    setMessageCountDisplay(msg.count);
    if (lastTypedText) {
      const typedText = lastTypedText;
      clearTypedMessageBox();
      lastTypedText = '';
      saveToLog(typedText);
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    scheduleStatusFade();
    return;
  }

  if (msg.action === 'typingProgress') {
    typingIndicator.style.display = 'block';
    typingIndicator.textContent = 'Typing... ' + Math.round(msg.percent || 0) + '%';
    return;
  }

  if (msg.action === 'shortcutStartTyping') {
    startBtn.click();
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
  const words = mainTextEl.value.trim() ? mainTextEl.value.trim().split(/\s+/).length : 0;
  wordCounterEl.textContent = words + (words === 1 ? ' word' : ' words');
}

function showRelockAlert(msg) {
  showAlert(msg);
  const relockBtn = document.createElement('button');
  relockBtn.type = 'button';
  relockBtn.textContent = 'Relock now';
  relockBtn.style.marginLeft = '10px';
  relockBtn.addEventListener('click', () => {
    pageAlertEl.style.display = 'none';
    setTargetBtn.click();
  });
  pageAlertEl.appendChild(relockBtn);
}

function clearTypedMessageBox() {
  mainTextEl.value = '';
  updateCharCounter();
  mainTextEl.dispatchEvent(new Event('input', { bubbles: true }));
  sendToExtension('storageSet', { data: { [STORAGE_TEXT_KEY]: '' } }).catch(() => {});
}

mainTextEl.addEventListener('input', () => {
  updateCharCounter();
  sendToExtension('storageSet', { data: { [STORAGE_TEXT_KEY]: mainTextEl.value } }).then(() => {
    saveStatusEl.textContent = 'Saved';
    clearTimeout(saveStatusEl._timer);
    saveStatusEl._timer = setTimeout(() => { saveStatusEl.textContent = ''; }, 1200);
  }).catch(() => {});
});

speedSelect.addEventListener('change', () => {
  sendToExtension('storageSet', { data: { [STORAGE_SPEED_KEY]: speedSelect.value } }).catch(() => {});
});

appendMode.addEventListener('change', () => {
  sendToExtension('storageSet', { data: { [STORAGE_APPEND_KEY]: appendMode.checked } }).catch(() => {});
});

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  themeBtn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

themeBtn.addEventListener('click', () => {
  const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(theme);
  sendToExtension('storageSet', { data: { [STORAGE_THEME_KEY]: theme } }).catch(() => {});
});

// ===== Load saved state =====
async function loadSavedState() {
  try {
    const res = await sendToExtension('storageGet', { keys: [STORAGE_TEXT_KEY, STORAGE_MESSAGES_KEY, STORAGE_LOG_KEY, STORAGE_RULES_KEY, STORAGE_SPEED_KEY, STORAGE_APPEND_KEY, STORAGE_THEME_KEY] });
    if (res.success && res.data) {
      mainTextEl.value = res.data[STORAGE_TEXT_KEY] || '';
      setMessageCountDisplay(res.data[STORAGE_MESSAGES_KEY] || 0);
      updateCharCounter();
      renderLog(res.data[STORAGE_LOG_KEY] || []);
      renderCustomRules(res.data[STORAGE_RULES_KEY] || []);
      if (res.data[STORAGE_SPEED_KEY]) speedSelect.value = res.data[STORAGE_SPEED_KEY];
      appendMode.checked = res.data[STORAGE_APPEND_KEY] === true;
      applyTheme(res.data[STORAGE_THEME_KEY] || 'light');
      if (mainTextEl.value) showAlert('Draft restored');
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
   if (speed === 'instant') delayRange = [0, 2];
   else if (speed === 'superfast') delayRange = [2, 4];
  else if (speed === 'fast') delayRange = [8, 10];
  else if (speed === 'normal') delayRange = [50, 200];
   else if (speed === 'slow') delayRange = [100, 400];
   else delayRange = [300, 800];

  startBtn.disabled = true;
  stopBtn.disabled = false;
  startStatusIndicator();

  try {
    const res = await sendToExtension('startTyping', { text, delayRange, appendMode: !!appendMode.checked });
    if (!res.success) {
      // Show the specific error message from background.js
      const errorMsg = res.message || 'Failed to type. Try relocking your tab.';
        if (res.error === 'TAB_CLOSED' || res.error === 'NO_LOCK') showRelockAlert('⚠️ ' + errorMsg);
        else showAlert('⚠️ ' + errorMsg);

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
function normalizeMessageCount(val) {
  const number = Number(val);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function setMessageCountDisplay(val) {
  const count = normalizeMessageCount(val);
  messageCounterEl.textContent = 'Messages Sent: ' + count;
  if (messageCountInputEl) messageCountInputEl.value = String(count);
  return count;
}

async function updateMessageDisplay(val) {
  const count = setMessageCountDisplay(val);
  await sendToExtension('storageSet', { data: { [STORAGE_MESSAGES_KEY]: count } }).catch(() => {});
}

messageCountInputEl.addEventListener('change', () => {
  updateMessageDisplay(messageCountInputEl.value);
});

messageCountInputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') messageCountInputEl.blur();
});

increaseBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_MESSAGES_KEY] });
  updateMessageDisplay(normalizeMessageCount((res.data && res.data[STORAGE_MESSAGES_KEY]) || 0) + 1);
});
decreaseBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_MESSAGES_KEY] });
  const n = normalizeMessageCount((res.data && res.data[STORAGE_MESSAGES_KEY]) || 0);
  if (n > 0) updateMessageDisplay(n - 1);
});
resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset Messages Sent to 0?')) return;
  await updateMessageDisplay(0);
});

// ===== Log =====
function renderLog(log, query = logSearchInput.value.trim().toLowerCase()) {
  logListEl.innerHTML = '';
  const entries = (log || []).map((entry, i) => ({ entry, i })).filter(({ entry }) => !query || (entry.text || '').toLowerCase().includes(query));
  if (!entries.length) { logListEl.innerHTML = '<div class="log-empty">No matching messages.</div>'; return; }
  entries.forEach(({ entry, i }) => {
    const div = document.createElement('div');
    div.className = 'log-entry';

    const meta = document.createElement('div');
    meta.className = 'log-meta';
    meta.textContent = '#' + (log.length - i) + ' - ' + new Date(entry.timestamp).toLocaleString();

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'log-copy-btn';
    copyButton.textContent = 'Copy';
    copyButton.title = 'Copy this message';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(entry.text || '');
        copyButton.textContent = 'Copied';
        setTimeout(() => { copyButton.textContent = 'Copy'; }, 1400);
      } catch (e) {
        showAlert('Could not copy message. Please try again.');
      }
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'log-copy-btn log-delete-btn';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => removeLogEntry(i));

    const metaRow = document.createElement('div');
    metaRow.className = 'log-meta-row';
    metaRow.appendChild(meta);
    metaRow.appendChild(copyButton);
    metaRow.appendChild(deleteButton);

    const text = document.createElement('div');
    text.className = 'log-text';
    text.textContent = entry.text || '';

    div.appendChild(metaRow);
    div.appendChild(text);
    logListEl.appendChild(div);
  });
}
async function removeLogEntry(index) {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_LOG_KEY] });
  const log = (res.success && res.data && res.data[STORAGE_LOG_KEY]) || [];
  log.splice(index, 1);
  await sendToExtension('storageSet', { data: { [STORAGE_LOG_KEY]: log } });
  renderLog(log);
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

logSearchInput.addEventListener('input', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_LOG_KEY] }).catch(() => null);
  renderLog((res && res.data && res.data[STORAGE_LOG_KEY]) || []);
});

copyAllLogBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_LOG_KEY] }).catch(() => null);
  const log = (res && res.data && res.data[STORAGE_LOG_KEY]) || [];
  if (!log.length) { showAlert('No messages to copy.'); return; }
  try {
    await navigator.clipboard.writeText(log.map(entry => entry.text || '').join('\n\n'));
    showAlert('Messages copied.');
  } catch (e) { showAlert('Could not copy messages.'); }
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

exportRulesBtn.addEventListener('click', async () => {
  const res = await sendToExtension('storageGet', { keys: [STORAGE_RULES_KEY] });
  const rules = (res.success && res.data && res.data[STORAGE_RULES_KEY]) || [];
  const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dictation_rules.json'; a.click();
  URL.revokeObjectURL(url);
});

importRulesBtn.addEventListener('click', () => importRulesInput.click());
importRulesInput.addEventListener('change', async () => {
  const file = importRulesInput.files[0];
  importRulesInput.value = '';
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported) || imported.some(rule => typeof rule !== 'string')) throw new Error('Invalid rules file');
    const res = await sendToExtension('storageGet', { keys: [STORAGE_RULES_KEY] });
    const current = (res.success && res.data && res.data[STORAGE_RULES_KEY]) || [];
    const rules = [...current];
    imported.forEach(rule => {
      const phrase = rule.trim();
      if (phrase && !rules.some(existing => existing.toLowerCase() === phrase.toLowerCase())) rules.push(phrase);
    });
    await sendToExtension('storageSet', { data: { [STORAGE_RULES_KEY]: rules } });
    renderCustomRules(rules);
    showAlert('Rules imported.');
  } catch (e) { showAlert('Invalid rules file.'); }
});

// ===== Emoji Picker =====
function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
}

emojiBtn.addEventListener('click', (e) => {
  e.preventDefault();
  emojiPanel.style.display = (emojiPanel.style.display === 'none') ? 'grid' : 'none';
});

emojiPanel.addEventListener('click', (e) => {
  if (!e.target.classList.contains('emoji-item')) return;

  const emoji = e.target.textContent;
  const start = mainTextEl.selectionStart ?? mainTextEl.value.length;
  const end = mainTextEl.selectionEnd ?? mainTextEl.value.length;

  const before = mainTextEl.value[start - 1] || '';
  const after = mainTextEl.value[end] || '';

  const needsSpaceBefore = before && !/\s/.test(before);
  const needsSpaceAfter = after && !/\s/.test(after);

  const insertText = (needsSpaceBefore ? ' ' : '') + emoji + (needsSpaceAfter ? ' ' : '');

  insertAtCursor(mainTextEl, insertText);
  updateCharCounter();
  sendToExtension('storageSet', { data: { [STORAGE_TEXT_KEY]: mainTextEl.value } }).catch(() => {});
  emojiPanel.style.display = 'none';
  mainTextEl.focus();
});


document.addEventListener('click', (e) => {
  if (e.target !== emojiBtn && !emojiPanel.contains(e.target)) {
    emojiPanel.style.display = 'none';
  }
});

updateCharCounter();
