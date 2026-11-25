/** Plain text with `code` spans, as used in task prompts and step labels. */
export function CodeText({ text }: { text: string }) {
  return text.split('`').map((part, i) =>
    i % 2 ? (
      <code key={i} className="rounded bg-line/50 px-1 py-0.5 font-mono text-[0.95em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** Task prompt. */
export function Prompt({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      <CodeText text={text} />
    </p>
  );
}
