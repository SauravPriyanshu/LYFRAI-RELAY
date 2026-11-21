import { Button } from './ui'

interface Props {
  onDismiss: () => void
}

export default function WakingServerBanner({ onDismiss }: Props) {
  return (
    <div className="waking-banner" role="status" aria-live="polite">
      <div className="waking-content">
        <span className="waking-text">
          Waking up the server. Free hosting sleeps when idle, this can take about a minute.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss waking server banner"
          className="waking-dismiss"
        >
          Close
        </Button>
      </div>
    </div>
  )
}
