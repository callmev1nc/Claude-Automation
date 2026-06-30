import type { ResetEstimate } from './types.js';

// Full ISO-like datetime, e.g. 2026-06-30T14:30:00Z (seconds optional).
const ISO_DATETIME_REGEX =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;

// Common timezone abbreviations -> offset in minutes from UTC.
// DST/standard split is intentionally collapsed (approximate); the always-on
// poll-and-retry in the scheduler covers any mismatch.
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  Z: 0,
  PDT: -7 * 60,
  PST: -8 * 60,
  MDT: -6 * 60,
  MST: -7 * 60,
  CDT: -5 * 60,
  CST: -6 * 60,
  EDT: -4 * 60,
  EST: -5 * 60,
  AKDT: -8 * 60,
  AKST: -9 * 60,
  HST: -10 * 60,
  BST: 1 * 60,
  CET: 1 * 60,
  CEST: 2 * 60,
  IST: 5 * 60 + 30,
  JST: 9 * 60,
  AEST: 10 * 60,
  AEDT: 11 * 60,
};

// Clock time with optional am/pm and optional timezone abbreviation.
const TIME_TZ_REGEX =
  /(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*(PDT|PST|MDT|MST|CDT|CST|EDT|EST|AKDT|AKST|HST|UTC|GMT|BST|CEST|CET|IST|JST|AEDT|AEST|Z)?/i;

// Relative durations, possibly combined ("2 hours 30 minutes", "1h 30m").
const RELATIVE_REGEX = /(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/gi;

function parseIso(text: string): Date | null {
  const m = text.match(ISO_DATETIME_REGEX);
  if (!m) return null;
  const d = new Date(m[0].replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function parseClockTime(text: string): Date | null {
  const m = text.match(TIME_TZ_REGEX);
  if (!m) return null;

  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[3]?.toLowerCase();
  const tz = m[4]?.toUpperCase();

  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;

  const now = new Date();
  let ms: number;

  if (tz && tz in TZ_OFFSETS) {
    // Wall-clock H:M in `tz` -> UTC instant = (H:M as UTC) - offset.
    ms =
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0) -
      TZ_OFFSETS[tz] * 60_000;
  } else {
    // No timezone given: interpret in the local timezone.
    ms = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
      0,
      0,
    ).getTime();
  }

  // If the parsed time has already passed today, assume the next occurrence.
  if (ms <= Date.now()) ms += 24 * 60 * 60 * 1000;

  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

function parseRelative(text: string): Date | null {
  let totalMs = 0;
  let matched = false;
  const re = new RegExp(RELATIVE_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matched = true;
    const amount = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('second') || unit === 'sec' || unit === 'secs')
      totalMs += amount * 1000;
    else if (unit.startsWith('minute') || unit === 'min' || unit === 'mins')
      totalMs += amount * 60 * 1000;
    else if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs')
      totalMs += amount * 60 * 60 * 1000;
    else if (unit.startsWith('day')) totalMs += amount * 24 * 60 * 60 * 1000;
  }
  if (!matched || totalMs <= 0) return null;
  return new Date(Date.now() + totalMs);
}

function parseExplicitResetTime(text: string): Date | null {
  return parseIso(text) ?? parseClockTime(text) ?? parseRelative(text);
}

export function estimateResetTime(
  output: string[],
  firstRequestTimestamp: Date | null,
): ResetEstimate {
  const combined = output.join('\n');
  const explicit = parseExplicitResetTime(combined);

  if (explicit) {
    return { resumeAt: explicit.toISOString(), confidence: 'high', strategy: 'parsed' };
  }

  if (firstRequestTimestamp) {
    // Claude Pro/Max uses a ~5-hour rolling window.
    const estimate = new Date(firstRequestTimestamp.getTime() + 5 * 60 * 60 * 1000);
    return {
      resumeAt: estimate.toISOString(),
      confidence: 'medium',
      strategy: 'window_estimate',
    };
  }

  return { resumeAt: null, confidence: 'low', strategy: 'poll' };
}

export function computeFirstRequestTimestamp(taskCreatedAt: string): Date | null {
  const d = new Date(taskCreatedAt);
  return isNaN(d.getTime()) ? null : d;
}
