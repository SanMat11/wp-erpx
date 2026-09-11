import { useState, useEffect, useCallback } from 'react'
import type { ResizeCallbackData } from 'react-resizable'

// Default column widths for document line tables (invoices, quotes, purchase orders)
export const DEFAULT_COLUMN_WIDTHS = {
  article_id: 130,
  description: 200,
  quantity: 80,
  purchase_price: 90,
  coefficient: 70,
  unit_price: 90,
  discount_percent: 75,
  discount_amount: 85,
  vat_rate: 80,
  total: 100,
} as const

export type ColumnWidths = typeof DEFAULT_COLUMN_WIDTHS

const STORAGE_KEY = 'erp_document_column_widths'

/**
 * Hook to manage column widths for document tables with localStorage persistence.
 * All document editors (invoices, quotes, purchase orders) share the same column widths.
 */
export function useColumnWidths() {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    // Load from localStorage on initial render
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Merge with defaults to handle any new columns
        return { ...DEFAULT_COLUMN_WIDTHS, ...parsed }
      }
    } catch (e) {
      console.warn('Failed to load column widths from localStorage:', e)
    }
    return { ...DEFAULT_COLUMN_WIDTHS }
  })

  // Save to localStorage whenever column widths change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columnWidths))
    } catch (e) {
      console.warn('Failed to save column widths to localStorage:', e)
    }
  }, [columnWidths])

  // Resize handler factory
  const handleResize = useCallback((key: keyof ColumnWidths) => {
    return (_: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      setColumnWidths((prev) => ({
        ...prev,
        [key]: size.width,
      }))
    }
  }, [])

  // Reset to defaults
  const resetWidths = useCallback(() => {
    setColumnWidths({ ...DEFAULT_COLUMN_WIDTHS })
  }, [])

  return {
    columnWidths,
    handleResize,
    resetWidths,
  }
}

/**
 * Generic hook for list column widths with localStorage persistence.
 * Each list can have its own storage key and default widths.
 */
export function useListColumnWidths<T extends Record<string, number>>(
  storageKey: string,
  defaultWidths: T
) {
  const [columnWidths, setColumnWidths] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        return { ...defaultWidths, ...parsed }
      }
    } catch (e) {
      console.warn(`Failed to load column widths from localStorage (${storageKey}):`, e)
    }
    return { ...defaultWidths }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columnWidths))
    } catch (e) {
      console.warn(`Failed to save column widths to localStorage (${storageKey}):`, e)
    }
  }, [columnWidths, storageKey])

  const handleResize = useCallback((key: keyof T) => {
    return (_: React.SyntheticEvent, { size }: ResizeCallbackData) => {
      setColumnWidths((prev) => ({
        ...prev,
        [key]: size.width,
      }))
    }
  }, [])

  const resetWidths = useCallback(() => {
    setColumnWidths({ ...defaultWidths })
  }, [defaultWidths])

  return {
    columnWidths,
    handleResize,
    resetWidths,
  }
}
