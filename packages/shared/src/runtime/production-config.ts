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
