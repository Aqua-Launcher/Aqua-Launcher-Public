import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import AdmZip from 'adm-zip'
import {
  HORIZON_MIXINS_REV,
  HORIZON_NATIVE_TAG,
  HorizonNativeBuilder,
  horizonSourceUrl,
  nativeBuildKey,
  nativeBuildPlan,
  nativeBuildTag,
  nativeProfileFor,
  rustDefaultHost,
  rustupChecksum,
  rustupDownloadUrls,
  rustupTarget,
  stageNativeMods,
} from '../electron/core/horizon-native.js'

const REVISION = '0123456789abcdef0123456789abcdef01234567'
const MIXINS = 'abcdef0123456789abcdef0123456789abcdef01'

async function temporaryRoot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-native-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  return root
}

function nativeBundle(file, id) {
  const zip = new AdmZip()
  zip.addFile(
    'horizon-native.json',
    Buffer.from(
      JSON.stringify({
        schema: 1,
        id,
        version: '1.0.0',
        game: '26.3',
        hooks: 1,
        horizon: REVISION,
        mixins: MIXINS,
      }),
    ),
  )
  zip.addFile(`mixins/${id}/horizon-mixin.toml`, Buffer.from(`id = "${id}"\n`))
  zip.addFile(`mixins/${id}/src/lib.rs`, Buffer.from('// mixin\n'))
  zip.writeZip(file)
}

test('native mods that agree on their Horizon pins build on them', () => {
  assert.deepEqual(
    nativeBuildPlan({
      mods: [
        { horizon: REVISION, mixins: MIXINS },
        { horizon: REVISION, mixins: MIXINS },
      ],
    }),
    { revision: REVISION, mixins: MIXINS },
  )
})

test('native mods on different Horizon revisions are refused', () => {
  assert.throws(
    () =>
      nativeBuildPlan({
        mods: [
          { horizon: REVISION, mixins: MIXINS },
          { horizon: 'fedcba9876543210fedcba9876543210fedcba98', mixins: MIXINS },
        ],
      }),
    /different Horizon revisions/,
  )
})

test('native mods on different horizon-mixins revisions are refused', () => {
  assert.throws(
    () =>
      nativeBuildPlan({
        mods: [
          { horizon: REVISION, mixins: MIXINS },
          { horizon: REVISION, mixins: 'fedcba9876543210fedcba9876543210fedcba98' },
        ],
      }),
    /different horizon-mixins revisions/,
  )
})

test('mods without a Horizon pin use the release Aqua is building from', () => {
  assert.deepEqual(nativeBuildPlan({ mods: [{ horizon: null }], gameCommit: REVISION }), {
    revision: REVISION,
    mixins: HORIZON_MIXINS_REV,
  })
  assert.throws(() => nativeBuildPlan({ mods: [{ horizon: null }] }), /which Horizon commit/)
})

test('build keys ignore mod order and tags name the revision and key', () => {
  const mods = [
    { id: 'zoom', sha256: 'a' },
    { id: 'appleskin', sha256: 'b' },
  ]
  const key = nativeBuildKey({ revision: REVISION, mixins: MIXINS, profile: 'fast', mods })
  assert.match(key, /^[0-9a-f]{12}$/)
  assert.equal(nativeBuildKey({ revision: REVISION, mixins: MIXINS, profile: 'fast', mods: [...mods].reverse() }), key)
  assert.notEqual(nativeBuildKey({ revision: REVISION, mixins: MIXINS, profile: 'release', mods }), key)

  const tag = nativeBuildTag({ revision: REVISION, key })
  assert.match(tag, HORIZON_NATIVE_TAG)
  assert.equal(tag, `native-${REVISION.slice(0, 7)}-${key}`)
  assert.throws(() => nativeBuildTag({ revision: 'nope', key }), /invalid/)
})

test('the source archive comes from the pinned commit', () => {
  assert.equal(
    horizonSourceUrl(REVISION),
    `https://codeload.github.com/horizon-rust/horizon/tar.gz/${REVISION}`,
  )
  assert.throws(() => horizonSourceUrl('v0.2.97'), /revision is invalid/)
})

test('a workspace without the fast profile builds in release', () => {
  assert.equal(nativeProfileFor('[profile.fast]\ninherits = "release"\n'), 'fast')
  assert.equal(nativeProfileFor('[package]\nname = "horizon"\n'), 'release')
})

test('Rust downloads follow the platform and avoid MSVC when it is missing', () => {
  assert.equal(rustupTarget('win32', 'x64'), 'x86_64-pc-windows-msvc')
  assert.equal(rustupTarget('darwin', 'arm64'), 'aarch64-apple-darwin')
  assert.equal(rustupTarget('linux', 'x64'), 'x86_64-unknown-linux-gnu')
  assert.throws(() => rustupTarget('freebsd', 'x64'), /cannot be downloaded/)
  assert.equal(rustDefaultHost({ platform: 'win32', arch: 'x64', hasMsvc: true }), 'x86_64-pc-windows-msvc')
  assert.equal(rustDefaultHost({ platform: 'win32', arch: 'x64', hasMsvc: false }), 'x86_64-pc-windows-gnu')
  assert.equal(rustDefaultHost({ platform: 'linux', arch: 'x64', hasMsvc: true }), 'x86_64-unknown-linux-gnu')
})

test('the Rust installer and its checksum come from the official distribution', () => {
  const digest = 'a'.repeat(64)
  assert.equal(rustupChecksum(`${digest}  rustup-init.exe\n`), digest)
  assert.throws(() => rustupChecksum('not a checksum'), /SHA-256/)
  assert.deepEqual(rustupDownloadUrls('x86_64-pc-windows-msvc'), {
    init: 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe',
    checksum: 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe.sha256',
  })
  assert.equal(
    rustupDownloadUrls('x86_64-unknown-linux-gnu').init,
    'https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init',
  )
})

test('staging copies each mod mixins tree under its id', async (t) => {
  const root = await temporaryRoot(t)
  const bundle = path.join(root, 'zoom.hnmod')
  nativeBundle(bundle, 'zoom')
  const destination = path.join(root, 'mods')

  await stageNativeMods([{ id: 'zoom', filePath: bundle }], destination, { horizonRevision: REVISION })

  assert.equal(
    await fsp.readFile(path.join(destination, 'zoom', 'horizon-mixin.toml'), 'utf8'),
    `id = "zoom"\n\n[compatibility]\nhorizon_revision = "${REVISION}"\n`,
  )
  assert.equal(await fsp.readFile(path.join(destination, 'zoom', 'src', 'lib.rs'), 'utf8'), '// mixin\n')
})

test('a bundle without the mixins Horizon needs is refused', async (t) => {
  const root = await temporaryRoot(t)
  const bundle = path.join(root, 'empty.hnmod')
  const zip = new AdmZip()
  zip.addFile('horizon-native.json', Buffer.from(JSON.stringify({ schema: 1, id: 'empty' })))
  zip.writeZip(bundle)

  await assert.rejects(
    stageNativeMods([{ id: 'empty', filePath: bundle }], path.join(root, 'mods')),
    /does not contain the mixins/,
  )
})

function fakeSpawn(version = 'cargo 1.90.0 (test)\n') {
  return () => {
    const child = new EventEmitter()
    child.pid = 4242
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    process.nextTick(() => {
      child.stdout.end(version)
      child.emit('close', 0)
    })
    return child
  }
}

function builderFor(root, { nativeDir, spawnImpl, mods, ...options }) {
  const paths = {
    horizonRoot: path.join(root, 'horizon'),
    horizonVersionsRoot: path.join(root, 'versions'),
  }
  const horizonService = {
    modsDirectories: () => ({
      native: nativeDir,
      content: path.join(root, 'horizon-mods'),
      resourcepack: path.join(root, 'resourcepacks'),
      gameHome: root,
      stateFile: path.join(root, 'horizon-mods.txt'),
    }),
    listMods: async () => ({ mods }),
    status: async () => ({
      builds: [{ tag: 'v0.2.97', native: false, gameVersion: '26.3' }],
      gameVersion: '26.3',
    }),
  }
  return new HorizonNativeBuilder({
    paths,
    horizonService,
    spawnImpl,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    ...options,
  })
}

function builderForSourceArchive(root, fixture) {
  return builderFor(root, {
    nativeDir: path.join(root, 'horizon-native-mods'),
    mods: [],
    downloadFilesImpl: async (files) => {
      await fsp.writeFile(files[0].destination, 'archive')
    },
    spawnImpl: (program, args) => {
      const child = new EventEmitter()
      child.pid = 4242
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      process.nextTick(async () => {
        try {
          assert.equal(String(program), 'tar')
          await fsp.writeFile(path.join(args[3], 'outside.txt'), 'outside\n')
          await fsp.cp(fixture, path.join(args[3], 'horizon-source'), {
            recursive: true,
            verbatimSymlinks: true,
          })
          child.stdout.end()
          child.emit('close', 0)
        } catch (error) {
          child.emit('error', error)
        }
      })
      return child
    },
  })
}

test('Cargo progress is configured with a width when forced on', async (t) => {
  const root = await temporaryRoot(t)
  const builder = builderFor(root, {
    nativeDir: path.join(root, 'horizon-native-mods'),
    mods: [],
  })

  const env = builder.toolEnv()

  assert.equal(env.CARGO_TERM_PROGRESS_WHEN, 'always')
  assert.equal(env.CARGO_TERM_PROGRESS_WIDTH, '80')
})

test('source extraction materializes in-workspace symlinks', async (t) => {
  const root = await temporaryRoot(t)
  const fixture = path.join(root, 'fixture')
  await fsp.mkdir(fixture)
  await fsp.writeFile(path.join(fixture, 'Cargo.toml'), '[workspace]\n')
  await fsp.writeFile(path.join(fixture, 'README.md'), 'Horizon source docs\n')
  try {
    await fsp.symlink('README.md', path.join(fixture, 'CLAUDE.md'), 'file')
  } catch (error) {
    if (['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip('Symbolic links are unavailable in this test environment.')
      return
    }
    throw error
  }
  const builder = builderForSourceArchive(root, fixture)

  const source = await builder.ensureSource(REVISION, { logTail: [] }, new AbortController().signal)

  assert.equal(await fsp.readFile(path.join(source, '.horizon-revision'), 'utf8'), `${REVISION}\n`)
  assert.equal(await fsp.readFile(path.join(source, 'CLAUDE.md'), 'utf8'), 'Horizon source docs\n')
  assert.equal((await fsp.lstat(path.join(source, 'CLAUDE.md'))).isSymbolicLink(), false)
})

test('source extraction rejects symlinks that escape the workspace', async (t) => {
  const root = await temporaryRoot(t)
  const fixture = path.join(root, 'fixture')
  await fsp.mkdir(fixture)
  await fsp.writeFile(path.join(fixture, 'Cargo.toml'), '[workspace]\n')
  await fsp.writeFile(path.join(root, 'outside.txt'), 'outside\n')
  try {
    await fsp.symlink('../outside.txt', path.join(fixture, 'CLAUDE.md'), 'file')
  } catch (error) {
    if (['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      t.skip('Symbolic links are unavailable in this test environment.')
      return
    }
    throw error
  }
  const builder = builderForSourceArchive(root, fixture)

  await assert.rejects(
    builder.ensureSource(REVISION, { logTail: [] }, new AbortController().signal),
    /symlink escapes its workspace/,
  )
})

test('status offers to download Rust when no toolchain is installed', async (t) => {
  const root = await temporaryRoot(t)
  const nativeDir = path.join(root, 'horizon-native-mods')
  await fsp.mkdir(nativeDir, { recursive: true })
  nativeBundle(path.join(nativeDir, 'zoom.hnmod'), 'zoom')
  const builder = builderFor(root, {
    nativeDir,
    mods: [{ kind: 'native', enabled: true, filename: 'zoom.hnmod', title: 'Zoom' }],
    spawnImpl: () => {
      const error = new Error('spawn cargo ENOENT')
      error.code = 'ENOENT'
      throw error
    },
  })

  const status = await builder.status()

  assert.equal(status.rust.available, false)
  assert.equal(status.rust.canDownload, true)
  assert.equal(status.rust.source, null)
  assert.equal(status.canBuild, true)
  assert.equal(status.reason, null)
  assert.equal(status.enabledNativeMods, 1)
  assert.equal(status.baseTag, 'v0.2.97')
})

test('status allows a build when Rust, a release and an enabled native mod are present', async (t) => {
  const root = await temporaryRoot(t)
  const nativeDir = path.join(root, 'horizon-native-mods')
  await fsp.mkdir(nativeDir, { recursive: true })
  nativeBundle(path.join(nativeDir, 'zoom.hnmod'), 'zoom')
  const builder = builderFor(root, {
    nativeDir,
    mods: [{ kind: 'native', enabled: true, filename: 'zoom.hnmod', title: 'Zoom' }],
    spawnImpl: fakeSpawn(),
  })

  const status = await builder.status()

  assert.equal(status.rust.available, true)
  assert.equal(status.rust.source, 'system')
  assert.equal(status.rust.version, 'cargo 1.90.0 (test)')
  assert.equal(status.canBuild, true)
  assert.equal(status.reason, null)
  assert.equal(status.enabledNativeMods, 1)
})

test('a build needs at least one enabled native mod', async (t) => {
  const root = await temporaryRoot(t)
  const nativeDir = path.join(root, 'horizon-native-mods')
  await fsp.mkdir(nativeDir, { recursive: true })
  const builder = builderFor(root, { nativeDir, mods: [], spawnImpl: fakeSpawn() })

  const status = await builder.status()
  assert.equal(status.canBuild, false)
  assert.match(status.reason, /at least one native mod/)
  await assert.rejects(builder.build(), /at least one native mod/)
})

test('the first build downloads Rust into Aqua and uses that cargo', async (t) => {
  const root = await temporaryRoot(t)
  const installer = Buffer.from('rustup-init-binary')
  const digest = crypto.createHash('sha256').update(installer).digest('hex')
  // The builder is pinned to Linux below, so the managed cargo has no .exe suffix.
  const exe = ''
  const spawned = []
  let installerRuns = 0
  const spawnImpl = (program, args, options = {}) => {
    spawned.push({ program: String(program), args, env: options.env })
    const child = new EventEmitter()
    child.pid = 4242
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    if (String(program) === 'cargo') {
      process.nextTick(() => {
        const error = new Error('spawn cargo ENOENT')
        error.code = 'ENOENT'
        child.emit('error', error)
      })
      return child
    }
    process.nextTick(async () => {
      try {
        if (String(program).includes('rustup-init')) {
          installerRuns += 1
          const cargo = path.join(options.env.CARGO_HOME, 'bin', `cargo${exe}`)
          await fsp.mkdir(path.dirname(cargo), { recursive: true })
          await fsp.writeFile(cargo, '')
          child.stdout.end('info: default toolchain set to stable\n')
        } else {
          child.stdout.end('cargo 1.90.0 (test)\n')
        }
        setImmediate(() => child.emit('close', 0))
      } catch (error) {
        child.emit('error', error)
      }
    })
    return child
  }
  const builder = builderFor(root, {
    nativeDir: path.join(root, 'horizon-native-mods'),
    mods: [],
    spawnImpl,
    platform: 'linux',
    arch: 'x64',
    hasMsvcImpl: async () => false,
    fetchTextImpl: async () => `${digest}  rustup-init\n`,
    downloadFilesImpl: async (files) => {
      assert.equal(files.length, 1)
      await fsp.writeFile(files[0].destination, installer)
    },
  })
  const job = { logTail: [], stage: '', message: null }

  const engine = await builder.ensureRust(job, new AbortController().signal)

  assert.equal(engine.source, 'aqua')
  assert.equal(
    engine.cargo,
    path.join(root, 'horizon', 'native', 'toolchain', 'cargo', 'bin', `cargo${exe}`),
  )
  assert.equal(installerRuns, 1)
  const install = spawned.find((call) => call.program.includes('rustup-init'))
  assert.ok(install)
  assert.ok(install.args.includes('--no-modify-path'))
  assert.deepEqual(install.args.slice(-4), ['--profile', 'minimal', '--default-toolchain', 'stable'])
  assert.equal(install.env.CARGO_HOME, path.join(root, 'horizon', 'native', 'toolchain', 'cargo'))
  assert.ok(spawned.some((call) => call.program === engine.cargo))

  const again = await builder.ensureRust(job, new AbortController().signal)
  assert.equal(again.source, 'aqua')
  assert.equal(installerRuns, 1)
})

test('a Rust installer that fails its checksum is never run', async (t) => {
  const root = await temporaryRoot(t)
  const installer = Buffer.from('not-rustup')
  let installerRuns = 0
  const spawnImpl = (program) => {
    const child = new EventEmitter()
    child.pid = 4242
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    process.nextTick(() => {
      if (String(program) === 'cargo') {
        const error = new Error('spawn cargo ENOENT')
        error.code = 'ENOENT'
        child.emit('error', error)
      } else {
        installerRuns += 1
        child.emit('close', 0)
      }
    })
    return child
  }
  const builder = builderFor(root, {
    nativeDir: path.join(root, 'horizon-native-mods'),
    mods: [],
    spawnImpl,
    platform: 'linux',
    arch: 'x64',
    hasMsvcImpl: async () => false,
    fetchTextImpl: async () => `${'b'.repeat(64)}  rustup-init\n`,
    downloadFilesImpl: async (files) => {
      await fsp.writeFile(files[0].destination, installer)
    },
  })

  await assert.rejects(
    builder.ensureRust({ logTail: [], stage: '', message: null }, new AbortController().signal),
    /checksum/,
  )
  assert.equal(installerRuns, 0)
  await assert.rejects(fsp.access(builder.rustPaths().installer))
})
