import fs from 'node:fs'
import path from 'node:path'

export const PORTABLE_DATA_DIR = 'AquaData'
export const PORTABLE_MARKER = 'portable.txt'

/**
 * A packaged build keeps AquaData beside the executable, which is the folder a
 * user can copy to a USB stick. Development builds use the project root so
 * `electron . --portable` does not try to write inside node_modules.
 */
export function portableBaseDir({ isPackaged = true, execPath = process.execPath, appPath = process.cwd() } = {}) {
  return path.resolve(isPackaged ? path.dirname(execPath) : appPath)
}

export function buildPortablePlan({
  argv = [],
  isPackaged = true,
  execPath = process.execPath,
  appPath = process.cwd(),
  exists = fs.existsSync,
} = {}) {
  const baseDir = portableBaseDir({ isPackaged, execPath, appPath })
  const markerPath = path.join(baseDir, PORTABLE_MARKER)
  const hasFlag = Array.isArray(argv) && argv.includes('--portable')
  const hasMarker = Boolean(exists(markerPath))
  return {
    requested: hasFlag || hasMarker,
    source: hasFlag ? 'flag' : hasMarker ? 'marker' : null,
    baseDir,
    markerPath,
    dataRoot: path.join(baseDir, PORTABLE_DATA_DIR),
  }
}

/** Every Electron path that would otherwise land in AppData. */
export function portablePathOverrides(dataRoot) {
  const root = path.resolve(dataRoot)
  return {
    userData: root,
    sessionData: path.join(root, 'session'),
    logs: path.join(root, 'electron-logs'),
    crashDumps: path.join(root, 'crash-dumps'),
    downloads: path.join(root, 'downloads'),
  }
}

/**
 * Creates the portable tree and proves it can be written before Electron points
 * userData there. A failure is returned instead of thrown so startup can fall
 * back and show a readable message.
 */
export function preparePortableDataRoot(
  dataRoot,
  { fsImpl = fs, probeName = `.aqua-write-test-${process.pid}-${Date.now()}.tmp` } = {},
) {
  const root = path.resolve(dataRoot)
  const overrides = portablePathOverrides(root)
  let probePath = path.join(root, probeName)
  try {
    for (const directory of new Set(Object.values(overrides))) {
      fsImpl.mkdirSync(directory, { recursive: true })
    }
    fsImpl.writeFileSync(probePath, 'Aqua portable mode write test', { flag: 'wx' })
    fsImpl.unlinkSync(probePath)
    return { ok: true, error: null, overrides }
  } catch (error) {
    try {
      if (fsImpl.existsSync(probePath)) fsImpl.unlinkSync(probePath)
    } catch {
      // The original write failure is the useful message.
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      overrides,
    }
  }
}
