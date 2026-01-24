# <img src="extension/media/icon128.png" alt="Lloro Icon" width="32" height="32"> Lloro

Chrome Extension + Go Backend for chatting with page content using Gemini CLI via the Agent Client Protocol (ACP).

> [!WARNING]
> Don't blame me if you get prompt injected, use this at your own risk.

![Lloro Screenshot](extension/media/screenshot.png)

## What's New in v0.1.0

- **🎯 Smart Pinning**: Pages are no longer sent by default - click the pin button to opt-in
- **📌 Pin Permanence**: Pinned pages cannot be unpinned within a session (AI already has the context)
- **🗂️ Multi-Session Management**: Create, switch between, and delete multiple conversation sessions
- **🔄 Tab Awareness**: Extension tracks which tab you're viewing and updates pin state accordingly
- **📊 Session History**: View all sessions with metadata (message count, pins, model, date)
- **🔁 Auto-Migration**: Automatically upgrades from v0.0.1 single-session format
- **💾 Better Storage**: Each session maintains its own pins, messages, and model selection

## Prerequisites

- Go 1.21+
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated
- Chrome/Chromium browser

### Gemini CLI Setup

1. Install the latest version of Gemini CLI:
   ```bash
   npm install -g @google/gemini-cli
   ```

2. Authenticate:
   ```bash
   gemini
   ```

3. (Optional) Enable Gemini 3 preview models:
   ```bash
   gemini settings
   ```
   Navigate to model settings and enable the preview models if you want access to `gemini-3-flash-preview` and `gemini-3-pro-preview`.

## Project Structure

```
ext/
├── backend/           # Go JSON-RPC server (ACP wrapper)
│   ├── go.mod
│   └── main.go
├── extension/         # Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── side_panel.html
│   ├── main.js
│   ├── content.js
│   ├── Readability.js
│   ├── marked.min.js
│   └── icons/
└── README.md
```

## How It Works

The backend spawns `gemini --experimental-acp` as a subprocess and communicates with it using the [Agent Client Protocol](https://agentclientprotocol.com/) (JSON-RPC over stdio). This maintains a persistent session with conversation history, so you can have multi-turn conversations about page content.

### Key Features

- **Session Management**: Create and manage multiple conversation sessions, each with its own history and context
- **Smart Page Pinning**: Opt-in to send page content - click the pin button to extract and include current page content
- **Tab-Aware Context**: Pin multiple tabs per session, automatically tracks which tab you're viewing
- **Pin Permanence**: Once a page is pinned in a session, it cannot be unpinned (the AI already has the context)
- **Session History**: Navigate between previous sessions, delete old ones, see session metadata
- **Auto-Migration**: Automatically migrates from old single-session format to new multi-session storage

## Setup

### 1. Start the Backend

```bash
cd backend
go run main.go
```

The server starts on `http://localhost:6363`. Endpoints:
- `POST /rpc` - JSON-RPC endpoint
- `GET /health` - Health check

### 2. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` directory

### 3. Use the Extension

1. Click the extension icon in Chrome toolbar to open the side panel (or press `Ctrl+Period`)
2. Select a model from the dropdown (default: gemini-3-flash-preview)
3. Navigate to any webpage
4. **Optional**: Click the 📌 pin button to extract and include current page content
   - By default, pages are NOT sent to save tokens
   - Once pinned, the page content will be sent with your next message
   - Pinned pages cannot be unpinned in the same session
5. Type a question and press Enter
6. Use the "+" button to start a new conversation (clears all pins)
7. Use the "☰" button to view, switch between, or delete previous sessions

## Features Explained

### Pin Management

- **Default Behavior**: Pages are NOT automatically sent to the AI (to save tokens and prevent large context)
- **Pinning a Page**: Click the 📌 pin button to extract the current page's content
  - Uses Readability.js for intelligent article extraction
  - Falls back to manual DOM extraction if Readability fails
  - Content is stored and will be sent with your next chat message
- **Pin Permanence**: Once a page is pinned and its content sent to the AI, it cannot be unpinned
  - This is because the AI's context already includes the page
  - The pin button becomes disabled and shows as "permanent"
  - Starting a new session clears all pins
- **Multiple Tabs**: You can pin multiple tabs in a single session
  - Each tab's content is tracked separately
  - Context bar shows how many tabs are pinned and which need to be sent
  - Format: "📌 Current page • N to send" or "N sent"

### Session Management

- **Multiple Sessions**: Create and manage unlimited conversation sessions
  - Each session has its own message history
  - Each session has its own set of pinned pages
  - Each session is locked to a specific AI model
- **Session List**: Click the ☰ button to view all sessions
  - Shows: message count, pinned page count, model, creation date
  - Active session is highlighted
  - Sessions sorted by most recently active
- **Session Switching**: Click any session in the list to switch to it
  - Restores all messages and pin states
  - Updates model selector to match session's model
- **Delete Sessions**: Click the × button on any session to delete it
  - Confirmation required
  - If you delete the active session, automatically switches to next most recent
  - If no sessions remain, creates a new one
- **New Session**: Click the + button to start fresh
  - Clears all messages
  - Clears all pinned pages
  - Uses currently selected model

### Tab Awareness

- **Automatic Tracking**: Extension monitors which tab you're viewing
  - Updates pin button state based on current tab
  - Shows if current tab is already pinned
- **Tab Switching**: When you switch tabs:
  - Pin button updates to reflect new tab's pin state
  - Context bar shows if current tab is pinned
  - Previously pinned tabs remain in session memory
- **Per-Tab Pin State**: Each tab URL is tracked independently
  - Same URL on different tabs = same pin state
  - Different URLs = different pin states
  - Pin states persist within a session

## JSON-RPC API

### InitSession

Initializes or resets the Gemini CLI agent with a specific model.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "InitSession",
  "params": { "model": "gemini-3-flash-preview" }
}
```

### Chat

Sends a message with optional page context to the agent.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "Chat",
  "params": {
    "message": "Summarize this article",
    "context": "Page content here..."
  }
}
```

## Configuration

### Environment Variables

- `PORT` - Backend server port (default: 6363)

### Available Models

- `gemini-3-flash-preview` (default)
- `gemini-3-pro-preview`
- `gemini-2.5-flash`
- `gemini-2.5-pro`
- `gemini-2.5-flash-lite`

## Troubleshooting

### Backend shows "ACP initialize failed, falling back to non-interactive mode"

This usually means the Gemini CLI version doesn't support ACP or there's an authentication issue:
1. Update Gemini CLI: `npm update -g @google/gemini-cli`
2. Re-authenticate: `gemini`
3. Check that `gemini --experimental-acp` works in your terminal

### Backend shows "failed to start gemini-cli"

Ensure `gemini` CLI is installed and in your PATH:
```bash
which gemini
gemini --version
```

### Extension shows "Backend offline"

1. Verify the backend is running: `curl http://localhost:6363/health`
2. Check for port conflicts
3. Ensure CORS is working (check browser console for errors)

### Model not found error

If you see "ModelNotFoundError", the selected model may not be enabled:
1. Run `gemini settings` and check available models
2. Enable preview models if using Gemini 3

### Content extraction fails

Some pages block content scripts. The extension falls back to basic text extraction if Readability fails.

### Pin button not working

1. Check that the page allows content scripts (some pages like chrome:// or chrome-extension:// block them)
2. Look for errors in the browser console (F12)
3. Try refreshing the page and the extension

### Sessions not loading

The extension automatically migrates from the old single-session storage format (v0.0.1) to the new multi-session format (v0.1.0+). If you experience issues:
1. Check browser console for migration errors
2. Your old session should appear in the sessions list
3. If migration fails, old data is preserved at `chrome.storage.local.lloro_session`

## Development

### Backend

```bash
cd backend
go run main.go
```

### Extension

After making changes to extension files:
1. Go to `chrome://extensions`
2. Click the refresh icon on the extension card
