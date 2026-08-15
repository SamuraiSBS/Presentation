import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_RETENTION_DAYS,
  DEFAULT_EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT,
  exceedsExportStorageQuota,
  exportRetentionCutoff,
  exportStoragePolicy,
} from "./export-storage-policy.js";

describe("export storage policy", () => {
  it("uses bounded production defaults when configuration is absent or invalid", () => {
    expect(exportStoragePolicy({})).toEqual({
      retentionDays: DEFAULT_EXPORT_RETENTION_DAYS,
      quotaBytesPerProject: DEFAULT_EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT,
    });
    expect(exportStoragePolicy({ EXPORT_RETENTION_DAYS: "0", EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT: "invalid" }))
      .toEqual({ retentionDays: DEFAULT_EXPORT_RETENTION_DAYS, quotaBytesPerProject: DEFAULT_EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT });
  });

  it("computes the cleanup cutoff and rejects an export that would exceed its project quota", () => {
    const policy = exportStoragePolicy({ EXPORT_RETENTION_DAYS: "14", EXPORT_STORAGE_QUOTA_BYTES_PER_PROJECT: "100" });
    expect(exportRetentionCutoff(new Date("2026-08-12T12:00:00.000Z"), policy).toISOString()).toBe("2026-07-29T12:00:00.000Z");
    expect(exceedsExportStorageQuota(70, 30, policy)).toBe(false);
    expect(exceedsExportStorageQuota(70, 31, policy)).toBe(true);
  });
});
