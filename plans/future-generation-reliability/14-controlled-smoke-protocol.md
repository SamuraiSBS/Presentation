# Controlled Yandex narration duration smoke

This is an operator-only protocol for the next paid smoke after deterministic checks. It does not enable an automatic experiment or alter a normal user generation.

## Fixed source context

Create each isolated smoke project in the same non-`with_sources` mode, with the same title-independent prompt, scenario, level, and slide count. Upload the same small prepared text fixture to each project and keep it included. This makes `prepareGenerationSources(...)` reuse that stored source and prevents a Tavily search: a non-`with_sources` project with an included fixture does not meet its web-refresh condition. Do not use two independent WEB searches.

Record the fixture label, source ID, and excerpt hash before the first job. Do not change the source set between baseline and candidate.

## One-job baseline smoke

Only after explicit user permission, run at most one new 10-slide `university_student` narration job without `YANDEX_NARRATION_MODEL_NAME` or `YANDEX_NARRATION_MODEL_URI`. Confirm the worker is configured with `AI_PROVIDER=yandex`, `ALLOW_DEMO_GENERATION=false`, and an empty `OPENAI_API_KEY`. Record the resolved model, fixed source context, Yandex text-call count, input/output tokens, latency, RUB cost, job/project status, public error if any, accepted word count, estimated duration, and spoken-issue count.

Do not retry the job. A valid 1170-1560-word narration that clears the existing gates is accepted; any other outcome is reported as the existing safe public failure with the same telemetry.

## Candidate comparison

Run a candidate only after separate explicit permission for a second paid job. Start a worker with an explicit narration override only for that isolated job, then restore the baseline environment. Keep the prompt, scenario, level, mode, slide count, and fixture source unchanged. Promotion remains manual and requires the candidate to pass all quality gates, use no more than one full duration rewrite, and have understandable latency and cost.
