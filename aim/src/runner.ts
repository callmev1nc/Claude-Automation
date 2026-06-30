import { ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildClaudeArgs,
  spawnClaude,
  resolveTranscriptPath,
} from './claude-adapter.js';
import type { RunnerResult, SpawnOptions, ResultEvent } from './types.js';

export interface RunHandlers {
  onEvent?: (evt: unknown) => void;
}

// Minimal ANSI helpers (no dependency). No-op if stdout isn't a TTY? We still
// emit codes; terminals handle them, logs get raw — acceptable for v1.
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function auditDir(): string {
  const dir = path.join(os.homedir(), '.aim', 'audit');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Append a tool-use record to the per-session audit log. Best-effort. */
function appendAudit(sessionId: string, record: unknown): void {
  try {
    fs.appendFileSync(
      path.join(auditDir(), `${sessionId}.jsonl`),
      JSON.stringify(record) + '\n',
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

function tryParseJson(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Short human-readable hint for a tool input (file path, command, etc.). */
function formatToolHint(tool: string, input: any): string {
  try {
    if (tool === 'Bash' && input?.command)
      return `: ${String(input.command).slice(0, 120)}`;
    if ((tool === 'Read' || tool === 'Write' || tool === 'Edit') && input?.file_path)
      return ` ${input.file_path}`;
    if ((tool === 'Glob' || tool === 'Grep') && (input?.pattern || input?.path))
      return ` ${input.pattern ?? input.path}`;
    if (tool === 'WebFetch' && input?.url) return ` ${input.url}`;
    if (tool === 'WebSearch' && input?.query) return ` ${input.query}`;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Spawn Claude Code in headless/print mode, stream its output, and resolve with
 * a result. `output` is a list of human-readable text lines (assistant text,
 * tool errors, and the final result line) — this is what the classifier and
 * reset-estimator read. Raw stream-json events drive the live display and the
 * audit log. System/init events (which carry a lot of noise) are suppressed
 * from the console.
 */
export function runClaude(
  options: SpawnOptions,
  handlers: RunHandlers = {},
): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const { args, sessionId } = buildClaudeArgs(options);
    const child: ChildProcess = spawnClaude(args, options.cwd);
    const output: string[] = [];
    let actualSessionId = sessionId;
    let resultEvent: ResultEvent | null = null;

    const handleEvent = (evt: any): void => {
      handlers.onEvent?.(evt);
      // Every event carries the real session_id; capture it once.
      if (typeof evt?.session_id === 'string' && evt.session_id.length > 0) {
        actualSessionId = evt.session_id;
      }

      const type = evt?.type;

      if (type === 'assistant') {
        const content = evt?.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
              output.push(block.text);
              process.stdout.write(block.text + '\n');
            } else if (block?.type === 'tool_use') {
              appendAudit(actualSessionId, {
                ts: new Date().toISOString(),
                tool: block.name,
                input: block.input,
              });
              const hint = formatToolHint(block.name, block.input);
              process.stdout.write(
                `${DIM}  → ${CYAN}${block.name}${RESET}${DIM}${hint}${RESET}\n`,
              );
            }
          }
        }
      } else if (type === 'user') {
        const content = evt?.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool_result' && block?.is_error) {
              const txt =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content ?? '');
              output.push(`tool_error: ${txt}`);
              process.stderr.write(
                `${RED}  ✗ tool error: ${txt.slice(0, 200)}${RESET}\n`,
              );
            }
          }
        }
      } else if (type === 'result') {
        const resultText = typeof evt?.result === 'string' ? evt.result : '';
        const subtype = typeof evt?.subtype === 'string' ? evt.subtype : '';
        const isError = evt?.is_error === true;
        resultEvent = { subtype, isError, result: resultText };
        // Always record the final result line so the classifier sees the
        // canonical outcome (incl. error/rate-limit text).
        output.push(`result:${subtype} is_error=${isError} ${resultText}`);
        if (isError || (subtype !== 'success' && subtype.length > 0)) {
          process.stderr.write(
            `${BOLD}${RED}[claude ${subtype}]${RESET} ${resultText.slice(0, 500)}\n`,
          );
        }
      }
      // type === 'system' (init/hooks): suppressed from console
    };

    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line: string) => {
        const evt = tryParseJson(line);
        if (evt) handleEvent(evt);
        else if (line.trim().length > 0) {
          output.push(line);
          process.stdout.write(line + '\n');
        }
      });
    }

    if (child.stderr) {
      const rl = readline.createInterface({ input: child.stderr });
      rl.on('line', (line: string) => {
        if (line.trim().length === 0) return;
        output.push(line);
        process.stderr.write(`${YELLOW}${line}${RESET}\n`);
      });
    }

    child.on('error', (err: Error) => reject(err));

    child.on('close', (exitCode: number | null) => {
      const transcriptPath = resolveTranscriptPath(actualSessionId, options.cwd);
      resolve({
        exitCode,
        output,
        transcriptPath,
        sessionId: actualSessionId,
        resultEvent,
      });
    });
  });
}
