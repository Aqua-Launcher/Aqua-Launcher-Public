import type { ContentFilterEnvironment, ContentFilterSort, ModrinthContentType } from './types'

export const FILTER_SORTS: { id: ContentFilterSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'follows', label: 'Followers' },
  { id: 'newest', label: 'Newest' },
  { id: 'updated', label: 'Recently updated' },
]

export const FILTER_ENVIRONMENTS: { id: ContentFilterEnvironment; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'client', label: 'Client' },
  { id: 'server', label: 'Server' },
]

export const FILTER_LICENSES = [
  { id: 'mit', label: 'MIT' },
  { id: 'apache-2.0', label: 'Apache-2.0' },
  { id: 'gpl-3.0', label: 'GPL-3.0' },
  { id: 'lgpl-3.0', label: 'LGPL-3.0' },
  { id: 'mpl-2.0', label: 'MPL-2.0' },
  { id: 'bsd-3-clause', label: 'BSD-3-Clause' },
  { id: 'cc0-1.0', label: 'CC0-1.0' },
  { id: 'unlicense', label: 'Unlicense' },
]

export const FILTER_LOADERS = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
]

export const FILTER_CATEGORIES: Record<ModrinthContentType, { id: string; label: string }[]> = {
  mod: [
    { id: 'optimization', label: 'Optimization' },
    { id: 'library', label: 'Library' },
    { id: 'utility', label: 'Utility' },
    { id: 'technology', label: 'Technology' },
    { id: 'magic', label: 'Magic' },
    { id: 'adventure', label: 'Adventure' },
    { id: 'worldgen', label: 'Worldgen' },
    { id: 'decoration', label: 'Decoration' },
    { id: 'storage', label: 'Storage' },
    { id: 'equipment', label: 'Equipment' },
    { id: 'mobs', label: 'Mobs' },
    { id: 'transportation', label: 'Transportation' },
    { id: 'food', label: 'Food' },
    { id: 'game-mechanics', label: 'Game mechanics' },
  ],
  modpack: [
    { id: 'adventure', label: 'Adventure' },
    { id: 'combat', label: 'Combat' },
    { id: 'kitchen-sink', label: 'Kitchen sink' },
    { id: 'lightweight', label: 'Lightweight' },
    { id: 'magic', label: 'Magic' },
    { id: 'multiplayer', label: 'Multiplayer' },
    { id: 'optimization', label: 'Optimization' },
    { id: 'quests', label: 'Quests' },
    { id: 'technology', label: 'Technology' },
    { id: 'vanilla-like', label: 'Vanilla-like' },
  ],
  resourcepack: [
    { id: 'blocks', label: 'Blocks' },
    { id: 'combat', label: 'Combat' },
    { id: 'decoration', label: 'Decoration' },
    { id: 'entities', label: 'Entities' },
    { id: 'environment', label: 'Environment' },
    { id: 'equipment', label: 'Equipment' },
    { id: 'gui', label: 'GUI' },
    { id: 'items', label: 'Items' },
    { id: 'realistic', label: 'Realistic' },
    { id: 'simplistic', label: 'Simplistic' },
    { id: 'themed', label: 'Themed' },
    { id: 'vanilla-like', label: 'Vanilla-like' },
  ],
  shader: [
    { id: 'cartoon', label: 'Cartoon' },
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'realistic', label: 'Realistic' },
    { id: 'semi-realistic', label: 'Semi-realistic' },
    { id: 'simplistic', label: 'Simplistic' },
    { id: 'vanilla-like', label: 'Vanilla-like' },
    { id: 'atmosphere', label: 'Atmosphere' },
    { id: 'colored-lighting', label: 'Colored lighting' },
    { id: 'shadows', label: 'Shadows' },
    { id: 'water', label: 'Water' },
  ],
  datapack: [
    { id: 'adventure', label: 'Adventure' },
    { id: 'decoration', label: 'Decoration' },
    { id: 'worldgen', label: 'Worldgen' },
    { id: 'utility', label: 'Utility' },
    { id: 'technology', label: 'Technology' },
    { id: 'magic', label: 'Magic' },
    { id: 'storage', label: 'Storage' },
    { id: 'game-mechanics', label: 'Game mechanics' },
  ],
}
