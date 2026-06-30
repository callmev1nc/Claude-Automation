import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { estimateResetTime, computeFirstRequestTimestamp } from '../src/reset-estimator.js';
import fs from 'node:fs';
import path from 'node:path';

const fixtureDir = path.join(__dirname, 'fixtures');

function readFixture(name: string): string[] {
  const content = fs.readFileSync(path.join(fixtureDir, name), 'utf-8');
  return content.split('\n').filter(Boolean);
}

describe('reset-estimator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses explicit ISO time from output', () => {
    const output = ['Rate limit exceeded. Usage resets at 2026-06-30T14:30:00Z'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.confidence).toBe('high');
    expect(result.resumeAt).toBe('2026-06-30T14:30:00.000Z');
  });

  it('parses time with am/pm format', () => {
    const output = ['Usage limits reset at approximately 2:30 PM.'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.confidence).toBe('high');
    expect(result.resumeAt).toBeTruthy();
  });

  it('parses realistic Claude Code rate-limit reset time', () => {
    const output = ["You've reached your Claude Code usage limit. It will reset at 5:00 PM PDT."];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.confidence).toBe('high');
    expect(result.resumeAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('parses clock time with a timezone abbreviation (PDT -> UTC)', () => {
    // 5:00 PM PDT is UTC-7, so 17:00 PDT == 00:00 UTC the next day.
    const output = ['You can send more messages at 5:00 PM PDT.'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.confidence).toBe('high');
    expect(result.resumeAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('parses clock time with EST timezone', () => {
    // 9:00 AM EST is UTC-5, so 09:00 EST == 14:00 UTC same day.
    const output = ['Available again at 9:00 AM EST'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.resumeAt).toBe('2026-06-30T14:00:00.000Z');
  });

  it('parses combined relative durations (2 hours 30 minutes)', () => {
    const output = ['Please try again in 2 hours 30 minutes.'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.resumeAt).toBe('2026-06-30T14:30:00.000Z');
  });

  it('parses relative time in minutes', () => {
    const output = readFixture('rate-limit-relative.txt');
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('parsed');
    expect(result.resumeAt).toBe('2026-06-30T12:45:00.000Z');
  });

  it('falls back to 5h window estimate from first request timestamp', () => {
    const output = ['some error'];
    const firstReq = new Date('2026-06-30T08:00:00Z');
    const result = estimateResetTime(output, firstReq);
    expect(result.strategy).toBe('window_estimate');
    expect(result.confidence).toBe('medium');
    expect(result.resumeAt).toBe('2026-06-30T13:00:00.000Z');
  });

  it('returns poll strategy when no time info available', () => {
    const output = ['something went wrong'];
    const result = estimateResetTime(output, null);
    expect(result.strategy).toBe('poll');
    expect(result.confidence).toBe('low');
    expect(result.resumeAt).toBeNull();
  });

  it('computes first request timestamp from created-at string', () => {
    const ts = computeFirstRequestTimestamp('2026-06-30T08:00:00Z');
    expect(ts).toBeTruthy();
    expect(ts!.toISOString()).toBe('2026-06-30T08:00:00.000Z');
  });

  it('returns null for invalid created-at string', () => {
    const ts = computeFirstRequestTimestamp('invalid-date');
    expect(ts).toBeNull();
  });
});
