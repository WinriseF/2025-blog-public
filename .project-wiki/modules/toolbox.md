# Browser Toolbox And Agent Center

## Purpose

Groups browser-first tools and the portable Toolbox Agent capability center. Files/secrets remain local unless the documented feature needs a CDN, Edge service, or native Agent.

## Key Paths

| Area | Paths |
| --- | --- |
| Compression | `src/app/toolbox/compress/`, `src/lib/video-compress/` |
| Markdown preview | `src/app/toolbox/markdown/` |
| Passwords | `password-generator-tool.tsx`, `src/lib/password-generator.ts` |
| Face masking | `face-mask-*`, `src/lib/face-mask/` |
| OCR | `ocr-*`, `src/lib/ocr/` |
| Shared preview | `src/components/image-preview-dialog.tsx` |
| Agent center | `src/app/toolbox/agent/` |

## Main Flow

Compression and OCR use Workers; face masking uses local Canvas; password generation uses browser cryptography; Markdown preview is local. The Agent center reports portable protocol-registration results and links to LAN/native acceleration and version control.

## Pay Attention

- Video compression is Chromium desktop-first and must stream reads/writes; do not switch to whole-file buffers/Blobs/WASM filesystem.
- OCR/model resources load only on explicit recognition. Keep external-WASM ONNX alias; default bundle exceeds Netlify file limits.
- Face/OCR/password data stays browser-local. Clipboard and File System Access require user gestures.
- Password wordlists are fetched lazily and integrity-checked; offline modes must still work if fetch fails.
- Agent center is not proof of a resident process. Native callback ownership stays with LAN/version-control routes.
- Shared image preview behavior is used by articles, LAN, OCR, and repository view; keep it consistent.
