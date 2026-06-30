---
name: aim-resume
description: Manually resume a paused or waiting AIM task by task id
allowed-tools: Bash
argument-hint: <task-id>
---

Resume the AIM task whose id (or id prefix from `/aim-status`) is in `$ARGUMENTS`:

```bash
aim resume $ARGUMENTS
```

Fallback if `aim` is not on PATH:

```bash
node "${CLAUDE_PLUGIN_ROOT}/aim/dist/cli.js" resume $ARGUMENTS
```
