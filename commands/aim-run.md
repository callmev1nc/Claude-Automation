---
name: aim-run
description: Run a Claude Code task under AIM supervision with auto-resume on usage limits (launches a separate, unattended process)
allowed-tools: Bash
argument-hint: "<task prompt>" [--cwd <dir>] [--permission-mode acceptEdits|bypassPermissions]
---

Launch a supervised AIM task using the user's prompt and flags in `$ARGUMENTS`. The prompt MUST be quoted, e.g. `/aim-run "build the login page" --cwd ./app`.

```bash
aim run $ARGUMENTS
```

Fallback if `aim` is not on PATH:

```bash
node "${CLAUDE_PLUGIN_ROOT}/aim/dist/cli.js" run $ARGUMENTS
```

Important notes for the user:
- This spawns a **separate Claude Code process** that runs unattended and **auto-resumes the exact session** whenever it hits a usage limit, looping until the task finishes (or gets genuinely stuck, then it pauses and notifies).
- Default permission mode is `acceptEdits` (auto-approves file edits; common tools allowed). Only use `--permission-mode bypassPermissions` if the user explicitly wants full, unattended autonomy — it can run any command and edit any file with no approval.
- They can check progress any time with `/aim-status`.
