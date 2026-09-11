import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { theme } from 'antd'

export type ThemeMode = 'light' | 'dark'

interface ThemeState {
  themeMode: ThemeMode
  primaryColor: string
  sidebarBgColor: string
  sidebarButtonColor: string
  sidebarTitleColor: string
  setThemeMode: (mode: ThemeMode) => void
  setPrimaryColor: (color: string) => void
  setSidebarColors: (bg: string, button: string, title: string) => void
  setTheme: (mode: ThemeMode, color: string) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeMode: 'light',
      primaryColor: '#1890ff',
      sidebarBgColor: '#0f172a',
      sidebarButtonColor: '#1e293b',
      sidebarTitleColor: '#94a3b8',

      setThemeMode: (mode) => set({ themeMode: mode }),

      setPrimaryColor: (color) => set({ primaryColor: color }),

      setSidebarColors: (bg, button, title) => set({
        sidebarBgColor: bg,
        sidebarButtonColor: button,
        sidebarTitleColor: title,
      }),

      setTheme: (mode, color) => set({ themeMode: mode, primaryColor: color }),
    }),
    {
      name: 'erp-theme',
    }
  )
)

// Helper to get Ant Design theme config
export const getAntdTheme = (themeMode: ThemeMode, primaryColor: string) => {
  return {
    algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: primaryColor,
    },
  }
}
