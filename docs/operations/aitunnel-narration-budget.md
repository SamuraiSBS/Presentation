# AITUNNEL Gemini narration budget

This policy applies only to new AITUNNEL `gemini-3.6-flash` narration text calls. It does not change structured generation, images, Tavily, TTS, export, or other providers.

- The application sends no narration request whose local worst-case reservation does not fit within `AITUNNEL_NARRATION_JOB_BUDGET_RUB` (default: 20 RUB).
- Each request reserves conservative UTF-8 serialized-input tokens plus the whole `AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS` cap (default: 2400). Gemini billable reasoning is included in the output reservation.
- A valid initial narration uses one call. A failed quality check can use one fresh full rewrite only if its own reservation fits the remaining budget. Narration jobs have one BullMQ attempt.
- Missing usage stops the job as `narration_usage_unavailable`; actual cost above the reservation stops it as `narration_budget_overrun`. Neither condition sends a rewrite.
- This is an application reservation cap with provider-overrun fail-stop. It cannot prove that AITUNNEL or Google will never bill above `max_output_tokens`, particularly because Gemini 3 maps thinking controls to Google-managed thinking levels.

`reasoning: { effort: "minimal", exclude: true }` is sent through AITUNNEL's documented Responses API. Excluding reasoning removes content from the response; it is not a cost control.

For external defence in depth, use a separate worker AITUNNEL API key and configure the lowest available key-level or daily spend limit at AITUNNEL. This is a manual operator control, not a substitute for the per-job application cap.
