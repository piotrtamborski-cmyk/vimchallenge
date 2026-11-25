/**
 * HTTP front of the judge: POST /v1/judge replays a run of a published task and returns the
 * verdict; GET /healthz reports the pool. Nothing is stored and key logs are never logged.
 *
 * It listens on a local port; the public route (Cloudflare Tunnel or the web app) sits in front.
 * Browsers cannot send `application/json` cross-site without a CORS preflight, which this server
 * never answers, so only same-site callers can use it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PROFILE_VERSION } from '@vimchallenge/engine';
import { onText, taskById, textCount } from '@vimchallenge/tasks';
import { JUDGE_VERSION } from './limits.ts';
import { PoolBusyError, type JudgePool } from './pool.ts';
import { parseRequest } from './request.ts';

export interface ServerOptions {
  /** Largest request body; 5000 keys take about 40 kB. */
  maxBodyBytes?: number;
  /** One line per request: method, path, status, task, verdict, time. */
  log?: (line: string) => void;
}

class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'send application/json');
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) throw new HttpError(413, `the body is larger than ${maxBytes} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, `the body is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'the body is not valid JSON');
  }
}

export function createJudgeServer(pool: JudgePool, options: ServerOptions = {}): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 128 * 1024;

  async function judge(req: IncomingMessage, res: ServerResponse, note: { task?: string; verdict?: string }) {
    const request = parseRequest(await readJson(req, maxBodyBytes));
    if (typeof request === 'string') throw new HttpError(400, request);
    note.task = request.task;
    const task = taskById(request.task);
    if (!task) throw new HttpError(404, `no task "${request.task}"`);
    if (task.version !== request.version)
      throw new HttpError(409, `task "${task.id}" is at version ${task.version}`, { version: task.version });
    const text = onText(task, request.text);
    if (!text) throw new HttpError(404, `task "${task.id}" has ${textCount(task)} texts`);
    let outcome;
    try {
      outcome = await pool.judge({ initial: text.initial, expected: text.expected, keys: request.keys });
    } catch (err) {
      if (err instanceof PoolBusyError) throw new HttpError(503, err.message, { retryAfter: 1 });
      throw err;
    }
    note.verdict = outcome.verdict === 'rejected' ? `rejected:${outcome.reason}` : outcome.verdict;
    const { queueMs, judgeMs, ...verdict } = outcome;
    send(res, 200, {
      ...verdict,
      task: task.id,
      version: task.version,
      text: request.text,
      keys: request.keys.length,
      judge: { version: JUDGE_VERSION, profile: PROFILE_VERSION },
      timing: { queueMs: Math.round(queueMs), judgeMs: Math.round(judgeMs) },
    });
  }

  return createServer(async (req, res) => {
    const t0 = performance.now();
    const path = new URL(req.url ?? '/', 'http://judge').pathname;
    const note: { task?: string; verdict?: string } = {};
    try {
      if (path === '/v1/judge') {
        if (req.method !== 'POST') throw new HttpError(405, 'use POST', { allow: 'POST' });
        await judge(req, res, note);
      } else if (path === '/healthz') {
        if (req.method !== 'GET') throw new HttpError(405, 'use GET', { allow: 'GET' });
        send(res, 200, { ok: true, judge: JUDGE_VERSION, ...pool.stats() });
      } else {
        throw new HttpError(404, 'not found');
      }
    } catch (err) {
      if (err instanceof HttpError) {
        const headers: Record<string, string> = {};
        if (err.extra.allow) headers.allow = String(err.extra.allow);
        if (err.extra.retryAfter) headers['retry-after'] = String(err.extra.retryAfter);
        const { allow: _a, retryAfter: _r, ...extra } = err.extra;
        send(res, err.status, { error: err.message, ...extra }, headers);
      } else {
        send(res, 500, { error: 'internal error' });
        console.error(err);
      }
    } finally {
      options.log?.(`${req.method} ${path} ${res.statusCode} ${note.task ?? '-'} ${note.verdict ?? '-'} ${Math.round(performance.now() - t0)}ms`);
    }
  });
}
