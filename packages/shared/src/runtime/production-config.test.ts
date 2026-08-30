import { describe, expect, it } from "vitest";
import { assertProductionConfiguration, devAuthAllowed, productionConfigurationErrors } from "./production-config.js";

const secret = "a-unique-production-secret-that-is-long-enough";
const productionEnvironment = {
  DEPLOYMENT_ENV: "production",
  NODE_ENV: "production",
  NEXTAUTH_SECRET: secret,
  INTERNAL_API_TOKEN: `${secret}-internal`,
  POSTGRES_PASSWORD: `${secret}-postgres`,
  MINIO_ROOT_PASSWORD: `${secret}-minio`,
  S3_SECRET_ACCESS_KEY: `${secret}-s3`,
  MINIO_ROOT_USER: "studydeck-production-root",
  S3_ACCESS_KEY_ID: "studydeck-production-access",
  DATABASE_URL: "postgresql://studydeck:long-unique-password@postgres:5432/studydeck?schema=public",
  ALLOW_DEV_AUTH: "false",
  ALLOW_DEV_ADMIN: "false",
  NEXTAUTH_URL: "https://app.studydeck.ai",
  SITE_DOMAIN: "app.studydeck.ai",
  TELEGRAM_CLIENT_ID: "telegram-client",
  TELEGRAM_CLIENT_SECRET: "telegram-secret",
  ADMIN_TELEGRAM_IDS: "123456789",
  LEGAL_ENTITY_NAME: "StudyDeck AI LLC",
  SUPPORT_EMAIL: "support@studydeck.ai",
  BACKUP_ENABLED: "true",
  BACKUP_AGE_RECIPIENT: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5h2w9e",
  BACKUP_AGE_IDENTITY_FILE: "/etc/studydeck/backup.agekey",
  BACKUP_S3_ENDPOINT: "https://backups.studydeck.ai",
  BACKUP_S3_BUCKET: "studydeck-production-backups",
  BACKUP_S3_ACCESS_KEY_ID: "studydeck-production-backup-access",
  BACKUP_S3_SECRET_ACCESS_KEY: `${secret}-backup`,
  BACKUP_RETENTION_DAYS: "35",
  BACKUP_OBJECT_LOCK_RETENTION_DAYS: "35",
  BACKUP_RPO_HOURS: "24",
  BACKUP_RTO_HOURS: "4",
  BACKUP_DRILL_MAX_AGE_DAYS: "7",
  OPERATIONS_OWNER: "studydeck-on-call",
  OPERATIONS_ALERT_CHANNEL: "telegram:123456789",
  YOOKASSA_SHOP_ID: "123456",
  YOOKASSA_SECRET_KEY: `${secret}-yookassa`,
  HSTS_MAX_AGE: "31536000",
  TRUST_PROXY_HOPS: "1",
  MALWARE_SCAN_ENABLED: "true",
  CLAMAV_HOST: "clamav",
  CLAMAV_PORT: "3310",
};

describe("production configuration", () => {
  it("accepts a complete non-local production environment", () => {
    expect(productionConfigurationErrors(productionEnvironment)).toEqual([]);
    expect(() => assertProductionConfiguration(productionEnvironment)).not.toThrow();
  });

  it("does not require an age backup recipient", () => {
    expect(productionConfigurationErrors({
      ...productionEnvironment,
      BACKUP_AGE_RECIPIENT: "",
    })).toEqual([]);

    expect(productionConfigurationErrors({
      ...productionEnvironment,
      BACKUP_AGE_RECIPIENT: "not-an-age-recipient",
    })).toEqual([]);
  });

  it("rejects local identity, defaults, and a local auth URL", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      NEXTAUTH_SECRET: "change-me",
      ALLOW_DEV_AUTH: "true",
      TEMP_USER_ID: "local-user",
      NEXTAUTH_URL: "http://localhost:3010",
      SITE_DOMAIN: "localhost",
      ADMIN_TELEGRAM_IDS: "",
      HSTS_MAX_AGE: "0",
      TRUST_PROXY_HOPS: "2",
      MALWARE_SCAN_ENABLED: "false",
    });
    expect(errors.join("\n")).toMatch(/NEXTAUTH_SECRET/);
    expect(errors.join("\n")).toMatch(/ALLOW_DEV_AUTH/);
    expect(errors.join("\n")).toMatch(/TEMP_USER_ID/);
    expect(errors.join("\n")).toMatch(/NEXTAUTH_URL/);
    expect(errors.join("\n")).toMatch(/ADMIN_TELEGRAM_IDS/);
    expect(errors.join("\n")).toMatch(/HSTS_MAX_AGE/);
    expect(errors.join("\n")).toMatch(/TRUST_PROXY_HOPS/);
    expect(errors.join("\n")).toMatch(/MALWARE_SCAN_ENABLED/);
  });

  it("rejects production-template placeholders and reserved example domains", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      NEXTAUTH_SECRET: "<set-a-unique-secret-in-your-secret-manager>",
      INTERNAL_API_TOKEN: "REPLACE_WITH_A_SEPARATE_INTERNAL_TOKEN",
      POSTGRES_PASSWORD: "REPLACE_WITH_A_UNIQUE_32_PLUS_CHARACTER_DATABASE_SECRET",
      NEXTAUTH_URL: "https://app.example.com",
      SITE_DOMAIN: "app.example.com",
      TELEGRAM_CLIENT_ID: "REPLACE_WITH_TELEGRAM_CLIENT_ID",
      TELEGRAM_CLIENT_SECRET: "REPLACE_WITH_TELEGRAM_CLIENT_SECRET",
      ADMIN_TELEGRAM_IDS: "REPLACE_WITH_YOUR_NUMERIC_TELEGRAM_ID",
    }).join("\n");
    expect(errors).toMatch(/NEXTAUTH_SECRET/);
    expect(errors).toMatch(/INTERNAL_API_TOKEN/);
    expect(errors).toMatch(/POSTGRES_PASSWORD/);
    expect(errors).toMatch(/NEXTAUTH_URL/);
    expect(errors).toMatch(/Telegram OAuth/);
    expect(errors).toMatch(/ADMIN_TELEGRAM_IDS/);
  });

  it("never enables dev auth when deployment is production", () => {
    expect(devAuthAllowed({ DEPLOYMENT_ENV: "production", ALLOW_DEV_AUTH: "true" })).toBe(false);
    expect(devAuthAllowed({ DEPLOYMENT_ENV: "local", ALLOW_DEV_AUTH: "true" })).toBe(true);
  });

  it("requires public legal and support identities", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      LEGAL_ENTITY_NAME: "",
      SUPPORT_EMAIL: "not-an-email",
    }).join("\n");
    expect(errors).toMatch(/LEGAL_ENTITY_NAME/);
    expect(errors).toMatch(/SUPPORT_EMAIL/);
  });

  it("requires an off-site backup policy and an accountable recovery target", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      BACKUP_ENABLED: "false",
      BACKUP_AGE_RECIPIENT: "",
      BACKUP_S3_ENDPOINT: "http://minio:9000",
      BACKUP_S3_BUCKET: "",
      BACKUP_RETENTION_DAYS: "1",
      BACKUP_OBJECT_LOCK_RETENTION_DAYS: "1",
      OPERATIONS_OWNER: "",
      OPERATIONS_ALERT_CHANNEL: "",
      YOOKASSA_SHOP_ID: "",
      YOOKASSA_SECRET_KEY: "change-me",
    }).join("\n");
    expect(errors).toMatch(/BACKUP_ENABLED/);
    expect(errors).toMatch(/BACKUP_S3_ENDPOINT/);
    expect(errors).toMatch(/BACKUP_RETENTION_DAYS/);
    expect(errors).toMatch(/OPERATIONS_OWNER/);
    expect(errors).toMatch(/YOOKASSA_SHOP_ID/);
    expect(errors).toMatch(/YOOKASSA_SECRET_KEY/);
  });

  it("allows the explicit temporary no-backup exception only when backups are disabled", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      ALLOW_PRODUCTION_WITHOUT_BACKUP: "true",
      BACKUP_ENABLED: "false",
      BACKUP_S3_ENDPOINT: "",
      BACKUP_S3_BUCKET: "",
      BACKUP_S3_ACCESS_KEY_ID: "",
      BACKUP_S3_SECRET_ACCESS_KEY: "",
      BACKUP_RETENTION_DAYS: "",
      BACKUP_OBJECT_LOCK_RETENTION_DAYS: "",
      BACKUP_RPO_HOURS: "",
      BACKUP_RTO_HOURS: "",
      BACKUP_DRILL_MAX_AGE_DAYS: "",
    });
    expect(errors).toEqual([]);
  });

  it("does not allow the temporary exception while backups remain enabled", () => {
    const errors = productionConfigurationErrors({
      ...productionEnvironment,
      ALLOW_PRODUCTION_WITHOUT_BACKUP: "true",
      BACKUP_ENABLED: "true",
    }).join("\n");
    expect(errors).toMatch(/BACKUP_ENABLED must be false/);
  });
});
