import type { ReactElement, ReactNode } from 'react'

interface PageHeaderProps {
  actions?: ReactNode
  description: string
  title: string
}

export function PageHeader({ actions, description, title }: PageHeaderProps): ReactElement {
  return (
    <header className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex max-w-3xl flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-normal">{title}</h1>
        <p className="text-muted-foreground text-xs leading-4">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
