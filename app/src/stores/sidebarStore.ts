import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SidebarState {
  collapsed: boolean
  sidebarWidth: number
  hovered: boolean
  setCollapsed: (collapsed: boolean) => void
  setHovered: (hovered: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      sidebarWidth: 240,
      hovered: false,
      setCollapsed: (collapsed) => set({
        collapsed,
        sidebarWidth: collapsed ? 64 : 240
      }),
      setHovered: (hovered) => set({ hovered }),
    }),
    {
      name: 'erp-sidebar',
      partialize: (state) => ({ collapsed: state.collapsed, sidebarWidth: state.collapsed ? 64 : 240 }),
    }
  )
)
