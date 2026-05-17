import { TableCell, TableRow } from '@renderer/components/ui/table'
import type { ReactElement } from 'react'

export function VirtualTableSpacerRow({
  colSpan,
  height
}: {
  colSpan: number
  height: number
}): ReactElement | null {
  if (height <= 0) {
    return null
  }

  return (
    <TableRow aria-hidden className="border-0">
      <TableCell className="p-0" colSpan={colSpan} style={{ height }} />
    </TableRow>
  )
}
