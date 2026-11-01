import { ConfirmDialog } from '../ui/overlays'

/**
 * GDK builds ship as encrypted Store packages, so Windows has to deploy them
 * rather than point at a folder. That replaces whichever Minecraft copy is
 * installed and, when switching between UWP and GDK builds, changes where worlds
 * and packs live — so the warning is the point of this dialog.
 */
export function InstallBedrockDialog({
  version,
  installedVersion,
  onCancel,
  onConfirm,
}: {
  version: string | null
  /** The build Windows is running now, if any. */
  installedVersion: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={version !== null}
      tone="primary"
      title={version ? `Install Bedrock ${version}?` : 'Install this build?'}
      description={
        <>
          {version} is a Store package (MSIXVC), so it cannot be registered the way the older builds are: Windows has to
          install it. It replaces{' '}
          {installedVersion ? `the copy you are running now (${installedVersion})` : 'your Minecraft for Windows copy'}{' '}
          for this account and takes a few minutes, with no administrator prompt.
          <br />
          <br />
          Back up your worlds first. Builds before 1.21.120 are UWP and keep their worlds under{' '}
          <code>%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe</code>; GDK builds use{' '}
          <code>%APPDATA%\Minecraft Bedrock\Users</code>, so switching between the two can leave the old worlds behind.
          <br />
          <br />
          To get the Store copy back afterwards, open the Microsoft Store, find Minecraft for Windows under Library, and
          install it again.
        </>
      }
      confirmLabel="Install build"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
