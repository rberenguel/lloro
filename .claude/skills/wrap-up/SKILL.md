---
name: wrap-up
description: Pre-commit wrap-up for Lloro — version bump, README check, summary
disable-model-invocation: false
---

# Wrap-Up: Pre-Commit Checklist

Prepare the Lloro codebase for commit.

## Your Responsibilities

1. **Version Bump**

   - Ask user which version bump type (patch/minor/major)
   - Read current version from `extension/manifest.json` (the only version file)
   - Calculate new version and update it
   - **Never** bump without user approval

2. **README Sanity Check**

   - Review what changed during the session
   - If new features, options, or troubleshooting scenarios were added, verify `README.md` covers them
   - If anything is missing, flag it to the user (don't silently add docs — they may have already done it)

3. **manifest.json Sanity Check**

   - If any new files were added to `extension/`, verify they're correctly referenced
     - Scripts loaded via `<script>` tags in `side_panel.html` don't need manifest entries
     - Only `web_accessible_resources` (scripts injected into pages) and `background.service_worker` need to be declared
   - Permissions: confirm nothing new is needed for what was added

4. **Summary Report**

   - Show version bump: e.g. `0.1.0 → 0.2.0`
   - List what changed this session
   - Flag anything that still needs attention
   - Ready for commit

## Key Files

- `extension/manifest.json` — version, permissions, declared resources
- `README.md` — user-facing docs
- `extension/side_panel.html` — UI markup and script loading
- `extension/main.js` — core logic
- `backend/main.go` — Go JSON-RPC server (separate from extension)

5. **Code Formatting**

   - Run `prettier . --write` in the repo root before commit
