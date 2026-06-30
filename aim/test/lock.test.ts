import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { acquireTaskLock, releaseTaskLock, isTaskLocked } from '../src/lock.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

// Redirect locks to a temp dir via AIM_HOME (lock.ts honors it).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-lock-'));
const lockFile = (id: string) => path.join(TMP, '.aim', 'locks', `${id}.json`);

function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error('waitFor timeout'));
      else setTimeout(tick, 25);
    };
    tick();
  });
}

describe('task lock', () => {
  beforeEach(() => {
    process.env.AIM_HOME = TMP;
  });
  afterEach(() => {
    try {
      fs.rmSync(path.join(TMP, '.aim'), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env.AIM_HOME;
  });

  it('acquires, reports locked, then releases', () => {
    expect(acquireTaskLock('t1')).toBe(true);
    expect(isTaskLocked('t1')).toBe(true);
    releaseTaskLock('t1');
    expect(isTaskLocked('t1')).toBe(false);
  });

  it('is reentrant for the same process (so a supervisor can re-acquire on recursion)', () => {
    expect(acquireTaskLock('t2')).toBe(true);
    expect(acquireTaskLock('t2')).toBe(true); // already ours -> still true
    releaseTaskLock('t2');
    expect(isTaskLocked('t2')).toBe(false);
  });

  it('reports a stale lock (dead pid) as not locked and takes it over', () => {
    fs.mkdirSync(path.join(TMP, '.aim', 'locks'), { recursive: true });
    fs.writeFileSync(
      lockFile('t3'),
      JSON.stringify({ pid: 9999999, startedAt: 'x', hostname: 'x' }),
    );
    expect(isTaskLocked('t3')).toBe(false); // dead pid
    expect(acquireTaskLock('t3')).toBe(true); // stale -> takeover
    releaseTaskLock('t3');
  });

  it('releaseTaskLock will not delete a lock it does not own (pid-safe)', () => {
    fs.mkdirSync(path.join(TMP, '.aim', 'locks'), { recursive: true });
    fs.writeFileSync(
      lockFile('t4'),
      JSON.stringify({ pid: 9999999, startedAt: 'x', hostname: 'x' }),
    );
    releaseTaskLock('t4'); // not ours -> no-op
    expect(fs.existsSync(lockFile('t4'))).toBe(true); // untouched
  });

  it(
    'cannot acquire a lock held by another LIVE process; takes over once it dies',
    async () => {
      const id = 't5';
      const child = spawn(
        process.execPath,
        [
          '-e',
          [
            'const fs=require("fs"),path=require("path");',
            'const d=path.join(process.env.AIM_HOME,".aim","locks");fs.mkdirSync(d,{recursive:true});',
            'fs.writeFileSync(path.join(d,process.env.AIM_LOCK_TASK_ID+".json"),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),hostname:"child"}));',
            'process.stdout.write("READY");',
            'setInterval(function(){},1000);',
          ].join(''),
        ],
        { env: { ...process.env, AIM_LOCK_TASK_ID: id } },
      );

      try {
        await waitFor(() => fs.existsSync(lockFile(id)));
        expect(isTaskLocked(id)).toBe(true);
        expect(acquireTaskLock(id)).toBe(false); // held by a live child -> refuse

        child.kill('SIGKILL');
        // once the child is gone, its pid is no longer alive -> stale takeover
        await waitFor(() => acquireTaskLock(id) === true, 8000);
        expect(isTaskLocked(id)).toBe(true);
        releaseTaskLock(id);
      } finally {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
    },
    20000,
  );
});
