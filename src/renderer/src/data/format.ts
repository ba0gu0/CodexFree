import type { Locale } from '@renderer/i18n/copy'

export function formatDateTime(value: number | null | undefined, locale: Locale): string {
  if (!value) {
    return '-'
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(value)
}

export function formatDuration(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ms`
}

export function formatBytes(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-'
  }
  if (value <= 0) {
    return locale === 'zh-CN' ? '不限制' : 'Unlimited'
  }
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (value < 1024) {
    return `${formatter.format(value)} B`
  }
  if (value < 1024 * 1024) {
    return `${formatter.format(value / 1024)} KiB`
  }
  return `${formatter.format(value / 1024 / 1024)} MiB`
}

export function formatTokenCount(value: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (value >= 1_000_000) {
    return `${formatter.format(value / 1_000_000)}M`
  }
  if (value >= 1_000) {
    return `${formatter.format(value / 1_000)}K`
  }
  return formatWholeNumber(value, locale)
}

export function formatTokenCost(tokens: number, locale: Locale): string {
  const usd = (tokens / 1_000_000) * 5
  return `$${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(usd)}`
}

export function formatWholeNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

export function normalizePercent(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const numeric = Number.parseFloat(value.replace('%', ''))
  if (!Number.isFinite(numeric)) {
    return undefined
  }
  return Math.max(0, Math.min(100, numeric))
}

export function formatPercent(value: string | null | undefined, locale: Locale): string {
  const percent = normalizePercent(value)
  if (percent === undefined) {
    return '-'
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent)}%`
}

export function truncateMiddle(value: string, size = 18): string {
  if (value.length <= size) {
    return value
  }
  const edge = Math.max(4, Math.floor((size - 1) / 2))
  return `${value.slice(0, edge)}...${value.slice(-edge)}`
}

export function redactCaptureContent(value: string): string {
  return value
    .replaceAll(/^(authorization|cookie|set-cookie):\s*.+$/gim, '$1: [masked]')
    .replaceAll(/"((?:access|refresh|id)_token)"\s*:\s*"[^"]+"/g, '"$1": "[masked]"')
    .replaceAll(/"OPENAI_API_KEY"\s*:\s*"[^"]+"/g, '"OPENAI_API_KEY": "[masked]"')
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
