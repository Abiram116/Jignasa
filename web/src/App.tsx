import { useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import HomePage from './HomePage'
import ChatInterface from './ChatInterface'
import { PreLoader } from './PreLoader'
import './index.css'

export default function App() {
  const navigate = useNavigate()
  const [preloaderComplete, setPreloaderComplete] = useState(false)

  return (
    <>
      {!preloaderComplete && (
        <PreLoader 
          loaded={true} 
          onComplete={() => setPreloaderComplete(true)} 
        />
      )}
      <Routes>
        <Route path="/" element={<HomePage onEnter={() => navigate('/chat')} triggerHeroAnimations={preloaderComplete} />} />
        <Route path="/chat" element={<ChatInterface onBack={() => navigate('/')} />} />
      </Routes>
    </>
  )
}
