import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchStatus, fetchConversations, createConversation } from './api'
import type { Status, Conversation } from './types'

interface AppState {
  connectLoaded: boolean
  connectError: string
  status: Status | null
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  sessionId: string | null
  setSessionId: (id: string | null) => void
  refreshConversations: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [connectLoaded, setConnectLoaded] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const refreshConversations = useCallback(async () => {
    setConversations(await fetchConversations())
  }, [])

  /* ── Bootstrap ── */
  useEffect(() => {
    let cancelled = false
    const MAX = 20
    const DELAY = 1500

    const tryConnect = async (attempt: number): Promise<void> => {
      try {
        const s = await fetchStatus()
        if (cancelled) return
        setStatus(s)
        
        const list = await fetchConversations()
        setConversations(list)
        
        let sid: string
        if (list.length) {
          sid = list[0].session_id
        } else {
          const c = await createConversation()
          sid = c.session_id
          setConversations(await fetchConversations())
        }
        
        setSessionId(sid)
        setConnectLoaded(true)
        setConnectError('')
      } catch {
        if (cancelled) return
        if (attempt < MAX) {
          setConnectError(`Connecting… (${attempt + 1}/${MAX})`)
          setTimeout(() => tryConnect(attempt + 1), DELAY)
        } else {
          setConnectError('Cannot reach backend on port 8000. Is the API server running?')
          setConnectLoaded(true) // Still unblock loader so we can show error
        }
      }
    }
    
    tryConnect(0)
    
    return () => { cancelled = true }
  }, [])

  return (
    <AppContext.Provider value={{
      connectLoaded,
      connectError,
      status,
      conversations,
      setConversations,
      sessionId,
      setSessionId,
      refreshConversations
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppState must be used within an AppProvider')
  }
  return context
}
