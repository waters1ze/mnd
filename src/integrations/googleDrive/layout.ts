// src/integrations/googleDrive/layout.ts
import { driveFetchJson, DriveApiError } from "./client.js";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
  headRevisionId?: string;
}

interface FileListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

export async function findDriveFoldersByName(name: string, parentId?: string): Promise<DriveFile[]> {
  const queryParts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`
  ];
  if (parentId) {
    queryParts.push(`'${parentId}' in parents`);
  }
  
  const q = queryParts.join(" and ");
  const url = `/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,appProperties,modifiedTime)&spaces=drive`;
  
  const res = await driveFetchJson<FileListResponse>(url);
  return res.files || [];
}

export async function createDriveFolder(name: string, parentId?: string, appProperties?: Record<string, string>): Promise<DriveFile> {
  const body: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    body.parents = [parentId];
  }
  if (appProperties) {
    body.appProperties = appProperties;
  }

  return driveFetchJson<DriveFile>("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Ensures a folder exists by appProperty first, then by name.
 * If multiple exist, it throws to prompt user resolution (UI logic).
 */
export async function getOrCreateFolder(
  name: string, 
  parentId?: string, 
  appProperties?: Record<string, string>
): Promise<string> {
  // First search by app property if provided (stable ID)
  if (appProperties && Object.keys(appProperties).length > 0) {
    const propQuery = Object.entries(appProperties).map(([k, v]) => `appProperties has { key='${k}' and value='${v}' }`).join(" and ");
    const q = `${propQuery} and trashed = false`;
    const res = await driveFetchJson<FileListResponse>(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
    if (res.files && res.files.length > 0 && res.files[0]) {
      return res.files[0].id;
    }
  }

  // Fallback search by name
  const folders = await findDriveFoldersByName(name, parentId);
  if (folders.length === 1 && folders[0]) {
    const id = folders[0].id;
    // Retroactively add appProperties if they were missing
    if (appProperties) {
      await driveFetchJson(`/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appProperties }),
      });
    }
    return id;
  }
  
  if (folders.length > 1) {
    throw new Error(`Multiple "${name}" folders found. Please resolve manually or select one.`);
  }

  // Create new
  const created = await createDriveFolder(name, parentId, appProperties);
  return created.id;
}
