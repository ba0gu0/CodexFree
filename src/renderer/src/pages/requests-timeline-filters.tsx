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
  type RequestFilter,
  type RequestSelectFilter,
  requestOutcomeFilters
} from './requests-model'
import { requestFilterLabel, type SelectOption } from './requests-timeline-model'
import type { PageProps } from './types'

export function RequestFilters({
  modelFilter,
  modelOptions,
  onModelChange,
  onOutcomeChange,
  onPurposeChange,
  onQueryChange,
  outcomeFilter,
  purposeFilter,
  purposeOptions,
  query,
  t
}: {
  modelFilter: RequestSelectFilter
  modelOptions: SelectOption[]
  onModelChange: (filter: RequestSelectFilter) => void
  onOutcomeChange: (filter: RequestFilter) => void
  onPurposeChange: (filter: RequestSelectFilter) => void
  onQueryChange: (query: string) => void
  outcomeFilter: RequestFilter
  purposeFilter: RequestSelectFilter
  purposeOptions: SelectOption[]
  query: string
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
          placeholder={t('requests.search')}
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
        items={requestOutcomeFilters.map((filter) => ({
          label: requestFilterLabel(filter, t),
          value: filter
        }))}
        onValueChange={(value) => {
          if (isRequestFilter(value)) {
            onOutcomeChange(value)
          }
        }}
        value={outcomeFilter}
      >
        <SelectTrigger className="w-28 min-[1400px]:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {requestOutcomeFilters.map((filter) => (
              <SelectItem key={filter} value={filter}>
                {requestFilterLabel(filter, t)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <FilterSelect
        onChange={onPurposeChange}
        options={purposeOptions}
        value={purposeFilter}
        widthClassName="w-28 min-[1400px]:w-36"
      />
      <FilterSelect
        onChange={onModelChange}
        options={modelOptions}
        value={modelFilter}
        widthClassName="w-28 min-[1400px]:w-36"
      />
    </div>
  )
}

function FilterSelect({
  onChange,
  options,
  value,
  widthClassName
}: {
  onChange: (value: RequestSelectFilter) => void
  options: SelectOption[]
  value: RequestSelectFilter
  widthClassName: string
}): ReactElement {
  return (
    <Select
      items={options}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') {
          onChange(nextValue)
        }
      }}
      value={value}
    >
      <SelectTrigger className={widthClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  )
}

function isRequestFilter(value: unknown): value is RequestFilter {
  return (
    value === 'all' ||
    value === 'forwarded' ||
    value === 'quota_exhausted' ||
    value === 'failed' ||
    value === 'rejected'
  )
}
