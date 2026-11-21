import React, { forwardRef } from 'react'

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'secondary' | 'primary'
  label?: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', label, className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`ui-icon-btn ui-icon-btn-${variant} ${className}`}
        aria-label={label || props['aria-label']}
        title={props.title || label || props['aria-label']}
        {...props}
      >
        {children}
      </button>
    )
  },
)

IconButton.displayName = 'IconButton'
