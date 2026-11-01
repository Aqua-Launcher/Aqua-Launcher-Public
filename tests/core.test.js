import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'
import {
  assertSafeGameDirectory,
  isAllowedExternalUrl,
  isPathInside,
  parseArguments,
  sanitizeFileName,
  uniqueName,
} from '../electron/core/util.js'
import {
  applicableLibraries,
  collectArgumentEntries,
  dedupeLibraries,
  getPlatformContext,
  mavenPath,
  rulesAllow,
  substituteTokens,
} from '../electron/core/minecraft-rules.js'
import { createDefaultSettings, validateSettings } from '../electron/core/settings.js'
import { libraryDownload } from '../electron/core/installer.js'
import { supportsQuickPlay } from '../electron/core/game.js'
import {
  baseVersionCandidates,
  findDropForText,
  imageSize,
  normalizeDropName,
  parseDropCardNames,
  parseDropNames,
  parseWallpaperPacks,
  pickWallpaper,
} from '../electron/core/artwork.js'
import { motdToText, normalizeServerAddress, pingServer } from '../electron/core/servers.js'
import { WorldsService, parseNbtRoot, readWorldMetadata } from '../electron/core/worlds.js'

test('drop wallpaper matches a version to its game drop', () => {
  // Names are written differently in every source, so matching ignores case,
  // punctuation and the "and" that hides inside escaped entities.
  assert.equal(normalizeDropName('Trails & Tales'), 'trailsandtales')
  assert.equal(normalizeDropName('Trails &#x26; Tales'), 'trailsandtales')

  const packs = parseWallpaperPacks(`
    <div class="MC_Carousel_track_slide">
      <a href="/content/dam/minecraftnet/games/minecraft/software/wallpapers_mounts_of_mayhem_drop.zip"
         aria-label="Mounts of Mayhem themed Wallpaper">
        <div class="MC_Carousel_track_slide_media"><img src="/x.png" alt="jousting" /></div>
        <div class="MC_Carousel_track_slide_text"><p>Wallpaper</p>
          <h4 class="MC_Carousel_track_slide_text_heading">Mounts of Mayhem</h4></div>
      </a>
    </div>
    <div class="MC_Carousel_track_slide">
      <a href="/content/dam/minecraftnet/games/minecraft/software/Minecraft_Trails_and_Tales_.Net.zip"
         aria-label="Trails &amp; Tales themed Wallpaper">
        <div class="MC_Carousel_track_slide_text"><p>Wallpaper</p>
          <h4 class="MC_Carousel_track_slide_text_heading">Trails &amp; Tales</h4></div>
      </a>
    </div>
    <a href="/content/dam/minecraftnet/games/minecraft/software/wallpapers_minecraft_java_edition.zip"
       aria-label="Download the Minecraft Java Edition wallpaper">
      <h4 class="MC_Carousel_track_slide_text_heading">Java edition</h4>
    </a>
    <a href="https://evil.example/wallpapers_x.zip" aria-label="Not Mojang themed Wallpaper">
      <h4 class="MC_Carousel_track_slide_text_heading">Not Mojang</h4>
    </a>
  `)
  // Game-wide and foreign packs are not drops.
  assert.equal(packs.size, 2)
  assert.equal(
    packs.get('mountsofmayhem').zipUrl,
    'https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/software/wallpapers_mounts_of_mayhem_drop.zip',
  )

  // Drop names come from the updates page key art and the launcher news cards.
  const names = parseDropNames(`
    <img src="/content/dam/minecraftnet/games/minecraft/key-art/MC-Updates_Carousel-N-0_2023_Trails-and-Tails_01_1000x563.jpg"
         alt="A cherry blossom forest. Text reads: Minecraft Trails and Tales" />
  `)
  const cards = parseDropCardNames({
    entries: [
      { title: 'Play Wilderness Bound', newsType: ['Java'] },
      { title: 'Play Mounts of Mayhem Today', newsType: ['Java'] },
      { title: 'Enter the Marketplace', newsType: ['Bedrock'] },
    ],
  })
  assert.equal(names.has('trailsandtales'), true)
  assert.equal(cards.size, 2)
  assert.equal(cards.has('wildernessbound'), true)

  const note = 'What, is there something special happening today? Oh, it is time for Trails &#x26; Tales!'
  assert.equal(findDropForText(packs, note).name, 'Trails &amp; Tales')
  assert.equal(findDropForText(packs, 'A hotfix release with no drop named at all'), null)

  // Point releases inherit their base version, and old releases have no notes.
  assert.deepEqual(baseVersionCandidates('1.20.1'), ['1.20.1', '1.20'])
  assert.deepEqual(baseVersionCandidates('26.3'), ['26.3'])
  assert.deepEqual(baseVersionCandidates('26.4-snapshot-3'), ['26.4-snapshot-3'])
  assert.deepEqual(baseVersionCandidates(''), [])
})

test('drop wallpaper picks the best image out of a pack', () => {
  const png = (width, height) => {
    const buffer = Buffer.alloc(24)
    buffer[0] = 0x89
    buffer[1] = 0x50
    buffer.writeUInt32BE(width, 16)
    buffer.writeUInt32BE(height, 20)
    return buffer
  }
  assert.deepEqual(imageSize(png(1920, 1080)), { width: 1920, height: 1080 })
  assert.equal(imageSize(Buffer.from('not an image at all, honest')), null)

  const picked = pickWallpaper([
    { name: 'phone.png', bytes: png(1080, 1920) },
    { name: 'square.png', bytes: png(2048, 2048) },
    { name: 'small.png', bytes: png(800, 450) },
    { name: 'desktop.png', bytes: png(1920, 1080) },
  ])
  assert.equal(picked.name, 'desktop.png')

  // Portrait-only packs still return their largest crop rather than nothing.
  const portrait = pickWallpaper([{ name: 'phone.png', bytes: png(1080, 1920) }])
  assert.equal(portrait.name, 'phone.png')
  assert.equal(pickWallpaper([]), null)
})

test('parseArguments handles quoting and escapes without invoking a shell', () => {
  assert.deepEqual(parseArguments('-Xmx4G -Dfoo="hello world"'), ['-Xmx4G', '-Dfoo=hello world'])
  assert.deepEqual(parseArguments('--path "C:\\\\Games\\\\Minecraft"'), ['--path', 'C:\\Games\\Minecraft'])
  assert.deepEqual(parseArguments("--name 'Alex The Great'"), ['--name', 'Alex The Great'])
  assert.throws(() => parseArguments('--broken "unclosed'), /unclosed quote/i)
})

test('external links are limited to allow-listed hosts and settings pages', () => {
  assert.equal(isAllowedExternalUrl('https://www.minecraft.net/en-us/eula'), true)
  assert.equal(isAllowedExternalUrl('https://apps.microsoft.com/detail/9nblggh2jhxj'), true)
  assert.equal(isAllowedExternalUrl('https://cdn.modrinth.com/data/x/y.png'), false)
  assert.equal(isAllowedExternalUrl('http://minecraft.net/'), false)
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe'), false)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedExternalUrl('not a url'), false)

  // Windows Settings deep links are the one non-web exception.
  assert.equal(isAllowedExternalUrl('ms-settings:developers', 'win32'), true)
  assert.equal(isAllowedExternalUrl('ms-settings:developers', 'linux'), false)
  assert.equal(isAllowedExternalUrl('ms-settings:../evil', 'win32'), false)
  assert.equal(isAllowedExternalUrl('ms-settings:developers?x=1', 'win32'), false)
  assert.equal(isAllowedExternalUrl('ms-settings:', 'win32'), false)
})

test('path helpers reject traversal and protect system directories', () => {
  assert.equal(isPathInside('/games/minecraft/saves', '/games/minecraft'), true)
  assert.equal(isPathInside('/games/other', '/games/minecraft'), false)
  assert.equal(isPathInside('/games/minecraft', '/games/minecraft'), true)
  assert.equal(sanitizeFileName('../../bad:name?.jar'), '-..-bad-name-.jar')
  assert.equal(uniqueName('Survival', ['Survival']), 'Survival Copy')
  assert.equal(uniqueName('Survival', ['Survival', 'survival copy']), 'Survival Copy 2')

  const protectedPath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc'
  assert.throws(() => assertSafeGameDirectory(protectedPath), /protected system locations/i)
  assert.throws(() => assertSafeGameDirectory(path.parse(path.resolve(protectedPath)).root), /drive root/i)
})

test('Maven coordinates and rule evaluation follow Mojang metadata', () => {
  assert.equal(
    mavenPath('org.lwjgl:lwjgl:3.4.3:natives-windows@jar'),
    'org/lwjgl/lwjgl/3.4.3/lwjgl-3.4.3-natives-windows.jar',
  )
  const context = getPlatformContext()
  assert.equal(rulesAllow(undefined, context), true)
  assert.equal(
    rulesAllow(
      [
        { action: 'allow' },
        { action: 'disallow', os: { name: context.os.name } },
      ],
      context,
    ),
    false,
  )
  assert.deepEqual(
    collectArgumentEntries(
      [
        '--username',
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' },
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '1280'] },
      ],
      context,
    ),
    ['--username', '--width', '1280'],
  )
  assert.equal(substituteTokens('${auth_player_name}', { auth_player_name: 'Steve' }), 'Steve')
  assert.throws(() => substituteTokens('${missing}', {}, { strict: true }), /unknown launch placeholder/i)
})

test('settings validation rejects unsafe values and accepts normal user folders', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-settings-'))
  try {
    const gameDir = path.join(temp, 'Minecraft')
    const defaults = createDefaultSettings({ totalMemMb: 16_384, instancesRoot: gameDir })
    const valid = await validateSettings(
      {
        ...defaults,
        defaultGameDir: gameDir,
        memory: { minMb: 1024, maxMb: 4096 },
      },
      { totalMemMb: 16_384 },
    )
    assert.equal(valid.defaultGameDir, path.normalize(gameDir))
    assert.equal(valid.memory.maxMb, 4096)

    await assert.rejects(
      validateSettings(
        { ...defaults, memory: { minMb: 4096, maxMb: 1024 } },
        { totalMemMb: 16_384 },
      ),
      /Minimum memory cannot be greater than maximum memory/,
    )
    await assert.rejects(
      validateSettings({ ...defaults, microsoftClientId: 'not-a-guid' }, { totalMemMb: 16_384 }),
      /valid GUID/,
    )
    const protectedPath = process.platform === 'win32' ? 'C:\\Windows' : '/etc'
    await assert.rejects(
      validateSettings({ ...defaults, defaultGameDir: protectedPath }, { totalMemMb: 16_384 }),
      /protected system locations/i,
    )
  } finally {
    await fs.rm(temp, { recursive: true, force: true })
  }
})

test('native-only libraries use their classified jar instead of a missing base artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-libs-'))
  const context = getPlatformContext()
  const classifier = `natives-${context.os.name}`
  const nativeUrl = `https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl-platform/2.9.0/lwjgl-platform-2.9.0-${classifier}.jar`
  const { entries } = libraryDownload(
    {
      name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.0',
      natives: { [context.os.name]: classifier },
      downloads: {
        classifiers: {
          [classifier]: {
            path: `org/lwjgl/lwjgl/lwjgl-platform/2.9.0/lwjgl-platform-2.9.0-${classifier}.jar`,
            url: nativeUrl,
          },
        },
      },
    },
    root,
    context,
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].url, nativeUrl)
  assert.match(path.basename(entries[0].destination), new RegExp(`${classifier}\.jar$`))
  await fs.rm(root, { recursive: true, force: true })
})

test('loader libraries replace the Mojang build of the same Maven artifact', () => {
  const libraries = applicableLibraries(
    {
      libraries: [
        { name: 'org.ow2.asm:asm:9.6', downloads: { artifact: { path: 'org/ow2/asm/asm/9.6/asm-9.6.jar' } } },
        { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net/' },
      ],
    },
    getPlatformContext(),
  )
  assert.equal(libraries.length, 1)
  assert.equal(libraries[0].name, 'org.ow2.asm:asm:9.10.1')
})

test('native classifiers survive artifact deduplication', () => {
  const libraries = dedupeLibraries([
    { name: 'org.lwjgl:lwjgl:3.3.3' },
    { name: 'org.lwjgl:lwjgl:3.3.3:natives-windows' },
    { name: 'org.lwjgl:lwjgl:3.3.3:natives-linux' },
  ])
  assert.deepEqual(
    libraries.map((library) => library.name),
    [
      'org.lwjgl:lwjgl:3.3.3',
      'org.lwjgl:lwjgl:3.3.3:natives-windows',
      'org.lwjgl:lwjgl:3.3.3:natives-linux',
    ],
  )
})

test('an OS-specific loader override leaves the Mojang library when it does not apply', () => {
  const libraries = applicableLibraries(
    {
      libraries: [
        { name: 'org.ow2.asm:asm:9.6' },
        { name: 'org.ow2.asm:asm:9.10.1', rules: [{ action: 'allow', os: { name: 'windows' } }] },
      ],
    },
    { os: { name: 'linux', arch: 'x86_64', version: '6.0' }, features: {} },
  )
  assert.equal(libraries.length, 1)
  assert.equal(libraries[0].name, 'org.ow2.asm:asm:9.6')
})

test('libraries without any download metadata still fall back to Maven coordinates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-libs-'))
  const { entries } = libraryDownload(
    { name: 'com.example:demo-library:1.0' },
    root,
    getPlatformContext(),
  )
  assert.equal(entries.length, 1)
  assert.match(entries[0].url, /com\/example\/demo-library\/1\.0\/demo-library-1\.0\.jar$/)
  await fs.rm(root, { recursive: true, force: true })
})

test('loader profiles follow each loader naming scheme', async () => {
  const { loaderProfileId } = await import('../electron/core/loaders.js')
  assert.equal(loaderProfileId('fabric', '1.20.1', '0.16.9'), 'fabric-loader-0.16.9-1.20.1')
  assert.equal(loaderProfileId('quilt', '1.21', '0.27.0'), 'quilt-loader-0.27.0-1.21')
  assert.equal(loaderProfileId('forge', '1.20.1', '47.2.0'), '1.20.1-forge-47.2.0')
  assert.equal(loaderProfileId('neoforge', '1.21.1', '21.1.80'), 'neoforge-21.1.80')
  assert.equal(loaderProfileId('neoforge', '1.20.1', '1.20.1-47.1.106'), '1.20.1-forge-47.1.106')
  assert.throws(() => loaderProfileId('fabric', '1.20.1', '../escape'))
})

test('mod file names cannot escape the mods folder', async () => {
  const { ModrinthService } = await import('../electron/core/modrinth.js')
  const service = new ModrinthService({ logger: null })
  const installation = { gameDir: path.join(os.tmpdir(), 'aqua-mods-test'), versionId: '1.20.1', loader: { type: 'fabric' } }
  const resolved = service.resolveModFile(installation, 'sodium-0.5.11.jar')
  assert.equal(path.basename(resolved), 'sodium-0.5.11.jar')
  assert.throws(() => service.resolveModFile(installation, '../../secrets.jar'))
  assert.throws(() => service.resolveModFile(installation, 'nested/mod.jar'))
  assert.throws(() => service.ensureModdable({ loader: { type: 'vanilla' } }), /Fabric/)
})

test('interface scale is clamped to the supported range', async () => {
  const { createDefaultSettings, normalizeSettings } = await import('../electron/core/settings.js')
  const defaults = createDefaultSettings({ totalMemMb: 16384, instancesRoot: path.join(os.tmpdir(), 'aqua-scale') })
  assert.equal(normalizeSettings({ uiScale: 5 }, defaults).uiScale, 1.3)
  assert.equal(normalizeSettings({ uiScale: 0.1 }, defaults).uiScale, 0.8)
  assert.equal(normalizeSettings({ uiScale: 1.15 }, defaults).uiScale, 1.15)
  assert.equal(normalizeSettings({}, defaults).uiScale, 1)
})

test('theme block ids map onto client jar texture entries', async () => {
  const { BLOCK_TEXTURE_FILES, findBlockTexture, looksLikePng } = await import('../electron/core/block-textures.js')
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')])
  assert.equal(looksLikePng(png), true)
  assert.equal(looksLikePng(Buffer.from('not a png')), false)

  const modern = new Map([['assets/minecraft/textures/block/stone.png', { getData: () => png }]])
  assert.equal(findBlockTexture(modern, 'stone').getData(), png)
  assert.equal(findBlockTexture(modern, 'sculk'), null)

  // 1.12 and older keep block textures in a plural directory.
  const legacy = new Map([['assets/minecraft/textures/blocks/grass_side.png', { getData: () => png }]])
  assert.ok(findBlockTexture(legacy, 'grass_block'))

  // Modern names win when a jar ships both layouts.
  const both = new Map([
    ['assets/minecraft/textures/block/grass_block_side.png', { getData: () => Buffer.from('modern') }],
    ['assets/minecraft/textures/blocks/grass_side.png', { getData: () => Buffer.from('legacy') }],
  ])
  assert.equal(findBlockTexture(both, 'grass_block').getData().toString(), 'modern')
  assert.ok(Object.keys(BLOCK_TEXTURE_FILES).length > 20)
})

test('block textures are extracted from an installed client jar and cached', async () => {
  const AdmZip = (await import('adm-zip')).default
  const { BlockTextureService } = await import('../electron/core/block-textures.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-block-textures-'))
  const versionsRoot = path.join(root, 'versions')
  const versionDir = path.join(versionsRoot, '1.21.4')
  await fs.mkdir(versionDir, { recursive: true })
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')])
  const zip = new AdmZip()
  zip.addFile('assets/minecraft/textures/block/stone.png', png)
  zip.addFile('assets/minecraft/textures/block/dirt.png', png)
  zip.writeZip(path.join(versionDir, '1.21.4.jar'))
  await fs.writeFile(path.join(versionDir, '1.21.4.json'), JSON.stringify({ id: '1.21.4' }))

  const service = new BlockTextureService({
    paths: { versionsRoot, cacheRoot: path.join(root, 'cache') },
    installationService: { list: async () => [{ effectiveVersionId: '1.21.4', isActive: true }] },
    logger: null,
  })

  const first = await service.list()
  assert.equal(first.available, true)
  assert.equal(first.versionId, '1.21.4')
  assert.deepEqual(Object.keys(first.textures).sort(), ['dirt', 'stone'])
  assert.ok(first.textures.stone.startsWith('data:image/png;base64,'))
  assert.ok(first.missing.includes('grass_block'))

  // The second call is served from the launcher cache, not the jar.
  const second = await service.list()
  assert.deepEqual(Object.keys(second.textures).sort(), ['dirt', 'stone'])

  await fs.rm(root, { recursive: true, force: true })
})

test('custom theme surfaces are normalized and clamped', async () => {
  const { createDefaultSettings, normalizeSettings } = await import('../electron/core/settings.js')
  const defaults = createDefaultSettings({ totalMemMb: 16384, instancesRoot: path.join(os.tmpdir(), 'aqua-theme') })
  const normalized = normalizeSettings(
    {
      customTheme: {
        enabled: true,
        sidebar: { mode: 'neon', block: 'Not A Block!', color: 'red', opacity: 250, pixelSize: 5 },
        accentMode: 'custom',
        accentColor: '#ABCDEF',
      },
    },
    defaults,
  )
  assert.equal(normalized.customTheme.enabled, true)
  assert.equal(normalized.customTheme.sidebar.mode, 'block')
  assert.equal(normalized.customTheme.sidebar.block, defaults.customTheme.sidebar.block)
  assert.equal(normalized.customTheme.sidebar.color, defaults.customTheme.sidebar.color)
  assert.equal(normalized.customTheme.sidebar.opacity, 100)
  assert.equal(normalized.customTheme.sidebar.pixelSize, 16)
  assert.equal(normalized.customTheme.titlebar.opacity, defaults.customTheme.titlebar.opacity)
  assert.equal(normalized.customTheme.accentMode, 'custom')
  assert.equal(normalized.customTheme.accentColor, '#abcdef')
})

test('NeoForge build series follows the Minecraft version scheme', async () => {
  const { neoForgeSeries } = await import('../electron/core/loaders.js')
  assert.equal(neoForgeSeries('1.21.1'), '21.1.')
  assert.equal(neoForgeSeries('1.21'), '21.0.')
  assert.equal(neoForgeSeries('1.20.1'), '20.1.')
  assert.equal(neoForgeSeries('26.3'), '26.3.')
  assert.equal(neoForgeSeries('26.2'), '26.2.')
})

test('launchwrapper versions refuse a runtime newer than Java 8', async () => {
  const { JavaService } = await import('../electron/core/java.js')
  const service = new JavaService({
    paths: { runtimeRoot: path.join(os.tmpdir(), 'aqua-java-test') },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  })
  const legacy = {
    id: '1.12.2-forge-14.23.5.2864',
    mainClass: 'net.minecraft.launchwrapper.Launch',
    javaVersion: { majorVersion: 8 },
  }
  const modern = { id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 17 } }
  const settings = { java: { mode: 'auto', path: null } }

  service.detect = async () => [{ path: 'C:/Java25/bin/java.exe', major: 25, home: 'C:/Java25' }]
  await assert.rejects(
    () => service.chooseJava(legacy, settings, null),
    /needs Java 8.*launchwrapper/s,
  )

  service.detect = async () => [
    { path: 'C:/Java25/bin/java.exe', major: 25, home: 'C:/Java25' },
    { path: 'C:/jre-legacy/bin/java.exe', major: 8, home: 'C:/jre-legacy' },
  ]
  const chosen = await service.chooseJava(legacy, settings, null)
  assert.equal(chosen.major, 8)
  assert.equal(chosen.warning, null)

  // Modern versions still accept a newer runtime.
  const modernChoice = await service.chooseJava(modern, settings, null)
  assert.equal(modernChoice.major, 25)
  assert.match(modernChoice.warning || '', /targets Java 17/)
})

function nbtString(value) {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(2)
  length.writeUInt16BE(bytes.length)
  return Buffer.concat([length, bytes])
}

function nbtTag(type, name, payload) {
  return Buffer.concat([Buffer.from([type]), nbtString(name), payload])
}

function nbtInt(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value)
  return buffer
}

function nbtLong(value) {
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(value))
  return buffer
}

const NBT_END = Buffer.from([0])

function buildLevelDat() {
  const version = nbtTag(
    10,
    'Version',
    Buffer.concat([nbtTag(8, 'Name', nbtString('1.21.4')), nbtTag(3, 'Id', nbtInt(4189)), NBT_END]),
  )
  const data = nbtTag(
    10,
    'Data',
    Buffer.concat([
      nbtTag(8, 'LevelName', nbtString('Test World')),
      nbtTag(4, 'LastPlayed', nbtLong(Date.UTC(2026, 0, 2))),
      nbtTag(3, 'GameType', nbtInt(1)),
      nbtTag(1, 'hardcore', Buffer.from([0])),
      nbtTag(1, 'Difficulty', Buffer.from([3])),
      version,
      NBT_END,
    ]),
  )
  return Buffer.concat([Buffer.from([10]), nbtString(''), data, NBT_END])
}

test('world metadata is read from a gzipped level.dat', async () => {
  const parsed = parseNbtRoot(buildLevelDat())
  assert.equal(parsed.Data.LevelName, 'Test World')
  assert.equal(parsed.Data.GameType, 1)

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-world-'))
  try {
    const worldDir = path.join(root, 'My World')
    await fs.mkdir(path.join(worldDir, 'region'), { recursive: true })
    await fs.writeFile(path.join(worldDir, 'level.dat'), zlib.gzipSync(buildLevelDat()))
    await fs.writeFile(path.join(worldDir, 'region', 'r.0.0.mca'), Buffer.alloc(64, 1))
    await fs.writeFile(path.join(worldDir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const metadata = await readWorldMetadata(worldDir)
    assert.equal(metadata.name, 'Test World')
    assert.equal(metadata.gameMode, 'creative')
    assert.equal(metadata.difficulty, 'hard')
    assert.equal(metadata.versionName, '1.21.4')
    assert.equal(metadata.lastPlayed, new Date(Date.UTC(2026, 0, 2)).toISOString())
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('worlds can be listed, backed up, restored next to the original, and deleted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-worlds-'))
  try {
    const gameDir = path.join(root, 'instance')
    const worldDir = path.join(gameDir, 'saves', 'My World')
    await fs.mkdir(path.join(worldDir, 'region'), { recursive: true })
    await fs.writeFile(path.join(worldDir, 'level.dat'), zlib.gzipSync(buildLevelDat()))
    await fs.writeFile(path.join(worldDir, 'region', 'r.0.0.mca'), Buffer.alloc(128, 2))
    await fs.writeFile(path.join(worldDir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const installation = { id: 'inst-1', name: 'Test', gameDir }
    const store = { getInstallation: (id) => (id === installation.id ? installation : null) }
    const logger = { info() {}, warn() {}, debug() {}, error() {} }
    const service = new WorldsService({
      paths: {
        backupsRoot: path.join(root, 'backups'),
        cacheRoot: path.join(root, 'cache'),
      },
      store,
      logger,
    })

    const listed = await service.list(installation.id)
    assert.equal(listed.worlds.length, 1)
    assert.equal(listed.worlds[0].name, 'Test World')
    assert.equal(listed.worlds[0].folder, 'My World')
    assert.ok(listed.worlds[0].sizeBytes > 0)
    assert.match(listed.worlds[0].iconDataUrl, /^data:image\/png;base64,/)
    assert.deepEqual(listed.backups, [])

    const backup = await service.backupWorld(installation.id, 'My World')
    const backups = await service.listBackups(installation.id)
    assert.equal(backups.length, 1)
    assert.equal(backups[0].id, backup.id)
    assert.ok(backups[0].sizeBytes > 0)

    // Restoring adds a copy so the live save is untouched.
    const restored = await service.restoreBackup(installation.id, backup.id)
    assert.equal(restored.folder, 'My World (restored)')
    await fs.access(path.join(gameDir, 'saves', 'My World', 'level.dat'))
    await fs.access(path.join(gameDir, 'saves', 'My World (restored)', 'level.dat'))
    await fs.access(path.join(gameDir, 'saves', 'My World (restored)', 'region', 'r.0.0.mca'))

    await service.deleteBackup(installation.id, backup.id)
    assert.deepEqual(await service.listBackups(installation.id), [])

    await service.deleteWorld(installation.id, 'My World (restored)')
    await assert.rejects(fs.access(path.join(gameDir, 'saves', 'My World (restored)')))
    await assert.rejects(service.deleteWorld(installation.id, '../escape'), /invalid|outside/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('server addresses are normalized and MOTDs are flattened', () => {
  assert.deepEqual(normalizeServerAddress('play.example.com'), {
    edition: 'java',
    host: 'play.example.com',
    port: 25565,
    explicitPort: false,
    address: 'play.example.com:25565',
    connectAddress: 'play.example.com',
  })
  assert.deepEqual(normalizeServerAddress('minecraft://Play.Example.com:25566/'), {
    edition: 'java',
    host: 'play.example.com',
    port: 25566,
    explicitPort: true,
    address: 'play.example.com:25566',
    connectAddress: 'play.example.com:25566',
  })
  assert.deepEqual(normalizeServerAddress('[::1]:25570'), {
    edition: 'java',
    host: '::1',
    port: 25570,
    explicitPort: true,
    address: '[::1]:25570',
    connectAddress: '[::1]:25570',
  })
  assert.equal(normalizeServerAddress('localhost').address, 'localhost:25565')
  assert.equal(normalizeServerAddress('localhost').connectAddress, 'localhost')
  assert.equal(normalizeServerAddress('play.example.com:25565').connectAddress, 'play.example.com:25565')
  assert.throws(() => normalizeServerAddress('https://example.com'), /spaces or URLs/i)
  assert.throws(() => normalizeServerAddress('play.example.com:99999'), /port/i)
  assert.throws(() => normalizeServerAddress(''), /address/i)

  assert.equal(motdToText('§aWelcome §lback§r'), 'Welcome back')
  assert.equal(
    motdToText({ text: 'Hello ', extra: [{ text: 'world', color: 'gold' }] }),
    'Hello world',
  )
  assert.equal(motdToText([{ text: 'One ' }, { text: 'Two' }]), 'One Two')
  assert.equal(motdToText(null), '')
})

test('server list ping reads a status response over TCP', async () => {
  const statusJson = JSON.stringify({
    version: { name: '1.21.4', protocol: 769 },
    players: { online: 3, max: 20, sample: [{ name: 'Steve', id: 'abc' }] },
    description: { text: 'Hello ', extra: [{ text: 'world' }] },
    favicon: 'data:image/png;base64,iVBORw0KGgo=',
  })
  const encodeVarInt = (value) => {
    const bytes = []
    let remaining = value >>> 0
    do {
      let byte = remaining & 0x7f
      remaining >>>= 7
      if (remaining) byte |= 0x80
      bytes.push(byte)
    } while (remaining)
    return Buffer.from(bytes)
  }
  const body = Buffer.concat([
    Buffer.from([0]),
    encodeVarInt(Buffer.byteLength(statusJson)),
    Buffer.from(statusJson),
  ])
  const response = Buffer.concat([encodeVarInt(body.length), body])

  const server = net.createServer((socket) => {
    socket.once('data', () => socket.write(response))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const status = await pingServer(`127.0.0.1:${port}`, { timeoutMs: 3000 })
    assert.equal(status.online, true)
    assert.equal(status.motd, 'Hello world')
    assert.equal(status.version, '1.21.4')
    assert.equal(status.players.online, 3)
    assert.equal(status.players.max, 20)
    assert.equal(status.players.sample[0].name, 'Steve')
    assert.match(status.favicon, /^data:image\/png;base64,/)
    assert.ok(status.latencyMs >= 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('saved servers persist in the launcher store', async () => {
  const { Store } = await import('../electron/core/store.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-store-'))
  const logger = { info() {}, warn() {}, debug() {}, error() {} }
  try {
    const configFile = path.join(root, 'launcher.json')
    const options = {
      configFile,
      instancesRoot: path.join(root, 'instances'),
      totalMemMb: 16_384,
      logger,
    }
    const store = new Store(options)
    await store.init()
    assert.deepEqual(store.servers, [])

    const server = {
      id: 'server-1',
      name: 'Test SMP',
      address: 'play.example.com:25565',
      addedAt: new Date().toISOString(),
      lastJoinedAt: null,
    }
    await store.addServer(server)
    const joined = await store.markServerJoined(server.id)
    assert.ok(joined.lastJoinedAt)

    const reloaded = new Store(options)
    await reloaded.init()
    assert.equal(reloaded.servers.length, 1)
    assert.equal(reloaded.servers[0].name, 'Test SMP')
    assert.equal(reloaded.servers[0].address, 'play.example.com:25565')
    assert.equal(reloaded.servers[0].connectAddress, 'play.example.com:25565')
    assert.equal(reloaded.publicServer(reloaded.servers[0]).id, 'server-1')
    assert.equal(reloaded.publicServer(reloaded.servers[0]).connectAddress, 'play.example.com:25565')

    await reloaded.removeServer('server-1')
    assert.deepEqual(reloaded.servers, [])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('saved servers keep SRV-friendly addresses and reject duplicates', async () => {
  const { ServerService } = await import('../electron/core/servers.js')
  const records = []
  const store = {
    get servers() {
      return records
    },
    async addServer(server) {
      records.push(server)
      return server
    },
    getServer(id) {
      return records.find((server) => server.id === id) || null
    },
    async updateServer(id, patch) {
      Object.assign(this.getServer(id), patch)
      return this.getServer(id)
    },
    async removeServer(id) {
      const index = records.findIndex((server) => server.id === id)
      return records.splice(index, 1)[0]
    },
    publicServer(server) {
      return server ? { ...server } : null
    },
  }
  const service = new ServerService({ store, logger: null })
  const added = await service.add({ name: 'SMP', address: 'Play.Example.com' })
  assert.equal(added.address, 'play.example.com:25565')
  assert.equal(added.connectAddress, 'play.example.com')
  await assert.rejects(
    () => service.add({ name: 'Duplicate', address: 'play.example.com:25565' }),
    /already in your list/i,
  )

  const updated = await service.update(added.id, { address: 'play.example.com:25566' })
  assert.equal(updated.connectAddress, 'play.example.com:25566')
  const removed = await service.remove(added.id)
  assert.equal(removed.id, added.id)
  assert.deepEqual(records, [])
})

test('Quick Join arguments are only passed to versions that advertise them', () => {
  const modern = {
    arguments: {
      game: [
        { rules: [{ action: 'allow', features: { is_demo_user: false } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] },
      ],
    },
  }
  assert.equal(supportsQuickPlay(modern), true)
  assert.equal(supportsQuickPlay({ arguments: { game: ['--username', '${auth_player_name}'] } }), false)
  assert.equal(supportsQuickPlay({ minecraftArguments: '--username ${auth_player_name}' }), false)
  assert.equal(supportsQuickPlay(null), false)
})
