// src/integrations/googleDrive/download.ts
import { createWriteStream } from "node:fs";
import { rename, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { driveFetch } from "./client.js";

interface DownloadOptions {
  onProgress?: (downloadedBytes: number, totalBytes?: number) => void;
  signal?: AbortSignal | undefined;
}

export async function downloadFile(
  fileId: string,
  localPath: string,
  options: DownloadOptions = {}
): Promise<void> {
  const url = `/files/${fileId}?alt=media`;
  
  const res = await driveFetch(url, {
    method: "GET",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.body) {
    throw new Error("No response body from download fetch.");
  }

  const totalBytesHeader = res.headers.get("Content-Length");
  const totalBytes = totalBytesHeader ? parseInt(totalBytesHeader, 10) : undefined;

  await mkdir(dirname(localPath), { recursive: true });
  
  const partialPath = `${localPath}.partial`;
  const fileStream = createWriteStream(partialPath);

  // Convert Web Stream to Node Stream to pipe
  // Types in Node 20 `fetch` body are ReadableStream
  const webStream = res.body as unknown as NodeJS.ReadableStream;
  
  let downloadedBytes = 0;
  
  const progressStream = new Readable({
    read() {},
    // Pass-through
  });

  webStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    options.onProgress?.(downloadedBytes, totalBytes);
    progressStream.push(chunk);
  });

  webStream.on("end", () => {
    progressStream.push(null);
  });

  webStream.on("error", (err: Error) => {
    progressStream.destroy(err);
  });

  try {
    await pipeline(progressStream, fileStream, { ...(options.signal ? { signal: options.signal } : {}) });
    // Atomic rename
    await rename(partialPath, localPath);
  } catch (err) {
    fileStream.destroy();
    try {
      await unlink(partialPath);
    } catch {
      // ignore unlink errors
    }
    throw err;
  }
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  await driveFetch(`/files/${fileId}`, {
    method: "DELETE",
  });
}

export async function downloadFileMetadata(fileId: string): Promise<any> {
  const res = await driveFetch(`/files/${fileId}?fields=id,name,mimeType,modifiedTime,md5Checksum,appProperties,size`);
  return res.json();
}
