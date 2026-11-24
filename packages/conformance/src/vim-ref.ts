/** Runs one case in real Vim (vim/driver.vim) and returns the state after every key. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InitialState, Snapshot } from '@vimchallenge/engine';

const DRIVER = fileURLToPath(new URL('../vim/driver.vim', import.meta.url));

export interface VimRun {
  version: string;
  snapshots: Snapshot[];
}

export async function runVim(initial: InitialState, tokens: string[], timeoutMs = 10_000): Promise<VimRun> {
  const dir = await mkdtemp(join(tmpdir(), 'vc-vim-'));
  try {
    const casePath = join(dir, 'case.json');
    const outPath = join(dir, 'out.json');
    await writeFile(casePath, JSON.stringify({ initial, tokens }));
    await new Promise<void>((resolve, reject) => {
      const child = spawn('vim', ['--not-a-term', '-Nu', 'NONE', '-i', 'NONE', '-n', '-S', DRIVER], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir, TERM: 'dumb', LANG: 'C.UTF-8', VC_CASE: casePath, VC_OUT: outPath },
        // stdin stays an open, silent pipe: Vim waits for input (so timers fire) but never gets any.
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`vim timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        child.stdin.destroy();
        if (code === 0) resolve();
        else reject(new Error(`vim exited with ${code}: ${stderr.trim()}`));
      });
    });
    const out = JSON.parse(await readFile(outPath, 'utf8')) as { version: number; patch: number; snapshots: Snapshot[] };
    const major = Math.floor(out.version / 100);
    return { version: `${major}.${out.version % 100}.${out.patch}`, snapshots: out.snapshots };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
