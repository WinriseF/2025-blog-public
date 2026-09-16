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
| `src/app/home/` | Flat, draggable site-entry plane. |
| `src/app/calendar/` | Calendar state, data, grid, day panel, term track. |
| `src/app/world-clock/` | Interactive Earth, location time readings, annual solar track, and responsive scene layout. |

## Main Flow

`layout.tsx` injects configuration and wraps every route in the client `Layout`. The client layout mounts providers, atmosphere, navigation, and route-specific exceptions. Navigation keeps the compact appearance picker; the homepage uses one animated quick-controls card for direct theme selection, the persisted click-effect preference, and E/V/N deployment navigation from `site-content.json`. Theme changes continue to use the original View Transition flow. Continuous visuals use the shared animation loop; the homepage WebGL core targets a constant 60 FPS with capped DPR, while click feedback uses a bounded pool of local canvases that is idle when no effect is visible.

## Pay Attention

- Shared `SelectMenu` lists render through a body portal with fixed viewport positioning and a theme surface background. Choose above/below placement based on available space, constrain list height, and close on outside scrolling/resizing. Outside-click detection must include the portaled list; preserve trigger focus for keyboard selection. Do not move menus back inside clipping card containers.

- World clock keeps its immersive Earth view, natural imagery, day/night boundary, solar track, and four time-theme backgrounds. Route-local `world-clock.module.css` uses a full-viewport desktop canvas with a compact floating time panel and a small bottom-left track control. Do not turn these into a dashboard grid or a tall scrolling sidebar. At 960px and below, panels follow a dedicated globe stage in document flow. Header text adapts to the theme while data panels retain a translucent dark surface.
- Keep the globe canvas and projected solar-term labels inside the same sized wrapper. The camera adjusts its field of view for portrait stages and uses a desktop view offset to leave room for the time panel without cropping the canvas. Initial and reset distance share `CAMERA_DISTANCE`. Layer and map buttons expose their selected state with `aria-pressed`.

- Do not add idle frame loops, raw scroll work, or layout reads in pointer-move handlers.
- The homepage WebGL core (`src/app/(home)/animated-core.tsx`) targets 60 FPS in idle, hover, and activation states. Reduced motion keeps the scene static but still draws at 60 FPS as explicitly requested; hidden/offscreen loops remain paused. Preserve antialiasing and the container-based DPR cap (1 below 640px, otherwise 1.25). Always redraw after resizing. Only the planar base disc uses `forceSinglePass`; shards share one material and three geometries, with shared resources disposed once.
- Keep shared homepage card tilt (`src/components/card.tsx`) on Motion's spring and preserve backdrop blur throughout interaction. `will-change` is a Motion value enabled for hover, entrance/scale transitions, and tilt spring motion; release it after settling. Do not restore permanent `transform-gpu` promotion. Core pulse decorations pause outside hover and are disabled under reduced motion. Glass/content splitting requires measured browser evidence before introducing extra layers.
- `src/layout/backgrounds/time-atmosphere-background.tsx` renders soft glows at half CSS width/height and night stars on a separate DPR-1 canvas. Cache glow gradients as shared 512px textures per theme effect; resize reuses these textures and cleanup releases them. Preserve glow colors, alpha stops, and compositing; calibrate drift with `deltaMs * atmosphere.targetFps / 1000`. Theme frame budgets remain 6/6/8/5 FPS. Check dark gradients and star edges visually when changing resolution; reduced glow pixel count is not a measured page GPU reduction. The ambient effect layer supports only meteors or none, with no music-player coupling or ambient audio configuration. Meteor canvases retain capped DPR (1.25 mobile, 1.75 desktop); meteor effects must use timers for spawning and leave RAF stopped while no meteor is alive.
- The shared animation loop tracks actual draw time separately from the next deadline. RAF must check that deadline (0.5ms rounding tolerance), carry phase forward, and skip missed deadlines without catch-up draws. Fast loops use RAF directly; slower loops sleep with timers. On-demand wake calls and redundant visibility notifications leave pending timing intact; stopped/hidden loops reset timing. `tests/animation/animation-loop.test.ts` models timers and 60/120/144/165 Hz displays, target changes, wake calls, and hidden recovery. A target is a scheduling budget, not a guarantee under GPU load or a display below 60 Hz.
- Keep the visible homepage art-card image eager and high priority because it is the LCP image; other `OptimizedImage` uses remain lazy by default.
- Keep global click feedback capped, theme-aware, disabled for reduced motion, and inactive on game/world-clock or covered full-screen workbenches. Reuse at most three 192px-square canvases, sized for the maximum point radius plus glow; preserve chronological DOM order for overlapping effects. Clear only active local canvases, stop RAF when empty, and release canvases on cleanup. If particle reach grows, update the canvas bound to avoid clipping.
- Keep game/world-clock exceptions: hidden or covered Canvas/WebGL work must stop/release resources.
- Homepage card layout comes from JSON; do not introduce a browser editor by accident.
- `/home` lays its repeating site-entry cards on a flat, staggered plane; keep drag inertia and keyboard activation when changing the presentation.
- Preserve compact navigation touch behavior and reduced-motion behavior.
- The homepage quick-controls card must not add an idle animation loop; it marks the active deployment by matching `window.location.hostname` against the configured URLs.
- Blog-reading performance rules belong in [content](./content.md).
