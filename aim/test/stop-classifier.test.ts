import { describe, it, expect } from 'vitest';
import { classifyStop } from '../src/stop-classifier.js';
import fs from 'node:fs';
import path from 'node:path';

const fixtureDir = path.join(__dirname, 'fixtures');

function readFixture(name: string): string[] {
  const content = fs.readFileSync(path.join(fixtureDir, name), 'utf-8');
  return content.split('\n').filter(Boolean);
}

describe('stop-classifier', () => {
  it('classifies normal completion', () => {
    const output = readFixture('normal-completion.txt');
    const result = classifyStop(0, output, null);
    expect(result.reason).toBe('COMPLETED');
    expect(result.confidence).toBe('high');
  });

  it('classifies rate limit from output', () => {
    const output = readFixture('rate-limit-output.txt');
    const result = classifyStop(1, output, null);
    expect(result.reason).toBe('RATE_LIMITED');
    expect(result.confidence).toBe('high');
  });

  it('classifies rate limit with medium confidence on zero exit code', () => {
    const output = ['rate limit exceeded, try again later'];
    const result = classifyStop(0, output, null);
    expect(result.reason).toBe('RATE_LIMITED');
    expect(result.confidence).toBe('medium');
  });

  it('classifies weekly cap', () => {
    const output = readFixture('weekly-cap-output.txt');
    const result = classifyStop(0, output, null);
    expect(result.reason).toBe('WEEKLY_CAP');
    expect(result.confidence).toBe('high');
  });

  it('classifies error on non-zero exit with no limit text', () => {
    const output = ['something went wrong'];
    const result = classifyStop(1, output, null);
    expect(result.reason).toBe('ERROR');
    expect(result.confidence).toBe('medium');
  });

  it('uses transcript to boost rate-limit confidence', () => {
    const output = ['some error'];
    const transcriptPath = path.join(fixtureDir, 'rate-limit-transcript.jsonl');
    const result = classifyStop(1, output, transcriptPath);
    expect(result.reason).toBe('RATE_LIMITED');
    expect(result.confidence).toBe('high');
    expect(result.rawSignals.transcriptMatch).toBeTruthy();
  });

  it('returns completed for null exit code with no limit text', () => {
    const result = classifyStop(null, [], null);
    expect(result.reason).toBe('COMPLETED');
  });

  it('classifies a realistic Claude Code rate-limit message', () => {
    const output = ["You've reached your Claude Code usage limit. It will reset at 5:00 PM PDT."];
    const result = classifyStop(1, output, null);
    expect(result.reason).toBe('RATE_LIMITED');
    expect(result.confidence).toBe('high');
  });

  it('does not false-positive on "429" embedded in numbers', () => {
    // Regression: a bare /429/i matched token counts / ids in transcripts and
    // misclassified successful runs as rate-limited.
    const output = ['usage report: input_tokens=4290, cache_read=94291'];
    const result = classifyStop(0, output, null);
    expect(result.reason).toBe('COMPLETED');
  });

  it('ignores "weekly cap" text inside a tool_result (no false WEEKLY_CAP)', () => {
    // Regression: the classifier scanned raw transcript content and matched
    // "weekly cap" inside a tool_result file payload (e.g. GUIDE.md), falsely
    // pausing a healthy run. tool_result/tool_use payloads are now skipped.
    const transcriptPath = path.join(fixtureDir, 'weekly-in-tool-result.jsonl');
    const result = classifyStop(1, ['something went wrong'], transcriptPath);
    expect(result.reason).toBe('ERROR');
  });

  it('clean success short-circuits even if a tool_result mentions weekly cap', () => {
    const transcriptPath = path.join(fixtureDir, 'weekly-in-tool-result.jsonl');
    const resultEvent = { subtype: 'success', isError: false, result: 'done' };
    const result = classifyStop(0, ['result:success is_error=false done'], transcriptPath, resultEvent);
    expect(result.reason).toBe('COMPLETED');
    expect(result.confidence).toBe('high');
  });

  it('trusts a structured success even when the answer text discusses rate limits/weekly caps', () => {
    // Regression: a task ABOUT aim produced an answer that literally says
    // "rate-limit" and "weekly caps". A real limit never returns subtype
    // success, so the structured signal must win over the words.
    const resultEvent = {
      subtype: 'success',
      isError: false,
      result: 'AIM resumes after a rate-limit stop and pauses on weekly caps.',
    };
    const result = classifyStop(0, ['result:success is_error=false ...weekly caps...'], null, resultEvent);
    expect(result.reason).toBe('COMPLETED');
  });

  it('treats a clean structured success result as COMPLETED', () => {
    const resultEvent = { subtype: 'success', isError: false, result: 'done' };
    const result = classifyStop(0, ['result:success is_error=false done'], null, resultEvent);
    expect(result.reason).toBe('COMPLETED');
    expect(result.confidence).toBe('high');
  });

  it('classifies a structured error result as ERROR', () => {
    const resultEvent = { subtype: 'error_during_execution', isError: true, result: 'boom' };
    const result = classifyStop(1, ['result:error is_error=true boom'], null, resultEvent);
    expect(result.reason).toBe('ERROR');
  });
});
