# Codex Session Audit

## Purpose

Parses user-selected Codex rollout JSONL files in the browser and shows command, file, patch, token, request activity, tool usage, and timeline evidence without uploading or executing session content.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/toolbox/codex-session/` | Selection, dashboard, timeline, detail UI, patch modal. |
| `src/lib/codex-session/` | Worker protocol, JSONL parser, evidence, Shell analysis, Token aggregation. |
| `activity-analysis.ts` | Request boundaries, generic tool normalization, duration evidence, reasoning/tool ratios. |
| `tool-record.ts` | Shared tool call/result normalization and async continuation correlation. |
| `parser.worker.ts` | Off-main-thread detail parser. |
| `public/wasm/codex-session/` | Browser Shell grammars. |
| `tests/codex-session/` | Focused Vitest fixtures/tests. |

## Main Flow

Selected Files go to a Worker. One file produces detail audit; multiple files produce lightweight collection summaries and reparse a selected in-memory File on demand. Evidence uses recorded rollout events only; Shell and `custom_tool_call(exec)` syntax is statically analyzed, never executed.

`token_count` samples close request activity segments. Reasoning share is `reasoning_output_tokens / output_tokens`; reasoning is an Output subset and must not be stacked on top of Output. Generic tool analysis keeps direct calls, built-in Web/Tool Search, MCP/exec/patch end events, and decoded `tools.*` calls. A decoded outer `exec` is an execution batch rather than another logical tool call.

Tool wall time uses recorded duration first, then a runtime-reported wall time, then correlated call/result timestamps. `wait`, `poll`, and `write_stdin` continuations inherit the original execution through `session_id` / `cell_id`; their final status and timestamp close the original interval. Parallel intervals are unioned before calculating a share. Detail views compare this union with full turn time, while filtered collections compare it with the same selected model-step spans so numerator and denominator always share date/project/model filters. The remaining observed time is labeled non-tool time because rollout evidence cannot prove that all of it is model reasoning.

## Pay Attention

- Never scan `.codex`, upload files, execute extracted commands, or access paths merely named inside a rollout.
- Batch parsing must stay sequential/lightweight; its activity path keeps only compact call state and per-token-sample counters, while detail parsing owns tool/source objects, output, patches, categories, and AST work.
- Batch activity summaries must not decode `exec` AST. They may count the outer batch for request/tool presence; detail parsing owns logical inner-call counts.
- Normalize call IDs, inputs, explicit result status, and continuation identifiers through `tool-record.ts`; ambiguous or missing success must remain unknown, never guessed.
- Read-file evidence only comes from explicit reads; search output never becomes file evidence. Changed files only come from successful patches.
- Token totals use recorded `token_count`; no tokenizer/cost fallback exists.
- Compact overview cards use K/M abbreviations for large Token totals; exact values remain available in titles and detailed views.
- Ambiguous overview metrics use the user-facing term "model step" for a valid `token_count` sample and expose keyboard-, hover-, and tap-accessible help text through `MetricHelp`; do not call these samples user requests.
- Prefer recorded `task_complete.duration_ms` and `time_to_first_token_ms`; use timestamp correlation only when direct fields are absent.
- Keep the throwing browser Node stubs and Worker WASM setup; no whole-file main-thread fallback.
