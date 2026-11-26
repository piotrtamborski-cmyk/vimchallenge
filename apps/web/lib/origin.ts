/**
 * Every request that changes something must come from a page of this site. Browsers send Origin
 * with every POST; a form or script on another site has its own. Where a page's referrer policy
 * makes it `null`, Sec-Fetch-Site (which pages cannot set) still says where the request came from.
 */
export function sameOrigin(request: Request, publicUrl: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return origin === publicUrl.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export const forbidden = () =>
  new Response('This request must come from vimchallenge itself.', { status: 403, headers: { 'content-type': 'text/plain' } });
