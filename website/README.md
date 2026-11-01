# Aqua Launcher — website

A self-contained marketing site for Aqua Launcher. Plain HTML, CSS, and JavaScript: no build
step, no framework, no external network requests. Fonts, artwork, and screenshots are bundled.

The visual language is a full-screen Minecraft key-art slider over a deep navy night, Minecraftia
throughout, and a cyan-to-blue accent. It is inspired by [playhorizon.dev](https://playhorizon.dev/)
and adapted to Aqua's own screenshots and copy.

## Preview

From the repository root, using the Vite copy already installed for the desktop app:

```bash
node_modules/.bin/vite website --port 5174 --strictPort
```

Then open <http://localhost:5174>. Any static file server works too:

```bash
npx serve website
```

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | The whole page, including the artwork hero, inline SVG icons, and Horizon panel |
| `styles.css` | Design tokens, layout, components, responsive rules, motion |
| `script.js` | Header state, mobile nav, artwork slider, scroll reveals, screenshot tabs, lightbox, copy buttons |
| `assets/artwork/` | Minecraft key art used by the hero slider (Tricky Trials, Chaos Cubed, Mounts of Mayhem) |
| `assets/fonts/` | Minecraftia (self-hosted WOFF); code and small labels use the system monospace stack |
| `assets/screenshots/` | Dashboard and block-theme screenshots from the app |
| `assets/icon.png`, `assets/favicon.png` | Launcher icon |
| `assets/og.jpg` | Social preview image (1200 × 630) |

## Notes

- The hero fills the viewport with Minecraft key art and advances every 7 seconds. It pauses on
  hover over the controls, when the tab is hidden, when the pause button is pressed, and when the
  visitor prefers reduced motion. The arrows, dots, and pause button are real controls, and the
  paused state is exposed through `aria-pressed`.
- Horizon support is real, not a mock-up: Aqua downloads the official Rust client from
  `horizon-rust/horizon`, verifies its SHA-256, runs Horizon's preparer against Minecraft: Java
  Edition files, and launches the client directly. Copy in the Horizon section follows
  `electron/core/horizon.js`, including the Windows, macOS, and Linux release assets.
- Copy elsewhere is checked against the repository README and roadmap. The project has no
  published GitHub releases, so the site sends people to build from source rather than offering a
  fake download.
- Screenshot tabs and the lightbox use the real `screenshots/` captures. They show the app as it
  is, including its pixel-font interface.
- The fonts and artwork are self-hosted so the page makes no third-party requests. To change copy,
  edit `index.html`; to adjust the palette or spacing, edit the custom properties at the top of
  `styles.css`.
- Update the absolute `og:image` URL once the site has a real domain; relative paths work for the
  page itself but most social scrapers prefer an absolute URL.
- To deploy, upload the contents of this folder to any static host. All asset paths are relative.
