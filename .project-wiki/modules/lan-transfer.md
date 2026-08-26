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

The LAN workbench enters with a lightweight underlay/content fade only; avoid adding full-screen click-origin canvas effects to this transition.

## Pay Attention

- V13 is breaking: stale sessions must refresh; do not add old-session compatibility branches.
- No TURN/WebSocket relay exists. IPv4-only/IPv6-only peers may not connect without a shared ICE path.
- Never expose invite tokens or native tickets in URLs, logs, diagnostics, or Supabase.
- Keep one scheduler as the only DataChannel attachment writer; preserve mobile/desktop memory and concurrency caps.
- Reconnect must preserve runtime/ranges and distinguish natural recovery, ICE restart, and rebuild.
- Explicit TCP/QUIC benchmarks fail explicitly; only automatic routing may fall back to WebRTC.
- Diagnostics are local-only but can contain network addresses; do not share them. Remove temporary high-frequency IPv6 sampling after investigation.
