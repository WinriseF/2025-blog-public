# LAN Transfer V14

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
| `src/lib/lan-transfer/signal-client.ts` | Realtime subscribe, Presence snapshots, SDP/candidate Broadcast. |
| `src/lib/lan-transfer/peer-connection-manager.ts` | Four-state transport lifecycle and bounded network recovery. |
| `native-webrtc-transport.ts` | Peer connection, ordered DataChannel, ICE, frame probing, route inspection. |
| `connection-runtime.ts`, `attachment-send-scheduler.ts` | Chat/file state, resume exchange, and the only WebRTC attachment writer. |
| `runtime-store.ts`, `storage/` | Receiver metadata, ranges, OPFS/IndexedDB reopening, TTL cleanup. |
| `native-file-runtime.ts`, `native-agent/` | Optional Agent byte plane; keep independent from WebRTC lifecycle. |

## Connection Flow

Room restoration starts signaling immediately; capability detection and abandoned-transfer cleanup run in the background. Presence is used only for discovery, online state, and selecting the newest page instance for a device. Broadcast carries only `description` and `candidate` envelopes targeted to an exact device and instance.

The deterministic device leader creates a fresh PeerConnection and offer. A new remote instance immediately replaces the old transport. The DataChannel opening attaches the existing runtime, which exchanges capability/history and runs `resume-query` / `resume-state` without wire-level reconnect generations.

For same-instance network disruption, the manager waits two seconds for natural recovery, tries at most one ICE restart, then creates a fresh PeerConnection with bounded `0 / 1s / 3s` retries. A healthy DataChannel remains usable when Supabase or Presence is temporarily unavailable. Page wake uses one small ping/pong rather than a continuous stats health loop.

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
- Do not add discovery or recovery commands to Broadcast. SDP offers already express connection creation and ICE restart.
- Keep one candidate queue scoped to the current connection/exchange and reject stale instance traffic.
- Do not let Presence loss close an open DataChannel.
- Keep runtime persistence logic outside `connection-runtime.ts`; that file is already near the project size limit.
- No TURN/WebSocket relay exists. Some address-family or network combinations cannot establish a direct path.
- Never expose room secrets, derived channel keys, native tickets, or raw network addresses in logs or diagnostics.
- Explicit TCP/QUIC benchmarks fail explicitly; only automatic routing may fall back to WebRTC.
