export type RuntimeEnvironment = Record<string, string | undefined>;

const UNSAFE_VALUES = new Set([
  "change-me",
  "change-me-internal-token",
  "change-me-local-auth-secret",
  "local-user",
  "studydeck",
  "studydeck-password",
]);

function value(env: RuntimeEnvironment, key: string) {
  return env[key]?.trim() || "";
}

function isUnsafeSecret(candidate: string) {
  const normalized = candidate.trim().toLowerCase();
  return !normalized
    || UNSAFE_VALUES.has(normalized)
    || normalized.startsWith("change-me")
    || normalized.startsWith("replace-me")
    || normalized.startsWith("your-");
}

function publicHttpsHost(candidate: string) {
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const localHost = host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".test")
      || host === "0.0.0.0"
      || host === "::1"
      || /^127\./.test(host)
      || /^192\.168\./.test(host)
      || /^10\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    return url.protocol === "https:" && !localHost ? host : null;
  } catch {
    return null;
  }
}

function positiveInteger(candidate: string) {
  return /^[1-9]\d*$/.test(candidate) ? Number(candidate) : null;
}

/**
 * Validates the small set of values that must never inherit local defaults in
 * a public deployment. It intentionally does nothing outside production so
 * local development remains opt-in and ergonomic.
 */
export function productionConfigurationErrors(env: RuntimeEnvironment = process.env): string[] {
  if (value(env, "DEPLOYMENT_ENV").toLowerCase() !== "production") return [];

  const errors: string[] = [];
  if (value(env, "NODE_ENV").toLowerCase() !== "production") {
    errors.push("NODE_ENV must be production when DEPLOYMENT_ENV is production");
  }
  const requiredSecrets = [
    "NEXTAUTH_SECRET",
    "INTERNAL_API_TOKEN",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_PASSWORD",
    "S3_SECRET_ACCESS_KEY",
  ];

  for (const key of requiredSecrets) {
    const candidate = value(env, key);
    if (isUnsafeSecret(candidate) || candidate.length < 32) {
      errors.push(`${key} must be a unique non-default secret of at least 32 characters`);
    }
  }

  for (const key of ["MINIO_ROOT_USER", "S3_ACCESS_KEY_ID", "DATABASE_URL"]) {
    const candidate = value(env, key);
    if (isUnsafeSecret(candidate) || candidate.includes("studydeck:studydeck")) {
      errors.push(`${key} must not use a local/default credential`);
    }
  }

  for (const key of ["ALLOW_DEV_AUTH", "ALLOW_DEV_ADMIN"]) {
    if (value(env, key).toLowerCase() === "true") errors.push(`${key} must be false in production`);
  }

  if (value(env, "TEMP_USER_ID")) errors.push("TEMP_USER_ID must be unset in production");

  const nextAuthHost = publicHttpsHost(value(env, "NEXTAUTH_URL"));
  if (!nextAuthHost) errors.push("NEXTAUTH_URL must use a public HTTPS domain");

  const siteDomain = value(env, "SITE_DOMAIN").toLowerCase();
  if (!siteDomain || siteDomain !== nextAuthHost) {
    errors.push("SITE_DOMAIN must match the public NEXTAUTH_URL hostname");
  }

  if (!value(env, "TELEGRAM_CLIENT_ID") || !value(env, "TELEGRAM_CLIENT_SECRET")) {
    errors.push("Telegram OAuth credentials are required for production login");
  }

  const adminIds = value(env, "ADMIN_TELEGRAM_IDS").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!adminIds.length || adminIds.some((entry) => !/^\d+$/.test(entry))) {
    errors.push("ADMIN_TELEGRAM_IDS must contain at least one numeric Telegram ID");
  }

  if (!value(env, "LEGAL_ENTITY_NAME")) errors.push("LEGAL_ENTITY_NAME must identify the service operator");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value(env, "SUPPORT_EMAIL"))) {
    errors.push("SUPPORT_EMAIL must be a valid public support address");
  }

  if (value(env, "BACKUP_ENABLED").toLowerCase() !== "true") {
    errors.push("BACKUP_ENABLED must be true in production");
  }
  if (!/^age1[0-9a-z]+$/.test(value(env, "BACKUP_AGE_RECIPIENT"))) {
    errors.push("BACKUP_AGE_RECIPIENT must be an age public recipient");
  }
  const backupEndpoint = value(env, "BACKUP_S3_ENDPOINT");
  if (!publicHttpsHost(backupEndpoint) || backupEndpoint === value(env, "S3_ENDPOINT")) {
    errors.push("BACKUP_S3_ENDPOINT must be a separate public HTTPS object-storage endpoint");
  }
  if (!value(env, "BACKUP_S3_BUCKET") || value(env, "BACKUP_S3_BUCKET") === value(env, "S3_BUCKET")) {
    errors.push("BACKUP_S3_BUCKET must be set and separate from S3_BUCKET");
  }
  if (isUnsafeSecret(value(env, "BACKUP_S3_SECRET_ACCESS_KEY")) || value(env, "BACKUP_S3_SECRET_ACCESS_KEY").length < 32) {
    errors.push("BACKUP_S3_SECRET_ACCESS_KEY must be a unique non-default secret of at least 32 characters");
  }
  if (isUnsafeSecret(value(env, "BACKUP_S3_ACCESS_KEY_ID"))) {
    errors.push("BACKUP_S3_ACCESS_KEY_ID must be a non-default dedicated credential");
  }
  const retentionDays = positiveInteger(value(env, "BACKUP_RETENTION_DAYS"));
  const objectLockDays = positiveInteger(value(env, "BACKUP_OBJECT_LOCK_RETENTION_DAYS"));
  if (!retentionDays || retentionDays < 7) errors.push("BACKUP_RETENTION_DAYS must be at least 7");
  if (!objectLockDays || (retentionDays && objectLockDays < retentionDays)) {
    errors.push("BACKUP_OBJECT_LOCK_RETENTION_DAYS must be at least BACKUP_RETENTION_DAYS");
  }
  if (!positiveInteger(value(env, "BACKUP_RPO_HOURS"))) errors.push("BACKUP_RPO_HOURS must be a positive integer");
  if (!positiveInteger(value(env, "BACKUP_RTO_HOURS"))) errors.push("BACKUP_RTO_HOURS must be a positive integer");
  if (!positiveInteger(value(env, "BACKUP_DRILL_MAX_AGE_DAYS"))) errors.push("BACKUP_DRILL_MAX_AGE_DAYS must be a positive integer");
  if (!value(env, "OPERATIONS_OWNER")) errors.push("OPERATIONS_OWNER must identify the incident owner");
  if (!value(env, "OPERATIONS_ALERT_CHANNEL")) errors.push("OPERATIONS_ALERT_CHANNEL must identify the incident notification channel");

  const hstsMaxAge = positiveInteger(value(env, "HSTS_MAX_AGE"));
  if (!hstsMaxAge || hstsMaxAge < 31_536_000) {
    errors.push("HSTS_MAX_AGE must be at least 31536000 after the public HTTPS domain is ready");
  }
  if (value(env, "TRUST_PROXY_HOPS") !== "1") {
    errors.push("TRUST_PROXY_HOPS must be 1 for the single trusted Caddy hop");
  }
  if (value(env, "MALWARE_SCAN_ENABLED").toLowerCase() !== "true") {
    errors.push("MALWARE_SCAN_ENABLED must be true in production");
  }
  if (!value(env, "CLAMAV_HOST")) errors.push("CLAMAV_HOST must identify the malware scanner");
  if (!positiveInteger(value(env, "CLAMAV_PORT"))) errors.push("CLAMAV_PORT must be a positive integer");

  return errors;
}

export function assertProductionConfiguration(env: RuntimeEnvironment = process.env): void {
  const errors = productionConfigurationErrors(env);
  if (errors.length) {
    throw new Error(`Unsafe production configuration:\n- ${errors.join("\n- ")}`);
  }
}

export function devAuthAllowed(env: RuntimeEnvironment = process.env): boolean {
  return value(env, "DEPLOYMENT_ENV").toLowerCase() !== "production"
    && value(env, "ALLOW_DEV_AUTH").toLowerCase() === "true";
}
