import React from 'react'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  variant?: 'default' | 'live' | 'cache' | 'warn'
}

export const Chip: React.FC<ChipProps> = ({
  variant = 'default',
  active = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <button
      type="button"
      className={`ui-chip ui-chip-${variant} ${active ? 'is-active' : ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
