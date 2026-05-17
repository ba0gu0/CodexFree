import { useCallback, useRef } from 'react'

const DEFAULT_THRESHOLD_PX = 240

export function useNearBottomLoadMore({
  enabled,
  onLoadMore,
  threshold = DEFAULT_THRESHOLD_PX
}: {
  enabled: boolean
  onLoadMore: () => void
  threshold?: number
}): (node: HTMLDivElement) => void {
  const armedRef = useRef(true)

  return useCallback(
    (node: HTMLDivElement): void => {
      const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < threshold
      if (!nearBottom) {
        armedRef.current = true
        return
      }
      if (!enabled || !armedRef.current) {
        return
      }

      armedRef.current = false
      onLoadMore()
    },
    [enabled, onLoadMore, threshold]
  )
}
