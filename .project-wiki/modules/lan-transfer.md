# LAN Transfer V14.1

## Purpose

Owns the full-screen LAN chat/file workbench, stable room invitations, Supabase signaling, disposable WebRTC transports, persistent receiver recovery, optional native Agent routes, scheduling, and diagnostics.

## Stable Identity Model

| Layer | Identity and lifetime |
| --- | --- |
| Room | `roomId + secret + role`; persisted locally until explicit leave. |
| Device | `deviceId`; browser-profile lifetime. |
| Page instance | `instanceId`; regenerated for every page load. |
| WebRTC transport | One disposable `RTCPeerConnection`; replaced on instance change or failed recovery. |
| Transfer runtime | Scoped to `roomId + remoteDeviceId`; survives transport replacement and rehydrates receiver state from persistent storage. |

The stable route is `/t/lan/<roomId>`. An invitation is `/t/lan/<roomId>#k=<secret>`; the secret is saved before the fragment is removed. The secret derives the Supabase channel key and is never placed in Presence or Broadcast payloads.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/t/lan/[roomId]/` | Stable LAN room route and refresh entrypoint. |
| `src/lib/lan-transfer/session-store.ts` | Room membership, device identity, instance creation, invite URL. |
| `src/lib/lan-transfer/signal-client.ts`, `signal-inbox.ts` | Realtime subscribe, Presence snapshots, targeted signals, and early-instance buffering. |
| `src/lib/lan-transfer/peer-connection-manager.ts` | Four-state transport lifecycle and bounded network recovery. |
| `native-webrtc-transport.ts` | Peer connection, ordered DataChannel, ICE, frame probing, route inspection. |
| `connection-runtime.ts`, `attachment-send-scheduler.ts` | Chat/file state, resume exchange, and the only WebRTC attachment writer. |
| `runtime-store.ts`, `storage/` | Receiver metadata, ranges, OPFS/IndexedDB reopening, TTL cleanup. |
| `native-file-runtime.ts`, `native-agent/` | Optional Agent byte plane; keep independent from WebRTC lifecycle. |

## Connection Flow

Room restoration starts signaling immediately; capability detection and abandoned-transfer cleanup run in the background. Presence discovers devices and confirms the newest page instance. Broadcast carries `description`, `candidate`, and Guest `connect-request` envelopes targeted to an exact device and instance. The wire/storage version remains 14; there is no legacy offerer-election path.

The Host is the sole offerer, including ICE restarts; Guests only answer or request a connection. Requests reference the observed connection/exchange and distinguish discovery, network recovery, fresh transport, and explicit retry. Duplicate and retired requests must not replace a newer connection. Existing connection/exchange IDs and local operation tokens reject stale work; no additional recovery handshake or wire generation is used.

A confirmed new remote instance immediately replaces the old transport. Signals arriving before that instance's Presence are buffered by device and instance, even when an older manager already exists. The inbox retains at most 32 queues of 64 messages for 10 seconds measured locally, discards known retired instances, and rejects older Presence snapshots.

After SDP application and the DataChannel hello, the manager synchronously attaches the existing runtime and marks the connection usable. Route inspection runs in the background and only patches route metadata for the current transport/exchange. It must never delay attachment, trigger a second attachment, or discard early capability/resume frames. Runtime hydration and `resume-query` / `resume-state` retain their existing persistence boundary.

For same-instance disruption, wait two seconds for natural recovery, try one ICE restart with a 4.5-second deadline, then use a fresh PC. Explicit ICE failure skips the grace period; a closed channel or non-ICE terminal failure requires a fresh PC. Fresh negotiations and Guest request waits have 7-second deadlines. Failures share bounded additional `0 / 1s / 3s` retries, reset only by successful recovery, a new instance, or explicit retry. Repeated Presence snapshots and signaling reconnects do not replenish this budget.

Signaling or Presence loss suspends negotiation/recovery timers and preserves a viable PC. A healthy P2P connection remains usable; a disconnected PC waits for natural recovery or signaling/Presence restoration before resuming recovery. Closed channels can be disposed immediately. Page wake events are coalesced; only one current-transport probe may run, and probes are skipped while local file data is buffered. Waking during an active negotiation does not rebuild it.

## Persistence

- Never delete LAN storage when `/t` mounts.
- OPFS and IndexedDB reopen a compatible manifest instead of replacing it.
- Active room records are excluded from background cleanup.
- Interrupted receiver records expire after seven days; completed cached records expire after one day.
- Explicitly leaving a room forgets its secret and cleans that room's receiver records.
- Browser `File` objects are not durable. A sender page refresh may require selecting the source again; receiver-side OPFS/IndexedDB progress is durable.
- Direct File System Access writers remain page-scoped because browser permission/handle recovery is not portable.

## Pay Attention

- V14 is intentionally incompatible with V13; do not add dual-protocol branches.
- Keep `connect-request` as the only Guest recovery request; do not add offerer election, rebuild handshakes, or a second recovery protocol.
- Keep one candidate queue scoped to the current connection/exchange and reject stale instance traffic.
- Do not let Presence/signaling loss destroy a viable PC, including while ICE is disconnected or a recovery deadline is pending.
- Keep runtime persistence logic outside `connection-runtime.ts`; that file is already near the project size limit.
- No TURN/WebSocket relay exists. Some address-family or network combinations cannot establish a direct path.
- Never expose room secrets, derived channel keys, native tickets, or raw network addresses in logs or diagnostics.
- Explicit TCP/QUIC benchmarks fail explicitly; only automatic routing may fall back to WebRTC.
