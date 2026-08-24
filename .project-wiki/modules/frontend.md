# Frontend Runtime

## Purpose

Owns the shared layout, time theme, navigation, atmosphere, homepage behavior, calendar, and visible-animation performance.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/layout.tsx` | Root metadata, CSS, theme variables, initial scripts. |
| `src/layout/index.tsx` | Providers, atmosphere, global navigation, mobile scroll-top, homepage fitting. |
| `src/components/nav-card.tsx` | Responsive navigation and theme control. |
| `src/lib/animation-loop.ts` | Visibility-aware frame loops. |
| `src/app/(home)/` | Card homepage and configuration store. |
| `src/app/calendar/` | Calendar state, data, grid, day panel, term track. |

## Main Flow

`layout.tsx` injects configuration and wraps every route in the client `Layout`. The client layout mounts providers, atmosphere, navigation, and route-specific exceptions. Theme changes use View Transition when possible. Continuous visuals use the shared animation loop.

## Pay Attention

- Do not add idle frame loops, raw scroll work, or layout reads in pointer-move handlers.
- Keep game/world-clock exceptions: hidden or covered Canvas/WebGL work must stop/release resources.
- Homepage card layout comes from JSON; do not introduce a browser editor by accident.
- Preserve compact navigation touch behavior and reduced-motion behavior.
- Blog-reading performance rules belong in [content](./content.md).
