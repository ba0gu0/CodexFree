import type { ReactElement, ReactNode } from 'react'

interface PageHeaderProps {
  actions?: ReactNode
  description: string
  title: string
}

export function PageHeader({ actions, description, title }: PageHeaderProps): ReactElement {
  return (
    <header className="grid min-h-[76px] shrink-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1.5 self-end pb-1">
        <h1 className="font-semibold text-2xl tracking-normal">{title}</h1>
        <p className="text-muted-foreground text-sm leading-5">{description}</p>
      </div>
      {actions ? (
        <div className="flex max-w-full flex-nowrap items-center justify-end gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
