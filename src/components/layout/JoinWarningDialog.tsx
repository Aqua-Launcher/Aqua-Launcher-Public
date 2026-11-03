import { AlertTriangle, ArrowRight, Server } from 'lucide-react'
import { useLauncher } from '../../state/LauncherProvider'
import { Button } from '../ui/primitives'
import { Modal } from '../ui/overlays'

export function JoinWarningDialog() {
  const { joinWarning, confirmJoin, dismissJoinWarning } = useLauncher()
  const hasVersions = Boolean(joinWarning?.serverVersion || joinWarning?.instanceVersion)

  return (
    <Modal
      open={joinWarning !== null}
      onClose={dismissJoinWarning}
      title="Check before joining"
      subtitle={
        joinWarning
          ? `${joinWarning.serverName} will open with ${joinWarning.installationName}.`
          : undefined
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={dismissJoinWarning}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirmJoin()}>
            Join anyway
          </Button>
        </>
      }
    >
      {joinWarning ? (
        <div className="join-warning">
          <div className="join-warning__server">
            <span className="join-warning__icon">
              <Server />
            </span>
            <span className="join-warning__identity">
              <strong>{joinWarning.serverName}</strong>
              <span className="mono">{joinWarning.address}</span>
            </span>
          </div>

          {hasVersions ? (
            <div className="join-warning__versions">
              <div>
                <span>Server reports</span>
                <strong>{joinWarning.serverVersion || 'Unknown'}</strong>
              </div>
              <ArrowRight />
              <div>
                <span>Profile runs</span>
                <strong>{joinWarning.instanceVersion || 'Unknown'}</strong>
              </div>
            </div>
          ) : null}

          <ul className="join-warning__issues">
            {joinWarning.issues.map((issue) => (
              <li key={`${issue.code}-${issue.title}`}>
                <AlertTriangle />
                <span>
                  <strong>{issue.title}</strong>
                  {issue.detail}
                </span>
              </li>
            ))}
          </ul>

          <p className="join-warning__hint">
            You can change the profile from Edit server. This warning will appear again the next time you join.
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
