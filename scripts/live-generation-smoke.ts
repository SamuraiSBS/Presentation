import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

export const UTF8_JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const NARRATION_SMOKE_FLOW = ["create_project", "enqueue_narration", "poll_terminal"] as const;

type NarrationSmokeStep = (typeof NARRATION_SMOKE_FLOW)[number];
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface NarrationSmokeInput {
  title: string;
  prompt: string;
  apiUrl?: string;
  userId?: string;
  internalApiToken?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface NarrationSmokeSnapshot {
  projectId: string | null;
  generationJobId: string | null;
  queueJobId: string | null;
  projectStatus: string | null;
  jobStatus: string | null;
  stage: string;
}

export interface NarrationSmokeResult {
  outcome: "script_ready" | "failed";
  snapshot: NarrationSmokeSnapshot;
}

export interface NarrationSmokeDryRun {
  bodyContentType: string;
  hasCyrillic: boolean;
  hasReplacementQuestionMark: boolean;
  roundTripMatches: boolean;
  flow: readonly NarrationSmokeStep[];
  createCount: number;
  narrationEnqueueCount: number;
}

export type SafeNarrationSmokeReporter = (snapshot: NarrationSmokeSnapshot) => void;

export class NarrationSmokeError extends Error {
  constructor(
    readonly stage: string,
    readonly status: string,
    readonly snapshot?: NarrationSmokeSnapshot,
  ) {
    super("Narration smoke stopped safely.");
  }
}

function attachSnapshot(error: unknown, snapshot: NarrationSmokeSnapshot) {
  if (error instanceof NarrationSmokeError) {
    return error.snapshot ? error : new NarrationSmokeError(error.stage, error.status, snapshot);
  }
  return new NarrationSmokeError("unknown", "failed", snapshot);
}

function failureSnapshot(error: NarrationSmokeError): NarrationSmokeSnapshot {
  return {
    projectId: null,
    generationJobId: null,
    queueJobId: null,
    projectStatus: error.status,
    jobStatus: "not_started",
    stage: error.stage,
    ...error.snapshot,
  };
}

function requireNonEmpty(value: string | undefined, name: "title" | "prompt") {
  if (!value?.trim()) throw new NarrationSmokeError("input", `missing_${name}`);
  return value;
}

function normaliseApiUrl(apiUrl: string | undefined) {
  return (apiUrl || "http://localhost:4000/v1").replace(/\/$/, "");
}

function asRecord(value: unknown, stage: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NarrationSmokeError(stage, "invalid_response");
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, stage: string) {
  const field = value[key];
  if (typeof field !== "string" || !field) throw new NarrationSmokeError(stage, "invalid_response");
  return field;
}

function optionalStringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field ? field : null;
}

function projectRequest(input: NarrationSmokeInput) {
  return {
    title: requireNonEmpty(input.title, "title"),
    prompt: requireNonEmpty(input.prompt, "prompt"),
    scenario: "university_report",
    level: "university_student",
    mode: "with_sources",
    slideCount: 10,
  };
}

export function serializeUtf8Json(value: unknown) {
  const json = JSON.stringify(value);
  return {
    contentType: UTF8_JSON_CONTENT_TYPE,
    bytes: Buffer.from(json, "utf8"),
  };
}

export function buildNarrationSmokeDryRun(input: NarrationSmokeInput): NarrationSmokeDryRun {
  const request = projectRequest(input);
  const encoded = serializeUtf8Json(request);
  const decoded = JSON.parse(encoded.bytes.toString("utf8")) as typeof request;
  const compared = `${request.title}\n${request.prompt}`;

  return {
    bodyContentType: encoded.contentType,
    hasCyrillic: /[А-Яа-яЁё]/u.test(compared),
    hasReplacementQuestionMark: compared.includes("?"),
    roundTripMatches: decoded.title === request.title && decoded.prompt === request.prompt,
    flow: NARRATION_SMOKE_FLOW,
    createCount: NARRATION_SMOKE_FLOW.filter((step) => step === "create_project").length,
    narrationEnqueueCount: NARRATION_SMOKE_FLOW.filter((step) => step === "enqueue_narration").length,
  };
}

export function assertNarrationSmokeDryRun(input: NarrationSmokeInput) {
  const result = buildNarrationSmokeDryRun(input);
  if (
    result.bodyContentType !== UTF8_JSON_CONTENT_TYPE
    || !result.roundTripMatches
    || !result.hasCyrillic
    || result.hasReplacementQuestionMark
    || result.createCount !== 1
    || result.narrationEnqueueCount !== 1
    || result.flow.includes("accept" as NarrationSmokeStep)
    || result.flow.includes("export" as NarrationSmokeStep)
  ) {
    throw new NarrationSmokeError("dry_run", "invariant_failed");
  }
  return result;
}

async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit, stage: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new NarrationSmokeError(stage, "transport_error");
  }
  if (!response.ok) throw new NarrationSmokeError(stage, `http_${response.status}`);
  try {
    return asRecord(await response.json(), stage);
  } catch (error) {
    if (error instanceof NarrationSmokeError) throw error;
    throw new NarrationSmokeError(stage, "invalid_response");
  }
}

function narrationJobSnapshot(project: Record<string, unknown>, fallback: NarrationSmokeSnapshot): NarrationSmokeSnapshot {
  const jobs = project.jobs;
  const job = Array.isArray(jobs) && jobs[0] && typeof jobs[0] === "object" && !Array.isArray(jobs[0])
    ? jobs[0] as Record<string, unknown>
    : null;

  return {
    ...fallback,
    projectStatus: optionalStringField(project, "status") || fallback.projectStatus,
    generationJobId: job ? optionalStringField(job, "id") || fallback.generationJobId : fallback.generationJobId,
    queueJobId: job ? optionalStringField(job, "queueJobId") || fallback.queueJobId : fallback.queueJobId,
    jobStatus: job ? optionalStringField(job, "status") || fallback.jobStatus : fallback.jobStatus,
    stage: job ? optionalStringField(job, "progressStage") || fallback.stage : fallback.stage,
  };
}

export async function runNarrationSmoke(
  input: NarrationSmokeInput,
  options: {
    fetchImpl?: FetchLike;
    sleep?: (milliseconds: number) => Promise<void>;
    onSnapshot?: (snapshot: NarrationSmokeSnapshot) => void;
  } = {},
): Promise<NarrationSmokeResult> {
  const title = requireNonEmpty(input.title, "title");
  const prompt = requireNonEmpty(input.prompt, "prompt");
  if (!input.userId) throw new NarrationSmokeError("configuration", "missing_user_id");
  if (!input.internalApiToken) throw new NarrationSmokeError("configuration", "missing_internal_api_token");

  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = input.timeoutMs ?? 12 * 60 * 1000;
  const pollIntervalMs = input.pollIntervalMs ?? 3000;
  const apiUrl = normaliseApiUrl(input.apiUrl);
  const headers = { "x-user-id": input.userId, "x-internal-token": input.internalApiToken };
  const body = serializeUtf8Json({ title, prompt, scenario: "university_report", level: "university_student", mode: "with_sources", slideCount: 10 });
  let snapshot: NarrationSmokeSnapshot = {
    projectId: null,
    generationJobId: null,
    queueJobId: null,
    projectStatus: null,
    jobStatus: null,
    stage: "project_create",
  };
  let created: Record<string, unknown>;
  try {
    created = await fetchJson(fetchImpl, `${apiUrl}/projects`, {
      method: "POST",
      headers: { ...headers, "content-type": body.contentType },
      body: body.bytes,
    }, "project_create");
  } catch (error) {
    throw attachSnapshot(error, snapshot);
  }
  const projectId = stringField(created, "id", "project_create");
  snapshot = {
    projectId,
    generationJobId: null,
    queueJobId: null,
    projectStatus: optionalStringField(created, "status") || "created",
    jobStatus: null,
    stage: "project_create",
  };
  options.onSnapshot?.(snapshot);

  snapshot = { ...snapshot, stage: "narration_enqueue" };
  let enqueued: Record<string, unknown>;
  try {
    enqueued = await fetchJson(fetchImpl, `${apiUrl}/projects/${encodeURIComponent(projectId)}/narration`, {
      method: "POST",
      headers,
    }, "narration_enqueue");
  } catch (error) {
    throw attachSnapshot(error, snapshot);
  }
  snapshot = {
    ...snapshot,
    generationJobId: stringField(enqueued, "jobId", "narration_enqueue"),
    queueJobId: stringField(enqueued, "queueJobId", "narration_enqueue"),
    projectStatus: optionalStringField(enqueued, "status") || "script_queued",
    jobStatus: "queued",
    stage: "narration_enqueue",
  };
  options.onSnapshot?.(snapshot);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    await sleep(pollIntervalMs);
    let current: Record<string, unknown>;
    try {
      current = await fetchJson(fetchImpl, `${apiUrl}/projects/${encodeURIComponent(projectId)}`, { headers }, "narration_poll");
    } catch (error) {
      throw attachSnapshot(error, snapshot);
    }
    snapshot = narrationJobSnapshot(current, snapshot);
    options.onSnapshot?.(snapshot);
    if (snapshot.projectStatus === "script_ready") return { outcome: "script_ready", snapshot };
    if (snapshot.projectStatus === "failed" || snapshot.jobStatus === "failed") return { outcome: "failed", snapshot };
  }
  throw new NarrationSmokeError("narration_poll", "timeout", snapshot);
}

function parseArguments(args: string[], environment: NodeJS.ProcessEnv) {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!argument?.startsWith("--")) throw new NarrationSmokeError("input", "invalid_argument");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new NarrationSmokeError("input", "missing_argument_value");
    values.set(argument, value);
    index += 1;
  }
  const prompt = values.get("--prompt") || environment.SMOKE_PROMPT;
  const topic = values.get("--topic") || environment.SMOKE_TOPIC;
  if (prompt && topic) throw new NarrationSmokeError("input", "ambiguous_prompt");
  return {
    dryRun,
    input: {
      title: values.get("--title") || environment.SMOKE_TITLE || "",
      prompt: prompt || topic || "",
      apiUrl: values.get("--api-url"),
      userId: values.get("--user-id") || environment.TEMP_USER_ID,
      internalApiToken: environment.INTERNAL_API_TOKEN,
    },
  } satisfies { dryRun: boolean; input: NarrationSmokeInput };
}

export function printSafeSnapshot(snapshot: NarrationSmokeSnapshot) {
  console.log([
    `project_id=${snapshot.projectId || "none"}`,
    `generation_job_id=${snapshot.generationJobId || "none"}`,
    `queue_job_id=${snapshot.queueJobId || "none"}`,
    `project_status=${snapshot.projectStatus || "unknown"}`,
    `job_status=${snapshot.jobStatus || "unknown"}`,
    `stage=${snapshot.stage}`,
  ].join(" "));
}

export async function executeNarrationSmokeCli({
  args = process.argv.slice(2),
  environment = process.env,
  reporter = printSafeSnapshot,
  runSmoke = runNarrationSmoke,
}: {
  args?: string[];
  environment?: NodeJS.ProcessEnv;
  reporter?: SafeNarrationSmokeReporter;
  runSmoke?: (input: NarrationSmokeInput) => Promise<NarrationSmokeResult>;
} = {}): Promise<0 | 1> {
  try {
    const { dryRun, input } = parseArguments(args, environment);
    if (dryRun) {
      assertNarrationSmokeDryRun(input);
      reporter({ projectId: null, generationJobId: null, queueJobId: null, projectStatus: "dry_run", jobStatus: "not_started", stage: "dry_run" });
      return 0;
    }
    if (environment.RUN_LIVE_GENERATION_SMOKE !== "true") {
      throw new NarrationSmokeError("configuration", "live_smoke_not_authorized");
    }
    const result = await runSmoke(input);
    reporter(result.snapshot);
    return result.outcome === "script_ready" ? 0 : 1;
  } catch (error) {
    const safeError = error instanceof NarrationSmokeError ? error : new NarrationSmokeError("unknown", "failed");
    reporter(failureSnapshot(safeError));
    return 1;
  }
}

async function main() {
  process.exitCode = await executeNarrationSmokeCli();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
