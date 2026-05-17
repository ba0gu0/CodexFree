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
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  rows: VirtualRow<T>[]
  topPadding: number
}

export function useVirtualRows<T>({
  overscan = 4,
  rowHeight,
  rows
}: {
  overscan?: number
  rowHeight: number
  rows: T[]
}): VirtualRows<T> {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rowCount = rows.length
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

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
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
    const end = Math.min(rows.length, start + visibleCount)
    const virtualRows = rows.slice(start, end).map((item, offset) => ({
      index: start + offset,
      item
    }))

    return {
      bottomPadding: Math.max(0, (rows.length - end) * rowHeight),
      containerRef,
      onScroll,
      rows: virtualRows,
      topPadding: start * rowHeight
    }
  }, [onScroll, overscan, rowHeight, rows, scrollTop, viewportHeight])
}
