/**
 * Crash Guard: turns a failed Minecraft session into a classified explanation.
 *
 * The rules live in one table so a new signature is a data change, and every
 * action is declarative: the renderer maps an id onto a dialog or route that
 * already exists. No shell commands, no network calls, no automatic changes.
 */

export const CRASH_CATEGORIES = [
  'out-of-memory',
  'java-version',
  'missing-dependency',
  'mixin-failure',
  'graphics-driver',
  'mod-conflict',
  'corrupt-install',
  'unknown',
]

const ACTIONS = {
  'raise-ram': { id: 'raise-ram', label: 'Raise maximum RAM' },
  'open-logs': { id: 'open-logs', label: 'Open logs' },
  'open-content': { id: 'open-content', label: 'Review installed content' },
  'launch-safe': { id: 'launch-safe', label: 'Launch in Safe Mode' },
  'verify-install': { id: 'verify-install', label: 'Verify game files' },
  'open-settings': { id: 'open-settings', label: 'Open Java settings' },
}

const RULES = [
  {
    category: 'out-of-memory',
    title: 'Minecraft ran out of memory',
    confidence: 'high',
    actions: ['raise-ram', 'launch-safe', 'open-logs'],
    patterns: [
      /java\.lang\.OutOfMemoryError/i,
      /Java heap space/i,
      /GC overhead limit exceeded/i,
      /insufficient memory/i,
      /The system is out of memory/i,
      /Could not reserve enough space for .* object heap/i,
    ],
  },
  {
    category: 'java-version',
    title: 'Minecraft needs a different Java runtime',
    confidence: 'high',
    actions: ['open-settings', 'open-logs'],
    patterns: [
      /UnsupportedClassVersionError/i,
      /class file version \d+/i,
      /has been compiled by a more recent version/i,
      /requires (?:Java(?: SE)?|JDK) \d+/i,
      /Java \d+ is required/i,
    ],
  },
  {
    category: 'missing-dependency',
    title: 'A required mod or library is missing',
    confidence: 'high',
    actions: ['open-content', 'verify-install', 'open-logs'],
    patterns: [
      /java\.lang\.NoClassDefFoundError:\s*([^\s]+)/i,
      /java\.lang\.ClassNotFoundException:\s*([^\s]+)/i,
      /Missing or unsupported mandatory dependencies/i,
      /which is missing/i,
      /requires (?:any version of )?[\w-]+/i,
      /NoSuchMethodError/i,
    ],
  },
  {
    category: 'mixin-failure',
    title: 'A mod failed while patching the game',
    confidence: 'high',
    actions: ['launch-safe', 'open-content', 'open-logs'],
    patterns: [
      /Mixin apply failed/i,
      /MixinTransformerError/i,
      /InvalidInjectionException/i,
      /Mixin.*(?:failed|failure|error)/i,
      /Critical injection failure/i,
    ],
  },
  {
    category: 'graphics-driver',
    title: 'Minecraft could not create a graphics context',
    confidence: 'medium',
    actions: ['open-logs', 'verify-install'],
    patterns: [
      /GLFW error/i,
      /Pixel format not accelerated/i,
      /Failed to create window/i,
      /OpenGL/i,
      /WGL[:\s]/i,
      /EXCEPTION_ACCESS_VIOLATION.*(?:nvoglv|atio|igd|opengl|vulkan)/i,
    ],
  },
  {
    category: 'mod-conflict',
    title: 'Two installed mods disagree',
    confidence: 'high',
    actions: ['launch-safe', 'open-content', 'open-logs'],
    patterns: [
      /Duplicate mods/i,
      /Duplicate (?:mod|recipe|registry)/i,
      /Mod ([\w-]+) requires/i,
      /Incompatible mod set/i,
      /incompatible mods?/i,
      /mod resolution (?:encountered|failed)/i,
    ],
  },
  {
    category: 'corrupt-install',
    title: 'A game file is missing or damaged',
    confidence: 'high',
    actions: ['verify-install', 'open-logs'],
    patterns: [
      /java\.util\.zip\.ZipException/i,
      /invalid LOC header/i,
      /zip END header not found/i,
      /Could not find or load main class/i,
      /Unable to access jarfile/i,
      /Error: Invalid or corrupt jarfile/i,
    ],
  },
]

const SUMMARY_FOR = {
  'out-of-memory': (context) =>
    `The game ran out of memory with ${context.maxMb ? `${context.maxMb} MB` : 'its current allocation'} allocated. Raising the maximum RAM or removing heavy mods usually fixes it.`,
  'java-version': () =>
    'This Minecraft version needs a different Java runtime than the one Aqua selected. Choose the right major in Settings → Java.',
  'missing-dependency': (context) =>
    `A required mod or library is missing${context.subject ? ` (${context.subject})` : ''}. Install the dependency from Extra content and try again.`,
  'mixin-failure': () =>
    "A mod's mixin failed to apply. That usually means one mod is built for a different Minecraft version or loader.",
  'graphics-driver': () =>
    'Minecraft could not create a graphics context. Updating the graphics driver or turning shaders off usually helps.',
  'mod-conflict': (context) =>
    `Two installed mods disagree${context.subject ? ` (${context.subject})` : ''}. Safe Mode or removing one of them gets the game running again.`,
  'corrupt-install': () =>
    'A game file is missing or damaged. Verifying the installation replaces it without touching worlds or saves.',
  unknown: () => 'Minecraft exited unexpectedly. The evidence below is the last thing it reported.',
}

const ANSI = /\x1b\[[0-9;]*m/g
const EVIDENCE_LINE = /\b(?:exception|error|caused by|crash|failed|failure|outofmemory|mixin)\b/i

function cleanLine(line) {
  return String(line ?? '')
    .replace(ANSI, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findSubject(category, text) {
  if (category === 'missing-dependency') {
    const match =
      /NoClassDefFoundError:\s*([^\s]+)/i.exec(text) ||
      /ClassNotFoundException:\s*([^\s]+)/i.exec(text) ||
      /Missing or unsupported mandatory dependencies?:?\s*([^\n]+)/i.exec(text)
    if (!match) return null
    const raw = match[1].split(/[\s,;]/)[0].replace(/[/$]/g, '.').replace(/^\.+|\.+$/g, '')
    const simple = raw.split('.').filter(Boolean).pop()
    return simple ? simple.slice(0, 60) : null
  }
  if (category === 'mod-conflict') {
    const match = /Duplicate mods?:?\s*([^\n]+)/i.exec(text) || /Mod ([\w-]+) requires/i.exec(text)
    return match ? match[1].trim().replace(/[.,;:]+$/, '').slice(0, 60) : null
  }
  return null
}

function evidenceFrom(text, patterns) {
  const lines = text.split(/\r?\n/)
  const found = []
  for (const line of lines.slice(-1200)) {
    const cleaned = cleanLine(line)
    if (!cleaned || cleaned.length < 8) continue
    const relevant = patterns.some((pattern) => pattern.test(cleaned)) || EVIDENCE_LINE.test(cleaned)
    if (!relevant) continue
    if (found.includes(cleaned)) continue
    found.push(cleaned.slice(0, 300))
    if (found.length >= 5) break
  }
  return found
}

/**
 * Classifies a failed session. Returns null when nothing failed, so a clean
 * exit can never raise a crash dialog.
 */
export function analyzeCrash({
  text = '',
  exitCode = null,
  signal = null,
  memory = null,
  javaMajor = null,
  installedMods = [],
} = {}) {
  if ((exitCode == null || exitCode === 0) && signal == null) return null

  const source = String(text || '').slice(0, 512 * 1024)
  const scored = []
  for (const rule of RULES) {
    const hits = rule.patterns.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0)
    if (hits > 0) scored.push({ rule, hits })
  }
  scored.sort((a, b) => b.hits - a.hits)
  const winner = scored[0]

  const category = winner?.rule.category || 'unknown'
  const context = {
    subject: findSubject(category, source),
    maxMb: Number(memory?.maxMb) || null,
    javaMajor: Number(javaMajor) || null,
  }
  const confidence = winner ? (winner.hits >= 2 ? 'high' : 'medium') : 'low'
  const rule = winner?.rule
  const actions = (rule?.actions || ['open-logs', 'launch-safe']).map((id) => ACTIONS[id]).filter(Boolean)
  const evidence = evidenceFrom(source, rule?.patterns || [])

  return {
    category,
    confidence,
    title: rule?.title || (signal ? 'Minecraft was stopped unexpectedly' : 'Minecraft exited unexpectedly'),
    summary: SUMMARY_FOR[category](context),
    evidence,
    actions,
  }
}
