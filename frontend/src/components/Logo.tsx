interface LogoProps {
  size?: number
  variant?: 'mark' | 'wordmark'
  className?: string
}

export default function Logo({ size = 32, variant = 'mark', className = '' }: LogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="logo-mark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="relay-g" x1="3" y1="2" x2="29" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7c3aed" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#relay-g)" />
      <path
        d="M8.5 21.5h4.5a3.5 3.5 0 0 0 3.5-3.5v-3a3.5 3.5 0 0 1 3.5-3.5h3.5"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="8.5" cy="21.5" r="2.3" fill="#fff" />
      <circle cx="23.5" cy="11.5" r="2.3" fill="#12111a" stroke="#fff" strokeWidth="1.8" />
    </svg>
  )

  if (variant === 'wordmark') {
    return (
      <div className={`logo-wordmark ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {mark}
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: Math.max(18, Math.round(size * 0.65)),
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
            lineHeight: 1,
          }}
        >
          Relay
        </span>
      </div>
    )
  }

  return (
    <div className={`logo-wrap ${className}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {mark}
    </div>
  )
}
