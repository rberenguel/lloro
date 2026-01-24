const BACKEND_URL = 'http://localhost:6363';
const RPC_ENDPOINT = `${BACKEND_URL}/rpc`;

// DOM Elements
const modelSelect = document.getElementById('modelSelect');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const contextInfo = document.getElementById('contextInfo');
const newChatBtn = document.getElementById('newChatBtn');
const pinBtn = document.getElementById('pinBtn');
const sessionsToggleBtn = document.getElementById('sessionsToggleBtn');
const sessionsPanel = document.getElementById('sessionsPanel');
const deleteModal = document.getElementById('deleteModal');
const deleteSessionInfo = document.getElementById('deleteSessionInfo');
const deleteCancelBtn = document.getElementById('deleteCancelBtn');
const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

// State
let isProcessing = false;
let currentTabUrl = null;  // Current active tab URL
let currentSessionId = null;  // ID of current active session
let sessions = {};  // Map of sessionId -> session object

// Get current session
function getCurrentSession() {
  if (!currentSessionId || !sessions[currentSessionId]) {
    // Create new session if none exists
    const newId = `session-${Date.now()}`;
    currentSessionId = newId;
    sessions[newId] = {
      id: newId,
      messages: [],
      pinnedTabs: {},
      model: modelSelect.value,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
  }
  return sessions[currentSessionId];
}

// Convenience accessor (replaces global session variable)
Object.defineProperty(window, 'session', {
  get() { return getCurrentSession(); }
});

// Storage helpers
async function saveSessions() {
  try {
    // Update last active time for current session
    if (currentSessionId && sessions[currentSessionId]) {
      sessions[currentSessionId].lastActiveAt = Date.now();
    }

    await chrome.storage.local.set({
      lloro_data: {
        currentSessionId,
        sessions
      }
    });
  } catch (e) {
    console.error('Failed to save sessions:', e);
  }
}

async function loadSessions() {
  try {
    const data = await chrome.storage.local.get('lloro_data');
    if (data.lloro_data) {
      currentSessionId = data.lloro_data.currentSessionId;
      sessions = data.lloro_data.sessions || {};
      return true;
    }
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
  return false;
}

// Backward compatibility: migrate old single-session storage
async function migrateOldStorage() {
  try {
    const data = await chrome.storage.local.get('lloro_session');
    if (data.lloro_session) {
      const oldSession = data.lloro_session;
      const newId = `session-migrated-${Date.now()}`;

      sessions[newId] = {
        id: newId,
        messages: oldSession.messages || [],
        pinnedTabs: {},
        model: oldSession.model || modelSelect.value,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      };

      // Migrate old contextUrl to pinnedTabs if it exists
      if (oldSession.contextUrl) {
        sessions[newId].pinnedTabs[oldSession.contextUrl] = {
          title: oldSession.contextTitle || oldSession.contextUrl,
          content: '',  // Content not stored in old version
          pinnedAt: Date.now(),
          sent: true  // Assume it was already sent
        };
      }

      currentSessionId = newId;
      await saveSessionss();

      // Clean up old storage
      await chrome.storage.local.remove('lloro_session');
      await chrome.storage.local.remove('lloro_settings');

      console.log('[Lloro] Migrated old session to new format');
      return true;
    }
  } catch (e) {
    console.error('Failed to migrate old storage:', e);
  }
  return false;
}

// Check if current tab is pinned
function isCurrentTabPinned() {
  return currentTabUrl && session.pinnedTabs[currentTabUrl];
}

// Update current tab URL
async function updateCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabUrl = tab?.url || null;
  updatePinUI();
}

// JSON-RPC helper
async function rpcCall(method, params) {
  const response = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message);
  }

  return data.result;
}

// Check backend health
async function checkHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    const data = await response.json();

    statusDot.className = 'status-dot';
    if (data.model) {
      statusText.textContent = data.model;
    } else {
      statusText.textContent = 'Ready';
    }

    return true;
  } catch (error) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Backend offline';
    return false;
  }
}

// Update pin button UI
function updatePinUI() {
  const isPinned = isCurrentTabPinned();

  if (isPinned) {
    pinBtn.classList.add('active');
    pinBtn.classList.add('permanent');
    pinBtn.title = 'Page pinned (cannot unpin once sent to AI)';
    pinBtn.disabled = true;  // Can't unpin once pinned
  } else {
    pinBtn.classList.remove('active');
    pinBtn.classList.remove('permanent');
    pinBtn.title = 'Click to pin this page';
    pinBtn.disabled = false;
  }
  updateContextInfo();
}

// Update context info display
function updateContextInfo() {
  const pinnedTabs = Object.entries(session.pinnedTabs);
  const pinnedCount = pinnedTabs.length;
  const sentCount = pinnedTabs.filter(([_, tab]) => tab.sent).length;

  contextInfo.innerHTML = '';

  if (pinnedCount === 0) {
    const text = document.createElement('span');
    text.textContent = 'No pages pinned';
    contextInfo.appendChild(text);
  } else {
    // Create list of pinned pages
    const list = document.createElement('div');
    list.className = 'pinned-list';

    pinnedTabs.forEach(([url, tab]) => {
      const item = document.createElement('div');
      item.className = 'pinned-item';
      if (url === currentTabUrl) {
        item.classList.add('current');
      }

      const title = document.createElement('span');
      title.className = 'pinned-title';
      title.textContent = tab.title || new URL(url).hostname;
      title.title = url;

      const status = document.createElement('span');
      status.className = 'pinned-status';
      status.textContent = tab.sent ? '✓' : '…';
      status.title = tab.sent ? 'Sent to AI' : 'Will be sent with next message';

      item.appendChild(title);
      item.appendChild(status);
      list.appendChild(item);
    });

    contextInfo.appendChild(list);
  }
}

// Render messages from session
function renderMessages() {
  // Clear container but keep system message placeholder
  chatContainer.innerHTML = '';

  if (session.messages.length === 0) {
    const sysMsg = document.createElement('div');
    sysMsg.className = 'message system';
    sysMsg.textContent = 'Send a message to chat about the current page content.';
    chatContainer.appendChild(sysMsg);
  } else {
    session.messages.forEach(msg => {
      addMessageToDOM(msg.type, msg.text);
    });
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Add message to DOM only (no save)
function addMessageToDOM(type, text) {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;

  if (type === 'assistant') {
    msg.innerHTML = marked.parse(text);
  } else if (type === 'user') {
    msg.textContent = text;
  } else {
    msg.innerHTML = text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  chatContainer.appendChild(msg);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return msg;
}

// Add message and save to session
function addMessage(type, text) {
  // Don't persist system/error messages
  if (type === 'user' || type === 'assistant') {
    session.messages.push({ type, text });
    saveSessions();
  }
  return addMessageToDOM(type, text);
}

// Switch to a different session
async function switchSession(sessionId) {
  if (!sessions[sessionId]) {
    console.error('Session not found:', sessionId);
    return;
  }

  currentSessionId = sessionId;
  sessions[sessionId].lastActiveAt = Date.now();

  // Update model selector to match session's model
  if (sessions[sessionId].model) {
    modelSelect.value = sessions[sessionId].model;
  }

  // Render the session's messages
  renderMessages();
  updatePinUI();
  updateContextInfo();
  updateSessionsList();

  await saveSessions();
}

// Show delete confirmation modal
let sessionToDelete = null;

function showDeleteModal(sessionId) {
  const session = sessions[sessionId];
  if (!session) return;

  sessionToDelete = sessionId;

  const messageCount = session.messages.length;
  const pinnedCount = Object.keys(session.pinnedTabs).length;
  deleteSessionInfo.textContent = `${messageCount} message${messageCount !== 1 ? 's' : ''}, ${pinnedCount} pinned page${pinnedCount !== 1 ? 's' : ''}`;

  deleteModal.style.display = 'flex';
}

function hideDeleteModal() {
  deleteModal.style.display = 'none';
  sessionToDelete = null;
}

// Delete a session
async function deleteSession(sessionId) {
  if (!sessions[sessionId]) {
    return;
  }

  delete sessions[sessionId];

  // If we deleted the current session, switch to another or create new
  if (currentSessionId === sessionId) {
    const remainingSessions = Object.keys(sessions);
    if (remainingSessions.length > 0) {
      // Switch to most recently active session
      const sorted = remainingSessions.sort((a, b) =>
        sessions[b].lastActiveAt - sessions[a].lastActiveAt
      );
      await switchSession(sorted[0]);
    } else {
      // No sessions left, create a new one
      await newChat();
    }
  } else {
    updateSessionsList();
  }

  await saveSessions();
}

// Get sorted session list (most recent first)
function getSortedSessions() {
  return Object.values(sessions).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

// Update sessions list UI
function updateSessionsList() {
  const sessionsList = document.getElementById('sessionsList');
  if (!sessionsList) return;

  sessionsList.innerHTML = '';
  const sorted = getSortedSessions();

  sorted.forEach(sess => {
    const item = document.createElement('div');
    item.className = 'session-item' + (sess.id === currentSessionId ? ' active' : '');

    const info = document.createElement('div');
    info.className = 'session-info';

    const title = document.createElement('div');
    title.className = 'session-title';
    const messageCount = sess.messages.length;
    const pinnedCount = Object.keys(sess.pinnedTabs).length;
    title.textContent = `${messageCount} msg${messageCount !== 1 ? 's' : ''}${pinnedCount > 0 ? `, ${pinnedCount} pinned` : ''}`;

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    const date = new Date(sess.createdAt);
    meta.textContent = `${sess.model || 'unknown'} • ${date.toLocaleDateString()}`;

    info.appendChild(title);
    info.appendChild(meta);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'session-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete session';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      showDeleteModal(sess.id);
    };

    item.appendChild(info);
    item.appendChild(deleteBtn);

    item.onclick = () => {
      if (sess.id !== currentSessionId) {
        switchSession(sess.id);
      }
    };

    sessionsList.appendChild(item);
  });
}

// Start a new chat session
async function newChat() {
  // Create new session
  const newId = `session-${Date.now()}`;
  currentSessionId = newId;
  sessions[newId] = {
    id: newId,
    messages: [],
    pinnedTabs: {},
    model: modelSelect.value,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };

  await saveSessions();

  // Clear and render empty state
  renderMessages();
  updatePinUI();
  updateContextInfo();
  updateSessionsList();

  // Initialize new session with current model
  await initSession(modelSelect.value);
}

// Initialize session with selected model
async function initSession(model) {
  statusDot.className = 'status-dot connecting';
  statusText.textContent = 'Initializing...';

  try {
    const result = await rpcCall('InitSession', { model });
    statusDot.className = 'status-dot';
    statusText.textContent = result.model;
    session.model = result.model;
    await saveSessions();
  } catch (error) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Init failed';
    addMessageToDOM('error', `Failed to initialize: ${error.message}`);
  }
}

// Extract page content using Readability
async function extractPageContent(url) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      return null;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof Readability === 'undefined') {
          const article = document.querySelector('article') || document.body;
          const title = document.title;
          const clone = article.cloneNode(true);
          clone.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove());

          return {
            title: title,
            content: clone.innerText.trim(),
            url: window.location.href
          };
        }

        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone);
        const article = reader.parse();

        return article ? {
          title: article.title,
          content: article.textContent,
          url: window.location.href
        } : null;
      }
    });

    if (results?.[0]?.result) {
      const { title, content, url: extractedUrl } = results[0].result;

      // Mark this tab as pinned permanently and store content
      session.pinnedTabs[extractedUrl] = {
        title: title,
        content: content,
        pinnedAt: Date.now(),
        sent: false  // Will be sent with next chat message
      };

      updatePinUI();
      updateContextInfo();
      await saveSessions();

      return content;
    }

    return null;
  } catch (error) {
    console.error('Content extraction error:', error);
    return null;
  }
}

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Show loading indicator
function showLoading() {
  const loading = document.createElement('div');
  loading.className = 'message assistant loading';
  loading.id = 'loadingIndicator';
  loading.innerHTML = '<span></span><span></span><span></span>';
  chatContainer.appendChild(loading);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function hideLoading() {
  const loading = document.getElementById('loadingIndicator');
  if (loading) loading.remove();
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

async function getCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url || null;
  } catch {
    return null;
  }
}

// Send message
async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  messageInput.value = '';

  addMessage('user', message);
  showLoading();

  try {
    let context = '';

    // Collect context from all pinned tabs that haven't been sent yet
    const unsent = [];
    for (const [url, tabInfo] of Object.entries(session.pinnedTabs)) {
      if (!tabInfo.sent && tabInfo.content) {
        unsent.push(`## ${tabInfo.title}\nURL: ${url}\n\n${tabInfo.content}`);
        tabInfo.sent = true;  // Mark as sent
      }
    }

    if (unsent.length > 0) {
      context = unsent.join('\n\n---\n\n');
      console.log('[Lloro] Sending context for', unsent.length, 'pinned pages');
      await saveSessions();  // Save sent status
    }

    setStatus('working', 'Waiting for Gemini...');
    const result = await rpcCall('Chat', { message, context });
    console.log('[Lloro] Response received');

    hideLoading();
    checkHealth();
    addMessage('assistant', result.response || 'No response received');
  } catch (error) {
    console.error('[Lloro] Error:', error);
    hideLoading();
    setStatus('disconnected', 'Error');
    addMessageToDOM('error', `Error: ${error.message}`);
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// Event listeners
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
newChatBtn.addEventListener('click', newChat);

sessionsToggleBtn.addEventListener('click', () => {
  const isVisible = sessionsPanel.style.display !== 'none';
  sessionsPanel.style.display = isVisible ? 'none' : 'block';
  sessionsToggleBtn.classList.toggle('active', !isVisible);
  if (!isVisible) {
    updateSessionsList();
  }
});

modelSelect.addEventListener('change', () => {
  newChat();
});

// Modal event listeners
deleteCancelBtn.addEventListener('click', () => {
  hideDeleteModal();
});

deleteConfirmBtn.addEventListener('click', async () => {
  if (sessionToDelete) {
    await deleteSession(sessionToDelete);
    hideDeleteModal();
  }
});

// Close modal on overlay click
deleteModal.addEventListener('click', (e) => {
  if (e.target === deleteModal) {
    hideDeleteModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && deleteModal.style.display === 'flex') {
    hideDeleteModal();
  }
});

pinBtn.addEventListener('click', async () => {
  // Can't unpin if already pinned (button should be disabled anyway)
  if (isCurrentTabPinned()) {
    return;
  }

  // Pin the current tab by extracting its content
  setStatus('working', 'Extracting page...');
  const context = await extractPageContent();

  if (context) {
    console.log('[Lloro] Page pinned, context extracted');
    // Context will be sent with next chat message
  } else {
    console.log('[Lloro] Failed to extract page content');
    addMessageToDOM('error', 'Failed to extract page content');
  }

  setStatus('', '');
  checkHealth();
});

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  // Update current tab URL
  await updateCurrentTabUrl();

  // Try to migrate old storage format first
  await migrateOldStorage();

  // Load sessions
  const hasSessions = await loadSessions();
  if (hasSessions && getCurrentSession().messages.length > 0) {
    renderMessages();
    if (getCurrentSession().model) {
      modelSelect.value = getCurrentSession().model;
    }
  }
  updateContextInfo();
  updateSessionsList();

  // Check backend
  const healthy = await checkHealth();
  if (healthy) {
    setInterval(checkHealth, 30000);
  }

  // Listen for tab changes
  chrome.tabs.onActivated.addListener(async () => {
    await updateCurrentTabUrl();
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      await updateCurrentTabUrl();
    }
  });

  // Focus input field (with delay to ensure panel is ready)
  setTimeout(() => messageInput.focus(), 100);

  // Also focus when panel becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      messageInput.focus();
    }
  });
});

// Initial check
checkHealth();
