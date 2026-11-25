/** Task prompt: plain text with `code` spans. */
export function Prompt({ text, className }: { text: string; className?: string }) {
  const parts = text.split('`');
  return (
    <p className={className}>
      {parts.map((part, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-line/50 px-1 py-0.5 font-mono text-[0.95em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </p>
  );
}
