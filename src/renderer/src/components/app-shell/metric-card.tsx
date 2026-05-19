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
  label: string
  title?: string
  tone?: StatusTone
  value: string
}

export function MetricCard({
  detail,
  label,
  title,
  tone = 'default',
  value
}: MetricCardProps): ReactElement {
  return (
    <Card className="h-full min-h-[92px] min-w-0 overflow-hidden rounded-xl border-border/80 shadow-none">
      <CardHeader className="min-w-0 p-3 pb-1">
        <CardDescription className="truncate font-semibold text-xs">{label}</CardDescription>
        <CardTitle className="min-w-0 truncate text-xl leading-tight" title={title ?? value}>
          {value}
        </CardTitle>
        {detail ? (
          <CardDescription className="truncate font-semibold text-xs" title={detail}>
            {detail}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardPanel className="flex items-end p-3 pt-0">
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
