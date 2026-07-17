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

  // 2. Upload Data in Chunks (using a single chunk for simplicity unless size > 5MB, then chunked)
  // Google recommends multiples of 256KB for chunks. Let's use 5MB chunks.
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
  const fd = await open(localPath, "r");
  
  try {
    let uploadedBytes = 0;
    while (uploadedBytes < totalSize) {
      if (options.signal?.aborted) {
        throw new Error("Upload aborted");
      }

      const chunkSize = Math.min(CHUNK_SIZE, totalSize - uploadedBytes);
      const buffer = Buffer.alloc(chunkSize);
      await fd.read(buffer, 0, chunkSize, uploadedBytes);

      const endByte = uploadedBytes + chunkSize - 1;
      const contentRange = `bytes ${uploadedBytes}-${endByte}/${totalSize}`;

      const uploadRes = await driveFetch(location, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Length": chunkSize.toString(),
        },
        body: buffer,
        ...(options.signal ? { signal: options.signal } : {}),
        // Since we handle 308 (Resume Incomplete) manually we don't want fetch to auto-throw 
      });

      if (uploadRes.status === 308) {
        // Incomplete, continue to next chunk
        uploadedBytes += chunkSize;
        options.onProgress?.(uploadedBytes, totalSize);
      } else if (uploadRes.status === 200 || uploadRes.status === 201) {
        // Complete
        const finalData = await uploadRes.json() as any;
        options.onProgress?.(totalSize, totalSize);
        return finalData.id;
      } else {
        throw new Error(`Unexpected upload status: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    }
  } finally {
    await fd.close();
  }

  throw new Error("Upload loop finished without 200/201 response.");
}

export async function updateFileResumable(
  fileId: string,
  localPath: string,
  options: UploadOptions = {}
): Promise<void> {
  const fileStat = await stat(localPath);
  const totalSize = fileStat.size;
  const mimeType = options.mimeType || "application/octet-stream";

  // Initiate update session
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

  const CHUNK_SIZE = 5 * 1024 * 1024;
  const fd = await open(localPath, "r");
  
  try {
    let uploadedBytes = 0;
    if (totalSize === 0) {
        // Empty file handling
        const uploadRes = await driveFetch(location, {
            method: "PUT",
            headers: {
                "Content-Range": `bytes */0`,
            },
            ...(options.signal ? { signal: options.signal } : {}),
        });
        if (uploadRes.status === 200 || uploadRes.status === 201) return;
        throw new Error("Failed to upload empty file");
    }

    while (uploadedBytes < totalSize) {
      if (options.signal?.aborted) throw new Error("Upload aborted");

      const chunkSize = Math.min(CHUNK_SIZE, totalSize - uploadedBytes);
      const buffer = Buffer.alloc(chunkSize);
      await fd.read(buffer, 0, chunkSize, uploadedBytes);

      const endByte = uploadedBytes + chunkSize - 1;
      const contentRange = `bytes ${uploadedBytes}-${endByte}/${totalSize}`;

      const uploadRes = await driveFetch(location, {
        method: "PUT",
        headers: {
          "Content-Range": contentRange,
          "Content-Length": chunkSize.toString(),
        },
        body: buffer,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (uploadRes.status === 308) {
        uploadedBytes += chunkSize;
        options.onProgress?.(uploadedBytes, totalSize);
      } else if (uploadRes.status === 200 || uploadRes.status === 201) {
        options.onProgress?.(totalSize, totalSize);
        return;
      } else {
        throw new Error(`Unexpected update status: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    }
  } finally {
    await fd.close();
  }
}
