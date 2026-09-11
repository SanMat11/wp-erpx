import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useNotificationStore, WebSocketMessage } from '@/stores/notificationStore'

// ⚠️ Repris du SaaS, qui avait un serveur temps réel. WordPress n'en a pas.
//
// Sans adresse déclarée, le client frappait `/ws` sur le site lui-même : 404 à
// chaque fois, puis une nouvelle tentative, indéfiniment, avec la console qui
// se remplit d'erreurs et une socket rouverte toutes les minutes pour rien.
// On ne se connecte donc que si une adresse a été FOURNIE — le jour où un
// serveur temps réel existera, il suffira de la déclarer.
const WS_URL = ( import.meta.env.VITE_WS_URL as string | undefined ) || ''

// Y a-t-il seulement un serveur temps réel à attendre ? Tant que non, aucun
// écran ne doit annoncer de panne : il n'y a rien à quoi se connecter. C'est
// ici que la question se tranche, une fois, et pas dans chaque composant.
export const TEMPS_REEL_DECLARE = '' !== WS_URL

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef<number>(0)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const { addNotification, setConnected } = useNotificationStore()

  const connect = useCallback(() => {
    if (!isAuthenticated || !WS_URL) {
      return
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close()
    }

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    try {
      // Connect without token in URL to avoid leaking JWT in logs/history.
      // Authentication is performed via first-message protocol after connection opens.
      const ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        console.log('[WebSocket] Connected')
        reconnectAttemptsRef.current = 0
        setConnected(true)
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          // Validate message structure before processing
          if (typeof message.type === 'string' && message.data !== undefined) {
            addNotification(message)
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error)
      }

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason)
        setConnected(false)
        wsRef.current = null

        // Reconnect with exponential backoff if still authenticated
        if (isAuthenticated) {
          const delay = Math.min(5000 * Math.pow(2, reconnectAttemptsRef.current), 60000)
          reconnectAttemptsRef.current += 1
          reconnectTimeoutRef.current = window.setTimeout(() => {
            console.log(`[WebSocket] Reconnecting (attempt ${reconnectAttemptsRef.current})...`)
            connect()
          }, delay)
        }
      }

      wsRef.current = ws
    } catch (error) {
      console.error('[WebSocket] Connection error:', error)
      // Retry connection with exponential backoff
      const delay = Math.min(5000 * Math.pow(2, reconnectAttemptsRef.current), 60000)
      reconnectAttemptsRef.current += 1
      reconnectTimeoutRef.current = window.setTimeout(connect, delay)
    }
  }, [isAuthenticated, addNotification, setConnected])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setConnected(false)
  }, [setConnected])

  useEffect(() => {
    if (isAuthenticated && WS_URL) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [isAuthenticated, connect, disconnect])

  return {
    connect,
    disconnect,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  }
}
