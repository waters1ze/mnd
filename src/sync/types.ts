// src/sync/types.ts

export type SyncState = "synced" | "local_changed" | "remote_changed" | "conflict" | "pending" | "deleted_local" | "deleted_remote";

export interface SyncTombstone {
  relativePath: string;
  remoteFileId?: string;
  deletedRemoteAt: string;
  localHash?: string;
  resolution: "pending" | "reupload" | "keep_local_untracked" | "accept_deletion";
}

export interface SyncEntry {
  version: 1;
  relativePath: string;
  localHash?: string | undefined;
  localSize?: number | undefined;
  localMtime?: string | undefined;
  remoteFileId?: string | undefined;
  remoteRevision?: string | undefined;
  remoteMd5Checksum?: string | undefined;
  remoteModifiedTime?: string | undefined;
  lastSyncedHash?: string | undefined;
  lastSyncedAt?: string | undefined;
  state: SyncState;
  tombstone?: SyncTombstone;
}

export interface SyncManifest {
  version: 1;
  entries: Record<string, SyncEntry>;
}

export type SyncActionType = "push" | "pull" | "conflict" | "skip" | "delete_remote" | "mark_tombstone";

export interface SyncPlanAction {
  type: SyncActionType;
  entry: SyncEntry;
  reason: string;
}

export interface SyncPlan {
  actions: SyncPlanAction[];
  conflicts: SyncPlanAction[];
}
