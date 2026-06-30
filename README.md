# AIM — AI Session Continuity Manager

**A Claude Code companion that runs long tasks unattended and auto-resumes them after usage-limit resets.**

Start a task, walk away (or sleep) — when Claude Code hits a rate limit, AIM waits out the reset window and resumes the **exact same session** automatically, looping until the task finishes (or gets genuinely stuck, then it pauses and notifies you). This repo doubles as an installable **Claude Code plugin** that adds `/aim` slash commands.

> v1: Claude Code only · personal/local · core pause→wait→resume loop. Failover, multi-agent, dashboards, and SaaS are on the roadmap (see [aim/README.md](./aim/README.md)).

---

## How it works

AIM wraps the `claude` CLI and owns the process lifecycle:

1. Spawns `claude -p "<task>" --session-id <uuid> --output-format stream-json …` and streams the output.
2. When it exits, AIM **classifies** the stop (`COMPLETED | RATE_LIMITED | WEEKLY_CAP | ERROR`) from the structured result event, output, and transcript.
3. If rate-limited, it **estimates** the reset time (parses the message — with timezone conversion `5:00 PM PDT → UTC` — else the 5-hour rolling window, else polls), waits, then re-spawns `claude -p "continue" --resume <uuid>`.
4. **Poll-and-retry is always on**, so resume succeeds even if reset-time parsing is imperfect.

State persists to `~/.aim/state.json`, so if AIM itself crashes, `aim daemon` (or `aim resume <id>`) picks the task back up. A per-task lock prevents two supervisors from driving the same task.

---

## Requirements

- **Node.js ≥ 20** — check with `node --version`.
- **Claude Code installed and logged in**:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude            # log in once
  claude --version  # confirm
  ```

---

## 1) Install the AIM CLI

```bash
git clone https://github.com/callmev1nc/Claude-Automation.git
cd Claude-Automation/aim
npm install
npm run build        # -> aim/dist/cli.js
```

**Recommended:** put `aim` on your PATH so the plugin commands (and your terminal) can call it directly:

```bash
npm link             # makes the `aim` command available globally
aim status           # should print: [aim] No tasks.
```

> No `npm link`? The plugin commands also work via the built file (`node …/aim/dist/cli.js`) — see the fallback in each command.

Verify it runs (uses a tiny amount of your Claude quota):

```bash
aim run "Reply with exactly OK."
```

---

## 2) Set up as a Claude Code plugin

This repo is a Claude Code plugin (manifest at [`.claude-plugin/plugin.json`](./.claude-plugin/plugin.json)) that adds four slash commands: `/aim-run`, `/aim-status`, `/aim-resume`, `/aim-cancel`.

### Option A — Install from GitHub (recommended)

Inside any Claude Code session:

```
/plugin marketplace add callmev1nc/Claude-Automation
/plugin install aim@callmev1nc-claude-automation
```

Then restart Claude Code (or run `/plugin reload`) so the commands register.

### Option B — Install from a local clone

If you cloned this repo locally:

```
/plugin marketplace add /absolute/path/to/Claude-Automation
/plugin install aim@callmev1nc-claude-automation
```

> Either way, **the AIM CLI must be built first** (`npm install && npm run build` in `aim/`, and ideally `npm link`) — the plugin commands call `aim` / `aim/dist/cli.js`.

---

## 3) Use it

From inside any Claude Code session (plugin installed), or from your terminal:

| Command | What it does |
|---|---|
| `/aim-run "<task>" [--cwd <dir>] [--permission-mode acceptEdits\|bypassPermissions]` | Run a task under AIM supervision with auto-resume. Launches a separate, unattended process. |
| `/aim-status` | Show tasks and their state (▶ running, ⏳ waiting for reset, ✓ done, ⏸ paused). |
| `/aim-resume <task-id>` | Manually resume a paused/waiting task. |
| `/aim-cancel <task-id>` | Cancel a task. |

Terminal equivalents: `aim run …`, `aim status`, `aim resume …`, `aim cancel …`, plus `aim daemon` (resume all tasks after a crash) and `aim attach <claude-session-id>`.

### Permission modes (read before long runs)

Unattended, no one is there to approve tool use, so AIM launches Claude Code with a permission mode:

- **`acceptEdits` (default)** — auto-approves file edits; common tools (Read/Write/Edit/Bash/Glob/Grep/Web) pre-allowed.
- **`bypassPermissions`** — approves **everything** with no restrictions. Powerful and dangerous; AIM shows a 5-second warning. Only use for prompts you'd let run with zero supervision.

### Running overnight

`aim run` supervises in the foreground, so keep its process alive while you're away: leave the terminal open, or use PM2 / Windows Task Scheduler. If it dies mid-wait, restart and run `aim daemon` to resume everything.

---

## Where things live

- **State:** `~/.aim/state.json` — tasks + history.
- **Audit log:** `~/.aim/audit/<session-id>.jsonl` — every tool use the unattended agent made.
- **Locks:** `~/.aim/locks/<task-id>.json` — supervisor locks (auto-cleaned; stale ones self-heal).
- **Claude Code transcripts:** `~/.claude/projects/…/<session-id>.jsonl` (Claude's own files; AIM reads them to classify stops).

---

## Troubleshooting

- **`Claude Code cannot be launched inside another Claude Code session`** — only happens if `aim` runs from inside a Claude Code session. AIM strips the guard automatically, but if you still see it, run `aim` from a normal terminal.
- **Spawn error / `claude` not found** — confirm Claude Code is installed and on PATH (`claude --version`).
- **Task stalls (no progress)** — widen the allowlist with `--allowed-tools`, or (if you trust it) use `--permission-mode bypassPermissions`.
- **Test the resume loop without waiting hours:**
  ```bash
  AIM_DEBUG_FORCE_RATE_LIMIT=1 AIM_DEBUG_DELAY_MS=4000 aim run "say OK"
  ```

Full guide, edge cases, and limitations: **[aim/GUIDE.md](./aim/GUIDE.md)**. Developer/architecture notes: **[aim/README.md](./aim/README.md)**.

---

## Development

```bash
cd aim
npm test            # vitest (37 unit tests)
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> aim/dist/
```

## License

MIT
