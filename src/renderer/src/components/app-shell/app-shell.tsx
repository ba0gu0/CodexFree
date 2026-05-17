import { Button } from '@renderer/components/ui/button'
import type { CopyKey, Locale } from '@renderer/i18n/copy'
import {
  ChartNoAxesColumnIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  ListFilterIcon,
  type LucideIcon,
  MonitorCogIcon,
  MoonIcon,
  NetworkIcon,
  SunIcon,
  UsersIcon
} from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

export type ViewId = 'dashboard' | 'accounts' | 'proxy' | 'requests' | 'usage'
export type ThemeMode = 'system' | 'light' | 'dark'

interface NavItem {
  icon: LucideIcon
  id: ViewId
  labelKey: CopyKey
}

interface AppShellProps {
  activeView: ViewId
  children: ReactNode
  locale: Locale
  onLocaleChange: (locale: Locale) => void
  onThemeCycle: () => void
  onViewChange: (view: ViewId) => void
  t: (key: CopyKey, values?: Record<string, string | number>) => string
  themeMode: ThemeMode
}

const navItems: NavItem[] = [
  { icon: LayoutDashboardIcon, id: 'dashboard', labelKey: 'nav.dashboard' },
  { icon: UsersIcon, id: 'accounts', labelKey: 'nav.accounts' },
  { icon: NetworkIcon, id: 'proxy', labelKey: 'nav.proxy' },
  { icon: ListFilterIcon, id: 'requests', labelKey: 'nav.requests' },
  { icon: ChartNoAxesColumnIcon, id: 'usage', labelKey: 'nav.usage' }
]

export function AppShell({
  activeView,
  children,
  locale,
  onLocaleChange,
  onThemeCycle,
  onViewChange,
  t,
  themeMode
}: AppShellProps): ReactElement {
  const themeIcon =
    themeMode === 'dark' ? MoonIcon : themeMode === 'light' ? SunIcon : MonitorCogIcon
  return (
    <div className="h-full min-w-[1160px] overflow-hidden bg-background text-foreground">
      <header className="app-drag-region flex h-14 items-center justify-between border-b border-border bg-popover pr-5 pl-[76px]">
        <div className="flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-lg bg-success text-success-foreground">
            <NetworkIcon className="size-3.5" />
          </div>
          <div className="font-bold text-lg">{t('app.name')}</div>
        </div>
        <nav className="app-no-drag flex items-center gap-2" aria-label={t('app.name')}>
          {navItems.map((item) => (
            <HeaderNavButton
              active={activeView === item.id}
              icon={item.icon}
              key={item.id}
              label={t(item.labelKey)}
              onClick={() => onViewChange(item.id)}
            />
          ))}
          <HeaderUtilityButton
            icon={LanguagesIcon}
            label={t(`locale.${locale}`)}
            onClick={() => onLocaleChange(locale === 'zh-CN' ? 'en' : 'zh-CN')}
          />
          <HeaderUtilityButton
            icon={themeIcon}
            label={t(`theme.${themeMode}`)}
            onClick={onThemeCycle}
          />
        </nav>
      </header>
      <main key={activeView} className="h-[calc(100%-56px)] min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}

function HeaderNavButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <Button
      className={[
        'h-11 w-16 flex-col rounded-2xl border shadow-none transition-colors',
        active
          ? 'border-success/15 bg-success/10 text-success hover:bg-success/10 dark:border-border dark:bg-accent dark:text-foreground dark:hover:bg-accent'
          : 'border-transparent bg-transparent text-muted-foreground hover:bg-success/5 hover:text-success dark:hover:bg-accent dark:hover:text-foreground'
      ].join(' ')}
      onClick={onClick}
      size="nav"
      variant="ghost"
    >
      <Icon />
      <span className="font-bold text-xs leading-none">{label}</span>
    </Button>
  )
}

function HeaderUtilityButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <Button
      className="h-11 w-16 flex-col rounded-2xl border border-transparent bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-success/5 hover:text-success dark:hover:bg-accent dark:hover:text-foreground"
      onClick={onClick}
      size="nav"
      variant="ghost"
    >
      <Icon />
      <span className="font-bold text-xs leading-none">{label}</span>
    </Button>
  )
}
