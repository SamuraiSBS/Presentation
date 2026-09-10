/** Returns the AITUNNEL-authoritative RUB cost without treating missing data as free. */
export function aitunnelReportedCostRub(response: { usage?: unknown }, headers: Headers) {
  const header = normalizeCost(headers.get("cost-rub"));
  if (header) return header;
  const usage = response.usage;
  const costRub = usage && typeof usage === "object" ? (usage as { cost_rub?: unknown }).cost_rub : undefined;
  return normalizeCost(costRub);
}

function normalizeCost(value: unknown) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d+(?:\.\d+)?$/.test(text) && Number(text) >= 0 ? Number(text).toFixed(8) : undefined;
}
