import path from 'node:path'

/** Palette ids are persisted; the renderer maps them to actual swatches. */
export const INSTALLATION_COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'rose', 'violet']
export const MAX_INSTALLATION_TAGS = 8
export const MAX_INSTALLATION_TAG_LENGTH = 24
const MAX_SORT_INDEX = 99_999

/** Trim, de-duplicate case-insensitively, cap length and count. */
export function normalizeTags(value, { maxTags = MAX_INSTALLATION_TAGS, maxLength = MAX_INSTALLATION_TAG_LENGTH } = {}) {
  if (!Array.isArray(value)) return []
  const tags = []
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().replace(/\s+/g, ' ').slice(0, maxLength)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= maxTags) break
  }
  return tags
}

export function normalizeColor(value) {
  return typeof value === 'string' && INSTALLATION_COLORS.includes(value) ? value : null
}

export function normalizeSortIndex(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return null
  return Math.min(number, MAX_SORT_INDEX)
}

/** Covers are launcher-owned absolute paths; the field is stored, not fetched. */
export function normalizeCoverPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (trimmed.length > 500 || !path.isAbsolute(trimmed)) return null
  return path.normalize(trimmed)
}

export function normalizeInstallationMeta(raw) {
  return {
    pinned: raw?.pinned === true,
    tags: normalizeTags(raw?.tags),
    color: normalizeColor(raw?.color),
    coverPath: normalizeCoverPath(raw?.coverPath),
    sortIndex: normalizeSortIndex(raw?.sortIndex),
  }
}

/** Pinned profiles stay at the top; everything else remains recency-first. */
export function compareInstallationRecency(left, right) {
  if (Boolean(left?.pinned) !== Boolean(right?.pinned)) return left?.pinned ? -1 : 1
  const leftTime = new Date(left?.lastPlayedAt || left?.createdAt || 0).getTime()
  const rightTime = new Date(right?.lastPlayedAt || right?.createdAt || 0).getTime()
  return rightTime - leftTime
}
