/**
 * Asks the server's judge to confirm a run the page already judged as solved. Training is judged
 * in the browser; the server replays the same key log and must reach the same verdict. For a
 * signed-in player the server then saves the solve (not the keys); for guests nothing is stored.
 */
export type ServerCheck =
  | { state: 'checking' }
  | { state: 'confirmed'; saved: boolean }
  /** The judge replayed the run and did not accept it: a disagreement, or a limit. */
  | { state: 'not-confirmed'; detail: string }
  /** No verdict: the judge is not running, busy, or the request failed. */
  | { state: 'unavailable'; detail: string };

const REJECTED: Record<string, string> = {
  'too-many-keys': 'The run has more keys than the server accepts.',
  'text-size': 'The text grew past the size the server accepts.',
  time: 'Replaying the run took the server too long.',
  memory: 'Replaying the run used too much memory on the server.',
  error: 'The server failed while replaying the run.',
};

export async function confirmOnServer(
  task: { id: string; version: number },
  text: number,
  keys: readonly string[],
  signal: AbortSignal,
): Promise<ServerCheck> {
  let res: Response;
  try {
    res = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: task.id, version: task.version, text, keys }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    return { state: 'unavailable', detail: 'The server could not be reached.' };
  }
  const body = (await res.json().catch(() => ({}))) as { verdict?: string; reason?: string; error?: string; saved?: boolean };
  if (res.status === 200 && body.verdict === 'passed') return { state: 'confirmed', saved: body.saved === true };
  if (res.status === 200 && body.verdict === 'rejected')
    return { state: 'not-confirmed', detail: REJECTED[body.reason ?? ''] ?? 'The server rejected the run.' };
  if (res.status === 200)
    return { state: 'not-confirmed', detail: 'The server replayed your keys and reached a different result. This is a bug in vimchallenge.' };
  if (res.status === 409)
    return { state: 'not-confirmed', detail: 'This task has changed since the page was loaded. Reload the page to get the new version.' };
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 60;
    return { state: 'unavailable', detail: `Too many checks from your network. Try again in ${wait} s.` };
  }
  if (res.status === 503) return { state: 'unavailable', detail: 'The server check is not available right now.' };
  return { state: 'unavailable', detail: 'The server could not check the run. Please try again later.' };
}
