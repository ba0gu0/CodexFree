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
    <Card className="min-h-24 min-w-0 overflow-hidden rounded-xl border-border/80 shadow-none">
      <CardHeader className="min-w-0 p-4 pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="min-w-0 truncate text-2xl leading-tight" title={title ?? value}>
          {value}
        </CardTitle>
        {detail ? (
          <CardDescription className="truncate font-semibold" title={detail}>
            {detail}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardPanel className="p-4 pt-0">
        <div className={cn('ml-auto h-2.5 w-10 rounded-full bg-muted', toneClassName(tone))} />
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
