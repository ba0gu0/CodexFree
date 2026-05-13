import type { Locale, ViewId } from './App'
import * as m from './paraglide/messages.js'

export function titleForView(view: ViewId, locale: Locale): string {
  const titles: Record<ViewId, string> = {
    dashboard: text(m.dashboard_title, locale),
    proxy: text(m.proxy_title, locale),
    requests: text(m.requests_title, locale),
    accounts: text(m.accounts_title, locale),
    usage: text(m.usage_title, locale),
    settings: text(m.settings_title, locale)
  }
  return titles[view]
}

export function text(
  message: (inputs?: object, options?: { locale?: Locale }) => string,
  locale: Locale
): string {
  return message({}, { locale })
}
