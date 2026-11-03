import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { NotificationService, normalizeNotification } from '../electron/core/notifications.js'

function fakeStore(overrides = {}) {
  const notifications = []
  return {
    notifications,
    settings: {
      notifications: {
        enabled: true,
        native: true,
        levels: { success: true, info: true, warning: true, error: true },
      },
    },
    async addNotification(entry) {
      const saved = { ...entry, id: entry.id || `n-${notifications.length + 1}` }
      notifications.unshift(saved)
      this.notifications = notifications
      return saved
    },
    ...overrides,
  }
}

test('notifications are normalized and unsafe action fields are dropped', () => {
  const notification = normalizeNotification({
    level: 'warning',
    title: '  Check this  ',
    message: '  Details  ',
    action: { page: 'logs', params: { category: 'crash', file: 'crash.txt', bad: 'x' } },
  })
  assert.equal(notification.level, 'warning')
  assert.equal(notification.title, 'Check this')
  assert.equal(notification.message, 'Details')
  assert.equal(notification.read, false)
  assert.deepEqual(notification.action, { page: 'logs', params: { category: 'crash', file: 'crash.txt' } })
  assert.equal(normalizeNotification({ title: '' }), null)
  assert.equal(normalizeNotification({ level: 'loud', title: 'Fallback' }).level, 'info')
})

test('one dedupe key produces one persisted entry and one broadcast', async () => {
  const store = fakeStore()
  const broadcasts = []
  const service = new NotificationService({
    store,
    broadcast: (...args) => broadcasts.push(args),
  })
  const first = await service.notify({
    level: 'success',
    title: 'Installation complete',
    message: 'Ready',
    dedupeKey: 'job:1:completed',
  })
  const second = await service.notify({
    level: 'success',
    title: 'Installation complete',
    message: 'Ready',
    dedupeKey: 'job:1:completed',
  })
  assert.ok(first)
  assert.equal(second, null)
  assert.equal(store.notifications.length, 1)
  assert.equal(broadcasts.filter(([type]) => type === 'notification').length, 1)
})

test('disabled notifications and disabled levels are skipped', async () => {
  const disabled = fakeStore()
  disabled.settings.notifications.enabled = false
  const service = new NotificationService({ store: disabled })
  await service.notify({ level: 'error', title: 'Nope' })
  assert.equal(disabled.notifications.length, 0)

  const levelOff = fakeStore()
  levelOff.settings.notifications.levels.success = false
  const levelService = new NotificationService({ store: levelOff })
  await levelService.notify({ level: 'success', title: 'Routine' })
  await levelService.notify({ level: 'error', title: 'Important' })
  assert.deepEqual(levelOff.notifications.map((entry) => entry.title), ['Important'])
})

test('native notifications require the setting and an inactive window', async () => {
  const store = fakeStore()
  const native = []
  const service = new NotificationService({
    store,
    isWindowActive: () => false,
    showNative: (entry) => native.push(entry),
  })
  await service.notify({ level: 'info', title: 'While away' })
  assert.equal(native.length, 1)

  store.settings.notifications.native = false
  await service.notify({ level: 'info', title: 'Center only' })
  assert.equal(native.length, 1)

  store.settings.notifications.native = true
  const activeService = new NotificationService({
    store,
    isWindowActive: () => true,
    showNative: (entry) => native.push(entry),
  })
  await activeService.notify({ level: 'info', title: 'Visible window' })
  assert.equal(native.length, 1)
})

test('notification persistence keeps unread state and clearing leaves diagnostics alone', async () => {
  const { Store } = await import('../electron/core/store.js')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aqua-notifications-'))
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
    for (let index = 0; index < 55; index += 1) {
      await store.addNotification({ level: 'info', title: `Entry ${index}` })
    }
    assert.equal(store.notifications.length, 50)
    assert.equal(store.notifications[0].title, 'Entry 54')

    await store.markNotificationsRead([store.notifications[0].id])
    assert.equal(store.notifications[0].read, true)

    const afterRead = new Store(options)
    await afterRead.init()
    assert.equal(afterRead.notifications[0].read, true)
    await afterRead.addCrash({
      category: 'crash',
      title: 'Test crash',
      summary: 'A crash for the diagnostics test',
      at: new Date().toISOString(),
    })
    await afterRead.clearNotifications()
    assert.deepEqual(afterRead.notifications, [])
    assert.equal(afterRead.crashes.length, 1)

    const reloaded = new Store(options)
    await reloaded.init()
    assert.deepEqual(reloaded.notifications, [])
    assert.equal(reloaded.crashes.length, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
