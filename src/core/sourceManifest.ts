import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export type SourceManifestEntry = {
  sourceId: string;
  canonicalRelativePath: string;
  algorithm: "sha256" | "md5";
  hash: string;
  size: number | null;
  mtime: string | null;
};

export async function hashFileStream(filePath: string, algorithm: "sha256" | "md5" = "sha256"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
