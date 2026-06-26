import { motion, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Isolated motion leaf component. Wraps children in a fade-up reveal,
 * triggered on scroll-into-view (or on mount for hero elements).
 *
 * IMPORTANT: uses #root as the viewport root because #root is the actual
 * scroll container (body/html have overflow:hidden). Without this,
 * whileInView never fires on elements that are below the fold — the
 * viewport never scrolls so IntersectionObserver misses them.
 */



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

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  const initial = { opacity: 0, y: 24, filter: 'blur(4px)' }
  const animate = { opacity: 1, y: 0, filter: 'blur(0px)' }
  const transition: Transition = { type: 'spring', bounce: 0, duration: 1.0, delay }

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
      viewport={{ once: true, amount: 0.2 }}
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

  const initial = { opacity: 0, y: 24, filter: 'blur(4px)' }
  const animate = { opacity: 1, y: 0, filter: 'blur(0px)' }

  return (
    <div className={className}>
      {items.map((item, i) =>
        triggerOnMount ? (
          <motion.div
            className={classFor(item, i)}
            key={item.key}
            initial={initial}
            animate={animate}
            transition={{ type: 'spring', bounce: 0, duration: 1.0, delay: (i * staggerMs) / 1000 } as Transition}
          >
            {renderItem(item)}
          </motion.div>
        ) : (
          <motion.div
            className={classFor(item, i)}
            key={item.key}
            initial={initial}
            whileInView={animate}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ type: 'spring', bounce: 0, duration: 1.0, delay: (i * staggerMs) / 1000 } as Transition}
          >
            {renderItem(item)}
          </motion.div>
        )
      )}
    </div>
  )
}
