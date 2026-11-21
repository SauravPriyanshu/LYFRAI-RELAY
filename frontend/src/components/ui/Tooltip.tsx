import React from 'react'

export interface TooltipProps {
  content: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement
}

export const Tooltip: React.FC<TooltipProps> = ({ content, position = 'top', children }) => {
  return (
    <span
      className={`ui-tooltip ui-tooltip-${position}`}
      data-tooltip={content}
      role="tooltip"
      aria-label={content}
      title={content}
    >
      {children}
    </span>
  )
}
