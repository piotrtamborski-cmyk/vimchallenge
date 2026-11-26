/**
 * A request body as text, read up to `maxBytes`: undefined when it is larger, without reading the
 * rest. Content-Length is checked first, but a chunked body has none, so the bytes are counted too.
 */
export async function readBody(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get('content-length')) > maxBytes) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
