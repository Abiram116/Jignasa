import { Routes, Route, useNavigate } from 'react-router-dom'
import HomePage from './HomePage'
import ChatInterface from './ChatInterface'
import './index.css'

export default function App() {
  const navigate = useNavigate()

  return (
    <Routes>
      <Route path="/" element={<HomePage onEnter={() => navigate('/chat')} />} />
      <Route path="/chat" element={<ChatInterface onBack={() => navigate('/')} />} />
    </Routes>
  )
}
