import { DatabaseZap, KeyRound, type LucideIcon, Server } from 'lucide-react'
import * as m from './paraglide/messages.js'

interface StatItem {
  key: string
  label: string
  value: string
  Icon: LucideIcon
}

function App(): React.JSX.Element {
  const navItems = [
    m.nav_dashboard(),
    m.nav_accounts(),
    m.nav_proxy(),
    m.nav_requests(),
    m.nav_usage(),
    m.nav_settings()
  ]

  const stats: StatItem[] = [
    {
      key: 'proxy',
      label: m.status_proxy(),
      value: m.status_proxy_value(),
      Icon: Server
    },
    {
      key: 'accounts',
      label: m.status_accounts(),
      value: m.status_accounts_value(),
      Icon: KeyRound
    },
    {
      key: 'database',
      label: m.status_database(),
      value: m.status_database_value(),
      Icon: DatabaseZap
    }
  ]

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="fixed inset-y-0 left-0 w-56 border-zinc-800 border-r bg-zinc-950/95 px-4 py-5">
        <h1 className="font-semibold text-lg tracking-normal">{m.app_title()}</h1>
        <nav className="mt-8 grid gap-1">
          {navItems.map((item) => (
            <button
              className="rounded-md px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-900"
              key={item}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <section className="ml-56 px-8 py-7">
        <header>
          <p className="text-sm text-zinc-400">{m.app_subtitle()}</p>
          <h2 className="mt-2 font-semibold text-2xl tracking-normal">{m.nav_dashboard()}</h2>
        </header>

        <div className="mt-8 grid grid-cols-3 gap-4">
          {stats.map(({ Icon, key, label, value }) => (
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4" key={key}>
              <div className="flex items-center gap-2 text-zinc-400">
                <Icon aria-hidden="true" size={16} />
                <p className="text-sm">{label}</p>
              </div>
              <p className="mt-3 font-medium text-xl tracking-normal">{value}</p>
            </section>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h3 className="font-medium text-base tracking-normal">{m.panel_next_title()}</h3>
          <p className="mt-3 max-w-3xl text-sm text-zinc-300 leading-6">{m.panel_next_body()}</p>
          <div className="mt-5 flex gap-3">
            <button
              className="rounded-md bg-zinc-100 px-4 py-2 text-sm text-zinc-950"
              type="button"
            >
              {m.action_import_auth()}
            </button>
            <button
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-100"
              type="button"
            >
              {m.action_query_usage()}
            </button>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
