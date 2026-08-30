# LAN Transfer V13

## Purpose

Owns the full-screen LAN chat/file workbench: invitations, Supabase signaling, WebRTC transport, optional native Agent routes, scheduling, recovery, and diagnostics.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/t/` | LAN route and native-return page. |
| `src/app/toolbox/use-lan-transfer-engine.ts` | One runtime per stable device. |
| `src/lib/lan-transfer/signal-client.ts` | Presence, Broadcast, reconnect. |
| `native-webrtc-transport.ts` | Peer connection, channel, ICE, frame probing. |
| `connection-runtime.ts`, `attachment-send-scheduler.ts` | Chat/file state and frame scheduling. |
| `reconnect-coordinator.ts`, `connection-health-monitor.ts` | Same-page recovery. |
| `native-file-runtime.ts`, diagnostics/benchmark files | Optional Agent byte plane and speed tests. |

## Main Flow

Host creates an invite; guests join a Supabase room using a locally hashed token. Host owns offers per connection generation. Peers use one reliable ordered V13 DataChannel for chat and normal files. Large-file/native acceleration can use the Agent, while signaling/control stays encrypted over WebRTC.

Recovery is serialized by a monotonically increasing attempt epoch so stale SDP work, transport failures, and timers cannot mutate a newer negotiation. SDP creation and acceptance carry both their originating negotiation ID and attempt token through the transport callback; results from an invalidated attempt are discarded. A transient disconnect gets a short natural-recovery window, then the host tries a 5-second ICE restart before a 7-second rebuild. Automatic rebuild retries use `0 / 750 / 2000 ms` delays and then pause with an explicit retry action; that action always performs a hard rebuild instead of trusting stale browser connection flags.

Critical signaling uses the protocol-level `signal-ack`; Supabase Broadcast server acknowledgements stay disabled because they do not prove peer receipt. Superseded recovery messages are discarded, terminal Realtime channels are recreated, and Presence disappearance is reconciled through a 6.5-second peer lease that is also refreshed by valid peer signals. Presence loss only gates recovery when no usable transport remains: an open DataChannel is preserved and continues to be judged by its own ping/pong and ICE health evidence. Page wake verification includes the same small DataChannel ping/pong rather than depending only on optional ICE consent statistics.

The LAN workbench enters with a lightweight underlay/content fade only; avoid adding full-screen click-origin canvas effects to this transition.

## Pay Attention

- V13 is breaking: stale sessions must refresh; do not add old-session compatibility branches.
- No TURN/WebSocket relay exists. IPv4-only/IPv6-only peers may not connect without a shared ICE path.
- Never expose invite tokens or native tickets in URLs, logs, diagnostics, or Supabase.
- Keep one scheduler as the only DataChannel attachment writer; preserve mobile/desktop memory and concurrency caps.
- Reconnect must preserve runtime/ranges and distinguish natural recovery, ICE restart, and rebuild.
- Every asynchronous reconnect continuation and timeout must verify the current attempt epoch and transport identity.
- Presence loss pauses retries for the vanished instance but must not tear down an open DataChannel; a new instance or explicit retry resets the bounded retry budget.
- Explicit TCP/QUIC benchmarks fail explicitly; only automatic routing may fall back to WebRTC.
- Diagnostics are local-only but can contain network addresses; do not share them. Remove temporary high-frequency IPv6 sampling after investigation.
