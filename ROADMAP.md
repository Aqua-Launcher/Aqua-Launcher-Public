# Aqua Launcher — Agent Roadmap

**Status:** planning document. It sequences the catalogue in [FEATURE_IDEAS.md](FEATURE_IDEAS.md); it does not describe shipped code.
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
- **No stack rewrites, no bundling game assets, no auth bypasses.** See the non-goals at the end of `FEATURE_IDEAS.md`.
- **Respect the current visual language.** Reuse `PageHeader`, `Button`, `IconButton`, `EmptyState`, `Spinner`, `ConfirmDialog`, `Menu`, and the classes in `src/styles/`.
- **Every package ships with its tests.** Pure logic gets a `tests/*.test.js` case; UI gets loading, empty, error, and keyboard states.

---

## 2. Baseline map

| Layer | Files | What lives there |
|---|---|---|
| App shell | `src/App.tsx`, `src/main.tsx`, `src/components/layout/*` | Page routing, titlebar, sidebar, boot screen |
| Renderer state | `src/state/LauncherProvider.tsx` | Bootstrap payload, event subscription, toasts, dialogs, selection |
| Pages | `src/pages/*.tsx` | Dashboard, installations, versions, worlds, servers, content, accounts, logs, settings |
| UI kit | `src/components/ui/primitives.tsx`, `overlays.tsx`, `Menu.tsx` | Buttons, inputs, empty states, modals, menus |
| Styles | `src/styles/base.css`, `components.css`, `app.css`, `theme.css` | Global tokens and component classes |
| Preload bridge | `electron/preload.cjs` | The `window.aqua` surface |
| IPC handlers | `electron/ipc.js` | Validation, orchestration, event emission |
| Main wiring | `electron/main.js` | Service construction, window/tray, broadcast helpers |
| Core services | `electron/core/*.js` | Installations, installer, Java, loaders, Modrinth, worlds, servers, Bedrock, logs, settings, store |
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
- No regressions in Bedrock launch, Java launch, or mod install.

---

## 5. Roadmap at a glance

| Phase | Theme | Packages | Exit outcome |
|---|---|---|---|
| 0 | Shared seams | P0.1–P0.2 | Content metadata and snapshots are reusable modules with tests |
| 1 | Trust | P1.1–P1.7 | A crash is explained, a bad mod set is escapable, and saves are backed up |
| 2 | Content depth | P2.1–P2.9 | Installed content is legible; packs and datapacks are first-class |
| 3 | Daily friction | P3.1–P3.6 | Navigation, servers, and notifications feel finished |
| 4 | Platform reach | P4.1–P4.6 | Aqua is part of the desktop, not just a window |
| 5 | Decision-gated bets | P5.1–P5.3 | Only after product sign-off; not part of the default sequence |

### Safe parallel workstreams

Multiple agents can work at once if they stay in one track and respect the shared contracts.

| Track | Sequence | Owns |
|---|---|---|
| Trust / data | P0.2 → P1.3 → P1.4 | `snapshots.js`, backup IPC, backup store fields |
| Crash / health | P0.1 → P1.1 → P1.2 → P1.5 | `crash-analysis.js`, `safe-mode.js`, `health.js`, content index |
| Content | P2.1 → P2.2 → P2.3 → P2.4 → P2.5 → P2.6 → P2.7 → P2.8 | Modrinth service, content IPC, content types |
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

**Out of scope:** Safe mode for Bedrock, per-mod selection, config resets.

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

### P1.4 · Bedrock world backup and export

`J1` · **Effort S–M** · **Depends on:** P0.2

**Outcome:** Bedrock worlds — currently the least protected data in the app — can be backed up, exported, and restored as a copy.

**Build:**
- Extend `electron/core/bedrock.js` with `backupWorld(editionId, folder)` and `restoreBackup(editionId, backupId)`.
- Back up `minecraftWorlds/<folder>` including `level.dat`, `levelname.txt`, `world_icon.jpeg`, and `db/`. Store ZIPs under `paths.backupsRoot/bedrock-<editionId>/` with an `index.json` matching the Java backup shape.
- Restore into a new folder id (timestamp suffix), never over the original. Preserve the icon and name.
- Reject symlinks and paths outside the world folder.
- UI: backup/restore buttons on the Bedrock worlds panel, with the same relative-time and size treatment as Java backups.

**Contracts:**
- IPC: `bedrock:backupWorld`, `bedrock:restoreBackup`, `bedrock:deleteBackup`.
- Types: `BedrockWorldBackup`.

**Done when:**
- [ ] A fixture world with a `db/` folder round-trips with the icon intact.
- [ ] Restoring twice creates two distinct worlds.
- [ ] A missing `level.dat` is rejected before a ZIP is written.
- [ ] The Bedrock worlds list refreshes after restore.

**Verify:** `node --test tests/bedrock-backup.test.js`; manual restore into Minecraft for Windows.

**Out of scope:** editing Bedrock world settings (`J2`), pack activation changes (`J3`).

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
- [ ] Checks work offline and do not block the UI thread.

**Verify:** `node --test tests/health.test.js` with temp fixture dirs; manual on a real instance.

**Out of scope:** automatic repair of mods, dependency installation, server profiles.

---

### P1.6 · Disk usage and cleanup

`H1 · H2 · H4` · **Effort L** · **Depends on:** P1.5 (reuse integrity/version checks)

**Outcome:** Users can see where tens of gigabytes went and reclaim space without touching anything they care about.

**Build:**
- `electron/core/storage.js`: `scanStorage({ paths, installations })` → categories `{ id, label, bytes, files, path, explanation }` for instances, shared versions, libraries, assets, backups, game logs, launcher logs, caches (artwork/content-index/screenshots), Bedrock downloads.
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
- Route: `.jar` → `mods/` (or the current content type), `.zip` → resource pack or shader pack by inspecting contents, `.mrpack` → P2.6, `.mcpack`/`.mcaddon` → Bedrock add-on import, folder → ask.
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
- UI: a gallery grid with lazy thumbnails, a lightbox with next/prev, copy image, open folder, delete, and "use as dashboard background". Include Bedrock folders via `J7` if trivial; otherwise note it.
- Limit concurrent thumbnail generation and clean up thumbnails for deleted files.

**Contracts:** IPC `screenshots:list`, `screenshots:thumbnail`, `screenshots:delete`, `screenshots:setBackground`; settings `dashboardBackground`.

**Done when:**
- [ ] 500 screenshots open without freezing; thumbnails load progressively.
- [ ] Deleting moves the file to the OS trash and removes the thumbnail.
- [ ] Setting a background survives a restart and can be cleared.
- [ ] Non-image files in the folder are ignored.
- [ ] A missing folder shows a helpful empty state.

**Out of scope:** editing images, uploading, Bedrock-specific folders unless data is available.

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
- [ ] `Ctrl+K` opens and closes without focus leaks.
- [ ] Typing "surv" ranks Survival worlds above unrelated matches.
- [ ] Launching from the palette uses the same confirmation path as the Play button.
- [ ] Search works with 100+ installations and 1,000 worlds without visible lag.

**Out of scope:** searching log contents (that stays in the Logs page), remote search.

---

### P3.2 · Per-server instance binding and compatibility warnings

`C8 · C12` · **Effort S–M** · **Depends on:** nothing

**Outcome:** Joining a server uses the right profile and warns before an avoidable failure.

**Build:**
- Add `installationId` to server entries (nullable, normalized, cleared when the installation is deleted).
- Quick Join uses the bound installation, falling back to the active one with a visible note.
- Pre-join checks: server version vs. instance version (from ping), modded server vs. vanilla instance, online-mode vs. offline account, Java/Bedrock edition mismatch. Warn once per join, with "join anyway".
- UI: instance picker in the server editor; a warning sheet in the join flow; a compatibility badge on server cards.

**Done when:**
- [ ] A bound server launches its own instance even when another is active.
- [ ] Deleting the bound instance clears the binding without breaking the server row.
- [ ] A version mismatch shows the server and instance versions side by side.
- [ ] Offline accounts get a warning before joining an online-mode server.

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
- [ ] A world opened to LAN appears within 5 seconds.
- [ ] Closing the world removes it after the TTL.
- [ ] Joining uses the configured instance binding.
- [ ] The UDP socket closes cleanly on quit and does not leak on hot reload.

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
- [ ] Completing a download creates one entry, not one per file.
- [ ] A crash entry links to the crash report.
- [ ] Unread state survives a restart.
- [ ] Clearing the list does not delete diagnostics.
- [ ] Native notifications are off when the setting is off.

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
- [ ] Totals match the sum of session durations.
- [ ] Timezone boundary sessions land on the expected local day.
- [ ] CSV export includes ISO timestamps and instance names.
- [ ] Empty history shows zeros, not a broken chart.

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
- [ ] Pinning survives a restart and appears first in the sidebar/list.
- [ ] Tags filter the list and can be cleared.
- [ ] Custom order persists and is not clobbered by a launch.
- [ ] A deleted installation leaves no dangling group references.
- [ ] The compact view remains readable at 1040px width.

**Out of scope:** nested folders, sharing layouts, per-instance themes.

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
- [ ] A browser link joins the right server with the bound instance.
- [ ] A second launch forwards to the running app.
- [ ] A malformed or unknown action exits with a readable error and no side effects.
- [ ] `aqua status --json` is parseable and does not include tokens.
- [ ] Uninstalling the app does not leave a broken protocol handler on Windows (best effort, documented).

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
- [ ] A Prism instance with Fabric + 20 mods imports and launches.
- [ ] A vanilla `.minecraft` imports saves without copying gigabytes when adopting in place.
- [ ] The source directory is unchanged (hash a sample before/after).
- [ ] A failed import leaves the source intact and no half-profile.
- [ ] Duplicate profile names get a suffix instead of overwriting.

**Out of scope:** importing accounts/tokens, importing launcher settings wholesale, CurseForge API.

---

### P4.3 · Portable mode

`I2` · **Effort S–M** · **Depends on:** P4.1 (argv handling)

**Outcome:** Aqua can live on a USB stick or a synced folder with no AppData writes.

**Build:**
- If `--portable` is passed or a `portable.txt` marker sits next to the executable, set the data root to `<exeDir>/AquaData` before `app.setPath('userData', …)`.
- Adjust `paths.js`, the single-instance lock, tray icon resolution, and update behaviour (portable builds do not auto-update in place).
- Warn when the folder is read-only; fall back with a readable error rather than a crash.
- Settings → About shows the active data root and a "portable" badge.
- No registry writes; login-at-startup is disabled in portable mode.

**Done when:**
- [ ] Running from a read/write USB folder creates all data beside the executable.
- [ ] No files appear in AppData for a portable run (verify with Process Monitor or a clean VM).
- [ ] The app still starts when the marker exists but the folder is read-only (clear error).
- [ ] Unplugging the drive does not corrupt config on next start (atomic writes hold).

**Out of scope:** portable Java runtime bundling, portable updates.

---

### P4.4 · Discord Rich Presence

`I6` · **Effort M** · **Depends on:** P1.1 (game state), D2

**Outcome:** The active instance, version, loader, and (opt-in) server appear on the user's Discord profile with a Join button where possible.

**Build:**
- Use Discord's IPC/SDK with a dedicated application ID; connect lazily, retry with backoff, and never block launch.
- Settings `discord: { enabled: false, showServer: false }`; off by default. Never send account names, UUIDs, paths, or IPs unless the user opts in to server display.
- Update on game state transitions; clear presence on exit, crash, or disconnect. Handle Discord not running without noisy errors.
- Join button only when the server is joinable and the user opted in.

**Done when:**
- [ ] Presence appears within 5 seconds of launch and clears on exit.
- [ ] Disabling the setting removes presence immediately.
- [ ] Discord absent produces no error toasts or log spam.
- [ ] Server address is hidden unless both settings allow it.

**Out of scope:** rich presence for Bedrock, party invites, cross-device.

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
- [ ] Every page is reachable and operable with Tab/Shift+Tab/Enter/Escape.
- [ ] The command palette and modals return focus correctly.
- [ ] A screen reader announces page changes and job completion.
- [ ] High-contrast mode passes a contrast check on all surfaces.
- [ ] No motion runs when reduced motion is on.

**Out of scope:** full localization, screen-reader support for the embedded Bedrock webview.

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

## 12. Backlog and triage

Everything in [FEATURE_IDEAS.md](FEATURE_IDEAS.md) that is not in a phase above remains **unapproved**. Do not implement it opportunistically.

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
| Content | B11, B15, B17 | Per-mod update policy, one-click performance, provenance |
| Servers | C7 (if not done), C10, C13 | Polish and service status complete the server list |
| UX | F3, F13, F19 | Shortcuts, what's-new, window placement |
| Diagnostics | G1, G2, G5, G8 | Log tailing, mod attribution, network diagnostics, issue reports |
| Storage | H3, H5, H7 | Verify-all, low-disk preflight, config export |
| Platform | I9, I10, I12 | File associations, jump list, CI |

Explicitly parked unless the product direction changes: social features, chat, cloud accounts, ads, crypto, a Tauri rewrite.

---

## 13. Proposed contracts (reserve names before use)

Use these names so parallel work does not collide. If a package needs a different shape, update this table in the same change set.

### IPC channels

| Channel | Package | Shape |
|---|---|---|
| `crash:last`, `crash:list`, `crash:analyze` | P1.1 | Read/analyze local crash reports |
| `game:launch` (extend) | P1.2 | Add `{ safeMode?: boolean }` |
| `game:recoverSafeMode` | P1.2 | Restore an interrupted staging session |
| `backups:runNow`, `backups:status` | P1.3 | Manual run and scheduler state |
| `bedrock:backupWorld`, `bedrock:restoreBackup`, `bedrock:deleteBackup` | P1.4 | Bedrock world archives |
| `health:check`, `health:fix`, `health:summary` | P1.5 | Instance health |
| `storage:scan`, `storage:clean`, `storage:cancel` | P1.6 | Disk usage and cleanup |
| `update:check`, `update:download`, `update:install` | P1.7 | Auto-update |
| `mods:project`, `mods:versions` | P2.1 | Project detail |
| `content:index`, `content:file`, `content:conflicts` | P0.1/P2.3/P2.4 | Local content inspection |
| `content:importFiles` | P2.5 | Drag-and-drop |
| `mods:inspectPack`, `mods:importPack`, `mods:exportPack`, `mods:exportPreview` | P2.6/P2.7 | Pack import/export |
| `screenshots:list`, `screenshots:thumbnail`, `screenshots:delete`, `screenshots:setBackground` | P2.9 | Gallery |
| `stats:summary`, `stats:exportCsv` | P3.5 | Local playtime stats |
| `notifications:list`, `notifications:markRead`, `notifications:clear` | P3.4 | Notification center |
| `servers:lan`, `servers:bindInstallation` | P3.3/P3.2 | LAN discovery and binding |
| `app:route` | P4.1 | Deep-link/CLI actions into the renderer |

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

### Event names

`crash`, `backups`, `health`, `storage:progress`, `update`, `screenshots`, `notifications`, `lan`, `stats`. Add each to `EventPayloadMap` and handle it in `LauncherProvider.tsx`; never leave an emitted event unhandled.

---

## 14. Decisions needed

| ID | Decision | Blocks | Default if unanswered |
|---|---|---|---|
| D1 | Release hosting and code signing for auto-update | P1.7 | Keep manual releases; do not add `electron-updater` |
| D2 | Are online services (Discord RPC, update feed) acceptable? | P1.7, P4.4 | Stay fully local |
| D3 | CurseForge API terms/key, or file-based import only? | P2.6 (CurseForge part), B19 | File-based only |
| D4 | First localization languages | P4.6 | Defer the framework; keep strings centralized |
| D5 | Launcher only, or launcher + server manager? | P5.1 | Stay launcher-only |
| D6 | Telemetry stance | G8, K6 | None by default; local-only reports |
| D7 | Windows-only, or invest in macOS/Linux parity? | P4.3, I8 | Windows-first; fix platform bugs as reported |

Record the answer and date in the changelog when decided.

---

## 15. Progress tracker

Status values: `todo` · `in progress` · `blocked` · `done`. Keep the note short: owner, PR/commit, blocker, or the next concrete step. An `in progress` row is a claim: other agents should not edit the files listed there without coordinating.

| Package | Status | Note |
|---|---|---|
| P0.1 Content index | todo | |
| P0.2 Snapshot engine | done | `electron/core/snapshots.js` + `tests/snapshots.test.js` (round-trip, zip-slip, retention, interrupted write). `worlds.js` keeps its own writer for now; the duplication is deliberate so P1.3 can migrate it without touching P1.4. |
| P1.1 Crash Guard | todo | |
| P1.2 Safe Mode | todo | |
| P1.3 Scheduled backups | todo | |
| P1.4 Bedrock backups | in progress | Trust/data track. Service + `bedrock:backupWorld|restoreBackup|deleteBackup` + Worlds → Bedrock UI done; `tests/bedrock-backup.test.js` green. Remaining: manual restore into Minecraft for Windows. |
| P1.5 Health check | todo | |
| P1.6 Storage + cleanup | done | Buffy · 2026-10-28 · `electron/core/storage.js` (9 categories, hardlink-aware, cancel, recycle-bin clean), `storage:scan|clean|cancel` IPC, Settings → Storage panel, `tests/storage.test.js` 10 cases. Deferred: P1.5 integrity reuse (used `effectiveVersionId` instead), backup cleanup shipped in the service behind `includeBackups` but not exposed in the UI. |
| P1.7 Auto-update | blocked | D1/D2 |
| P2.1 Mod detail pane | todo | |
| P2.2 Search filters | todo | |
| P2.3 Jar inspector | todo | |
| P2.4 Conflict checker | todo | |
| P2.5 Drag-and-drop | todo | |
| P2.6 Modpack import | todo | |
| P2.7 Modpack export | todo | |
| P2.8 Datapacks | todo | |
| P2.9 Screenshot gallery | todo | |
| P3.1 Command palette + search | todo | |
| P3.2 Server binding + warnings | todo | |
| P3.3 LAN discovery | todo | |
| P3.4 Notification center | todo | |
| P3.5 Playtime stats | todo | |
| P3.6 Instance organization | todo | |
| P4.1 Deep links + CLI | todo | |
| P4.2 Launcher import | todo | |
| P4.3 Portable mode | todo | |
| P4.4 Discord RPC | todo | D2 |
| P4.5 Accessibility | todo | |
| P4.6 Localization | blocked | D4 |
| P5.1 Server manager | blocked | D5 |
| P5.2 Server pack sync | blocked | P5.1/P2.6 |
| P5.3 World map | blocked | product decision |

---

## 16. Changelog

| Date | Change |
|---|---|
| 2026-10-28 | Initial roadmap created from `FEATURE_IDEAS.md`; 33 packages across six phases. |
| 2026-10-28 | P0.2 snapshot engine added (`snapshots.js`, 10 tests). P1.4 Bedrock world backup/restore/delete added on top of it (IPC, preload, types, Worlds page); manual Store-app restore still pending. |
| 2026-10-28 | In-app **Roadmap & docs** page (requested directly, not a roadmap package): `src/pages/DocsPage.tsx` renders the README via a small Markdown reader (`src/lib/markdown.ts`), and shows the roadmap as features only (`src/lib/roadmap.ts`) — package title, its `**Outcome:**` sentence and tracker status, with all build steps, contracts and verification text dropped. 6 tests in `tests/docs.test.js`. |
| 2026-10-28 | P1.6 disk usage and cleanup: `storage.js` scan (installations, versions, libraries, assets, backups, logs, caches, Bedrock), cleanup candidates, and recycle-bin cleaning; Settings → Storage panel with usage bar, category rows and per-item cleanup dialog. 10 tests. |
| 2026-10-28 | Bedrock **Install build** (requested directly): MSIXVC builds are no longer reference-only — `BedrockVersionsService.install` runs `Add-AppxPackage -Path …` unelevated, adds `-ForceUpdateFromAnyVersion` for a downgrade, verifies Windows lists the package, and reports the failure message when it refuses. Confirmation dialog covers the UWP↔GDK data-folder move. A **Downloaded builds** strip on both Bedrock pages keeps Register/Install reachable for builds below the catalog's first page. 4 tests. |
