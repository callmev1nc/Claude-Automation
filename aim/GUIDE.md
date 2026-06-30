# AIM User Guide

AIM runs a Claude Code task for you and **keeps it going through usage-limit
resets automatically**. This guide shows you how to install it, run tasks, and
leave them running overnight with confidence.

---

## 1. Prerequisites

1. **Node.js 20 or newer** — check with `node --version`.
2. **Claude Code installed and logged in**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude            # log in once, interactively
   claude --version  # confirm it works
   ```

AIM talks to the same Claude Code you use manually, so it shares your
subscription/quota.

---

## 2. Install AIM

```bash
cd aim
npm install
npm run build
npm link            # optional: makes the `aim` command available everywhere
```

Without `npm link`, run via the dev launcher: `npm run dev -- <command>`.

Verify:
```bash
aim status          # prints: [aim] No tasks.
```

---

## 3. Run your first task

```bash
aim run "Explain what this repo does in 3 bullets"
```

You'll see Claude Code's answer stream to the terminal, then:
```
[aim] Task <id> completed.
```

For a real coding task, point it at your project with `--cwd`:
```bash
aim run "Add input validation to the signup form and a test for it" --cwd ./myapp
```

---

## 4. Permission modes (read this before long runs)

Claude Code normally **asks you to approve** tool use (file edits, shell
commands). Unattended, no one is there to approve — so AIM must launch Claude
Code with a permission mode. Choose based on how much you trust the task:

| Mode | What it does | When to use |
|------|--------------|-------------|
| `acceptEdits` **(default)** | Auto-approves file edits; other tools (shell, etc.) are allowed only if in the `--allowed-tools` list. | Most tasks. Safer default. |
| `bypassPermissions` | Approves **everything** with no restrictions. | Only when you fully trust the prompt. AIM shows a 5-second warning first. |

The default also applies a **safe tool allowlist** (Read, Edit, Write, Bash, Glob,
Grep, WebFetch, WebSearch) so common operations don't stall waiting for approval.

Override the allowlist:
```bash
aim run "..." --allowed-tools "Read,Write,Bash"
```

> ⚠️ **`bypassPermissions` is powerful and dangerous** — Claude Code can run any
> command and modify any file, unattended. Use it only for prompts you'd be
> comfortable letting run with no supervision.

---

## 5. What happens when the rate limit hits

This is the whole point of AIM. When Claude Code stops because of a usage limit:

1. AIM detects it, prints `[aim] Rate-limited. Retrying in ~N min.`, and sends a
   desktop notification.
2. It waits until the reset window reopens (it reads the reset time from Claude's
   message — **converted to your local timezone** — or estimates from the 5-hour
   window).
3. It resumes the **exact same session** with `--resume` and keeps going.
4. This repeats until the task completes (or hits a safety limit).

When it finishes you'll get a `Task completed` notification.

If you hit the **weekly cap** (a separate 7-day limit), AIM pauses and notifies
you instead of pointlessly retrying — that one needs days, not hours.

---

## 6. Running overnight / unattended

AIM supervises in the **foreground**, so the process must keep running while you're
away. Pick whichever fits your OS:

**A. Just leave a terminal open (simplest):**
```bash
aim run "..." --cwd ./myapp
```
Leave that terminal window open overnight.

**B. PM2 (survives logout/reboot, restarts on crash):**
```bash
npm install -g pm2
pm2 start "node dist/cli.js run '...' --cwd ./myapp" --name aim-task
pm2 logs aim-task
```

**C. Windows Task Scheduler** — create a task that runs
`node dist\cli.js run "..." --cwd C:\myapp` at a set time.

**Crash recovery:** state is saved to `~/.aim/state.json`. If AIM dies mid-wait,
restart and resume everything:
```bash
aim daemon        # resumes all waiting/running tasks
```
Or resume one task: `aim resume <id>`.

---

## 7. Commands

```bash
aim run "<prompt>" [--cwd <dir>] [--permission-mode <mode>] [--allowed-tools "A,B"]
    Start a task under AIM's supervision (foreground).

aim status
    Show recent tasks and their state (▶ running, ⏳ waiting, ✓ done, ⏸ paused).

aim resume <task-id>
    Manually resume a paused/waiting task.

aim cancel <task-id>
    Remove a task.

aim attach <claude-session-id> [--cwd <dir>]
    Best-effort: take over an existing Claude Code session you already started.

aim daemon
    Restore and supervise any tasks that were waiting/running (use after a crash).
```

Task IDs are shown by `aim status` (the short prefix works as a hint; use the full
id from the `Starting task:` line for `resume`/`cancel`).

---

## 8. Where things are stored

- **State:** `~/.aim/state.json` — your tasks and their history.
- **Audit log:** `~/.aim/audit/<session-id>.jsonl` — every tool use the unattended
  agent made (timestamp, tool, input). Review this after a run to see what it did.
- **Claude Code transcripts:** `~/.claude/projects/…/<session-id>.jsonl` (Claude's
  own files; AIM reads them to classify stops).

---

## 9. Notifications

AIM posts desktop toasts (and always logs to the console) for: rate-limit hit,
resume, completion, and stuck/paused. To disable toasts (e.g. in CI):
```bash
export AIM_NO_TOAST=1
```

---

## 10. Troubleshooting

**"Claude Code cannot be launched inside another Claude Code session"**
This only happens if you run `aim` from *inside* a Claude Code session. AIM strips
the relevant env var automatically, but if you see it, run `aim` from a normal
terminal (cmd/PowerShell/Windows Terminal) instead.

**Nothing happens / spawn error**
Confirm Claude Code is installed and on PATH: `claude --version`. AIM resolves
Claude Code's entry from `npm root -g`; if you installed it somewhere unusual, put
it on the global PATH.

**Task stalls (no progress)**
You likely need more tools than the default allowlist permits. Either pass
`--allowed-tools` with the tools the task needs, or — if you trust it — use
`--permission-mode bypassPermissions`.

**It says "Rate-limited" but you think it finished**
The first run completed but AIM is testing/forced — that only happens with the
debug flag. In normal operation a `DONE (COMPLETED)` status means it really
finished.

**Testing the resume loop without waiting hours:**
```bash
# Forces a rate-limit on the first attempt, waits 4s, then resumes and completes.
AIM_DEBUG_FORCE_RATE_LIMIT=1 AIM_DEBUG_DELAY_MS=4000 aim run "say OK"
```

---

## 11. Limitations (v1)

- **Claude Code only.** Other agents (Codex CLI, aider) and other providers
  (GLM, Gemini, OpenAI, DeepSeek) are planned for later versions.
- **No failover yet** — it waits and resumes the same account, it doesn't switch
  to another.
- Reset-time parsing is best-effort; **poll-and-retry guarantees eventual resume**
  regardless.
- One foreground supervisor per `aim run` (use PM2/Task Scheduler for true
  background operation).
