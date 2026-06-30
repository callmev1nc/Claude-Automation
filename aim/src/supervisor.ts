import { loadState, updateTask, getActiveTasks, addTask } from './state-store.js';
import { generateSessionId } from './claude-adapter.js';
import { runClaude } from './runner.js';
import { executeResumeCycle, computeResumePlan } from './scheduler.js';
import { acquireTaskLock, releaseTaskLock, isTaskLocked } from './lock.js';
import type { Task } from './types.js';

export function createTask(
  prompt: string,
  cwd: string,
  permissionMode: string,
  allowedTools: string[]
): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: generateSessionId(),
    prompt,
    cwd,
    sessionId: generateSessionId(),
    status: 'RUNNING',
    stopReason: null,
    attempts: 0,
    maxAttempts: 50,
    createdAt: now,
    updatedAt: now,
    resumeAt: null,
    exitCode: null,
    transcriptPath: null,
    permissionMode,
    allowedTools,
    output: [],
    wallClockStart: now,
  };
  addTask(task);
  return task;
}

export async function startTask(
  prompt: string,
  cwd: string = process.cwd(),
  permissionMode: string = 'acceptEdits',
  allowedTools: string[] = []
): Promise<void> {
  const task = createTask(prompt, cwd, permissionMode, allowedTools);

  if (!acquireTaskLock(task.id)) {
    console.log(`[aim] Task ${task.id} is already being supervised; not starting.`);
    return;
  }

  console.log(`[aim] Starting task: ${task.id}`);

  try {
    const result = await runClaude({
      prompt,
      sessionId: task.sessionId,
      cwd,
      permissionMode,
      allowedTools,
    });

    const plan = computeResumePlan(task, result);

    if (!plan.shouldResume) {
      if (plan.reason === 'COMPLETED') {
        updateTask(task.id, { status: 'DONE', stopReason: 'COMPLETED', exitCode: result.exitCode });
        console.log(`[aim] Task ${task.id} completed.`);
      } else if (plan.reason === 'WEEKLY_CAP') {
        updateTask(task.id, { status: 'PAUSED', stopReason: 'WEEKLY_CAP' });
        console.log(`[aim] Task ${task.id} paused — weekly cap reached.`);
      } else {
        updateTask(task.id, { status: 'PAUSED', stopReason: 'ERROR', exitCode: result.exitCode });
        console.log(`[aim] Task ${task.id} paused after error.`);
      }
      releaseTaskLock(task.id);
      return;
    }

    updateTask(task.id, { status: 'WAITING', stopReason: plan.reason, resumeAt: plan.estimatedResumeAt });
    const minutes = Math.round(plan.delayMs / 60000);
    const label = plan.reason === 'ERROR' ? 'Stopped with an error' : 'Rate-limited';
    console.log(`[aim] ${label}. Retrying in ~${minutes} min.`);

    await delay(plan.delayMs);
    const refreshed = getActiveTasks().find(t => t.id === task.id);
    if (refreshed) {
      await executeResumeCycle(refreshed);
    }
    releaseTaskLock(task.id);
  } catch (err) {
    console.error(`[aim] Task failed:`, err);
    updateTask(task.id, { status: 'PAUSED', stopReason: 'ERROR' });
    releaseTaskLock(task.id);
  }
}

export async function restoreTasks(): Promise<void> {
  const active = getActiveTasks();
  for (const task of active) {
    if (isTaskLocked(task.id)) {
      console.log(`[aim] Skipping task ${task.id} — lock held by another supervisor.`);
      continue;
    }
    if (task.status === 'WAITING' && task.resumeAt) {
      const remaining = new Date(task.resumeAt).getTime() - Date.now();
      if (remaining > 0) {
        console.log(`[aim] Restoring task ${task.id} — waiting ${Math.round(remaining / 60000)} min`);
        await delay(remaining);
      }
      const refreshed = getActiveTasks().find(t => t.id === task.id);
      if (refreshed && refreshed.status === 'WAITING') {
        await executeResumeCycle(refreshed);
      }
    } else if (task.status === 'RUNNING') {
      console.log(`[aim] Re-spawning orphaned task ${task.id}`);
      await executeResumeCycle(task);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
