import path from "node:path";
import JSZip from "jszip";

export const DEFENSE_ARCHIVE_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 500,
  maxDocumentEntries: 32,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalDocumentBytes: 24 * 1024 * 1024,
} as const;

const DOCUMENT_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".docx", ".pptx"]);
const IGNORED_SEGMENTS = new Set([
  ".git",
  ".github",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

export type DefenseArchiveDocument = {
  path: string;
  label: string;
  buffer: Buffer;
  size: number;
};

type ArchiveLimits = Partial<typeof DEFENSE_ARCHIVE_LIMITS>;

export async function extractDefenseArchiveDocuments(
  archive: Buffer,
  overrides: ArchiveLimits = {},
): Promise<DefenseArchiveDocument[]> {
  const limits = { ...DEFENSE_ARCHIVE_LIMITS, ...overrides };
  if (!hasZipSignature(archive)) throw new Error("ZIP archive signature is invalid");
  if (archive.length > limits.maxArchiveBytes) throw new Error("ZIP archive exceeds the upload limit");

  const zip = await JSZip.loadAsync(archive, { createFolders: false, checkCRC32: false });
  const entries = Object.values(zip.files);
  if (entries.length > limits.maxEntries) throw new Error("ZIP archive contains too many entries");

  const candidates = entries
    .filter((entry) => !entry.dir)
    .map((entry) => {
      const originalName = String((entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || entry.name);
      if (!isSafeArchivePath(originalName)) throw new Error(`Unsafe ZIP entry path: ${originalName}`);
      const normalized = normalizeArchivePath(entry.name);
      return { entry, normalized, declaredSize: declaredUncompressedSize(entry) };
    })
    .filter(({ normalized }) => isDefenseDocumentationPath(normalized));

  if (candidates.length > limits.maxDocumentEntries) {
    throw new Error("ZIP archive contains too many documentation files");
  }

  const declaredTotal = candidates.reduce((sum, item) => sum + item.declaredSize, 0);
  if (candidates.some((item) => item.declaredSize > limits.maxEntryBytes)) {
    throw new Error("ZIP documentation entry exceeds the size limit");
  }
  if (declaredTotal > limits.maxTotalDocumentBytes) {
    throw new Error("ZIP documentation exceeds the uncompressed size limit");
  }

  const documents: DefenseArchiveDocument[] = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    const buffer = await candidate.entry.async("nodebuffer");
    if (buffer.length > limits.maxEntryBytes) throw new Error("ZIP documentation entry exceeds the size limit");
    totalBytes += buffer.length;
    if (totalBytes > limits.maxTotalDocumentBytes) {
      throw new Error("ZIP documentation exceeds the uncompressed size limit");
    }
    documents.push({
      path: candidate.normalized,
      label: path.posix.basename(candidate.normalized),
      buffer,
      size: buffer.length,
    });
  }

  if (!documents.length) {
    throw new Error("ZIP archive does not contain README or supported docs/documentation files");
  }
  return documents;
}

export function isSafeArchivePath(value: string) {
  const raw = String(value || "").replace(/\\/g, "/");
  if (!raw || raw.includes("\u0000") || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) return false;
  const segments = raw.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || !segment)) return false;
  const normalized = path.posix.normalize(raw);
  return normalized === raw.replace(/^\.\//, "") && !normalized.startsWith("../");
}

export function isDefenseDocumentationPath(value: string) {
  const normalized = normalizeArchivePath(value);
  const segments = normalized.toLowerCase().split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return false;
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(extension)) return false;
  const filename = path.posix.basename(normalized).toLowerCase();
  if (/^readme(?:\.|$)/i.test(filename)) return segments.length <= 3;
  return segments[0] === "docs" || segments[0] === "documentation";
}

export function hasZipSignature(buffer: Buffer) {
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && (
    (buffer[2] === 0x03 && buffer[3] === 0x04)
    || (buffer[2] === 0x05 && buffer[3] === 0x06)
    || (buffer[2] === 0x07 && buffer[3] === 0x08)
  );
}

function normalizeArchivePath(value: string) {
  return path.posix.normalize(String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""));
}

function declaredUncompressedSize(entry: JSZip.JSZipObject) {
  const value = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}
