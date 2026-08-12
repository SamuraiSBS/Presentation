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
  NEXTAUTH_URL: "https://app.studydeck.example",
  SITE_DOMAIN: "app.studydeck.example",
  TELEGRAM_CLIENT_ID: "telegram-client",
  TELEGRAM_CLIENT_SECRET: "telegram-secret",
  ADMIN_TELEGRAM_IDS: "123456789",
  LEGAL_ENTITY_NAME: "StudyDeck AI LLC",
  SUPPORT_EMAIL: "support@studydeck.example",
};

describe("production configuration", () => {
  it("accepts a complete non-local production environment", () => {
    expect(productionConfigurationErrors(productionEnvironment)).toEqual([]);
    expect(() => assertProductionConfiguration(productionEnvironment)).not.toThrow();
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
    });
    expect(errors.join("\n")).toMatch(/NEXTAUTH_SECRET/);
    expect(errors.join("\n")).toMatch(/ALLOW_DEV_AUTH/);
    expect(errors.join("\n")).toMatch(/TEMP_USER_ID/);
    expect(errors.join("\n")).toMatch(/NEXTAUTH_URL/);
    expect(errors.join("\n")).toMatch(/ADMIN_TELEGRAM_IDS/);
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
});
