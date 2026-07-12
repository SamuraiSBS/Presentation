import type { AdminListQuery } from "@studydeck/shared";

export const ADMIN_TIME_ZONE = "Europe/Moscow" as const;

export function adminRange(query: Pick<AdminListQuery, "period" | "from" | "to">, now = new Date()) {
  const to = query.period === "custom" && query.to ? new Date(query.to) : now;
  if (query.period === "all") return { from: null, to, timeZone: ADMIN_TIME_ZONE };
  if (query.period === "custom" && query.from) return { from: new Date(query.from), to, timeZone: ADMIN_TIME_ZONE };

  const parts = zonedParts(now);
  if (query.period === "today") return { from: zonedWallToUtc(parts.year, parts.month, parts.day), to, timeZone: ADMIN_TIME_ZONE };
  if (query.period === "month") return { from: zonedWallToUtc(parts.year, parts.month, 1), to, timeZone: ADMIN_TIME_ZONE };
  const days = query.period === "7d" ? 7 : 30;
  return { from: new Date(to.getTime() - days * 86_400_000), to, timeZone: ADMIN_TIME_ZONE };
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function zonedWallToUtc(year: number, month: number, day: number) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let result = guess;
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(new Date(result));
    result += guess - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  }
  return new Date(result);
}
