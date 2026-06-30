import fs from 'node:fs';
import type { ClassificationResult, ResultEvent, StopReason } from './types.js';

// NOTE: deliberately no bare `/429/i` — it matched the substring "429" inside
// numbers (token counts, uuids, timestamps) and caused false rate-limit
// positives on successful runs.
const RATE_LIMIT_PATTERNS = [
  /rate[ _-]?limit/i,
  /usage[ _-]?limit/i,
  /too many requests/i,
  /try again/i,
  /\bquota\b.*(exhaust|exceed|reach)/i,
  /limit.*reset/i,
  /reset.*limit/i,
];

const WEEKLY_CAP_PATTERNS = [
  /weekly.*(cap|limit|used)/i,
  /7.day.*(cap|limit)/i,
  /max.*weekly/i,
  /weekly.*reset/i,
];

function detectRateLimit(text: string): string | null {
  for (const pattern of RATE_LIMIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function detectWeeklyCap(text: string): string | null {
  for (const pattern of WEEKLY_CAP_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function isErrorExit(code: number | null): boolean {
  return code !== null && code !== 0;
}

/**
 * Extract CLASSIFICATION-SAFE text from the transcript tail: assistant text and
 * error messages only. We deliberately skip `tool_result` payloads (arbitrary
 * file/command output that can contain words like "weekly cap" or "rate limit"
 * and cause false positives) and `tool_use` inputs (which can contain the task
 * prompt).
 */
function readTranscriptSignals(
  transcriptPath: string | null,
  tailLines = 25,
): string | null {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
    const parts: string[] = [];
    for (const line of lines.slice(-tailLines)) {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const o = obj as Record<string, any>;
      const type = o?.type;
      if (type === 'assistant') {
        const content = o?.message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
          }
        }
      } else if (type === 'error') {
        const msg =
          typeof o?.message === 'string'
            ? o.message
            : typeof o?.error?.message === 'string'
              ? o.error.message
              : '';
        if (msg) parts.push(msg);
      } else if (type === 'user') {
        // Plain user text only — never tool_result payloads.
        const content = o?.message?.content;
        if (typeof content === 'string') parts.push(content);
        else if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
          }
        }
      }
    }
    return parts.length ? parts.join('\n') : null;
  } catch {
    return null;
  }
}

export function classifyStop(
  exitCode: number | null,
  output: string[],
  transcriptPath: string | null,
  resultEvent?: ResultEvent | null,
): ClassificationResult {
  const combinedOutput = output.join('\n');
  const transcriptSignals = readTranscriptSignals(transcriptPath);
  let outputMatch: string | null = null;
  let transcriptMatch: string | null = null;

  // 1) A structured success result IS a completion, unconditionally. A real
  // rate-limit/weekly-cap never comes back as subtype:"success" with !is_error,
  // so we trust the structured signal over any words in the response — the
  // model's answer can legitimately discuss "rate limits" or "weekly caps"
  // (e.g. when the task is about AIM itself) and that must NOT cause a
  // false positive.
  if (resultEvent && resultEvent.subtype === 'success' && !resultEvent.isError) {
    return {
      reason: 'COMPLETED',
      confidence: 'high',
      rawSignals: { exitCode, outputMatch: null, transcriptMatch: null },
    };
  }

  // 2) Weekly cap — strongest remaining signal.
  outputMatch = detectWeeklyCap(combinedOutput);
  if (outputMatch) {
    return {
      reason: 'WEEKLY_CAP',
      confidence: 'high',
      rawSignals: { exitCode, outputMatch: `weekly_cap:${outputMatch}`, transcriptMatch: null },
    };
  }
  if (transcriptSignals) {
    transcriptMatch = detectWeeklyCap(transcriptSignals);
    if (transcriptMatch) {
      return {
        reason: 'WEEKLY_CAP',
        confidence: 'high',
        rawSignals: { exitCode, outputMatch: null, transcriptMatch: `weekly_cap:${transcriptMatch}` },
      };
    }
  }

  // 3) Rate-limit phrases in output or transcript signals.
  outputMatch = detectRateLimit(combinedOutput);
  if (outputMatch) outputMatch = `rate_limit:${outputMatch}`;
  if (!outputMatch && transcriptSignals) {
    transcriptMatch = detectRateLimit(transcriptSignals);
    if (transcriptMatch) transcriptMatch = `rate_limit:${transcriptMatch}`;
  }
  if (outputMatch || transcriptMatch) {
    return {
      reason: 'RATE_LIMITED',
      confidence: isErrorExit(exitCode) ? 'high' : 'medium',
      rawSignals: { exitCode, outputMatch, transcriptMatch },
    };
  }

  // 4) Structured error from the result event.
  if (resultEvent && resultEvent.isError) {
    return {
      reason: 'ERROR',
      confidence: 'high',
      rawSignals: {
        exitCode,
        outputMatch: `result_error:${resultEvent.subtype}`,
        transcriptMatch: null,
      },
    };
  }

  // 5) Fall back to exit code.
  if (exitCode === 0 || exitCode === null) {
    return {
      reason: 'COMPLETED',
      confidence: exitCode === 0 ? 'high' : 'medium',
      rawSignals: { exitCode, outputMatch: null, transcriptMatch: null },
    };
  }

  return {
    reason: 'ERROR',
    confidence: 'medium',
    rawSignals: { exitCode, outputMatch: null, transcriptMatch: null },
  };
}

export function classifyReason(
  exitCode: number | null,
  output: string[],
  transcriptPath: string | null,
  resultEvent?: ResultEvent | null,
): StopReason {
  return classifyStop(exitCode, output, transcriptPath, resultEvent).reason;
}
