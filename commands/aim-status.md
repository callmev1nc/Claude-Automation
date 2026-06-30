---
name: aim-status
description: Show AIM tasks and their status (running, waiting for quota reset, done, paused)
allowed-tools: Bash
---

Show the user's AIM (AI Session Continuity Manager) tasks. Run this and display the output verbatim:

```bash
aim status
```

If `aim` is not on PATH, fall back to the plugin's built CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/aim/dist/cli.js" status
```

Briefly explain any `WAITING` (paused for a rate-limit reset) or `PAUSED` (weekly cap / error) tasks to the user.
