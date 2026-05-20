import {
  type RefObject,
  type UIEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

export interface VirtualRow<T> {
  index: number
  item: T
}

export interface VirtualRows<T> {
  bottomPadding: number
  containerRef: RefObject<HTMLDivElement | null>
  endIndex: number
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  rows: VirtualRow<T>[]
  startIndex: number
  topPadding: number
}

export const VIRTUAL_ROW_BATCH_SIZE = 50

export function useVirtualRows<T>({
  overscan = 4,
  renderedRowLimit = VIRTUAL_ROW_BATCH_SIZE,
  rowHeight,
  rows
}: {
  overscan?: number
  renderedRowLimit?: number
  rowHeight: number
  rows: T[]
}): VirtualRows<T> {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rowCount = rows.length
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const nextScrollTop = event.currentTarget.scrollTop
      setScrollTop((current) => {
        const currentRow = Math.floor(current / rowHeight)
        const nextRow = Math.floor(nextScrollTop / rowHeight)
        return currentRow === nextRow ? current : nextScrollTop
      })
    },
    [rowHeight]
  )

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const updateViewport = (): void => setViewportHeight(node.clientHeight)
    updateViewport()

    const observer = new ResizeObserver(updateViewport)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const node = containerRef.current
    const maxScrollTop =
      rowCount === 0 ? 0 : Math.max(0, (node?.scrollHeight ?? 0) - viewportHeight)
    if (scrollTop <= maxScrollTop) {
      return
    }
    node?.scrollTo({ top: maxScrollTop })
    setScrollTop(maxScrollTop)
  }, [rowCount, scrollTop, viewportHeight])

  return useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visibleRows = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : 1
    const windowSize = Math.min(renderedRowLimit, Math.max(1, visibleRows + overscan * 2))
    const end = Math.min(rows.length, start + windowSize)
    const virtualRows = rows.slice(start, end).map((item, offset) => ({
      index: start + offset,
      item
    }))

    return {
      bottomPadding: Math.max(0, (rows.length - end) * rowHeight),
      containerRef,
      endIndex: end,
      onScroll,
      rows: virtualRows,
      startIndex: start,
      topPadding: start * rowHeight
    }
  }, [onScroll, overscan, renderedRowLimit, rowHeight, rows, scrollTop, viewportHeight])
}
