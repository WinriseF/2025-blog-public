# Project Module Guide

This directory is the compact maintenance map for `2025-blog-public`. Read the matching module before changing code; update that same module when behavior, constraints, or source paths change.

| Module | Read when working on |
| --- | --- |
| [Frontend runtime](./modules/frontend.md) | Layout, theme, navigation, homepage, calendar, animation, rendering performance. |
| [Content and reading](./modules/content.md) | Blog data, Markdown, images, article UI, news, likes, content maintenance. |
| [Public transfer](./modules/public-transfer.md) | `/t` encrypted relay, EdgeOne endpoints, Blob lifecycle, administration, cleanup. |
| [LAN transfer](./modules/lan-transfer.md) | V14 rooms, signaling, WebRTC, native Agent, scheduler, recovery, diagnostics. |
| [Toolbox](./modules/toolbox.md) | Compression, Markdown preview, password, face masking, OCR, shared image preview, Agent center. |
| [Codex Session](./modules/codex-session.md) | Rollout JSONL parsing, audit evidence, token accounting, parser Worker. |
| [Version control](./modules/version-control.md) | GitHub/local Git/SVN workbench, bridge, diff, export boundaries. |
| [Operations](./modules/operations.md) | Stack, directories, scripts, tests, deployment, integrations, secrets, global risks. |

The root [ARCHITECTURE.md](../ARCHITECTURE.md) is the short cross-module entrypoint. Do not duplicate module detail there.
