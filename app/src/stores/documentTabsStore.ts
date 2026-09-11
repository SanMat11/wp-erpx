import { create } from 'zustand'
import { Modal } from 'antd'
import i18n from '@/i18n'

// Types d'onglets dynamiques (documents)
export type DocumentType = 'quote' | 'invoice' | 'supplier-invoice' | 'purchase-order' | 'receipt' | 'deal' | 'client' | 'supplier' | 'article' | 'bank-account' | 'amendment'

// Types d'onglets statiques (listes/pages)
export type StaticTabType =
  | 'dashboard'
  | 'clients'
  | 'suppliers'
  | 'articles'
  | 'quotes'
  | 'invoices'
  | 'supplier-invoices'
  | 'stock'
  | 'purchase-orders'
  | 'receipts'
  | 'deals'
  | 'ged'
  | 'treasury'
  | 'comptabilite'
  | 'settings'
  | 'profile'
  | 'admin'

export interface StaticTab {
  id: string
  type: 'static'
  staticType: StaticTabType
  title: string
  closable: boolean
  // Ce que l'appelant veut dire à l'écran en l'ouvrant — aujourd'hui le
  // sous-onglet à afficher (voir openStaticTab).
  metadata?: Record<string, unknown>
}

export interface DocumentTab {
  id: string
  type: 'document'
  documentType: DocumentType
  title: string
  documentId?: string
  isNew: boolean
  isDirty: boolean
  closable: boolean
  metadata?: Record<string, unknown>
}

export type Tab = StaticTab | DocumentTab

interface TabsState {
  tabs: Tab[]
  activeTabId: string | null

  // Actions
  openStaticTab: (staticType: StaticTabType, sousOnglet?: string) => string
  openDocumentTab: (documentType: DocumentType, documentId?: string, title?: string, metadata?: Record<string, unknown>) => string
  closeTab: (tabId: string, options?: { skipConfirm?: boolean }) => void
  closeAllTabs: () => void
  setActiveTab: (tabId: string) => void
  updateTabTitle: (tabId: string, title: string) => void
  setTabDirty: (tabId: string, isDirty: boolean) => void
  setTabDocumentId: (tabId: string, documentId: string) => void
  getTab: (tabId: string) => Tab | undefined
  getTabMetadata: (tabId: string) => Record<string, unknown> | undefined
}

const staticTabLabels: Record<StaticTabType, string> = {
  'dashboard': 'Tableau de bord',
  'clients': 'Clients',
  'suppliers': 'Fournisseurs',
  'articles': 'Articles',
  'quotes': 'Devis',
  'invoices': 'Factures clients',
  'supplier-invoices': 'Factures fournisseurs',
  'stock': 'Stock',
  'purchase-orders': 'Commandes fournisseur',
  'receipts': 'Réceptions',
  'deals': 'Affaires',
  'ged': 'GED',
  'treasury': 'Tresorerie',
  'comptabilite': 'Comptabilité',
  'settings': 'Paramètres',
  'profile': 'Mon profil',
  'admin': 'Administration',
}

const documentTypeLabels: Record<DocumentType, string> = {
  'quote': 'Devis',
  'invoice': 'Facture',
  'supplier-invoice': 'Facture fournisseur',
  'purchase-order': 'Commande',
  'receipt': 'Réception',
  'deal': 'Affaire',
  'client': 'Client',
  'supplier': 'Fournisseur',
  'article': 'Article',
  'bank-account': 'Compte bancaire',
  'amendment': 'Avenant',
}

// Dashboard tab - always first and not closable
const dashboardTab: StaticTab = {
  id: 'static-dashboard',
  type: 'static',
  staticType: 'dashboard',
  title: 'Tableau de bord',
  closable: false,
}

export const useDocumentTabsStore = create<TabsState>((set, get) => ({
  // Initialize with dashboard tab
  tabs: [dashboardTab],
  activeTabId: 'static-dashboard',

  // ⚠️ UN ÉCRAN S'OUVRE PARFOIS SUR UN SOUS-ONGLET PRÉCIS.
  //
  // openStaticTab() ne transportait aucun paramètre : le lien « Voir tout » de
  // la carte « Articles en alerte » du tableau de bord ne pouvait mener qu'à
  // l'écran Stock, jamais à son onglet « Alertes », et le lecteur retombait sur
  // « Niveaux » sans comprendre ce qu'il était venu chercher.
  //
  // Le sous-onglet voyage dans le metadata de l'onglet. Il est remis à jour
  // même quand l'onglet EXISTE DÉJÀ : sans cela, un second clic sur « Voir
  // tout » se contentait de réactiver un onglet resté sur son ancien filtre.
  openStaticTab: (staticType, sousOnglet) => {
    const state = get()
    const metadata = sousOnglet ? { sousOnglet } : undefined

    // Check if static tab already exists
    const existingTab = state.tabs.find(
      t => t.type === 'static' && t.staticType === staticType
    ) as StaticTab | undefined

    if (existingTab) {
      set({
        tabs: metadata
          ? state.tabs.map(t => (t.id === existingTab.id ? { ...t, metadata } : t))
          : state.tabs,
        activeTabId: existingTab.id,
      })
      return existingTab.id
    }

    // Create new static tab
    const tabId = `static-${staticType}`
    const newTab: StaticTab = {
      id: tabId,
      type: 'static',
      staticType,
      title: staticTabLabels[staticType],
      closable: staticType !== 'dashboard',
      metadata,
    }

    set({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    })

    return tabId
  },

  openDocumentTab: (documentType, documentId, title, metadata) => {
    const state = get()

    // Check if document tab already exists
    if (documentId) {
      const existingTab = state.tabs.find(
        t => t.type === 'document' && t.documentType === documentType && t.documentId === documentId
      ) as DocumentTab | undefined

      if (existingTab) {
        set({ activeTabId: existingTab.id })
        return existingTab.id
      }
    }

    // Create new document tab
    const tabId = `doc-${documentType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const isNew = !documentId
    const tabTitle = title || (isNew ? `Nouveau ${documentTypeLabels[documentType]}` : `${documentTypeLabels[documentType]} ...`)

    const newTab: DocumentTab = {
      id: tabId,
      type: 'document',
      documentType,
      title: tabTitle,
      documentId,
      isNew,
      isDirty: false,
      closable: true,
      metadata,
    }

    set({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    })

    return tabId
  },

  closeTab: (tabId, options) => {
    const state = get()
    const tab = state.tabs.find(t => t.id === tabId)

    // Don't close non-closable tabs (dashboard)
    if (!tab || !tab.closable) return

    // ⚠️ ON NE FERME PLUS UN ONGLET MODIFIÉ SANS UN MOT.
    //
    // Tous les éditeurs tiennent « isDirty » à jour — la croix de l'onglet en
    // affiche même l'astérisque — et personne ne le consultait : la saisie
    // partait en silence. Le garde-fou est posé ICI, au seul endroit qui
    // décide, plutôt qu'écran par écran : il couvre du même coup les devis, les
    // factures, les articles, les affaires et tout éditeur à venir.
    //
    // Rien de tel sur setActiveTab : MainLayout garde TOUS les onglets montés
    // (display:none) et changer d'onglet ne perd donc aucune saisie. Demander
    // confirmation à chaque va-et-vient serait un harcèlement sans objet.
    if (!options?.skipConfirm && tab.type === 'document' && tab.isDirty) {
      Modal.confirm({
        title: i18n.t('tabs.unsavedTitle', 'Modifications non enregistrées'),
        content: i18n.t(
          'tabs.unsavedBody',
          'Cet onglet porte des modifications qui ne sont pas enregistrées. Le fermer les abandonnera.'
        ),
        okText: i18n.t('tabs.unsavedDiscard', 'Abandonner les modifications'),
        cancelText: i18n.t('common.cancel', 'Annuler'),
        okButtonProps: { danger: true },
        onOk: () => get().closeTab(tabId, { skipConfirm: true }),
      })

      return
    }

    const tabIndex = state.tabs.findIndex(t => t.id === tabId)
    const newTabs = state.tabs.filter(t => t.id !== tabId)
    let newActiveTabId = state.activeTabId

    // If closing active tab, select another tab
    if (state.activeTabId === tabId) {
      if (newTabs.length > 0) {
        const newIndex = Math.max(0, tabIndex - 1)
        newActiveTabId = newTabs[newIndex]?.id || null
      } else {
        newActiveTabId = null
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
    })
  },

  closeAllTabs: () => {
    // Keep only the dashboard tab
    set({ tabs: [dashboardTab], activeTabId: 'static-dashboard' })
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
  },

  updateTabTitle: (tabId, title) => {
    set((state) => ({
      tabs: state.tabs.map(t =>
        t.id === tabId ? { ...t, title } : t
      ),
    }))
  },

  setTabDirty: (tabId, isDirty) => {
    set((state) => ({
      tabs: state.tabs.map(t =>
        t.id === tabId && t.type === 'document' ? { ...t, isDirty } : t
      ),
    }))
  },

  setTabDocumentId: (tabId, documentId) => {
    set((state) => ({
      tabs: state.tabs.map(t =>
        t.id === tabId && t.type === 'document' ? { ...t, documentId, isNew: false } : t
      ),
    }))
  },

  getTab: (tabId) => {
    return get().tabs.find(t => t.id === tabId)
  },

  // Les onglets d'ÉCRAN en portent désormais aussi (le sous-onglet demandé à
  // l'ouverture) : ne rendre que celui des documents laissait StockList sans
  // moyen de lire ce qu'on venait de lui demander.
  getTabMetadata: (tabId) => {
    return get().tabs.find(t => t.id === tabId)?.metadata
  },
}))

// Helper hook for opening tabs from document lists
export const useOpenTab = () => {
  const { openDocumentTab } = useDocumentTabsStore()
  return {
    openQuote: (id?: string, title?: string) => openDocumentTab('quote', id, title),
    openInvoice: (id?: string, title?: string) => openDocumentTab('invoice', id, title),
    openSupplierInvoice: (id?: string, title?: string) => openDocumentTab('supplier-invoice', id, title),
    openPurchaseOrder: (id?: string, title?: string) => openDocumentTab('purchase-order', id, title),
    openDeal: (id?: string, title?: string) => openDocumentTab('deal', id, title),
  }
}
