import AdmZip from 'adm-zip'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  HORIZON_GAME_VERSION,
  HorizonService,
  extractHorizonArchive,
  findHorizonReleaseRoot,
  horizonAssetName,
  horizonClientCandidates,
  horizonDropName,
  horizonGameVersion,
  horizonLaunchArgs,
  horizonPrepareArgs,
  horizonResourcesDirectory,
  horizonSoundsArgs,
  parseChecksums,
  parseHorizonReleases,
  readInstalledHorizonBuilds,
  selectedHorizonBuild,
} from '../electron/core/horizon.js'

function makePaths(root) {
  const horizonRoot = path.join(root, 'horizon')
  return {
    horizonRoot,
    horizonVersionsRoot: path.join(horizonRoot, 'versions'),
    horizonDownloadsRoot: path.join(horizonRoot, 'downloads'),
    horizonGameRoot: path.join(horizonRoot, 'game'),
    horizonCacheRoot: path.join(horizonRoot, 'cache'),
    horizonReleasesCacheFile: path.join(horizonRoot, 'cache', 'releases.json'),
    minecraftRoot: path.join(root, 'minecraft'),
  }
}

async function createBuild(
  versionsRoot,
  tag,
  { client = true, prepared = true, marker = true, lock = true, warning = null } = {},
) {
  const directory = path.join(versionsRoot, tag)
  await fsp.mkdir(directory, { recursive: true })
  if (client) await fsp.writeFile(path.join(directory, 'horizon-client.exe'), 'not a real client')
  if (lock) {
    await fsp.writeFile(
      path.join(directory, 'research-lock.json'),
      JSON.stringify({ minecraft: { version: HORIZON_GAME_VERSION, client_sha1: 'a'.repeat(40) } }),
    )
  }
  if (prepared) {
    const resources = horizonResourcesDirectory(directory, HORIZON_GAME_VERSION)
    await fsp.mkdir(resources, { recursive: true })
    await fsp.writeFile(path.join(resources, 'horizon-resources.json'), '{}')
  }
  if (marker) {
    await fsp.writeFile(
      path.join(directory, '.aqua-horizon.json'),
      JSON.stringify({
        kind: 'aqua-horizon',
        schema: 1,
        tag,
        gameVersion: HORIZON_GAME_VERSION,
        assetName: 'horizon-windows-x64.zip',
        archiveSha256: 'b'.repeat(64),
        installedAt: '2026-10-30T12:00:00.000Z',
        javaMajor: 25,
        javaVersion: '25.0.1',
        warning,
      }),
    )
  }
  return directory
}

function releasePayload() {
  const asset = (name, size) => ({
    name,
    size,
    browser_download_url: `https://github.com/horizon-rust/horizon/releases/download/v0.2.97/${name}`,
    digest: name === 'horizon-windows-x64.zip' ? `sha256:${'c'.repeat(64)}` : null,
  })
  return [
    {
      tag_name: 'v0.2.97',
      name: 'Horizon 0.2.97: Prepare, signs and 16 more fixes',
      draft: false,
      prerelease: false,
      published_at: '2026-10-28T20:00:00Z',
      html_url: 'https://github.com/horizon-rust/horizon/releases/tag/v0.2.97',
      assets: [
        asset('horizon-windows-x64.zip', 31_775_574),
        asset('horizon-macos-arm64.zip', 29_490_171),
        asset('SHA256SUMS', 375),
        asset('SHA256SUMS.sig', 89),
        { name: 'horizon-launcher-windows-x64.zip', browser_download_url: 'https://example.test/launcher.zip' },
      ],
    },
    {
      tag_name: 'v0.2.96',
      name: 'Horizon 0.2.96',
      draft: false,
      prerelease: false,
      published_at: '2026-10-20T20:00:00Z',
      html_url: 'https://github.com/horizon-rust/horizon/releases/tag/v0.2.96',
      assets: [asset('horizon-windows-x64.zip', 30_000_000)],
    },
    {
      tag_name: 'nightly-2026-10-31',
      name: 'Nightly',
      draft: false,
      prerelease: false,
      assets: [asset('horizon-windows-x64.zip', 32_000_000)],
    },
    {
      tag_name: 'v0.2.98',
      name: 'Prerelease',
      draft: false,
      prerelease: true,
      assets: [asset('horizon-windows-x64.zip', 33_000_000)],
    },
    {
      tag_name: 'launcher@0.2.33',
      name: 'Launcher',
      draft: false,
      prerelease: false,
      assets: [asset('horizon-windows-x64.zip', 34_000_000)],
    },
  ]
}

test('Horizon release assets are selected per platform and only stable game releases are listed', () => {
  assert.equal(horizonAssetName('win32', 'x64'), 'horizon-windows-x64.zip')
  assert.equal(horizonAssetName('darwin', 'arm64'), 'horizon-macos-arm64.zip')
  assert.equal(horizonAssetName('linux', 'x64'), 'horizon-linux-x86_64.tar.gz')
  assert.equal(horizonAssetName('win32', 'arm64'), null)

  const releases = parseHorizonReleases(releasePayload(), { platform: 'win32', arch: 'x64' })
  assert.deepEqual(releases.map((release) => release.tag), ['v0.2.97', 'v0.2.96'])
  assert.equal(releases[0].assetName, 'horizon-windows-x64.zip')
  assert.equal(releases[0].assetSize, 31_775_574)
  assert.equal(releases[0].assetDigest, 'c'.repeat(64))
  assert.match(releases[0].checksumsUrl, /SHA256SUMS$/)
  assert.match(releases[0].signatureUrl, /SHA256SUMS\.sig$/)
  assert.equal(releases[0].assetUrl.includes('horizon-windows-x64.zip'), true)

  assert.deepEqual(parseHorizonReleases(releasePayload(), { platform: 'linux', arch: 'arm64' }), [])
})

test('Horizon checksums accept the standard SHA256SUMS format and reject conflicting digests', async (t) => {
  const parsed = parseChecksums(
    `${'a'.repeat(64)}  horizon-windows-x64.zip\n${'b'.repeat(64)} *horizon-linux-x86_64.tar.gz\nnot a checksum\n`,
  )
  assert.equal(parsed.get('horizon-windows-x64.zip'), 'a'.repeat(64))
  assert.equal(parsed.get('horizon-linux-x86_64.tar.gz'), 'b'.repeat(64))
  assert.equal(parsed.size, 2)

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-checksum-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const service = new HorizonService({
    paths: makePaths(root),
    platform: 'win32',
    arch: 'x64',
    fetchWithRetryImpl: async () => ({
      text: async () => `${'b'.repeat(64)}  horizon-windows-x64.zip\n`,
    }),
  })
  await assert.rejects(
    service.archiveChecksum({
      assetName: 'horizon-windows-x64.zip',
      assetUrl: 'https://example.test/horizon-windows-x64.zip',
      assetDigest: 'a'.repeat(64),
      checksumsUrl: 'https://example.test/SHA256SUMS',
    }),
    /conflicting checksums/,
  )

  const noChecksum = new HorizonService({ paths: makePaths(root), platform: 'win32', arch: 'x64' })
  await assert.rejects(
    noChecksum.archiveChecksum({
      assetName: 'horizon-windows-x64.zip',
      assetUrl: 'https://example.test/horizon-windows-x64.zip',
      assetDigest: null,
      checksumsUrl: null,
    }),
    /does not publish a SHA-256 checksum/,
  )
})

test('Horizon metadata and launch arguments match the Rust game', () => {
  assert.equal(horizonGameVersion({ minecraft: { version: '26.3' } }), '26.3')
  assert.equal(horizonGameVersion('{"minecraft":{"version":"26.4"}}'), '26.4')
  assert.equal(horizonGameVersion({ minecraft: { version: '../../etc/passwd' } }), HORIZON_GAME_VERSION)
  assert.equal(horizonGameVersion({}), HORIZON_GAME_VERSION)
  assert.equal(horizonDropName('26.3'), 'Wilderness Bound')
  assert.equal(horizonDropName('26.4'), null)

  const directory = path.join('/versions', 'v0.2.97')
  assert.deepEqual(horizonClientCandidates(directory, 'win32'), [path.join(directory, 'horizon-client.exe')])
  assert.deepEqual(horizonClientCandidates(directory, 'linux'), [path.join(directory, 'horizon-client')])
  assert.deepEqual(horizonClientCandidates(directory, 'darwin'), [
    path.join(directory, 'Horizon.app', 'Contents', 'MacOS', 'horizon-client'),
    path.join(directory, 'horizon-client'),
  ])
  assert.equal(horizonResourcesDirectory(directory, '26.3'), path.join(directory, '.local', 'horizon-client', '26.3'))
  assert.deepEqual(horizonLaunchArgs('/resources'), ['--resources', '/resources'])
  assert.deepEqual(
    horizonPrepareArgs({ buildDirectory: '/build', minecraftDirectory: '/minecraft', serverJar: '/server.jar' }),
    ['--prepare', '--server-jar', '/server.jar', '--minecraft-dir', '/minecraft', '--root', '/build'],
  )
  assert.deepEqual(horizonSoundsArgs({ buildDirectory: '/build', minecraftDirectory: '/minecraft' }), [
    'sounds',
    '--minecraft-dir',
    '/minecraft',
    '--root',
    '/build',
  ])
})

test('only Aqua-installed Horizon builds with a marker and client are listed', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-builds-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const versionsRoot = path.join(root, 'versions')
  const release = await createBuild(versionsRoot, 'v0.2.97')
  const nightly = await createBuild(versionsRoot, 'nightly-2026-10-31')
  await createBuild(versionsRoot, 'v0.2.96', { marker: false })
  await createBuild(versionsRoot, 'v0.2.95', { client: false })
  await fsp.mkdir(path.join(versionsRoot, 'v0.2.94'), { recursive: true })

  const builds = await readInstalledHorizonBuilds({ versionsRoot, platform: 'win32' })
  assert.deepEqual(builds.map((build) => build.tag).sort(), ['v0.2.97'])
  assert.equal(builds[0].directory, release)
  assert.equal(builds[0].gameVersion, HORIZON_GAME_VERSION)
  assert.equal(builds[0].clientPath, path.join(release, 'horizon-client.exe'))
  assert.equal(builds[0].prepared, true)
  assert.equal(builds[0].javaMajor, 25)
  assert.equal(builds[0].warning, null)
  assert.notEqual(nightly, release)

  assert.equal(selectedHorizonBuild(builds).tag, 'v0.2.97')
  assert.equal(selectedHorizonBuild([]), null)
})

test('native builds are listed with the mods they compiled', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-native-builds-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const versionsRoot = path.join(root, 'versions')
  const base = await createBuild(versionsRoot, 'v0.2.97')
  const tag = 'native-0123456-abcdefabcdef'
  const directory = path.join(versionsRoot, tag)
  await fsp.cp(base, directory, { recursive: true })
  await fsp.writeFile(
    path.join(directory, '.aqua-horizon.json'),
    JSON.stringify({
      kind: 'aqua-horizon-native',
      schema: 1,
      tag,
      gameVersion: HORIZON_GAME_VERSION,
      baseTag: 'v0.2.97',
      revision: '0123456789abcdef0123456789abcdef01234567',
      mixins: 'abcdef0123456789abcdef0123456789abcdef01',
      profile: 'fast',
      mods: ['zoom', 'appleskin'],
      installedAt: '2026-10-31T12:00:00.000Z',
      javaMajor: 25,
    }),
  )

  const builds = await readInstalledHorizonBuilds({ versionsRoot, platform: 'win32' })
  const native = builds.find((build) => build.tag === tag)

  assert.ok(native)
  assert.equal(native.native, true)
  assert.equal(native.baseTag, 'v0.2.97')
  assert.equal(native.revision, '0123456789abcdef0123456789abcdef01234567')
  assert.equal(native.profile, 'fast')
  assert.equal(native.nativeMods, 2)
  assert.equal(builds.find((build) => build.tag === 'v0.2.97').native, false)
  assert.equal(selectedHorizonBuild(builds).tag, tag)
})

test('Horizon status uses Aqua paths and launch starts the Rust client directly', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-status-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const paths = makePaths(root)
  const buildDir = await createBuild(paths.horizonVersionsRoot, 'v0.2.97', { warning: 'Sounds were not copied.' })
  await fsp.mkdir(path.join(paths.horizonGameRoot, 'saves', 'Survival'), { recursive: true })
  await fsp.mkdir(path.join(paths.horizonGameRoot, 'saves', 'Creative'), { recursive: true })

  let captured = null
  const spawnImpl = (program, args, options) => {
    captured = { program, args, options }
    const child = new EventEmitter()
    child.pid = 4242
    child.unref = () => {}
    queueMicrotask(() => child.emit('spawn'))
    return child
  }
  const opened = []
  const service = new HorizonService({
    paths,
    platform: 'win32',
    arch: 'x64',
    spawnImpl,
    openPath: async (target) => {
      opened.push(target)
      return ''
    },
  })

  const status = await service.status({ force: true })
  assert.equal(status.supported, true)
  assert.equal(status.managed, true)
  assert.equal(status.installed, true)
  assert.equal(status.gameVersion, HORIZON_GAME_VERSION)
  assert.equal(status.drop, 'Wilderness Bound')
  assert.equal(status.selectedTag, 'v0.2.97')
  assert.equal(status.worlds, 2)
  assert.equal(status.downloadsDirectory, paths.horizonDownloadsRoot)
  assert.equal(status.install, null)
  assert.equal(status.builds[0].selected, true)
  assert.equal(status.builds[0].warning, 'Sounds were not copied.')

  const result = await service.launch('v0.2.97')
  assert.equal(result.mode, 'launch')
  assert.equal(result.version, 'v0.2.97')
  assert.equal(result.pid, 4242)
  assert.equal(captured.program, path.join(buildDir, 'horizon-client.exe'))
  assert.deepEqual(captured.args, ['--resources', horizonResourcesDirectory(buildDir, HORIZON_GAME_VERSION)])
  assert.equal(captured.options.cwd, paths.horizonGameRoot)
  assert.equal(captured.options.env.HORIZON_HOME, paths.horizonGameRoot)
  assert.equal(captured.options.detached, true)

  assert.equal(await service.openFolder('game'), paths.horizonGameRoot)
  assert.equal(await service.openFolder('build', 'v0.2.97'), buildDir)
  assert.equal(await service.openFolder('downloads'), paths.horizonDownloadsRoot)
  assert.deepEqual(opened, [paths.horizonGameRoot, buildDir, paths.horizonDownloadsRoot])
  await assert.rejects(service.openFolder('build', '../outside'), /not installed/)
})

test('Horizon gets Mojang’s original version file even when Aqua rewrote its copy', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-manifest-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const buildDirectory = path.join(root, 'build')
  await fsp.mkdir(buildDirectory, { recursive: true })
  const original = JSON.stringify({
    id: '26.3',
    javaVersion: { majorVersion: 25 },
    downloads: { client: { sha1: 'a'.repeat(40) }, server: { sha1: 'b'.repeat(40) } },
  })
  const originalSha1 = createHash('sha1').update(original).digest('hex')
  const lock = {
    minecraft: {
      version: '26.3',
      manifest_sha1: 'f'.repeat(40),
      accepted_manifest_sha1: [originalSha1],
      client_sha1: 'a'.repeat(40),
      server_sha1: 'b'.repeat(40),
      java_major: 25,
    },
  }
  const seen = []
  const service = new HorizonService({
    paths: makePaths(root),
    platform: 'win32',
    arch: 'x64',
    installer: {
      versionService: {
        getManifest: async () => ({ versions: [{ id: '26.3', url: 'https://example.test/current-26.3.json' }] }),
      },
    },
    fetchWithRetryImpl: async (url) => {
      seen.push(url)
      return { text: async () => original }
    },
  })
  const job = { progress: 0, stage: '' }

  const manifestFile = path.join(buildDirectory, '.local', 'minecraft', '26.3', 'manifest.json')
  await service.ensureMojangManifest(buildDirectory, '26.3', lock, { job, signal: undefined })
  assert.equal(await fsp.readFile(manifestFile, 'utf8'), original)
  assert.equal(seen.length, 1)
  assert.match(seen[0], new RegExp(`/f{40}/26\\.3\\.json$`))
  assert.equal(await fsp.readFile(manifestFile, 'utf8'), original)

  await assert.rejects(
    service.ensureMojangManifest(buildDirectory, '26.3', { minecraft: { ...lock.minecraft, accepted_manifest_sha1: [] } }, {
      job,
      signal: undefined,
    }),
    /does not describe|could not obtain/i,
  )
})

test('Horizon archives are extracted only when their release root is present', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-archive-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const archive = path.join(root, 'horizon-windows-x64.zip')
  const nested = path.join(root, 'nested')
  await fsp.mkdir(nested, { recursive: true })

  const zip = new AdmZip()
  zip.addFile('horizon-windows-x64/research-lock.json', Buffer.from('{"minecraft":{"version":"26.3"}}'))
  zip.addFile('horizon-windows-x64/horizon-client.exe', Buffer.from('client'))
  zip.writeZip(archive)

  await extractHorizonArchive(archive, nested)
  const releaseRoot = await findHorizonReleaseRoot(nested)
  assert.equal(releaseRoot, path.join(nested, 'horizon-windows-x64'))

  const empty = path.join(root, 'empty')
  await fsp.mkdir(empty)
  assert.equal(await findHorizonReleaseRoot(empty), null)
})

test('unsupported Horizon platforms report why instead of offering an install', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-horizon-platform-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const service = new HorizonService({ paths: makePaths(root), platform: 'win32', arch: 'arm64' })
  const status = await service.status({ force: true })
  assert.equal(status.supported, false)
  assert.match(status.supportedReason, /win32 arm64/)
  const catalog = await service.listReleases()
  assert.deepEqual(catalog.releases, [])
  assert.match(catalog.error, /win32 arm64/)
  await assert.rejects(service.install('v0.2.97'), /not available/)
})
