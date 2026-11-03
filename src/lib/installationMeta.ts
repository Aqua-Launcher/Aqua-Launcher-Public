import type { Installation, InstallationColor } from './types'

export const INSTALLATION_COLORS: Array<{ id: InstallationColor; label: string; hex: string }> = [
  { id: 'slate', label: 'Slate', hex: '#8a9aab' },
  { id: 'blue', label: 'Blue', hex: '#4f9fe8' },
  { id: 'teal', label: 'Teal', hex: '#3fbfae' },
  { id: 'green', label: 'Green', hex: '#6cc47a' },
  { id: 'amber', label: 'Amber', hex: '#d8a64a' },
  { id: 'rose', label: 'Rose', hex: '#e0748c' },
  { id: 'violet', label: 'Violet', hex: '#a78bfa' },
]

export type InstallationSortMode = 'recent' | 'name' | 'custom'
export type InstallationViewMode = 'grid' | 'compact'

export function installationColorHex(color: InstallationColor | null | undefined) {
  return INSTALLATION_COLORS.find((entry) => entry.id === color)?.hex || null
}

/**
 * Pinned profiles always come first. Recent sorting keeps the Play target at the
 * top; custom sorting follows the explicitly persisted sortIndex instead, so a
 * launch cannot reshuffle a hand-made order.
 */
export function sortInstallations(list: Installation[], mode: InstallationSortMode): Installation[] {
  return [...list].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    if (mode === 'name') return left.name.localeCompare(right.name)
    if (mode === 'custom') {
      const leftIndex = left.sortIndex ?? Number.MAX_SAFE_INTEGER
      const rightIndex = right.sortIndex ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
    } else if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1
    }
    return (
      new Date(right.lastPlayedAt || right.createdAt).getTime() -
      new Date(left.lastPlayedAt || left.createdAt).getTime()
    )
  })
}
