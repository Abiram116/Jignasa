import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import './index.css'

interface PreLoaderProps {
  loaded: boolean
  onComplete: () => void
}

export function PreLoader({ loaded, onComplete }: PreLoaderProps) {
  const [phase, setPhase] = useState<'loading' | 'expanding' | 'shrinking' | 'done'>('loading')

  useEffect(() => {
    if (loaded && phase === 'loading') {
      setPhase('expanding')
      
      // Wait for the expansion circles to cover the screen
      setTimeout(() => {
        setPhase('shrinking')
      }, 1000) // 1 second expansion phase
      
      // Wait for the shrinking mask to reveal the app
      setTimeout(() => {
        setPhase('done')
        onComplete()
      }, 2000) // 1 second shrink phase
    }
  }, [loaded, phase, onComplete])

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
      {/* ── Base Loading Screen ── */}
      <div className="preloader-base">
        <div className="preloader-content" style={{ animation: 'fade-in 0.3s ease-out 0.4s both' }}>
          <div className="preloader-spinner" />
          <div className="preloader-text">Waking up the agent...</div>
        </div>
      </div>

      {/* ── Expanding Colored Strips ── */}
      <motion.div
        className="preloader-layer bg-cyan"
        custom={0.0}
        variants={layerVariants}
        initial="initial"
        animate={phase !== 'loading' ? 'expanding' : 'initial'}
      />
      <motion.div
        className="preloader-layer bg-violet"
        custom={0.15}
        variants={layerVariants}
        initial="initial"
        animate={phase !== 'loading' ? 'expanding' : 'initial'}
      />
      <motion.div
        className="preloader-layer bg-indigo"
        custom={0.3}
        variants={layerVariants}
        initial="initial"
        animate={phase !== 'loading' ? 'expanding' : 'initial'}
      />
    </motion.div>
  )
}
