# Version Control Workbench

## Purpose

Provides read-only Git/SVN review for public GitHub repositories in browser and local repositories through the optional Toolbox Agent.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/toolbox/version-control/` | Launch, graph, tree, diff, conflict, export UI. |
| `src/lib/version-control/` | Bridge, data sources, store, graph, diff Worker. |
| `github-rest-repository-data-source.ts` | Browser GitHub REST mode. |
| `bridge.ts`, `launch-client.ts` | Local Agent launch/callback contract. |
| `diff-render.worker.ts` | Pierre diff metadata. |

## Main Flow

GitHub mode reads public REST data directly. Local mode receives an opaque repository ID from the native picker, then uses Agent bridge for Git/SVN metadata and source streams. Pierre is the only diff renderer; caches are page-memory only.

Desktop keeps the resizable browser/detail split. Below the `lg` breakpoint, the mounted panels become a navigation stack: history selection opens the changed-file tree, repository-file selection opens the source viewer, and changed-file selection opens a full-screen Diff using Unified layout by default. Mobile back actions return to the still-mounted browser panel so search, scroll, and expanded-directory state survive. Mobile comparison is an explicit pick-another-version flow; desktop right-click comparison remains available.

## Pay Attention

- Git mode is read-only except explicitly confirmed local Git export. Never add checkout, commit, reset, staging, or arbitrary local path submission.
- SVN runs controlled `svn.exe` with no shell, bounded output, authorized working-copy root, and explicit history/network confirmation.
- GitHub trees can truncate; keep Contents fallback. Keep paging/stale-response guards and content-fingerprint cache keys.
- Keep control frames below 64 KiB and previews in independent streams.
- Manual diff theme must not trigger fetch/reparse/scroll reset.
- Keep desktop split sizing and pointer interactions isolated from the mobile navigation stack; repository initialization may preselect a revision but must not automatically advance the mobile panel.
- Do not read `.svn/wc.db`, recurse externals, enable `svn+ssh://`, or turn SVN into a write flow.
