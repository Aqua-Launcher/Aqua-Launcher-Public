import { randomId } from './util.js'

const LEVELS = new Set(['success', 'info', 'warning', 'error'])
const PAGES = new Set([
  'home',
  'installations',
  'tasks',
  'worlds',
  'screenshots',
  'servers',
  'stats',
  'mods',
  'account',
  'logs',
  'docs',
  'settings',
])
const ACTION_PARAMS = new Set(['category', 'installationId', 'file', 'contentType', 'section', 'action'])

export function notificationAllowed(settings, level) {
  const preferences = settings?.notifications
  if (!preferences) return true
  if (preferences.enabled === false) return false
  if (preferences.levels && preferences.levels[level] === false) return false
  return true
}

/** Persist only the fields the notification center understands. */
export function normalizeNotification(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim()) return null
  const level = LEVELS.has(raw.level) ? raw.level : 'info'
  const at =
    typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString()
  let action = null
  if (raw.action && typeof raw.action === 'object' && PAGES.has(raw.action.page)) {
    const params = {}
    if (raw.action.params && typeof raw.action.params === 'object' && !Array.isArray(raw.action.params)) {
      for (const key of ACTION_PARAMS) {
        const value = raw.action.params[key]
        if (typeof value === 'string' && value) params[key] = value.slice(0, 300)
      }
    }
    action = {
      page: raw.action.page,
      ...(Object.keys(params).length ? { params } : {}),
      ...(typeof raw.action.label === 'string' && raw.action.label.trim()
        ? { label: raw.action.label.trim().slice(0, 60) }
        : {}),
    }
  }
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : randomId(),
    level,
    title: raw.title.trim().slice(0, 120),
    message: typeof raw.message === 'string' ? raw.message.trim().slice(0, 500) : '',
    at,
    read: Boolean(raw.read),
    action,
  }
}

/**
 * One delivery path for every existing notification call site. Persisting before
 * broadcasting means the bell and the toast always agree, and a dedupe key keeps
 * repeat reports for one job state out of the list.
 */
export class NotificationService {
  constructor({
    store,
    logger = null,
    broadcast = () => {},
    showNative = null,
    isWindowActive = () => false,
    now = () => new Date(),
  }) {
    this.store = store
    this.logger = logger
    this.broadcast = broadcast
    this.showNative = showNative
    this.isWindowActive = isWindowActive
    this.now = now
    this.seen = new Set()
  }

  async notify(input = {}) {
    const { dedupeKey = null, ...payload } = input || {}
    const notification = normalizeNotification({
      ...payload,
      at: payload.at || this.now().toISOString(),
    })
    if (!notification) return null
    const preferences = this.store.settings?.notifications
    if (!notificationAllowed(this.store.settings, notification.level)) return null
    if (dedupeKey && this.seen.has(dedupeKey)) return null
    if (dedupeKey) this.seen.add(dedupeKey)

    let saved
    try {
      saved = await this.store.addNotification(notification)
    } catch (error) {
      if (dedupeKey) this.seen.delete(dedupeKey)
      this.logger?.warn('Could not save a notification', { message: error.message })
      return null
    }
    if (!saved) return null

    this.broadcast('notification', {
      level: saved.level,
      title: saved.title,
      message: saved.message,
      action: saved.action,
    })
    this.broadcast('notifications', this.store.notifications)
    if (preferences?.native === true && !this.isWindowActive() && this.showNative) {
      try {
        this.showNative(saved)
      } catch (error) {
        this.logger?.warn('Could not show a native notification', { message: error.message })
      }
    }
    return saved
  }
}
