import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import './index.css'

interface PreLoaderProps {
  loaded: boolean
  onComplete: () => void
}

export function PreLoader({ loaded, onComplete }: PreLoaderProps) {
  const [phase, setPhase] = useState<'expanding' | 'shrinking' | 'done'>('expanding')
  const [minTimePassed, setMinTimePassed] = useState(false)

  // 1. Wait for minimum expansion time (1.2s for staggered colors to sweep across)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimePassed(true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [])

  // 2. Shrink when both minimum time passed AND backend is loaded
  useEffect(() => {
    if (minTimePassed && loaded && phase === 'expanding') {
      setPhase('shrinking')
      
      // Wait for the shrinking mask to reveal the app
      setTimeout(() => {
        setPhase('done')
        onComplete()
      }, 1000)
    }
  }, [minTimePassed, loaded, phase, onComplete])

  if (phase === 'done') return null

  const wrapperVariants = {
    initial: { clipPath: 'circle(150% at 100% 100%)' },
    shrinking: { 
      clipPath: 'circle(0% at 0% 0%)',
      transition: { duration: 1.0, ease: [0.76, 0, 0.24, 1] as const } 
    }
  }

  const layerVariants = {
    initial: { clipPath: 'circle(0% at 100% 100%)' },
    expanding: (delay: number) => ({
      clipPath: 'circle(150% at 100% 100%)',
      transition: { duration: 0.8, delay, ease: [0.76, 0, 0.24, 1] as const }
    }),
  }

  return (
    <motion.div
      className="preloader-wrapper"
      variants={wrapperVariants}
      initial="initial"
      animate={phase === 'shrinking' ? 'shrinking' : 'initial'}
    >
      {/* ── Base Dark Screen (Visible instantly before sweep) ── */}
      <div className="preloader-base" />

      {/* ── Expanding Colored Strips ── */}
      <motion.div className="preloader-layer bg-cyan"   custom={0.00} variants={layerVariants} initial="initial" animate="expanding" />
      <motion.div className="preloader-layer bg-violet" custom={0.10} variants={layerVariants} initial="initial" animate="expanding" />
      <motion.div className="preloader-layer bg-ember"  custom={0.20} variants={layerVariants} initial="initial" animate="expanding" />
      <motion.div className="preloader-layer bg-sage"   custom={0.30} variants={layerVariants} initial="initial" animate="expanding" />
      <motion.div className="preloader-layer bg-indigo" custom={0.40} variants={layerVariants} initial="initial" animate="expanding">
        {/* Loading text sits inside the final layer and fades in softly once it covers the screen */}
        <div className="preloader-content" style={{ animation: 'fade-in 0.5s ease-out 0.8s both' }}>
          <div className="preloader-spinner" style={{ borderColor: 'rgba(255,255,255,0.15)', borderTopColor: '#fff' }} />
          <div className="preloader-text" style={{ color: '#fff' }}>Waking up the agent...</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
