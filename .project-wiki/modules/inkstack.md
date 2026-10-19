# InkStack / 墨栈

## Purpose and boundaries

InkStack is the private text workspace at `/home`, integrated into Blog's Next.js
frontend. Its separate native Go PocketBase backend lives in `2025-blog-pb` and
serves `https://pb.winrisef.top`; `NEXT_PUBLIC_POCKETBASE_URL` overrides this URL.
No note plaintext, encryption passphrase, recovery key or data key goes through
Next.js server handlers or PocketBase. PB user authentication remains separate
from unlocking encrypted notes.

Read the backend's `docs/DEVELOPMENT_RULES.md` and `STACK_API.md` when changing the
protocol. Toolchains, dependency installation and project execution use Docker;
do not install host runtimes. Keep code small, remove replaced implementations,
and do not add historical compatibility branches. Frontend AGENTS.md separately
requires explicit authorization before verification commands are run.

## Source map

| Paths | Responsibility |
| --- | --- |
| `src/app/home/stack-login.tsx`, `stack-login.module.css` | Existing auth layout, shared theme surface, session-to-workspace boundary. |
| `src/lib/stack/use-stack-auth.ts`, `pocketbase.ts` | PB users auth, email-code signup, bootstrap and account-change notifications. |
| `src/app/home/vault-gate.tsx` | Initial setup, recovery-key acknowledgement, unlock and keyring replacement. |
| `src/lib/stack/crypto.ts`, `types.ts` | Browser Argon2id/AES-GCM and the current encrypted Markdown payload. |
| `src/lib/stack/api.ts` | Owner-bound session requests and concise error messages. |
| `src/lib/stack/workspace.ts` | One unlocked session, serialized writes/sync, exact retries, conflicts and disposal. |
| `src/app/home/stack-workspace.tsx`, `stack-workspace.module.css` | Responsive three-pane navigation/list/editor, search, favorites, tags, trash and export. |
| `src/app/home/note-list.tsx` | Native-scrolling virtual rows, cached row rendering and keyboard navigation. |
| `src/app/home/note-preview.tsx` | Sanitized Markdown preview without embedded resources. |
| `src/app/home/stack-settings.tsx`, `stack-dialog.tsx` | Read-only API Key management and encryption settings in a native modal dialog. |
| `tests/stack/` | Crypto interoperability/tamper/size cases and persistence race/retry/conflict cases. |
| `scripts/stack-dev.ps1`, `stack-tasks.sh` | Docker dependency/check/preview tasks, isolated Linux modules and Next output. |

## Design

Keep the existing four themes and pen identity. Consume the root
`TimeThemeProvider`; do not add an InkStack theme picker, timer or preference.
The four supplied CDN backgrounds remain in the sibling image repository at
`images/project/mo-stack/login-backgrounds/{dawn,noon,sunset,night}.png`.

Auth uses a single-column card capped at 400px, with the pen brand and current
screen title sharing one header row. Inputs and primary buttons are 44px high;
secondary sign-in actions use lighter styling. Shared spacing covers login,
signup and unlock; small screens reduce card padding without enlarging titles.

Desktop uses compact navigation, a searchable note list, and a spacious editor.
Tablet hides the navigation rail; mobile switches between list and editor.
Lists virtualize visible rows with five overscan rows and native continuous scrolling.
Search/filter results are deferred so editor input takes priority. Preview snippets
process only a bounded prefix; unchanged row objects avoid repeated rendering.
The virtual-list component opts out of compiler inference for its mutable
virtualizer instance and uses explicit memoization for props/row keys.
An empty account shows a real empty state; do not insert demo notes into accounts.

Visible copy is limited to functional titles, field labels, brief empty states
and operation feedback. Do not add slogans, decorative English captions or
repeated privacy/encryption badges to auth, unlock or workspace screens. Empty
notes have no generated preview text; an empty tag list has no sidebar section.
Keep recovery-key acknowledgement, key-exposure warnings and destructive-action,
conflict and unsaved-work messages at their relevant actions. Feedback regions
stay mounted for accessibility but reserve space only when they contain text.

The information layout draws on [Notion's sidebar guidance](https://www.notion.com/help/navigate-with-the-sidebar)
and [AFFiNE's navigation/favorites update](https://affine.pro/blog/whats-new-affine-dec-update).
Their source or visual assets are not copied. This first implementation uses a
Markdown text editor, matching InkStack's text/AI direction; BlockSuite remains
an unimplemented future editor option, not a parallel runtime.

## Authentication and encryption flow

1. Keep native password, GitHub and Google OAuth. Email signup sends a challenge,
   verifies its six-digit code through the custom API, then performs PB login.
   Never replace this with public `users.create()`.
2. Bootstrap validates the current protocol and required capabilities. Only
   `empty` opens setup; `active` opens unlock; `deleting` displays pending cleanup
   and polls while visible. An old backend shows an explicit upgrade error.
3. Generate separate random 32-byte data/recovery keys. Derive the wrapping key
   with `hash-wasm` Argon2id (64 MiB, 3 iterations, parallelism 1, output 32).
   AES-256-GCM uses a fresh random 12-byte nonce, 16-byte tag and exact v1 AAD.
4. Show the recovery key as naturally wrapping, selectable read-only text in a
   compact panel; do not reserve extra rows with a fixed-height textarea.
   Copy only the raw key, with inline success or manual-copy error feedback.
   Require explicit save acknowledgement before setup/rewrap; copying alone
   does not acknowledge storage. Verify both wrappers locally before submitting.
   Uncertain setup/rewrap delivery is resolved by comparing both wrappers from
   a fresh bootstrap.
5. Unlock with the independent passphrase or recovery key. Rewrapping preserves
   the data key and replaces both wrappers/recovery key. It does not revoke a
   previously exported data key.

The encrypted JSON is exactly
`{schema:1, kind:"note", format:"markdown", folder_id:string|null, attachments:Attachment[], title, body, tags:string[], favorite:boolean, trashed:boolean}`.
The browser validates the shape and protocol; malformed/unsupported records stop
cursor advancement rather than being silently discarded. All organization data
is encrypted with the note. The server continues to treat the payload as opaque.

Base64 decoding returns an ordinary ArrayBuffer-backed view, matching the native
WebCrypto buffer contract without type assertions or an extra decoding copy.

Key and plaintext ownership is limited to the unlocked component/session.
No plaintext or key cache is written to localStorage/IndexedDB. PB's normal auth
token persistence is separate. Closing, locking, signing out or changing accounts
disposes the session, aborts requests and clears reachable buffers/state. A late
response cannot repopulate the disposed session; JavaScript garbage collection
does not provide guaranteed physical memory erasure.

The session imports one non-extractable WebCrypto data key and drops its reference
on disposal; the login component clears its raw data-key buffer. Sync decrypts at
most one server page concurrently (100 items, bounded by 4 MiB). All operations in
that page must settle before cursor advancement or error publication. Publish the
note array after the pull finishes, rather than rebuilding the list for every
page; status-only notifications preserve the existing array reference.

## Save, sync and conflict rules

- Every request checks the current PB user's ID against the session owner.
  Item AAD always uses this authenticated owner, never a server-provided owner.
- Workspace/key requests have a 30-second deadline, chained to session disposal.
  Remove timers/listeners on completion. A timeout is uncertain delivery and must
  retain the exact write envelope. Clean locking exits immediately; a late flush
  cannot trigger another leave action after the workspace unmounts.
- Autosave waits 900 ms after an edit. `Ctrl/Cmd+S` saves explicitly;
  `Ctrl/Cmd+K` focuses search. Sync also runs on focus/online, manually, and every
  30 seconds while visible. There is one serialized network queue per session.
- Bind sync, writes and keyring replacement to the unlocked account `sync_epoch`. A changed generation freezes requests and preserves drafts for explicit export/reconnection. Keep one UUID `operation_id` and the original ciphertext/nonce after uncertain delivery. Retry that exact
  envelope before encrypting later edits at the next revision. Validate the operation receipt separately from the returned current record; a newer remote record may create a conflict. A save response
  must never clear edits typed while the request was in flight.
- Pull from cursor 0 on every unlock. Follow `has_more`, even when fewer than 100
  records were returned due to the server's 4 MiB page budget. Do not use bootstrap
  `sync_head` as the first cursor, nor advance the cursor from a write response.
- A dirty note receiving a different remote revision becomes a visible conflict.
  Preserve local plaintext; offer a new local copy or explicit discard in favor
  of the remote version. Never automatically overwrite either side.
- Search only unlocked memory. There is no server plaintext search or AI call.
- `trashed=true` is an encrypted, recoverable client state and still consumes
  quota. Only explicit permanent deletion calls DELETE and produces a tombstone.
  Backend tombstones cannot restore content.
- Network failures retain unsaved edits in the current tab, with explicit error,
  retry and before-unload protection. There is no durable offline queue, version
  history or automatic merge. Export Markdown before intentionally discarding
  unsaved edits. Session expiry does not automatically clear those drafts.
- Markdown preview uses existing `marked` plus `dompurify` with a narrow HTML
  allowlist. The Blog renderer is intended for authored content and is not reused
  for untrusted private notes. Images, embeds, forms, scripts and styles are
  excluded. Only user-activated HTTP(S) links survive; they open with noreferrer.

## API Key settings

Key management requires the verified PB user session. Keys are account-wide and
read-only, expire after 1–365 days, and are shown in full once after creation.
Initial key-list loading disables creation to prevent a late empty list response
from overwriting a newly created key in the UI.
The user can explicitly reveal/copy the separate account data key to a trusted
tool. Neither credential is put in a URL, stored in a browser cache, or sent
automatically to an AI service. Revoking a Key does not withdraw downloaded data.
Skill integration is still deferred.

## Attachment and navigation invariants

Encrypted attachment manifests must match the outer `attachment_ids`; normal text
edits preserve both. Attachment AAD binds the original note, so the conflict copy
option explicitly copies text without attachments. Attachment upload/download UI
and folder records remain future work; unsupported payloads stop sync rather than
being silently dropped. No legacy plaintext-schema fallback is provided.

Pending writes and deletes both count as unsaved work. Failed network operations
pause automatic retries; users can retry or export the in-memory text snapshot.
Homepage entry and workspace exit use document navigation so browser Back invokes
beforeunload. Explicit lock/logout also confirms unsaved operations. Root theme
selection survives this boundary via the shared sessionStorage preference; InkStack
has no separate theme state or control. Private login markup mounts after hydration so the server timezone cannot leave stale theme attributes on the browser page.

## Verification and delivery (2026-10-13)

User authorized Docker-only verification. `./scripts/stack-dev.ps1 check` runs
InkStack unit/contract tests and the whole-project TypeScript check. `browser`
runs Playwright against Next.js and a disposable real PocketBase inside Docker;
`preview` exposes port 2026; `build` produces the production Next artifact.
`dependencies` installs the checked-in frozen lockfile. No host runtime is installed. Browser tooling is installed
only inside the disposable container. Named volumes hold Linux modules/builds.
For release acceptance, set `INKSTACK_BROWSER_PRODUCTION=1` inside the browser
container and mount the production `.next` volume. The runner starts `next start`
and redirects browser PB API requests to its disposable backend. Test routes use
`fallback()` so simulated failures and capacity responses compose with that
isolation. No real-account requests are required by this harness.

The check/browser tasks accept `-BackendArchive <path>`; the default remains the
backend's local `dist/inkstack-local-linux-amd64.tar.gz`. Release verification uses
the actual CI package for backend `bdeebe246508db686a6aceae8a97f5d630d52a28`, under
`../2025-blog-pb/.local/release/ci-candidate/`. The fixture extracts it to a temporary directory,
creates synthetic users, respects administrator MFA using a CLI OTP, and deletes
its data afterwards. No production mail, credentials or user data are used.
Screenshots and Next logs live under ignored `.tmp/stack-browser/`.

Restored stash `a52ab7ce` on the current main checkout; the original stash is
retained. Preserve the current homepage blur, music shell exceptions and both
version-control workspace modes when merging. No frontend commit/push/deploy has
been performed.

The final Docker regression run passed all 465 tests across 96 files, including
18 InkStack tests against the deployed backend's CI binary. InkStack coverage includes independent
crypto vectors, exact write/delete retries, concurrent changes, epoch-reset draft
retention, attachment references, and real PocketBase encrypted round trips/rekey.
Production browser acceptance passed login, setup, save/lock/unlock, sanitized
preview without embedded requests, favorites/trash restore, read-only API Key
issuance/revocation, passphrase replacement and recovery unlock. Four themes,
390px width and offline browser-Back draft protection passed without browser
exceptions. The recovery textarea is selected by textbox role and its label prefix;
its enclosing label also contains its generated value in the test browser.

The capacity fixture uses synthetic encrypted sync responses, not production data
or a backend load test. Final production input/search results at 4x Chromium CPU
throttling: 5,000 notes (8 MiB ciphertext) had input p95 38 ms, search 120 ms and
16 MiB measured JS heap; 50,000 notes (84 MiB) had input p95 92 ms, search 248 ms
and 99 MiB JS heap. Both rendered 11 rows. Initial full unlock without throttling
took 1,576 ms and 13,614 ms respectively. JS heap excludes process/GPU memory;
these are container measurements, not a physical mobile-device guarantee.
Virtual rows, stable snapshots, bounded batch decryption and one imported session
key are retained. Set `INKSTACK_SCALE=1` (or use `browser -Scale` for the dev runner)
to reproduce; metrics are saved to `.tmp/stack-browser/scale.json`.
Do not replace Docker with a host toolchain or modify personal Docker data when
Desktop startup reports an inaccessible local data mount.

Production builds explicitly keep TypeScript checking enabled. Next is now pinned
to `16.3.8` and TypeScript to `5.9.3`. The compiler upgrade exposed native buffer
and file-stream typing issues, corrected without disabling checks or adding
unsafe casts. Production and development use Turbopack with React Compiler enabled.
The Linux build panic was isolated to the compression Worker library references;
moving those declarations to `global.d.ts` restored the full Docker build. See
[Operations](./operations.md) for the compiler interaction and its limits.
Final logs are under ignored `.tmp/stack-release-*-final-2026-10-13.*`.
Frozen offline dependency installation and the final Turbopack production build
passed compilation, the built-in TypeScript check and all 35 static-generation
tasks (exit code 0). The production server also passed browser smoke checks: `/healthz` returned
204; `/`, `/about`, `/changelog` and `/home` returned 200 without browser exceptions;
the InkStack login had no horizontal overflow at 390px. The production Codex-session
Worker parsed synthetic UTF-8 JSONL into its audit view; changelog scrolling appended
older entries without replacing existing ones; updated Mermaid rendered ordinary
and mathematical KaTeX labels. Dawn desktop and night mobile screenshots were inspected.

Production backend was deployed on 2026-10-11 at `bdeebe2`; its final CI, isolated
restore rehearsal, production route checks and V9/V10 full backups succeeded.
See backend `docs/INFORMATION_STACK_STATUS.md` for evidence. Signup/GitHub were
accepted by the user earlier. The release check read production health and auth
methods successfully (HTTP 200 with CORS); password, GitHub and Google are enabled.
This does not establish Google OAuth's external token exchange or repeat mail
delivery acceptance. Google egress acceptance and Skill remain separate work.
All four hosted InkStack backgrounds also returned HTTP 200.

The final production dependency audit returned zero known registry advisories.
Security version constraints and their scope are documented in
[Operations](./operations.md); this is not a claim of exhaustive security coverage.

## Remaining product scope

- Folder management, attachment controls, history, encrypted ZIP backup/restore
  and independent data deletion still need frontend interfaces.
- All notes are decrypted into memory. Virtualization bounds DOM work, not
  plaintext memory; actual mobile keyboard/memory behavior remains unmeasured.
- No durable offline queue, automatic merge, collaboration or Skill integration.
- The current encrypted Markdown workspace passed local release acceptance;
  advanced feature interfaces and full external OAuth acceptance remain separate
  product work. Repeat origin-specific smoke checks after the actual deployment.
