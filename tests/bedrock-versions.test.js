import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  BedrockVersionsService,
  buildUpdateInfoEnvelope,
  comparePackageVersions,
  compareVersions,
  describeDeploymentFailure,
  extractPackage,
  mergeCatalogs,
  parseGdkCatalog,
  parsePackageDependencies,
  parseUpdateInfoResponse,
  parseUwpCatalog,
} from '../electron/core/bedrock-versions.js'

const UPDATE_ID = '3e7f2f9a-1d4b-4a45-9b62-9d1b0e6f3c21'

function createLogger() {
  const messages = []
  return {
    messages,
    info: (...args) => messages.push(args),
    warn: (...args) => messages.push(args),
    error: (...args) => messages.push(args),
  }
}

async function createService({ fetchImpl, paths: overrides = {}, bedrockService } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-bedrock-versions-'))
  const paths = {
    bedrockRoot: root,
    bedrockVersionsRoot: path.join(root, 'versions'),
    bedrockDownloadsRoot: path.join(root, 'downloads'),
    bedrockVersionsCacheFile: path.join(root, 'cache', 'bedrock-versions.json'),
    ...overrides,
  }
  const logger = createLogger()
  const service = new BedrockVersionsService({
    paths,
    logger,
    fetchImpl,
    bedrockService: bedrockService || { status: async () => ({ editions: [] }) },
    emitProgress: () => {},
  })
  return { service, root, paths, logger }
}

test('UWP catalog tuples become version entries', () => {
  const versions = parseUwpCatalog([
    ['1.21.114.1', UPDATE_ID, 0],
    ['1.21.120.1', 'a1b2c3d4-0000-1111-2222-333344445555', 2],
    ['not-a-version', UPDATE_ID, 0],
    ['1.20.0.0', 'not-an-id', 0],
    ['1.20.1.0', UPDATE_ID, 'unknown-channel'],
  ])
  assert.equal(versions.length, 3)
  assert.deepEqual(versions[0], {
    version: '1.21.114.1',
    package: 'appx',
    channel: 'release',
    updateId: UPDATE_ID,
    url: null,
  })
  assert.equal(versions[1].channel, 'preview')
  // Unknown channel codes fall back to the release channel.
  assert.equal(versions[2].channel, 'release')
})

test('GDK catalog maps channels to package links', () => {
  const versions = parseGdkCatalog({
    release: {
      '1.21.130.1': ['https://example.test/release.msixvc'],
    },
    preview: {
      '1.21.130.2': ['https://example.test/preview.msixvc'],
      '1.21.130.3': [null],
    },
  })
  assert.equal(versions.length, 2)
  assert.deepEqual(versions[0], {
    version: '1.21.130.1',
    package: 'msixvc',
    channel: 'release',
    updateId: null,
    url: 'https://example.test/release.msixvc',
  })
  assert.equal(versions[1].channel, 'preview')
})

test('merged catalogs are newest first and prefer MSIXVC builds', () => {
  const merged = mergeCatalogs(
    [
      { version: '1.21.114.1', package: 'appx', channel: 'release', updateId: UPDATE_ID, url: null },
      { version: '1.21.130.1', package: 'appx', channel: 'release', updateId: UPDATE_ID, url: null },
    ],
    [{ version: '1.21.130.1', package: 'msixvc', channel: 'release', updateId: null, url: 'https://example.test/x' }],
  )
  assert.deepEqual(
    merged.map((entry) => entry.version),
    ['1.21.130.1', '1.21.114.1'],
  )
  assert.equal(merged[0].package, 'msixvc')
})

test('manifest dependencies are read from the downloaded build', () => {
  const xml = `<?xml version="1.0"?><Package><Dependencies><PackageDependency Name="Microsoft.Services.Store.Engagement" MinVersion="10.0.1610.0" Publisher="CN=Microsoft" /><PackageDependency Name="Microsoft.VCLibs.140.00" MinVersion="14.0.25426.0" /></Dependencies></Package>`
  assert.deepEqual(parsePackageDependencies(xml), [
    { name: 'Microsoft.Services.Store.Engagement', minVersion: '10.0.1610.0' },
    { name: 'Microsoft.VCLibs.140.00', minVersion: '14.0.25426.0' },
  ])
  assert.deepEqual(parsePackageDependencies('<Dependencies />'), [])
  assert.deepEqual(parsePackageDependencies(null), [])
})

test('dependency versions are compared part by part', () => {
  assert.equal(comparePackageVersions('14.0.33519.0', '14.0.25426.0'), 1)
  assert.equal(comparePackageVersions('10.0.1610.0', '10.0.1610.0'), 0)
  assert.equal(comparePackageVersions('10.0.1506.0', '10.0.1610.0'), -1)
  assert.equal(comparePackageVersions(undefined, '10.0.0.0'), -1)
})

test('deployment failures are reported as the line that matters', () => {
  const failure = {
    ok: false,
    stdout: '',
    stderr:
      'Add-AppxPackage : Deployment failed with HRESULT: 0x80073CF3, Package failed updates, dependency or conflict validation.\nWindows cannot install package Microsoft.MinecraftUWP_1.9.15.0_x64__8wekyb3d8bbwe because this package depends on a framework that could not be found.\n',
  }
  assert.match(describeDeploymentFailure(failure), /0x80073CF3/)
  assert.equal(describeDeploymentFailure({ ok: false, message: 'Command failed' }), 'Command failed')
})

test('registration refuses a build whose frameworks are missing', async () => {
  const zip = new AdmZip()
  zip.addFile(
    'AppxManifest.xml',
    Buffer.from(
      '<Package><Dependencies><PackageDependency Name="Microsoft.Services.Store.Engagement" MinVersion="10.0.1610.0" /></Dependencies></Package>',
    ),
  )
  const archive = zip.toBuffer().toString('base64')
  const commands = []

  const { service } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      if (url.includes('client.asmx')) return { ok: true, text: async () => 'http://tlu.dl.example.test/x.appx' }
      return {
        ok: true,
        headers: { get: () => null },
        body: Readable.from([Buffer.from(archive, 'base64')]).pipe(new PassThrough()),
      }
    },
  })
  service.run = async (file, args) => {
    commands.push(args.join(' '))
    // Only Microsoft.VCLibs is installed on this pretend machine.
    if (args.join(' ').includes('Get-AppxPackage')) {
      return { ok: true, stdout: 'Microsoft.VCLibs.140.00 14.0.33519.0', stderr: '' }
    }
    return { ok: false, stdout: '', stderr: 'Deployment failed with HRESULT: 0x80073CF3' }
  }

  await service.download('1.21.114.1')
  await assert.rejects(() => service.register('1.21.114.1'), /Microsoft\.Services\.Store\.Engagement 10\.0\.1610\.0/)
  // Nothing was deployed: the missing framework is caught before the prompt.
  assert.equal(commands.some((command) => command.includes('Add-AppxPackage')), false)
})

test('versions compare numerically, not as strings', () => {
  assert.ok(compareVersions('1.21.100.1', '1.21.99.1') < 0)
  assert.ok(compareVersions('1.9.0.0', '1.10.0.0') > 0)
  assert.equal(compareVersions('1.21.1.1', '1.21.1.1'), 0)
  assert.equal(
    ['1.9.0.0', '1.10.0.0', '1.21.1.1'].sort(compareVersions)[0],
    '1.21.1.1',
  )
})

test('the update envelope carries the update identity and rejects junk', () => {
  const envelope = buildUpdateInfoEnvelope(UPDATE_ID)
  assert.match(envelope, /GetExtendedUpdateInfo2/)
  assert.match(envelope, new RegExp(UPDATE_ID))
  assert.throws(() => buildUpdateInfoEnvelope('nope'), /update identity/)
  assert.throws(() => buildUpdateInfoEnvelope(null), /update identity/)
})

test('package URLs are read out of the SOAP response', () => {
  const xml = `<?xml version="1.0"?><s:Envelope><ExtendedUpdateInfo2><FileLocation>http://tlu.dl.delivery.mp.microsoft.com/filestreamingservice/files/abc123?P1=1&amp;P2=2</FileLocation></ExtendedUpdateInfo2></s:Envelope>`
  assert.equal(
    parseUpdateInfoResponse(xml),
    'http://tlu.dl.delivery.mp.microsoft.com/filestreamingservice/files/abc123?P1=1&P2=2',
  )
  // The delivery host has changed over time; a tagged URL is what matters.
  assert.equal(
    parseUpdateInfoResponse('<ExtendedUpdateInfo2><FileUrl><Url>https://download.example.net/pkg.appx</Url></FileUrl></ExtendedUpdateInfo2>'),
    'https://download.example.net/pkg.appx',
  )
  // Delisted versions answer without any file location at all.
  assert.equal(parseUpdateInfoResponse('<s:Envelope><ExtendedUpdateInfo2 /></s:Envelope>'), null)
  assert.equal(parseUpdateInfoResponse('<Url>not-a-url</Url>'), null)
  assert.equal(parseUpdateInfoResponse(null), null)
})

test('listing merges both catalogs, caches them, and reports partial failures', async () => {
  const calls = []
  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: false, status: 503, text: async () => '' }
      throw new Error(`unexpected ${url}`)
    },
  })

  const first = await service.list()
  assert.equal(first.fromCache, false)
  assert.equal(first.versions.length, 1)
  assert.match(first.error, /GDK version list/)

  // The second call is served from the on-disk cache.
  const cached = await service.list()
  assert.equal(cached.fromCache, true)
  assert.equal(cached.versions.length, 1)
  assert.equal(calls.length, 2)

  const stored = JSON.parse(await fsp.readFile(paths.bedrockVersionsCacheFile, 'utf8'))
  assert.equal(stored.versions[0].version, '1.21.114.1')

  // A forced refresh hits the network again.
  const refreshed = await service.list({ force: true })
  assert.equal(refreshed.fromCache, false)
  assert.equal(calls.length, 4)
})

test('listing fails clearly when every source is unreachable', async () => {
  const { service } = await createService({
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  await assert.rejects(() => service.list(), /UWP version list/)
})

test('APPX downloads are unpacked and ready to register', async () => {
  const zip = new AdmZip()
  zip.addFile('AppxManifest.xml', Buffer.from('<Package />'))
  zip.addFile('AppxSignature.p7x', Buffer.from('signature'))
  zip.addFile('game/level.txt', Buffer.from('data'))
  const archive = zip.toBuffer().toString('base64')

  const phases = []
  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      if (url === 'https://example.test/update') return { ok: false, status: 500 }
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      if (url.includes('client.asmx')) {
        return { ok: true, text: async () => `<a>http://tlu.dl.example.test/x.appx</a>` }
      }
      if (url.includes('tlu.dl.example.test')) {
        return {
          ok: true,
          headers: { get: () => String(Buffer.from(archive, 'base64').length) },
          body: Readable.from([Buffer.from(archive, 'base64')]).pipe(new PassThrough()),
        }
      }
      throw new Error(`unexpected ${url}`)
    },
  })
  service.emitProgress = (payload) => phases.push(payload.phase)

  const result = await service.download('1.21.114.1')
  assert.equal(result.package, 'appx')
  assert.equal(result.version, '1.21.114.1')
  assert.ok(result.sizeBytes > 0)

  const manifest = path.join(paths.bedrockVersionsRoot, '1.21.114.1', 'AppxManifest.xml')
  assert.ok((await fsp.stat(manifest)).isFile())
  assert.ok((await fsp.stat(path.join(paths.bedrockVersionsRoot, '1.21.114.1', 'game', 'level.txt'))).isFile())
  // The Store signature is dropped so Windows can register the copy.
  await assert.rejects(() => fsp.stat(path.join(paths.bedrockVersionsRoot, '1.21.114.1', 'AppxSignature.p7x')))
  // The archive is cleaned up after extraction.
  assert.deepEqual(await fsp.readdir(paths.bedrockDownloadsRoot), [])
  assert.deepEqual(phases, ['resolving', 'downloading', 'downloading', 'extracting', 'done'])

  const library = await service.library()
  assert.equal(library.get('1.21.114.1').layout, 'appx')

  const registration = await service.registerCommand('1.21.114.1')
  assert.match(registration.command, /Add-AppxPackage/)
  assert.match(registration.command, /-Register/)

  const removed = await service.remove('1.21.114.1')
  assert.equal(removed.version, '1.21.114.1')
  assert.equal((await service.library()).size, 0)
})

test('a version without a manifest still reports an error and cleans up', async () => {
  const zip = new AdmZip()
  zip.addFile('random.txt', Buffer.from('nope'))
  const archive = zip.toBuffer().toString('base64')

  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      if (url.includes('client.asmx')) return { ok: true, text: async () => 'http://tlu.dl.example.test/x.appx' }
      if (url.includes('tlu.dl.example.test')) {
        return {
          ok: true,
          headers: { get: () => null },
          body: Readable.from([Buffer.from(archive, 'base64')]).pipe(new PassThrough()),
        }
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  await assert.rejects(() => service.download('1.21.114.1'), /app manifest/)
  assert.equal((await service.library()).size, 0)
  assert.deepEqual(await fsp.readdir(paths.bedrockDownloadsRoot), [])
})

test('MSIXVC builds are saved as files and cannot be registered', async () => {
  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) return { ok: true, text: async () => '[]' }
      if (url.includes('GdkLinks')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ release: { '1.21.130.1': ['https://example.test/build.msixvc'] } }),
        }
      }
      if (url.includes('build.msixvc')) {
        return {
          ok: true,
          headers: { get: () => '5' },
          body: Readable.from([Buffer.from('build')]).pipe(new PassThrough()),
        }
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  const result = await service.download('1.21.130.1')
  assert.equal(result.package, 'msixvc')
  const folder = path.join(paths.bedrockVersionsRoot, '1.21.130.1')
  assert.ok((await fsp.stat(path.join(folder, 'package.msixvc'))).isFile())
  const library = await service.library()
  assert.equal(library.get('1.21.130.1').layout, 'msixvc')
  await assert.rejects(() => service.registerCommand('1.21.130.1'), /Use Install build/)
})

test('downloading an unknown or unsafe version is refused', async () => {
  const { service } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) return { ok: true, text: async () => '[]' }
      return { ok: true, text: async () => JSON.stringify({ release: { '1.21.130.1': ['https://example.test/x'] } }) }
    },
  })
  await assert.rejects(() => service.download('9.9.9.9'), /not in the catalog/)
  assert.throws(() => service.versionDirectory('../../evil'), /invalid/)
  await assert.rejects(() => service.remove('..'), /invalid/)
  await assert.rejects(() => service.openFolder('1.21.130.1'), /has not been downloaded/)
})

test('a cancelled download stops and cleans up after itself', async () => {
  const { service, paths } = await createService({
    fetchImpl: async (url, options = {}) => {
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      if (url.includes('client.asmx')) return { ok: true, text: async () => 'http://tlu.dl.example.test/x.appx' }
      if (url.includes('tlu.dl.example.test')) {
        const stream = new Readable({ read() {} })
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          stream.destroy(error)
        })
        return { ok: true, headers: { get: () => null }, body: stream }
      }
      throw new Error(`unexpected ${url}`)
    },
  })

  const pending = service.download('1.21.114.1')
  await new Promise((resolve) => setTimeout(resolve, 60))
  const cancelled = service.cancel('1.21.114.1')
  assert.equal(cancelled.cancelled, true)
  await assert.rejects(() => pending, /cancelled/)
  assert.deepEqual(await fsp.readdir(paths.bedrockDownloadsRoot), [])
  assert.equal(service.cancel('1.21.114.1').cancelled, false)
})

test('unpacking skips entries that aim outside the folder', async () => {
  const zip = new AdmZip()
  zip.addFile('AppxManifest.xml', Buffer.from('<Package />'))
  zip.addFile('../outside.txt', Buffer.from('nope'))
  zip.addFile('nested/../still-inside.txt', Buffer.from('ok'))
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-bedrock-unzip-'))
  const archive = path.join(root, 'package.appx')
  await fsp.writeFile(archive, zip.toBuffer())
  const target = path.join(root, 'build')
  await fsp.mkdir(target)

  const written = await extractPackage(archive, target)
  assert.ok(written >= 1)
  assert.ok((await fsp.stat(path.join(target, 'AppxManifest.xml'))).isFile())
  await assert.rejects(() => fsp.stat(path.join(root, 'outside.txt')))
  await fsp.rm(root, { recursive: true, force: true })
})

test('registration scripts are written next to the build', async () => {
  const zip = new AdmZip()
  zip.addFile('AppxManifest.xml', Buffer.from('<Package />'))
  const archive = zip.toBuffer().toString('base64')

  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      if (url.includes('client.asmx')) return { ok: true, text: async () => 'http://tlu.dl.example.test/x.appx' }
      return {
        ok: true,
        headers: { get: () => null },
        body: Readable.from([Buffer.from(archive, 'base64')]).pipe(new PassThrough()),
      }
    },
  })
  await service.download('1.21.114.1')
  const folder = path.join(paths.bedrockVersionsRoot, '1.21.114.1')
  const manifest = path.join(folder, 'AppxManifest.xml')
  const { command } = await service.registerCommand('1.21.114.1')
  assert.equal(command, `Add-AppxPackage -Path "${manifest}" -Register -ForceApplicationShutdown`)
})

/**
 * MSIXVC builds are encrypted Store packages: Windows only takes them by
 * installing, which replaces the copy it is running. These tests pin the command
 * that does that, and the refusal paths around it.
 */
function msixvcCatalog(versions) {
  return async (url) => {
    if (url.includes('mc-w10-versiondb')) return { ok: true, text: async () => '[]' }
    if (url.includes('GdkLinks')) {
      const release = {}
      for (const version of versions) release[version] = [`https://example.test/${version}.msixvc`]
      return { ok: true, text: async () => JSON.stringify({ release }) }
    }
    throw new Error(`unexpected ${url}`)
  }
}

async function seedDownloadedMsixvc(paths, version) {
  const folder = path.join(paths.bedrockVersionsRoot, version)
  await fsp.mkdir(folder, { recursive: true })
  await fsp.writeFile(path.join(folder, 'package.msixvc'), 'build')
  return folder
}

test('a downloaded MSIXVC build installs with Add-AppxPackage', async () => {
  const calls = []
  let running = null
  const { service, paths } = await createService({
    fetchImpl: msixvcCatalog(['1.21.130.1']),
    bedrockService: {
      status: async () => ({
        editions: running
          ? [{ id: 'bedrock', name: 'Minecraft for Windows', version: running, packageVersion: running, installLocation: 'C:\XboxGames\Minecraft for Windows\Content' }]
          : [],
      }),
    },
  })
  const folder = await seedDownloadedMsixvc(paths, '1.21.130.1')
  service.run = async (_file, args) => {
    calls.push(args.join(' '))
    running = '1.21.130.1'
    return { ok: true, stdout: '', stderr: '' }
  }

  const result = await service.install('1.21.130.1')
  assert.equal(result.installedVersion, '1.21.130.1')
  assert.equal(result.replacedVersion, null)
  assert.equal(result.forcedDowngrade, false)
  const command = calls.find((call) => call.includes('Add-AppxPackage'))
  assert.equal(command, `-NoProfile -NonInteractive -Command $ErrorActionPreference = 'Stop'; Add-AppxPackage -Path "${path.join(folder, 'package.msixvc')}"`)
  assert.equal(result.command, `Add-AppxPackage -Path "${path.join(folder, 'package.msixvc')}"`)
})

test('installing an older build asks Windows to replace the newer one', async () => {
  const calls = []
  let running = '1.26.12.2'
  const { service, paths } = await createService({
    fetchImpl: msixvcCatalog(['1.21.130.1']),
    bedrockService: {
      status: async () => ({
        editions: [{ id: 'bedrock', name: 'Minecraft for Windows', version: running, packageVersion: running, installLocation: null }],
      }),
    },
  })
  await seedDownloadedMsixvc(paths, '1.21.130.1')
  service.run = async (_file, args) => {
    calls.push(args.join(' '))
    running = '1.21.130.1'
    return { ok: true, stdout: '', stderr: '' }
  }

  const result = await service.install('1.21.130.1')
  assert.equal(result.forcedDowngrade, true)
  assert.equal(result.replacedVersion, '1.26.12.2')
  assert.match(result.command, /-ForceUpdateFromAnyVersion$/)
})

test('a refused install reports what Windows said and leaves the old copy alone', async () => {
  const { service, paths } = await createService({
    fetchImpl: msixvcCatalog(['1.21.130.1']),
    bedrockService: {
      status: async () => ({
        editions: [{ id: 'bedrock', name: 'Minecraft for Windows', version: '1.26.12.2', packageVersion: '1.26.12.2', installLocation: null }],
      }),
    },
  })
  await seedDownloadedMsixvc(paths, '1.21.130.1')
  service.run = async () => ({
    ok: false,
    stdout: '',
    stderr: 'Add-AppxPackage: Deployment failed with HRESULT: 0x80073D02, because the package is in use.',
  })

  await assert.rejects(() => service.install('1.21.130.1'), /0x80073D02/)
})

test('installing refuses APPX builds and builds that were never downloaded', async () => {
  const { service, paths } = await createService({
    fetchImpl: async (url) => {
      if (url.includes('mc-w10-versiondb')) {
        return { ok: true, text: async () => JSON.stringify([['1.21.114.1', UPDATE_ID, 0]]) }
      }
      if (url.includes('GdkLinks')) return { ok: true, text: async () => '{}' }
      throw new Error(`unexpected ${url}`)
    },
  })
  // The APPX folder is already unpacked, so only the format stops the install.
  await fsp.mkdir(path.join(paths.bedrockVersionsRoot, '1.21.114.1'), { recursive: true })
  await fsp.writeFile(path.join(paths.bedrockVersionsRoot, '1.21.114.1', 'AppxManifest.xml'), '<Package />')

  await assert.rejects(() => service.install('1.21.114.1'), /Register it instead/)
  await assert.rejects(() => service.install('1.21.130.1'), /Download that version first/)
})
