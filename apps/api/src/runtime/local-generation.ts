type ConfigReader = {
  get(key: string): unknown;
};

export function isLocalGenerationUnlimited(config?: ConfigReader) {
  const deploymentEnv = config?.get("DEPLOYMENT_ENV");
  return typeof deploymentEnv === "string" && deploymentEnv.trim().toLowerCase() === "local";
}
