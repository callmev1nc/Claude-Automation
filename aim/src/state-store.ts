import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { StateFile, Task } from './types.js';

const STATE_DIR = path.join(os.homedir(), '.aim');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function loadState(): StateFile {
  ensureStateDir();
  if (!fs.existsSync(STATE_FILE)) {
    return { version: 1, tasks: [] };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as StateFile;
  } catch {
    return { version: 1, tasks: [] };
  }
}

export function saveState(state: StateFile): void {
  ensureStateDir();
  const tmpFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpFile, STATE_FILE);
}

export function addTask(task: Task): void {
  const state = loadState();
  state.tasks.push(task);
  saveState(state);
}

export function updateTask(taskId: string, updates: Partial<Task>): Task | null {
  const state = loadState();
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;
  state.tasks[idx] = { ...state.tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  saveState(state);
  return state.tasks[idx];
}

export function getTask(taskId: string): Task | null {
  const state = loadState();
  return state.tasks.find(t => t.id === taskId) ?? null;
}

export function getActiveTasks(): Task[] {
  const state = loadState();
  return state.tasks.filter(t => t.status === 'RUNNING' || t.status === 'WAITING');
}

export function removeTask(taskId: string): boolean {
  const state = loadState();
  const idx = state.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;
  state.tasks.splice(idx, 1);
  saveState(state);
  return true;
}
