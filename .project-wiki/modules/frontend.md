# Frontend Runtime

## Purpose

Owns the shared layout, time theme, navigation, atmosphere, homepage behavior, calendar, and visible-animation performance.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/layout.tsx` | Root metadata, CSS, theme variables, initial scripts. |
| `src/layout/index.tsx` | Providers, atmosphere, global navigation, mobile scroll-top, homepage fitting. |
| `src/layout/backgrounds/click-effect-layer.tsx` | Theme-aware, on-demand global click feedback. |
| `src/components/appearance-control.tsx` | Shared theme picker and click-effect switch. |
| `src/components/nav-card.tsx` | Responsive navigation and appearance-control entrypoint. |
| `src/app/(home)/quick-controls-card.tsx` | Homepage's animated theme, click-effect, and E/V/N deployment switcher. |
| `src/config/site-content.json` | Site content plus the configured deployment-switcher targets. |
| `src/lib/animation-loop.ts` | Visibility-aware frame loops. |
| `src/app/(home)/` | Card homepage and configuration store. |
| `src/app/calendar/` | Calendar state, data, grid, day panel, term track. |
| `src/app/world-clock/` | Interactive Earth, location time readings, annual solar track, and responsive scene layout. |

## Main Flow

`layout.tsx` injects configuration and wraps every route in the client `Layout`. The client layout mounts providers, atmosphere, navigation, and route-specific exceptions. Navigation keeps the compact appearance picker; the homepage uses one animated quick-controls card for direct theme selection, the persisted click-effect preference, and E/V/N deployment navigation from `site-content.json`. Theme changes continue to use the original View Transition flow. Continuous visuals use the shared animation loop; the homepage WebGL core uses dynamic 50/60 FPS throttling and capped DPR, while click feedback uses a bounded on-demand Canvas loop that is idle when no effect is visible.

## Pay Attention

- World clock keeps its immersive Earth view, natural imagery, day/night boundary, solar track, and four time-theme backgrounds. Route-local `world-clock.module.css` uses a full-viewport desktop canvas with a compact floating time panel and a small bottom-left track control. Do not turn these into a dashboard grid or a tall scrolling sidebar. At 960px and below, panels follow a dedicated globe stage in document flow. Header text adapts to the theme while data panels retain a translucent dark surface.
- Keep the globe canvas and projected solar-term labels inside the same sized wrapper. The camera adjusts its field of view for portrait stages and uses a desktop view offset to leave room for the time panel without cropping the canvas. Initial and reset distance share `CAMERA_DISTANCE`. Layer and map buttons expose their selected state with `aria-pressed`.

- Do not add idle frame loops, raw scroll work, or layout reads in pointer-move handlers.
- Keep the homepage WebGL core at one static frame for reduced motion, 50 FPS while idle, 60 FPS during interaction, and no more than 1.25 DPR.
- Keep the visible homepage art-card image eager and high priority because it is the LCP image; other `OptimizedImage` uses remain lazy by default.
- Keep global click feedback capped, theme-aware, disabled for reduced motion, and inactive on game/world-clock or covered full-screen workbenches.
- Keep game/world-clock exceptions: hidden or covered Canvas/WebGL work must stop/release resources.
- Homepage card layout comes from JSON; do not introduce a browser editor by accident.
- Preserve compact navigation touch behavior and reduced-motion behavior.
- The homepage quick-controls card must not add an idle animation loop; it marks the active deployment by matching `window.location.hostname` against the configured URLs.
- Blog-reading performance rules belong in [content](./content.md).
