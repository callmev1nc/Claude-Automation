# AIM — AI Session Continuity Manager

A local tool that runs a **Claude Code** task unattended and **auto-resumes the exact
session after a usage-limit stop**. Start a long task, walk away (or sleep); when
Claude Code hits its rate limit, AIM waits out the reset window and resumes
automatically — looping until the task finishes (or gets genuinely stuck, in which
case it pauses and notifies you).

> v1 scope: **Claude Code only, personal/local, core pause→wait→resume loop.**
> Failover, multi-agent, dashboards, and SaaS are intentionally out of scope (see
> [Roadmap](#roadmap)).

## How it works

AIM is a **wrapper** around the `claude` CLI. It owns the process lifecycle:

1. Spawns `claude -p "<task>" --session-id <uuid> --output-format stream-json …`
   as a child process and streams the output.
2. When the process exits, it **classifies** the stop
   (`COMPLETED | RATE_LIMITED | WEEKLY_CAP | ERROR`) from the exit code, the
   streamed output, and the session transcript.
3. If rate-limited, it **estimates** the resume time (parses the reset message —
   including timezone conversion `5:00 PM PDT → UTC` — else estimates from the
   5-hour rolling window, else polls), waits, then re-spawns
   `claude -p "continue" --resume <uuid>`.
4. **Poll-and-retry is always on**, so resume succeeds even if reset-time parsing
   is imperfect.

State is persisted to `~/.aim/state.json`, so if AIM itself crashes or is killed
mid-wait, `aim daemon` (or `aim resume <id>`) picks the task back up.

```
 [RUNNING] ──exit──▶ [CLASSIFY] ──▶ COMPLETED ─▶ [DONE]
                          │
                          ├──▶ RATE_LIMITED ─▶ [WAITING] ──(resume_at/poll)──▶ [RUNNING]…
                          ├──▶ WEEKLY_CAP ────▶ [PAUSED + notify]
                          └──▶ ERROR ─────────▶ [WAITING/backoff] … or [PAUSED + notify]
```

## Requirements

- **Node.js ≥ 20** (built/tested on Node 22, Windows 11)
- **Claude Code** installed globally (`npm i -g @anthropic-ai/claude-code`) and
  logged in (`claude` on your PATH)

## Install / build

```bash
cd aim
npm install
npm run build        # outputs dist/
# optional: link the CLI globally
npm link             # then `aim ...` works anywhere
```

Run from source without building: `npm run dev -- run "..."` (uses `tsx`).

## Quick usage

```bash
aim run "Build the login page for my app" --cwd ./myapp
aim status
```

See **[GUIDE.md](./GUIDE.md)** for the full user guide (permission modes, running
overnight, troubleshooting).

## Project structure

```
src/
  cli.ts              # command entry (run/status/resume/cancel/attach/daemon)
  supervisor.ts       # task lifecycle: start, restore after crash
  scheduler.ts        # state machine: classify -> wait/resume/backoff/guards
  runner.ts           # spawn claude, parse stream-json, pretty-print, audit log
  claude-adapter.ts   # resolve claude entrypoint, build args, find transcript
  stop-classifier.ts  # classify stop reason (exit code + output + transcript)
  reset-estimator.ts  # parse reset time (tz-aware) / 5h window / poll
  state-store.ts      # atomic JSON state at ~/.aim/state.json
  notifier.ts         # desktop toast + console
  permissions.ts      # permission-mode resolution + autonomy warning
  types.ts            # shared types
test/
  *.test.ts           # vitest unit tests
  fixtures/           # sample outputs/transcripts
```

## Development

```bash
npm test            # vitest (unit tests)
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm run dev -- <cmd> # run via tsx without building
```

Exercising the full pause→wait→resume loop without waiting for a real limit:

```bash
AIM_DEBUG_FORCE_RATE_LIMIT=1 AIM_DEBUG_DELAY_MS=4000 npm run dev -- run "say OK"
```

## Roadmap (out of scope for v1)

- v2: account/provider **failover** (switch Claude account or Claude→GLM/Gemini when limited)
- Multi-agent support (Codex CLI, aider)
- Project workspace + agent task queue
- Rich web dashboard with countdown timers
- SaaS / multi-tenant
