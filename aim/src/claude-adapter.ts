import { spawn, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { SpawnOptions } from './types.js';

export interface ClaudeArgs {
  args: string[];
  sessionId: string;
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Resolve Claude Code's real JS entrypoint so we can spawn `node <entry>`
 * directly. This sidesteps the Windows problem where the `claude` bin is a
 * `.cmd` shim that Node refuses to launch without a shell (and routing the
 * prompt through a shell would risk argument-escaping bugs).
 */
let _cachedEntry: string | null | undefined;

export function resolveClaudeEntry(): string | null {
  if (_cachedEntry !== undefined) return _cachedEntry;

  const candidates: string[] = [];

  // 1. `npm root -g` (most reliable, works for any install location)
  try {
    const root = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    candidates.push(path.join(root, '@anthropic-ai', 'claude-code', 'cli.js'));
  } catch {
    /* npm not on PATH — fall through */
  }

  // 2. Common Windows global location
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(
      path.join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js',
      ),
    );
  }

  // 3. Common Unix global locations
  candidates.push('/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js');
  candidates.push('/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js');

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        _cachedEntry = candidate;
        return _cachedEntry;
      }
    } catch {
      /* ignore */
    }
  }

  _cachedEntry = null;
  return null;
}

export function buildClaudeArgs(options: SpawnOptions): ClaudeArgs {
  const args: string[] = [];

  if (options.resumeSessionId) {
    const nudge =
      options.prompt && options.prompt.trim().length > 0
        ? options.prompt
        : (process.env.AIM_RESUME_PROMPT ?? 'Continue the task from where you left off.');
    args.push('-p', nudge, '--resume', options.resumeSessionId);
  } else {
    args.push('-p', options.prompt, '--session-id', options.sessionId);
  }

  args.push('--permission-mode', options.permissionMode);
  // stream-json requires --verbose in Claude Code
  args.push('--output-format', 'stream-json', '--verbose');

  if (options.allowedTools && options.allowedTools.length > 0) {
    // Comma-separated form is accepted by a single --allowedTools flag.
    args.push('--allowedTools', options.allowedTools.join(','));
  }

  return { args, sessionId: options.sessionId };
}

/**
 * Build the child environment. We strip Claude Code's nesting-guard variables
 * so a child `claude -p` can run even when AIM itself was launched from inside
 * a Claude Code session (which sets CLAUDECODE). In a normal terminal these
 * are absent, so this is a no-op there.
 */
function cleanChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export function spawnClaude(args: string[], cwd: string): ChildProcess {
  const entry = resolveClaudeEntry();
  const env = cleanChildEnv();

  if (entry) {
    // Preferred path: spawn node with the resolved entry verbatim (no shell,
    // no escaping concerns). Args are passed to the OS as-is.
    return spawn(process.execPath, [entry, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
    });
  }

  // Fallback: invoke the `claude` bin directly. On Windows this needs a shell
  // to resolve the .cmd shim; the prompt is passed as a single argv element so
  // commander receives it correctly.
  return spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: process.platform === 'win32',
  });
}

/**
 * Find the JSONL transcript for a session. Claude Code stores transcripts at
 * ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl. We try the guessed slug
 * first, then fall back to scanning all project dirs so we're robust to
 * variations in the slug algorithm.
 */
export function resolveTranscriptPath(
  sessionId: string,
  cwd: string,
): string | null {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return null;

  const slug = slugifyCwd(cwd);
  const direct = path.join(claudeDir, slug, `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) return direct;

  try {
    for (const entry of fs.readdirSync(claudeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(claudeDir, entry.name, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * Best-effort reproduction of Claude Code's project slug. Observed:
 * `D:\Project\Claude-Automation` -> `d--project-claude-automation`
 * (lowercase, ':' and separators become '-'). resolveTranscriptPath also has a
 * scan fallback, so an imperfect slug is non-fatal.
 */
function slugifyCwd(cwd: string): string {
  return cwd
    .toLowerCase()
    .replace(/:/g, '-')
    .replace(/[\\/]+/g, '-');
}
