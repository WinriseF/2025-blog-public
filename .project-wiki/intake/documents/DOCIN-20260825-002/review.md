---
id: DOCIN-20260825-002-REVIEW
type: intake-review
status: integrated
title: Review - ZIP Packer Follow-up Review
created: 2026-08-25
updated: 2026-08-25
tags: [intake, review, toolbox, zip, performance]
related: [DOCIN-20260825-002, DOCIN-20260825-001]
source_paths:
  - src/lib/zip-packer.ts
  - src/app/toolbox/zip/zip-tool.tsx
  - src/app/toolbox/zip/zip-file-tree.tsx
  - .project-wiki/modules/toolbox.md
confidence: confirmed
---

# Document Intake Review - ZIP Packer Follow-up Review

## Review Outcome

The user accepted the confirmed exclusion, scanning, selection, stream, and CDN-preload fixes. Entry parallelism remains out of scope, and `BlobReader(file)` plus the Smart preset at level 6 remain unchanged.

## Verified Findings

- The suggested-exclusion predicate matches file names as well as directory names. A normal file named `build`, `dist`, or another default exclusion is initially deselected.
- Directory traversal still enters every suggested-excluded directory and performs bounded `getFile()` metadata reads for all files. The default exclusion only affects initial selection.
- Scan metadata progress calls the React state setter once per resolved file. ZIP writing already throttles visual progress.
- Each selection update derives tree states, selected entry IDs, and selected-file totals in separate whole-tree traversals. Toggling also clones the selection set and walks the toggled subtree.
- The output bridge is functionally valid but adds a stream wrapper between `ZipWriter` and the native file stream. zip.js accepts a `WritableStream` directly.
- Entry writing is deliberately sequential. Parallel `ZipWriter.add()` calls use whole-entry temporary buffering unless an external temporary stream is supplied.
- The pinned CDN runtime is imported only when writing begins. A background preload after scan completion can remove the first-click network wait without changing the application bundle.

## Canonical KB Updates

- Updated [`../../../modules/toolbox.md`](../../../modules/toolbox.md) with deferred directory scanning, direct native writable output, CDN preload timing, sequential-entry constraints, and retained compression defaults.

## Potential Conflicts With Current KB Or As-Is State

- The current Toolbox module intentionally describes sequential entry writing as the bounded-memory V1 design. Introducing entry parallelism without OPFS-backed temporary storage conflicts with that constraint.
- Lazy expansion of excluded directories is a tree-model and selection-semantics change, not a one-line scan shortcut. It needs a dedicated implementation and browser-level validation.

## Implementation Outcome

1. Default exclusion now matches directories only. Suggested-excluded directories retain a directory handle and hydrate on expansion; write preparation recursively hydrates every fully selected deferred branch.
2. Metadata progress is throttled. A single selection analysis derives both tri-state values and selected-file totals, while archive entry IDs are created only at write time.
3. The zip writer now receives the native `createWritable()` stream directly. The CDN runtime preloads after initial scan completion and silently retries on the real write path if preload failed.
4. Added `tests/zip-packer.test.ts` for directory-only exclusions, deferred reads, selection analysis, and initial selection behavior.
5. Sequential `ZipWriter.add()` calls, `BlobReader(file)`, and Smart level 6 were retained. No OPFS or entry-parallelism behavior was added.

## Items Not Proposed For Integration

- Treating parallel ZIP entries as an immediate low-risk optimization.
- Replacing `BlobReader(file)` without evidence of a streaming problem.
- Changing the Smart preset away from level 6.
- Claiming a fixed zip.js chunk size or a measured speed-up without a controlled benchmark.
