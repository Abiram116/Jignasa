// Adapted from react-bits (https://github.com/DavidHDev/react-bits), TS-CSS
// variant, ShinyText component. MIT+Commons Clause licensed.
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import './ShinyText.css'

interface ShinyTextProps {
  text: string
  speed?: number
  className?: string
  color?: string
  shineColor?: string
}

export default function ShinyText({ text, speed = 3, className = '', color, shineColor = '#ffffff' }: ShinyTextProps) {
  const reduce = useReducedMotion()
  const progress = useMotionValue(0)
  const elapsedRef = useRef(0)
  const lastTimeRef = useRef<number | null>(null)
  const [paused, setPaused] = useState(false)
  const animationDuration = speed * 1000

  useAnimationFrame((time) => {
    if (reduce || paused) {
      lastTimeRef.current = null
      return
    }
    if (lastTimeRef.current === null) {
      lastTimeRef.current = time
      return
    }
    elapsedRef.current += time - lastTimeRef.current
    lastTimeRef.current = time
    const cycleTime = elapsedRef.current % animationDuration
    progress.set((cycleTime / animationDuration) * 100)
  })

  useEffect(() => {
    if (!reduce) return
    progress.set(50)
  }, [reduce, progress])

  const backgroundPosition = useTransform(progress, (p) => `${150 - p * 2}% center`)
  const pause = useCallback(() => setPaused(true), [])
  const resume = useCallback(() => setPaused(false), [])

  const base = color ?? 'inherit'
  const gradientStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(120deg, ${base} 0%, ${base} 35%, ${shineColor} 50%, ${base} 65%, ${base} 100%)`,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }

  return (
    <motion.span
      className={`shiny-text ${className}`}
      style={{ ...gradientStyle, backgroundPosition }}
      onMouseEnter={pause}
      onMouseLeave={resume}
    >
      {text}
    </motion.span>
  )
}
