import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getErrorMessage, isDesktop } from '../../lib/api'
import { badgeLabel, parseMarkdown } from '../../lib/markdown'
import { useLauncher } from '../../state/LauncherProvider'

const INLINE_SOURCE = '(`[^`]+`|\\*\\*[^*]+\\*\\*|!\\[[^\\]]*\\]\\([^)]+\\)|\\[[^\\]]+\\]\\([^)]+\\))'
const REMOTE_IMAGE = /^https?:\/\//i

/** Fetched images stay loaded when the README tab is left and reopened. */
const imageCache = new Map<string, Promise<string>>()

function useDocImage(src: string): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)

    // Local and data URLs already satisfy the renderer's CSP. Remote images go
    // through the main process so the page keeps its narrow img-src policy and
    // the fetch is still cached when it has been read once.
    if (!REMOTE_IMAGE.test(src)) {
      setUrl(src)
      return () => {
        active = false
      }
    }
    if (!isDesktop) {
      setFailed(true)
      return () => {
        active = false
      }
    }
    let pending = imageCache.get(src)
    if (!pending) {
      pending = api.docs.image(src)
      imageCache.set(src, pending)
    }
    pending
      .then((dataUrl) => {
        if (active) setUrl(dataUrl)
      })
      .catch(() => {
        imageCache.delete(src)
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [src])

  return { url, failed }
}

/**
 * One image from a document. A missing image falls back to its badge text or alt
 * text so the page still says what was meant to be there.
 */
function DocImage({
  src,
  alt,
  width,
  className,
}: {
  src: string
  alt: string
  width?: string | null
  className?: string
}) {
  const { url, failed } = useDocImage(src)

  if (failed) {
    const badge = badgeLabel(src, alt)
    return <span className={badge ? 'md-badge' : 'md-image-fallback'}>{badge || alt || src}</span>
  }
  if (!url) return <span className="md-image-loading" aria-hidden="true" />
  return (
    <img
      className={className || 'md-image'}
      src={url}
      alt={alt}
      loading="lazy"
      style={width ? { width } : undefined}
    />
  )
}

/**
 * Renders the inline slice of Markdown used by the launcher's documents: code
 * spans, bold, links and badge images. Code and bold are matched first so a link
 * label that itself contains backticks still comes out right.
 */
function renderInline(text: string, onLink: (url: string) => void, depth = 0): ReactNode[] {
  const pattern = new RegExp(INLINE_SOURCE, 'g')
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${depth}-${match.index}`
    lastIndex = match.index + token.length

    if (token.startsWith('`')) {
      nodes.push(
        <code className="md-code-inline" key={key}>
          {token.slice(1, -1)}
        </code>,
      )
      continue
    }
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
      continue
    }
    const link = /^(!?)\[([^\]]*)\]\(([^)]+)\)$/.exec(token)
    if (!link) {
      nodes.push(token)
      continue
    }
    const [, bang, label, url] = link
    if (bang) {
      // Technology badges stay compact pills; every other image is rendered.
      const badge = badgeLabel(url, label)
      nodes.push(
        badge ? (
          <span className="md-badge" key={key}>
            {badge}
          </span>
        ) : (
          <DocImage key={key} src={url} alt={label} className="md-image md-image--inline" />
        ),
      )
      continue
    }
    if (/^https?:\/\//i.test(url)) {
      nodes.push(
        <button type="button" className="md-link" key={key} onClick={() => onLink(url)}>
          {renderInline(label, onLink, depth + 1)}
        </button>,
      )
      continue
    }
    // Relative links point at files in the repository, which the launcher cannot
    // open, so they read as a reference instead of a dead link.
    nodes.push(
      <span className="md-ref" key={key}>
        {renderInline(label, onLink, depth + 1)}
      </span>,
    )
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function Markdown({ source }: { source: string }) {
  const { pushToast } = useLauncher()
  const blocks = useMemo(() => parseMarkdown(source), [source])

  const openLink = (url: string) => {
    void api.openExternal(url).catch((error) => {
      // Only allow-listed hosts open in the browser; anything else still reaches
      // the user through the clipboard instead of dying on a dead click.
      api.copyText(url)
      pushToast({
        level: 'info',
        title: 'Link copied',
        message: `${getErrorMessage(error)} The address is on your clipboard.`,
      })
    })
  }

  return (
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            // Shifted one level so the page header stays the only h1.
            const level = Math.min(6, block.level + 1)
            const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return (
              <Tag className={`md-heading md-heading--${level}`} key={index}>
                {renderInline(block.text, openLink)}
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p className="md-paragraph" key={index}>
                {renderInline(block.text, openLink)}
              </p>
            )
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag className="md-list" key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, openLink)}</li>
                ))}
              </Tag>
            )
          }
          case 'code':
            return (
              <pre className="md-code" key={index}>
                <code>{block.text}</code>
              </pre>
            )
          case 'table':
            return (
              <div className="md-table-wrap" key={index}>
                <table className="md-table">
                  <thead>
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={cellIndex}>{renderInline(cell, openLink)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{renderInline(cell, openLink)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'quote':
            return (
              <blockquote className="md-quote" key={index}>
                {renderInline(block.text, openLink)}
              </blockquote>
            )
          case 'image':
            return (
              <figure
                className={`md-figure${block.align === 'center' ? ' md-figure--center' : ''}`}
                key={index}
              >
                <DocImage src={block.src} alt={block.alt} width={block.width} />
              </figure>
            )
          case 'rule':
            return <hr className="md-rule" key={index} />
          default:
            return null
        }
      })}
    </div>
  )
}
