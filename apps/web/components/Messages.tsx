/** A message at the top of a form page: an error in red, a notice in green. */
export function Message({ error, notice }: { error?: string; notice?: string }) {
  if (error)
    return (
      <p role="alert" className="rounded border border-bad/40 px-3 py-2 text-bad">
        {error}
      </p>
    );
  if (notice)
    return (
      <p role="status" className="rounded border border-good/40 px-3 py-2 text-good">
        {notice}
      </p>
    );
  return null;
}
