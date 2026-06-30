#!/usr/bin/env node

import { Command } from 'commander';
import { startTask, restoreTasks } from './supervisor.js';
import { getTask, getActiveTasks, removeTask, loadState } from './state-store.js';
import { executeResumeCycle } from './scheduler.js';
import { runClaude } from './runner.js';
import { showAutonomyWarning, resolvePermissionMode, resolveAllowedTools } from './permissions.js';

const program = new Command();

program
  .name('aim')
  .description('AI Session Continuity Manager — auto-resume Claude Code after usage limits')
  .version('0.1.0');

program
  .command('run')
  .description('Run a Claude Code task with auto-resume on rate limits')
  .argument('<prompt>', 'The task prompt for Claude Code')
  .option('--cwd <path>', 'Working directory for the task', process.cwd())
  .option('--permission-mode <mode>', 'Permission mode: acceptEdits | bypassPermissions', 'acceptEdits')
  .option('--allowed-tools <tools>', 'Comma-separated allowed tool list', '')
  .action(async (prompt: string, options: { cwd: string; permissionMode: string; allowedTools: string }) => {
    const mode = resolvePermissionMode(options.permissionMode);
    const tools = options.allowedTools ? options.allowedTools.split(',').map(t => t.trim()) : resolveAllowedTools([]);

    if (mode === 'bypassPermissions') {
      showAutonomyWarning();
      await delay(5000);
    }

    console.log(`[aim] Running task with auto-resume: ${prompt}`);
    console.log(`[aim] Permission mode: ${mode}`);
    if (tools.length > 0) console.log(`[aim] Allowed tools: ${tools.join(', ')}`);

    await startTask(prompt, options.cwd, mode, tools);
  });

program
  .command('status')
  .description('Show active and recent tasks')
  .action(() => {
    const state = loadState();
    if (state.tasks.length === 0) {
      console.log('[aim] No tasks.');
      return;
    }
    for (const task of state.tasks.slice(-10).reverse()) {
      const statusIcon = task.status === 'DONE' ? '✓' : task.status === 'RUNNING' ? '▶' : task.status === 'WAITING' ? '⏳' : '⏸';
      const reason = task.stopReason ? ` (${task.stopReason})` : '';
      console.log(`  ${statusIcon} ${task.id.slice(0, 8)}: ${task.status}${reason} — ${task.prompt.slice(0, 60)}`);
    }
  });

program
  .command('resume')
  .description('Manually resume a paused/waiting task')
  .argument('<task-id>', 'Task ID to resume')
  .action(async (taskId: string) => {
    const task = getTask(taskId);
    if (!task) {
      console.error(`[aim] Task not found: ${taskId}`);
      process.exit(1);
    }
    if (task.status === 'DONE') {
      console.error(`[aim] Task ${taskId} is already completed.`);
      process.exit(1);
    }
    console.log(`[aim] Resuming task ${taskId}...`);
    await executeResumeCycle(task);
  });

program
  .command('cancel')
  .description('Cancel a task')
  .argument('<task-id>', 'Task ID to cancel')
  .action((taskId: string) => {
    if (removeTask(taskId)) {
      console.log(`[aim] Task ${taskId} cancelled.`);
    } else {
      console.error(`[aim] Task not found: ${taskId}`);
      process.exit(1);
    }
  });

program
  .command('attach')
  .description('Best-effort resume an existing session by session ID')
  .argument('<session-id>', 'Claude Code session ID')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(async (sessionId: string, options: { cwd: string }) => {
    console.log(`[aim] Attaching to session ${sessionId}...`);
    try {
      const result = await runClaude({
        prompt: process.env.AIM_RESUME_PROMPT ?? 'Continue the task from where you left off.',
        sessionId,
        cwd: options.cwd,
        permissionMode: 'acceptEdits',
        allowedTools: resolveAllowedTools([]),
        resumeSessionId: sessionId,
      });
      console.log(`[aim] Session resumed (exit code: ${result.exitCode}).`);
    } catch (err) {
      console.error('[aim] Attach failed:', err);
      process.exit(1);
    }
  });

program
  .command('daemon')
  .description('Start AIM daemon — restores any waiting/running tasks')
  .action(async () => {
    console.log('[aim] Daemon starting...');
    await restoreTasks();
    console.log('[aim] All tasks processed.');
  });

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

program.parse(process.argv);
