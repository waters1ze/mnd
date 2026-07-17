// src/integrations/googleDrive/upload.ts
import { stat, open } from "node:fs/promises";
import { basename } from "node:path";
import { driveFetch } from "./client.js";

interface UploadOptions {
  parentId?: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal | undefined;
}

export async function uploadFileResumable(
  localPath: string,
  remoteName: string,
  options: UploadOptions = {}
): Promise<string> {
  const fileStat = await stat(localPath);
  const totalSize = fileStat.size;
  const mimeType = options.mimeType || "application/octet-stream";

  const metadata: any = {
    name: remoteName,
    mimeType,
  };
  if (options.parentId) {
    metadata.parents = [options.parentId];
  }
  if (options.appProperties) {
    metadata.appProperties = options.appProperties;
  }

  // 1. Initiate Resumable Session
  const initRes = await driveFetch("/files?uploadType=resumable", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Upload-Content-Length": totalSize.toString(),
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify(metadata),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const location = initRes.headers.get("location");
  if (!location) {
    throw new Error("Failed to initialize resumable upload: no location header returned.");
  }

  return await runChunkedUpload(location, localPath, totalSize, options);
}

export async function updateFileResumable(
  fileId: string,
  localPath: string,
  options: UploadOptions = {}
): Promise<void> {
  const fileStat = await stat(localPath);
  const totalSize = fileStat.size;
  const mimeType = options.mimeType || "application/octet-stream";

  const initRes = await driveFetch(`/files/${fileId}?uploadType=resumable`, {
    method: "PATCH",
    headers: {
      "X-Upload-Content-Length": totalSize.toString(),
      "X-Upload-Content-Type": mimeType,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const location = initRes.headers.get("location");
  if (!location) throw new Error("Failed to initialize resumable update.");

  await runChunkedUpload(location, localPath, totalSize, options);
}

async function runChunkedUpload(location: string, localPath: string, totalSize: string | number, options: UploadOptions): Promise<string> {
  const size = typeof totalSize === "string" ? parseInt(totalSize, 10) : totalSize;
  const CHUNK_SIZE = 5 * 1024 * 1024;
  
  if (size === 0) {
    const uploadRes = await driveFetch(location, {
      method: "PUT",
      headers: { "Content-Range": `bytes */0` },
      ...(options.signal ? { signal: options.signal } : {}),
      acceptedStatuses: [200, 201]
    });
    const finalData = await uploadRes.json() as any;
    return finalData.id || "";
  }

  const fd = await open(localPath, "r");
  try {
    let uploadedBytes = 0;
    while (uploadedBytes < size) {
      if (options.signal?.aborted) throw new Error("Upload aborted");

      const chunkSize = Math.min(CHUNK_SIZE, size - uploadedBytes);
      const buffer = Buffer.alloc(chunkSize);
      await fd.read(buffer, 0, chunkSize, uploadedBytes);

      const endByte = uploadedBytes + chunkSize - 1;
      const contentRange = `bytes ${uploadedBytes}-${endByte}/${size}`;

      const uploadRes = await driveFetch(location, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Length": chunkSize.toString(),
        },
        body: buffer,
        ...(options.signal ? { signal: options.signal } : {}),
        acceptedStatuses: [200, 201, 308],
      });

      if (uploadRes.status === 308) {
        let rangeHeader = uploadRes.headers.get("Range");
        if (!rangeHeader) {
          // Query session status if Range is absent
          const statusRes = await driveFetch(location, {
            method: "PUT",
            headers: { "Content-Range": `bytes */${size}` },
            ...(options.signal ? { signal: options.signal } : {}),
            acceptedStatuses: [200, 201, 308],
          });
          
          if (statusRes.status === 308) {
            rangeHeader = statusRes.headers.get("Range");
          } else if (statusRes.status === 200 || statusRes.status === 201) {
            const finalData = await statusRes.json() as any;
            options.onProgress?.(size, size);
            return finalData.id || "";
          } else {
            throw new Error(`Unexpected status check response: ${statusRes.status}`);
          }
        }
        
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=0-(\d+)/);
          if (match && match[1]) {
            uploadedBytes = parseInt(match[1], 10) + 1;
          } else {
            uploadedBytes += chunkSize;
          }
        } else {
           // still no range header, assume 0
           uploadedBytes = 0;
        }
        options.onProgress?.(uploadedBytes, size);
      } else if (uploadRes.status === 200 || uploadRes.status === 201) {
        const finalData = await uploadRes.json() as any;
        options.onProgress?.(size, size);
        return finalData.id || "";
      } else {
        throw new Error(`Unexpected upload status: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    }
    throw new Error("Upload loop finished without 200/201 response.");
  } finally {
    await fd.close();
  }
}
