import type { CSSProperties } from 'react'
import type { AccentName, BlockId, CustomThemeSettings, SurfaceMode, ThemeSurface } from './types'

/**
 * Custom launcher themes.
 *
 * Block textures come straight out of the installed Minecraft client jar, which
 * the main process extracts and caches (`electron/core/block-textures.js`).
 * Nothing is bundled with the launcher and no placeholder art is fabricated: a
 * surface that has no extracted texture is simply left unpainted, and the
 * settings UI explains that a Minecraft installation is required.
 */

export type BlockGroup = 'Overworld' | 'Nether' | 'End & deep' | 'Ores & blocks'

interface BlockDefinition {
  id: BlockId
  label: string
  group: BlockGroup
  /** Suggested colour for plain-colour mode and the picker chip. */
  color: string
}

export const BLOCKS: BlockDefinition[] = [
  { id: 'grass_block', label: 'Grass block', group: 'Overworld', color: '#6aa84f' },
  { id: 'dirt', label: 'Dirt', group: 'Overworld', color: '#8a6544' },
  { id: 'stone', label: 'Stone', group: 'Overworld', color: '#8f8f8f' },
  { id: 'cobblestone', label: 'Cobblestone', group: 'Overworld', color: '#8a8a8a' },
  { id: 'mossy_cobblestone', label: 'Mossy cobblestone', group: 'Overworld', color: '#7c8f70' },
  { id: 'gravel', label: 'Gravel', group: 'Overworld', color: '#8b8682' },
  { id: 'sand', label: 'Sand', group: 'Overworld', color: '#dbd3a0' },
  { id: 'oak_planks', label: 'Oak planks', group: 'Overworld', color: '#b08b52' },
  { id: 'spruce_planks', label: 'Spruce planks', group: 'Overworld', color: '#6f5334' },
  { id: 'oak_log', label: 'Oak log', group: 'Overworld', color: '#6b5334' },
  { id: 'leaves', label: 'Oak leaves', group: 'Overworld', color: '#4f7f32' },
  { id: 'glass', label: 'Glass', group: 'Overworld', color: '#cfe3ea' },

  { id: 'netherrack', label: 'Netherrack', group: 'Nether', color: '#6f3535' },
  { id: 'nether_bricks', label: 'Nether bricks', group: 'Nether', color: '#3e2222' },
  { id: 'soul_sand', label: 'Soul sand', group: 'Nether', color: '#574a41' },

  { id: 'end_stone', label: 'End stone', group: 'End & deep', color: '#dedea4' },
  { id: 'purpur_block', label: 'Purpur block', group: 'End & deep', color: '#a97fa9' },
  { id: 'obsidian', label: 'Obsidian', group: 'End & deep', color: '#1b1526' },
  { id: 'bedrock', label: 'Bedrock', group: 'End & deep', color: '#555555' },
  { id: 'deepslate', label: 'Deepslate', group: 'End & deep', color: '#4a4a4f' },
  { id: 'sculk', label: 'Sculk', group: 'End & deep', color: '#1c3038' },
  { id: 'amethyst_block', label: 'Amethyst', group: 'End & deep', color: '#8a6fb8' },

  { id: 'diamond_ore', label: 'Diamond ore', group: 'Ores & blocks', color: '#7f8f95' },
  { id: 'gold_ore', label: 'Gold ore', group: 'Ores & blocks', color: '#8f8f7f' },
  { id: 'redstone_ore', label: 'Redstone ore', group: 'Ores & blocks', color: '#8f8f8f' },
  { id: 'emerald_ore', label: 'Emerald ore', group: 'Ores & blocks', color: '#8f8f8f' },
  { id: 'diamond_block', label: 'Diamond block', group: 'Ores & blocks', color: '#6ee0e0' },
  { id: 'gold_block', label: 'Gold block', group: 'Ores & blocks', color: '#f2c94c' },
  { id: 'emerald_block', label: 'Emerald block', group: 'Ores & blocks', color: '#3fd18a' },
  { id: 'netherite_block', label: 'Netherite block', group: 'Ores & blocks', color: '#3a3236' },
  { id: 'prismarine', label: 'Prismarine', group: 'Ores & blocks', color: '#62a695' },
  { id: 'ice', label: 'Ice', group: 'Ores & blocks', color: '#9fc6e8' },
]

export const BLOCK_GROUPS: BlockGroup[] = ['Overworld', 'Nether', 'End & deep', 'Ores & blocks']

export const SURFACE_MODES: Array<{ value: SurfaceMode; label: string; hint: string }> = [
  { value: 'block', label: 'Block', hint: 'Tile a block texture from the game' },
  { value: 'color', label: 'Colour', hint: 'Paint one solid colour' },
  { value: 'off', label: 'Off', hint: 'Use the theme default' },
]

/* ------------------------------------------------------------- game textures */

let textureMap: Record<string, string> = {}
let textureEpoch = 0
const textureListeners = new Set<() => void>()

/**
 * Installs the texture set extracted by the main process. Passing an empty map
 * clears every surface texture (for example after the game files are removed).
 */
export function setBlockTextures(textures: Record<string, string> | null | undefined) {
  textureMap = textures && typeof textures === 'object' ? textures : {}
  textureEpoch += 1
  for (const listener of textureListeners) listener()
}

export function subscribeBlockTextures(listener: () => void): () => void {
  textureListeners.add(listener)
  return () => {
    textureListeners.delete(listener)
  }
}

export function blockTextureEpoch(): number {
  return textureEpoch
}

/** Official texture as a data URL, or '' when the installed version has none. */
export function blockTexture(id: BlockId | string): string {
  return textureMap[id] ?? ''
}

export function hasBlockTexture(id: BlockId | string): boolean {
  return Boolean(textureMap[id])
}

export function blockDefinition(id: BlockId | string): BlockDefinition {
  return BLOCKS.find((block) => block.id === id) ?? BLOCKS[0]
}

/* ------------------------------------------------------------- theme model */

export const DEFAULT_CUSTOM_THEME: CustomThemeSettings = {
  enabled: false,
  sidebar: { mode: 'block', block: 'grass_block', color: '#6aa84f', opacity: 45, pixelSize: 48 },
  titlebar: { mode: 'block', block: 'oak_planks', color: '#b08b52', opacity: 35, pixelSize: 40 },
  backdrop: { mode: 'off', block: 'stone', color: '#8f8f8f', opacity: 18, pixelSize: 96 },
  accentMode: 'theme',
  accentColor: '#2f7fe0',
}

export const ACCENT_HEX: Record<AccentName, string> = {
  aqua: '#2f7fe0',
  ocean: '#3f5fe0',
  steel: '#6f8cad',
}

/** Swatches offered under the plain-colour picker. */
export const SURFACE_SWATCHES = [
  '#6aa84f',
  '#8a6544',
  '#8f8f8f',
  '#dbd3a0',
  '#b08b52',
  '#62a695',
  '#4a4a4f',
  '#6f3535',
  '#8a6fb8',
  '#3fd18a',
  '#f2c94c',
  '#1c3038',
]

export const ACCENT_SWATCHES = [
  '#2f7fe0',
  '#5cc8e8',
  '#4f9fe8',
  '#93aecb',
  '#7ed957',
  '#4fd1c5',
  '#e5c05c',
  '#ef8354',
  '#e5779a',
  '#b98ce0',
]

function surface(
  block: BlockId,
  opacity: number,
  pixelSize: number,
  mode: SurfaceMode = 'block',
  color?: string,
): ThemeSurface {
  return { mode, block, color: color ?? blockDefinition(block).color, opacity, pixelSize }
}

export interface ThemePreset {
  id: string
  label: string
  accent: string
  sidebar: ThemeSurface
  titlebar: ThemeSurface
  backdrop: ThemeSurface
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'overworld',
    label: 'Overworld',
    accent: '#7ed957',
    sidebar: surface('grass_block', 45, 48),
    titlebar: surface('oak_planks', 34, 40),
    backdrop: { ...DEFAULT_CUSTOM_THEME.backdrop },
  },
  {
    id: 'nether',
    label: 'Nether',
    accent: '#ef8354',
    sidebar: surface('netherrack', 46, 48),
    titlebar: surface('nether_bricks', 44, 40),
    backdrop: surface('netherrack', 16, 128),
  },
  {
    id: 'end',
    label: 'The End',
    accent: '#b98ce0',
    sidebar: surface('end_stone', 34, 48),
    titlebar: surface('purpur_block', 42, 40),
    backdrop: { ...DEFAULT_CUSTOM_THEME.backdrop },
  },
  {
    id: 'deep-dark',
    label: 'Deep dark',
    accent: '#4fd1c5',
    sidebar: surface('sculk', 52, 48),
    titlebar: surface('deepslate', 46, 40),
    backdrop: surface('sculk', 22, 128),
  },
  {
    id: 'workshop',
    label: 'Workshop',
    accent: '#e5c05c',
    sidebar: surface('oak_planks', 40, 48),
    titlebar: surface('spruce_planks', 44, 40),
    backdrop: { ...DEFAULT_CUSTOM_THEME.backdrop },
  },
  {
    id: 'amethyst',
    label: 'Amethyst',
    accent: '#b98ce0',
    sidebar: surface('amethyst_block', 38, 48),
    titlebar: surface('obsidian', 55, 40),
    backdrop: surface('obsidian', 26, 128),
  },
]

/* ------------------------------------------------------------- colour maths */

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function mixHex(a: string, b: string, amount: number): string {
  const first = parseHex(a)
  const second = parseHex(b)
  if (!first || !second) return a
  const r = clamp255(first.r + (second.r - first.r) * amount)
  const g = clamp255(first.g + (second.g - first.g) * amount)
  const blue = clamp255(first.b + (second.b - first.b) * amount)
  return `#${[r, g, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function rgba(hex: string, alpha: number): string {
  const color = parseHex(hex)
  if (!color) return `rgba(255, 255, 255, ${alpha})`
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

/** Perceived brightness (0–1) of a hex colour. */
export function hexLuminance(hex: string): number {
  const color = parseHex(hex)
  if (!color) return 0
  return (0.299 * color.r + 0.587 * color.g + 0.114 * color.b) / 255
}

/** Extra dark scrim over a tile, scaled by how bright the material is, so text
 *  stays readable on sand and end stone without washing out obsidian. */
export function surfaceScrim(hex: string): number {
  return Math.round(Math.min(0.62, 0.16 + hexLuminance(hex) * 0.46) * 100) / 100
}

const SURFACE_VARS = {
  sidebar: {
    image: '--surface-sidebar-image',
    color: '--surface-sidebar-color',
    opacity: '--surface-sidebar-opacity',
    size: '--surface-sidebar-size',
    scrim: '--surface-sidebar-scrim',
  },
  titlebar: {
    image: '--surface-titlebar-image',
    color: '--surface-titlebar-color',
    opacity: '--surface-titlebar-opacity',
    size: '--surface-titlebar-size',
    scrim: '--surface-titlebar-scrim',
  },
  backdrop: {
    image: '--surface-backdrop-image',
    color: '--surface-backdrop-color',
    opacity: '--surface-backdrop-opacity',
    size: '--surface-backdrop-size',
    scrim: '--surface-backdrop-scrim',
  },
} as const

export const SURFACE_KEYS = ['sidebar', 'titlebar', 'backdrop'] as const
export type SurfaceKey = (typeof SURFACE_KEYS)[number]

export const SURFACE_LABELS: Record<SurfaceKey, { label: string; hint: string }> = {
  sidebar: { label: 'Sidebar', hint: 'Navigation column' },
  titlebar: { label: 'Title bar', hint: 'Window top edge' },
  backdrop: { label: 'Background', hint: 'Behind every page' },
}

const ACCENT_VARS = [
  '--accent',
  '--accent-strong',
  '--accent-text',
  '--accent-soft',
  '--accent-softer',
  '--accent-ink',
  '--accent-glow',
  '--line-accent',
] as const

export function accentVars(hex: string): Record<string, string> {
  const base = parseHex(hex) ? (hex.startsWith('#') ? hex.toLowerCase() : `#${hex.toLowerCase()}`) : '#2f7fe0'
  return {
    '--accent': base,
    '--accent-strong': mixHex(base, '#ffffff', 0.12),
    // Text and icons sit on the dark surface, so they take a lighter step than
    // the fill colour while keeping the same hue.
    '--accent-text': mixHex(base, '#ffffff', 0.42),
    '--accent-soft': rgba(base, 0.13),
    '--accent-softer': rgba(base, 0.06),
    '--accent-ink': hexLuminance(base) > 0.5 ? '#120b24' : '#ffffff',
    '--accent-glow': rgba(base, 0.2),
    '--line-accent': rgba(base, 0.36),
  }
}

function clearVars(root: HTMLElement, names: readonly string[]) {
  for (const name of names) root.style.removeProperty(name)
}

/** Paints (or clears) the surfaces and custom accent on the document. */
export function applyCustomTheme(root: HTMLElement, theme: CustomThemeSettings | null | undefined) {
  const enabled = Boolean(theme?.enabled)
  root.dataset.customTheme = String(enabled)

  for (const key of SURFACE_KEYS) {
    const vars = SURFACE_VARS[key]
    const value = theme?.[key]
    if (!enabled || !value || value.mode === 'off') {
      clearVars(root, [vars.image, vars.color, vars.opacity, vars.size, vars.scrim])
      continue
    }
    const isBlock = value.mode === 'block'
    const texture = isBlock ? blockTexture(value.block) : ''
    // No game files (or this version lacks the block): leave the stock surface
    // in place rather than inventing placeholder art.
    if (isBlock && !texture) {
      clearVars(root, [vars.image, vars.color, vars.opacity, vars.size, vars.scrim])
      continue
    }
    root.style.setProperty(vars.image, isBlock ? `url("${texture}")` : 'none')
    root.style.setProperty(vars.color, isBlock ? 'transparent' : value.color)
    root.style.setProperty(
      vars.scrim,
      String(surfaceScrim(isBlock ? blockDefinition(value.block).color : value.color)),
    )
    root.style.setProperty(vars.opacity, String(Math.max(0, Math.min(100, value.opacity)) / 100))
    root.style.setProperty(vars.size, `${Math.max(16, Math.min(128, value.pixelSize))}px`)
  }

  if (enabled && theme?.accentMode === 'custom') {
    for (const [name, value] of Object.entries(accentVars(theme.accentColor))) {
      root.style.setProperty(name, value)
    }
  } else {
    clearVars(root, ACCENT_VARS)
  }
}

/** Inline style for a mini preview of one surface. */
export function surfaceLayerStyle(value: ThemeSurface): CSSProperties {
  if (value.mode === 'off') {
    return { opacity: 0 }
  }
  if (value.mode === 'block') {
    const texture = blockTexture(value.block)
    if (!texture) return { opacity: 0 }
  }
  const swatch = value.mode === 'color' ? value.color : blockDefinition(value.block).color
  const scrim = surfaceScrim(swatch)
  return {
    backgroundImage: `linear-gradient(${rgba('#060a0e', scrim)}, ${rgba('#060a0e', scrim)}), ${
      value.mode === 'block' ? `url("${blockTexture(value.block)}")` : 'none'
    }`,
    backgroundColor: value.mode === 'color' ? value.color : 'transparent',
    backgroundSize: `auto, ${value.pixelSize}px`,
    backgroundRepeat: 'no-repeat, repeat',
    opacity: Math.max(0, Math.min(100, value.opacity)) / 100,
    imageRendering: 'pixelated',
  }
}
