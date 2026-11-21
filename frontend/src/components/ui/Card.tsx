import React from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType
}

export const Card: React.FC<CardProps> = ({ as: Component = 'section', className = '', children, ...props }) => {
  return (
    <Component className={`ui-card ${className}`} {...props}>
      {children}
    </Component>
  )
}
