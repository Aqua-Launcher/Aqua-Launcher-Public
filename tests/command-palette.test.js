import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorldsService } from '../electron/core/worlds.js'
import { fuzzyScore, searchCommandGroups, searchCommands } from '../src/lib/commandPalette.ts'

function command(index, group, label) {
  return { id: `${group}-${index}`, group, label }
}

test('fuzzy search ranks exact and word-boundary matches first', () => {
  const commands = [
    command(1, 'Worlds', 'Survival'),
    command(2, 'Worlds', 'Survival Island'),
    command(3, 'Pages', 'Server settings'),
    command(4, 'Content', 'A long description with scattered letters'),
  ]
  const groups = searchCommandGroups(commands, 'surv')
  assert.equal(groups[0].items[0].label, 'Survival')
  assert.equal(groups[0].items[1].label, 'Survival Island')
  assert.ok((fuzzyScore('surv', 'Survival') ?? 0) > 0)
  assert.equal(fuzzyScore('xyz', 'Survival'), null)
})

test('searching 100+ installations and 1,000 worlds stays bounded and fast', () => {
  const commands = []
  for (let index = 0; index < 120; index += 1) {
    commands.push(command(index, 'Installations', `Installation ${index}`))
  }
  for (let index = 0; index < 1000; index += 1) {
    commands.push(command(index, 'Worlds', index === 612 ? 'Survival' : `World ${index}`))
  }

  const started = Date.now()
  const groups = searchCommandGroups(commands, 'surv', 80)
  const elapsed = Date.now() - started
  const flattened = groups.flatMap((group) => group.items)
  assert.equal(groups[0].group, 'Worlds')
  assert.equal(groups[0].items[0].label, 'Survival')
  assert.ok(flattened.length <= 80)
  assert.ok(elapsed < 500, `search took ${elapsed}ms`)
  assert.equal(searchCommands(commands, 'surv', 80).length, 1)
})

test('the world index scans every installation without sizes or backups', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aqua-command-worlds-'))
  const installations = [
    { id: 'one', name: 'First profile', gameDir: path.join(root, 'one') },
    { id: 'two', name: 'Second profile', gameDir: path.join(root, 'two') },
  ]
  for (const installation of installations) {
    await fsp.mkdir(path.join(installation.gameDir, 'saves', 'Survival'), { recursive: true })
  }
  await fsp.writeFile(path.join(installations[1].gameDir, 'saves', 'readme.txt'), 'not a world')

  const service = new WorldsService({
    paths: { backupsRoot: path.join(root, 'backups') },
    store: { installations },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  })
  const worlds = await service.searchIndex()
  assert.equal(worlds.length, 2)
  assert.deepEqual(
    worlds.map((world) => `${world.installationName}/${world.folder}/${world.name}/${world.gameMode}`).sort(),
    ['First profile/Survival/Survival/survival', 'Second profile/Survival/Survival/survival'],
  )
})