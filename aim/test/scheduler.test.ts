import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeResumePlan } from '../src/scheduler.js';
import type { Task, RunnerResult } from '../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'test-task-id',
    prompt: 'do something',
    cwd: process.cwd(),
    sessionId: 'test-session-id',
    status: 'RUNNING',
    stopReason: null,
    attempts: 0,
    maxAttempts: 50,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resumeAt: null,
    exitCode: null,
    transcriptPath: null,
    permissionMode: 'acceptEdits',
    allowedTools: [],
    output: [],
    wallClockStart: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<RunnerResult> = {}): RunnerResult {
  return {
    exitCode: 0,
    output: [],
    transcriptPath: null,
    sessionId: 'test-session-id',
    ...overrides,
  };
}

describe('scheduler', () => {
  it('returns no resume on completed task', () => {
    const task = makeTask();
    const result = makeResult({ exitCode: 0, output: ['all done'] });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(false);
    expect(plan.reason).toBe('COMPLETED');
  });

  it('returns no resume on weekly cap', () => {
    const task = makeTask();
    const result = makeResult({ exitCode: 1, output: ['weekly cap reached'] });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(false);
    expect(plan.reason).toBe('WEEKLY_CAP');
  });

  it('returns resume on rate limit', () => {
    const task = makeTask();
    const result = makeResult({
      exitCode: 1,
      output: ['rate limit exceeded, try again in 30 minutes'],
    });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(true);
    expect(plan.reason).toBe('RATE_LIMITED');
  });

  it('returns no resume after max attempts', () => {
    const task = makeTask({ attempts: 50, maxAttempts: 50 });
    const result = makeResult({
      exitCode: 1,
      output: ['rate limit exceeded'],
    });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(false);
  });

  it('returns no resume after max wall clock time', () => {
    const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const task = makeTask({ wallClockStart: oldDate, createdAt: oldDate });
    const result = makeResult({
      exitCode: 1,
      output: ['rate limit exceeded'],
    });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(false);
  });

  it('uses error backoff (1-15 min) for ERROR classification', () => {
    const task = makeTask({ attempts: 2 });
    const result = makeResult({
      exitCode: 1,
      output: ['some error'],
    });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(true);
    expect(plan.reason).toBe('ERROR');
    expect(plan.delayMs).toBeGreaterThanOrEqual(60 * 1000);
    expect(plan.delayMs).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(plan.estimatedResumeAt).toBeNull();
  });

  it('uses 5h window for RATE_LIMITED with no explicit reset time', () => {
    const createdAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const task = makeTask({ attempts: 1, createdAt });
    const result = makeResult({
      exitCode: 1,
      output: ['rate limit exceeded'],
    });
    const plan = computeResumePlan(task, result);
    expect(plan.shouldResume).toBe(true);
    expect(plan.reason).toBe('RATE_LIMITED');
    expect(plan.estimatedResumeAt).toBeTruthy();
    const expectedWindow = new Date(createdAt).getTime() + 5 * 60 * 60 * 1000;
    expect(new Date(plan.estimatedResumeAt!).getTime()).toBeCloseTo(expectedWindow, -3);
  });
});
