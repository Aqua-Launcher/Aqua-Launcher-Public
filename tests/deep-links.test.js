import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStatusPayload, formatStatusText, parseAquaLink, parseCommandLine } from '../electron/core/deep-links.js'

test('join links validate the address and keep the profile and edition', () => {
  const intent = parseAquaLink('aqua://join?server=Play.Example.com&instance=profile-1')
  assert.equal(intent.kind, 'join')
  assert.equal(intent.server, 'play.example.com')
  assert.equal(intent.instance, 'profile-1')
  assert.equal(intent.edition, 'java')
  assert.equal(intent.confirmed, false)

  const bedrock = parseAquaLink('aqua://join?server=1.2.3.4&edition=bedrock')
  assert.equal(bedrock.server, '1.2.3.4:19132')
  assert.equal(bedrock.edition, 'bedrock')
})

test('launch, install and open links map onto the renderer routes', () => {
  assert.deepEqual(parseAquaLink('aqua://launch?instance=Survival'), {
    kind: 'launch',
    instance: 'Survival',
    confirmed: false,
    source: 'link',
  })
  assert.equal(parseAquaLink('aqua://install?pack=fabulously-optimized').project, 'fabulously-optimized')
  const open = parseAquaLink('aqua://open?page=mods&contentType=shader&section=shaders')
  assert.equal(open.page, 'mods')
  assert.equal(open.contentType, 'shader')
  assert.equal(open.section, 'shaders')
  assert.equal(open.confirmed, true)
})

test('links reject other schemes, unknown actions and unsafe parameters', () => {
  assert.throws(() => parseAquaLink('https://example.com/join?server=x'), /aqua:\/\//)
  assert.throws(() => parseAquaLink('aqua://explode?server=x'), /Unknown Aqua link action/)
  assert.throws(() => parseAquaLink('aqua://join'), /Server address is required/)
  assert.throws(() => parseAquaLink('aqua://join?server=https://example.com'), /spaces or URLs/)
  assert.throws(() => parseAquaLink('aqua://install?pack=../../evil'), /id or slug/)
  assert.throws(() => parseAquaLink('aqua://open?page=../../settings'), /Unknown Aqua page/)
  assert.throws(() => parseAquaLink('aqua://open?page=stats&contentType=exe'), /Unknown content type/)
  assert.throws(() => parseAquaLink('aqua://launch/extra?instance=x'), /unexpected path/)
  assert.throws(() => parseAquaLink(`aqua://launch?instance=${'x'.repeat(200)}`), /too long/)
})

test('CLI launch and join parse flags and confirmations', () => {
  const launch = parseCommandLine(['aqua', 'launch', 'Survival', '--yes', '--json'])
  assert.equal(launch.kind, 'launch')
  assert.equal(launch.instance, 'Survival')
  assert.equal(launch.confirmed, true)
  assert.equal(launch.json, true)

  const dev = parseCommandLine(['C:\\electron.exe', '.', 'launch', 'Creative'])
  assert.equal(dev.instance, 'Creative')
  assert.equal(dev.confirmed, false)

  const join = parseCommandLine([
    'aqua',
    'join',
    'Play.Example.com:25566',
    '--instance',
    'profile-2',
    '--edition',
    'java',
  ])
  assert.equal(join.server, 'play.example.com:25566')
  assert.equal(join.instance, 'profile-2')

  const link = parseCommandLine(['aqua', 'aqua://launch?instance=Survival', '--yes'])
  assert.equal(link.kind, 'launch')
  assert.equal(link.confirmed, true)
})

test('CLI status is parseable and malformed commands fail readably', () => {
  assert.deepEqual(parseCommandLine(['aqua', 'status', '--json']), {
    kind: 'status',
    json: true,
    source: 'cli',
  })
  assert.equal(parseCommandLine(['aqua', '--hidden']), null)
  assert.throws(() => parseCommandLine(['aqua', 'explode']), /Unknown command "explode"/)
  assert.throws(() => parseCommandLine(['aqua', 'launch', '--nope']), /Unknown option "--nope"/)
  assert.throws(() => parseCommandLine(['aqua', 'join']), /one server address/)
  assert.throws(() => parseCommandLine(['aqua', 'install', 'a', 'b']), /one Modrinth project/)
  assert.throws(() => parseCommandLine(['aqua', 'join', 'x.test', '--edition', 'switch']), /java or bedrock/)
})

test('status JSON carries profiles but never tokens or local paths', () => {
  const payload = buildStatusPayload({
    appVersion: '1.0.0',
    packaged: true,
    platform: 'win32',
    launcherRunning: true,
    activeInstallationId: 'a',
    installations: [
      {
        id: 'a',
        name: 'Survival',
        versionId: '1.21.4',
        loader: { type: 'fabric', version: '0.16.9' },
        pinned: true,
        tags: ['Friends'],
        lastPlayedAt: '2026-11-01T12:00:00.000Z',
        javaPath: 'C:\\secret\\java.exe',
        gameDir: 'C:\\Users\\someone\\game',
        accounts: [{ accessToken: 'secret' }],
      },
      { id: 'b', name: 'Creative', versionId: '1.20.6' },
    ],
  })
  assert.equal(payload.activeProfile.name, 'Survival')
  assert.equal(payload.totals.pinned, 1)
  assert.equal(payload.running, true)
  const serialized = JSON.stringify(payload)
  assert.doesNotMatch(serialized, /token|secret|javaPath|gameDir|accounts/i)
  assert.doesNotThrow(() => JSON.parse(serialized))
  assert.match(formatStatusText(payload), /Active profile: Survival/)
  assert.match(formatStatusText(payload), /Profiles: 2 \(1 pinned\)/)
})
