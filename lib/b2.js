// Backblaze B2 uploads via the S3-compatible API. Server-only.
import 'server-only';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const ENDPOINT = process.env.B2_S3_ENDPOINT;
const REGION = process.env.B2_REGION || 'us-east-005';
const BUCKET = process.env.B2_BUCKET;
const PUBLIC_HOST = process.env.B2_PUBLIC_HOST;

let _client;
function client() {
  if (!_client) {
    _client = new S3Client({
      endpoint: ENDPOINT,
      region: REGION,
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

// Direct Backblaze URL — only serves if the bucket is set Public.
export function publicUrl(key) {
  return `${PUBLIC_HOST}/file/${BUCKET}/${encodeURI(key)}`;
}

// Stable URL served by our own /api/media proxy (works with a PRIVATE bucket).
// APP_PUBLIC_URL makes it absolute for cross-origin use (the public marketplace);
// left empty it's a same-origin relative path.
export function mediaUrl(key) {
  const base = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}/api/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// The URL we persist in the DB. Private bucket -> proxy; public bucket -> direct.
export function storageUrl(key) {
  return process.env.B2_PUBLIC_READS === 'true' ? publicUrl(key) : mediaUrl(key);
}

// Fetch an object's bytes as a web stream + metadata (for the media proxy).
export async function getObject(key) {
  const out = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return {
    body: out.Body, // aws-sdk v3 Node stream
    contentType: out.ContentType || 'application/octet-stream',
    contentLength: out.ContentLength,
    etag: out.ETag,
  };
}

// Does the object already exist? (skip re-download/re-upload on re-scrape)
export async function exists(key) {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Upload raw bytes. Returns { key, url, bytes, contentType }.
export async function put(key, bytes, contentType = 'application/octet-stream') {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
  return { key, url: storageUrl(key), bytes: bytes.length, contentType };
}

// Delete an object from the bucket. Never throws.
export async function remove(key) {
  try {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Download a remote image and push it to B2. Returns the stored descriptor,
// or null if the source couldn't be fetched / timed out. Some source hosts
// (e.g. Raíces) serve multi-MB images slowly, so we bound each fetch.
export async function mirror(sourceUrl, key, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sourceUrl, { signal: ctrl.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    return await put(key, buf, contentType);
  } catch {
    return null; // timeout or network error — skip this image
  } finally {
    clearTimeout(timer);
  }
}
