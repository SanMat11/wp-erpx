import { create } from 'zustand'

// WebSocket message types
export const WSTypes = {
  STOCK_ALERT: 'stock.alert',
  INVOICE_SENT: 'invoice.sent',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_OVERDUE: 'invoice.overdue',
} as const

export type WSType = (typeof WSTypes)[keyof typeof WSTypes]

// Payload types
export interface StockAlertPayload {
  article_id: string
  article_code: string
  article_name: string
  warehouse_id: string
  warehouse_name: string
  current_quantity: number
  min_threshold: number
  alert_type: 'low_stock' | 'out_of_stock'
  timestamp: string
}

export interface InvoiceStatusPayload {
  invoice_id: string
  number: string
  type: string
  client_name?: string
  total_ttc: number
  status: string
  timestamp: string
}

export interface WebSocketMessage {
  tenant_id: string
  type: WSType
  data: StockAlertPayload | InvoiceStatusPayload
}

export interface Notification {
  id: string
  type: WSType
  message: string
  description?: string
  timestamp: Date
  read: boolean
  data: StockAlertPayload | InvoiceStatusPayload
}

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  isConnected: boolean
  addNotification: (message: WebSocketMessage) => void
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearNotifications: () => void
  setConnected: (connected: boolean) => void
}

// Helper to generate notification message based on type
function generateNotificationContent(message: WebSocketMessage): { title: string; description: string } {
  switch (message.type) {
    case WSTypes.STOCK_ALERT: {
      const data = message.data as StockAlertPayload
      if (data.alert_type === 'out_of_stock') {
        return {
          title: 'Rupture de stock',
          description: `${data.article_code} - ${data.article_name} (${data.warehouse_name})`,
        }
      }
      return {
        title: 'Stock bas',
        description: `${data.article_code} - ${data.article_name}: ${data.current_quantity}/${data.min_threshold} (${data.warehouse_name})`,
      }
    }
    case WSTypes.INVOICE_SENT: {
      const data = message.data as InvoiceStatusPayload
      return {
        title: 'Facture envoyee',
        description: `${data.number}${data.client_name ? ` - ${data.client_name}` : ''}: ${data.total_ttc.toFixed(2)} EUR`,
      }
    }
    case WSTypes.INVOICE_PAID: {
      const data = message.data as InvoiceStatusPayload
      return {
        title: 'Facture payee',
        description: `${data.number}${data.client_name ? ` - ${data.client_name}` : ''}: ${data.total_ttc.toFixed(2)} EUR`,
      }
    }
    case WSTypes.INVOICE_OVERDUE: {
      const data = message.data as InvoiceStatusPayload
      return {
        title: 'Facture en retard',
        description: `${data.number}${data.client_name ? ` - ${data.client_name}` : ''}: ${data.total_ttc.toFixed(2)} EUR`,
      }
    }
    default:
      return {
        title: 'Notification',
        description: 'Nouvelle notification',
      }
  }
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isConnected: false,

  addNotification: (message: WebSocketMessage) => {
    const { title, description } = generateNotificationContent(message)
    const notification: Notification = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: message.type,
      message: title,
      description,
      timestamp: new Date(),
      read: false,
      data: message.data,
    }

    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 50), // Keep last 50
      unreadCount: state.unreadCount + 1,
    }))
  },

  markAsRead: (id: string) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id)
      if (!notification || notification.read) return state

      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }
    })
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }))
  },

  clearNotifications: () => {
    set({ notifications: [], unreadCount: 0 })
  },

  setConnected: (connected: boolean) => {
    set({ isConnected: connected })
  },
}))
