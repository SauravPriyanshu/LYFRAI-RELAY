import React from 'react'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
  radius?: string | number
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  radius,
  className = '',
  style,
  ...props
}) => {
  return (
    <div
      className={`ui-skeleton ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  )
}
