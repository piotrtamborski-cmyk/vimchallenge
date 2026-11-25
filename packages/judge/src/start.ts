/** Runs the judge service: `npm run judge` (PORT, HOST and JUDGE_WORKERS from the environment). */
import { JudgePool } from './pool.ts';
import { createJudgeServer } from './server.ts';

const port = Number(process.env.PORT ?? 3101);
const host = process.env.HOST ?? '127.0.0.1';

const pool = new JudgePool();
await pool.ready();
const server = createJudgeServer(pool, { log: (line) => console.log(line) });
server.listen(port, host, () => console.log(`judge on http://${host}:${port} with ${pool.options.workers} workers`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void pool.close().then(() => process.exit(0));
  });
}
