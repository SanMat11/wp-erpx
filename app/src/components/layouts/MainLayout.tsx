import { lazy, Suspense } from 'react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Button, theme, Modal, Spin, Input, Empty } from 'antd'
import { amsbmBoot, settingsAPI, invoiceAPI } from '@/services/api'
import PaymentRemindersModal, { type PendingReminder } from '@/components/PaymentRemindersModal'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  DashboardOutlined,
  UserOutlined,
  ShopOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  FileDoneOutlined,
  InboxOutlined,
  FundOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ShoppingCartOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  StopOutlined,
  BankOutlined,
  SearchOutlined,
  CalculatorOutlined,
  GlobalOutlined,
  RocketOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { NOMS, languesOffertes } from '@/i18n/locale'
import MarqueAmsbm from '@/components/MarqueAmsbm'
import NotificationCenter from '@/components/NotificationCenter'
import { useAuthStore } from '@/stores/authStore'
import {
  useDocumentTabsStore,
  StaticTabType,
  DocumentType,
  Tab,
  DocumentTab,
} from '@/stores/documentTabsStore'

// Import des pages statiques

// Import des editeurs de documents
import ErrorBoundary from '@/components/ErrorBoundary'

// ⚠️ Les écrans se chargent À LA DEMANDE, un par un.
//
// Ils étaient importés en dur : ouvrir le tableau de bord téléchargeait donc
// les vingt-six écrans de l'application, éditeurs compris — 3,1 Mo avant le
// premier pixel. Un module ES résout ses imports relativement à sa propre URL,
// donc au dossier du plugin : le découpage fonctionne ici, ce qui n'était pas
// le cas du format précédent.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ClientList = lazy(() => import('@/pages/clients/ClientList'))
const SupplierList = lazy(() => import('@/pages/suppliers/SupplierList'))
const ArticleList = lazy(() => import('@/pages/articles/ArticleList'))
const QuoteList = lazy(() => import('@/pages/quotes/QuoteList'))
const InvoiceList = lazy(() => import('@/pages/invoices/InvoiceList'))
const SupplierInvoiceList = lazy(() => import('@/pages/invoices/SupplierInvoiceList'))
const StockList = lazy(() => import('@/pages/stock/StockList'))
const PurchaseOrderList = lazy(() => import('@/pages/purchases/PurchaseOrderList'))
const ReceiptList = lazy(() => import('@/pages/purchases/ReceiptList'))
const DealList = lazy(() => import('@/pages/deals/DealList'))
const GEDList = lazy(() => import('@/pages/ged/GEDList'))
const TreasuryList = lazy(() => import('@/pages/treasury/TreasuryList'))
const ComptabilitePage = lazy(() => import('@/pages/comptabilite/ComptabilitePage'))
const BankAccountDetail = lazy(() => import('@/pages/treasury/BankAccountDetail'))
const Settings = lazy(() => import('@/pages/settings/Settings'))
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'))
const QuoteEditor = lazy(() => import('@/pages/quotes/QuoteEditor'))
const InvoiceEditor = lazy(() => import('@/pages/invoices/InvoiceEditor'))
const SupplierInvoiceEditor = lazy(() => import('@/pages/invoices/SupplierInvoiceEditor'))
const PurchaseOrderEditor = lazy(() => import('@/pages/purchases/PurchaseOrderEditor'))
const ReceiptEditor = lazy(() => import('@/pages/purchases/ReceiptEditor'))
const ClientEditor = lazy(() => import('@/pages/clients/ClientEditor'))
const SupplierEditor = lazy(() => import('@/pages/suppliers/SupplierEditor'))
const ArticleEditor = lazy(() => import('@/pages/articles/ArticleEditor'))
const DealEditor = lazy(() => import('@/pages/deals/DealEditor'))
const AmendmentEditor = lazy(() => import('@/pages/amendments/AmendmentEditor'))

const { Header, Content } = Layout

// Choix « ne plus afficher » de la fenêtre des relances d'impayés. Il vit dans
// localStorage et non dans sessionStorage : c'est une préférence, pas l'état
// d'une session — la fenêtre revenait dans chaque nouvel onglet de navigateur.
const RELANCES_MUETTES = 'amsbm-relances-muettes'

const menuItems = [
  {
    key: 'dashboard',
    icon: <DashboardOutlined />,
    label: 'Tableau de bord',
  },
  {
    type: 'group' as const,
    label: 'ACHAT',
    children: [
      { key: 'suppliers', icon: <ShopOutlined />, label: 'Fournisseurs' },
      { key: 'purchase-orders', icon: <ShoppingCartOutlined />, label: 'Commandes fournisseurs' },
      { key: 'receipts', icon: <InboxOutlined />, label: 'Réceptions' },
      { key: 'supplier-invoices', icon: <FileDoneOutlined />, label: 'Factures fournisseurs' },
    ],
  },
  {
    type: 'group' as const,
    label: 'VENTE',
    children: [
      { key: 'clients', icon: <UserOutlined />, label: 'Clients' },
      { key: 'quotes', icon: <FileTextOutlined />, label: 'Devis clients' },
      { key: 'invoices', icon: <FileDoneOutlined />, label: 'Factures clients' },
      { key: 'deals', icon: <FundOutlined />, label: 'Affaires' },
    ],
  },
  {
    type: 'group' as const,
    label: 'COMPTABILITÉ',
    children: [
      { key: 'treasury', icon: <BankOutlined />, label: 'Trésorerie' },
      { key: 'comptabilite', icon: <CalculatorOutlined />, label: 'Comptabilité' },
    ],
  },
  {
    type: 'group' as const,
    label: 'CATALOGUE',
    children: [
      { key: 'articles', icon: <AppstoreOutlined />, label: 'Articles' },
      { key: 'stock', icon: <InboxOutlined />, label: 'Stock' },
      { key: 'ged', icon: <FolderOpenOutlined />, label: 'GED' },
    ],
  },
]

const settingsMenuItems = [
  { key: 'settings', icon: <SettingOutlined />, label: 'Reglages' },
]

// ⚠️ L'entrée « Administration » a été RETIRÉE, ne pas la remettre telle quelle.
//
// Elle était conditionnée à un rôle « super_admin » que Api::currentRole() ne
// rend jamais (tenant_admin, un rôle amsbm_*, ou amsbm_readonly) : personne ne
// l'a jamais vue. Et l'écran qu'elle ouvrait appelle une vingtaine de routes
// /amsbm/v1/admin/* dont aucune n'existe — c'est du SaaS multi-locataires non
// repris. Voir la même note au-dessus d'adminAPI, dans services/api.ts.

// Flat menu items for collapsed state (no groups - groups break collapsed layout)
const flatMenuItems = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: 'Tableau de bord' },
  { type: 'divider' as const },
  { key: 'suppliers', icon: <ShopOutlined />, label: 'Fournisseurs' },
  { key: 'purchase-orders', icon: <ShoppingCartOutlined />, label: 'Commandes' },
  { key: 'receipts', icon: <InboxOutlined />, label: 'Réceptions' },
  { key: 'supplier-invoices', icon: <FileDoneOutlined />, label: 'Fact. fourn.' },
  { type: 'divider' as const },
  { key: 'clients', icon: <UserOutlined />, label: 'Clients' },
  { key: 'quotes', icon: <FileTextOutlined />, label: 'Devis' },
  { key: 'invoices', icon: <FileDoneOutlined />, label: 'Factures' },
  { key: 'deals', icon: <FundOutlined />, label: 'Affaires' },
  { type: 'divider' as const },
  { key: 'treasury', icon: <BankOutlined />, label: 'Trésorerie' },
  { key: 'comptabilite', icon: <CalculatorOutlined />, label: 'Compta' },
  { type: 'divider' as const },
  { key: 'articles', icon: <AppstoreOutlined />, label: 'Articles' },
  { key: 'stock', icon: <InboxOutlined />, label: 'Stock' },
  { key: 'ged', icon: <FolderOpenOutlined />, label: 'GED' },
]

// Mapping clé d'item -> clé i18n (nav.*) pour traduire les libellés du menu.
const NAV_KEY: Record<string, string> = {
  dashboard: 'nav.dashboard',
  suppliers: 'nav.suppliers',
  'purchase-orders': 'nav.purchaseOrders',
  receipts: 'nav.receipts',
  'supplier-invoices': 'nav.supplierInvoices',
  clients: 'nav.clients',
  quotes: 'nav.quotes',
  invoices: 'nav.invoices',
  deals: 'nav.deals',
  treasury: 'nav.treasury',
  comptabilite: 'nav.comptabilite',
  articles: 'nav.articles',
  stock: 'nav.stock',
  ged: 'nav.ged',
  settings: 'nav.settings',
  admin: 'nav.admin',
}

// En-têtes de groupe -> clé i18n (mappés par libellé FR d'origine).
const GROUP_LABEL_KEY: Record<string, string> = {
  ACHAT: 'nav.groupPurchasing',
  VENTE: 'nav.groupSales',
  COMPTABILITÉ: 'nav.groupAccounting',
  CATALOGUE: 'nav.groupCatalog',
}

// localizeMenu renvoie une copie des items de menu avec les libellés traduits via i18n.
// Les items non mappés (ex: séparateurs) conservent leur valeur.
function localizeMenu(items: any[], t: (k: string) => string): any[] {
  return items.map((item) => {
    const next: any = { ...item }
    if (item.key && NAV_KEY[item.key]) {
      next.label = t(NAV_KEY[item.key])
    } else if (item.type === 'group' && typeof item.label === 'string' && GROUP_LABEL_KEY[item.label]) {
      next.label = t(GROUP_LABEL_KEY[item.label])
    }

    // ⚠️ L'ENTRÉE RESTE, AVEC UN CADENAS — elle ne disparaît pas.
    //
    // Un module que ce paquet ne contient pas se voit : c'est ce qui permet de
    // le proposer. Le cadenas dit qu'il faut l'installer, le clic ouvre la
    // page qui l'explique. Masquer l'entrée cacherait l'offre ; la griser sans
    // rien dire laisserait croire à un défaut.
    if (item.key && ecranAbsent(String(item.key))) {
      next.icon = <LockOutlined />
      next.label = (
        <span style={{ opacity: 0.55 }}>
          {typeof next.label === 'string' ? next.label : item.label}
        </span>
      )
    }

    if (Array.isArray(item.children)) {
      next.children = localizeMenu(item.children, t)
    }
    return next
  })
}

/**
 * Cet écran relève-t-il d'un module absent du paquet ?
 *
 * ⚠️ TOUS ses modules doivent l'être. Les réceptions relèvent des achats ET du
 * stock : si l'un des deux est livré, l'écran a de quoi travailler.
 */
function ecranAbsent(key: string): boolean {
  const modules = menuKeyToModules[key] ?? (menuKeyToModule[key] ? [menuKeyToModule[key]] : [])
  return modules.length > 0 && modules.every((module) => moduleAbsent(module))
}

// ⚠️ UN ÉCRAN PEUT RELEVER DE DEUX MÉTIERS, ET LES RÉCEPTIONS SONT DE CEUX-LÀ.
//
// La correspondance ne rendait qu'un module, et « receipts » était rangé sous
// « purchase_orders ». La matrice donne pourtant « none » sur ce module au
// MAGASINIER — il n'a aucune capability « amsbm_porder » — et l'écran des
// réceptions lui était donc invisible, alors que réceptionner est précisément
// son métier, qu'il porte toutes les capabilities « amsbm_receipt » et que le
// serveur le laisse faire. Le rattacher au stock à la place aurait seulement
// déplacé le trou : l'ACHETEUR, lui, n'a aucun droit sur le stock.
//
// Un écran s'ouvre donc dès qu'on a le droit sur L'UN de ses modules. C'est la
// seule lecture qui rende la matrice conforme aux capabilities qu'elle traduit.
const menuKeyToModules: Record<string, string[]> = {
  'receipts': ['purchase_orders', 'stock'],
}

const menuKeyToModule: Record<string, string> = {
  'dashboard': 'dashboard',
  'clients': 'clients',
  'suppliers': 'suppliers',
  'articles': 'articles',
  'quotes': 'quotes',
  'invoices': 'invoices',
  'supplier-invoices': 'supplier_invoices',
  'purchase-orders': 'purchase_orders',
  // La réception relève des achats ET du stock : voir menuKeyToModules, qui est
  // seul consulté pour cette clé. Celle-ci ne sert plus qu'à nommer le refus.
  'receipts': 'purchase_orders',
  'deals': 'deals',
  'stock': 'stock',
  'ged': 'ged',
  'treasury': 'treasury',
  'comptabilite': 'compta',
  'settings': 'settings',
}

const moduleLabels: Record<string, string> = {
  'dashboard': 'Tableau de bord', 'clients': 'Clients', 'suppliers': 'Fournisseurs',
  'articles': 'Articles', 'quotes': 'Devis', 'invoices': 'Factures clients',
  'supplier_invoices': 'Factures fournisseurs', 'purchase_orders': 'Commandes fournisseurs',
  'deals': 'Affaires', 'stock': 'Stock', 'ged': 'GED', 'treasury': 'Trésorerie',
  'compta': 'Comptabilité', 'settings': 'Paramètres',
}

/**
 * ⚠️ LE SEUL JUGE POUR OUVRIR UN ÉCRAN — s'en servir partout.
 *
 * Les raccourcis du tableau de bord et le menu de l'avatar appelaient
 * openStaticTab() directement : un lecteur à qui la barre latérale refusait
 * « Réglages » y entrait par son avatar, et un comptable sans droit sur le
 * stock par le lien « Tout voir ». La décision est donc prise ici, une fois,
 * et le tableau de bord l'appelle aussi.
 *
 * Renvoie null si l'écran peut s'ouvrir.
 */
export function refusEcran(
  key: string,
  hasAccess: (module: string) => boolean
): { motif: 'droits' | 'absent'; libelle: string } | null {
  const modules = menuKeyToModules[key] ?? (menuKeyToModule[key] ? [menuKeyToModule[key]] : [])

  // ⚠️ L'ABSENCE D'ABORD, LES DROITS ENSUITE, et l'ordre n'est pas indifférent.
  //
  // Un module que ce paquet ne contient pas n'est pas un module refusé : c'est
  // un module à installer. Répondre « vous n'avez pas les droits » enverrait
  // l'utilisateur voir son administrateur, qui ne pourrait rien pour lui.
  if (modules.length > 0 && modules.every((module) => moduleAbsent(module))) {
    return { motif: 'absent', libelle: moduleLabels[modules[0]] || modules[0] }
  }

  if (modules.length > 0 && !modules.some((module) => hasAccess(module))) {
    return { motif: 'droits', libelle: moduleLabels[modules[0]] || modules[0] }
  }

  return null
}

/**
 * Ce module est-il absent du paquet installé ?
 *
 * Le serveur annonce l'inventaire dans l'amorçage. Une clé inconnue vaut
 * « présent » : c'est le comportement sûr, et c'est ce qui permet au paquet
 * complet de ne rien annoncer du tout.
 */
export function moduleAbsent(module: string): boolean {
  const etat = amsbmBoot.modules
  return !!etat && etat[module] === false
}

/** Les modules absents, avec leur libellé — de quoi les proposer. */
export function modulesAbsents(): Array<{ code: string; label: string }> {
  return Object.entries(amsbmBoot.manquants ?? {}).map(([code, label]) => ({ code, label }))
}

const staticTabIcons: Record<StaticTabType, React.ReactNode> = {
  'dashboard': <DashboardOutlined />,
  'clients': <UserOutlined />,
  'suppliers': <ShopOutlined />,
  'articles': <AppstoreOutlined />,
  'quotes': <FileTextOutlined />,
  'invoices': <FileDoneOutlined />,
  'supplier-invoices': <FileDoneOutlined />,
  'stock': <InboxOutlined />,
  'purchase-orders': <ShoppingCartOutlined />,
  'receipts': <InboxOutlined />,
  'deals': <FundOutlined />,
  'ged': <FolderOpenOutlined />,
  'treasury': <BankOutlined />,
  'comptabilite': <CalculatorOutlined />,
  'settings': <SettingOutlined />,
  'profile': <UserOutlined />,
  'admin': <SettingOutlined />,
}

const documentTabIcons: Record<DocumentType, React.ReactNode> = {
  'quote': <FileTextOutlined />,
  'invoice': <FileDoneOutlined />,
  'supplier-invoice': <FileDoneOutlined />,
  'purchase-order': <ShoppingCartOutlined />,
  'receipt': <InboxOutlined />,
  'deal': <FundOutlined />,
  'client': <UserOutlined />,
  'supplier': <ShopOutlined />,
  'article': <AppstoreOutlined />,
  'bank-account': <BankOutlined />,
  'amendment': <FileTextOutlined />,
}

export default function MainLayout() {
  const { collapsed, setCollapsed, sidebarWidth } = useSidebarStore()
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string>('')
  const [accessDeniedModal, setAccessDeniedModal] = useState<{ visible: boolean; module: string }>({ visible: false, module: '' })
  const [moduleProModal, setModuleProModal] = useState<{ visible: boolean; module: string }>({ visible: false, module: '' })
  const [proVisible, setProVisible] = useState(() => window.localStorage.getItem('amsbm.pro.masque') !== '1')
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([])
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const { user, logout } = useAuthStore()
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    openStaticTab,
  } = useDocumentTabsStore()
  const { loadPermissions, setUserRole, hasAccess } = usePermissionStore()
  const themeMode = useThemeStore((state) => state.themeMode)
  const { token } = theme.useToken()
  const { t, i18n } = useTranslation()

  const isDark = themeMode === 'dark'
  const bgColor = token.colorBgContainer
  const bgColorSecondary = isDark ? '#141414' : '#f5f5f5'
  const borderColor = isDark ? '#303030' : '#e5e7eb'
  const textColor = token.colorText
  const textColorSecondary = token.colorTextSecondary

  // Sidebar colors from theme store
  const { sidebarBgColor, sidebarButtonColor, sidebarTitleColor } = useThemeStore()
  const sidebarBg = isDark ? '#111827' : sidebarBgColor

  // Inject CSS variables for sidebar colors
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-title-color', sidebarTitleColor)
    root.style.setProperty('--sidebar-text-color', sidebarTitleColor)
    root.style.setProperty('--sidebar-active-bg', sidebarButtonColor + '33')
    root.style.setProperty('--sidebar-active-color', sidebarButtonColor)
  }, [sidebarTitleColor, sidebarButtonColor])

  useEffect(() => {
    loadPermissions()
    if (user?.role) {
      setUserRole(user.role)
    }
  }, [user?.role, loadPermissions, setUserRole])

  // ⚠️ LA BARRE LATÉRALE SE REPLIE D'ELLE-MÊME EN PETITE FENÊTRE.
  //
  // Elle gardait ses 240 px quelle que soit la largeur : à 800 px, c'est 30 %
  // de l'écran pris par le menu. On replie en dessous de 1024 px — et on ne
  // rouvre QUE ce qu'on a soi-même replié, sinon le repli choisi à la main en
  // grande fenêtre serait défait au premier redimensionnement.
  const repliAutomatique = useRef(false)

  useEffect(() => {
    const ajuster = () => {
      const etroite = window.innerWidth < 1024
      const magasin = useSidebarStore.getState()

      if (etroite && !magasin.collapsed) {
        repliAutomatique.current = true
        magasin.setCollapsed(true)
      } else if (!etroite && magasin.collapsed && repliAutomatique.current) {
        repliAutomatique.current = false
        magasin.setCollapsed(false)
      }
    }

    ajuster()
    window.addEventListener('resize', ajuster)

    return () => window.removeEventListener('resize', ajuster)
  }, [])

  // Relances d'impayés : à la connexion (une fois par session), si la fonctionnalité est activée
  // et qu'il y a des factures à relancer, on propose un modal de sélection.
  //
  // ⚠️ « Ne plus afficher » se souvient, lui, d'une session à l'autre.
  // La fenêtre était la première chose que voyait l'utilisateur à CHAQUE
  // nouvel onglet de navigateur, et rien n'indiquait qu'on ne pouvait
  // l'éviter qu'en désactivant la fonction au fond des Paramètres.
  useEffect(() => {
    if (localStorage.getItem(RELANCES_MUETTES)) return
    if (sessionStorage.getItem('erp-reminders-checked')) return
    sessionStorage.setItem('erp-reminders-checked', '1')
    let cancelled = false
    invoiceAPI
      .pendingReminders()
      .then((res) => {
        if (cancelled) return
        const list: PendingReminder[] = res.data?.reminders || []

        // ⚠️ ON N'OUVRE PAS UNE FENÊTRE QUI NE MÈNE QU'À UN REFUS.
        //
        // « GET /invoices/reminders/pending » répond 200 à tout titulaire
        // d'amsbm_access, mais « POST /invoices/reminders/send » exige le droit
        // d'écrire sur les factures. Le magasinier recevait donc la fenêtre à
        // CHAQUE session, cochait, cliquait — et récoltait un 403 global, refusé
        // avant même le contrôleur, donc sans un mot pour l'expliquer.
        //
        // La matrice est lue ici, dans le .then() : le hook part au montage avec
        // des dépendances vides, et elle arrive elle-même par un appel.
        const etat = usePermissionStore.getState()
        const peutRelancer = etat.matrix === null || etat.canEdit('invoices')

        if (res.data?.enabled && list.length > 0 && peutRelancer) {
          setPendingReminders(list)
          setRemindersOpen(true)
        }
      })
      .catch(() => { /* pas d'accès factures ou erreur : on ignore */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const loadCompanyLogo = async () => {
      try {
        const response = await settingsAPI.getCompany()
        if (response.data.logo_url) {
          setCompanyLogo(response.data.logo_url)
        }
        // Le bandeau porte le nom de la société sous celui du module : c'est
        // chez elle qu'on travaille, et un même poste peut en servir plusieurs.
        if (response.data.company_name) {
          setCompanyName(String(response.data.company_name))
        }
      } catch (error) {
        console.error('Failed to load company logo:', error)
      }
    }
    loadCompanyLogo()
  }, [])

  const handleMenuClick = (key: string) => {
    // On dit pourquoi, et ce qu'il faut faire — le refus lui-même est décidé
    // par refusEcran(), commun à tous les chemins d'ouverture.
    const refus = refusEcran(key, hasAccess)

    // Un module absent du paquet se PROPOSE : on ouvre la page qui l'explique,
    // au lieu d'annoncer un refus auquel personne ici ne peut rien.
    if (refus?.motif === 'absent') {
      setModuleProModal({ visible: true, module: refus.libelle })
      return
    }

    if (refus) {
      setAccessDeniedModal({ visible: true, module: refus.libelle })
      return
    }

    openStaticTab(key as StaticTabType)
  }

  const handleLogout = () => {
    // ⚠️ LA DÉCONNEXION EST CELLE DE WORDPRESS, pas celle du magasin.
    //
    // Vider le magasin local et partir vers « /login » ne fermait rien : les
    // cookies d'authentification restaient valables, et sur un poste partagé la
    // session suivante rouvrait l'ERP. L'adresse vient du serveur parce que
    // c'est wp_logout_url() qui y pose le nonce (voir Shell::enqueue).
    logout()
    window.location.href = amsbmBoot.logoutUrl
  }

  const userMenuItems = [
    // ⚠️ Par handleMenuClick, comme la barre latérale : ces deux entrées
    // ouvraient l'écran sans passer par les droits.
    { key: 'profile', icon: <UserOutlined />, label: 'Profil', onClick: () => handleMenuClick('profile') },
    { key: 'settings', icon: <SettingOutlined />, label: 'Paramètres', onClick: () => handleMenuClick('settings') },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Déconnexion', onClick: handleLogout, danger: true },
  ]

  // ⚠️ LA BARRE D'ONGLETS SUIT L'ONGLET ACTIF.
  //
  // Elle défile horizontalement : au-delà de neuf onglets, l'onglet qu'on
  // venait d'ouvrir se trouvait hors du champ visible. Plus rien n'était
  // surligné et l'utilisateur ne savait plus où il était. « nearest » ne bouge
  // que ce qu'il faut, et surtout ne fait pas défiler la page verticalement.
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!activeTabId) return

    tabRefs.current[activeTabId]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeTabId, tabs.length])

  // ⚠️ Ctrl+K EST INTERCEPTÉ, ET IL FAUT LE RESTER.
  //
  // WordPress ouvre sa propre palette de commandes sur ce raccourci : elle
  // s'affichait par-dessus l'ERP et bloquait tout jusqu'à Échap, alors même que
  // la barre latérale annonce « Ctrl+K ». On écoute donc en phase de CAPTURE,
  // sur window : ce couple-là passe avant les écouteurs de WordPress, et
  // stopPropagation les prive de l'événement.
  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && 'k' === e.key.toLowerCase()) {
        e.preventDefault()
        e.stopPropagation()
        setPaletteQuery('')
        setPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', auClavier, true)
    return () => window.removeEventListener('keydown', auClavier, true)
  }, [])

  // Les écrans que la recherche sait ouvrir : ceux du menu, plus les réglages
  // et le profil. C'est une recherche de NAVIGATION et elle le dit — la boîte
  // promettait une recherche qui n'existait nulle part et se contentait de
  // rouvrir le tableau de bord.
  const ecransCherchables = useMemo(() => {
    const trouves: Array<{ key: string; label: string; icon: React.ReactNode }> = []

    const parcourir = (items: any[]) => {
      items.forEach((item) => {
        if (Array.isArray(item.children)) {
          parcourir(item.children)
        } else if (item.key) {
          trouves.push({
            key: item.key,
            label: NAV_KEY[item.key] ? t(NAV_KEY[item.key]) : String(item.label),
            icon: item.icon,
          })
        }
      })
    }

    parcourir(menuItems)
    parcourir(settingsMenuItems)
    trouves.push({ key: 'profile', label: t('nav.profile', { defaultValue: 'Mon profil' }), icon: <UserOutlined /> })

    return trouves
  }, [t])

  // Sans accents ni casse : « trésorerie » se trouve en tapant « tresorerie ».
  const aplati = (texte: string) =>
    texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  const resultatsRecherche = paletteQuery.trim() === ''
    ? ecransCherchables
    : ecransCherchables.filter((e) => aplati(e.label).includes(aplati(paletteQuery.trim())))

  const ouvrirDepuisRecherche = (key: string) => {
    setPaletteOpen(false)
    setPaletteQuery('')
    handleMenuClick(key)
  }

  const handleTabClose = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    closeTab(tabId)
  }

  const getTabIcon = (tab: Tab): React.ReactNode => {
    return tab.type === 'static' ? staticTabIcons[tab.staticType] : documentTabIcons[tab.documentType]
  }

  // ⚠️ LE LIBELLÉ D'UN ONGLET D'ÉCRAN EST CELUI DU MENU, relu à chaque rendu.
  //
  // Il était figé au moment de l'ouverture, avec ses propres mots : le menu
  // disait « Commandes fournisseurs », l'onglet « Commandes fournisseur » ;
  // « Devis clients » devenait « Devis », « Trésorerie » perdait son accent. Et
  // il restait en français quand on basculait en anglais — seuls les onglets
  // ouverts ENSUITE étaient traduits. Le titre stocké ne sert donc plus que de
  // repli : la source, pour un écran, c'est la clé de traduction du menu.
  const getTabTitle = (tab: Tab): string => {
    if (tab.type === 'document') return tab.isDirty ? `${tab.title} *` : tab.title

    const cle = tab.staticType === 'profile' ? 'nav.profile' : NAV_KEY[tab.staticType]

    if (!cle) return tab.title

    const libelle = t(cle)

    return libelle === cle ? tab.title : libelle
  }

  const getSelectedMenuKey = (): string[] => {
    const activeTab = tabs.find(t => t.id === activeTabId)
    if (activeTab && activeTab.type === 'static') return [activeTab.staticType]
    return []
  }

  const renderStaticContent = (staticType: StaticTabType) => {
    switch (staticType) {
      case 'dashboard': return <Dashboard />
      case 'clients': return <ClientList />
      case 'suppliers': return <SupplierList />
      case 'articles': return <ArticleList />
      case 'quotes': return <QuoteList />
      case 'invoices': return <InvoiceList />
      case 'supplier-invoices': return <SupplierInvoiceList />
      case 'stock': return <StockList />
      case 'purchase-orders': return <PurchaseOrderList />
      case 'receipts': return <ReceiptList />
      case 'deals': return <DealList />
      case 'ged': return <GEDList />
      case 'treasury': return <TreasuryList />
      case 'comptabilite': return <ComptabilitePage />
      case 'settings': return <Settings />
      case 'profile': return <ProfilePage />
      case 'admin': return <AdminPage />
      default: return <div>Page non trouvee</div>
    }
  }

  const renderDocumentContent = (tab: DocumentTab) => {
    switch (tab.documentType) {
      case 'quote': return <QuoteEditor tabId={tab.id} documentId={tab.documentId} />
      case 'invoice': return <InvoiceEditor tabId={tab.id} documentId={tab.documentId} />
      case 'supplier-invoice': return <SupplierInvoiceEditor tabId={tab.id} documentId={tab.documentId} />
      case 'client': return <ClientEditor tabId={tab.id} documentId={tab.documentId} />
      case 'supplier': return <SupplierEditor tabId={tab.id} documentId={tab.documentId} />
      case 'article': return <ArticleEditor tabId={tab.id} documentId={tab.documentId} />
      case 'purchase-order': return <PurchaseOrderEditor tabId={tab.id} documentId={tab.documentId} />
      case 'receipt': return <ReceiptEditor tabId={tab.id} documentId={tab.documentId} />
      case 'deal': return <DealEditor tabId={tab.id} documentId={tab.documentId} />
      case 'bank-account': return <BankAccountDetail tabId={tab.id} documentId={tab.documentId!} />
      case 'amendment':
        return (
          <ErrorBoundary>
            <AmendmentEditor tabId={tab.id} documentId={tab.documentId} dealId={tab.metadata?.deal_id as string} />
          </ErrorBoundary>
        )
      default: return <div>Type de document non supporte</div>
    }
  }

  // ⚠️ TOUS LES ONGLETS OUVERTS RESTENT MONTÉS, seul l'actif est visible.
  //
  // On ne rendait que l'onglet actif : changer d'onglet démontait l'écran, et
  // le retour repartait de zéro — filtre saisi perdu, page atteinte oubliée,
  // saisie en cours effacée. C'est pourtant tout l'intérêt d'un fenêtrage à
  // onglets. On masque donc en CSS au lieu de démonter.
  //
  // Chaque onglet porte SA PROPRE frontière d'attente : une seule, commune,
  // remplacerait tout le contenu par le rond d'attente — donc démonterait les
  // autres onglets — le temps de télécharger le morceau d'un écran neuf.
  const renderTabPanels = () => {
    if (tabs.length === 0) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', color: textColorSecondary,
        }}>
          <DashboardOutlined style={{ fontSize: 64, marginBottom: 16, opacity: 0.3 }} />
          <h2 style={{ color: textColor, fontWeight: 300, marginBottom: 8 }}>Bienvenue dans votre ERP</h2>
          <p style={{ opacity: 0.6 }}>Selectionnez un module dans le menu pour commencer</p>
        </div>
      )
    }

    return tabs.map((tab) => (
      <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}>
              <Spin size="large" />
            </div>
          }
        >
          {tab.type === 'static' ? renderStaticContent(tab.staticType) : renderDocumentContent(tab)}
        </Suspense>
      </div>
    ))
  }

  const hasTabs = tabs.length > 0

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Sidebar */}
      <div
        className="erp-sidebar"
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          maxWidth: sidebarWidth,
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          background: sidebarBg,
          borderRight: `1px solid ${isDark ? '#1e293b' : 'rgba(255,255,255,0.08)'}`,
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 200,
          overflow: 'hidden',
        }}
      >
        {/* Logo area */}
        <div
          style={{
            padding: collapsed ? '16px 8px' : '20px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            minHeight: 64,
            flexShrink: 0,
          }}
        >
          {companyLogo ? (
            <div style={{
              backgroundColor: 'white', borderRadius: 8, padding: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: collapsed ? 40 : 40, height: collapsed ? 40 : 40, flexShrink: 0,
            }}>
              <img src={companyLogo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
          ) : (
            <MarqueAmsbm taille={40} />
          )}
          {!collapsed && (
            <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {/* Le nom court du produit. « AMS Studio » est la maison ; ce qu'on
                    ouvre ici est son ERP, et c'est ce mot que l'utilisateur cherche. */}
                <div style={{ color: 'white', fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>AMS ERP</div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={companyName}
              >
                {companyName}
              </div>
            </div>
          )}
        </div>

        {/* Search (expanded only) */}
        {!collapsed && (
          <div style={{ padding: '12px 12px 4px' }}>
            {/* ⚠️ Cette boîte OUVRE VRAIMENT une recherche, et son libellé dit
                ce qu'elle cherche : des écrans. Elle a longtemps affiché
                « Rechercher... » et « Ctrl+K » sans qu'aucun des deux n'existe —
                cliquer rouvrait le tableau de bord. Tant qu'il n'y a pas de
                recherche sur les données, ne pas lui redonner un libellé qui
                promette davantage. */}
            <div
              onClick={() => { setPaletteQuery(''); setPaletteOpen(true) }}
              // Atteignable au clavier : c'est un bouton, il doit donc se
              // prendre le focus par Tab et s'ouvrir par Entrée ou Espace.
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ('Enter' === e.key || ' ' === e.key) {
                  e.preventDefault()
                  setPaletteQuery('')
                  setPaletteOpen(true)
                }
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)',
                fontSize: 13, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <SearchOutlined style={{ fontSize: 13 }} />
              <span>{t('search.placeholder', { defaultValue: 'Aller à un écran…' })}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5 }}>Ctrl+K</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          <Menu
            mode="inline"
            selectedKeys={getSelectedMenuKey()}
            items={collapsed ? localizeMenu(flatMenuItems, t) : localizeMenu(menuItems, t)}
            onClick={({ key }) => handleMenuClick(key)}
            inlineCollapsed={collapsed}
            className="erp-sidebar-menu"
            style={{ background: 'transparent', border: 'none' }}
          />
        </div>

        {/* Bottom section */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <Menu
            mode="inline"
            selectedKeys={getSelectedMenuKey()}
            items={localizeMenu(settingsMenuItems, t)}
            onClick={({ key }) => handleMenuClick(key)}
            inlineCollapsed={collapsed}
            className="erp-sidebar-menu"
            style={{ background: 'transparent', border: 'none' }}
          />

          {/* ⚠️ CE BLOC OUVRE LE MENU DU COMPTE, comme l'avatar en haut à droite.
              Il était purement décoratif : ni curseur, ni menu, le clic ne
              produisait rien. C'est pourtant l'emplacement où l'on cherche
              Profil / Paramètres / Déconnexion, et le doublon d'avatar (celui
              du bas inerte, celui du haut actif) désorientait. Même liste
              d'entrées des deux côtés : une seule décision, un seul menu. */}
          {!collapsed && (
            <Dropdown menu={{ items: userMenuItems }} placement="topRight" trigger={['click']}>
              <div
                role="button"
                tabIndex={0}
                style={{
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
                  borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer',
                }}
              >
                <Avatar size={32} style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', flexShrink: 0 }}>
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </Avatar>
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div style={{ color: 'white', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.firstName} {user?.lastName}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.email}
                  </div>
                </div>
              </div>
            </Dropdown>
          )}
        </div>
      </div>

      {/* Main content area */}
      <Layout style={{ marginLeft: sidebarWidth, transition: 'margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
        {/* Header */}
        <Header
          style={{
            padding: '0 20px',
            height: 52,
            lineHeight: '52px',
            background: bgColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${borderColor}`,
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              size="small"
              style={{ color: textColorSecondary }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/*
              ⚠️ UN LIEN, PAS UN BANDEAU, et il se ferme pour de bon.
              La règle 11 du répertoire veut que les incitations à l'achat
              restent « limitées et discrètes », et que tout ce qui s'affiche
              en permanence puisse se masquer. Celui-ci tient sur une ligne, ne
              paraît que s'il manque vraiment un module, et la croix le fait
              disparaître définitivement — le choix vit dans le navigateur.
            */}
            {proVisible && modulesAbsents().length > 0 && (
              <Button
                type="text"
                size="small"
                icon={<RocketOutlined />}
                onClick={() => setModuleProModal({ visible: true, module: '' })}
                style={{ color: '#16457A', fontWeight: 500 }}
              >
                {t('pro.upgrade', { defaultValue: 'Passer à la version Pro' })}
                <CloseOutlined
                  onClick={(e) => {
                    e.stopPropagation()
                    window.localStorage.setItem('amsbm.pro.masque', '1')
                    setProVisible(false)
                  }}
                  style={{ marginLeft: 8, fontSize: 10, opacity: 0.6 }}
                />
              </Button>
            )}
            <Dropdown
              menu={{
                // Les langues livrées, annoncées par le serveur : le menu en
                // offrait deux en dur alors que le catalogue peut en porter
                // quatre, et l'inverse serait pire encore.
                items: languesOffertes().map((code) => ({ key: code, label: NOMS[code] })),
                selectedKeys: [(i18n.language || 'fr').slice(0, 2)],
                onClick: ({ key }) => i18n.changeLanguage(key),
              }}
              placement="bottomRight"
            >
              <Button type="text" icon={<GlobalOutlined />} style={{ color: textColorSecondary }}>
                {(i18n.language || 'fr').slice(0, 2).toUpperCase()}
              </Button>
            </Dropdown>
            <NotificationCenter />
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 8 }}>
                <Avatar size={28} style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </Avatar>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{user?.firstName}</span>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Tabs Bar */}
        {hasTabs && (
          <div
            className="erp-tabbar"
            style={{
              background: bgColorSecondary,
              borderBottom: `1px solid ${borderColor}`,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 1,
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              minHeight: 36,
            }}
          >
            {tabs.map((tab) => {
              const isActive = activeTabId === tab.id
              return (
                <div
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el }}
                  onClick={() => setActiveTab(tab.id)}
                  className="erp-tab"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    borderRadius: '8px 8px 0 0',
                    background: isActive ? bgColor : 'transparent',
                    borderTop: isActive ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                    borderLeft: isActive ? `1px solid ${borderColor}` : '1px solid transparent',
                    borderRight: isActive ? `1px solid ${borderColor}` : '1px solid transparent',
                    marginBottom: isActive ? -1 : 0,
                    transition: 'all 0.15s',
                    fontSize: 12,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? token.colorPrimary : textColorSecondary,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{getTabIcon(tab)}</span>
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {getTabTitle(tab)}
                  </span>
                  {tab.closable && (
                    <CloseOutlined
                      className="erp-tab-close"
                      style={{
                        fontSize: 9, color: textColorSecondary, marginLeft: 2,
                        padding: 3, borderRadius: 4, opacity: isActive ? 0.7 : 0,
                        transition: 'all 0.15s',
                      }}
                      onClick={(e) => handleTabClose(tab.id, e)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Content */}
        <Content
          style={{
            padding: hasTabs ? 16 : 24,
            background: bgColorSecondary,
            minHeight: hasTabs ? 'calc(100vh - 52px - 36px)' : 'calc(100vh - 52px)',
            overflow: 'auto',
          }}
        >
          <div style={{
            background: bgColor,
            borderRadius: 12,
            padding: 20,
            minHeight: 'calc(100vh - 52px - 36px - 32px)',
            boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            {/* Frontière d'attente : les écrans se chargent à la demande, et il
                faut de quoi patienter le temps du téléchargement du morceau.
                Sans elle, React lève une erreur au lieu d'afficher la page.
                Elle est posée par onglet, dans renderTabPanels(). */}
            {renderTabPanels()}
          </div>
        </Content>
      </Layout>

      {/* Access denied modal */}
      <Modal
        open={accessDeniedModal.visible}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}>
            <StopOutlined />
            <span>Acces refuse</span>
          </div>
        }
        onOk={() => setAccessDeniedModal({ visible: false, module: '' })}
        onCancel={() => setAccessDeniedModal({ visible: false, module: '' })}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="Fermer"
      >
        <p>Vous n'avez pas les droits pour acceder au module <strong>{accessDeniedModal.module}</strong>.</p>
        <p style={{ color: textColorSecondary }}>Contactez votre administrateur.</p>
      </Modal>

      {/* Module absent de ce paquet — on le propose, on ne le refuse pas. */}
      <Modal
        open={moduleProModal.visible}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RocketOutlined style={{ color: '#16457A' }} />
            <span>
              {moduleProModal.module
                ? t('pro.title', { defaultValue: 'Module disponible avec AMS Studio Pro' })
                : t('pro.titleAll', { defaultValue: 'Modules disponibles avec AMS Studio Pro' })}
            </span>
          </div>
        }
        onOk={() => {
          window.open(amsbmBoot.boutique || 'https://www.ams-studio.lu/', '_blank', 'noopener')
          setModuleProModal({ visible: false, module: '' })
        }}
        onCancel={() => setModuleProModal({ visible: false, module: '' })}
        okText={t('pro.subscribe', { defaultValue: 'S\'abonner' })}
        cancelText={t('common.close', { defaultValue: 'Fermer' })}
      >
        <p>
          {/*
            Ouverte depuis l'entête, la boîte ne vise aucun module en
            particulier : la phrase nommée afficherait « le module «  » ».
            On dit alors la même chose au pluriel.
          */}
          {moduleProModal.module
            ? t('pro.body', {
                module: moduleProModal.module,
                defaultValue:
                  'Le module « {{module}} » n\'est pas installé sur ce site. Il fait partie du module complémentaire AMS Studio Pro.',
              })
            : t('pro.bodyAll', {
                defaultValue:
                  'Plusieurs modules ne sont pas installés sur ce site. Ils font partie du module complémentaire AMS Studio Pro.',
              })}
        </p>
        <p style={{ color: textColorSecondary, marginBottom: 0 }}>
          {moduleProModal.module
            ? t('pro.hint', {
                defaultValue:
                  'Rien n\'est bridé ici : ce module n\'est simplement pas livré avec la version gratuite. L\'installer suffit à l\'ouvrir.',
              })
            : t('pro.hintAll', {
                defaultValue:
                  'Rien n\'est bridé ici : ces modules ne sont simplement pas livrés avec la version gratuite. Les installer suffit à les ouvrir.',
              })}
        </p>
        {/*
          ⚠️ LE MÊME TARIF QUE LE SITE VITRINE, mot pour mot — front-page.php y
          annonce « 49 € HT / an · par site ». Deux prix qui divergent, c'est
          celui de la boîte qu'on croit, et la page de paiement qui dément.
          Changer l'un, c'est changer l'autre.
        */}
        <p style={{ marginTop: 16, marginBottom: 0, fontWeight: 600 }}>
          {t('pro.price', { defaultValue: '49 € HT par an et par site.' })}
        </p>
      </Modal>

      {/* Recherche d'écran (clic sur la boîte, ou Ctrl+K) */}
      <Modal
        open={paletteOpen}
        onCancel={() => setPaletteOpen(false)}
        footer={null}
        title={t('search.title', { defaultValue: 'Aller à un écran' })}
        destroyOnClose
      >
        <Input
          autoFocus
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('search.placeholder', { defaultValue: 'Aller à un écran…' })}
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          // Entrée ouvre le premier résultat : c'est ce qu'on attend d'une
          // boîte de recherche au clavier.
          onPressEnter={() => {
            if (resultatsRecherche.length > 0) {
              ouvrirDepuisRecherche(resultatsRecherche[0].key)
            }
          }}
        />
        <div style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
          {resultatsRecherche.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('search.noResult', { defaultValue: 'Aucun écran ne correspond' })} />
          ) : (
            resultatsRecherche.map((ecran) => (
              <div
                key={ecran.key}
                onClick={() => ouvrirDepuisRecherche(ecran.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  color: textColor,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = bgColorSecondary }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ color: textColorSecondary }}>{ecran.icon}</span>
                <span>{ecran.label}</span>
              </div>
            ))
          )}
        </div>
      </Modal>

      <PaymentRemindersModal
        open={remindersOpen}
        reminders={pendingReminders}
        onClose={(nePlusAfficher) => {
          if (nePlusAfficher) {
            localStorage.setItem(RELANCES_MUETTES, '1')
          }

          setRemindersOpen(false)
        }}
      />
    </Layout>
  )
}
