import { classifyStop } from './stop-classifier.js';
import { estimateResetTime, computeFirstRequestTimestamp } from './reset-estimator.js';
import { runClaude } from './runner.js';
import { updateTask, getTask } from './state-store.js';
import { notify } from './notifier.js';
import { acquireTaskLock, releaseTaskLock } from './lock.js';
import type { Task, RunnerResult, ResumePlan } from './types.js';

const MAX_ATTEMPTS = 50;
const MAX_WALL_CLOCK_MS = 12 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const ERROR_BASE_DELAY_MS = 60 * 1000;
const ERROR_MAX_DELAY_MS = 15 * 60 * 1000;

export const RESUME_PROMPT = process.env.AIM_RESUME_PROMPT ?? 'Continue the task from where you left off.';

export function computeResumePlan(task: Task, result: RunnerResult): ResumePlan {
  const classification = classifyStop(
    result.exitCode,
    result.output,
    result.transcriptPath,
    result.resultEvent,
  );

  // Debug/test override: force a rate-limit on the FIRST attempt so the full
  // pause -> wait -> resume loop can be exercised end-to-end without waiting
  // for a real usage limit. Set AIM_DEBUG_FORCE_RATE_LIMIT=1 (and optionally
  // AIM_DEBUG_DELAY_MS). Only applies on attempt 0, so the task still completes.
  if (process.env.AIM_DEBUG_FORCE_RATE_LIMIT === '1' && task.attempts === 0) {
    const delayMs = Number(process.env.AIM_DEBUG_DELAY_MS) || 3000;
    return {
      shouldResume: true,
      delayMs,
      reason: 'RATE_LIMITED',
      estimatedResumeAt: new Date(Date.now() + delayMs).toISOString(),
    };
  }

  if (classification.reason === 'COMPLETED') {
    return { shouldResume: false, delayMs: 0, reason: 'COMPLETED', estimatedResumeAt: null };
  }

  if (classification.reason === 'WEEKLY_CAP') {
    return { shouldResume: false, delayMs: 0, reason: 'WEEKLY_CAP', estimatedResumeAt: null };
  }

  if (task.attempts >= MAX_ATTEMPTS) {
    return { shouldResume: false, delayMs: 0, reason: 'ERROR', estimatedResumeAt: null };
  }

  const wallClockElapsed = Date.now() - new Date(task.wallClockStart).getTime();
  if (wallClockElapsed >= MAX_WALL_CLOCK_MS) {
    return { shouldResume: false, delayMs: 0, reason: 'ERROR', estimatedResumeAt: null };
  }

  if (classification.reason === 'ERROR') {
    const delayMs = Math.min(
      ERROR_BASE_DELAY_MS * Math.pow(2, task.attempts - 1),
      ERROR_MAX_DELAY_MS
    );
    return {
      shouldResume: true,
      delayMs,
      reason: 'ERROR',
      estimatedResumeAt: null,
    };
  }

  const estimate = estimateResetTime(result.output, computeFirstRequestTimestamp(task.createdAt));

  let delayMs: number;
  if (estimate.resumeAt) {
    delayMs = Math.max(1000, new Date(estimate.resumeAt).getTime() - Date.now());
  } else {
    delayMs = Math.min(
      BASE_RETRY_DELAY_MS * Math.pow(2, task.attempts - 1),
      MAX_RETRY_DELAY_MS
    );
  }

  return {
    shouldResume: true,
    delayMs,
    reason: classification.reason,
    estimatedResumeAt: estimate.resumeAt,
  };
}

export async function executeResumeCycle(task: Task): Promise<void> {
  if (!acquireTaskLock(task.id)) {
    console.log(`[aim] Task ${task.id} is already being supervised; not resuming.`);
    return;
  }

  const updated = updateTask(task.id, {
    status: 'RUNNING',
    attempts: task.attempts + 1,
  });
  if (!updated) {
    releaseTaskLock(task.id);
    return;
  }

  console.log(`[aim] Resuming task ${task.id} (attempt ${updated.attempts})`);

  try {
    const result = await runClaude({
      prompt: RESUME_PROMPT,
      sessionId: updated.sessionId,
      cwd: updated.cwd,
      permissionMode: updated.permissionMode,
      allowedTools: updated.allowedTools,
      resumeSessionId: updated.sessionId,
    });

    const plan = computeResumePlan(updated, result);

    if (!plan.shouldResume) {
      if (plan.reason === 'COMPLETED') {
        updateTask(task.id, { status: 'DONE', stopReason: 'COMPLETED', exitCode: result.exitCode });
        notify(`Task completed: ${updated.prompt.slice(0, 60)}`);
      } else if (plan.reason === 'WEEKLY_CAP') {
        updateTask(task.id, { status: 'PAUSED', stopReason: 'WEEKLY_CAP' });
        notify('Weekly cap reached — task paused', 'warning');
      } else {
        updateTask(task.id, { status: 'PAUSED', stopReason: 'ERROR', exitCode: result.exitCode });
        notify(`Task paused after max attempts: ${updated.prompt.slice(0, 60)}`, 'error');
      }
      releaseTaskLock(task.id);
      return;
    }

    updateTask(task.id, {
      status: 'WAITING',
      stopReason: plan.reason,
      resumeAt: plan.estimatedResumeAt,
    });

    const minutes = Math.round(plan.delayMs / 60000);
    const label = plan.reason === 'ERROR' ? 'Stopped with an error' : 'Rate-limited';
    console.log(`[aim] ${label}. Waiting ${minutes} min before resume.`);
    notify(`${label} — waiting ${minutes} min`, 'warning');

    await delay(plan.delayMs);
    const refreshed = getTask(task.id);
    if (refreshed && refreshed.status === 'WAITING') {
      await executeResumeCycle(refreshed);
    }
  } catch (err) {
    console.error(`[aim] Resume cycle error:`, err);
    updateTask(task.id, { status: 'PAUSED', stopReason: 'ERROR' });
    notify('Task paused due to error', 'error');
    releaseTaskLock(task.id);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
