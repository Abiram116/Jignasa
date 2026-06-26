import { motion, AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import './index.css'

interface PreLoaderProps {
  loaded: boolean
  onComplete: () => void
}

export function PreLoader({ loaded, onComplete }: PreLoaderProps) {
  const [phase, setPhase] = useState<'expanding' | 'completing' | 'shrinking' | 'done'>('expanding')
  const [minTimePassed, setMinTimePassed] = useState(false)

  // 1. Wait for minimum expansion time (1.2s for staggered colors to sweep across)
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimePassed(true)
    }, 1200)
    return () => clearTimeout(timer)
  }, [])

  // 2. Complete and shrink when backend is loaded
  useEffect(() => {
    if (minTimePassed && loaded && phase === 'expanding') {
      setPhase('completing')
      
      // Wait for the "Agent awoke" text and spinner-to-dot transition (0.6s)
      setTimeout(() => {
        setPhase('shrinking')
        
        // Wait for the shrinking mask to reveal the app
        setTimeout(() => {
          setPhase('done')
          onComplete()
        }, 1000)
      }, 700)
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
        
        {/* Loading content sits inside the final layer and fades in softly */}
        <div className="preloader-content" style={{ animation: 'fade-in 0.5s ease-out 0.8s both' }}>
          
          <svg width="48" height="48" viewBox="0 0 48 48" style={{ overflow: 'visible', marginBottom: '8px' }}>
            <circle cx="24" cy="24" r="18" stroke="rgba(255,255,255,0.15)" strokeWidth="3" fill="none" />
            <motion.circle
              cx="24" cy="24" r="18"
              stroke="#fff"
              strokeWidth={3}
              fill="rgba(255,255,255,0)"
              strokeLinecap="round"
              strokeDasharray={113}
              initial={{ strokeDashoffset: 85, rotate: -90 }}
              animate={
                phase === 'expanding'
                  ? { 
                      strokeDashoffset: 85, 
                      rotate: 270, 
                      fill: "rgba(255,255,255,0)",
                      transition: { rotate: { repeat: Infinity, duration: 1, ease: "linear" } } 
                    }
                  : { 
                      strokeDashoffset: 0, 
                      rotate: 270,
                      fill: "rgba(255,255,255,1)",
                      transition: { 
                        strokeDashoffset: { duration: 0.4, ease: "easeOut" },
                        fill: { delay: 0.2, duration: 0.3, ease: "easeOut" },
                      } 
                    }
              }
              style={{ transformOrigin: '50% 50%' }}
            />
          </svg>

          <div className="preloader-text-container" style={{ position: 'relative', height: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <AnimatePresence mode="wait">
              {phase === 'expanding' ? (
                <motion.div 
                  key="waking" 
                  initial={{ opacity: 0, y: 5 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="preloader-text" 
                  style={{ color: '#fff', position: 'absolute', whiteSpace: 'nowrap' }}
                >
                  Waking up the agent...
                </motion.div>
              ) : (
                <motion.div 
                  key="awoke" 
                  initial={{ opacity: 0, y: 5 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="preloader-text" 
                  style={{ color: '#fff', position: 'absolute', whiteSpace: 'nowrap' }}
                >
                  Agent awoke.
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </motion.div>
    </motion.div>
  )
}
