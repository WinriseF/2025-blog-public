---
id: DOCIN-20260825-001-REVIEW
type: intake-review
status: integrated
title: Review - Browser ZIP Compression Deep Research
created: 2026-08-25
updated: 2026-08-25
tags: [intake, review, toolbox, zip]
related: [DOCIN-20260825-001]
source_paths:
  - src/app/toolbox/zip/
  - src/lib/zip-packer.ts
  - src/app/toolbox/toolbox-client.tsx
  - .project-wiki/modules/toolbox.md
confidence: inferred
---

# Document Intake Review - Browser ZIP Compression Deep Research

## Review Outcome

On 2026-08-25, the user confirmed that ZIP packaging must be a standalone Toolbox feature because the output and primary workflow are specifically ZIP-oriented. The existing media compression route remains independent.

## Feasibility Finding

The feature is feasible as a browser-local ZIP archiver. The current `@zip.js/zip.js` release provides Zip64, incremental stream writing, Web Workers, AES encryption, cancellation, and external temporary streams. The primary large-output path can connect `File.stream()` to `ZipWriter` and then to a `FileSystemWritableFileStream`, avoiding an output-sized Blob in memory.

The main delivery risk is not ZIP encoding. It is capability-dependent input/output behavior, scalable tree selection, worker/WASM asset handling under the repository's Next.js/Turbopack build, and validating real multi-gigabyte behavior.

## Confirmed Product Boundary

- Add a standalone `/toolbox/zip` route and a separate Toolbox card named “ZIP Packaging”.
- Keep `/toolbox/compress` and its image/video behavior and naming unchanged.
- Present three archive presets: Smart (recommended), Maximum, and Store-only fast packaging.
- Make directory analysis and selection the main differentiator: virtualized tree, parent/child tri-state selection, search, selected totals, and reversible suggested exclusions.
- Target secure-context desktop Chrome/Edge and require native directory and save pickers.
- Do not promise cross-refresh ZIP resume in the first version.

## Proposed Technical Direction

- Use one archive engine in V1: `@zip.js/zip.js`. Use STORE or DEFLATE per file rather than adding `client-zip` as a second writer.
- Use native `showDirectoryPicker()` and `showSaveFilePicker()` when available; call them only from explicit user gestures.
- Write directly to `createWritable()` for large output. Do not route multi-gigabyte output through `Response(...).blob()`.
- Run compression codecs through zip.js workers and add entries sequentially to keep memory and task state bounded.
- Reuse `@tanstack/react-virtual`, but create an archive-specific tree model. The version-control tree is read-only and should not be coupled to local handles or selection aggregates.
- Keep initial enumeration light. Read file metadata through a bounded background queue so totals become accurate without issuing unbounded `getFile()` calls.
- Keep suggested exclusions separate from explicit user deselection so users can understand and override `.git`, `node_modules`, `.next`, `dist`, `target`, and similar rules.

## Recommended V1 Scope

1. Source selection and capability detection.
2. Virtualized directory tree with tri-state selection, search, and suggested exclusions.
3. Smart, Maximum, and Store-only presets.
4. Native streaming save, Zip64, bounded progress updates, cancellation, and cleanup.
5. Responsive staged navigation: source -> selection -> scheme -> progress on narrow screens; tree plus scheme summary on desktop.

AES password protection, StreamSaver, persistent handles, cross-refresh recovery, and a second ZIP engine should be postponed until the core streaming path has real benchmark evidence.

## Potential Conflicts With Current KB Or As-Is State

- A shared `/toolbox/compress` implementation would blur the boundary between media transcoding and ZIP container packaging; the confirmed standalone route avoids that conflict.
- The research report uses Vite-specific worker/WASM advice, while this repository uses Next.js 16 with Turbopack. Asset emission needs a focused integration spike rather than copying the Vite configuration.
- The report contains no completed 2 GiB or 50 GiB benchmark. Memory and throughput targets remain unverified.
- Supporting many fallback libraries in V1 would conflict with the repository preference for concise, maintainable code.

## Open Questions

| Question | Why It Matters | Suggested Default |
| --- | --- | --- |
| Must V1 support ZIP output outside desktop Chrome/Edge? | Native pickers keep the implementation small and guarantee direct output streaming. | No; the user confirmed Chrome/Edge as the compatibility target. |
| Is AES password protection required in V1? | It expands interoperability and error testing without improving the core selection flow. | Defer to V1.1. |
| Should mobile be a full large-directory target? | Mobile storage, picker behavior, and process lifetime are much less predictable. | Support the staged UI and small jobs, but label large jobs desktop-first. |
| What should the standalone user-facing label be? | The label should emphasize the ZIP result rather than generic compression. | Use “ZIP Packaging” and describe directory selection and local streaming output. |

## Validation Gate Before Release

- Prove zip.js worker and WASM assets load in the production Next.js/Turbopack output.
- Verify archive integrity with STORE, DEFLATE, Zip64, cancellation, Unicode paths, empty directories, and source files that change during a task.
- Run 50 MiB, 2 GiB, and synthetic 50 GiB scenarios on clean Chrome/Edge profiles; add Firefox/Safari coverage for supported fallback paths.
- Record process-tree peak memory, elapsed time, throughput, output size, worker count, temporary backend, and archive validation result.

## Implementation Outcome

The standalone route, Toolbox card, bounded directory scan, virtualized selection tree, three presets, direct writable stream, sequential zip.js writer, progress, cancellation, path validation, and source-change protection are implemented. V1 intentionally omits Blob/StreamSaver fallbacks, OPFS entry parallelism, password protection, resume, and alternate archive engines.

## Items Not Proposed For Canonical Integration

- The report's environment-specific clone/build commands and Vite scaffold.
- Unverified browser performance numbers or claims of constant memory usage.
- A mandatory StreamSaver dependency.
- `fflate` as the production Zip64 container writer.
- `client-zip` as a second V1 archive state machine.
