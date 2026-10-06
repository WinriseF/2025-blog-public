# Version Control Workbench

## Purpose

Provides browser-local file browsing and opt-in editing, plus read-only Git/SVN review through the optional Toolbox Agent and public GitHub REST access.

## Key Paths

| Path | Use it for |
| --- | --- |
| `src/app/toolbox/version-control/` | Launch, graph, tree, diff, conflict, export UI. |
| `src/lib/version-control/` | Bridge, data sources, store, graph, diff Worker. |
| `github-rest-repository-data-source.ts` | Browser GitHub REST mode. |
| `bridge.ts`, `launch-client.ts` | Local Agent launch/callback contract. |
| `diff-render.worker.ts` | Pierre diff metadata. |
| `browser-directory.ts` | Browser directory handles, lazy directory reads, UTF-8 snapshots, checked writes. |
| `use-workspace-files.ts`, `workspace-file-panel.tsx` | Preview/persistent tabs, read-only toggle, save/leave/conflict decisions. |
| `workspace-text-editor.tsx`, `monaco-runtime.ts` | Monaco editor lifecycle, theme and save integration; pinned CDN runtime, localization and worker bootstrap. |

## Main Flow

GitHub mode reads public REST data directly. The original local launch card offers two actions: connect Agent (existing native repository picker, file browsing, Git/SVN history, diff and export) or select folder (browser file browsing/editing only, without a history tab). Folder mode starts with `showDirectoryPicker({ mode: 'read' })` in a secure context. `BrowserDirectory` implements only `WorkspaceFileSource`; it does not fabricate a repository overview or history. The store holds `browserDirectory` separately from the optional `RepositoryDataSource`. The local handle stays authoritative for current files after browser editing is authorized for an Agent workspace or the Agent disconnects. Capability detection for directory access is independent of the Windows/WebTransport requirements for Agent history.

The top-right read-only button requests directory write permission on a user gesture and enables editing for the current workspace. In an Agent workspace, it first opens `showDirectoryPicker({ mode: 'readwrite' })`; the user must select the same repository root. All edits use browser handles. `workspaceKey` remains stable when granting browser access or losing Agent connectivity, but changes when opening another project. Every newly opened workspace starts read-only even when the browser already has write permission. Only existing UTF-8 text files up to 2 MiB are editable; images up to 16 MiB are previews. `.git` and `.svn` are hidden. Directory children are enumerated only on expansion; file sizes are fetched only for the current page of entries; contents are read on selection, not during enumeration. Read-only selection uses the existing viewer; text snapshots are loaded only in edit mode. There is no recursive project scan, persistent handle storage, automatic save, or draft recovery.

Single-click opens one reusable italic preview tab; double-click keeps a tab, and editing promotes it automatically. Only the active document can be dirty. Switching files, closing the active tab, switching workspaces, refreshing, changing to history, leaving for the toolbox, or returning to read-only asks Save / Discard / Cancel first. Ctrl/Cmd+S and the save button are the only normal disk-write actions. An unsaved document installs a native `beforeunload` warning; Agent teardown happens on `pagehide` or unmount, never on a cancelled `beforeunload` event. Browser termination/crashes cannot guarantee that warning. No browser-back draft recovery is promised.

Text snapshots retain the UTF-8 BOM and the original CRLF/LF convention while editor content uses LF. Before saving, reread the disk content and compare it with the baseline; a mismatch offers Reload / Overwrite / Cancel. Overwrite rereads and rechecks a fresh baseline, and failed writes retain the editor contents. This is a pre-write conflict check, not an OS-wide atomic compare-and-swap against other editors. Metadata directories and path traversal are rejected. Pierre remains the source-preview and diff renderer; the edit surface uses Monaco's built-in editor, search/replace and language contributions. Both file modes soft-wrap at the available panel width: Pierre uses `overflow: 'wrap'` and Monaco uses `wordWrap: 'on'`. Wrapping is display-only, preserves logical line numbers and never inserts newlines into saved content. Do not reimplement highlighting, line numbers, indentation, search or undo.

`monaco-runtime.ts` configures `@monaco-editor/loader` once with jsDelivr `monaco-editor@0.52.2/min/vs` and Simplified Chinese localization. The fixed version supplies the AMD entry point needed by this CDN integration; update it together with the dev-only `monaco-editor` types, not to an unversioned CDN URL. Editor runtime/CSS, language modules and workers load from CDN, never through a runtime package import. A page-lifetime blob worker bootstrap imports the same CDN worker entry, avoiding cross-origin Worker constructor restrictions. Models, editor instances and content subscriptions are disposed on unmount; the shared loader and worker bootstrap remain available for subsequent files. CDN failures display an error rather than leaving a blank pane. First use requires network/CDN access. File content stays in browser memory and workers; the application does not upload it to the CDN.

Agent entry retains the existing Agent protocol and native repository picker. Browser authorization is a separate step only when enabling editing; the user selects the same repository root again. Browser directory handles do not expose an absolute OS path, so this flow relies on the user selecting the correct root; it does not claim automatic filesystem-identity verification. No Agent source/protocol changes, upgrade requirement, or temporary proof files are part of this feature.

Git/SVN history, branches, diff and export stay on the existing Agent bridge with opaque repository IDs; GitHub and historical content are never writable. Disconnecting the Agent clears history state while retaining browser tabs, permission mode, and the current edit. Background refreshes must not replace a dirty browser document. Caches are page-memory only.

Keep the original launch card, workbench layout, file tree, time theme, translucent surfaces and atmosphere effects. Do not override global/route color tokens or restyle history/diff/export components for this feature. The file pane has one shared header: horizontally scrollable tabs on the left, mobile back navigation at the leading edge, and fixed copy/save actions on the right. The tab strip converts vertical wheel deltas to horizontal scrolling with a non-passive listener, preserves native horizontal trackpad input and Ctrl+wheel zoom, and hides the scrollbar while retaining scrolling. Opening/switching/closing tabs or resizing the pane reveals the active tab within the strip only; manual scrolling must not snap back to it. Do not add a second filename/header row. Full paths are tab tooltips; source, size/line count and save state live in a compact bottom status bar. The read-only viewer supplies its copy action through the shared header render slot, without rereading file contents in the parent.

File panes use `createFileThemeStyle`: only the outer background uses 20% time-theme color and 80% transparency. Text, syntax colors, line numbers, tabs and controls retain full opacity; never set opacity on the panel itself. The nested viewer, Pierre shadow root, Monaco canvas and gutters remain transparent so background layers do not accumulate. Pierre single-theme output sets a literal `background-color` on its shadow host; the file viewer must override that property through `unsafeCSS`, as well as `--diffs-bg`. Overriding variables alone leaves the host opaque. Monaco's editor/gutter background theme colors use transparent RGBA; its native widgets retain a readable theme surface. History/diff themes remain unchanged. Global avatar navigation stays hidden in either workspace mode.

Desktop keeps the resizable browser/detail split. The divider paints a single 1px line with a transparent 9px drag target and a brand-color hover state; desktop sidebar borders are suppressed to avoid a doubled separator. Below the `lg` breakpoint, the mounted panels become a navigation stack: history selection opens the changed-file tree, repository-file selection opens the source viewer, and changed-file selection opens a full-screen Diff using Unified layout by default. Mobile back actions return to the still-mounted browser panel so search, scroll, and expanded-directory state survive. Mobile comparison is an explicit pick-another-version flow; desktop right-click comparison remains available.

## Pay Attention

- Ctrl/Cmd+F uses Monaco's native find widget, including find-in-selection, regex/case/word switches, match counts and replacement. Ctrl/Cmd+S calls the existing workspace save handler. Do not add a custom search panel or duplicate matching logic.
- Git history operations are read-only except explicitly confirmed local Git export. Browser editing writes existing working-tree text only; never add checkout, commit, reset, staging, or arbitrary local path submission.
- SVN runs controlled `svn.exe` with no shell, bounded output, authorized working-copy root, and explicit history/network confirmation.
- GitHub trees can truncate; keep Contents fallback. Keep paging/stale-response guards and content-fingerprint cache keys.
- Keep control frames below 64 KiB and previews in independent streams.
- Manual diff theme must not trigger fetch/reparse/scroll reset.
- Keep desktop split sizing and pointer interactions isolated from the mobile navigation stack; repository initialization may preselect a revision but must not automatically advance the mobile panel.
- Do not read `.svn/wc.db`, recurse externals, enable `svn+ssh://`, or turn SVN into a write flow.
