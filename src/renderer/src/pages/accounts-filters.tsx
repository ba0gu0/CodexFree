import { Button } from '@renderer/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@renderer/components/ui/input-group'
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SearchIcon, XIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import {
  type AccountFormatFilter,
  type AccountPlanFilter,
  type AccountStatusFilter,
  formatFilterLabel,
  formatFilters,
  isFormatFilter,
  isPlanFilter,
  planFilterLabel,
  planFilters,
  statusFilterLabel,
  statusFilters
} from './accounts-model'
import type { PageProps } from './types'

export function AccountFilters({
  formatFilter,
  onFormatChange,
  onPlanChange,
  onQueryChange,
  onStatusChange,
  planFilter,
  query,
  statusFilter,
  t
}: {
  formatFilter: AccountFormatFilter
  onFormatChange: (filter: AccountFormatFilter) => void
  onPlanChange: (filter: AccountPlanFilter) => void
  onQueryChange: (query: string) => void
  onStatusChange: (filter: AccountStatusFilter) => void
  planFilter: AccountPlanFilter
  query: string
  statusFilter: AccountStatusFilter
  t: PageProps['t']
}): ReactElement {
  return (
    <div className="mb-3 flex shrink-0 gap-2">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('accounts.search')}
          type="search"
          value={query}
        />
        {query ? (
          <InputGroupAddon align="inline-end">
            <Button
              aria-label={t('action.clearSearch')}
              onClick={() => onQueryChange('')}
              size="icon-xs"
              title={t('action.clearSearch')}
              variant="ghost"
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Select
        items={statusFilters.map((filter) => ({
          label: statusFilterLabel(filter, t),
          value: filter
        }))}
        onValueChange={(value) => {
          if (isAccountStatusFilter(value)) {
            onStatusChange(value)
          }
        }}
        value={statusFilter}
      >
        <SelectTrigger className="w-32 min-[1400px]:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {statusFilters.map((filter) => (
              <SelectItem key={filter} value={filter}>
                {statusFilterLabel(filter, t)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <Select
        items={formatFilters.map((filter) => ({
          label: formatFilterLabel(filter, t),
          value: filter
        }))}
        onValueChange={(value) => {
          if (isFormatFilter(value)) {
            onFormatChange(value)
          }
        }}
        value={formatFilter}
      >
        <SelectTrigger className="w-32 min-[1400px]:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {formatFilters.map((filter) => (
              <SelectItem key={filter} value={filter}>
                {formatFilterLabel(filter, t)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <Select
        items={planFilters.map((filter) => ({
          label: planFilterLabel(filter, t),
          value: filter
        }))}
        onValueChange={(value) => {
          if (isPlanFilter(value)) {
            onPlanChange(value)
          }
        }}
        value={planFilter}
      >
        <SelectTrigger className="w-28 min-[1400px]:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {planFilters.map((filter) => (
              <SelectItem key={filter} value={filter}>
                {planFilterLabel(filter, t)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </div>
  )
}

function isAccountStatusFilter(value: unknown): value is AccountStatusFilter {
  return (
    value === 'all' ||
    value === 'available' ||
    value === 'exhausted' ||
    value === 'disabled' ||
    value === 'invalid'
  )
}
