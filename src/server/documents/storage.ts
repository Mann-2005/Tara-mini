// File storage for uploaded originals.
// Files are content-addressed (named by SHA-256), so the stored bytes can be
// verified against Document.sha256 at any time (GoBD integrity) and are never
// overwritten. Local disk for the prototype; swap for object storage later.

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const ACCEPTED_MIME_TYPES = Object.keys(EXTENSIONS);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? "storage");
}

/** Stores the bytes and returns the storage path relative to the storage root. */
export async function storeOriginal(bytes: Uint8Array, mimeType: string, hash: string): Promise<string> {
  const ext = EXTENSIONS[mimeType];
  if (!ext) throw new Error(`Unsupported file type ${mimeType}`);
  const relative = `uploads/${hash.slice(0, 2)}/${hash}.${ext}`;
  const absolute = path.join(storageRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await access(absolute); // same content already stored
  } catch {
    await writeFile(absolute, bytes, { flag: "wx" });
  }
  return relative;
}

/** Reads a stored original back, verifying it still matches its recorded hash. */
export async function readOriginal(relativePath: string, expectedSha256: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(path.join(storageRoot(), relativePath)));
  if (sha256(bytes) !== expectedSha256) {
    throw new Error(`Integrity check failed: stored file ${relativePath} does not match its SHA-256`);
  }
  return bytes;
}

/** Whether the original file is on disk (seed documents have none). */
export async function originalExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(storageRoot(), relativePath));
    return true;
  } catch {
    return false;
  }
}
