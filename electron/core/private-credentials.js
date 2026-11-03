import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONFIG_FILES = ['microsoft.json', 'microsoft-client.json', 'client.json']
const TEXT_FILES = ['microsoft-client-id.txt', 'client-id.txt', 'microsoft-client.txt']
const CLIENT_ID_KEYS = ['clientId', 'client_id', 'applicationId', 'application_id', 'appId', 'app_id']
const CLIENT_SECRET_KEYS = ['clientSecret', 'client_secret', 'secret']

/**
 * Where the launcher looks for its own Azure app credentials. This lives in the
 * main process only: the renderer never sees, sets, or stores them.
 */
export function privateDirectoryCandidates() {
  const candidates = []
  if (process.env.AQUA_PRIVATE_DIR) candidates.push(path.resolve(process.env.AQUA_PRIVATE_DIR))
  candidates.push(path.join(APP_ROOT, 'private'))
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'private'))
  return [...new Set(candidates)]
}

export function defaultPrivateDirectory() {
  return privateDirectoryCandidates()[0]
}

function readJsonCredential(file) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  let clientId = null
  for (const key of CLIENT_ID_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string' && GUID.test(value.trim())) {
      clientId = value.trim()
      break
    }
  }
  if (!clientId) return null
  let clientSecret = null
  for (const key of CLIENT_SECRET_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) {
      clientSecret = value.trim()
      break
    }
  }
  return { clientId, clientSecret, source: file }
}

function readTextCredential(file) {
  try {
    const match = fs
      .readFileSync(file, 'utf8')
      .match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
    return match ? { clientId: match[0], clientSecret: null, source: file } : null
  } catch {
    return null
  }
}

/**
 * Reads `private/microsoft.json` (or a plain client-id text file) on every call,
 * so credentials can be replaced without restarting the launcher. Missing or
 * malformed files return an empty result instead of throwing.
 */
export function readMicrosoftCredentials({ directory = null } = {}) {
  const candidates = directory ? [path.resolve(directory)] : privateDirectoryCandidates()
  for (const dir of candidates) {
    for (const name of CONFIG_FILES) {
      const found = readJsonCredential(path.join(dir, name))
      if (found) return { ...found, directory: dir }
    }
    for (const name of TEXT_FILES) {
      const found = readTextCredential(path.join(dir, name))
      if (found) return { ...found, directory: dir }
    }
  }
  return { clientId: null, clientSecret: null, source: null, directory: candidates[0] }
}

/** The user-facing sentence shown when the app credential is missing. */
export function describeMissingCredentials(credentials) {
  const file = path.join(credentials.directory, 'microsoft.json')
  return `Microsoft sign-in is not configured for this build. Add the Azure application credentials to ${file} as {"clientId": "<application-id>", "clientSecret": "<optional>"}.`
}
