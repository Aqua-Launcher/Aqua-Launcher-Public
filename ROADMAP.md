# Aqua Launcher — Agent Roadmap

**Status:** planning document. It sequences the catalogue in the feature catalogue; packages marked `done` in the [progress tracker](#15-progress-tracker) also record shipped code.
**Audience:** the next coding agent (human or model) picking up a package.
**Primary platform:** Windows. Do not regress macOS/Linux, but do not spend a package on them without a decision.

If a task is not assigned to a phase below, it is **not approved yet**. Ask before building it.

---

## How to use this document

1. Pick the lowest-numbered package whose dependencies are marked done.
2. Read its **Build**, **Contracts**, and **Done when** sections before touching code.
3. Work in one package per change set. Do not bundle two packages "while you're there".
4. Run the package's verification commands and the [definition of done](#4-definition-of-done).
5. Update the [progress tracker](#15-progress-tracker) and add a line to the [changelog](#16-changelog).
6. If you stop mid-package, write the current state, the blocker, the files changed, and the next concrete step in the tracker row.

**Do not start** if `npm run typecheck` or `npm test` is already failing. Fix that first, or report it as the blocker.

**Fastest visible win:** P1.2 (Safe Mode) has no hard dependency. **Largest trust win:** P1.1 (Crash Guard); it benefits from P0.1 but does not require it. Phase 0 modules exist only to serve their first consumer, so it is fine to build P0.1 alongside P1.1 or P2.3 rather than as a standalone release.

---

## 1. Ground rules

- **Do not delete or overwrite user data.** Destructive operations are copy-first, confirmed, and reversible where the platform allows it. World restores create a new folder; they never overwrite in place.
- **No telemetry, analytics, ads, or background uploads.** Any network call must be part of the package's stated scope.
- **No new runtime dependency without a note in the change set.** Prefer Electron APIs, `adm-zip`, and the existing services. A dependency needs a one-paragraph justification and a size/maintenance check.
- **Keep core logic testable.** `electron/core/*.js` must not import Electron. Inject platform behaviour (`openPath`, `trashItem`, `fetchImpl`) from `electron/main.js`.
- **Validate at the IPC boundary.** Every handler validates types, lengths, allowlists, and paths. Use `isPathInside` for any path derived from the renderer.
- **Renderer never talks to Electron directly.** Only `src/lib/api.ts` touches `window.aqua`.
- **Additive persistence.** New config fields are optional and normalized on load. Do not bump `SCHEMA_VERSION` unless a destructive migration is unavoidable; if it is, write the migration and a test.
- **User-facing errors are sentences.** Throw `new Error('...')` with an actionable message; the UI displays it via `getErrorMessage`.
- **No stack rewrites, no bundling game assets, no auth bypasses.** See the non-goals in the feature catalogue.
- **Respect the current visual language.** Reuse `PageHeader`, `Button`, `IconButton`, `EmptyState`, `Spinner`, `ConfirmDialog`, `Menu`, and the classes in `src/styles/`.
- **Every package ships with its tests.** Pure logic gets a `tests/*.test.js` case; UI gets loading, empty, error, and keyboard states.

---

## 2. Baseline map

| Layer | Files | What lives there |
|---|---|---|
| App shell | `src/App.tsx`, `src/main.tsx`, `src/components/layout/*` | Page routing, titlebar, sidebar, boot screen |
| Renderer state | `src/state/LauncherProvider.tsx` | Bootstrap payload, event subscription, toasts, dialogs, selection |
| UI kit | `src/components/ui/primitives.tsx`, `overlays.tsx`, `Menu.tsx` | Buttons, inputs, empty states, modals, menus |
| Styles | `src/styles/base.css`, `components.css`, `app.css`, `theme.css` | Global tokens and component classes |
| Preload bridge | `electron/preload.cjs` | The `window.aqua` surface |
| IPC handlers | `electron/ipc.js` | Validation, orchestration, event emission |
| Main wiring | `electron/main.js` | Service construction, window/tray, broadcast helpers |
| Persistence | `electron/core/store.js`, `paths.js` | Atomic JSON config, activity/sessions, path layout |
| Renderer client | `src/lib/api.ts`, `src/lib/types.ts` | `AquaApi` contract and shared types |
| Tests | `tests/*.test.js` | `node --test`, no Electron required |

**Commands**

| Purpose | Command |
|---|---|
| Typecheck | `npm run typecheck` |
| Unit tests | `npm test` |
| Production build | `npm run build` |
| Dev app | `npm run electron:dev` |
| Packaged app | `npm run electron:build` |

---

## 3. The golden path (adding a feature)

Follow this order. Skipping a layer is how contracts drift.

1. **Core module** — `electron/core/<feature>.js`. Export a class with constructor injection, or pure functions. No Electron imports.
2. **Wire the service** — construct it in `initialize()` in `electron/main.js`, pass dependencies, and add it to the `registerIpc({...})` call.
3. **IPC handlers** — in `electron/ipc.js`, add `ipcMain.handle('<domain>:<action>', ...)`. Validate input with local helpers (`requireString`, `requireObject`, or new validators). Return plain serializable data. Throw readable errors.
4. **Events** — if the feature pushes state, add a broadcast helper in `main.js` (`broadcast('<type>', payload)`) and pass it into the service.
5. **Preload** — add a namespaced method in `electron/preload.cjs` that calls `invoke`.
6. **Types** — add the request/response shapes to `src/lib/types.ts`.
7. **Client** — add the method signature to `AquaApi` and the `api` object in `src/lib/api.ts`. If push-based, add the event to `EventPayloadMap` and a `case` in `LauncherProvider.tsx`.
8. **UI** — build the page or panel from existing primitives. Use `useLauncher()` for shared state and `pushToast` for outcomes. Handle loading, empty, error, and success.
9. **Styles** — add classes to the relevant `src/styles/*.css` file; reuse tokens instead of hard-coded colours.
10. **Tests** — add a `tests/<feature>.test.js` for pure logic and fixtures. Keep it runnable with `node --test`.

### Adding a settings section

1. Add defaults to `createDefaultSettings()` in `electron/core/settings.js`.
2. Normalize and clamp in `normalizeSettings()`; never trust persisted JSON.
3. Validate patches in `validateSettings()`.
4. If the section is nested, add its key to the nested-merge list in `mergeSettings()` in `electron/ipc.js`.
5. Expose the controls in `src/pages/SettingsPage.tsx` and the matching `Settings` type.
6. Add a test with a malformed value and assert the fallback.

### Adding a persisted collection

1. Add the array/object to the `Store` shape in `init()` with a normalizer.
2. Cap its size (follow `MAX_ACTIVITY`, `MAX_SESSIONS`, `MAX_SERVERS`).
3. Mutate through a store method that queues an atomic write; never write from a page or handler directly.
4. Add a test that loads a file with junk entries and asserts they are dropped.

---

## 4. Definition of done

Every package must satisfy all of these before it is marked done:

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes, including new cases for the package's pure logic.
- [ ] `npm run build` passes.
- [ ] Manual smoke test on Windows: launch the app, exercise the new flow, and check the launcher log for unhandled errors.
- [ ] Loading, empty, error, and disabled states are handled in the UI.
- [ ] Keyboard focus is visible; icon-only buttons have `aria-label`s.
- [ ] Paths with spaces and non-ASCII characters work.
- [ ] No new console errors or warnings in the renderer.
- [ ] IPC input is validated; file operations are constrained with `isPathInside`.
- [ ] No user data is deleted without an explicit confirmation and a reversible path.
- [ ] The tracker row and changelog are updated.
- [ ] The package's **Out of scope** list was respected; anything deferred is recorded as a new idea, not silently built.

**Phase exit criteria** (met before starting the next phase):

- All packages in the phase are done or explicitly deferred with a reason.
- A fresh install can complete the phase's headline flow without developer tools.
- Existing world backups still restore; existing installations still launch.

---

## 5. Roadmap at a glance

| Phase | Theme | Packages | Exit outcome |
|---|---|---|---|
| 0 | Shared seams | P0.1–P0.2 | Content metadata and snapshots are reusable modules with tests |
| 1 | Trust | P1.1–P1.7 | A crash is explained, a bad mod set is escapable, and saves are backed up |
| 2 | Content depth | P2.1–P2.11 | Installed content is legible, updatable, and portable across versions |
| 3 | Daily friction | P3.1–P3.9 | Navigation, settings, and long-running work feel finished |
| 5 | Decision-gated bets | P5.1–P5.3 | Only after product sign-off; not part of the default sequence |
| 6 | Polish and maintenance | P6.1–P6.6 | Launches are guarded, logs explain themselves, and maintenance is one action |

### Safe parallel workstreams

Multiple agents can work at once if they stay in one track and respect the shared contracts.

| Track | Sequence | Owns |
|---|---|---|
| Trust / data | P0.2 → P1.3 → P1.4 | `snapshots.js`, backup IPC, backup store fields |
| Crash / health | P0.1 → P1.1 → P1.2 → P1.5 | `crash-analysis.js`, `safe-mode.js`, `health.js`, content index |
| Content | P2.1 → P2.2 → P2.3 → P2.4 → P2.5 → P2.6 → P2.7 → P2.8 → P2.10 → P2.11 | Modrinth service, content IPC, content types |
| Surface | P2.9 → P3.1 → P3.6 → P3.4 → P3.5 | Renderer components and renderer-only state |
| Platform | P4.1 → P4.2/P4.3 → P4.4 | argv/protocol handling, updater (when unblocked) |

Rules for parallel work:

- One agent per track. Do not split a package between agents.
- `electron/ipc.js`, `electron/main.js`, `electron/preload.cjs`, `src/lib/api.ts`, and `src/lib/types.ts` are collision hotspots. Re-read them immediately before editing, and keep diffs additive.
- If two tracks need the same persisted field, the first to land it owns the normalizer and the test; the other consumes it.
- P1.7 is blocked and belongs to no track until D1/D2 are answered.

---

## 6. Phase 0 — Shared seams

Build these only when the first consumer is being built. They exist to stop three packages from writing three different ZIP writers and three different jar readers.

### P0.1 · Content index and jar metadata

**Serves:** P1.5, P2.3, P2.4, P2.5, P2.8 · **Effort M** · **Depends on:** nothing

**Outcome:** One service can answer "what content is in this instance, and what is it really?" for Modrinth-managed files and hand-installed jars alike.

**Build:**
- `electron/core/content-index.js` with pure functions:
  - `readJarMetadata(filePath)` → `{ modId, name, version, authors, loader, mcRange, requiredDependencies }` from `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, `mcmod.info`.
  - `readPackMetadata(filePath)` for `pack.mcmeta` and shaderpack `shaders/*`.
  - `scanContent(gameDir, contentType)` → files with `{ filename, enabled, sizeBytes, mtimeMs, metadata }`.
- Cache at `paths.cacheRoot/content-index/<hash>.json`, keyed by directory mtime plus file mtime/size; invalidate on mismatch.
- A narrow TOML reader for the `mods.toml` keys above. Do **not** add a general TOML dependency; test the subset with real Forge/NeoForge fixtures.
- Tolerate unreadable or malformed archives: return `metadata: null` and a reason, never throw for one bad file.

**Contracts:** `content:index` (list), consumed internally first. No settings changes.

**Done when:**
- [ ] A Fabric, Quilt, Forge, and NeoForge jar each produce name/version/authors/loader without opening the game.
- [ ] A corrupt jar yields a null metadata row, not a failed scan.
- [ ] A 200-mod folder scans in under two seconds on warm cache.
- [ ] Cache invalidation works when a jar is replaced or deleted.

**Verify:** `node --test tests/content-index.test.js` with fixture jars committed under `tests/fixtures/` (tiny manifests zipped at test time, not binary blobs if avoidable).

**Out of scope:** dependency resolution, downloading missing mods, editing jars.

---

### P0.2 · Snapshot engine

**Serves:** P1.3, P1.4, P3.x server backups later · **Effort M** · **Depends on:** nothing

**Outcome:** A reusable ZIP-plus-manifest writer with retention and safe restore, extracted from the world backup implementation rather than duplicated.

**Build:**
- `electron/core/snapshots.js`:
  - `createSnapshot({ sourceDir, destinationDir, label, include, exclude, note })` → writes `<id>.zip` and updates `index.json` atomically.
  - `listSnapshots(directory)`, `pruneSnapshots(directory, { keepCount, maxTotalBytes, pinnedFirst })`.
  - `restoreSnapshot({ archive, destinationDir, folderName })` → extracts to a temp dir, validates every entry is inside it, then moves to a **new** folder. Never overwrite.
- Reuse the `adm-zip` patterns and index versioning from `electron/core/worlds.js` (`BACKUP_INDEX_VERSION`, `readBackupIndex`, `writeBackupIndex`). Refactor `WorldsService` to use the shared writer only if the existing tests stay green; otherwise leave worlds alone and note the duplication.
- Reject entries with absolute paths, `..`, NUL bytes, or symlinks. Cap extracted file count and total bytes.

**Contracts:** internal module; no IPC until P1.3/P1.4.

**Done when:**
- [ ] A snapshot round-trips a directory tree byte-for-byte.
- [ ] A malicious archive (`../escape`) is rejected without writing outside the temp root.
- [ ] Retention deletes oldest unpinned snapshots first and respects the size cap.
- [ ] An interrupted write leaves no partial `.zip` in the index.

**Verify:** `node --test tests/snapshots.test.js`, including the traversal case.

**Out of scope:** incremental/deduplicated archives, cloud destinations, encryption.

---

## 7. Phase 1 — Trust

The theme is: when something goes wrong, the launcher explains it and offers a way out. Do not start Phase 2 before P1.1–P1.5 are done.

### P1.1 · Crash Guard

`A2 · A16 · G3` · **Effort L** · **Depends on:** P0.1 (optional, for mod attribution)

**Outcome:** A non-zero exit becomes a classified explanation with concrete next actions, not a red toast.

**Build:**
- `electron/core/crash-analysis.js`: `analyzeCrash({ text, exitCode, signal, memory, javaMajor, installedMods })` → `{ category, confidence, title, summary, evidence[], actions[] }`.
- Categories and signatures: `out-of-memory`, `java-version`, `missing-dependency`, `mixin-failure`, `graphics-driver`, `corrupt-install`, `mod-conflict`, `unknown`. Keep the rules in one exported table so they are testable and reviewable.
- Read the newest `crash-reports/*.txt` and the tail (max 400 lines) of the session log in `GameManager.handleExit`. Cap the text passed to the analyzer at 512 KB.
- Extend the game state with `analysis` and persist the last 10 crashes in `Store` (`crashes`) with `{ id, installationId, at, category, title, summary, exitCode, reportPath }`. Normalize and cap on load.
- Actions are declarative (`{ id: 'raise-ram' | 'open-logs' | 'open-content' | 'launch-safe' | 'verify-install', label }`); the renderer maps them to existing dialogs/routes. Do not execute shell commands from the analyzer.
- UI: replace the body of `LaunchErrorDialog` with category, one-sentence explanation, evidence lines, and action buttons. Add a "Last crash" entry point from the dashboard/activity feed.
- No network calls. The knowledge base is local and versioned with the app.

**Contracts:**
- IPC: `crash:last`, `crash:list`, `crash:analyze` (for re-analysis after a report is selected).
- Events: extend `game` payload with `analysis`; no new channel needed for the live case.
- Store: `crashes: []`, max 10.

**Done when:**
- [ ] An OOM fixture produces "out of memory" and a "raise max RAM" action that opens the installation editor at the memory field.
- [ ] A missing-dependency fixture names the dependency from the stack/log.
- [ ] A clean exit produces no analysis and no crash dialog.
- [ ] A crash with no report still classifies from the exit code and log tail.
- [ ] Evidence lines are selectable and copyable; paths are not exposed in the primary message.

**Verify:** `node --test tests/crash-analysis.test.js` with one fixture per category plus two clean logs; manual test by forcing exit codes 1 and 137 and a real mod-induced crash.

**Out of scope:** AI explanation (`K6`), uploading reports, automatic mod removal.

---

### P1.2 · Safe Mode launch

`A1` · **Effort M** · **Depends on:** P1.1 (for the post-crash prompt; the launch path itself is independent)

**Outcome:** One click launches without mods, resource packs, or shaders, and restores the original setup afterwards — even if the game or launcher is killed.

**Build:**
- `electron/core/safe-mode.js`:
  - `stageContent(gameDir)` moves `mods/*.jar`, `resourcepacks/*.zip`, `shaderpacks/*.zip` into `.aqua/safe-mode/<sessionId>/`, writing `manifest.json` (original path, size, mtime, sha1) before each move.
  - `restoreStaged(gameDir, sessionId)`, `recoverOrphans(paths)` at startup.
  - Use `fsp.rename` within the same volume; fall back to copy+verify+remove across volumes.
- `GameManager.launch(installationId, { safeMode })`: stage before building the launch plan, record the session id in game state, and restore in `handleExit` (including crash and spawn failure). Add `app.on('before-quit')` recovery.
- Never touch worlds, `options.txt`, configs, or datapacks. Leave already-`.disabled` files alone.
- If staging partially fails, restore what was moved and refuse the launch with a clear error. Do not launch half-safe.
- UI: split Play button / menu item "Launch in Safe Mode", plus the P1.1 crash-dialog action. Show a small persistent badge while safe mode is active.
- Startup recovery runs before the window is shown; log and notify if a previous session was restored.

**Contracts:**
- IPC: extend `game:launch` with `{ safeMode?: boolean }`; add `game:recoverSafeMode` for an explicit retry.
- Event: `game` state gains `safeMode: { active, sessionId, movedFiles }`.
- No settings; this is an action, not a preference.

**Done when:**
- [ ] After a crash, mods are restored byte-identically (compare hashes).
- [ ] Killing the launcher mid-session and reopening restores the staged files from the manifest.
- [ ] Safe Mode still launches a vanilla instance and a modpack instance.
- [ ] If `mods/` is missing or empty, the launch proceeds without an error.
- [ ] The restore path refuses to overwrite a file that changed while safe mode was active; it reports the conflict instead.

**Verify:** `node --test tests/safe-mode.test.js` with temp directories and a simulated interrupted restore; manual crash test with one known-bad jar.


---

### P1.3 · Scheduled world backups

`D1 · D3` · **Effort M** · **Depends on:** P0.2

**Outcome:** Worlds are backed up automatically on game exit and on a daily schedule, with retention the user can see and control.

**Build:**
- Settings section `backups`: `{ enabled: false, onExit: true, daily: false, dailyHour: 3, retentionCount: 5, maxTotalMb: 2048 }`. Normalize and validate; defaults must not surprise existing users (off until enabled).
- `electron/core/backup-scheduler.js`: pure `isDue(policy, now, lastBackupAt)` and `planRetention(backups, policy)` functions. Main process runs a 15-minute interval plus a check on app focus; missed daily backups run once, not repeatedly.
- Hook `GameManager.handleExit`: after the session is recorded, enqueue a backup for each world changed during the session. Running backups must not block the exit dialog or the next launch.
- Skip unchanged worlds by comparing `level.dat` mtime/hash and the newest region file; record `lastBackupAt` and `contentHash` in the backup index.
- Use `JobManager` so progress appears in the existing downloads drawer, with a `backup` job kind. Cancellation must leave the previous backup intact.
- Retention: count first, then total size; never delete pinned backups (add `pinned: false` now for future `D2`).
- UI: Settings → Backups (schedule, retention, "last run", "run now"), and a "Last backup" line with relative time on each world card.
- Activity entries for automatic backups should be low-noise: only log failures and a daily summary, not one entry per world.

**Contracts:**
- IPC: `backups:settings` is covered by `settings:update`; add `backups:runNow`, `backups:status`.
- Event: `backups` payload `{ running, lastRunAt, lastResult, nextRunAt }`.
- Settings: `backups` section; per-installation optional `backupPolicy` override (normalize on load, nullable).

**Done when:**
- [ ] Enabling daily backups and setting the clock forward produces exactly one run.
- [ ] A game exit creates backups for changed worlds only.
- [ ] Retention deletes the oldest unpinned backup and keeps the newest `retentionCount`.
- [ ] A cancelled/failed backup leaves the previous ZIP and index readable.
- [ ] Restoring an automatic backup uses the existing non-destructive restore.

**Verify:** `node --test tests/backup-scheduler.test.js` for due/retention logic; manual: play, exit, confirm ZIP, restore it.

**Out of scope:** cloud destinations (`D12`), per-world schedules, incremental backups, before-launch backups (add later only if users ask).

---


### P1.5 · Instance health check

`A4` · **Effort M** · **Depends on:** P0.1

**Outcome:** One panel answers "is this installation healthy?" with a fix or a plain-English explanation for every row.

**Build:**
- `electron/core/health.js`: `checkInstallation({ installation, store, paths, javaService, versionService, contentIndex })` → `{ status, checks[] }`.
- Checks: version JSON present; client jar present; asset index present; libraries present (sample or full verify); Java detected and major-compatible; allocated RAM sane vs. system; free disk above a threshold; game directory writable; loader profile matches; duplicate mod IDs; wrong-loader jars; missing required dependencies (from P0.1 metadata); orphaned `.disabled` files; shared game directory with another installation.
- Each check: `{ id, status: 'ok'|'warn'|'error'|'unknown', title, detail, fix?: { kind, label } }`. Fix kinds are an allowlist: `reinstall`, `open-settings`, `open-folder`, `create-directory`, `open-content`.
- Never auto-delete or auto-modify. `health:fix` only performs the safe, explicit actions above.
- UI: "Check health" on the installation card opens a drawer with grouped results and per-row fix buttons. A compact summary badge shows the worst status.
- Run checks concurrently with a short cache (30s) to avoid rescanning on every open.

**Contracts:**
- IPC: `health:check`, `health:fix`, `health:summary` (all installations, cheap checks only).

**Done when:**
- [ ] A healthy instance returns all `ok` and a green summary.
- [ ] Deleting the client jar produces an `error` row with a "Repair install" action.
- [ ] A duplicate mod ID is reported with both filenames.
- [ ] An instance sharing a game directory with another is flagged with an explanation.

**Verify:** `node --test tests/health.test.js` with temp fixture dirs; manual on a real instance.

**Out of scope:** automatic repair of mods, dependency installation, server profiles.

---

### P1.6 · Disk usage and cleanup

`H1 · H2 · H4` · **Effort L** · **Depends on:** P1.5 (reuse integrity/version checks)

**Outcome:** Users can see where tens of gigabytes went and reclaim space without touching anything they care about.

**Build:**
- Handle hardlinks/dedup where practical: count a file once per scan by `(dev, ino)` when available; document the approximation.
- `cleanupCandidates(scan, { includeBackups })` returns items with `{ kind, label, path, bytes, safeByDefault, reason }`. Versions referenced by any installation are never candidates. Worlds, mods, resource packs, and configs are never candidates.
- Deletion uses `shell.trashItem` injected from main; permanent deletion is out of scope. Confirm with a summary and per-category checkboxes; default to the safest set (old logs, caches, partial downloads).
- Cap scan time and memory: stream directory walks, do not build a full file tree in memory for huge folders.
- UI: Settings → Storage with a total bar, category rows, "what is this?" tooltips, and a cleanup dialog showing reclaimable bytes.
- Add `H4` cache sizes to the same page rather than a second panel.

**Contracts:**
- IPC: `storage:scan`, `storage:clean`, `storage:cancel`.
- Event: `storage:progress` for long scans (throttled to ~4/s).

**Done when:**
- [ ] Totals match a manual `du` within 5% on a test tree.
- [ ] In-use versions are excluded even when old.
- [ ] Cleanup moves files to the OS trash and the sizes refresh afterwards.
- [ ] Cancelling a scan leaves no partial state and the app responsive.
- [ ] A path outside the launcher roots is refused.

**Verify:** `node --test tests/storage.test.js` with a fixture tree including a hardlink; manual scan of a real data folder.

**Out of scope:** world/mods cleanup, secure erase, automatic scheduled cleanup.

---

### P1.7 · Launcher auto-update

`I1` · **Effort M–L** · **Status: blocked pending decisions D1 and D2**

**Outcome:** Fixes reach users without a manual reinstall, through a signed, verifiable update channel.

**Do not start** until release hosting and code signing are chosen. The implementation is straightforward; the release plumbing is the risk.

**Build (once unblocked):**
- Add `electron-updater`; configure `publish` in `package.json` for the chosen provider.
- `electron/core/updater.js` wraps check/download/quit-and-install, exposes channels (`stable`, `beta`), and never restarts while a game is running or a download job is active.
- UI: Settings → About (version, check now, channel), a titlebar/dashboard banner when an update is ready, and a changelog modal after restart (`F13`).
- Verify signatures on Windows; fail closed with a readable error.
- Development builds skip the check unless an explicit test feed is configured.

**Contracts:** IPC `update:check`, `update:download`, `update:install`; events `update` with `{ status, version, progress, notes }`.

**Done when:**
- [ ] A locally hosted test feed offers an update, downloads it, and installs on restart.
- [ ] A corrupted or unsigned artifact is rejected with a clear message.
- [ ] An update is deferred while the game is running.
- [ ] Settings shows the current version and channel.

**Verify:** manual only, with a local update server and a signed test build. Record the exact steps in the tracker row.

**Out of scope:** delta updates, rollback to a previous version, silent forced updates.

---

## 8. Phase 2 — Content depth

### P2.1 · Mod detail pane

`B1` · **Effort M** · **Depends on:** nothing

**Outcome:** Users can evaluate a project before installing: description, gallery, changelog, versions, dependencies, license, and links.

**Build:**
- Extend `ModrinthService` with `getProject(id)` and `getVersions(id, { gameVersion, loader })`; cache responses for 10 minutes under `paths.cacheRoot/modrinth/`.
- Validate project IDs as slugs/IDs, cap response sizes, and tolerate partial API data.
- UI: side drawer over `ModsPage`, not a new route. Tabs: Overview, Versions, Dependencies. Install a specific version from the Versions tab; show compatibility badges.
- Render the description as plain text with preserved paragraphs. Do **not** add a Markdown renderer or use `dangerouslySetInnerHTML` in this package. Links open via `api.openExternal`, which already has an allowlist.
- Keep the existing card install button as the one-click path.

**Contracts:** IPC `mods:project`, `mods:versions`; types `ModrinthProjectDetail`, `ModrinthVersion`.

**Done when:**
- [ ] Opening a project shows title, icon, author, downloads, and description without layout shift.
- [ ] Versions are filtered to the selected MC version and loader, with an "all versions" escape hatch.
- [ ] Installing a specific version updates the installed list and toast.
- [ ] API failure shows an inline retry, not an empty drawer.
- [ ] Drawer traps focus and closes on Escape.

**Out of scope:** comments, user reviews, following projects, Markdown rendering.

---

### P2.2 · Search filters and sorting

`B2` · **Effort M** · **Depends on:** P2.1 (shares version/loader metadata)

**Outcome:** The content browser becomes a catalogue instead of a search box.

**Build:**
- Extend `mods:search` options with `facets`, `sort`, `categories`, `environment`, `license`, and `openSource`; validate every value against allowlists in `modrinth.js`.
- Build facets from the selected MC version, loader, and content type. Send them as Modrinth's `facets` JSON; do not hand-concatenate unvalidated strings.
- UI: collapsible filter bar with category chips, loader/version selects, environment toggle, license select, and sort select (`relevance`, `downloads`, `follows`, `newest`, `updated`). Show active-filter count and "Clear all".
- Persist filters per content type in `settings.contentFilters` (small, validated map). Reset when the installation's version changes in a way that invalidates them.
- Infinite scroll or "Load more" using the existing `offset`/`limit`; cancel in-flight searches when the query changes (the page already uses a sequence ref).
- Empty state explains which filter is responsible and offers "Clear filters".

**Contracts:** settings `contentFilters`; no new IPC channel.

**Done when:**
- [ ] Filtering by loader + version returns only compatible results.
- [ ] Sort changes the result order and survives a page reload.
- [ ] Clearing filters restores the default search.
- [ ] Rapid typing does not produce out-of-order results.
- [ ] Keyboard users can reach and operate every filter.

**Out of scope:** server-side saved searches, CurseForge facets.

---

### P2.3 · Local jar inspector

`B4` · **Effort M** · **Depends on:** P0.1

**Outcome:** Hand-installed jars stop being anonymous filenames.

**Build:**
- Surface `content-index` data in the installed-content list: real name, version, authors, loader, MC range, and a warning badge when metadata is missing or incompatible.
- Add a per-file detail drawer with the raw metadata, file size, install date, and "open containing folder".
- Detect duplicate mod IDs and wrong-loader jars in the list header; link to P2.4 for the full report.
- Keep the existing enable/disable/remove actions; do not change file naming.

**Contracts:** extend `mods:list` response with metadata; add `content:file` for one file.

**Done when:**
- [ ] A hand-copied Fabric jar shows its display name and version.
- [ ] A Forge jar in a Fabric instance is flagged.
- [ ] A jar with no metadata shows the filename and a clear "no metadata" note.
- [ ] The list still loads quickly with 200 jars (cache warm).

**Out of scope:** editing metadata, remapping jars, Modrinth hash lookup for unknown files (add later if desired).

---

### P2.4 · Dependency and conflict checker

`B5` · **Effort L** · **Depends on:** P2.3

**Outcome:** The launcher explains "why won't this start?" in terms of the mods the user sees.

**Build:**
- `electron/core/content-conflicts.js`: pure `findConflicts(index)` → `{ missingDependencies, duplicateIds, loaderMismatch, versionMismatch, knownIncompatible }`.
- Match dependency IDs against installed mod IDs; treat `minecraft` and `java` as satisfied. Compare MC ranges with a small, tested semver-range subset (no new dependency).
- Keep the curated incompatible-pairs list in one exported table with a comment/source for each entry; start small and conservative.
- Actions: disable a file, open its folder, copy a diagnostic summary. Do not auto-install dependencies in this package.
- UI: a "Issues" banner on the content page with counts and a drawer listing each issue, the files involved, and the consequence.

**Contracts:** IPC `content:conflicts`; no persistence.

**Done when:**
- [ ] A missing required dependency is reported with the dependent mod's name.
- [ ] Duplicate mod IDs list both jars.
- [ ] A correct, healthy mod set returns zero conflicts.
- [ ] Disabling a file from the report refreshes the report.
- [ ] No false positive for optional dependencies.

**Out of scope:** auto-fix, downloading dependencies, transitive resolution beyond declared metadata.

---

### P2.5 · Drag-and-drop import

`B6` · **Effort S–M** · **Depends on:** P2.6 for the `.mrpack` route; jar drops are independent

**Outcome:** Dropping a file anywhere in the window installs it into the right place, with a confirmation.

**Build:**
- Renderer: a full-window drop overlay (`dragenter`/`dragover`/`dragleave`/`drop`), disabled while a modal is open.
- Electron 32+ removed `File.path`; resolve real paths in preload with `webUtils.getPathForFile(file)` and expose `files.getPath(file)` (or pass the `File` to a preload helper). Do not re-enable `nodeIntegration`.
- Validate in main: absolute path, allowed extension, not a symlink, destination inside the instance. Copy, never move the user's original.
- Confirm before writing when a file with the same name exists; offer replace/skip/keep-both.
- Show a summary toast with counts and any failures.

**Contracts:** IPC `content:importFiles` with `{ installationId, contentType, paths[] }`; preload `files.getPath`.

**Done when:**
- [ ] Dropping one jar installs it and refreshes the list.
- [ ] Dropping a `.zip` shader pack lands in `shaderpacks/`, not `resourcepacks/`.
- [ ] Duplicate filename prompts instead of overwriting.
- [ ] Dropping while the game is running is allowed but clearly reported.
- [ ] A path outside the drop set is rejected.

**Out of scope:** drag-out, multi-instance targeting, downloading linked files from a dropped URL.

---

### P2.6 · Local modpack import

`B7` · **Effort L** · **Depends on:** P0.1, P2.5

**Outcome:** A pack downloaded from anywhere becomes a working Aqua installation without retyping loader and version.

**Build (v1 scope):** `.mrpack` and Prism/MultiMC instance folders. Defer CurseForge zips and packwiz until D3 is decided.
- `.mrpack`: read `modrinth.index.json`, validate `formatVersion`, resolve `dependencies.minecraft` and `dependencies.fabric-loader`/`quilt-loader`/`forge`/`neoforge`, create the installation, download `files[]` with the existing downloader (verify `hashes.sha1`), copy `overrides/` into the game dir.
- Prism folder: read `instance.cfg` and `mmc-pack.json`, map components to MC/loader, then copy `minecraft/` content or adopt the directory in place if the user chooses. Never move the source without confirmation.
- Report every failed file with a reason; keep a partial import resumable.
- Create the profile only after the manifest validates; on failure, remove the half-created profile but leave downloaded caches.
- UI: "Import pack" on the installations page and drop target; a progress dialog with per-file counts and a cancel that stops cleanly.

**Contracts:** IPC `mods:importPack`, `mods:inspectPack`; job kind `modpack-import`.

**Done when:**
- [ ] A real `.mrpack` imports, launches, and matches the manifest's mod count.
- [ ] A pack with a missing loader version fails with a readable message before creating a profile.
- [ ] A cancelled import leaves no broken installation.
- [ ] Overrides land in the game directory, not the launcher data directory.
- [ ] Zip-slip entries in overrides are rejected.

**Out of scope:** CurseForge/packwiz, pack updating, publishing.

---

### P2.7 · Modpack export

`B8` · **Effort M** · **Depends on:** P2.6

**Outcome:** Any instance can be shared as a `.mrpack` and imported on another PC.

**Build:**
- `mods:exportPack(installationId, { includeWorlds: false })`:
  - Read installed files; for Modrinth-matched files, write `files[]` entries with `path`, `hashes`, `downloads`, `fileSize`.
  - For unmatched jars/configs, place them under `overrides/` and list them in the summary so the author knows what is not downloadable.
  - Validate `pack.mcmeta`/loader metadata and write `modrinth.index.json` with the correct `formatVersion`.
- Save dialog via `dialog.showSaveDialog`; build in a temp directory and move the finished ZIP atomically.
- Exclude worlds by default; include `saves/` only with an explicit checkbox and a size warning.
- UI: "Export pack" in the installation menu; show counts (downloadable vs. bundled) before writing.

**Contracts:** IPC `mods:exportPack`, `mods:exportPreview`.

**Done when:**
- [ ] Export → import on a clean profile produces the same mod list.
- [ ] Non-Modrinth jars are bundled and the summary says so.
- [ ] Worlds are excluded unless requested.
- [ ] Cancelling leaves no partial file.

**Out of scope:** publishing to Modrinth, pack versioning, signing.

---

### P2.8 · Datapacks

`B12 · D10` · **Effort M** · **Depends on:** P0.1

**Outcome:** Datapacks become a supported content type instead of a manual folder.

**Build:**
- Add `datapack` to `src/lib/contentTypes.ts` and the Modrinth service's allowlist.
- Installation requires a target world: list `saves/*` and install into `saves/<world>/datapacks/`. Disable by renaming to `.zip.disabled`; remove with confirmation.
- Validate `pack.mcmeta` and compare `pack_format` with the world's Minecraft version; warn on mismatch but allow it.
- UI: a world picker in the install flow and a per-world datapack list in the Worlds page.
- Reuse the existing search/detail components rather than a new page.

**Contracts:** `mods:*` methods accept `datapack` plus `{ worldFolder }`; types updated.

**Done when:**
- [ ] Installing a datapack asks for a world when more than one exists.
- [ ] Enable/disable/remove works and the world's file tree is correct.
- [ ] A pack with the wrong `pack_format` shows a warning, not a hard block.
- [ ] A world with no `datapacks/` folder gets one created safely.

**Out of scope:** editing datapack contents, datapack loaders, server datapacks.

---

### P2.9 · Screenshot gallery

`F4` · **Effort M** · **Depends on:** nothing

**Outcome:** Every session's screenshots are visible, browsable, and usable as art.

**Build:**
- `electron/core/screenshots.js`: list image files in `<gameDir>/screenshots`, newest first, with size/mtime/dimensions. Generate thumbnails with `nativeImage.createThumbnailFromPath` and cache under `paths.cacheRoot/screenshots/` keyed by path+mtime.
- IPC: list, open (shell), reveal, delete (trash), and `setAsBackground` (copy to a launcher-owned art folder and store the path in settings).
- Limit concurrent thumbnail generation and clean up thumbnails for deleted files.

**Contracts:** IPC `screenshots:list`, `screenshots:thumbnail`, `screenshots:delete`, `screenshots:setBackground`; settings `dashboardBackground`.

**Done when:**
- [x] 500 screenshots open without freezing; thumbnails load progressively.
- [x] Deleting moves the file to the OS trash and removes the thumbnail.
- [x] Setting a background survives a restart and can be cleared.
- [x] Non-image files in the folder are ignored.
- [x] A missing folder shows a helpful empty state.


---

### P2.10 · Installed-content updates

`B11` · **Effort S** · **Depends on:** the Modrinth content matching shipped with Extra content

**Outcome:** Every installed file can be checked against its newest compatible Modrinth release, updated on its own, or updated all at once without silently dropping a disabled file.

**Build:**
- `ModrinthService.checkUpdates(installation, contentType)` hashes each file in the content folder, looks the hash up on Modrinth, and returns `{ filename, currentVersionId, latestVersionId, currentVersionNumber, latestVersionNumber }` for files with a newer compatible release.
- `ModrinthService.update(...)` resolves the newest version of the same project for the profile's loader and Minecraft version, downloads it beside the old jar, and removes the old file only after the new one is complete. A disabled file stays disabled.
- Renderer: an **Update** flag with a version arrow per row, a per-row update action, and **Update all**, which runs sequentially, keeps going after a failure, and reports what changed.
- Modpacks are excluded: a modpack profile is updated by installing a newer pack version rather than editing the pack in place.

**Contracts:** `mods:checkUpdates` returns `ModUpdatesResult`; `mods:update` takes `{ installationId, filename, versionId, contentType }` and returns `ModUpdateResult`.

**Done when:**
- [x] A file with no Modrinth match is skipped, not reported as an error.
- [x] Updating a disabled file leaves it disabled.
- [x] The old jar is removed only after the replacement exists.
- [x] Update all continues past one failed file and names it.
- [x] A modpack profile shows the "update the pack" path instead of per-file updates.

**Verify:** `npm test`; manual check with an out-of-date Fabric mod.

**Out of scope:** CurseForge files, pinning or skipping specific versions, automatic background updates.

---

### P2.11 · Cross-version mod retargeting

`B14` · **Effort M** · **Depends on:** P0.1 for jar metadata

**Outcome:** A mod that only blocks itself with an old Minecraft range can be made loadable in the selected profile, with one click and an undo.

**Build:**
- `electron/core/mod-retarget.js` reads `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, and `META-INF/neoforge.mods.toml`, and understands Fabric/Quilt range lists, Maven ranges, and Forge single-range dependency tables.
- `analyze(installation, filename)` reports the loader, the declared Minecraft ranges, whether the target version is already allowed, and which ranges would be rewritten.
- `retarget(...)` rewrites only the Minecraft declaration for the profile's version, writes the jar atomically, and keeps the original as a `.bak` beside it; `undo(...)` restores it.
- Refuse when the target loader differs from the jar's loader, when the target version cannot be parsed, or when the archive has no recognised metadata.
- Dialog: loader, current range, target version, and the warning that code-level API changes are not fixed; confirm, then refresh the installed list.

**Contracts:** `mods:retargetInfo`, `mods:retarget`, `mods:retargetUndo`; `ModRetargetAnalysis` type.

**Done when:**
- [x] A Fabric jar with `>=1.20 <1.21` retargets to the profile version and the game stops rejecting it on load.
- [x] A Forge jar with a Maven range is handled without adding a TOML parser.
- [x] Undo restores the exact original bytes.
- [x] A jar from another loader, or with unreadable metadata, is refused with a sentence.
- [x] The original jar is never left half-written when the process stops mid-save.

**Verify:** `node --test tests/mod-retarget.test.js`.

**Out of scope:** porting code, mixing loaders, retargeting resource packs, bulk retargeting.

---

## 9. Phase 3 — Daily friction

### P3.1 · Command palette and global search

`F1 · F2` · **Effort M** · **Depends on:** P2.x navigation targets

**Outcome:** `Ctrl+K` reaches any page, installation, world, server, mod, or setting in two keystrokes.

**Build:**
- A renderer-only palette with a fuzzy matcher over a local index built from `useLauncher()` data. No new dependency; a simple subsequence scorer is enough and testable.
- Commands: navigate, launch instance, launch safe mode, open folder, install version, toggle a setting, check updates, open downloads, open logs.
- Global search groups results (Installations, Worlds, Servers, Content, Settings) and supports arrow keys, Enter, Escape, and recent items.
- Server addresses and account names are searchable but never written to logs.
- Keyboard shortcut registration respects text inputs and dialogs; document shortcuts in `F3` later.

**Done when:**
- [x] `Ctrl+K` opens and closes without focus leaks.
- [x] Typing "surv" ranks Survival worlds above unrelated matches.
- [x] Launching from the palette uses the same confirmation path as the Play button.
- [x] Search works with 100+ installations and 1,000 worlds without visible lag.

**Out of scope:** searching log contents (that stays in the Logs page), remote search.

---

### P3.2 · Per-server instance binding and compatibility warnings

`C8 · C12` · **Effort S–M** · **Depends on:** nothing

**Outcome:** Joining a server uses the right profile and warns before an avoidable failure.

**Build:**
- Add `installationId` to server entries (nullable, normalized, cleared when the installation is deleted).
- Quick Join uses the bound installation, falling back to the active one with a visible note.
- UI: instance picker in the server editor; a warning sheet in the join flow; a compatibility badge on server cards.

**Done when:**
- [x] A bound server launches its own instance even when another is active.
- [x] Deleting the bound instance clears the binding without breaking the server row.
- [x] A version mismatch shows the server and instance versions side by side.

**Out of scope:** server-side mod verification (`K2`), auto-installing missing mods.

---

### P3.3 · LAN world discovery

`C7` · **Effort S–M** · **Depends on:** P3.2

**Outcome:** Open LAN worlds appear in the server list without typing an IP.

**Build:**
- Listen on UDP 4445 for Minecraft's LAN broadcast (`[MOTD]...[/MOTD][AD]port[/AD]`), dedupe by address+port, expire entries after ~10s without a broadcast.
- Expose discovered worlds with MOTD, port, and source address; join via the existing Quick Play path with `localhost:<port>`.
- Handle firewalls and multiple interfaces without crashing; stop listening when the app quits.
- UI: a "LAN worlds" section above saved servers, with a refresh indicator and a clear explanation that the host must open the world to LAN.

**Done when:**
- [x] A world opened to LAN appears within 5 seconds.
- [x] Closing the world removes it after the TTL.
- [x] Joining uses the configured instance binding.
- [x] The UDP socket closes cleanly on quit and does not leak on hot reload.

**Out of scope:** hosting a LAN world, Wake-on-LAN, cross-subnet discovery.

---

### P3.4 · Notification center

`F7` · **Effort M** · **Depends on:** P1.1 for crash entries

**Outcome:** Download, crash, update, and backup events remain readable after the toast disappears.

**Build:**
- Store the last 50 notifications in `Store` (`notifications`), with `{ id, level, title, message, at, read, action? }`.
- Main: a `notify()` helper that persists and broadcasts; existing `emitNotification` call sites migrate to it. Avoid duplicate entries for the same job state.
- Renderer: a bell in the titlebar with unread count, a popover list, mark-all-read, and click-through actions. Native OS notifications only when the window is hidden or unfocused.
- Respect a `notifications` settings section (`{ enabled, native, levels }`) and never notify for routine success unless enabled.

**Done when:**
- [x] Completing a download creates one entry, not one per file.
- [x] A crash entry links to the crash report.
- [x] Unread state survives a restart.
- [x] Clearing the list does not delete diagnostics.
- [x] Native notifications are off when the setting is off.

**Out of scope:** notification grouping rules beyond job IDs, email/push.

---

### P3.5 · Playtime and activity stats

`A10` · **Effort M** · **Depends on:** nothing (uses the existing session store)

**Outcome:** The existing session data becomes a useful, local-only stats page.

**Build:**
- Derive stats from `store.sessions` and `installations` (no new tracking): total/per-instance playtime, sessions per week, most-played versions, current streak, calendar heatmap, recent crashes.
- Add a `stats:summary` IPC that computes server-side and returns a compact payload; cap the date range to the stored history.
- UI: a section on the dashboard or a "Stats" page with a 12-week heatmap, top instances, and CSV export via save dialog.
- Handle timezone boundaries consistently (use local dates for the heatmap, UTC for storage).
- Never upload or compare with other users.

**Done when:**
- [x] Totals match the sum of session durations.
- [x] Timezone boundary sessions land on the expected local day.
- [x] CSV export includes ISO timestamps and instance names.
- [x] Empty history shows zeros, not a broken chart.

**Out of scope:** FPS, achievements, cross-device sync.

---

### P3.6 · Instance organization

`F15` · **Effort M** · **Depends on:** nothing

**Outcome:** A long installation list becomes navigable: pin, tag, group, sort, and colour.

**Build:**
- Extend installation metadata with `pinned`, `tags[]`, `color`, `coverPath` (normalized, capped). Keep `lastPlayedAt` sorting as the default.
- UI: pin toggle, tag editor, group/folder filter, compact/list view toggle, drag-to-reorder when "custom" sort is chosen.
- Persist order explicitly (`sortIndex`) rather than relying on array order in config.
- Keep the dashboard "active installation" behaviour; pinned items do not change the active profile.
- Deleting an installation removes it from groups but keeps the game directory (existing behaviour).

**Done when:**
- [x] Pinning survives a restart and appears first in the sidebar/list.
- [x] Tags filter the list and can be cleared.
- [x] Custom order persists and is not clobbered by a launch.
- [x] A deleted installation leaves no dangling group references.
- [ ] The compact view remains readable at 1040px width.

**Out of scope:** nested folders, sharing layouts, per-instance themes.

---

### P3.7 · Shared Minecraft client settings

`J2` · **Effort S** · **Depends on:** nothing

**Outcome:** Video, audio, control, language, shader, and server-list settings can be kept identical across installations without copying mod configs or saves.

**Build:**
- `electron/core/minecraft-settings.js`: `MINECRAFT_SETTING_FILES` is `options.txt`, `optionsof.txt`, `optionsshaders.txt`, and `servers.dat`. `capture(installation)`, `apply(installation)`, `applyAll()`, and `status()` copy only those names, refuse paths outside the settings folder, and record which files were skipped.
- The shared copy lives under `minecraft-settings/` in the launcher data folder; `settings.minecraftSettings.sync` defaults to on.
- With sync on, apply the shared copy before a Java launch and capture it after the game exits, so one in-game change follows the user to the next profile.
- UI: Settings → Minecraft settings with the sync switch, stored file list and save time, **Save from …**, **Apply here**, and **Apply to all**.

**Contracts:** `minecraftSettings:status|capture|apply|applyAll`; `settings.minecraftSettings.sync`.

**Done when:**
- [x] Only the four settings files are ever copied.
- [x] A launch with sync on applies the shared files first; a clean exit captures the new ones.
- [x] A missing file is skipped without failing the rest.
- [x] The panel shows what is stored and when it was last saved.

**Verify:** manual two-profile round trip; `npm test`.

**Out of scope:** mod configs, keybinds beyond `options.txt`, cloud sync, per-installation opt-out.

---

### P3.8 · Unified task board


**Outcome:** Every long-running launcher task is visible in one place with its progress, and can be cancelled, retried, or cleared.

**Build:**
- Each card shows kind, title, stage, progress, bytes or file counts, speed, time remaining, error text, and contextual actions: cancel while active, retry a failed game install, open the game folder when finished.
- A sidebar footer entry shows the running count; installation cards keep their **Open Tasks** link.
- **Clear finished** clears completed download jobs through `downloads:clearFinished`; the other kinds are session state and disappear on their own.
- Live speed and ETA reuse the existing `useNow` ticker; do not add a second interval.


**Done when:**
- [x] A failed install offers retry; a finished one offers its folder.
- [x] Cancelling from the board updates the source page as well.
- [x] The empty state explains what will appear here.
- [x] A job is not listed twice when it is both queued and broadcast.

**Verify:** one manual run of each kind; `npm run typecheck`.

**Out of scope:** persistent task history, background scheduling, OS notifications.

---

### P3.9 · Version artwork on the dashboard

`D6` · **Effort M** · **Depends on:** nothing


**Build:**
- `electron/core/artwork.js`: ask `https://aqua.ch1n.dev/api/launcher/artwork/<version>.png` first, verify the PNG signature, cache it under `cache/artwork/`, and retry a miss later.
- Walk forward through the version's own update line when a release has no art of its own (1.7.6 → 1.7.10, 1.20.1 → 1.20.2) without borrowing across updates (1.5 never takes 1.6 art).
- Fall back to the Mojang pipeline: read the version's patch notes, find its game drop, download the drop's wallpaper pack, keep the sharpest wide image, and cache a 1920 px JPEG. Versions older than the published drops use `public/artwork/background.*`.

**Contracts:** `artwork:versionArt`; no settings.

**Done when:**
- [x] A version with Aqua art shows it after a restart and with the network off.
- [x] A version without art borrows only from its own update line.
- [x] The Mojang fallback produces a cached 1920 px image.
- [x] A failed download leaves the previous background in place.
- [x] The endpoint is never asked for a version outside the manifest.

**Verify:** `npm test`; manual check of 1.7.10, 1.20.1, and 1.5.

**Out of scope:** uploads beyond `public/artwork/`, animated backgrounds, video.

---

## 10. Phase 4 — Platform reach

### P4.1 · Deep links and CLI

`I4 · I5` · **Effort M** · **Depends on:** P3.1 for routing

**Outcome:** `aqua://join?server=…` and `aqua launch <instance>` work from a browser, Discord, or a script.

**Build:**
- Register the `aqua` protocol with `app.setAsDefaultProtocolClient`; handle `open-url` (macOS) and `second-instance` argv (Windows/Linux). The single-instance lock already exists.
- Route actions through the same handlers as the UI: `launch`, `join`, `install`, `open`. Validate addresses and IDs; never accept arbitrary paths.
- CLI parser for `aqua launch|join|install|status` with `--json`; when an instance is already running, forward to it instead of starting a second process.
- Security: treat deep links as untrusted input; show a confirmation for anything that installs or launches, unless the user passes an explicit `--yes` in the CLI.
- UI: a small "Links" section in Settings with the registered scheme and a copyable example.

**Done when:**
- [x] A browser link joins the right server with the bound instance.
- [x] A second launch forwards to the running app.
- [x] A malformed or unknown action exits with a readable error and no side effects.
- [x] `aqua status --json` is parseable and does not include tokens.
- [x] Uninstalling the app does not leave a broken protocol handler on Windows (best effort, documented).

**Out of scope:** a full package manager CLI, remote control API.

---

### P4.2 · Import from other launchers

`I3` · **Effort L** · **Depends on:** P2.6

**Outcome:** Switching launchers does not mean redownloading everything.

**Build:**
- Detect vanilla `.minecraft`, Prism/MultiMC, CurseForge profiles, and ATLauncher (read-only) in standard locations plus a user-chosen folder.
- Present candidates with name, MC version, loader, mod count, and size; let the user select.
- Adopt in place when the directory is usable (recommended), or copy when the user asks. Never modify the source launcher's files.
- Import worlds by registering the saves path or copying on request; import mods/configs per profile; skip caches and libraries that Aqua can re-download.
- Report per-profile results and keep a rollback path (remove the created Aqua profile only; never the source).
- CurseForge import stays file-based until D3 is decided.

**Done when:**
- [x] A Prism instance with Fabric + 20 mods imports and launches.
- [x] A vanilla `.minecraft` imports saves without copying gigabytes when adopting in place.
- [x] The source directory is unchanged (hash a sample before/after).
- [x] A failed import leaves the source intact and no half-profile.
- [x] Duplicate profile names get a suffix instead of overwriting.

**Out of scope:** importing accounts/tokens, importing launcher settings wholesale, CurseForge API.

---

### P4.3 · Portable mode

`I2` · **Effort S–M** · **Depends on:** P4.1 (argv handling)

**Outcome:** Aqua can live on a USB stick or a synced folder with no AppData writes.

**Build:**
- If `--portable` is passed or a `portable.txt` marker sits next to the executable, set the data root to `<exeDir>/AquaData` before `app.setPath('userData', …)`.
- Point `userData`, `sessionData`, Electron logs, crash dumps and default downloads at the portable tree, and adjust `paths.js`, the single-instance lock, tray/resource icon resolution, and update behaviour (portable builds do not auto-update in place).
- Warn when the folder is read-only; fall back with a readable error rather than a crash.
- Settings → About shows the active data root and a "portable" badge.
- No registry writes; login-at-startup is disabled in portable mode.

**Done when:**
- [x] Running from a read/write USB folder creates all data beside the executable.
- [ ] No files appear in AppData for a portable run (verify with Process Monitor or a clean VM).
- [x] The app still starts when the marker exists but the folder is read-only (clear error).
- [x] Unplugging the drive does not corrupt config on next start (atomic writes hold).

**Out of scope:** portable Java runtime bundling, portable updates.

---

### P4.4 · Discord Rich Presence

`I6` · **Effort M** · **Depends on:** P1.1 (game state); D2 answered for Discord on 2026-11-03

**Outcome:** The active instance, version, loader, and (opt-in) server appear on the user's Discord profile with a Join button where possible.

**Build:**
- Talk to Discord's local IPC socket directly (no SDK or new dependency): try `discord-ipc-0…9`, handshake lazily, and retry with exponential backoff while a game is running.
- Read the application ID from `AQUA_DISCORD_CLIENT_ID`; an unconfigured build stays inert instead of failing. [Register an application](https://discord.com/developers/applications) for a build that should publish presence.
- Settings `discord: { enabled: false, showServer: false }`; off by default. Never send account names, UUIDs, paths, or chat. The address is sent only when both settings allow it.
- Update on game state transitions; clear presence on exit, crash, disable, or disconnect. A missing Discord client produces one debug line, never a toast or retry-log spam.
- Encode the opted-in address into the join secret so Discord shows a Join action; an incoming request opens the normal confirmation flow.

**Done when:**
- [x] Presence appears within 5 seconds of launch and clears on exit.
- [x] Disabling the setting removes presence immediately.
- [x] Discord absent produces no error toasts or log spam.
- [x] Server address is hidden unless both settings allow it.

**Verify:** `node --test tests/discord-presence.test.js`. The protocol, privacy, retry and join paths are covered without a live client; a real presence check needs a registered application ID and Discord running.


---

### P4.5 · Accessibility pass

`F11` · **Effort M** · **Depends on:** P3.1

**Outcome:** The launcher is usable with a keyboard and a screen reader, and comfortable at high contrast.

**Build:**
- Audit with keyboard-only navigation and a screen reader (NVDA on Windows). Fix focus order, traps, and return focus after dialogs.
- Add `aria-label`s to icon-only buttons, `aria-live` for toasts and job progress, and roles for tabs/lists.
- High-contrast theme + reduced transparency setting; ensure contrast ratios ≥ 4.5:1 for body text.
- Respect `prefers-reduced-motion` and the existing `reduceMotion` setting for all new animation.
- Increase hit targets to at least 32×32 px; ensure visible focus rings on custom blocks/chrome.
- Add a short accessibility section to the README.

**Done when:**
- [x] Every page is reachable and operable with Tab/Shift+Tab/Enter/Escape.
- [x] The command palette and modals return focus correctly.
- [x] A screen reader announces page changes and job completion.
- [x] High-contrast mode passes a contrast check on all surfaces.
- [x] No motion runs when reduced motion is on.


---

### P4.6 · Localization foundation

`F12` · **Effort XL** · **Status: decision-gated (D4)**

**Do not start** until the first language set is chosen. This is a framework project, not a translation drop.

**Build (once unblocked):**
- An i18n layer with message extraction, plural/date/number formatting, and a fallback chain.
- RTL layout support for the chosen languages; avoid string concatenation and hard-coded word order.
- Community translation files loaded from a folder; a settings language picker with a restart prompt where needed.
- A pseudo-locale for testing long strings; a missing-key report in development.
- Translate the shell and high-traffic pages first, then the rest.

**Done when:**
- [ ] The app runs in the pseudo-locale without clipped critical controls.
- [ ] Switching languages updates the UI without a restart where feasible.
- [ ] Missing keys fall back to English and log once.
- [ ] Dates/numbers use the selected locale.
- [ ] RTL mirrors the layout without breaking the titlebar or drawers.

**Out of scope:** machine translation, translating mod descriptions.

---





## 11. Phase 5 — Decision-gated big bets

Do not schedule these until the product questions are answered. They are listed so the architecture does not accidentally block them. Unlike Phases 0–4, these are scopes rather than executable packages: write their acceptance criteria when the gate opens.

### P5.1 · Local server manager

`C1 · C2 · C3 · C5 · C15` · **Effort XL** · **Depends on:** P1.3 (backup engine), P1.5 (Java checks), D5

**Scope if approved:** create/run Paper, Vanilla, Fabric, Forge, or NeoForge servers; EULA acceptance; RAM; start/stop/restart; crash restart; console; `server.properties` form; plugin install from Modrinth; scheduled server backups; port/firewall checks.

**Architecture notes:** a `server-manager.js` service owning child processes, a per-server data directory under `paths.dataRoot/servers/<id>`, and a job/event channel separate from game state. Do not reuse `GameManager` for servers; the lifecycle and logging differ.

**Gate:** confirm the support burden and whether managed hosting (`K1`) is in scope.

---

### P5.2 · Server pack sync

`K2` · **Effort XL** · **Depends on:** P2.6, P3.2

Read a server's packwiz/server-pack manifest, install the required client mods before joining, and detect drift on later joins. Requires a trust model for remote manifests (signatures or explicit user approval) and a rollback path. Do not auto-install from an unverified URL.

---

### P5.3 · World map renderer

`K3` · **Effort XL** · **Depends on:** nothing, but it is a product bet

Anvil region parsing, chunk decoding, texture atlas sampling, and a canvas renderer. Treat as a separate project with its own performance budget; do not attach it to P1/P2 work.

---

## 12. Phase 6 — Polish and maintenance

These are additive packages for after the current roadmap. None needs a product decision, a hosted service, or a new runtime dependency. They are ordered by how often a player meets the problem.

### P6.1 · Pre-launch checklist

`A5 · H5` · **Effort S–M** · **Depends on:** P1.5

**Outcome:** Before Play, Aqua explains the few problems that actually stop a launch — missing files, a Java mismatch, impossible memory, or a nearly full disk — and offers the safe fix in the same sheet.

**Build:**
- `electron/core/preflight.js` with pure `buildPreflight({ installation, health, system, settings })` → rows `{ id, level, title, detail, action }`. Actions reuse the Health allow-list (`reinstall`, `open-settings`, `open-folder`, `create-directory`, `open-content`).
- Reuse the HealthService cache; add a disk-headroom check that blocks below 2 GB free and names the number. Memory above 70% of installed RAM is a warning; a 32-bit runtime or a missing client jar is an error.
- Show one sheet per session per profile. Warnings can be dismissed and the launch retried; errors disable Play until fixed. A healthy profile launches with no sheet.
- Never download or change Java automatically; every action opens an existing safe surface.

**Contracts:** `launch:preflight`; no settings or store changes.

**Done when:**
- [ ] A missing client jar and an incompatible Java runtime block with a specific row.
- [ ] Low disk names the free space and the 2 GB floor.
- [ ] A warning can be dismissed for the session without hiding an error.
- [ ] A healthy profile reaches the game with no extra click.
- [ ] The disk and memory rules are covered by pure tests.

**Verify:** `node --test tests/preflight.test.js`; manual: break one game file, confirm the sheet and the Repair action.

**Out of scope:** automatic Java installs, downloading missing assets from the sheet.

---

### P6.2 · Launch queue

`A9` · **Effort S** · **Depends on:** P6.1

**Outcome:** Pressing Play while another launch is preparing or running queues the request instead of throwing an error, and Aqua starts it when the current session ends.

**Build:**
- A session-only queue in the main process, one entry per installation, with `{ id, installationId, safeMode, requestedAt, reason }`. Never persist account or server secrets; the request reuses the normal launch path.
- Queue when the game is running, when a launch is preparing, or when a profile is still installing (then wait for its `install` job). `launch:queue`, `launch:dequeue`, `launch:list`; broadcast `launch-queue` on every change.
- Drain on a clean exit only. A crash or failed launch leaves the queue paused with a visible retry action, so a broken profile is not launched automatically.
- UI: Play becomes **Queue launch** while busy, with a small queued badge and a Tasks-page section for remove and **Launch now**.

**Contracts:** `launch:queue`, `launch:dequeue`, `launch:list`; event `launch-queue`; no store changes.

**Done when:**
- [ ] Double Play queues one entry, not two and not an error.
- [ ] A queued launch waits for an in-flight install.
- [ ] Removing a queued entry never affects the running game.
- [ ] A clean exit starts the next entry; a crash pauses it.
- [ ] Queue ordering and deduplication are covered by tests.

**Verify:** `node --test tests/launch-queue.test.js`.

**Out of scope:** two games at once, pre-empting a running game, cross-device queues.

---

### P6.3 · Log tail and mod attribution

`G1 · G2` · **Effort M** · **Depends on:** P1.1, P0.1

**Outcome:** A running log can be followed live, searched, and read with mod names attached to the stack lines that belong to them.

**Build:**
- `electron/core/log-tail.js` reads from a stored byte offset instead of re-reading the file, tolerates truncation and rotation, and returns at most 500 lines per batch. Attribute frames with the cached content index: match logger names and package segments to mod ids/names, keeping unknown lines unlabelled.
- `logs:tail` starts/stops a watch for one log path; batch updates on a 250 ms timer and broadcast `logs:tail`. Stop on file change, game exit, or window close.
- Viewer: Follow/Pause, text search across the tail, level filter, **Jump to first error**, and a mod chip on attributed lines that filters the view. Copy keeps the existing redaction.
- No regex input: a bad pattern must not freeze the renderer. Plain text only.

**Contracts:** `logs:tail`; event `logs:tail`; no settings or store changes.

**Done when:**
- [ ] Follow adds only new bytes and survives a truncated file.
- [ ] Pause holds the view while the file keeps growing.
- [ ] Jump lands on the first error/warn line, not the first info line.
- [ ] A Create/Forge-style frame is attributed to its mod; an unknown frame stays plain.
- [ ] Switching sessions stops the old watcher.
- [ ] Offset/rotation and attribution are covered by tests.

**Verify:** `node --test tests/log-tail.test.js`; manual: launch, follow, search, and jump during a session.

**Out of scope:** regex search, JVM metrics, uploading logs.

---

### P6.4 · Verify-all maintenance

`H3` · **Effort M** · **Depends on:** P1.5, P1.6

**Outcome:** One action checks every installed profile, repairs the game files it can, and reports what changed instead of making the player open each Health dialog.

**Build:**
- `electron/core/maintenance.js` plans the run (installed profiles only, one at a time) and summarizes per-profile `{ id, name, before, after, repaired, errors }`. Reuse Installer verification and the HealthService checks; do not touch worlds, mods, or backups.
- Run as a cancellable `maintenance` job; cancellation stops after the current profile. Broadcast progress through the existing job channel and surface the result in Settings → Troubleshooting.
- Isolate failures: one broken profile records its message and the run continues.

**Contracts:** `maintenance:verifyAll`, `maintenance:cancel`; job type `maintenance`; no settings or store changes.

**Done when:**
- [ ] Every installed profile is visited once, newest first.
- [ ] A repaired profile reports the files it fetched; an already healthy one reports no change.
- [ ] Cancel finishes the current profile and leaves the rest untouched.
- [ ] One failure does not stop the batch.
- [ ] Planning and summary logic are covered by tests.

**Verify:** `node --test tests/maintenance.test.js`.

**Out of scope:** repairing mod jars, deleting unused files, scheduled runs.

---

### P6.5 · Shortcuts and window placement

`F3 · F19` · **Effort S–M** · **Depends on:** P4.5

**Outcome:** Frequent actions have discoverable keyboard shortcuts, and the window reopens where it was left without ever landing off-screen.

**Build:**
- One shortcut table shared by the handler and the `?` cheat sheet: `Ctrl+K` search, `Ctrl+Enter` Play, `Alt+1…9` pages, `Ctrl+,` settings, `Escape` closes the top layer. Ignore shortcuts while a text field, textarea, select, or contenteditable has focus.
- Persist `settings.window.placement = { x, y, width, height, maximized }`, normalized on load. Restore before `show()`; clamp to the nearest visible display when a monitor disappears. Keep the existing width/height fallback for first runs.
- The sheet is a focus-trapped modal with the current bindings and no editing UI.

**Contracts:** `settings.window.placement`; no new IPC.

**Done when:**
- [ ] Every listed shortcut works and none fires while typing.
- [ ] `?` opens and closes the cheat sheet, returning focus.
- [ ] Position, size and maximized state survive a restart.
- [ ] An off-screen saved position is clamped onto a visible display.
- [ ] Clamping and shortcut normalization are covered by tests.

**Verify:** `node --test tests/shortcuts.test.js`.

**Out of scope:** global OS hotkeys, user-editable bindings.

---

### P6.6 · Windows file associations and jump list

`I9 · I10` · **Effort M** · **Depends on:** P4.1, P4.3

**Outcome:** Double-clicking a pack or world file opens it in Aqua, and the taskbar jump list offers recent profiles and the last server.

**Build:**
- Register `.mrpack`, `.mcpack`, `.mcaddon`, and `.mcworld` in the packaged build; route the opened path through one validated intent `{ kind: 'openFile', path, fileType }` with an absolute-path, extension, existence, and size check. Always confirm before importing or installing. Skip registration in portable mode.
- Extend the CLI/second-instance parser with the same intent so an association never bypasses validation. Reject unknown extensions and paths outside the user's chosen file.
- Jump list: five recent installed profiles plus **Join last server** when a server exists; entries reuse `aqua://` intents. Rebuild on profile/server changes, and document the Windows uninstall caveat with the existing links note.

**Contracts:** `openFile` intent; no new IPC; packaged `fileAssociations`.

**Done when:**
- [ ] A `.mrpack` association opens the confirmation flow, not an import.
- [ ] A foreign extension or missing path exits with a readable error.
- [ ] A jump-list profile launches the right installation.
- [ ] Portable mode leaves associations untouched.
- [ ] File-intent validation is covered by tests.

**Verify:** `node --test tests/file-intents.test.js`; manual: double-click one pack and one world on a packaged build.

**Out of scope:** a shell context-menu verb, macOS/Linux associations, owning `.jar`.

---

## 13. Backlog and triage

Everything not in a phase above remains **unapproved**. Do not implement it opportunistically.

When promoting an idea, it needs:

1. A named user problem, not just a feature name.
2. A phase assignment and a dependency check.
3. An owner and an effort estimate.
4. A testable acceptance criterion.
5. A decision on whether it adds a network call, a dependency, or a new data store.

Strong candidates for the next planning round, in rough order:

| Area | IDs | Why now |
|---|---|---|
| Trust | A3, A5, A9 | Snapshots, pre-launch checks, and launch queue deepen the Phase 1 story |
| Content | B15, B17 | One-click performance and provenance (B11 shipped as P2.10) |
| Servers | C7 (if not done), C10, C13 | Polish and service status complete the server list |
| UX | F3, F13, F19 | Shortcuts, what's-new, window placement |
| Diagnostics | G1, G2, G5, G8 | Log tailing, mod attribution, network diagnostics, issue reports |
| Storage | H3, H5, H7 | Verify-all, low-disk preflight, config export |
| Platform | I9, I10, I12 | File associations, jump list, CI |

Explicitly parked unless the product direction changes: social features, chat, cloud accounts, ads, crypto, a Tauri rewrite.

---

## 14. Proposed contracts (reserve names before use)

Use these names so parallel work does not collide. If a package needs a different shape, update this table in the same change set.

### IPC channels

| Channel | Package | Shape |
|---|---|---|
| `crash:last`, `crash:list`, `crash:analyze` | P1.1 | Read/analyze local crash reports |
| `game:launch` (extend) | P1.2 | Add `{ safeMode?: boolean }` |
| `game:recoverSafeMode` | P1.2 | Restore an interrupted staging session |
| `backups:runNow`, `backups:status` | P1.3 | Manual run and scheduler state |
| `health:check`, `health:fix`, `health:summary` | P1.5 | Instance health |
| `storage:scan`, `storage:clean`, `storage:cancel` | P1.6 | Disk usage and cleanup |
| `update:check`, `update:download`, `update:install` | P1.7 | Auto-update |
| `mods:project`, `mods:versions` | P2.1 | Project detail |
| `content:index`, `content:file`, `content:conflicts` | P0.1/P2.3/P2.4 | Local content inspection |
| `content:importFiles` | P2.5 | Drag-and-drop |
| `mods:inspectPack`, `mods:importPack`, `mods:exportPack`, `mods:exportPreview` | P2.6/P2.7 | Pack import/export |
| `launcher-import:scan`, `launcher-import:start` | P4.2 | Launcher detection and batch import |
| `screenshots:list`, `screenshots:thumbnail`, `screenshots:delete`, `screenshots:setBackground` | P2.9 | Gallery |
| `stats:summary`, `stats:exportCsv` | P3.5 | Local playtime stats |
| `notifications:list`, `notifications:markRead`, `notifications:clear` | P3.4 | Notification center |
| `servers:lan`, `servers:bindInstallation` | P3.3/P3.2 | LAN discovery and binding |
| `app:route` | P4.1 | Deep-link/CLI actions into the renderer |
| `app:rendererReady`, `app:linkStatus`, `app:registerLinks` | P4.1 | Link routing readiness and scheme state |
| `launch:preflight` | P6.1 | Checklist rows before a launch |
| `launch:queue`, `launch:dequeue`, `launch:list` | P6.2 | Session-only launch queue |
| `logs:tail` | P6.3 | Incremental game-log tail |
| `maintenance:verifyAll`, `maintenance:cancel` | P6.4 | Batch integrity check |
| `mods:checkUpdates`, `mods:update` | P2.10 | Installed-content updates |
| `mods:retargetInfo`, `mods:retarget`, `mods:retargetUndo` | P2.11 | Cross-version mod retargeting |
| `minecraftSettings:status|capture|apply|applyAll` | P3.7 | Shared client settings |
| `docs:image` | requested directly | README/ROADMAP images as data URLs |

### Store and settings additions

| Package | Key | Notes |
|---|---|---|
| P1.1 | `crashes[]` (store) | Max 10, normalized |
| P1.2 | none | Session state only |
| P1.3 | `settings.backups`, `installation.backupPolicy` | Optional override, nullable |
| P1.5 | none | Cache in memory |
| P1.7 | `settings.updates` | `{ channel, autoCheck }` |
| P2.2 | `settings.contentFilters` | Validated map per content type |
| P2.6 | `installation.modpack` (extend) | Add `source: 'modrinth' \| 'mrpack' \| 'prism'` |
| P2.9 | `settings.dashboardBackground` | Launcher-owned path only |
| P3.1 | none | Renderer-only |
| P3.2 | `server.installationId` | Nullable, cleared on delete |
| P3.4 | `notifications[]` (store), `settings.notifications` | Max 50 |
| P3.6 | `installation.pinned/tags/color/sortIndex` | Normalized |
| P4.4 | `settings.discord` | Off by default |
| P6.5 | `settings.window.placement` | Normalized and clamped to a visible display |
| P2.10 | none | Update results are session state |
| P2.11 | none | Original jar kept beside the mod |
| P3.7 | `settings.minecraftSettings.sync` | Default on; shared files under `minecraft-settings/` |
| P3.8 | none | Renderer-only |
| P3.9 | none | `public/artwork/`, `cache/artwork/` |

### Event names

`crash`, `backups`, `health`, `storage:progress`, `update`, `screenshots`, `notifications`, `lan`, `stats`, `launch-queue`, `logs:tail`. Add each to `EventPayloadMap` and handle it in `LauncherProvider.tsx`; never leave an emitted event unhandled.

---

## 15. Decisions needed

| ID | Decision | Blocks | Default if unanswered |
|---|---|---|---|
| D1 | Release hosting and code signing for auto-update | P1.7 | Keep manual releases; do not add `electron-updater` |
| D2 | Are online services (Discord RPC, update feed) acceptable? | P1.7 | Discord RPC approved 2026-11-03 as opt-in and off by default; auto-update still needs D1 and the remaining D2 answer. |
| D3 | CurseForge API terms/key, or file-based import only? | P2.6 (CurseForge part), B19 | File-based only |
| D4 | First localization languages | P4.6 | Defer the framework; keep strings centralized |
| D5 | Launcher only, or launcher + server manager? | P5.1 | Stay launcher-only |
| D6 | Telemetry stance | G8, K6 | None by default; local-only reports |
| D7 | Windows-only, or invest in macOS/Linux parity? | P4.3, I8 | Windows-first; fix platform bugs as reported |

Record the answer and date in the changelog when decided.

---

## 16. Progress tracker

Status values: `todo` · `in progress` · `blocked` · `done`. Keep the note short: owner, PR/commit, blocker, or the next concrete step. An `in progress` row is a claim: other agents should not edit the files listed there without coordinating.

| Package | Status | Note |
|---|---|---|
| P0.1 Content index | done | Buffy · 2026-11-02 · `electron/core/content-index.js` reads Fabric, Quilt, Forge, NeoForge and legacy `mcmod.info` metadata plus `pack.mcmeta`/shader layouts; tolerant per-file scanning; signature-keyed 30s-free disk cache that invalidates on replace/delete; `content:index` IPC. 9 new tests. |
| P0.2 Snapshot engine | done | `electron/core/snapshots.js` + `tests/snapshots.test.js` (round-trip, zip-slip, retention, interrupted write). `worlds.js` keeps its own writer for now; the duplication is deliberate so P1.3 can migrate it without touching P1.4. |
| P1.1 Crash Guard | done | Buffy · 2026-11-02 · `electron/core/crash-analysis.js` (7 rules + unknown fallback, declarative actions), `tests/crash-analysis.test.js` 6 cases; `GameManager` reads the newest crash report and 400-line log tail, stores the last 10 in `store.crashes`, `crash:last|list|analyze`; `CrashDialog` and a last-crash strip in Logs & diagnostics. Dashboard shortcut not added; the Safe Mode action falls back to a normal retry until P1.2. |
| P1.2 Safe Mode launch | done | Buffy · 2026-11-02 · `electron/core/safe-mode.js` (manifest-before-move, rename with cross-volume copy+sha1 fallback, rollback, conflict-safe restore, orphan recovery), `tests/safe-mode.test.js` 7 cases; launch stages content and restores on exit, spawn failure and quit; `game:recoverSafeMode`; startup recovery before the window; Safe Mode button, running badge and crash-dialog action. |
| P1.3 Scheduled world backups | done | Buffy · 2026-11-02 · `backups` settings policy (off until enabled) with normalization/validation; pure `isDue`/`nextRunAt`/`planRetention` + 7 tests; 15-minute and focus checks, daily missed-run-once, exit hook for changed worlds; content signatures from `level.dat` + newest region file; atomic ZIPs and index metadata (`pinned`, `automatic`, `contentHash`); JobManager `backup` jobs; retention by count then size; `backups:status|runNow`; Settings → Backups and per-world “Last backup”. |
| P1.5 Health check | done | Buffy · 2026-11-02 · `electron/core/health.js` checks version metadata, client jar, asset index, sampled libraries, Java major, RAM, free disk, writability, loader profile, shared folders, duplicate mod IDs, wrong-loader jars, missing dependencies and orphaned `.disabled` files; allow-listed fixes only (`reinstall`, `open-settings`, `open-folder`, `create-directory`, `open-content`); 30 s cache and concurrent-request collapse; `health:check|fix|summary`; installation-card status badge and Health dialog. 7 new tests. |
| P1.6 Storage + cleanup | done | Buffy · 2026-10-28 · `electron/core/storage.js` (9 categories, hardlink-aware, cancel, recycle-bin clean), `storage:scan|clean|cancel` IPC, Settings → Storage panel, `tests/storage.test.js` 10 cases. Deferred: P1.5 integrity reuse (used `effectiveVersionId` instead), backup cleanup shipped in the service behind `includeBackups` but not exposed in the UI. |
| P1.7 Auto-update | blocked | D1/D2 |
| P2.1 Mod detail pane | done | Buffy · 2026-11-02 · `ModrinthService.getProject/getVersions` with validated IDs, capped fields, a 10-minute disk cache under `cache/modrinth/` and stale-cache fallback; `mods:project` / `mods:versions` IPC; right-side drawer with Overview, Versions and Dependencies tabs, compatibility filter plus “All versions”, per-version install, plain-text description, gallery and allow-listed external links; inline retry on failure. 4 new tests. |
| P2.2 Search filters and sorting | done | Buffy · 2026-11-02 · `mods:search` accepts validated `sort`, `categories`, `environment`, `license`, `openSource`, `gameVersion` and `loader` options; Modrinth facets are built server-side from allowlists. Collapsible filter bar with sort/version/loader selects, environment toggle, license, open-source switch and category chips; active-filter count, Clear all, explanatory empty state and persisted `settings.contentFilters` per content type. Search responses are invalidated before debounce and stale loads are ignored. 5 new tests. |
| P2.3 Jar inspector | done | Buffy · 2026-11-02 · `mods:list` now merges cached `content-index` metadata into every installed row; hand-copied jars show name, version, authors, loader and MC range, with missing-metadata, duplicate-ID and wrong-loader badges. New `content:file` inspects one file with size, install date, normalized metadata and a capped raw Fabric/Quilt/Forge/NeoForge/legacy manifest, plus a side drawer and open-folder action. 2 new tests. |
| P2.4 Conflict checker | done | Buffy · 2026-11-02 · `electron/core/content-conflicts.js` pure `findConflicts` reports missing required dependencies, duplicate IDs, loader and Minecraft-version mismatches, and a conservative documented incompatible-pairs table; version ranges cover comparators, wildcards, Maven brackets and hyphen forms. `content:conflicts` IPC; issues banner and drawer with disable, open-folder and copy-summary actions. 7 new tests. |
| P2.6 Modpack import | done | Buffy · 2026-11-02 · `electron/core/modpack-import.js` inspects `.mrpack` manifests and Prism/MultiMC instances before creating anything; validates format, Minecraft/loader versions, manifest and override paths, and blocks zip-slip. `.mrpack` files reuse the verified SHA-1 downloader, overrides and client-overrides, while Prism instances copy with per-file progress or adopt in place. Failures and cancellation remove the half-created profile; the source pack is never moved or modified. `mods:inspectPack|importPack`, a cancellable `modpack-import` job, Installations → Import pack, and a `.mrpack` drop target. 7 new tests. |
| P2.7 Modpack export | done | Buffy · 2026-11-02 · `electron/core/modpack-export.js` scans mods, resource packs, shader packs and configs; hashes every file and turns Modrinth matches into verified `files[]` downloads, bundling unmatched or disabled content under `overrides/`. Worlds are opt-in with a size warning. `mods:exportPreview|exportPack` back an installation-menu preview with downloadable/bundled counts, and the save dialog writes through a temporary archive before renaming. 3 new tests. |
| P2.8 Datapacks | done | Buffy · 2026-11-02 · Datapacks are now a first-class Modrinth type with world-scoped `saves/<world>/datapacks` installs, listing, enable/disable and confirmed removal. The Mods page has a world selector and asks for a world when several exist; Worlds adds a per-world manager. `pack.mcmeta` `pack_format` is checked against the profile version and mismatches are warnings, never hard blocks. World paths reject traversal and missing worlds, and installing creates `datapacks/` safely. 3 new tests. |
| P2.9 Screenshot gallery | done | Buffy · 2026-11-02 · `electron/core/screenshots.js` lists PNG/JPEG screenshots newest-first and reads dimensions from file headers, so a 500-shot folder is never decoded just to list it. Native thumbnails run three at a time and cache by path, mtime and size under `cache/screenshots`; deleting a screenshot sends it to the OS recycle bin and removes every cached size. The new Screenshots page lazy-loads thumbnails, has a next/previous lightbox with copy, reveal, delete and **Use as background**, and shows a helpful empty state for a missing folder. `dashboardBackground` stores a launcher-owned copy that survives restarts, replaces the hero art, and can be cleared back to the stock dashboard. 5 new tests. |
| P2.10 Installed-content updates | done | Shipped before this catalogue entry: `ModrinthService.checkUpdates/update`, per-row update and **Update all** in Extra content. No dedicated test (network-bound); verified manually. |
| P2.11 Mod retargeting | done | Shipped: `electron/core/mod-retarget.js`, `mods:retarget*` IPC, `ModRetargetDialog`; `tests/mod-retarget.test.js`. |
| P3.1 Command palette + search | done | Buffy · 2026-11-02 · A dependency-free fuzzy matcher scores labels ahead of descriptions and keywords; the palette indexes pages, installation actions, worlds, servers, installed mods, settings sections/toggles and account names, with localStorage recent items. `Ctrl+K` and a titlebar search button open the focus-trapped palette; arrows/Enter/Escape drive it, and launch/safe-mode/join commands reuse the existing Play and join flows. A new lightweight `worlds:searchIndex` reads all profiles without sizes, icons or backups. 3 new tests, including 120 installations plus 1,000 worlds. |
| P3.3 LAN discovery | done | Buffy · 2026-11-02 · A main-process UDP 4445 listener joins Minecraft's 224.0.2.60 multicast group on every IPv4 adapter, parses `[MOTD]/[AD]` broadcasts, deduplicates by source and port, and expires silent worlds after 10 seconds. Bind/firewall errors are reported in the Servers page instead of crashing; the listener starts once and closes on quit. The new **LAN worlds** section above saved servers shows the live listening state, refresh action, world MOTD, port, source address and a Quick Play join that uses the shared profile/warning path. 5 new tests. |
| P3.4 Notification center | done | Buffy · 2026-11-02 · `electron/core/notifications.js` validates actions, persists before broadcasting and deduplicates one job state with a key. `Store` keeps the newest 50 notifications with persistent `read`; mark-read and clear IPC never touch crash records or logs. All existing notification emitters now go through the delivery service, which gates by `enabled`/`levels` and only creates native notifications when the setting is on and the window is hidden or unfocused. Job outcomes carry dedupe keys and route actions; crash entries link to the exact report file in Logs. The titlebar bell shows unread count, a popover with mark-all-read and clear, and click-through routes. Settings → Notifications controls center, native and per-level delivery. 5 new tests. |
| P3.5 Playtime stats | done | Shipped: `stats.js` summary, Stats page heatmap/rankings, CSV export; `tests/stats.test.js`. |
| P3.6 Instance organization | done | Shipped: `installation-meta.js`, pinned/tagged cards, tag filter, compact view, custom drag order; `tests/installation-meta.test.js`. |
| P3.7 Shared Minecraft settings | done | Shipped: `minecraft-settings.js`, `minecraftSettings:*` IPC, Settings → Minecraft settings, pre-launch apply and post-exit capture. |
| P3.8 Unified task board | done | Shipped: `src/pages/TasksPage.tsx`, sidebar footer entry and **Open Tasks** links. |
| P3.9 Version artwork | done | Shipped: `artwork.js` Aqua endpoint + Mojang drop fallback, `cache/artwork/`, `useHeroArtwork`. |
| P4.1 Deep links + CLI | done | Shipped: `deep-links.js`, `aqua://` registration, single-instance forwarding, confirmation dialog, Settings → Links & CLI; `tests/deep-links.test.js`. |
| P4.2 Launcher import | done | Buffy · 2026-11-02 · `electron/core/launcher-import.js` detects vanilla `.minecraft`, Prism/MultiMC, CurseForge and ATLauncher profiles in standard and user-chosen folders without writing to them. Candidates show version, loader, mods, worlds and content size. Adopt in place keeps the source game directory; copy mode copies mods, configs and optional worlds while skipping libraries, assets, versions, caches and launcher metadata. Each profile is created with a unique name, gets its normal install job, and is rolled back alone on failure; results and failures are reported per profile and in the batch job. CurseForge stays file-based and ATLauncher remains read-only. `launcher-import:scan|start`, Installations → Import launcher; 9 new tests. |
| P4.3 Portable mode | in progress | Buffy · 2026-11-02 · `electron/core/portable.js` detects `--portable`/`portable.txt`, creates `AquaData` and its Electron paths, probes writability, and falls back to AppData with a startup dialog on failure. Startup applies the paths before the single-instance lock; protocol registration and login-at-startup are disabled, Settings shows the data root/portable badge/fallback warning, and links explain the portable limitation. 5 new tests. Remaining: packaged USB + Process Monitor/clean-VM AppData verification. |
| P4.4 Discord RPC | done | Buffy · 2026-11-03 · `electron/core/discord-presence.js` speaks Discord's local IPC protocol directly (no SDK or dependency): lazy connect across `discord-ipc-0…9`, handshake, exponential backoff while a game is active, and one debug line when Discord is absent. Settings → Discord presence adds off-by-default `discord.enabled`/`showServer`; the second switch is the only way the address enters the activity, and it also enables the join secret/party. Game transitions publish and clear presence; disabling clears immediately and closes the pipe; incoming join requests reuse the normal confirmation flow. 11 new tests. Live presence requires `AQUA_DISCORD_CLIENT_ID` (registered Discord application). |
| P4.5 Accessibility | done | Buffy · 2026-11-02 · Added a skip-to-content link, page/job live-region announcements, focus return for the notification popover, `aria-describedby` for modal subtitles, and current-section semantics. Settings → Display now has **High contrast** and **Reduce transparency**, applied through `data-contrast`/`data-transparency`; high contrast uses an opaque black token palette, and reduced motion now removes animations/transitions entirely. 32px icon/chip/switch hit targets and a contrast regression test. 3 new tests. Manual NVDA/screen-reader pass remains. |
| P4.6 Localization | blocked | D4 |
| P5.1 Server manager | blocked | D5 |
| P5.2 Server pack sync | blocked | P5.1/P2.6 |
| P5.3 World map | blocked | product decision |
| P6.1 Pre-launch checklist | todo | Needs a preflight rule table on top of the health cache; see P6.1. |
| P6.2 Launch queue | todo | Session-only queue; depends on P6.1 for the Play flow. |
| P6.3 Log tail + mod attribution | todo | Incremental reader plus content-index attribution; no regex. |
| P6.4 Verify-all maintenance | todo | Batch verification job reusing the installer and health checks. |
| P6.5 Shortcuts + window placement | todo | Shared shortcut table, cheat sheet, clamped placement persistence. |
| P6.6 File associations + jump list | todo | Packaged associations, validated `openFile` intent, jump-list entries. |

---

## 17. Changelog

| Date | Change |
|---|---|
| 2026-11-03 | P4.4 Discord Rich Presence: opt-in and off by default. Aqua talks to Discord's local IPC socket directly (no SDK or dependency), publishes the instance, Minecraft version, loader and elapsed time, and clears presence on exit, crash, disable or disconnect. A second switch exposes the server address and a Join action; incoming requests use the existing confirmation flow. Missing Discord retries with backoff and logs one debug line. 11 new tests. The roadmap gained **Phase 6** (P6.1–P6.6): pre-launch checklist, launch queue, log tail and mod attribution, verify-all maintenance, shortcuts/window placement, and Windows file associations/jump list. Live presence requires a registered Discord application ID supplied through `AQUA_DISCORD_CLIENT_ID`. |
| 2026-11-02 | P4.5 Accessibility: added **Skip to content**, live-region announcements for page changes and completed/failed/cancelled jobs, `aria-describedby` on modal subtitles, focus return for the notification popover, and current-section semantics. Settings → Display now exposes **High contrast** and **Reduce transparency**, backed by an opaque high-contrast token palette and non-blurred surfaces; reduced motion now disables CSS animation and transitions entirely. Small icon buttons, switches and chips gained 32×32 targets, and a WCAG contrast regression test covers body text on the major surfaces. 3 new tests; manual NVDA/keyboard smoke test remains. |
| 2026-10-28 | Initial roadmap created; 33 packages across six phases. |
| 2026-10-28 | In-app **Roadmap & docs** page (requested directly, not a roadmap package): `src/pages/DocsPage.tsx` renders the README via a small Markdown reader (`src/lib/markdown.ts`), and shows the roadmap as features only (`src/lib/roadmap.ts`) — package title, its `**Outcome:**` sentence and tracker status, with all build steps, contracts and verification text dropped. 6 tests in `tests/docs.test.js`. |
| 2026-11-02 | README and roadmap brought back in line with the launcher: documented the Tasks page, shared Minecraft settings, mod retargeting, and edition-aware installs; added nine shipped packages (P2.10, P2.11, P3.7–P3.9, P4.7–P4.10) with tracker rows, contracts and backlog notes. The Docs page now renders README/ROADMAP images through a main-process `docs:image` loader (https only, image content types, 8 MB cap, in-memory cache); parser, renderer, CSS and tests updated. |
| 2026-11-02 | P1.1 Crash Guard: local rule table classifies out-of-memory, Java version, missing dependency, mixin, graphics, mod conflict and corrupt installs, with declarative actions only. `GameManager` analyzes the crash report plus the session log tail, persists the last 10 crashes, and the renderer shows the classification, evidence and safe actions. 6 new tests; tracker row marked done. |
| 2026-11-02 | P1.2 Safe Mode: one click moves mods, resource packs and shaders into a per-session folder with a checksummed manifest, then restores them on exit, spawn failure, quit, or the next startup after a kill. Conflicting files are reported instead of overwritten, partial staging rolls back and refuses the launch, and the crash dialog now offers Safe Mode directly. 7 new tests. |
| 2026-11-02 | P1.3 Scheduled world backups: off-by-default policy with after-play and daily schedules, a 15-minute/focus checker that runs a missed day exactly once, changed-world detection, one cancellable backup job, and count-then-size retention that never removes pinned copies. The Settings page shows last/next run and can run now; world cards show their newest backup. 7 new tests. |
| 2026-11-02 | P1.5 Health check: one dialog reports missing game files, Java/RAM/disk problems, loader mismatches, shared game folders, duplicate mod IDs, wrong-loader jars, missing dependencies and stale .disabled files. Every row explains the issue and offers only a safe fix (repair, settings, folder, mkdir, mods); results are cached for 30 seconds and summaries badge each installation. 7 new tests. |
| 2026-11-02 | P0.1 Content index: one reader now answers what a mod, resource pack, shaderpack or datapack actually is. Fabric/Quilt/Forge/NeoForge/legacy manifests and pack metadata are normalized, corrupt archives become null rows instead of failed scans, and a signature-keyed cache rebuilds when a file is replaced or deleted. 9 new tests. |
| 2026-11-02 | P2.1 Mod detail pane: Modrinth projects now open in a side drawer with title, icon, author, downloads, gallery, license, links, plain-text description, compatibility-filtered versions and declared dependencies. A specific version can be installed without leaving the drawer; project and version responses are cached for ten minutes, IDs are validated, and failures offer an inline retry. 4 new tests. |
| 2026-11-02 | P2.2 Search filters and sorting: Extra content now has a collapsible filter bar for sort, Minecraft version, loader, environment, license, open source and per-type categories. Every value is validated against server-side allowlists and sent to Modrinth as facet groups; filters persist per content type, reset profile-bound version/loader choices when the profile changes, and rapid typing cancels stale responses. Empty results name the active filters and offer Clear all. 5 new tests. |
| 2026-11-02 | P2.3 Local jar inspector: installed content is no longer just filenames. Metadata from the cached content index fills in display names, versions, authors, loaders and Minecraft ranges, while missing metadata, duplicate mod IDs and wrong-loader jars get visible flags. A per-file inspector shows size, install date, normalized fields and the raw manifest, with an open-folder action. 2 new tests. |
| 2026-11-02 | P2.4 Dependency and conflict checker: enabled content is checked for missing required dependencies, duplicate mod IDs, wrong loaders, incompatible Minecraft ranges and a small sourced table of known conflicts. The issues drawer explains each consequence and can disable a file, open the folder or copy a diagnostic summary; disabling refreshes the report. 7 new tests. |
| 2026-11-02 | P2.6 Local modpack import: `.mrpack` and Prism/MultiMC packs become installations without retyping loader or version. Inspection validates the manifest format, Minecraft/loader versions and every manifest/override path before creating a profile; zip-slip is rejected. `.mrpack` reuse the existing SHA-1 downloader and overrides, while Prism folders copy with per-file progress or adopt in place. Failures and cancellation remove the half-created profile without touching the source pack; imports run as cancellable `modpack-import` jobs and can start from Installations or by dropping an `.mrpack`. 7 new tests. |
| 2026-11-02 | P2.7 Modpack export: any Java installation can now become a `.mrpack`. The preview hashes installed mods, packs and configs, uses Modrinth hash matches as verified downloads, and bundles unmatched or disabled files under `overrides/`. Worlds stay out unless the user opts in and sees their size; the save dialog writes to a temporary archive and renames it into place. 3 new tests. |
| 2026-11-02 | P2.8 Datapacks: datapacks are now a supported Modrinth content type instead of a manual folder. Installs target `saves/<world>/datapacks`, the Mods page selects or asks for the world, and each world gets a manager for enable/disable/remove and opening the exact folder. `pack.mcmeta` format mismatches are advisory warnings, missing target worlds and traversal paths are rejected, and the folder is created safely. 3 new tests. |
| 2026-11-02 | P2.9 Screenshot gallery: a new Screenshots page lists every Java screenshot newest-first, lazy-loads thumbnails through a three-job native-image queue, and opens a lightbox with next/previous, copy, reveal, recycle-bin deletion and dashboard-background actions. Dimensions are read from image headers so listing 500 shots does not decode them; thumbnails cache by path, mtime and size and are removed with the source. The chosen background is copied into launcher-owned storage, persists in Settings, and can be cleared. 5 new tests. |
| 2026-11-02 | P3.1 Command palette: `Ctrl+K` or the titlebar Search button opens a focus-trapped fuzzy palette over pages, installation actions, worlds, servers, installed mods, settings and player profiles, with recent items and arrow/Enter navigation. Launch and safe-mode entries reuse the Play/launch paths, server entries reuse Quick Join, settings entries toggle through the normal validation path, and content updates route into Extra content. A lightweight global world index avoids full world scans, and 1,000-world ranking is covered by tests. 3 new tests. |
| 2026-11-02 | P3.3 LAN discovery: a main-process UDP listener joins Minecraft's LAN multicast group on every IPv4 adapter, parses the world MOTD and game port, deduplicates by source and port, and expires worlds after ten seconds without a broadcast. Bind and firewall failures become a readable state instead of a crash, and the socket is stopped with the app. The Servers page now has a live **LAN worlds** section above saved servers with the listening indicator, refresh action, source address and one-click Quick Play join through the shared profile and warning flow. 5 new tests. |
| 2026-11-02 | P3.4 Notification center: launcher events now persist in a 50-entry, read-aware notification store instead of disappearing with the toast. A main-process delivery layer validates routes, suppresses duplicate job-state entries, respects enabled levels, and shows native Windows notifications only when Aqua is hidden or unfocused. Download/install, Java, backup and crash notices have click-through actions; crash notices target the exact report in Logs. The titlebar bell has unread count, mark-all-read, clear and a popover list, while Settings → Notifications controls the center, native delivery and each level. Clearing never touches crash diagnostics. 5 new tests. |
| 2026-11-02 | P3.5 Playtime stats: recorded sessions now feed a local-only Stats page with total and average playtime, active days, current and longest streaks, a 12-week local-date heatmap, top installations, most-played versions and recent crashes. The summary is computed in the main process (`stats:summary`); sessions that cross local midnight split across both days while totals stay the sum of stored durations. **Export CSV** writes ISO start/end timestamps, local date, instance name, version and duration through a save dialog. Session retention grew from 20 to 500 entries so the history is meaningful. 6 new tests. |
| 2026-11-02 | P3.6 Instance organization: each Java profile now stores pinned, tags, colour, cover path and an explicit sortIndex, all normalized and capped in the store. The Installations page keeps pinned cards above the list without changing the Play target, filters by tag (clearing a tag when its last profile is deleted), offers grid/compact views, sorts by recently played, name or custom order, and drag-reorders cards in custom mode. Launching a profile does not rewrite its saved position. 6 new tests. |
| 2026-11-02 | P4.2 Launcher import: Aqua now discovers vanilla `.minecraft`, Prism/MultiMC, CurseForge and ATLauncher profiles in their standard folders or any chosen instance. The import dialog lists each profile's Minecraft version, loader, mods, worlds and content size, then adopts the existing folder or copies only game content (mods, configs and optional worlds) while skipping shared libraries, assets, versions and caches. Duplicate names get a suffix, every profile is created and rolled back independently, source folders are only read, and results are reported per profile in the dialog and Tasks. `launcher-import:scan|start`; 9 new tests. |
| 2026-11-02 | P4.3 Portable mode: `--portable` or a `portable.txt` marker now points `userData`, session data, Electron logs, crash dumps and default downloads at `<exeDir>/AquaData` before the single-instance lock is taken. The startup probe falls back to AppData with a readable error dialog when the folder cannot be written, protocol registration and login-at-startup are skipped, and Settings → About/Links show the active data root, portable badge and disabled-link explanation. 5 new tests; packaged USB/AppData-monitor verification remains. |
| 2026-11-02 | P4.1 Deep links + CLI: `aqua://launch|join|install|open` and `aqua launch|join|install|status` now share one validated parser. The `aqua` scheme is registered at startup, macOS `open-url` and Windows/Linux `second-instance` argv forward into the running window, and the renderer confirms every launch/join/install through the existing Play, Quick Join and modpack flows. `--yes` skips confirmation in scripts; malformed input fails readably without side effects. `aqua status --json` reports only local profile metadata and never tokens, accounts or paths. Settings → Links & CLI shows registration state and copyable examples, with the Windows uninstall caveat documented. 6 new tests. |