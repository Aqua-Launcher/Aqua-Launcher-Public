/**
 * Small, dependency-free command index.
 *
 * The palette scores labels before descriptions and keywords, then promotes
 * exact and word-boundary substrings so "surv" finds "Survival" ahead of a
 * scattered match in an unrelated description.
 */

export type CommandGroup =
  | 'Commands'
  | 'Pages'
  | 'Installations'
  | 'Worlds'
  | 'Servers'
  | 'Content'
  | 'Settings'
  | 'Accounts'

export interface CommandSearchItem {
  id: string
  label: string
  description?: string
  group: CommandGroup
  keywords?: string[]
}

export interface CommandGroupResult<T> {
  group: CommandGroup
  items: T[]
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function boundaryBefore(text: string, index: number) {
  return index === 0 || /[\s._\-/(:]/u.test(text[index - 1])
}

/** Returns a positive score when every query character appears in order. */
export function fuzzyScore(query: string, value: string): number | null {
  const needle = normalize(query)
  const text = normalize(value)
  if (!needle) return 0
  if (!text) return null

  const exact = text.indexOf(needle)
  if (exact >= 0) {
    let score = 160 + needle.length * 9 - exact * 1.5
    if (text === needle) score += 120
    else if (boundaryBefore(text, exact)) score += 45
    return score - (text.length - needle.length) * 0.08
  }

  let score = 0
  let cursor = 0
  let previous = -2
  for (const character of needle) {
    const found = text.indexOf(character, cursor)
    if (found < 0) return null
    let points = 10
    if (boundaryBefore(text, found)) points += 13
    if (found === previous + 1) points += 9
    score += points
    previous = found
    cursor = found + 1
  }
  return score - (text.length - needle.length) * 0.12
}

export function scoreCommand(item: CommandSearchItem, query: string): number | null {
  const label = fuzzyScore(query, item.label)
  const description = fuzzyScore(query, item.description ?? '')
  const keywords = fuzzyScore(query, (item.keywords ?? []).join(' '))
  if (label == null && description == null && keywords == null) return null
  return Math.max(label == null ? -Infinity : label * 3, description == null ? -Infinity : description, keywords == null ? -Infinity : keywords * 1.2)
}

export function searchCommands<T extends CommandSearchItem>(items: T[], query: string, limit = 80): T[] {
  const needle = normalize(query)
  if (!needle) return items.slice(0, limit)
  const scored: Array<{ item: T; score: number; index: number }> = []
  for (let index = 0; index < items.length; index += 1) {
    const score = scoreCommand(items[index], needle)
    if (score != null) scored.push({ item: items[index], score, index })
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.item)
}

/** Groups sorted results without letting a low-ranked group jump above a hit. */
export function groupCommands<T extends CommandSearchItem>(items: T[]): Array<CommandGroupResult<T>> {
  const groups = new Map<CommandGroup, { items: T[]; firstIndex: number }>()
  items.forEach((item, index) => {
    const existing = groups.get(item.group)
    if (existing) existing.items.push(item)
    else groups.set(item.group, { items: [item], firstIndex: index })
  })
  return [...groups.entries()]
    .sort((a, b) => a[1].firstIndex - b[1].firstIndex)
    .map(([group, value]) => ({ group, items: value.items }))
}

export function searchCommandGroups<T extends CommandSearchItem>(
  items: T[],
  query: string,
  limit = 80,
): Array<CommandGroupResult<T>> {
  return groupCommands(searchCommands(items, query, limit))
}