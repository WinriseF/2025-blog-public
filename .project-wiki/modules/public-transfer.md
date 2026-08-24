# Public Encrypted Transfer

## Purpose

Owns the password-protected EdgeOne relay at `/t`, including encrypted chunk lifecycle, administration, and cleanup. It is separate from [LAN transfer](./lan-transfer.md).

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/t/` | Public create/read/status UI. |
| `src/lib/transfer-crypto.ts` | Browser encryption/key derivation. |
| `src/lib/transfer-relay.ts` | Relay client flow. |
| `edge-functions/api/transfer/` | Create, complete, meta, open, stats, cleanup API. |
| `edgeone.json` | Daily cleanup schedule. |

## Main Flow

Browser derives AES-GCM key from password, encrypts chunks, asks EdgeOne for upload URLs, uploads directly to Blob, then marks the manifest ready. Recipient sends only a derived proof; `open` returns one-time direct download URLs and the browser decrypts locally.

## Pay Attention

- Never send plaintext/password through the server; Blob bytes do not pass through Edge Function responses.
- Text/pasted images are capped at 4 MiB; regular files at 200 MiB with 4 MiB plaintext chunks.
- Do not add a silent Next/Netlify fallback; `NEXT_PUBLIC_TRANSFER_API_BASE` is required.
- `complete` must not HEAD every chunk; missing objects surface at recipient download.
- Cleanup is daily 02:00 Asia/Shanghai; stats/manual cleanup require the protected admin-password hash.
- Preserve manifest, PBKDF2, IV, and consume-on-open semantics.
