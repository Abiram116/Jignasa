import { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import HomePage from './HomePage'
import ChatInterface from './ChatInterface'
import { PreLoader } from './PreLoader'
import './index.css'

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  
  // Only show the preloader if the user initially lands on the home page
  const [preloaderComplete, setPreloaderComplete] = useState(location.pathname !== '/')

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
