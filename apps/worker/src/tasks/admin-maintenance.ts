import type { Job } from "bullmq";
import crypto from "node:crypto";
import { getPrisma } from "../prisma.js";
import { errorLogFields, logger } from "../observability.js";

export async function handleAdminMaintenance(_job: Job) {
  const prisma = getPrisma();
  const now = new Date();
  await prisma.operationalEvent.deleteMany({ where: { expiresAt: { lt: now } } });
  await refreshCbrRates(now);

  const stuckBefore = new Date(now.getTime() - Number(process.env.ADMIN_STUCK_JOB_MINUTES || 30) * 60_000);
  const stuck = await prisma.generationJob.findMany({ where: { status: "active", updatedAt: { lt: stuckBefore } }, select: { id: true, projectId: true, progressStage: true, updatedAt: true }, take: 50 });
  for (const item of stuck) {
    await prisma.operationalEvent.create({ data: {
      service: "worker",
      severity: "critical",
      category: "stuck_job",
      operation: "generation",
      stage: item.progressStage,
      projectId: item.projectId,
      jobId: item.id,
      message: `Generation job has not advanced since ${item.updatedAt.toISOString()}`,
      fingerprint: `stuck-job:${item.id}`,
      occurredAt: now,
      expiresAt: new Date(now.getTime() + 90 * 86_400_000),
    } });
  }
  await evaluateAlerts(now);
}

async function refreshCbrRates(now: Date) {
  const prisma = getPrisma();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const exists = await prisma.exchangeRate.findFirst({ where: { provider: "cbr", effectiveAt: day } });
  if (exists) return;
  try {
    const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp");
    if (!response.ok) throw new Error(`CBR exchange rate failed: ${response.status}`);
    const xml = await response.text();
    for (const code of ["USD", "EUR"]) {
      const block = xml.match(new RegExp(`<CharCode>${code}<\\/CharCode>[\\s\\S]*?<Nominal>([^<]+)<\\/Nominal>[\\s\\S]*?<Value>([^<]+)<\\/Value>`));
      if (!block) continue;
      const nominal = Number(block[1].replace(",", "."));
      const value = Number(block[2].replace(",", "."));
      if (!nominal || !value) continue;
      await prisma.exchangeRate.upsert({
        where: { baseCurrency_quoteCurrency_effectiveAt: { baseCurrency: code, quoteCurrency: "RUB", effectiveAt: day } },
        update: { rate: String(value / nominal), fetchedAt: now, provider: "cbr" },
        create: { baseCurrency: code, quoteCurrency: "RUB", rate: String(value / nominal), provider: "cbr", effectiveAt: day, fetchedAt: now },
      });
    }
  } catch (error) {
    logger.warn({ ...errorLogFields(error) }, "exchange rates could not be refreshed; cached rates remain active");
  }
}

async function evaluateAlerts(now: Date) {
  if (process.env.DEPLOYMENT_ENV !== "production" || process.env.ADMIN_ALERTS_ENABLED !== "true") return;
  const token = process.env.ADMIN_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 15 * 60_000);
  const critical = await prisma.operationalEvent.findMany({ where: { severity: "critical", occurredAt: { gte: since }, category: { not: "alert_sent" } }, orderBy: { occurredAt: "desc" }, take: 5 });
  const unknown = await prisma.aiUsageEvent.count({ where: { status: { in: ["unknown_price", "unknown_usage"] }, createdAt: { gte: since } } });
  const messages = critical.map((item) => ({ fingerprint: item.fingerprint, text: `StudyDeck: ${item.category} (${item.service}) — ${item.message.slice(0, 220)}` }));
  if (unknown) messages.push({ fingerprint: "unknown-ai-accounting", text: `StudyDeck: ${unknown} AI-вызовов за 15 минут требуют сверки usage или цены.` });

  const threshold = Number(process.env.ADMIN_DAILY_COST_ALERT_RUB || 0);
  if (threshold > 0) {
    const dayStart = new Date(now.getTime() - 24 * 60 * 60_000);
    const [ai, other] = await Promise.all([
      prisma.aiUsageEvent.aggregate({ where: { createdAt: { gte: dayStart } }, _sum: { rubCostAtEvent: true } }),
      prisma.costEvent.aggregate({ where: { occurredAt: { gte: dayStart } }, _sum: { rubCostAtEvent: true } }),
    ]);
    const total = Number(ai._sum.rubCostAtEvent || 0) + Number(other._sum.rubCostAtEvent || 0);
    if (total >= threshold) messages.push({ fingerprint: `daily-cost:${now.toISOString().slice(0, 10)}`, text: `StudyDeck: расходы за 24 часа ${total.toFixed(2)} ₽ превысили порог ${threshold.toFixed(2)} ₽.` });
  }

  for (const message of messages) {
    const fingerprint = crypto.createHash("sha256").update(`telegram:${message.fingerprint}`).digest("hex");
    const duplicate = await prisma.operationalEvent.findFirst({ where: { category: "alert_sent", fingerprint, occurredAt: { gte: new Date(now.getTime() - 60 * 60_000) } } });
    if (duplicate) continue;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: message.text, disable_web_page_preview: true }) });
      if (!response.ok) throw new Error(`Telegram alert failed: ${response.status}`);
      await prisma.operationalEvent.create({ data: { service: "worker", severity: "info", category: "alert_sent", operation: "telegram", message: "Redacted administrative alert delivered", fingerprint, occurredAt: now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) } });
    } catch (error) {
      logger.warn({ ...errorLogFields(error) }, "administrative Telegram alert could not be delivered");
    }
  }
}
