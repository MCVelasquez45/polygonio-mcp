type HealthMode = 'LIVE' | 'DEGRADED' | 'BACKFILLING' | 'FROZEN';

type Props = {
  mode: HealthMode;
  lastUpdateMsAgo: number | null;
  gapsDetected?: number;
  providerThrottled?: boolean;
  compact?: boolean;
};

function getModeConfig(mode: HealthMode) {
  switch (mode) {
    case 'LIVE':
      return {
        color: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.15)',
        borderColor: 'rgba(16, 185, 129, 0.4)',
        label: 'LIVE',
        icon: '●',
        animate: true
      };
    case 'DEGRADED':
      return {
        color: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.15)',
        borderColor: 'rgba(245, 158, 11, 0.4)',
        label: 'DEGRADED',
        icon: '◐',
        animate: false
      };
    case 'BACKFILLING':
      return {
        color: '#3b82f6',
        bgColor: 'rgba(59, 130, 246, 0.15)',
        borderColor: 'rgba(59, 130, 246, 0.4)',
        label: 'SYNCING',
        icon: '⟳',
        animate: true
      };
    case 'FROZEN':
      return {
        color: '#6b7280',
        bgColor: 'rgba(107, 114, 128, 0.15)',
        borderColor: 'rgba(107, 114, 128, 0.4)',
        label: 'CLOSED',
        icon: '◯',
        animate: false
      };
    default:
      return {
        color: '#9ca3af',
        bgColor: 'rgba(156, 163, 175, 0.15)',
        borderColor: 'rgba(156, 163, 175, 0.4)',
        label: 'UNKNOWN',
        icon: '?',
        animate: false
      };
  }
}

function formatMsAgo(ms: number | null): string {
  if (ms == null) return 'N/A';
  if (ms < 1000) return 'Just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export function HealthBadge({ mode, lastUpdateMsAgo, gapsDetected = 0, providerThrottled = false, compact = false }: Props) {
  const config = getModeConfig(mode);

  const tooltipParts = [
    `Status: ${mode}`,
    `Last update: ${formatMsAgo(lastUpdateMsAgo)}`
  ];
  if (gapsDetected > 0) tooltipParts.push(`Gaps: ${gapsDetected}`);
  if (providerThrottled) tooltipParts.push('⚠️ Provider throttled');

  const tooltipText = tooltipParts.join(' | ');

  return (
    <div
      className={`health-badge ${compact ? 'compact' : ''}`}
      title={tooltipText}
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.borderColor,
        color: config.color
      }}
    >
      <span className={`badge-icon ${config.animate ? 'animate' : ''}`}>
        {config.icon}
      </span>
      {!compact && (
        <>
          <span className="badge-label">{config.label}</span>
          {gapsDetected > 0 && (
            <span className="badge-warning" title={`${gapsDetected} gaps detected`}>
              ⚠️
            </span>
          )}
        </>
      )}

      <style>{`
        .health-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.25rem 0.6rem;
          border-radius: 9999px;
          border: 1px solid;
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }

        .health-badge.compact {
          padding: 0.2rem 0.4rem;
          font-size: 0.65rem;
        }

        .badge-icon {
          font-size: 0.6rem;
        }

        .badge-icon.animate {
          animation: pulse 1.5s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .badge-label {
          text-transform: uppercase;
        }

        .badge-warning {
          font-size: 0.7rem;
          margin-left: 0.1rem;
        }
      `}</style>
    </div>
  );
}
