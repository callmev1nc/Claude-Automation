---
name: aim-cancel
description: Cancel (remove) an AIM task by task id
allowed-tools: Bash
argument-hint: <task-id>
---

Cancel the AIM task whose id (or id prefix from `/aim-status`) is in `$ARGUMENTS`:

```bash
aim cancel $ARGUMENTS
```

Fallback if `aim` is not on PATH:

```bash
node "${CLAUDE_PLUGIN_ROOT}/aim/dist/cli.js" cancel $ARGUMENTS
```
