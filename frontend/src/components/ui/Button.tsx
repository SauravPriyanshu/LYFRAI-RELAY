import React, { forwardRef } from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`}
        {...props}
      >
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
