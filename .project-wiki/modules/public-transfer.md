# Public Encrypted Transfer

## Purpose

Owns the password-protected EdgeOne relay at `/t`, including encrypted chunk lifecycle, administration, and cleanup. It is separate from [LAN transfer](./lan-transfer.md).

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/t/` | Public create/read/status UI. |
| `src/app/toolbox/transfer-tool.tsx` | Shared public relay UI and LAN mode switch. |
| `src/lib/transfer-crypto.ts` | Browser encryption/key derivation. |
| `src/lib/transfer-relay.ts` | Relay client flow. |
| `src/lib/transfer-chunks.ts` | Four-slot chunk scheduling, ordered receive backpressure, cancellation and bounded direct-request retries. |
| `src/lib/transfer-download-storage.ts` | Browser-private disk storage and temporary-file cleanup for large downloads. |
| `src/lib/transfer-stats.ts` | Merge paginated admin statistics and retain global largest objects. |
| `edge-functions/api/transfer/` | Create, complete, meta, open, received, stats, cleanup API. |
| `edge-functions/api/transfer/cleanup.js` | Bounded deletion pages shared by manual cleanup and the scheduled worker. |
| `cloud-functions/api/transfer-cleanup.js` | Node.js scheduled cleanup worker, independent of the Edge Fetch budget. |
| `edgeone.json` | Daily cleanup schedule. |

## Main Flow

Browser derives an AES-GCM key from the password, creates the chunk manifest and obtains upload URLs. Four browser workers each read, encrypt and upload a chunk directly to Blob; only a fully successful upload calls `complete`. Recipient sends only a derived proof; `open` returns one-time direct download URLs and a transfer-scoped receipt. The browser downloads/decrypts a window of four chunks and consumes them in manifest order. After decoding text or preparing a complete local file (closing OPFS when used), it submits the receipt to `received` across bounded requests to remove that transfer's ciphertext.

## Pay Attention

- The public-relay tab reveals a separate `/t/status` settings link on hover or keyboard focus; keep it visible on devices without hover. Reserve its space to avoid moving the adjacent LAN tab. The link must not be nested inside the mode button, and status navigation does not prefetch the admin route.
- Never send plaintext/password through the server; Blob bytes do not pass through Edge Function responses.
- Text/pasted images are capped at 4 MiB; regular files at 800 MiB with 4 MiB plaintext chunks (at most 200). Upload/download URLs last one hour; the daily transfer expiry still applies. Keep the browser and Edge Function size limits synchronized.
- Files above 200 MiB require OPFS writable storage. Check available browser quota and prepare the writer before calling the consume-on-open endpoint. Download/decrypt at most four unconsumed chunks; one consumer appends them in order and refills a slot only after its write completes. Slow early chunks or disk writes must not accumulate the entire file in memory. The plaintext window is at most 16 MiB, plus ciphertext/browser buffers. Smaller files still retain the completed file in memory.
- Chunk GET/PUT requests retry transient network/body-read errors and HTTP 408/429/5xx at most twice, with exponential backoff, jitter and Retry-After. A server cooldown above 30 seconds stops the transfer instead of retrying early. Retries reuse the same URL and upload ciphertext/IV; crypto/authentication failures and other 4xx responses are terminal. Never retry create/open or reopen a consumed code automatically.
- Both transfer directions share a UI operation guard, byte-weighted completed-chunk progress and explicit cancellation. A failed chunk aborts its peers; wait for all started reads/crypto/network work and any current write to settle before returning or disposing local storage. Leaving the UI aborts uploads as well as downloads, and prevents stale status/results from updating a later operation.
- Releasing a received file revokes its object URL and removes its temporary disk file. Failed/cancelled receives abort and remove the partial file; an already consumed code stays consumed. Partial uploads remain for normal Blob cleanup. A later large receive clears temporary files older than 24 hours after tab interruptions.
- Successful receives immediately remove server chunks through `received`, with at most 20 deletes per request and concurrency eight. Authenticate with the random receipt token issued only to the winning `open`; store only its SHA-256 hash and server-owned chunk count in `consumed.json`. Build keys from the validated transfer ID and stored count, never caller-supplied paths. Receipt pages are idempotent and reuse bounded transient-request retries; do not retry create/open. Retain the tiny consume-once marker until normal cleanup so an overlapping open cannot claim the transfer again. Decryption/storage failures never acknowledge receipt; cleanup failures preserve the usable local result and explicitly report deferred cleanup. Cancelling during cleanup releases local resources and stops subsequent pages; already accepted server deletes may finish.
- The free Blob account quota is 1 GB across stored objects, independent of the per-file limit. Interrupted uploads/receives and unsuccessful receipt cleanup can still occupy capacity until manual/scheduled cleanup. Native browser download completion is not observable: cleanup begins once all bytes are received, decrypted and available locally, independently of saving that local copy to the user's Downloads folder.
- Do not add a silent Next/Netlify fallback; `NEXT_PUBLIC_TRANSFER_API_BASE` is required.
- `complete` must not HEAD every chunk; missing objects surface at recipient download.
- Cleanup is daily 02:00 Asia/Shanghai; stats/manual cleanup require the protected admin-password hash.
- Manual cleanup always validates the admin password, including at 02:00, then deletes one Blob listing page of at most 20 objects with concurrency eight. The browser follows opaque cursors across independent requests and retains cumulative failures/progress. A failed/interrupted run must not be labeled complete; re-running starts at the remaining keys. Leaving the page stops further requests, but an already accepted delete batch may finish on the server.
- The daily schedule calls `/api/transfer-cleanup` in the Node.js Cloud Functions runtime, where one worker can drain deletion pages without the Edge runtime's 64-fetch limit. The worker retains the existing Beijing 02:00–02:59 scheduler access window; it uses the existing Blob deploy credential and store environment setting. `edgeone.json` allows 120 seconds; the worker stops starting new pages after 100 seconds and returns HTTP 503 with partial progress if interrupted or any deletion fails. Do not move its all-pages loop back into an Edge Function.
- Cleanup cursors are lexicographic object markers, not array offsets: deleting the previous page must not skip later keys. Both cleanup modes are restricted to `transfer/`; listings are live, so uploads concurrent with cleanup can also be removed.
- Access to an expired transfer invalidates only its four small indexes/markers and returns 410. Chunk deletion is deferred to manual/scheduled cleanup; never loop over an expired file's up to 200 chunks inside a normal Edge API request.
- Admin statistics use separate HTTP requests with Blob `list({ limit: 20, paginate: false, cursor })` and at most eight concurrent metadata reads. Do not scan all metadata in one Edge Function invocation: its Fetch API permits only 64 outgoing requests, including SDK credential exchange and listing. The UI's 0–200 limit controls displayed largest objects, not scan scope.
- The status client merges counts, known bytes, errors and the global largest objects across pages, shows scan progress and aborts on unmount. Only a finished scan without metadata errors may show a complete total; missing/invalid object sizes and interrupted scans must remain visibly incomplete. Blob listings are live rather than a transaction snapshot, so concurrent uploads/deletes can change results while scanning.
- Preserve manifest, PBKDF2, IV, and consume-on-open semantics.
