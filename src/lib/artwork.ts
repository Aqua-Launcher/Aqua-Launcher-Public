import { useEffect, useState } from 'react'

/**
 * The Java Edition version whose drop a Bedrock build belongs to. Bedrock is
 * numbered on its own (1.21.114 is the "1.21" drop), and the artwork pipeline
 * keys Mojang's patch notes off the Java version, so the leading pair is what
 * gets passed along. Minecraft's date-based releases (26.3.20) keep the shape.
 */
export function bedrockDropVersion(version: string | null | undefined): string | null {
  const match = /^v?(\d+)\.(\d+)/.exec(String(version ?? '').trim())
  return match ? `${match[1]}.${match[2]}` : null
}

/** Horizon targets one Java drop, and 26.3 is the only build so far. */
export const HORIZON_DROP_VERSION = '26.3'

/**
 * Resolves the first asset that actually exists out of a candidate list, so
 * artwork dropped into `public/artwork` is used and a built-in fallback can be
 * rendered when it is not there.
 */
export function useArtworkSource(candidates: string[]) {
  const [source, setSource] = useState<string | null>(null)
  const key = candidates.join('|')

  useEffect(() => {
    let cancelled = false
    let index = 0

    const tryNext = () => {
      if (cancelled || index >= candidates.length) return
      const url = candidates[index]
      index += 1
      const image = new Image()
      image.onload = () => {
        if (!cancelled) setSource(url)
      }
      image.onerror = tryNext
      image.src = url
    }

    setSource(null)
    tryNext()
    return () => {
      cancelled = true
    }
    // The candidate list is a stable module constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return source
}
