// src/integrations/googleDrive/client.ts
import { GoogleAuthProvider } from "../../auth/googleAuth.js";
import { getAbortController } from "../../core/cancellation.js";

const authProvider = new GoogleAuthProvider();

export class DriveApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(`Drive API Error ${status}: ${message}`);
    this.name = "DriveApiError";
    this.status = status;
    this.data = data;
  }
}

export interface DriveFetchOptions extends RequestInit {
  retryCount?: number;
  maxRetries?: number;
  acceptedStatuses?: number[];
}

export async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("AbortError"));
    
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("AbortError"));
    };
    
    signal.addEventListener("abort", onAbort);
  });
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export async function driveFetch(path: string, options: DriveFetchOptions = {}): Promise<Response> {
  const { retryCount = 0, maxRetries = MAX_RETRIES, ...init } = options;
  
  let accessToken = await authProvider.getAccessToken();
  if (!accessToken) {
    // Attempt one explicit refresh if missing
    await authProvider.refresh();
    accessToken = await authProvider.getAccessToken();
    if (!accessToken) {
      throw new Error("Cannot contact Google Drive: Not authenticated.");
    }
  }

  const url = path.startsWith("http") ? path : `https://www.googleapis.com/drive/v3${path}`;
  const signal = init.signal || getAbortController().signal;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });

    if (!res.ok && (!options.acceptedStatuses || !options.acceptedStatuses.includes(res.status))) {
      // Handle 401 Unauthorized (token expired)
      if (res.status === 401 && retryCount === 0) {
        await authProvider.refresh();
        return driveFetch(path, { ...options, retryCount: retryCount + 1 });
      }

      // Handle 408, 429 Too Many Requests or 500, 502, 503, 504 server errors
      if ((res.status === 408 || res.status === 429 || [500, 502, 503, 504].includes(res.status)) && retryCount < maxRetries) {
        let delayMs = BASE_DELAY_MS * Math.pow(2, retryCount) + Math.random() * 1000;
        
        // Honor Retry-After header if present
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delayMs = Math.max(delayMs, parsed * 1000);
          }
        }

        await abortableDelay(delayMs, signal);
        return driveFetch(path, { ...options, retryCount: retryCount + 1 });
      }

      let errorData: any;
      try {
        errorData = await res.json();
      } catch {
        errorData = await res.text();
      }

      const errorMessage = errorData && typeof errorData === "object" && errorData.error ? errorData.error.message : res.statusText;
      throw new DriveApiError(res.status, errorMessage, errorData);
    }

    return res;
  } catch (error: any) {
    if (error.name === "AbortError" || error.message === "AbortError") {
      const e = new Error("Aborted");
      e.name = "AbortError";
      throw e;
    }
    // Do not blindly retry protocol errors (e.g., 400, 403, 404)
    if (error instanceof DriveApiError) {
      throw error;
    }
    // Network failures, attempt retry
    if (retryCount < maxRetries) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount) + Math.random() * 1000;
      await abortableDelay(delayMs, signal);
      return driveFetch(path, { ...options, retryCount: retryCount + 1 });
    }
    throw error;
  }
}

export async function driveFetchJson<T>(path: string, options: DriveFetchOptions = {}): Promise<T> {
  const res = await driveFetch(path, options);
  return res.json() as Promise<T>;
}
