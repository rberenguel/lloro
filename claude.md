# Lloro Chrome Extension - Technical Documentation

## Project Overview

**Lloro** is a Chrome extension that enables users to chat about webpage content using Google's Gemini AI model. The extension communicates with a Go backend server that wraps the Gemini CLI via the Agent Client Protocol (ACP), allowing multi-turn conversations with persistent session history.

**Version:** 0.1.0
**Extension Size:** ~165 KB unpacked
**Manifest Version:** 3 (modern Chrome extension format)

## Recent Changes (v0.1.0)

- **Pin Management**: Changed from automatic to opt-in page content sending
- **Multi-Session Support**: Full session management with CRUD operations
- **Tab Awareness**: Tracks active tab and updates pin state accordingly
- **Pin Permanence**: Pinned pages cannot be unpinned within a session
- **Session History**: Navigate between, view, and delete previous sessions
- **Storage Migration**: Auto-migrates from v0.0.1 single-session format

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────┐
│        Chrome Browser                   │
├─────────────────────────────────────────┤
│  Side Panel UI (side_panel.html)        │
│  Main Logic (main.js)                   │
├─────────────────────────────────────────┤
│  Background Service Worker              │
│  (background.js)                        │
├─────────────────────────────────────────┤
│  Content Script (content.js)            │
│  Readability.js                         │
├─────────────────────────────────────────┤
│        Webpage DOM                      │
└─────────────────────────────────────────┘
         ↓ Network ↓
┌─────────────────────────────────────────┐
│   Go Backend Server (port 6363)         │
│   - JSON-RPC endpoint (/rpc)            │
│   - Health check (/health)              │
├─────────────────────────────────────────┤
│   Gemini CLI subprocess                 │
│   (Agent Client Protocol - ACP)         │
├─────────────────────────────────────────┤
│   Google Gemini AI Model                │
└─────────────────────────────────────────┘
```

### Component Overview

| Component | File | Lines of Code | Purpose |
|-----------|------|---------------|---------|
| Service Worker | `background.js` | 7 | Opens side panel on click |
| Content Script | `content.js` | 102 | Extracts page content |
| UI Logic | `main.js` | 419 | Core application logic |
| UI Markup | `side_panel.html` | 490 | Side panel interface |
| Readability | `Readability.js` | 2,786 | Article extraction library |
| Markdown | `marked.min.js` | - | Markdown rendering |

---

## File Structure

```
/Users/ruben/code/ext/extension/
├── manifest.json              # Extension configuration (895 B)
├── background.js              # Service worker (251 B)
├── content.js                 # Content extraction (2,655 B)
├── main.js                    # Main UI logic (11,060 B)
├── side_panel.html            # UI markup & styles (10,823 B)
├── marked.min.js              # Markdown library (39,903 B)
├── Readability.js             # Article extraction (89,980 B)
└── media/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    ├── icon.png
    └── screenshot.png
```

---

## Component Details

### 1. Manifest Configuration (`manifest.json`)

**Key Settings:**
- **Name:** Lloro
- **Version:** 0.0.1
- **Manifest Version:** 3

**Permissions:**
```json
{
  "permissions": ["sidePanel", "activeTab", "scripting", "storage"],
  "host_permissions": ["http://localhost:6363/*", "<all_urls>"]
}
```

**Permission Breakdown:**
- `sidePanel` - Enables side panel UI (Chrome 114+)
- `activeTab` - Access to current active tab
- `scripting` - Execute scripts in pages
- `storage` - Local storage for session persistence
- `localhost:6363/*` - Backend JSON-RPC server
- `<all_urls>` - Access all websites for content extraction

**UI Configuration:**
- Side panel: `side_panel.html`
- Keyboard shortcut: `Ctrl+Period` (Windows) or `MacCtrl+Period` (Mac)
- Icons: 16x16, 48x48, 128x128 PNG

**Web-Accessible Resources:**
- `Readability.js` exposed to content scripts

---

### 2. Background Service Worker (`background.js`)

**Responsibilities:**
- Listens for extension icon clicks
- Opens side panel when clicked
- Minimal implementation (7 lines)

```javascript
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

---

### 3. Content Script (`content.js`)

**Purpose:** Extract readable content from webpages

**Key Features:**
1. **Injection Guard:** Prevents duplicate loading
2. **Message Listener:** Waits for extraction requests
3. **Dual Extraction Strategy:**
   - Primary: Readability.js for advanced article parsing
   - Fallback: Manual DOM extraction

**Extraction Flow:**
```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    try {
      const content = extractContent();
      sendResponse({ success: true, content });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});
```

**Readability.js Integration:**
- Clones document to avoid DOM mutation
- Extracts: title, content, excerpt, byline, siteName

**Fallback Extraction:**
1. Tries standard selectors: `article`, `[role="main"]`, `main`, `.post-content`
2. Falls back to `document.body`
3. Removes scripts, styles, navigation, ads, comments
4. Cleans whitespace and formats text

**Output Format:**
```javascript
{
  title: string,
  content: string,      // Full article text
  excerpt: string,      // First 500 chars
  byline: string | null,
  siteName: string      // domain.com
}
```

---

### 4. Main Panel Logic (`main.js`)

**The core application logic (419 lines)**

**State Management:**
```javascript
let session = {
  messages: [],          // Array of {type, text}
  contextUrl: null,      // URL of context
  contextTitle: null,    // Page title
  model: null            // Selected AI model
};

let includePageContent = true;  // Pin toggle state
let isProcessing = false;       // Processing lock
```

**Key Features:**

#### Session Persistence
- Uses `chrome.storage.local` to persist conversation history
- Saves messages, URLs, and settings between sessions
- Allows users to resume conversations

#### Health Checking
```javascript
async function checkHealth() {
  const response = await fetch(`${BACKEND_URL}/health`);
  const data = await response.json();

  statusDot.className = 'status-dot';
  statusText.textContent = data.model || 'Ready';
  return true;
}
```
- Runs every 30 seconds
- Monitors backend availability
- Updates status indicator

#### JSON-RPC Communication
```javascript
async function rpcCall(method, params) {
  const response = await fetch(`${RPC_ENDPOINT}`, {
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
  if (data.error) throw new Error(data.error.message);
  return data.result;
}
```

**RPC Methods:**
1. **InitSession** - Initialize conversation with selected model
2. **Chat** - Send message with optional page context

#### Smart Context Management
- Only extracts page content on first message to a URL
- Skips re-extraction when navigating back to same URL
- Can be disabled via pin button
- Tracks `session.contextUrl` to prevent redundant extractions

#### Message Rendering
Uses **marked.js (v15.0.12)** for Markdown rendering:
```javascript
marked.setOptions({
  breaks: true,     // \n → <br>
  gfm: true         // GitHub Flavored Markdown
});

if (type === 'assistant') {
  msg.innerHTML = marked.parse(text);  // Renders HTML
} else if (type === 'user') {
  msg.textContent = text;               // Plain text
}
```

**Markdown Support:**
- Code blocks with syntax highlighting
- Bold, italic, strikethrough
- Lists, blockquotes, tables
- Links (clickable)
- Headers (styled with colors)

#### UI State Management
- Auto-scrolling chat to bottom
- Textarea height expansion (min 44px, max 200px)
- Send button disabled during processing
- Status indicator with animations
- Loading animation (3 bouncing dots)

**Keyboard Shortcuts:**
- `Enter` to send message
- `Shift+Enter` for newline
- Auto-focus when panel becomes visible

---

### 5. Side Panel UI (`side_panel.html`)

**Layout Structure:**
```
┌─────────────────────────────────────────┐
│  Header: "LLORO" | [+] | Model Select  │  (28px)
├─────────────────────────────────────────┤
│  Status Bar: [●] Status text            │  (24px)
├─────────────────────────────────────────┤
│                                         │
│  Chat Container (scrollable)            │  (flexible)
│  - System messages (centered)           │
│  - User messages (right-aligned, blue)  │
│  - Assistant messages (left, dark)      │
│  - Error messages (red)                 │
│                                         │
├─────────────────────────────────────────┤
│ Context Bar: [📌] Context Info          │  (38px)
├─────────────────────────────────────────┤
│ Input Area: [Textarea] | [Send]         │  (68px)
└─────────────────────────────────────────┘
```

**Design System (Solarized Dark Theme):**
- Base: Pure black (#000000)
- Text: Light gray (#839496)
- Accent: Cyan (#2aa198)
- Error: Red (#dc322f)
- Success: Green (#859900)
- Status: Yellow (#b58900)

**UI Components:**

1. **Header Controls:**
   - "+" button: New conversation
   - Model dropdown: 5 AI models (defaults to `gemini-3-flash-preview`)

2. **Status Bar:**
   - Dot indicator: Green (ready), Red (offline), Yellow/Cyan (working)
   - Text: Model name or status message
   - Pulse animation during processing

3. **Chat Container:**
   - Scrollable with custom scrollbar
   - Message styles:
     - User: Right-aligned, blue border
     - Assistant: Left-aligned, markdown rendered
     - System: Centered, muted
     - Error: Red border and text

4. **Context Bar:**
   - Pin button (toggles page content)
   - Context info text
   - Visual feedback when active

5. **Input Area:**
   - Auto-expanding textarea (44-200px)
   - Send button with arrow icon
   - Placeholder: "Ask about this page..."

---

## Communication Protocol

### JSON-RPC 2.0 Standard

**Request Format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1738123456,
  "method": "Chat",
  "params": {
    "message": "What is this page about?",
    "context": "Title: Example\n\nPage content..."
  }
}
```

**Response Format (Success):**
```json
{
  "jsonrpc": "2.0",
  "id": 1738123456,
  "result": {
    "response": "This page is about..."
  }
}
```

**Response Format (Error):**
```json
{
  "jsonrpc": "2.0",
  "id": 1738123456,
  "error": {
    "code": -32000,
    "message": "Backend error description"
  }
}
```

### API Methods

| Method | Parameters | Response | Purpose |
|--------|-----------|----------|---------|
| `InitSession` | `{ model: string }` | `{ model: string }` | Initialize conversation |
| `Chat` | `{ message: string, context?: string }` | `{ response: string }` | Send message to AI |
| `GET /health` | N/A | `{ model: string }` | Check backend status |

**Backend Endpoints:**
- JSON-RPC: `http://localhost:6363/rpc`
- Health Check: `http://localhost:6363/health`

---

## Data Flow

### Complete Message Journey

**Step 1: User Input**
```
User types message in textarea → Press Enter
```

**Step 2: Extraction Check**
```
if (includePageContent && currentUrl !== session.contextUrl) {
  → Extract page content via content script
  → Display "Extracting page..." status
}
```

**Step 3: RPC Call**
```
POST http://localhost:6363/rpc
{
  "jsonrpc": "2.0",
  "id": <timestamp>,
  "method": "Chat",
  "params": {
    "message": "User message",
    "context": "Page content (if new URL)"
  }
}
```

**Step 4: Backend Processing**
```
Go server → Pass to Gemini CLI subprocess
→ Maintain ACP session with Gemini
→ Return response
```

**Step 5: UI Update**
```
Receive response → Parse Markdown
→ Render with marked.js
→ Add to chat container
→ Scroll to bottom
→ Save to session storage
```

**Step 6: Persistence**
```
Message saved to chrome.storage.local
→ Retrievable on next session
→ Associated with model/URL
```

---

## Key Features

### 1. Multi-Turn Conversations
- Maintains persistent session history
- User/AI messages stored in IndexedDB
- Resume conversations across browser sessions
- Model selection triggers new session

### 2. Context-Aware Chat
- Extracts page content using Readability.js
- Automatically sends context with first message to new URL
- Pin button to toggle page content inclusion
- Shows which page the context comes from

### 3. Content Extraction
- Readability.js for intelligent article parsing
- Fallback manual extraction via DOM selectors
- Handles blogs, news sites, documentation
- Removes navigation, ads, comments

### 4. Status Monitoring
- Real-time backend health checks
- Shows model availability
- Connection status indicator
- Auto-reconnect attempts

### 5. Session Management
- Local storage persistence
- URL-based context tracking
- New chat button for fresh conversations
- Model switching triggers reset

### 6. Rich UI Experience
- Markdown rendering with syntax highlighting
- Auto-expanding input textarea
- Loading animations
- Responsive layout
- Dark theme (Solarized)

---

## Dependencies

### Internal Libraries

1. **marked.min.js (v15.0.12, 39.9 KB)**
   - Markdown parser and renderer
   - GitHub Flavored Markdown support
   - Converts assistant responses to formatted HTML

2. **Readability.js (2,786 lines, 89.9 KB)**
   - Based on Arc90's readability algorithm
   - Extracts main article content
   - Filters ads, navigation, comments

### External Dependencies
- Chrome APIs (native)
- Fetch API (native)
- ES6+ JavaScript

**No Runtime Dependencies:**
- No npm packages
- No external CDNs
- All libraries included locally

---

## User Workflow

### Setup
1. Start Go backend: `go run main.go`
2. Load extension in Chrome: `chrome://extensions`
3. Click extension icon or press `Ctrl+Period`

### First Message
1. Navigate to any webpage
2. Open Lloro side panel
3. Select model (optional, defaults to Gemini 3 Flash)
4. Type question: "What is this page about?"
5. Press Enter

### Backend Action
1. Extension extracts page content
2. Sends message + context via JSON-RPC
3. Backend spawns `gemini --experimental-acp` subprocess
4. Maintains persistent ACP session
5. Returns AI response

### Response Handling
1. Extension receives markdown response
2. Renders with marked.js
3. Displays in chat container
4. Saves to storage

### Follow-up Messages
- No re-extraction for same URL
- Just send message to backend
- Backend uses existing ACP session
- Conversation history maintained

### New Conversation
- Click "+" button to reset
- Switch model → triggers new InitSession
- Navigate new URL → triggers new extraction

---

## Technical Strengths

1. **Clean Architecture:** Separation of concerns (background, content, UI)
2. **Efficient Extraction:** Readability.js with fallback strategy
3. **Persistent Sessions:** Maintains conversation history
4. **Real-time Monitoring:** Backend health checks
5. **Modern Patterns:** Manifest v3 compliance
6. **Minimal Dependencies:** No npm bloat
7. **Rich Rendering:** Markdown support for AI responses
8. **Smart Context:** Avoids redundant extractions

---

## Areas for Improvement

### Security
- **Prompt Injection Risk:** Content sent directly to AI without sanitization
- **Privacy Concerns:** All page content sent to backend
- **Local Storage Growth:** Conversation history not pruned
- **HTTP Only:** Backend assumes localhost (could use HTTPS)

### User Experience
- **Error Recovery:** Failed extractions silently continue
- **No Rate Limiting:** Could spam backend
- **Backend Dependency:** Requires separate Go server
- **Limited Offline Mode:** No fallback when backend unavailable

### Functionality
- **No Message Editing:** Can't edit sent messages
- **No Export:** Can't export conversations
- **Limited Model Info:** Doesn't show token usage or costs
- **No Search:** Can't search message history
- **Single Session:** Can't manage multiple conversations

### Technical
- **No TypeScript:** Plain JavaScript (harder to maintain)
- **No Tests:** No unit or integration tests
- **No Build Process:** Manual file management
- **Large Dependencies:** Readability.js could be optimized
- **No Error Boundaries:** UI could crash on errors

---

## Code Quality Metrics

| Aspect | Status | Notes |
|--------|--------|-------|
| Code Organization | Good | Clear separation of concerns |
| Error Handling | Moderate | Basic try-catch, could be improved |
| Documentation | Minimal | Few inline comments |
| Testing | None | No test suite |
| Type Safety | None | Plain JavaScript |
| Performance | Good | Efficient rendering, minimal re-renders |
| Security | Moderate | Potential prompt injection risk |
| Accessibility | Basic | Color indicators only |

---

## File Details

### Code Statistics

| File | Size | Language | Purpose |
|------|------|----------|---------|
| `manifest.json` | 895 B | JSON | Extension config |
| `background.js` | 251 B | JavaScript | Service worker |
| `content.js` | 2,655 B | JavaScript | Content extraction |
| `main.js` | 11,060 B | JavaScript | UI logic |
| `side_panel.html` | 10,823 B | HTML/CSS | UI markup |
| `marked.min.js` | 39,903 B | JavaScript | Markdown library |
| `Readability.js` | 89,980 B | JavaScript | Article extraction |

**Total Extension Size:** ~155 KB unpacked

---

## References

- **Chrome Extension Manifest V3:** https://developer.chrome.com/docs/extensions/mv3/
- **Readability.js:** https://github.com/mozilla/readability
- **marked.js:** https://marked.js.org/
- **JSON-RPC 2.0:** https://www.jsonrpc.org/specification
- **Gemini CLI:** Google's official Gemini command-line interface
- **Agent Client Protocol (ACP):** Multi-turn conversation protocol

---

## Notes

- Extension communicates with Go backend at `localhost:6363`
- Requires Gemini CLI installed and configured
- Uses experimental ACP flag: `gemini --experimental-acp`
- Conversation state persisted in Chrome storage
- Content extraction works best on article-style pages
- Markdown rendering supports GitHub Flavored Markdown (GFM)

---

*Documentation generated: 2026-01-24*
*Extension Version: 0.0.1*
