import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a Tavern webhook request signature.
 *
 * @param rawBody - The raw request body as a string or Buffer
 * @param signature - The X-Tavern-Signature header value (format: "sha256=hex")
 * @param secret - Your webhook signing secret
 * @param timestamp - The X-Tavern-Timestamp header value (optional, for freshness check)
 * @param maxAge - Maximum age in seconds for timestamp freshness (default: 300 = 5 minutes)
 * @returns true if the signature is valid
 *
 * @example
 * ```typescript
 * import { verifyWebhookSignature } from 'taverns.js';
 *
 * app.post('/webhook', (req, res) => {
 *   const isValid = verifyWebhookSignature(
 *     req.body,                             // raw body (use express.raw() or body as string)
 *     req.headers['x-tavern-signature'],
 *     process.env.WEBHOOK_SECRET!,
 *     req.headers['x-tavern-timestamp'],
 *   );
 *
 *   if (!isValid) {
 *     return res.status(401).send('Invalid signature');
 *   }
 *
 *   const event = JSON.parse(req.body);
 *   console.log(`Received ${event.event}:`, event.data);
 *   res.status(200).send('OK');
 * });
 * ```
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string,
  timestamp?: string,
  maxAge: number = 300,
): boolean {
  if (!signature) return false;

  // Timestamp freshness check (replay protection)
  if (timestamp) {
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts)) return false;
    const age = Math.abs(Date.now() - ts) / 1000;
    if (age > maxAge) return false;
  }

  // Extract the hex digest from "sha256=<hex>"
  const parts = signature.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  const providedHex = parts[1];

  // Compute expected signature
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expectedHex = createHmac('sha256', secret).update(body).digest('hex');

  // Timing-safe comparison
  try {
    const providedBuf = Buffer.from(providedHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}
