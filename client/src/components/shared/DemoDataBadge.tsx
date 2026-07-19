// Visible marker for panels that render illustrative/hardcoded values.
// Any panel showing fabricated numbers behind production-looking controls MUST
// carry this badge until it is wired to real backend data (audit finding 10).
export function DemoDataBadge({ note }: { note?: string }) {
  return (
    <span
      title={note ?? 'The values in this panel are illustrative and not live account data.'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 10px',
        borderRadius: '9999px',
        border: '1px solid rgba(245, 158, 11, 0.5)',
        background: 'rgba(245, 158, 11, 0.12)',
        color: '#fbbf24',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: '#f59e0b',
        }}
      />
      Demo data
    </span>
  );
}
