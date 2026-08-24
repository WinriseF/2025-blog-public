# Codex Session Audit

## Purpose

Parses user-selected Codex rollout JSONL files in the browser and shows command, file, patch, token, and timeline evidence without uploading or executing session content.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/toolbox/codex-session/` | Selection, dashboard, timeline, detail UI, patch modal. |
| `src/lib/codex-session/` | Worker protocol, JSONL parser, evidence, Shell analysis, Token aggregation. |
| `parser.worker.ts` | Off-main-thread detail parser. |
| `public/wasm/codex-session/` | Browser Shell grammars. |
| `tests/codex-session/` | Focused Vitest fixtures/tests. |

## Main Flow

Selected Files go to a Worker. One file produces detail audit; multiple files produce lightweight collection summaries and reparse a selected in-memory File on demand. Evidence uses recorded rollout events only; Shell syntax is statically analyzed, never executed.

## Pay Attention

- Never scan `.codex`, upload files, execute extracted commands, or access paths merely named inside a rollout.
- Batch parsing must stay sequential/lightweight; detail parsing owns output, patches, and AST work.
- Correlate by `call_id`; ambiguous or missing success must remain unknown, never guessed.
- Read-file evidence only comes from explicit reads; search output never becomes file evidence. Changed files only come from successful patches.
- Token totals use recorded `token_count`; no tokenizer/cost fallback exists.
- Keep the throwing browser Node stubs and Worker WASM setup; no whole-file main-thread fallback.
