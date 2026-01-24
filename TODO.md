# Lloro Extension - Task List

## Session: 2026-01-24

### Pin Management Improvements

- [x] **Default to unpinned state**
  - Change default behavior: pages should NOT be sent by default
  - Current: `includePageContent = true` → Change to: `includePageContent = false`
  - Page content can be huge, so opt-in is better than opt-out
  - Location: `main.js`
  - ✅ COMPLETED: Changed line 17 and line 51 in main.js

- [x] **Tab switching updates pin context**
  - When user switches tabs, update which page can be pinned
  - Show previously pinned tabs in the current session
  - Track which tabs have been pinned per session
  - Update UI to reflect tab-specific pin state
  - ✅ COMPLETED: Added chrome.tabs listeners, updateCurrentTabUrl(), per-tab pin tracking

- [x] **Pin permanence within session**
  - Once a page is pinned in a session, it cannot be unpinned
  - Reason: Agent context already has the content
  - New session = fresh start, all pins cleared
  - UI should reflect this (maybe disable unpin button after pinning?)
  - ✅ COMPLETED: Pin button disabled after pinning, CSS styling for permanent state

### Session Management

- [x] **Session history navigation**
  - Implement ability to go back to previous sessions
  - Each session needs to track:
    - Messages history
    - Pinned pages/tabs
    - Model selection
    - Timestamps
  - UI for navigating between sessions
  - ✅ COMPLETED: Multi-session storage, switchSession(), sessions panel UI

- [x] **Session CRUD operations**
  - List all sessions
  - Switch between sessions
  - Delete old sessions
  - Each session maintains its own:
    - Pin state (which tabs were pinned)
    - Model (fixed per session)
    - Conversation history
  - ✅ COMPLETED: Session list with delete buttons, session switching, migration from old format

---

## Implementation Notes

### Current State Analysis
- Session state is currently stored in `chrome.storage.local`
- Model switching triggers new session (`InitSession` RPC call)
- No session history/navigation exists
- Pin state is global, not per-session

### Required Changes
1. **Data Model:** Need to track multiple sessions with IDs
2. **Storage Schema:** Update to support session array/map
3. **UI Components:** Session picker/switcher interface
4. **Pin Tracking:** Map of session → pinned tabs
5. **Default Behavior:** Flip `includePageContent` initial value

---

## Progress Tracking

- Total tasks: 5
- Completed: 5
- In progress: 0
- Remaining: 0

## All tasks completed! ✅

---

*Last updated: 2026-01-24*
