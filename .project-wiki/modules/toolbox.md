# Browser Toolbox And Agent Center

## Purpose

Groups browser-first tools and the portable Toolbox Agent capability center. Files/secrets remain local unless the documented feature needs a CDN, Edge service, or native Agent.

## Key Paths

| Area | Paths |
| --- | --- |
| Compression | `src/app/toolbox/compress/`, `src/lib/video-compress/` |
| ZIP packaging | `src/app/toolbox/zip/`, `src/lib/zip-packer.ts`, `tests/zip-packer.test.ts` |
| Markdown preview | `src/app/toolbox/markdown/` |
| Passwords | `password-generator-tool.tsx`, `src/lib/password-generator.ts` |
| Face masking | `face-mask-*`, `src/lib/face-mask/` |
| OCR | `ocr-*`, `src/lib/ocr/` |
| Shared preview | `src/components/image-preview-dialog.tsx` |
| Agent center | `src/app/toolbox/agent/` |

## Main Flow

Compression and OCR use Workers; face masking uses local Canvas; password generation uses browser cryptography; Markdown preview is local. The Agent center reports portable protocol-registration results and links to LAN/native acceleration and version control.

The standalone `/toolbox/zip` packer is separate from media compression. Chrome/Edge users select one directory or multiple files, filter a virtualized tri-state tree, choose Smart, Maximum, or Store-only packaging, then optionally customize the compression level (0–9) and whether already-compressed files are stored directly. The archive streams directly to a user-selected file. `zip-packer.ts` owns bounded metadata scanning, suggested exclusions, selection derivation, safe paths, source-change checks, progress, cancellation, and the `zip.js` writer. Default exclusions apply only to directories: those branches keep their handles but defer recursive enumeration and metadata reads until the user expands or selects them. A directory or file that the File System Access API cannot actually read is removed from the pending archive, recorded, and does not stop its readable siblings; the completed ZIP reports those skipped paths. The directory row, apart from its checkbox, also expands or collapses the branch. Selection totals intentionally describe only loaded nodes while deferred branches are present.

## Pay Attention

- Video compression is Chromium desktop-first and must stream reads/writes; do not switch to whole-file buffers/Blobs/WASM filesystem.
- Keep ZIP packaging separate from image/video compression. It intentionally targets secure-context desktop Chrome/Edge and requires native directory/save pickers; do not add Blob, StreamSaver, password, resume, or alternate archive engines without a confirmed scope change.
- ZIP entries are written sequentially to keep memory and state bounded. The pinned CDN module `@zip.js/zip.js@2.8.59/index-native.min.js` preloads after the initial scan, supplies incremental `BlobReader` input and the codec Worker, and must stay outside the application bundle. It requires access to `cdn.jsdelivr.net`, but selected file contents are never uploaded; pass the native `createWritable()` stream directly to zip.js. Do not introduce entry parallelism without OPFS-backed temporary streams and benchmark evidence.
- Keep `BlobReader(file)` and the Smart preset at level 6. Directory metadata progress is throttled, while selection state and selected-file totals are derived together; ZIP entry IDs are computed only when writing starts.
- Never use a path-length threshold for ZIP exclusions. Preserve `AbortError`, output-stream failures, compression failures, and source-change checks as task failures; only per-entry File System Access read failures are automatically skipped.
- Keep the ZIP UI surface intentionally small: only compression level and the skip-already-compressed policy are adjustable. ZIP64, Workers, streaming, metadata, encryption, split archives, and custom codecs remain automatic or out of scope.
- OCR/model resources load only on explicit recognition. Keep external-WASM ONNX alias; default bundle exceeds Netlify file limits.
- Face/OCR/password data stays browser-local. Clipboard and File System Access require user gestures.
- Password wordlists are fetched lazily and integrity-checked; offline modes must still work if fetch fails.
- Agent center is not proof of a resident process. Native callback ownership stays with LAN/version-control routes.
- Shared image preview behavior is used by articles, LAN, OCR, and repository view; keep it consistent.
