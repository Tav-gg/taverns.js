import { createHmac, timingSafeEqual } from 'crypto';

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Verify a Tavern webhook request.
 *
 * Taverns signs the raw request body with HMAC-SHA256 and your webhook secret,
 * and sends the hex digest in the `X-Tavern-Signature` header as `sha256=<hex>`.
 * The body also carries `timestamp` (Unix time in milliseconds). Because that
 * timestamp is part of the signed body, it is the one used for the freshness
 * check: a request older than `maxAge` seconds is refused, so a captured
 * delivery cannot be replayed later.
 *
 * @param rawBody - The raw request body exactly as received (string, Buffer or Uint8Array).
 *   Do not pass a parsed JSON object: use `express.raw({ type: 'application/json' })`.
 * @param signature - The `X-Tavern-Signature` header value (format: "sha256=<hex>")
 * @param secret - Your webhook signing secret. An empty secret throws.
 * @param timestamp - The `X-Tavern-Timestamp` header value (optional). When given, it
 *   must match the timestamp inside the signed body.
 * @param maxAge - Maximum age in seconds (default: 300 = 5 minutes). Pass 0 to turn the
 *   freshness check off.
 * @returns true if the signature is valid and the request is fresh
 * @throws TypeError if `secret` is empty or `rawBody` is not a string or bytes
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { verifyWebhookSignature } from 'taverns.js';
 *
 * const secret = process.env.WEBHOOK_SECRET;
 * if (!secret) throw new Error('Set WEBHOOK_SECRET');
 *
 * app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
 *   const isValid = verifyWebhookSignature(
 *     req.body,                             // Buffer from express.raw()
 *     req.get('x-tavern-signature'),
 *     secret,
 *     req.get('x-tavern-timestamp'),
 *   );
 *
 *   if (!isValid) {
 *     return res.status(401).send('Invalid signature');
 *   }
 *
 *   const event = JSON.parse(req.body.toString('utf8'));
 *   console.log(`Received ${event.event}:`, event.data);
 *   res.status(200).send('OK');
 * });
 * ```
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signature: string | string[] | undefined,
  secret: string,
  timestamp?: string | string[],
  maxAge: number = 300,
): boolean {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError(
      'verifyWebhookSignature: the webhook secret is empty. Pass the signing secret you set for your bot.',
    );
  }

  let body: Buffer;
  if (typeof rawBody === 'string') {
    body = Buffer.from(rawBody, 'utf8');
  } else if (rawBody instanceof Uint8Array) {
    body = Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  } else {
    throw new TypeError(
      'verifyWebhookSignature: rawBody must be the raw request body (string or Buffer), not parsed JSON',
    );
  }

  // Header values: a repeated header arrives as an array, which is never valid
  const signatureHeader = single(signature);
  if (!signatureHeader) return false;

  const match = SIGNATURE_RE.exec(signatureHeader.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  if (!(maxAge > 0)) return true;

  // Freshness: use the timestamp inside the signed body, never the header alone
  let signedTs: unknown;
  try {
    const payload: unknown = JSON.parse(body.toString('utf8'));
    signedTs = payload && typeof payload === 'object' ? (payload as { timestamp?: unknown }).timestamp : undefined;
  } catch {
    return false;
  }
  if (typeof signedTs !== 'number' || !Number.isFinite(signedTs)) return false;

  if (timestamp !== undefined) {
    const timestampHeader = single(timestamp);
    if (timestampHeader === undefined || Number(timestampHeader.trim()) !== signedTs) return false;
  }

  return Math.abs(Date.now() - signedTs) <= maxAge * 1000;
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}
