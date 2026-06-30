import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface LockData {
  pid: number;
  startedAt: string;
  hostname: string;
}

function aimHome(): string {
  return process.env.AIM_HOME || os.homedir();
}

function locksDir(): string {
  return path.join(aimHome(), '.aim', 'locks');
}

function ensureLocksDir(): void {
  fs.mkdirSync(locksDir(), { recursive: true });
}

function lockPath(taskId: string): string {
  return path.join(locksDir(), `${taskId}.json`);
}

/** True if a process with this pid is currently running. Cross-platform. */
function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // throws if the pid does not exist / not permitted
    return true;
  } catch {
    return false;
  }
}

function readLock(taskId: string): LockData | null {
  const lp = lockPath(taskId);
  if (!fs.existsSync(lp)) return null;
  try {
    const raw = fs.readFileSync(lp, 'utf-8');
    const data = JSON.parse(raw) as LockData;
    if (!data || typeof data.pid !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

function buildLockData(): LockData {
  return {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
  };
}

/**
 * Acquire the supervisor lock for a task.
 *  - Reentrant: returns true if THIS process already holds it.
 *  - Returns false if another LIVE process holds it.
 *  - Takes over STALE locks (dead pid) automatically.
 *  - Uses an exclusive create ('wx') so two processes starting at nearly the
 *    same instant can't both win the read-then-write race.
 */
export function acquireTaskLock(taskId: string): boolean {
  ensureLocksDir();
  const lp = lockPath(taskId);
  const data = buildLockData();

  const existing = readLock(taskId);
  if (existing) {
    if (existing.pid === process.pid) return true; // reentrant
    if (isPidAlive(existing.pid)) return false; // held by a live supervisor
    // stale (dead pid) -> take over below
  }

  try {
    fs.writeFileSync(lp, JSON.stringify(data, null, 2), { flag: 'wx' });
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EEXIST') {
      // Lost a race (or a stale lock existed). Re-check the winner.
      const after = readLock(taskId);
      if (after && after.pid === process.pid) return true; // we won after all
      if (after && isPidAlive(after.pid)) return false; // someone else won
      // Stale again — remove and claim (best-effort; tiny remaining window).
      try {
        fs.unlinkSync(lp);
        fs.writeFileSync(lp, JSON.stringify(data, null, 2), { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** Release the lock, but only if it belongs to THIS process. */
export function releaseTaskLock(taskId: string): void {
  const existing = readLock(taskId);
  if (!existing || existing.pid !== process.pid) return; // not ours — leave it
  try {
    fs.unlinkSync(lockPath(taskId));
  } catch {
    /* already gone */
  }
}

/** True if any LIVE process currently holds the lock for this task. */
export function isTaskLocked(taskId: string): boolean {
  const existing = readLock(taskId);
  if (!existing) return false;
  return isPidAlive(existing.pid);
}
