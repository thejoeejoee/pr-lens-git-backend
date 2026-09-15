/**
 * The addresses that travel in every answer.
 *
 * Two of them are fixed by the contract and the rest is this server's choice:
 * `editUrl` is `viewUrl` with `#w={token}` on the end, and the canvas page
 * lives at `/c/{id}` so that a view link pasted into `pr-lens canvas pull` is
 * recognised and its origin taken as the API to call.
 *
 * The token rides in the fragment, which a browser sends to no server and puts
 * in no referrer. Nothing here may ever move it into a path or a query.
 */
export type Origin = string;

export const viewUrl = (origin: Origin, id: string): string =>
  `${origin}/c/${id}`;

export const editUrl = (origin: Origin, id: string, token: string): string =>
  `${viewUrl(origin, id)}#w=${token}`;

export const embedUrl = (origin: Origin, id: string): string =>
  `${viewUrl(origin, id)}.svg`;

/**
 * Content-addressed, because the hash is in the file name: the same picture
 * always has the same address and a changed picture is a new one. That is what
 * lets these be cached hard while the JSON routes stay `no-store`.
 */
export const imageUrl = (origin: Origin, id: string, fileName: string): string =>
  `${origin}${imagePath(id, fileName)}`;

/**
 * The same picture, as a path.
 *
 * What an API answer carries has to be absolute: it is copied into a README and
 * fetched from somewhere else entirely. What the canvas page carries should not
 * be. A path resolves against whatever host and scheme the reader actually
 * typed, which is the one the page's `img-src 'self'` names — while an absolute
 * URL is only right if `PUBLIC_URL` agrees with that down to the scheme, and
 * behind an ingress that reverses `https` to `http` it does not. Then the
 * pictures are refused by the page's own policy.
 */
export const imagePath = (id: string, fileName: string): string =>
  `/images/${id}/${fileName}`;
