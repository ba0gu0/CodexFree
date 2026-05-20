import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle
} from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'
import type { ReactElement } from 'react'
import { StatusBadge, type StatusTone } from './status-badge'

interface MetricCardProps {
  detail?: string
  density?: 'default' | 'compact'
  label: string
  title?: string
  tone?: StatusTone
  value: string
}

export function MetricCard({
  detail,
  density = 'default',
  label,
  title,
  tone = 'default',
  value
}: MetricCardProps): ReactElement {
  const compact = density === 'compact'

  return (
    <Card
      className={cn(
        'flex h-full min-w-0 flex-col overflow-hidden rounded-xl border-border/80 shadow-none',
        compact ? 'min-h-[76px]' : 'min-h-[92px]'
      )}
    >
      <CardHeader className={cn('min-w-0 p-3', compact ? 'pb-0' : 'pb-1')}>
        <CardDescription className="truncate font-semibold text-xs">{label}</CardDescription>
        <CardTitle
          className={cn('min-w-0 truncate leading-tight', compact ? 'text-lg' : 'text-xl')}
          title={title ?? value}
        >
          {value}
        </CardTitle>
        {detail ? (
          <CardDescription className="truncate font-semibold text-xs" title={detail}>
            {detail}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardPanel className={cn('mt-auto flex items-end p-3 pt-0', compact ? 'pb-2' : '')}>
        <div className={cn('ml-auto h-1.5 w-9 rounded-full bg-muted', toneClassName(tone))} />
      </CardPanel>
    </Card>
  )
}

function toneClassName(tone: StatusTone): string {
  if (tone === 'success') {
    return 'bg-success'
  }
  if (tone === 'warning') {
    return 'bg-warning'
  }
  if (tone === 'error') {
    return 'bg-destructive'
  }
  if (tone === 'info') {
    return 'bg-info'
  }
  return 'bg-muted'
}

export function InlineMetric({ label, value, tone }: MetricCardProps): ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <StatusBadge tone={tone}>{value}</StatusBadge>
    </div>
  )
}
