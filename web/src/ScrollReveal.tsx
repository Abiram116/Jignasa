import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Isolated motion leaf component. Wraps children in a fade-up reveal,
 * triggered on scroll-into-view (or on mount for hero elements).
 *
 * IMPORTANT: uses #root as the viewport root because #root is the actual
 * scroll container (body/html have overflow:hidden). Without this,
 * whileInView never fires on elements that are below the fold — the
 * viewport never scrolls so IntersectionObserver misses them.
 */

function useRootRef() {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    ref.current = document.querySelector<HTMLElement>('#root')
  }, [])
  return ref
}

export function ScrollReveal({
  children,
  delay = 0,
  triggerOnMount = false,
  className,
}: {
  children: ReactNode
  delay?: number
  triggerOnMount?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const rootRef = useRootRef()

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  const initial = { opacity: 0, y: 16 }
  const animate = { opacity: 1, y: 0 }
  const transition = { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const }

  if (triggerOnMount) {
    return (
      <motion.div className={className} initial={initial} animate={animate} transition={transition}>
        {children}
      </motion.div>
    )
  }

  return (
    <motion.div
      className={className}
      initial={initial}
      whileInView={animate}
      viewport={{ once: true, amount: 0.2, root: rootRef }}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}

/** Staggered list reveal — each child fades up with a short delay cascade. */
export function StaggerReveal<T extends { key: string }>({
  items,
  renderItem,
  triggerOnMount = false,
  staggerMs = 60,
  className,
  itemClassName,
}: {
  items: T[]
  renderItem: (item: T) => ReactNode
  triggerOnMount?: boolean
  staggerMs?: number
  className?: string
  itemClassName?: string | ((item: T, index: number) => string)
}) {
  const reduce = useReducedMotion()
  const rootRef = useRootRef()
  const classFor = (item: T, i: number) =>
    typeof itemClassName === 'function' ? itemClassName(item, i) : itemClassName

  if (reduce) {
    return (
      <div className={className}>
        {items.map((item, i) => (
          <div className={classFor(item, i)} key={item.key}>{renderItem(item)}</div>
        ))}
      </div>
    )
  }

  const transition = { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }

  return (
    <div className={className}>
      {items.map((item, i) =>
        triggerOnMount ? (
          <motion.div
            className={classFor(item, i)}
            key={item.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: (i * staggerMs) / 1000 }}
          >
            {renderItem(item)}
          </motion.div>
        ) : (
          <motion.div
            className={classFor(item, i)}
            key={item.key}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2, root: rootRef }}
            transition={{ ...transition, delay: (i * staggerMs) / 1000 }}
          >
            {renderItem(item)}
          </motion.div>
        ),
      )}
    </div>
  )
}
