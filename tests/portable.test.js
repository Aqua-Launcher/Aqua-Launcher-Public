import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PORTABLE_DATA_DIR,
  PORTABLE_MARKER,
  buildPortablePlan,
  portableBaseDir,
  portablePathOverrides,
  preparePortableDataRoot,
} from '../electron/core/portable.js'

async function tempDir(prefix = 'aqua-portable-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('packaged builds keep data beside the executable and dev builds in the project', () => {
  const packagedExec = path.join(path.resolve('portable-install'), 'Aqua Launcher.exe')
  const packaged = portableBaseDir({
    isPackaged: true,
    execPath: packagedExec,
    appPath: path.resolve('unused'),
  })
  assert.equal(packaged, path.dirname(packagedExec))

  const project = path.resolve('aqua-project')
  const dev = portableBaseDir({
    isPackaged: false,
    execPath: path.join(path.resolve('node_modules'), 'electron.exe'),
    appPath: project,
  })
  assert.equal(dev, project)
})

test('the flag or a marker file requests portable mode, and the flag wins', () => {
  const root = path.resolve('/tmp/aqua')
  const markerPath = path.join(root, PORTABLE_MARKER)
  const noRequest = buildPortablePlan({
    isPackaged: true,
    execPath: path.join(root, 'Aqua.exe'),
    appPath: root,
    exists: () => false,
  })
  assert.equal(noRequest.requested, false)
  assert.equal(noRequest.dataRoot, path.join(root, PORTABLE_DATA_DIR))

  const marker = buildPortablePlan({
    isPackaged: true,
    execPath: path.join(root, 'Aqua.exe'),
    appPath: root,
    exists: (candidate) => candidate === markerPath,
  })
  assert.equal(marker.requested, true)
  assert.equal(marker.source, 'marker')

  const flag = buildPortablePlan({
    argv: ['Aqua.exe', '--portable'],
    isPackaged: true,
    execPath: path.join(root, 'Aqua.exe'),
    appPath: root,
    exists: (candidate) => candidate === markerPath,
  })
  assert.equal(flag.requested, true)
  assert.equal(flag.source, 'flag')
})

test('portable path overrides stay inside the data root', () => {
  const root = path.resolve('/tmp/AquaData')
  const overrides = portablePathOverrides(root)
  assert.equal(overrides.userData, root)
  assert.ok(Object.values(overrides).every((value) => {
    const relative = path.relative(root, value)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }))
  assert.equal(path.basename(overrides.sessionData), 'session')
  assert.equal(path.basename(overrides.crashDumps), 'crash-dumps')
})

test('a writable root is created with its Electron paths and the probe is removed', async () => {
  const root = path.join(await tempDir(), PORTABLE_DATA_DIR)
  const result = await preparePortableDataRoot(root)
  assert.equal(result.ok, true)
  assert.equal(result.error, null)
  for (const directory of Object.values(result.overrides)) {
    const stat = await fsp.stat(directory)
    assert.equal(stat.isDirectory(), true)
  }
  const leftovers = (await fsp.readdir(root)).filter((name) => name.startsWith('.aqua-write-test-'))
  assert.deepEqual(leftovers, [])
})

test('a read-only target reports a readable error instead of throwing', async () => {
  const root = await tempDir()
  const blocker = path.join(root, 'not-a-folder')
  await fsp.writeFile(blocker, 'this blocks the portable data folder')
  const result = await preparePortableDataRoot(path.join(blocker, PORTABLE_DATA_DIR))
  assert.equal(result.ok, false)
  assert.match(result.error, /EEXIST|ENOTDIR|not a directory|file already exists/i)
})
