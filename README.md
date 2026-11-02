<p align="center">
  <img src="https://aqua.ch1n.dev/assets/og.jpg" alt="Aqua Website: More ways to play!" width="100%">
</p>

## THIS DOES NOT PROMOTE PIRACY MICROSOFT MOJANG VALIDATION IS UNDER APPROVAL

A desktop Minecraft launcher built with Electron, React, TypeScript, and Vite. Aqua manages game files and Java runtimes, keeps separate installation profiles, launches the game, and surfaces logs and crash reports without leaving the app. It also picks up Minecraft for Windows (Bedrock) from the Microsoft Store, so both editions can be launched from one place.

![Electron](https://img.shields.io/badge/Electron-45-2b2e3a)
![React](https://img.shields.io/badge/React-19-149eca)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6)
![Platform](https://img.shields.io/badge/platform-Windows-0d6efd)

## Features

- **Dashboard** with the active installation, player profile, live launcher status, recent sessions, and a single Play action.
- **Accounts** for offline profiles and Microsoft sign-in. Microsoft refresh tokens are encrypted with the operating system credential store (Windows DPAPI, macOS Keychain, or the system keyring); if encryption is unavailable, sessions stay in memory only.
- **Installations** that can be created, renamed, duplicated, edited, and deleted. Deleting an installation removes the profile entry but keeps its game directory, worlds, and downloaded files on disk.
- **Version browser** with releases, snapshots, search, and version metadata from Mojang's manifest.
- **Worlds & backups** for every installation, with world icons, game mode, last-played time, folder sizes, one-click ZIP backups, non-destructive restores, and world deletion. Backups live in the launcher data folder, so they survive profile edits.
- **Server list** with saved addresses, live status checks, quick refresh, and one-click joins: Java servers use Server List Ping and Quick Play, while Bedrock servers are queried over RakNet and opened through Minecraft's `minecraft://` deep link. Each saved server remembers its edition.
- **Bedrock Edition (Windows)** support: Aqua finds Minecraft for Windows and Minecraft Preview in the Microsoft Store packages, shows their versions and data folders, launches them, and lists their worlds alongside Java saves.
- **Bedrock version browser** that lists the builds Microsoft has published to the Store (releases, beta, and preview channels, 500+ builds), downloads the one you pick into the launcher's own folder, and registers it with Windows so it can be played alongside your Store copy.
- **Horizon (Rust Edition)** support: Aqua installs Horizon's official Rust client itself, provisions the pinned Minecraft and Java files, prepares the game resources with Horizon's bundled preparer, and starts the client directly. No Horizon launcher is involved.
- **Horizon mod browser**: Aqua reads Horizon's registry index directly, the way Horizon's own launcher does, so the mods, native bundles, and resource packs behind playhorizon.dev/mods can be searched and installed without a browser view. Files are size- and SHA-256-checked, installed into Horizon's own folders, and their `horizon-mods.txt` switches are managed from the launcher.
- **Mod loaders** for Fabric, Quilt, Forge, and NeoForge. Fabric and Quilt use their official meta profiles; Forge and NeoForge run their own installers into the launcher's Minecraft root. A loader is selected per installation and its profile version is what gets downloaded and launched.
- **Minecraft installation pipeline** that resolves inheritance, libraries, natives, assets, and logging configuration, with integrity-checked downloads, verification, and repair. Interrupted installs reuse already-verified files.
- **Mod updates** via Modrinth's hash lookup: check all installed content at once, update individual files, or update everything, while preserving disabled files.
- **Launching** with Java detection, Mojang runtime downloads, per-installation memory, JVM and game arguments, custom resolution, and process tracking.
- **Diagnostics** with the launcher log, per-session game logs, crash reports, filtering, search, copy, open-folder, and export actions.
- **Settings** for interface scale (80–130%), reduce motion, the ambient dashboard scene, Java runtime, memory, game directory, download concurrency and speed limits, window mode, arguments, startup behavior, and logging.
- **First-run setup** that only asks for a player name. Java, memory, folders, and versions use defaults and are configured later from Settings when needed.
- **Roadmap & docs** page carrying this README and a feature-level view of the roadmap, so what Aqua does and what is planned next can be read inside the launcher instead of on GitHub.

## Requirements

- **Windows 10 or 11 (64-bit)** is the primary supported platform. The architecture is cross-platform, and macOS/Linux packaging targets are included, but those builds are not actively tested.
- **Node.js 22 or newer** and npm for development.
- An internet connection to fetch the Minecraft manifest, game files, assets, and Java runtimes.
- A Microsoft Azure application ID approved for Minecraft services if you want Microsoft sign-in. Offline profiles need no account or API key.

## Getting started

```bash
npm install
npm run dev          # Vite renderer at http://localhost:5173
npm run electron:dev # Vite + Electron with hot reload
```

Build and run the production renderer:

```bash
npm run build
npm start
```

## Accounts

Aqua supports two account types. **Microsoft sign-in is currently hidden in the UI** while the Azure application is pending Mojang approval, so the app ships with offline profiles only.

1. **Offline profile** — enter a username and play singleplayer, LAN worlds, or modded setups. A deterministic UUID is generated locally. Offline profiles cannot join online-mode servers.
2. **Microsoft** — uses the official OAuth authorization-code flow with PKCE and a local loopback callback, plus your own Azure application (client) ID. Microsoft requires third-party launchers to be approved for Minecraft API access by Mojang. If your application is not approved, sign-in fails with an explanatory error.

The backend is intact; only the UI entry points are gated. To bring Microsoft sign-in back once the application is approved, set `MICROSOFT_AUTH_ENABLED = true` in [`src/lib/features.ts`](src/lib/features.ts) — no other changes are needed.

Once enabled: open **Account → Connect Microsoft**, paste the Application (client) ID from the Azure portal, and complete the browser sign-in. The ID is stored in the launcher settings. Tokens never touch `localStorage` or the renderer process.

## Extra content

Open **Extra content** for the selected installation to browse Modrinth content that matches its loader and Minecraft version. Downloads land in the installation's `mods`, `resourcepacks`, or `shaderpacks` folder, required dependencies are installed with them, and installed files are matched back to Modrinth by SHA-1 so they can be enabled, disabled, deleted, or updated.

**Check updates** compares every matched file with its newest compatible Modrinth release. Updates keep disabled files disabled and remove the previous jar after the new one downloads successfully. Modpack profiles are updated by installing a new pack version rather than editing the pack in place.

A vanilla installation shows a prompt to add a loader first. Loader changes can be made any time on the installation itself; the profile then needs a fresh download, while worlds and saves are untouched.

## Bedrock Edition

Minecraft for Windows and Minecraft Preview are detected through their Microsoft Store packages (`Get-AppxPackage`), which also supply the version, the package family name, and the app id used to start the game. Both the current GDK data layout (`%APPDATA%\Minecraft Bedrock\Users\<id>\games\com.mojang`) and the older UWP one (`%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang`) are probed, newest first, so the launcher finds the folder the game is actually using.

**Installations** splits into Java and Bedrock tabs, the same way **Versions** does. The Bedrock tab lists every edition Windows has registered for this account plus every build downloaded into the launcher's folder, with the counts shown on the tab; a downloaded build that is the installed one is marked **Registered** and cannot be deleted while Windows runs it.

From **Installations → Bedrock Edition** you can launch the edition, open its data folder, or jump to its worlds. The dashboard also lists detected editions for one-click launching. Bedrock keeps its own account and world data, so Java-only controls such as loaders, memory, Java runtimes, and Modrinth content do not apply to it.

### Playing Bedrock from the Play button

The dashboard's Play button launches one target at a time, and Bedrock editions can be that target. **Use for Play** on a Bedrock card in **Installations** — or simply launching Bedrock from its card, the dashboard section, or a Bedrock server — points Play at that edition: the hero then shows the edition's name and version, swaps the badges for **Bedrock Edition**, and its quick action becomes **Data folder** (opening the edition's `com.mojang` folder) instead of the Java game folder. Picking a Java profile again (**Set as selected** in the profile's menu, or launching it) hands Play back to Java.

Bedrock is started by Windows rather than by the launcher, so it has no process, log, or playtime tracking here; each launch is recorded in **Recent activity** with the edition and version it started.

### Other Bedrock versions

**Versions → Bedrock Edition** lists the builds that have been published to the Microsoft Store, so you can play an older or newer one than the copy the Store installed. The version list is community-maintained and holds Microsoft's own package links ([ddf8196/mc-w10-versiondb-auto-update](https://github.com/ddf8196/mc-w10-versiondb-auto-update) for the UWP-era APPX builds, [MinecraftBedrockArchiver/GdkLinks](https://github.com/MinecraftBedrockArchiver/GdkLinks) for the current MSIXVC ones). Aqua merges both, caches them for six hours, and resolves the actual download URL through Microsoft's update service (`fe3.delivery.mp.microsoft.com`) for APPX entries.

Choosing **Download** streams the package into `bedrock/downloads/` and unpacks it into `bedrock/versions/<version>/` — the launcher's own folder, never the Store's install directory. Two package shapes are supported:

- **APPX** (UWP-era builds): unpacked entry by entry, with the Store signature dropped, exactly as the existing version switchers do. **Register build** then runs `Add-AppxPackage -Path … -Register` through one elevated PowerShell prompt, after which Minecraft for Windows can be launched through the same Activation Manager path the launcher already uses. Windows **Developer Mode** is required and Aqua says so when it is off.
- **MSIXVC** (current GDK builds): an encrypted Store container with no manifest to point at, so it is saved as `package.msixvc` and handed to Windows with **Install build**, which runs `Add-AppxPackage -Path …` unelevated for the signed-in account. Windows deploys it over the copy it is running now, and an older build is passed `-ForceUpdateFromAnyVersion` so the downgrade is accepted. The confirmation spells out that Minecraft's data folder moves when switching between UWP and GDK builds, so worlds should be backed up first.

Registering is a swap, not a side-by-side install: Windows points the `Microsoft.MinecraftUWP` package at the downloaded folder for your account, so the Microsoft Store copy stops being listed (the launcher reports Minecraft for Windows as not found) until you install it again. The confirmation dialog says so before anything changes. To get the Store copy back, open the Microsoft Store, find Minecraft for Windows under **Library**, and install it; the Store may also overwrite a registered build on its next update, in which case re-register the download to switch back.

Registration runs as the signed-in Windows account, so with **Developer Mode** on it needs no administrator at all — which matters on a standard-user PC, where an elevated prompt would run as a different account and register the build for the wrong profile. Aqua tries that path first and only falls back to the approved administrator prompt when Windows refuses.

Older builds (1.9.x and the 2015-era previews) also declare framework packages that current Windows 11 no longer ships, such as `Microsoft.Services.Store.Engagement`; Windows then refuses to deploy them. The register dialog can **drop just those requirements** from the build's manifest (a `.bak` copy is kept beside it) so the build registers and starts anyway — the affected Store features are the only thing lost. Removing a downloaded build is refused while Windows has it registered, because the registration points at those files.

Each download is roughly 0.9–1.2 GB, plus the same again once unpacked.

When Windows reports no Store edition but the launcher still has builds downloaded, **Installations** lists them with **Register build** (APPX) or **Install build** (MSIXVC), **Open folder**, and **Remove**, so a swapped or deleted registration can be restored without downloading anything again. Both Bedrock pages lead with a **Downloaded builds** strip, so a build that is older than the first page of the catalog still has its action in reach.

### Bedrock add-ons

**Extra content → Bedrock Edition** manages the packs in the selected edition's `com.mojang` folders, split into behavior, resource, and skin packs with each pack's name, version, size, file count, and install time.

Add-ons are files rather than a service, so there are two ways in:

- **Import add-on** accepts a `.mcpack`, `.mcaddon`, or `.mcworld` file. Packs are unpacked into `behavior_packs`, `resource_packs`, or `skin_packs` according to their manifest's module type, with the manifest's own name and `texts/en_US.lang` translations shown in the list; `.mcworld` files are installed as worlds. Remove deletes a pack folder from Minecraft's directory, and the confirmation says that worlds already using it will lose it.
- **Browse add-ons** is a browser built into the page for the sites that share packs (MCPE Addons, ModBay, and more through the address bar). It runs in its own Electron session with no Node access, no preload script, denied permissions, and only http(s) navigation. Downloads of `.mcpack`, `.mcaddon`, and `.mcworld` are intercepted before they reach disk and installed straight into the edition, with a toast naming the packs and the list refreshing itself; a download that cannot be installed is copied to your Downloads folder so it can still be imported by hand.

MCPEDL is the largest of those sites, but it answers embedded browsers with a bot check that never clears, so its shortcut opens in your real browser and its files come back through **Import add-on**. None of these sites offers a public catalogue API (and Modrinth and CurseForge do not carry Bedrock add-ons), which is why this is a browser view rather than a search integration. Bedrock still applies packs per world, in the game under **Settings → Add-Ons**, so an installed pack appears under a world's add-on settings rather than changing every world at once.

## Horizon (Rust Edition)

Horizon is the open-source Rust rewrite of Minecraft: Java Edition (26.3, Wilderness Bound), and it keeps its own game home and worlds. **Installations → Horizon** installs Horizon inside Aqua and starts the Rust client directly — the same external-launch model as Bedrock, not a Java profile. Horizon's launcher is not required, downloaded, or run.

Installing a build from the panel does the whole job inside Aqua's data folder:

- Downloads the matching official game release from `horizon-rust/horizon` on GitHub and verifies its SHA-256 checksum.
- Installs the Minecraft version pinned by the release's `research-lock.json` through Aqua's normal Minecraft pipeline (or reuses an existing Aqua install of it).
- Downloads the pinned server jar and installs the required Mojang Java runtime when Java 25 is not already available.
- Runs Horizon's own bundled `horizon-prepare --prepare` against Aqua's Minecraft folder, then copies the pinned sounds with `horizon-prepare sounds`.
- Writes a build marker and registers the prepared build for direct launch.

The build, downloads, game home, and worlds live under `%APPDATA%\Aqua Launcher\horizon\` on Windows (or the equivalent Aqua `userData` folder on macOS and Linux). Horizon's old launcher folder, `HORIZON_LAUNCHER_HOME`, and `.installed` markers are not read. A build is playable once its resource manifest (`horizon-resources.json`) is present; the panel shows progress for each install and lets you cancel it. If the optional sound copy fails, the build is still installed and the panel notes that it will be silent.

**Play** starts the newest installed build (`horizon-client --resources …`) with the Aqua Horizon game home as its working directory and sets `HORIZON_HOME` for the child. Each build also has its own **Play** button. **Game folder**, **Worlds**, **Builds**, and **Downloads** open Aqua's folders. Because the Rust game runs outside Aqua, Horizon launches have no playtime, log capture, or crash report in Aqua. You still need your own Minecraft: Java Edition copy, which Horizon's preparer reads from the files Aqua installs. [Horizon's site](https://playhorizon.dev/) covers the project.

### Horizon mods

Horizon does not load Fabric or NeoForge jars — it has no Java classes for them to patch. It reads three file types of its own, and Aqua installs each where the Rust client looks for it, under the Horizon game folder beside `options.txt`:

| File | Folder | What it is |
| --- | --- | --- |
| `.hmod` | `horizon-mods/` | A content mod: blocks, items, recipes, loot and assets, read when the game starts. |
| `.hnmod` | `horizon-native-mods/` | A native mod: a Rust mixin bundle Aqua compiles into the game with Rust. |
| `.zip` | `resourcepacks/` | A resource pack layered over Horizon's resources. |

**Extra content → Horizon Mods → Browse mods** reads the registry behind [playhorizon.dev/mods](https://playhorizon.dev/mods) directly, the way Horizon's own launcher does: search, kind filters, the newest version for Minecraft 26.3, and an **Install** button. The release file's size and SHA-256 are checked, revocations in the registry are respected, and the file lands in the folder above with no separate import step. **Import mod** accepts the same files by hand, and **Open folder** goes to each one.

Horizon keeps switches in `horizon-mods.txt` as `mod.<id>:true` lines. Content mods start off until the Installed list turns them on; native mods run until turned off. Aqua writes that file exactly as the game does and leaves Horizon's key binds alone.

Native `.hnmod` mods are compiled into Horizon by Aqua itself: **Build native game** in the Installed list resolves the Horizon commit the mods pin, downloads that revision's source, applies the mods with `horizon-mixins`, and runs `cargo build --locked` the same way Horizon's launcher does. The finished `native-<revision>-<key>` build is installed beside the release builds and Play starts it like any other. The first build downloads the source (~63 MB) and the crates and can take 20–30 minutes; later builds reuse both.

Rust is downloaded into Aqua on the first build too — a minimal stable toolchain of about 600 MB on disk under `horizon/native/toolchain/`, so rustup does not need to be installed and nothing is added to the system PATH. On Windows Aqua uses the MSVC toolchain when Visual Studio's C++ tools are present and otherwise the GNU toolchain; macOS still needs the Xcode command-line tools for its linker.

## Worlds and backups

**Worlds & backups** reads each world's `level.dat` to show its real name, game mode, difficulty, Minecraft version, last-played time, file count, and size. From there you can open a world folder, delete a world, or create a ZIP backup.

Switch the page to **Bedrock** to list the worlds in the selected Bedrock edition's `minecraftWorlds` folder. Bedrock names come from each world's `levelname.txt` and its thumbnail from `world_icon.jpeg`; those worlds are listed read-only, because Bedrock manages them inside the Store app.

Backups are stored per installation under `backups/` in the launcher data folder. A restore is deliberately non-destructive: it adds the snapshot as `Name (restored)` beside the existing world, so an accidental restore can never replace the world you are still playing. Worlds are backed up on demand; close Minecraft first if you want a fully consistent snapshot.

## Servers

**Servers** stores the addresses you play on and pings each one the way its edition expects. Java servers use the same Server List Ping handshake as the game's multiplayer screen, so cards show the MOTD, online/max players, server version, latency, and the server's icon; joining launches the selected installation with `--quickPlayMultiplayer`. Addresses entered without a port stay port-free for Quick Join, which keeps SRV records working; status pings follow those records too.

Bedrock servers are queried with RakNet's Unconnected Ping over UDP (port 19132 by default), which returns the MOTD, level name, player counts, version, and game mode. Joining opens Minecraft for Windows through `minecraft://connect?serverUrl=…&serverPort=…`, so Bedrock connects on load without a Java profile. Pick the edition when you add a server; it is shown on the card and can only be changed by re-adding the server.

Quick join needs Minecraft 1.20 or newer. On older versions the game opens normally and Aqua tells you to connect from the multiplayer menu. Offline profiles can only join servers with `online-mode=false`; online-mode servers need Microsoft sign-in.

## Artwork

The dashboard background and wordmark are replaceable without code changes. Drop images into [`public/artwork/`](public/artwork/README.md):

- Background: `background.png`, `background.jpg`, `background.jpeg`, or `background.webp`
- Title: `title.png`, `title.webp`, or `title.svg` (transparent background recommended)

The first matching file wins. If none exists, Aqua falls back to its built-in pixel wordmark and voxel scene. See [`public/artwork/README.md`](public/artwork/README.md) for recommended sizes and composition.

The dashboard background itself prefers the version's own update art. Aqua fetches it from `https://aqua.ch1n.dev/api/launcher/artwork/<version>.png`, checks it is a PNG, and caches it under `cache/artwork/` so it keeps working offline. A release with its own artwork keeps it; a release without art walks forward through its own update line to the file named after the update's last release (1.7.6 asks for 1.7.10, 1.20.1 asks for 1.20.2), while 1.5 never borrows 1.6's art. When the endpoint has no art for a version, Aqua falls back to the older Mojang pipeline: it works out which game drop the version belongs to from that version's patch notes, downloads the drop's wallpaper pack, keeps the sharpest wide image, and caches it as a 1920 px JPEG. Versions released before the published drops (1.19.4 and older) have no art, so they use `background.*` instead.

## Data locations

Aqua stores its data in Electron's per-user application data directory:

| Platform | Directory |
| --- | --- |
| Windows | `%APPDATA%\Aqua Launcher` |
| macOS | `~/Library/Application Support/Aqua Launcher` |
| Linux | `~/.config/Aqua Launcher` |

Inside that folder:

- `launcher.json` — settings, installations, saved servers, and activity history
- `accounts.bin` — encrypted account tokens
- `minecraft/` — shared versions, libraries, and assets
- `instances/` — default per-installation game directories
- `runtime/` — downloaded Mojang Java runtimes
- `logs/launcher.log` and `logs/game/` — launcher and game output
- `backups/<installation>/` — world backup archives and their index
- `bedrock/versions/<version>/` and `bedrock/downloads/` — downloaded Bedrock builds and their temporary packages

Custom game directories are validated against drive roots and protected system locations such as `C:\Windows` and `Program Files`.

## Development

```bash
npm test         # Node test runner: rules, arguments, paths, worlds, servers, Bedrock, settings
npm run typecheck
npm run build
npm run icons    # regenerate app icons from scripts/generate-icons.mjs
```

### Project structure

```text
electron/
  main.js             window, tray, single-instance lock, service wiring
  preload.cjs         typed, allow-listed IPC bridge
  ipc.js              IPC handlers and validation boundary
  core/
    accounts.js       Microsoft OAuth, offline profiles, token storage
    versions.js       Mojang manifest and version metadata cache
    installations.js  profile CRUD and directory management
    installer.js      download planning and file verification
    downloader.js     bounded-concurrency downloads with retries
    worlds.js         level.dat parsing, world listing, ZIP backups and restores
    servers.js        saved servers, Server List Ping, quick-join metadata
    bedrock.js        Store edition detection, launching, Bedrock worlds
    bedrock-versions.js  Store version catalogue, package downloads, registration
    bedrock-addons.js    Bedrock pack parsing, import/remove, add-on listing
    horizon.js          Horizon release install, preparation, and direct Rust client launch
    addon-browser.js     in-app add-on browser policy and download-to-import bridge
    java.js           Java detection and Mojang runtime provisioning
    game.js           launch construction, process tracking, crash capture
    logs.js           launcher/game log reading and exports
    settings.js       defaults and validation
    store.js          atomic JSON persistence
src/
  pages/              Home, Installations, Worlds, Servers, Versions, Extra content, Account, Logs, Roadmap & docs, Settings
  components/         layout, dialogs, overlays, bedrock, design-system primitives
  state/              launcher provider and renderer state
  lib/                IPC API, types, formatting helpers
  styles/             tokens, components, application layout
public/artwork/       optional background and title artwork
tests/                core unit tests
```

## Packaging

```bash
npm run electron:build
```

This builds the renderer and uses `electron-builder` to produce an installer in `release/` (NSIS on Windows, DMG on macOS, AppImage on Linux). Builds are unsigned by default, so Windows SmartScreen may warn until you add a code-signing certificate.

## Known limitations

- Microsoft authentication is disabled in the UI (`src/lib/features.ts`) until the Azure app is approved by Mojang; the offline path is fully functional without it.
- Quick join (`--quickPlayMultiplayer`) requires Minecraft 1.20 or newer. Older versions still launch, with a prompt to connect manually.
- World backups are ZIP archives created on demand; Aqua does not schedule automatic backups.
- Minecraft 1.12.2 and older (and their Forge/Fabric-era mod loaders) run only on Java 8, which the launcher will not substitute with a newer runtime — install it once from **Settings → Java → Official runtimes → Install Java 8** and those profiles pick it up automatically.
- Offline profiles cannot authenticate with online-mode servers.
- Java detection scans common system locations and Aqua's own runtime folder. You can always select a custom `java.exe` in Settings.
- The launcher supports vanilla and version metadata that follows the standard Mojang format; mod loaders are not installed automatically.
- Bedrock support is Windows-only, and only for the Minecraft Store editions. The Store app owns updates, sign-in, and world management, so Aqua detects, launches, and lists it rather than installing or patching it. Bedrock worlds cannot be backed up or deleted from the launcher.
- Horizon is installed and prepared by Aqua; its launcher is not used. Horizon launches still have no playtime or log/crash tracking, and Horizon accounts and extra instances stay outside Aqua. Horizon mods are managed in the game's own `horizon-mods`, `horizon-native-mods`, and `resourcepacks` folders; native `.hnmod` bundles are compiled into a playable Horizon build by Aqua when Rust and a platform linker are installed.
- Bedrock game versions are derived from the Store package version (package `1.21.2301.0` is game `1.21.23.01`), because the package does not carry the display version. The raw package version is shown next to it.
- Downloaded Bedrock builds are unofficial copies of Store packages: APPX builds need Developer Mode (with an administrator prompt as the fallback) to register, MSIXVC builds are installed through Windows and replace the current copy, and the Store can overwrite either on its next update. Only use builds you are entitled to play.
- Older Bedrock builds that Microsoft has delisted can still be listed, but their packages are no longer served, so downloading them fails with a clear message.
- Builds that depend on frameworks Windows 11 no longer ships only register once those requirements are dropped from their manifest, and any Store feature backed by that framework stops working.
- The Play target is remembered for the running session only; the launcher starts on the active Java installation again after a restart.
