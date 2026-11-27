/**
 * Asks the server's judge to confirm a run the page already judged as solved. Practice is judged
 * in the browser; the server replays the same key log and must reach the same verdict. For a
 * signed-in player the server then saves the solve (not the keys); for guests nothing is stored.
 *
 * The answer says why in codes (`serverCheck` messages); the page puts them in words.
 */
export type ServerCheck =
  | { state: 'checking' }
  | { state: 'confirmed'; saved: boolean }
  /** The judge replayed the run and did not accept it: a disagreement, or a limit. */
  | { state: 'not-confirmed'; reason: NotConfirmed }
  /** No verdict: the judge is not running, busy, or the request failed. `wait`: seconds, for `rate`. */
  | { state: 'unavailable'; reason: Unavailable; wait?: number };

export type NotConfirmed = 'tooManyKeys' | 'textSize' | 'time' | 'memory' | 'error' | 'rejected' | 'different' | 'changed';
export type Unavailable = 'unreachable' | 'rate' | 'off' | 'failed';

/** The judge's reasons for refusing a run (`RejectReason`), as message names. */
export const REJECT_REASON: Record<string, NotConfirmed> = {
  'too-many-keys': 'tooManyKeys',
  'text-size': 'textSize',
  time: 'time',
  memory: 'memory',
  error: 'error',
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
    return { state: 'unavailable', reason: 'unreachable' };
  }
  const body = (await res.json().catch(() => ({}))) as { verdict?: string; reason?: string; error?: string; saved?: boolean };
  if (res.status === 200 && body.verdict === 'passed') return { state: 'confirmed', saved: body.saved === true };
  if (res.status === 200 && body.verdict === 'rejected') return { state: 'not-confirmed', reason: REJECT_REASON[body.reason ?? ''] ?? 'rejected' };
  if (res.status === 200) return { state: 'not-confirmed', reason: 'different' };
  if (res.status === 409) return { state: 'not-confirmed', reason: 'changed' };
  if (res.status === 429) return { state: 'unavailable', reason: 'rate', wait: Number(res.headers.get('retry-after')) || 60 };
  if (res.status === 503) return { state: 'unavailable', reason: 'off' };
  return { state: 'unavailable', reason: 'failed' };
}
