import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  ChevronDown,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  HardDriveDownload,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { formatBytes, relativeTime } from '../../lib/format'
import { useLauncher } from '../../state/LauncherProvider'
import type { BedrockCatalogEntry } from '../../lib/types'
import { Badge, Button, CopyButton, EmptyState, ProgressBar, Spinner } from '../ui/primitives'
import { InstallBedrockDialog } from './InstallBedrockDialog'
import { RegisterBedrockDialog } from './RegisterBedrockDialog'

type ChannelFilter = 'release' | 'beta' | 'all'

const CHANNEL_LABEL: Record<BedrockCatalogEntry['channel'], string> = {
  release: 'Release',
  beta: 'Beta',
  preview: 'Preview',
}

const PAGE_SIZE = 40

/** Windows reports install locations with a trailing separator; downloaded folders have none. */
function sameFolder(a: string, b: string) {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}

function channelTone(channel: BedrockCatalogEntry['channel']) {
  if (channel === 'beta') return 'beta' as const
  if (channel === 'preview') return 'snapshot' as const
  return 'success' as const
}

/**
 * Bedrock builds published to the Store: the catalog holds Microsoft's own
 * package links, and choosing one downloads it into the launcher's folder.
 */
export function BedrockVersionsPanel() {
  const {
    bedrock,
    refreshBedrock,
    bedrockVersions,
    bedrockVersionsLoading,
    bedrockVersionsError,
    bedrockLibrary,
    bedrockDownloads,
    pushToast,
    refreshBedrockVersions,
    downloadBedrockVersion,
    cancelBedrockVersion,
    removeBedrockVersion,
    openBedrockVersionFolder,
    registerBedrockVersion,
    installBedrockVersion,
  } = useLauncher()
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('release')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [registerTarget, setRegisterTarget] = useState<string | null>(null)
  const [installTarget, setInstallTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!bedrockVersions) void refreshBedrockVersions(false)
  }, [bedrockVersions, refreshBedrockVersions])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, channel])

  const library = useMemo(() => new Map(bedrockLibrary.map((entry) => [entry.version, entry])), [bedrockLibrary])
  const installedEdition = bedrock?.editions[0] ?? null
  const isInstalled = (version: string) => Boolean(installedEdition?.version) && installedEdition?.version === version
  // A registered build also sits in the download folder: it is one thing, not two.
  const registeredFolders = useMemo(
    () => (bedrock?.editions || []).map((edition) => edition.installLocation || ''),
    [bedrock],
  )
  const isRegistered = (directory: string) =>
    Boolean(directory) && registeredFolders.some((location) => sameFolder(location, directory))

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (bedrockVersions?.versions || []).filter((entry) => {
      if (channel === 'release' && entry.channel !== 'release') return false
      if (channel === 'beta' && entry.channel === 'release') return false
      if (!normalized) return true
      return entry.version.includes(normalized) || entry.channel.includes(normalized) || entry.package.includes(normalized)
    })
  }, [bedrockVersions, channel, query])

  const visible = filtered.slice(0, visibleCount)
  // Developer Mode only matters where Store editions exist at all.
  const needsDeveloperMode = Boolean(bedrock?.supported) && bedrock?.developerMode === false

  return (
    <div className="bedrock-versions">
      <div className="callout bedrock-notice">
        <div className="grow">
          <strong>Bedrock builds come from Microsoft&rsquo;s own package links.</strong>
          <div className="text-dim">
            Downloads land in the launcher&rsquo;s folder, so your Store copy stays untouched. Downloaded builds have
            their signature removed and are registered with Windows through an administrator prompt; the Microsoft Store
            may replace them when it updates Minecraft.
          </div>
        </div>
        {bedrockVersions?.fetchedAt ? <span className="text-dim">List synced {relativeTime(bedrockVersions.fetchedAt)}</span> : null}
      </div>

      {needsDeveloperMode ? (
        <div className="callout callout--warning">
          <ShieldAlert />
          <div className="grow">
            <strong>Windows Developer Mode is off.</strong>
            <div className="text-dim">
              Registering a downloaded build needs Developer Mode. Turn it on under Settings → System → For developers,
              then register the build again.
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void api.openExternal('ms-settings:developers').catch(() => {
                pushToast({
                  level: 'info',
                  title: 'Windows Settings could not be opened',
                  message: 'Turn on Developer Mode under Settings → System → For developers.',
                })
              })
            }}
          >
            Open Windows Settings
          </Button>
        </div>
      ) : null}

      <RegisterBedrockDialog
        version={registerTarget}
        onCancel={() => setRegisterTarget(null)}
        onConfirm={(options) => {
          const version = registerTarget
          setRegisterTarget(null)
          if (version) void registerBedrockVersion(version, options)
        }}
      />

      <InstallBedrockDialog
        version={installTarget}
        installedVersion={installedEdition?.version || null}
        onCancel={() => setInstallTarget(null)}
        onConfirm={() => {
          const version = installTarget
          setInstallTarget(null)
          if (version) void installBedrockVersion(version)
        }}
      />

      <div className="version-browser panel">
        <div className="version-browser__toolbar">
          <div className="search-input">
            <Search />
            <input
              className="input"
              placeholder="Search Bedrock versions, e.g. 1.21.114 or 1.26"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search Bedrock versions"
            />
          </div>
          <div className="segmented" role="tablist" aria-label="Bedrock channel filter">
            {(
              [
                ['release', 'Releases'],
                ['beta', 'Beta & Preview'],
                ['all', 'All builds'],
              ] as Array<[ChannelFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={channel === value}
                className={channel === value ? 'is-active' : undefined}
                onClick={() => setChannel(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="version-browser__count">{filtered.length.toLocaleString()} builds</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw className={bedrockVersionsLoading ? 'spin' : undefined} />}
            onClick={() => void refreshBedrockVersions(true)}
            disabled={bedrockVersionsLoading}
          >
            Refresh list
          </Button>
        </div>

        {bedrockVersionsError ? (
          <div className="callout callout--warning versions-cache-warning">
            <div className="grow">{bedrockVersionsError}</div>
            <Button size="sm" variant="ghost" onClick={() => void refreshBedrockVersions(true)} loading={bedrockVersionsLoading}>
              Retry
            </Button>
          </div>
        ) : null}

        {installedEdition ? (
          <div className="bedrock-registered">
            <div className="grow">
              <span className="bedrock-registered__label">Registered with Windows</span>
              <span className="bedrock-registered__value">
                {installedEdition.name} {installedEdition.version || installedEdition.packageVersion}
              </span>
              {installedEdition.status && installedEdition.status !== 'Ok' ? (
                <Badge tone="warning">{installedEdition.status}</Badge>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => void refreshBedrock(true)}>
              Re-check
            </Button>
          </div>
        ) : null}

        {bedrockLibrary.length ? (
          <section className="bedrock-downloads bedrock-downloads--inline">
            <div className="panel-head">
              <div>
                <h2 className="panel-head__title">Downloaded builds</h2>
                <p className="panel-head__subtitle">
                  Unpacked in the launcher&rsquo;s own folder. Registering one makes Windows run that build instead of the
                  Store copy.
                </p>
              </div>
            </div>
            {bedrockLibrary.map((entry) => {
              const linked = isRegistered(entry.directory)
              return (
                <div className="bedrock-download-row" key={entry.version}>
                  <div className="grow">
                    <span className="bedrock-download-row__version">
                      Bedrock {entry.version}
                      {linked ? <span className="bedrock-download-row__flag">Registered</span> : null}
                    </span>
                    <span className="bedrock-download-row__meta">
                      {formatBytes(entry.sizeBytes)}
                      {linked
                        ? ' · this folder is the installed Minecraft'
                        : entry.layout === 'appx'
                          ? ' · ready to register'
                          : isInstalled(entry.version)
                            ? ' · installed through Windows'
                            : ' · Store package, ready to install'}
                    </span>
                  </div>
                  {entry.layout === 'appx' ? (
                    linked ? null : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<CheckCircle2 />}
                        onClick={() => setRegisterTarget(entry.version)}
                      >
                        Register build
                      </Button>
                    )
                  ) : isInstalled(entry.version) ? null : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<HardDrive />}
                      onClick={() => setInstallTarget(entry.version)}
                    >
                      Install build
                    </Button>
                  )}
                  <Button size="sm" icon={<FolderOpen />} onClick={() => void openBedrockVersionFolder(entry.version)}>
                    Open folder
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 />}
                    disabled={linked}
                    title={linked ? 'Windows is running this build. Uninstall it in Windows Settings first.' : undefined}
                    onClick={() => void removeBedrockVersion(entry.version)}
                  >
                    Remove
                  </Button>
                </div>
              )
            })}
          </section>
        ) : null}

        {!bedrockVersions && bedrockVersionsLoading ? (
          <div className="bedrock-rows">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="bedrock-row bedrock-row--skeleton">
                <div className="skeleton" style={{ width: 120, height: 14 }} />
                <div className="skeleton" style={{ width: 80, height: 20 }} />
                <div className="skeleton" style={{ width: 100, height: 14 }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No builds found"
            description="Try a different search term or switch the channel filter."
          >
            <Button
              onClick={() => {
                setQuery('')
                setChannel('all')
              }}
            >
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          <>
            <div className="bedrock-rows" role="list">
              {visible.map((entry) => {
                const progress = bedrockDownloads[entry.version] ?? null
                const downloaded = library.get(entry.version) ?? null
                const linked = downloaded ? isRegistered(downloaded.directory) : false
                const busy = progress && progress.phase !== 'done' && progress.phase !== 'error' && progress.phase !== 'cancelled'
                const percent =
                  progress && progress.totalBytes
                    ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
                    : progress?.phase === 'downloading'
                      ? null
                      : 0

                return (
                  <div key={entry.version} className="bedrock-row" role="listitem">
                    <div className="bedrock-row__main">
                      <span className="bedrock-row__version">Bedrock {entry.version}</span>
                      <span className="bedrock-row__badges">
                        <Badge tone={channelTone(entry.channel)}>{CHANNEL_LABEL[entry.channel]}</Badge>
                        <Badge tone="default">{entry.package === 'appx' ? 'APPX' : 'MSIXVC'}</Badge>
                        {downloaded ? (
                          <Badge tone="success">
                            {downloaded.layout === 'appx' ? 'Downloaded' : 'Saved'}
                          </Badge>
                        ) : null}
                        {linked ? <Badge tone="success">Registered</Badge> : null}
                      </span>
                      <span className="bedrock-row__meta text-dim">
                        {busy && progress ? (
                          <>
                            {progress.phase === 'resolving'
                              ? 'Finding the package…'
                              : progress.phase === 'extracting'
                                ? 'Unpacking the build…'
                                : progress.phase === 'installing'
                                  ? 'Windows is installing the build…'
                                  : `${formatBytes(progress.receivedBytes)}${progress.totalBytes ? ` of ${formatBytes(progress.totalBytes)}` : ''}`}
                          </>
                        ) : downloaded ? (
                          <>
                            <span>{formatBytes(downloaded.sizeBytes)} on disk</span>
                            <span className="text-dim">·</span>
                            <span className="bedrock-row__path" title={downloaded.directory}>
                              {downloaded.directory}
                            </span>
                          </>
                        ) : entry.package === 'appx' ? (
                          <>
                            <Clock /> Unpacks into the launcher folder and registers on request
                          </>
                        ) : (
                          <>
                            <Clock /> Store package — installing hands it to Windows, which replaces the current copy
                          </>
                        )}
                      </span>
                      {busy && progress ? (
                        <div className="bedrock-row__progress">
                          <ProgressBar value={percent} thin label={`Bedrock ${entry.version} download progress`} />
                        </div>
                      ) : null}
                      {progress?.phase === 'error' && progress.error ? (
                        <div className="bedrock-row__error">{progress.error}</div>
                      ) : null}
                      {progress?.phase === 'cancelled' ? (
                        <div className="bedrock-row__error text-dim">The download was cancelled.</div>
                      ) : null}
                    </div>

                    <div className="bedrock-row__actions">
                      {busy ? (
                        <Button size="sm" variant="ghost" icon={<X />} onClick={() => void cancelBedrockVersion(entry.version)}>
                          Cancel
                        </Button>
                      ) : downloaded ? (
                        <>
                          {downloaded.layout === 'appx' ? (
                            linked ? null : (
                              <Button
                                size="sm"
                                variant="primary"
                                icon={<BadgeCheck />}
                                onClick={() => setRegisterTarget(entry.version)}
                              >
                                Register build
                              </Button>
                            )
                          ) : isInstalled(entry.version) ? null : (
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<HardDrive />}
                              onClick={() => setInstallTarget(entry.version)}
                            >
                              Install build
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<FolderOpen />}
                            onClick={() => void openBedrockVersionFolder(entry.version)}
                          >
                            Open folder
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 />}
                            disabled={linked}
                            title={linked ? 'Windows is running this build. Uninstall it in Windows Settings first.' : undefined}
                            onClick={() => void removeBedrockVersion(entry.version)}
                          >
                            Remove
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<Download />}
                          onClick={() => void downloadBedrockVersion(entry.version)}
                        >
                          Download
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {visible.length < filtered.length ? (
              <div className="version-browser__more">
                <Button
                  variant="ghost"
                  icon={bedrockVersionsLoading ? <Spinner /> : <ChevronDown />}
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                  loading={bedrockVersionsLoading}
                >
                  Show more builds ({filtered.length - visible.length} remaining)
                </Button>
              </div>
            ) : null}
          </>
        )}

        <div className="version-browser__footer">
          <span>
            Version lists: ddf8196/mc-w10-versiondb-auto-update and MinecraftBedrockArchiver/GdkLinks. Packages download
            straight from Microsoft&rsquo;s delivery service.
          </span>
          {bedrockLibrary.length ? (
            <CopyButton
              value={bedrockLibrary.map((entry) => `${entry.version} (${entry.layout}) — ${entry.directory}`).join('\n')}
              label="Copy downloaded builds"
            />
          ) : (
            <span className="text-dim">
              <HardDriveDownload /> No extra builds downloaded yet
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
