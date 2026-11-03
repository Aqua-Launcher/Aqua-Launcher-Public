/**
 * A small Markdown reader for the two documents the launcher ships.
 *
 * The project does not carry a Markdown dependency, and the README/ROADMAP use a
 * narrow slice of the syntax: headings, paragraphs, lists, fenced code, tables,
 * quotes, rules, links, bold, inline code, and images (Markdown `![]()` plus the
 * centred HTML `<img>` banner the README opens with). This parses exactly that
 * slice into blocks; the React component turns blocks into elements.
 */

export type MarkdownImageAlign = 'left' | 'center' | 'right' | null

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'image'; src: string; alt: string; width: string | null; align: MarkdownImageAlign }
  | { kind: 'rule' }

const HEADING = /^(#{1,6})\s+(.*)$/
const FENCE = /^```(\w*)\s*$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/
const UL_ITEM = /^[-*]\s+(.*)$/
const OL_ITEM = /^\d+\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TABLE_ROW = /^\|(.+)\|$/
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/
const HTML_BLOCK = /^<(?:p|img|figure|picture|div)\b/i
const IMG_TAG = /<img\b([^>]*)>/i

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((cell) => cell.trim())
}

/** Reads one attribute from an HTML tag without pulling in a parser. */
function htmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
  if (!match) return null
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  return value || null
}

/**
 * A paragraph of raw HTML becomes an image block when it contains an `<img>`.
 * The README opens with one of these so the banner can be centred and given an
 * explicit width; everything else in the HTML chunk is presentation only.
 */
function readHtmlImage(lines: string[], start: number): { block: MarkdownBlock; next: number } | null {
  let end = start
  while (end < lines.length && lines[end].trim()) end += 1
  const html = lines.slice(start, end).join(' ')
  const image = IMG_TAG.exec(html)
  if (!image) return null
  const src = htmlAttribute(image[1], 'src')
  if (!src) return null
  const align = /\balign\s*=\s*(?:"(left|center|right)"|'(left|center|right)'|(left|center|right))/i.exec(html)
  const alignText = (align?.[1] || align?.[2] || align?.[3] || '').toLowerCase()
  const placement: MarkdownImageAlign =
    alignText === 'left' || alignText === 'center' || alignText === 'right' ? alignText : null
  return {
    block: {
      kind: 'image',
      src,
      alt: htmlAttribute(image[1], 'alt') || '',
      width: htmlAttribute(image[1], 'width'),
      align: placement,
    },
    next: end,
  }
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = FENCE.exec(line.trim())
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index].trim())) {
        body.push(lines[index])
        index += 1
      }
      index += 1 // closing fence
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    if (RULE.test(line.trim())) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    // Raw HTML is only interesting when it carries an image; otherwise it falls
    // through and renders as ordinary paragraph text.
    if (HTML_BLOCK.test(line.trim())) {
      const image = readHtmlImage(lines, index)
      if (image) {
        blocks.push(image.block)
        index = image.next
        continue
      }
    }

    // A table starts with a row and is confirmed by the separator underneath.
    if (TABLE_ROW.test(line.trim()) && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1].trim())) {
      const head = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && TABLE_ROW.test(lines[index].trim())) {
        rows.push(splitRow(lines[index]))
        index += 1
      }
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      const body = [quote[1]]
      index += 1
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index])
        if (!next) break
        body.push(next[1])
        index += 1
      }
      blocks.push({ kind: 'quote', text: body.join(' ').trim() })
      continue
    }

    const bullet = UL_ITEM.exec(line)
    const numbered = OL_ITEM.exec(line)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      const items: string[] = []
      while (index < lines.length) {
        const match = ordered ? OL_ITEM.exec(lines[index]) : UL_ITEM.exec(lines[index])
        if (match) {
          items.push(match[1].trim())
          index += 1
          continue
        }
        // An indented line continues the item above it.
        const continuation = /^\s{2,}(\S.*)$/.exec(lines[index])
        if (continuation && items.length) {
          items[items.length - 1] = `${items[items.length - 1]} ${continuation[1].trim()}`
          index += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      if (
        !next.trim() ||
        HEADING.test(next) ||
        RULE.test(next.trim()) ||
        UL_ITEM.test(next) ||
        OL_ITEM.test(next) ||
        QUOTE.test(next) ||
        FENCE.test(next.trim()) ||
        TABLE_ROW.test(next.trim()) ||
        HTML_BLOCK.test(next.trim())
      ) {
        break
      }
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

/**
 * Shields-style badge URLs carry their own label: `badge/Electron-45-2b2e3a`
 * is "Electron 45". The README uses a strip of them as a technology list, so
 * they stay compact text pills instead of becoming remote images.
 */
export function badgeLabel(url: string, alt = ''): string | null {
  const match = /^https?:\/\/img\.shields\.io\/badge\/([^/?#]+)/.exec(url)
  if (!match) return null
  const parts = decodeURIComponent(match[1]).split('-').filter(Boolean)
  if (!parts.length) return alt || null
  const hex = /^[0-9a-f]{3,8}$/i
  if (parts.length > 2 && hex.test(parts[parts.length - 1])) parts.pop()
  return parts.join(' ')
}
