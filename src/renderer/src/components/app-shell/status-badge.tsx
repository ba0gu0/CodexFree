import { Badge } from '@renderer/components/ui/badge'
import type { ReactElement, ReactNode } from 'react'

export type StatusTone = 'default' | 'success' | 'warning' | 'error' | 'info'

interface StatusBadgeProps {
  children: ReactNode
  tone?: StatusTone
}

export function StatusBadge({ children, tone = 'default' }: StatusBadgeProps): ReactElement {
  const variant = tone === 'default' ? 'outline' : tone
  return <Badge variant={variant}>{children}</Badge>
}
