/**
 * Cloudflare R2 object storage — tech-stack §9, Spec §12.
 *
 * tech-stack §9: "Presigned PUT from the browser; no file touches the VPS
 * disk." So this module issues URLs and reads objects back for verification. It
 * never accepts an upload, never writes to the filesystem, and there is no
 * multipart body parser mounted anywhere in the tree — the absence of the route
 * is what makes the rule true, the same way the absence of a bank-detail column
 * is what makes §11's rule true.
 *
 * ── The port, and why it is a port ──────────────────────────────────────────
 * R2 buckets are Track A4 and are not provisioned. `unconfiguredStorage`
 * therefore *throws*, exactly as `unconfiguredTransport` does for email: a
 * deployment with no bucket must fail visibly rather than report a visual as
 * stored when nothing left the browser (§1.4). The §6 prerequisites panel reads
 * the same fact and blocks on it.
 *
 * Being a port also makes the evidence rules testable without a network. The
 * integration suite injects an in-memory implementation, which is the only way
 * §33.3.1's "empty file" and "1×1 placeholder" cases can be asserted at all.
 *
 * ── Scoped and short-lived, and both are signed ─────────────────────────────
 * Phase 09's trap: "Presigned uploads must be scoped and short-lived. Don't
 * issue a URL that grants broader bucket access than the one object." The
 * signature covers the method, the exact object key and `content-type`.
 * `content-length` is deliberately not a signed header: browsers forbid
 * JavaScript from setting it and Chromium silently removes it from Fetch
 * requests. R2 still receives the browser-generated length, while step 3 reads
 * the object back and enforces its byte size and checksum. Expiry is minutes,
 * not hours.
 *
 * ── No SDK ──────────────────────────────────────────────────────────────────
 * SigV4 query-string presigning is a specified, stable algorithm and about
 * eighty lines of `node:crypto`. Adding the AWS SDK to sign a string would pull
 * a large dependency tree into an image whose only other native concern is
 * Postgres.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface PresignedUpload {
  /** The URL the browser PUTs to. Carries the signature in the query string. */
  url: string;
  /** Headers the browser MUST send. They are part of the signature. */
  requiredHeaders: Record<string, string>;
  expiresAt: Date;
  /** The key the object will live at. Stored on the asset row. */
  key: string;
  bucket: string;
}

export interface StoredObject {
  key: string;
  contentType: string;
  byteSize: number;
  body: Buffer;
}

export interface PresignInput {
  key: string;
  contentType: string;
  /** Expected byte length. Step 3 confirms it from the stored object. */
  contentLength: number;
  expiresInSeconds?: number;
}

export interface ObjectStorage {
  /** False when Track A4 has not landed. The prerequisites panel reads it. */
  readonly configured: boolean;
  readonly bucket: string;
  /** Exact cross-origin destination the browser must be allowed to PUT to. */
  readonly browserUploadOrigin: string | null;
  presignUpload(input: PresignInput): Promise<PresignedUpload>;
  /** Reads the object back for §12's verification. Throws if it is not there. */
  getObject(key: string): Promise<StoredObject>;
  /**
   * Development-only same-origin receiver. Production R2 implementations do
   * not expose this: their presigned URL still sends the bytes straight to R2.
   */
  readonly browserUploadReceiver?: {
    path: string;
    maxBytes: number;
    receive(input: {
      token: string;
      contentType: string;
      body: Buffer;
    }): Promise<'stored' | 'not_found' | 'expired' | 'invalid'>;
  };
}

/** Raised when the object is not in the bucket — an abandoned upload. */
export class ObjectNotStored extends Error {
  constructor(key: string) {
    super(`no object at ${key}`);
    this.name = 'ObjectNotStored';
  }
}

/**
 * The default. Refuses loudly rather than pretending.
 *
 * Same decision as `unconfiguredTransport`: a no-op would let a Founder see
 * "visual uploaded" while nothing exists, earn a US$2 discount for it, and
 * discover the truth at the campaign page. §1.4 forbids exactly that.
 */
export const unconfiguredStorage: ObjectStorage = {
  configured: false,
  bucket: '',
  browserUploadOrigin: null,
  async presignUpload() {
    throw new Error(
      'No object storage is configured, so uploads cannot be accepted. Set R2_ACCOUNT_ID, ' +
        'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET. This refusal is deliberate: ' +
        'reporting a file as stored when no bucket exists would be the automation-that-does-not-' +
        'exist failure (§1.4).',
    );
  },
  async getObject() {
    throw new Error('No object storage is configured, so nothing can be read back for checking.');
  },
};

/* ── SigV4 ────────────────────────────────────────────────────────────────── */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
/** R2 has one region and names it `auto`. */
const REGION = 'auto';
/** Presigned URLs sign the payload as unsigned — the body is not known yet. */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** Five minutes. Long enough for a slow phone upload, short enough to matter. */
const DEFAULT_EXPIRY_SECONDS = 300;

function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves `!'()*` alone and S3's
 * canonicalisation does not — a key containing one of them would sign one way
 * and be requested another, and the failure looks like a credential problem.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Object keys are path segments; the separators stay separators. */
function encodeKey(key: string): string {
  return key.split('/').map(uriEncode).join('/');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Overridden by the test suite; production derives it from the account id. */
  endpointHost?: string;
  /** Injected so signing is deterministic under test. */
  now?: () => Date;
}

export function createR2Storage(config: R2Config): ObjectStorage {
  const host = config.endpointHost ?? `${config.accountId}.r2.cloudflarestorage.com`;
  const clock = config.now ?? (() => new Date());

  function sign(
    method: 'PUT' | 'GET',
    key: string,
    expiresInSeconds: number,
    signedHeaders: Record<string, string>,
  ): { url: string; expiresAt: Date } {
    const now = clock();
    const { stamp, date } = amzDate(now);
    const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;

    const headerNames = Object.keys(signedHeaders)
      .map((h) => h.toLowerCase())
      .sort();
    const signedHeaderList = headerNames.join(';');

    const query: Record<string, string> = {
      'X-Amz-Algorithm': ALGORITHM,
      'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
      'X-Amz-Date': stamp,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': signedHeaderList,
    };

    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${uriEncode(k)}=${uriEncode(query[k]!)}`)
      .join('&');

    const canonicalHeaders =
      headerNames
        .map((h) => {
          const found = Object.entries(signedHeaders).find(([n]) => n.toLowerCase() === h);
          return `${h}:${String(found?.[1] ?? '').trim()}`;
        })
        .join('\n') + '\n';

    const canonicalUri = `/${config.bucket}/${encodeKey(key)}`;

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaderList,
      UNSIGNED_PAYLOAD,
    ].join('\n');

    const stringToSign = [ALGORITHM, stamp, scope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), REGION), SERVICE),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
      url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
    };
  }

  return {
    configured: true,
    bucket: config.bucket,
    browserUploadOrigin: `https://${host}`,

    async presignUpload(input) {
      const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
      // Content-Type is safe for browser JavaScript to set. Content-Length is
      // not: Fetch treats it as a forbidden request header, so signing it makes
      // an otherwise valid URL fail in real browsers. The stored byte length
      // and checksum are enforced when the server reads the object back.
      const requiredHeaders = {
        'content-type': input.contentType,
      };
      const { url, expiresAt } = sign('PUT', input.key, expiresInSeconds, {
        host,
        ...requiredHeaders,
      });
      return { url, requiredHeaders, expiresAt, key: input.key, bucket: config.bucket };
    },

    async getObject(key) {
      const { url } = sign('GET', key, 60, { host });
      const response = await fetch(url);
      if (response.status === 404) throw new ObjectNotStored(key);
      if (!response.ok) {
        throw new Error(`object storage answered ${response.status} reading ${key}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      return {
        key,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        byteSize: body.byteLength,
        body,
      };
    },
  };
}

/* ── An in-memory implementation, for tests ──────────────────────────────── */

/**
 * Not a mock of the network — a real store with the same contract.
 *
 * §33.3.1 has to prove that an empty file and a 1×1 placeholder are rejected,
 * which means the verification path must actually read bytes. Injecting this
 * lets the suite put exact bytes in the bucket and assert the decision, rather
 * than asserting that a stub was called.
 */
export function createMemoryStorage(bucket = 'test-bucket'): ObjectStorage & {
  put(key: string, contentType: string, body: Buffer): void;
  has(key: string): boolean;
} {
  const objects = new Map<string, { contentType: string; body: Buffer }>();

  return {
    configured: true,
    bucket,
    browserUploadOrigin: null,
    put(key, contentType, body) {
      objects.set(key, { contentType, body });
    },
    has(key) {
      return objects.has(key);
    },
    async presignUpload(input) {
      return {
        url: `memory://${bucket}/${input.key}`,
        requiredHeaders: {
          'content-type': input.contentType,
        },
        expiresAt: new Date(Date.now() + (input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS) * 1000),
        key: input.key,
        bucket,
      };
    },
    async getObject(key) {
      const found = objects.get(key);
      if (!found) throw new ObjectNotStored(key);
      return { key, contentType: found.contentType, byteSize: found.body.byteLength, body: found.body };
    },
  };
}

/* ── Local-development browser uploads ──────────────────────────────────── */

/** The receiver is mounted only when this exact opt-in implementation is used. */
export const DEVELOPMENT_UPLOAD_PATH = '/api/development-storage/:token';

/**
 * Same-origin, in-memory storage for walking the real browser flow locally.
 *
 * A random, one-use capability stands in for R2's signed query string. The
 * upload still uses the production three-step sequence (presign, browser PUT,
 * server read-back and media verification), but no cloud account is required.
 * It is selected only by `index.ts` when NODE_ENV is `development` and R2 is
 * absent; production continues to fail closed through `unconfiguredStorage`.
 */
export function createDevelopmentStorage(input: {
  appBaseUrl: string;
  bucket?: string;
  maxBytes: number;
}): ObjectStorage {
  const bucket = input.bucket ?? 'local-development';
  const objects = new Map<string, { contentType: string; body: Buffer }>();
  const pending = new Map<
    string,
    { key: string; contentType: string; contentLength: number; expiresAt: Date }
  >();

  return {
    configured: true,
    bucket,
    // The receiver is on the application origin, already allowed by `self`.
    browserUploadOrigin: null,
    browserUploadReceiver: {
      path: DEVELOPMENT_UPLOAD_PATH,
      maxBytes: input.maxBytes,
      async receive({ token, contentType, body }) {
        const grant = pending.get(token);
        if (!grant) return 'not_found';
        pending.delete(token);
        if (grant.expiresAt.getTime() < Date.now()) return 'expired';
        if (contentType.split(';', 1)[0]?.trim().toLowerCase() !== grant.contentType.toLowerCase()) {
          return 'invalid';
        }
        if (body.byteLength !== grant.contentLength || body.byteLength > input.maxBytes) {
          return 'invalid';
        }
        objects.set(grant.key, { contentType: grant.contentType, body: Buffer.from(body) });
        return 'stored';
      },
    },
    async presignUpload(presignInput) {
      const expiresInSeconds = presignInput.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      pending.set(token, {
        key: presignInput.key,
        contentType: presignInput.contentType,
        contentLength: presignInput.contentLength,
        expiresAt,
      });
      const url = new URL(DEVELOPMENT_UPLOAD_PATH.replace(':token', encodeURIComponent(token)), input.appBaseUrl);
      return {
        url: url.toString(),
        requiredHeaders: { 'content-type': presignInput.contentType },
        expiresAt,
        key: presignInput.key,
        bucket,
      };
    },
    async getObject(key) {
      const found = objects.get(key);
      if (!found) throw new ObjectNotStored(key);
      return {
        key,
        contentType: found.contentType,
        byteSize: found.body.byteLength,
        body: Buffer.from(found.body),
      };
    },
  };
}
