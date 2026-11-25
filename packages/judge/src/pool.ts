/**
 * A pool of judge workers. Each run is replayed in a worker thread with a heap limit; a run that
 * takes too long is stopped by terminating its worker, which is then replaced. A bad run can cost
 * one worker for a moment, never the server.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { LIMITS, type Limits } from './limits.ts';
import type { FromWorker, JudgeJob, RejectReason, ToWorker, Verdict } from './protocol.ts';

export interface PoolOptions {
  /** Worker threads; each holds one engine (about 60 MB). */
  workers: number;
  /** Runs that may wait for a free worker; beyond that `judge` throws PoolBusyError. */
  maxQueue: number;
  limits: Limits;
}

/** A verdict and where the time went: waiting for a worker, and the replay itself. */
export type JudgeOutcome = Verdict & { queueMs: number; judgeMs: number };

export class PoolBusyError extends Error {
  constructor() {
    super('every judge worker is busy and the queue is full');
  }
}

interface Pending {
  id: number;
  job: JudgeJob;
  enqueued: number;
  resolve: (outcome: JudgeOutcome) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  /** Set once the worker is stopped or died; its events are ignored from then on. */
  dead: boolean;
  started: Promise<void>;
  current?: Pending & { started: number };
  timer?: NodeJS.Timeout;
}

const WORKER = new URL('./worker.ts', import.meta.url);

/** Leave one core to the web server; two workers are enough for a small host. */
const defaultWorkers = () => Number(process.env.JUDGE_WORKERS) || Math.max(1, Math.min(2, availableParallelism() - 1));

export class JudgePool {
  readonly options: PoolOptions;
  private slots: Slot[] = [];
  private queue: Pending[] = [];
  private nextId = 1;
  private closed = false;

  constructor(options: Partial<Omit<PoolOptions, 'limits'>> & { limits?: Partial<Limits> } = {}) {
    this.options = {
      workers: options.workers ?? defaultWorkers(),
      maxQueue: options.maxQueue ?? 32,
      limits: { ...LIMITS, ...options.limits },
    };
    for (let i = 0; i < this.options.workers; i++) this.slots.push(this.spawn(i));
  }

  /** Resolves when every worker has loaded the engine; rejects if one fails to start. */
  async ready(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.started));
  }

  judge(job: JudgeJob): Promise<JudgeOutcome> {
    if (this.closed) return Promise.reject(new Error('the judge pool is closed'));
    if (job.keys.length > this.options.limits.maxKeys)
      return Promise.resolve({ verdict: 'rejected', reason: 'too-many-keys', queueMs: 0, judgeMs: 0 });
    const free = this.slots.some((s) => s.ready && !s.dead && !s.current);
    if (!free && this.queue.length >= this.options.maxQueue) return Promise.reject(new PoolBusyError());
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, job, enqueued: performance.now(), resolve, reject });
      this.dispatch();
    });
  }

  stats() {
    const live = this.slots.filter((s) => !s.dead);
    return {
      workers: this.options.workers,
      ready: live.filter((s) => s.ready).length,
      busy: live.filter((s) => s.current).length,
      queued: this.queue.length,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const error = new Error('the judge pool is closed');
    for (const p of this.queue.splice(0)) p.reject(error);
    await Promise.all(
      this.slots.map((s) => {
        s.dead = true;
        clearTimeout(s.timer);
        s.current?.reject(error);
        return s.worker.terminate();
      }),
    );
  }

  private spawn(index: number): Slot {
    const worker = new Worker(WORKER, {
      resourceLimits: { maxOldGenerationSizeMb: this.options.limits.heapMb, maxYoungGenerationSizeMb: 16 },
    });
    let started!: { resolve: () => void; reject: (e: Error) => void };
    const slot: Slot = {
      worker,
      ready: false,
      dead: false,
      started: new Promise((resolve, reject) => (started = { resolve, reject })),
    };
    slot.started.catch(() => {}); // Reported through ready() only if someone waits for it.

    worker.on('message', (msg: FromWorker) => {
      if (slot.dead) return;
      if (msg.type === 'ready') {
        slot.ready = true;
        started.resolve();
        this.dispatch();
        return;
      }
      const job = slot.current;
      if (!job || job.id !== msg.id) return;
      clearTimeout(slot.timer);
      slot.current = undefined;
      job.resolve({ ...msg.result, queueMs: job.started - job.enqueued, judgeMs: msg.ms });
      this.dispatch();
    });
    worker.on('error', (err: Error & { code?: string }) => {
      if (!slot.ready) started.reject(err);
      this.stop(slot, index, err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'error');
    });
    worker.on('exit', () => {
      if (!slot.ready) started.reject(new Error('judge worker exited during start-up'));
      this.stop(slot, index, 'error');
    });
    return slot;
  }

  /** Stops a worker, ends its run with `reason` and puts a new worker in its place. */
  private stop(slot: Slot, index: number, reason: RejectReason) {
    if (slot.dead) return;
    slot.dead = true;
    clearTimeout(slot.timer);
    void slot.worker.terminate();
    const job = slot.current;
    if (job) job.resolve({ verdict: 'rejected', reason, queueMs: job.started - job.enqueued, judgeMs: performance.now() - job.started });
    if (this.closed) return;
    const replace = () => {
      if (this.closed) return;
      this.slots[index] = this.spawn(index);
    };
    // A worker that dies before it is ready (the engine failed to load) is retried after a pause.
    if (slot.ready) replace();
    else setTimeout(replace, 1000).unref();
  }

  private dispatch() {
    for (const [index, slot] of this.slots.entries()) {
      if (!slot.ready || slot.dead || slot.current) continue;
      const next = this.queue.shift();
      if (!next) return;
      slot.current = { ...next, started: performance.now() };
      slot.timer = setTimeout(() => this.stop(slot, index, 'time'), this.options.limits.timeMs);
      slot.worker.postMessage({ id: next.id, job: next.job, maxTextLength: this.options.limits.maxTextLength } satisfies ToWorker);
    }
  }
}
