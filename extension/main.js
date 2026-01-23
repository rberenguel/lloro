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

// State
let isProcessing = false;
let includePageContent = true;  // Pin toggle state
let session = {
  messages: [],      // Array of {type, text}
  contextUrl: null,  // URL of page whose content was sent
  contextTitle: null, // Title of the page
  model: null
};

// Storage helpers
async function saveSession() {
  try {
    await chrome.storage.local.set({ lloro_session: session });
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

async function loadSession() {
  try {
    const data = await chrome.storage.local.get('lloro_session');
    if (data.lloro_session) {
      session = data.lloro_session;
      return true;
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
  return false;
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get('lloro_settings');
    if (data.lloro_settings) {
      includePageContent = data.lloro_settings.includePageContent ?? true;
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      lloro_settings: { includePageContent }
    });
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
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
  if (includePageContent) {
    pinBtn.classList.add('active');
    pinBtn.title = 'Page content will be included (click to disable)';
  } else {
    pinBtn.classList.remove('active');
    pinBtn.title = 'Page content excluded (click to include)';
  }
  updateContextInfo();
}

// Update context info display
function updateContextInfo() {
  if (!includePageContent) {
    contextInfo.textContent = 'Page content disabled';
  } else if (session.contextUrl) {
    contextInfo.textContent = `Context: ${session.contextTitle || session.contextUrl}`;
  } else {
    contextInfo.textContent = 'Page content will be included';
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
    saveSession();
  }
  return addMessageToDOM(type, text);
}

// Start a new chat session
async function newChat() {
  // Reset session
  session = {
    messages: [],
    contextUrl: null,
    contextTitle: null,
    model: modelSelect.value
  };
  await saveSession();

  // Clear and render empty state
  renderMessages();
  updateContextInfo();

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
    await saveSession();
  } catch (error) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Init failed';
    addMessageToDOM('error', `Failed to initialize: ${error.message}`);
  }
}

// Extract page content using Readability
async function extractPageContent() {
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
      const { title, content, url } = results[0].result;
      session.contextUrl = url;
      session.contextTitle = title;
      updateContextInfo();
      return `Title: ${title}\n\n${content}`;
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

    // Only extract/send context if pin is active and we haven't sent for this URL yet
    if (includePageContent) {
      const currentUrl = await getCurrentTabUrl();

      if (currentUrl !== session.contextUrl) {
        setStatus('working', 'Extracting page...');
        console.log('[Lloro] Extracting page content...');
        context = await extractPageContent() || '';
        console.log('[Lloro] Context length:', context.length);
        await saveSession(); // Save context URL
      } else {
        console.log('[Lloro] Skipping extraction (same page)');
      }
    } else {
      console.log('[Lloro] Page content disabled');
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

modelSelect.addEventListener('change', () => {
  newChat();
});

pinBtn.addEventListener('click', () => {
  includePageContent = !includePageContent;
  updatePinUI();
  saveSettings();
});

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  // Load settings
  await loadSettings();
  updatePinUI();

  // Load previous session
  const hasSession = await loadSession();
  if (hasSession && session.messages.length > 0) {
    renderMessages();
    if (session.model) {
      modelSelect.value = session.model;
    }
  }
  updateContextInfo();

  // Check backend
  const healthy = await checkHealth();
  if (healthy) {
    setInterval(checkHealth, 30000);
  }

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
