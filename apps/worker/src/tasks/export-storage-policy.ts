const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_EXPORT_RETENTION_DAYS = 30;
export const DEFAULT_EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT = 512 * 1024 * 1024;

export type ExportStoragePolicy = {
  retentionDays: number;
  quotaBytesPerProject: number;
};

export function exportStoragePolicy(env: Record<string, string | undefined> = process.env): ExportStoragePolicy {
  return {
    retentionDays: positiveInteger(env.EXPORT_RETENTION_DAYS, DEFAULT_EXPORT_RETENTION_DAYS),
    quotaBytesPerProject: positiveInteger(env.EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT, DEFAULT_EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT),
  };
}

export function exportRetentionCutoff(now: Date, policy = exportStoragePolicy()) {
  return new Date(now.getTime() - policy.retentionDays * DAY_MS);
}

export function exceedsExportStorageQuota(currentBytes: number, nextBytes: number, policy = exportStoragePolicy()) {
  return currentBytes + nextBytes > policy.quotaBytesPerProject;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
