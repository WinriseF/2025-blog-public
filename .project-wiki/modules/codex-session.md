# Codex Session Audit

## Purpose

Parses user-selected Codex rollout JSONL files in the browser and shows command, file, patch, token, request activity, tool usage, and timeline evidence without uploading or executing session content.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/toolbox/codex-session/` | Selection, dashboard, timeline, detail UI, compression waterfall/log, patch modal. |
| `src/lib/codex-session/` | Worker protocol, JSONL parser, evidence, Shell analysis, Token aggregation. |
| `activity-analysis.ts` | Request boundaries, generic tool normalization, duration evidence, reasoning/tool ratios. |
| `tool-record.ts` | Shared tool call/result normalization and async continuation correlation. |
| `session-compression.ts` | Shared compression rule catalog, scan statistics, and record transforms. |
| `parser.worker.ts` | Off-main-thread detail parser. |
| `public/wasm/codex-session/` | Browser Shell grammars. |
| `tests/codex-session/` | Focused Vitest fixtures/tests. |

## Main Flow

Selected Files go to a Worker. One file produces detail audit; multiple files produce lightweight collection summaries and reparse a selected in-memory File on demand. Evidence uses recorded rollout events only; Shell and `custom_tool_call(exec)` syntax is statically analyzed, never executed. The Commands view can export every recorded AI execution batch as concise ordered plain text containing only the raw commands; exports always cover the complete Session rather than the current key-command filter.

The detail view exposes a single-Session `Compression` tab after `Token`. Opening it rescans the selected File in the existing Worker. The upper visualization is a compact DevTools-Network-style waterfall: turns divide the horizontal sequence and colored bars occupy Input/Context, Model, Tools, and Event lanes. Clicking a bar locates its source record. Below it, the complete Session is a flat chronological log with turn separators; every JSONL line has a type badge, preview, timestamp, source line, byte size, and all concrete crop actions that apply to it. Actions are record-local with no parent cascade; dropping a record is mutually exclusive with its field-level rewrites. User/assistant/tool records default to kept, while reasoning and confirmed low-information actions default to cropped. The downloaded `.audit-compact.jsonl` preserves invalid and unchanged source lines through original `File.slice` parts, serializes only rewritten records, and adds an ignored `audit_compaction_meta` record.

`token_count` samples close request activity segments. The Activity view renders request and logical-tool timing evidence in a Network-style waterfall; the readable main window is controlled by a shared minimap brush that supports panning and handle-based zoom while preserving the complete Session overview. Model steps retain their real time spans and use non-scaling start dividers in both views, so adjacent same-color reasoning steps remain distinguishable at every zoom level. Turn boundaries remain visible, and tool bars open the existing detail panel. The Compression waterfall reuses the same brush interaction for raw-record navigation. The collection Token chart uses the same interaction model: drag either grip to resize the date range or drag the selected body to pan it without changing its span. Reasoning share is `reasoning_output_tokens / output_tokens`; reasoning is an Output subset and must not be stacked on top of Output. Generic tool analysis keeps direct calls, built-in Web/Tool Search, MCP/exec/patch end events, and decoded `tools.*` calls. A decoded outer `exec` is an execution batch rather than another logical tool call.

Tool wall time uses recorded duration first, then a runtime-reported wall time, then correlated call/result timestamps. `wait`, `poll`, and `write_stdin` continuations inherit the original execution through `session_id` / `cell_id`; their final status and timestamp close the original interval. Parallel intervals are unioned before calculating a share. Detail views compare this union with full turn time, while filtered collections compare it with the same selected model-step spans so numerator and denominator always share date/project/model filters. The remaining observed time is labeled non-tool time because rollout evidence cannot prove that all of it is model reasoning.

## Pay Attention

- Never scan `.codex`, upload files, execute extracted commands, or access paths merely named inside a rollout.
- Compression is local and single-Session. Its output is for audit re-import, not guaranteed Codex resume; selected content is irreversible.
- Removing reasoning records must retain `token_count.reasoning_output_tokens`, so reasoning ratios remain available after re-import.
- Keep tool result envelopes, `call_id`, continuation IDs, status, timing, token samples, and patch evidence unless the user explicitly selects a lossy rule.
- Batch parsing must stay sequential/lightweight; its activity path keeps only compact call state and per-token-sample counters, while detail parsing owns tool/source objects, output, patches, categories, and AST work.
- Batch activity summaries must not decode `exec` AST. They may count the outer batch for request/tool presence; detail parsing owns logical inner-call counts.
- Normalize call IDs, inputs, explicit result status, and continuation identifiers through `tool-record.ts`; ambiguous or missing success must remain unknown, never guessed.
- Read-file evidence only comes from explicit reads; search output never becomes file evidence. Changed files only come from successful patches.
- Token totals use recorded `token_count`; no tokenizer/cost fallback exists.
- Compact overview cards use K/M abbreviations for large Token totals; exact values remain available in titles and detailed views.
- Ambiguous overview metrics use the user-facing term "model step" for a valid `token_count` sample and expose keyboard-, hover-, and tap-accessible help text through `MetricHelp`; do not call these samples user requests.
- Prefer recorded `task_complete.duration_ms` and `time_to_first_token_ms`; use timestamp correlation only when direct fields are absent.
- Keep the throwing browser Node stubs and Worker WASM setup; no whole-file main-thread fallback.
