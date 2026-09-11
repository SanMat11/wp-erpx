import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Tooltip,
  message,
  Modal,
  DatePicker,
  Popconfirm,
  Divider,
  Row,
  Col,
  Upload,
  Select,
  Form,
  Alert,
  Descriptions,
  Typography,
  Checkbox,
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  FilePdfOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  FilterOutlined,
  CopyOutlined,
  ImportOutlined,
  InboxOutlined,
  RollbackOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import api, { invoiceAPI, supplierAPI, supplierInvoiceAPI, documentAPI } from '@/services/api'
import { useCanValidateDocuments, usePermissionsChargees, usePermissionStore } from '@/stores/permissionStore'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useListColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/fr'

dayjs.locale('fr')

const MONTH_KEYS = [
  'monthJan', 'monthFeb', 'monthMar', 'monthApr', 'monthMay', 'monthJun',
  'monthJul', 'monthAug', 'monthSep', 'monthOct', 'monthNov', 'monthDec',
] as const

// Default column widths for supplier invoice list
const DEFAULT_SUPPLIER_INVOICE_LIST_WIDTHS = {
  number: 140,
  supplier: 150,
  subject: 200,
  date: 110,
  due_date: 110,
  total_ht: 120,
  total_ttc: 120,
  remaining: 120,
  status: 100,
  actions: 260,
}

const { RangePicker } = DatePicker
const { Text } = Typography

const _supplierInvoiceListVersion = 'v2.0.1'
void _supplierInvoiceListVersion

interface InvoiceLine {
  id: string
  line_type?: string
  article_id?: string
  description: string
  quantity: number
  unit_price: number
  discount_percent: number
  tva_rate: number
  total_ht: number
}

interface Invoice {
  id: string
  number: string
  supplier_invoice_number?: string // Manual number from supplier
  type: string
  client_id?: string
  supplier_id?: string
  client?: { id: string; name: string }
  supplier?: { id: string; name: string }
  date: string
  due_date?: string
  status: string
  subject?: string
  notes?: string
  discount_percent?: number
  discount_amount?: number
  lines?: InvoiceLine[]
  total_ht: number
  total_tva: number
  total_ttc: number
  paid_amount: number
  is_archived?: boolean
  // « type » vaut « supplier » aussi bien pour la facture d'achat que pour son
  // avoir : c'est ce dont l'éditeur a besoin. Pour distinguer les deux, le
  // serveur pose ce drapeau (voir SupplierInvoices::toJson).
  is_credit?: boolean
}

interface InvoiceListResponse {
  data: Invoice[]
  // ⚠️ LES TOTAUX VIENNENT DU SERVEUR, PAS DE L'ADDITION DES LIGNES REÇUES.
  //
  // Documents::index() les calcule sur TOUTE la requête : c'est la seule façon
  // d'afficher un bandeau « Totaux généraux » qui ne mente pas dès que la liste
  // est tronquée par la pagination ou par un filtre de statut.
  totals?: {
    total_ht: number
    total_tva: number
    total_ttc: number
    paid_amount: number
    amount_due: number
    count: number
  }
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

const statusColors: Record<string, string> = {
  draft: 'default',
  // Un brouillon dont la validation est demandée (voir Documents::outStatus).
  // « validated » n'apparaît pas ici : une facture fournisseur nous arrive, son
  // état validé se lit « Reçue » — c'est « sent ».
  pending_validation: 'orange',
  sent: 'blue',
  partial: 'orange',
  paid: 'green',
  overdue: 'red',
  cancelled: 'default',
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

// ⚠️ LE SERVEUR DIT POURQUOI. IL FAUT LE LIRE.
//
// L'import d'une facture électronique produit sept refus précis et en français
// (« Ce fichier XML déclare un DOCTYPE… », « Le fichier reçu est vide. », « …sa
// racine est "catalogue". », « Ce fichier se présente comme du Factur-X mais il
// n'en a pas la structure… »). L'écran n'en montrait aucun : il ne lisait que
// « data.error », clé qu'un WP_Error ne porte JAMAIS — d'où le bandeau
// générique « Erreur lors de l'analyse du fichier » sur chacun des sept cas, et
// un utilisateur qui recommence indéfiniment le même téléversement.
//
// Même helper que motifOu() dans PurchaseOrderList.tsx : les refus arrivent
// tantôt sous « message » (WP_Error), tantôt sous « error » (routes de
// comptabilité), et l'intercepteur d'api.ts recopie l'un dans error.message.
const motifOu = (e: unknown, repli: string): string => {
  const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string }

  return err?.response?.data?.message || err?.response?.data?.error || err?.message || repli
}

// Le serveur ne verrouille une facture fournisseur qu'à partir de Soldé, Clôturé,
// Annulé ou Refusé (PostStatuses::lockedFor), soit « paid » et « cancelled » une
// fois traduits. Une facture reçue ou partiellement réglée se corrige donc, et
// c'est bien ce que veut le produit : on rectifie une facture d'achat jusqu'à son
// règlement.
//
// Ces statuts ne ferment plus aucun bouton : ils ne servent qu'à nommer le
// geste — « Ouvrir » plutôt que « Modifier » — puisqu'une facture verrouillée
// s'ouvre quand même, en lecture, dans son éditeur.
const LOCKED_STATUSES = ['paid', 'cancelled']

// ⚠️ UN AVOIR SE RETRANCHE, IL NE S'AJOUTE PAS. Il porte des montants positifs
// en base — c'est son sens comptable qui est négatif. Additionner un avoir de
// 1 170 € à ce qu'on doit au fournisseur gonflerait la dette du double de ce
// qu'il défait. Même règle que la liste des factures clients.
const signe = (invoice: Invoice) => (invoice.is_credit ? -1 : 1)

export default function SupplierInvoiceList() {
  const { t } = useTranslation()

  // ⚠️ CETTE LISTE OFFRAIT TOUS SES GESTES À TOUT LE MONDE. Dupliquer,
  // réceptionner, établir un avoir, archiver, supprimer : cinq écritures, et
  // aucune n'était conditionnée. Le serveur refusait bien — les routes exigent
  // la capacité dérivée du type —, mais le refus n'arrivait qu'au clic, sur une
  // pièce que l'utilisateur croyait pouvoir traiter.
  //
  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN : la matrice arrive par un appel,
  // et masquer avant sa réponse ferait clignoter la colonne d'actions à chaque
  // ouverture. Idiome repris des affaires.
  const droitsConnus = usePermissionsChargees()
  const peutEcrire = usePermissionStore((etat) => etat.canEdit('supplier_invoices'))
  const peutValider = useCanValidateDocuments()
  const offrirLEcriture = !droitsConnus || peutEcrire
  const offrirLaValidation = offrirLEcriture && (!droitsConnus || peutValider)
  const queryClient = useQueryClient()

  const statusLabels: Record<string, string> = {
    draft: t('supplierInvoices.statusDraft'),
    pending_validation: t('supplierInvoices.statusPendingValidation', 'Attente validation'),
    sent: t('supplierInvoices.statusReceived'),
    // ⚠️ FILET, ET NON CORRECTIF. La liste lit désormais « /supplier-invoices »,
    // qui rend « sent » sur une facture reçue et ne dit jamais « validated ».
    // Mais « /invoices?type=supplier », lui, le dit encore — Invoices::outStatus()
    // distingue « validée » d'« envoyée » selon qu'un courriel est parti, notion
    // qui n'a aucun sens pour une facture qu'on REÇOIT. Tant que cette route
    // n'est pas corrigée, tout écran qui l'emprunte doit savoir traduire le mot.
    validated: t('supplierInvoices.statusReceived'),
    partial: t('supplierInvoices.statusPartial'),
    paid: t('supplierInvoices.statusPaid'),
    overdue: t('supplierInvoices.statusOverdue'),
    cancelled: t('supplierInvoices.statusCancelled'),
  }

  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(11, 'month').startOf('month'),
    dayjs().add(1, 'month').endOf('month'),
  ])
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [importStep, setImportStep] = useState(1)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSupplierId, setImportSupplierId] = useState<string>('')
  const [importParsedData, setImportParsedData] = useState<any>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importManualLines, setImportManualLines] = useState<any[]>([])
  const [createSupplierVisible, setCreateSupplierVisible] = useState(false)
  const [importDuplicate, setImportDuplicate] = useState<{ exists: boolean; created_at?: string; internal_number?: string } | null>(null)
  const [createSupplierForm] = Form.useForm()
  // Ni tri, ni filtre de statut, ni accès aux archives : la liste ne savait
  // montrer que « les douze derniers mois, tout statut confondu ». Les trois
  // existaient pourtant côté serveur (Documents::index lit « status » et
  // « show_archived », /archive et /archive-bulk sont enregistrées).
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [showArchived, setShowArchived] = useState(false)
  // Les avoirs ne se mêlent aux factures que si on le demande : ils défont une
  // dette, ils ne s'y ajoutent pas. Même case que la liste des factures clients.
  const [showCredits, setShowCredits] = useState(false)

  const { openDocumentTab } = useDocumentTabsStore()
  const { sidebarWidth } = useSidebarStore()
  const { columnWidths, handleResize } = useListColumnWidths('erp_supplier_invoice_list_widths', DEFAULT_SUPPLIER_INVOICE_LIST_WIDTHS)

  const { data, isLoading, refetch } = useQuery<InvoiceListResponse>({
    queryKey: [
      'invoices',
      'supplier',
      search,
      dateRange[0].format('YYYY-MM-DD'),
      dateRange[1].format('YYYY-MM-DD'),
      statusFilter || '',
      showArchived,
      showCredits,
    ],
    queryFn: async () => {
      const params: Record<string, unknown> = {
        page: 1,
        page_size: 10000,
        search: search || undefined,
        date_from: dateRange[0].format('YYYY-MM-DD'),
        date_to: dateRange[1].format('YYYY-MM-DD'),
        status: statusFilter || undefined,
        // « with_credits » réunit les factures d'achat et leurs avoirs ; sans
        // lui, /supplier-invoices ne rend que les factures.
        type: showCredits ? 'with_credits' : undefined,
      }
      if (showArchived) {
        params.show_archived = true
      }
      // ⚠️ LA LISTE NE PASSE PLUS PAR « /invoices?type=supplier ».
      //
      // Les deux routes servaient les mêmes pièces et n'en disaient pas la même
      // chose : sur toute facture validée, « /invoices » rendait « validated » —
      // mot qu'aucun libellé de cet écran ne connaissait, d'où le « validated »
      // brut et en anglais lu dans la colonne Statut sur 19 lignes — pendant que
      // « /supplier-invoices/{id} » rendait « sent », c'est-à-dire « Reçue ».
      //
      // La cause est dans Invoices::outStatus(), qui distingue « validée » et
      // « envoyée » selon qu'un courriel est parti. C'est juste pour une facture
      // que NOUS émettons ; cela n'a aucun sens pour une facture qu'on REÇOIT, et
      // SupplierInvoices::statusMap() ne fait pas cette distinction. Traduire le
      // mot dans l'écran aurait laissé les deux routes se contredire — et le
      // prochain écran retomber dans le trou. On lit donc celle qui dit vrai.
      //
      // Elle apporte deux choses de plus : « type=with_credits », qui n'existe
      // que là, et un « /supplier-invoices/{id} » qui accepte les avoirs — que
      // « /invoices/{id} » refuse encore (voir Invoices::acceptedPostTypes).
      const response = await api.get('/supplier-invoices', { params })
      return response.data
    },
    // La liste se remet à jour au retour sur la fenêtre : un règlement passé
    // depuis la trésorerie ou un autre poste changeait le statut sans que cet
    // écran en sache rien jusqu'à la réouverture de l'onglet. Pas de minuteur
    // ici : ces changements viennent de l'intérieur du produit, qui invalide
    // déjà « invoices » à chaque écriture.
    refetchOnWindowFocus: true,
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-for-import'],
    queryFn: async () => (await supplierAPI.list({ page: 1, page_size: 10000 })).data,
    enabled: importModalVisible,
  })

  // ⚠️ LES GESTES DE LIGNE PASSENT PAR « /supplier-invoices », comme la liste.
  //
  // « /invoices/{id} » sert bien les factures d'achat, mais PAS leurs avoirs :
  // Invoices::acceptedPostTypes() ne connaît pas « amsbm_pcredit », et la lecture,
  // la suppression, la duplication, l'archivage et le PDF d'un avoir fournisseur
  // y répondent tous 404. Le contrôleur des factures fournisseurs, lui, les
  // accepte — il a été écrit pour cela. Une liste qui affiche des avoirs doit
  // pouvoir agir dessus, donc tout part par la route qui les connaît.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/supplier-invoices/${id}`),
    onSuccess: () => {
      message.success(t('supplierInvoices.deleteSuccess'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => {
      message.error(motifOu(e, t('supplierInvoices.deleteError')))
    },
  })

  // « Réceptionner » VALIDE la facture : elle passe de brouillon à reçue, prend
  // son numéro interne, et devient payable et comptabilisable. Le numéro du
  // fournisseur, lui, reste celui de sa facture à lui.
  const sendMutation = useMutation({
    mutationFn: (id: string) => supplierInvoiceAPI.validate(id),
    onSuccess: () => {
      message.success(t('supplierInvoices.receiveSuccess'))
      queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => {
      message.error(motifOu(e, t('supplierInvoices.receiveError')))
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/supplier-invoices/${id}/duplicate`),
    onSuccess: (response) => {
      message.success(t('supplierInvoices.duplicateSuccess'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      openDocumentTab('supplier-invoice', response.data.id, `${t('supplierInvoices.invoiceLabel')} ${response.data.number}`)
    },
    onError: (e) => {
      message.error(motifOu(e, t('supplierInvoices.duplicateError')))
    },
  })

  // Les deux routes existaient et personne ne les appelait : une facture
  // fournisseur ne pouvait ni sortir de la liste courante, ni y revenir.
  // (api.post direct : invoiceAPI ne déclare pas encore archive/archiveBulk et
  // services/api.ts ne m'appartient pas — voir handoff/RELIQUAT.md.)
  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.post(`/supplier-invoices/${id}/archive`, { archived }),
    onSuccess: (_res, variables) => {
      message.success(variables.archived
        ? t('supplierInvoices.archiveSuccess', 'Facture archivée.')
        : t('supplierInvoices.unarchiveSuccess', 'Facture désarchivée.'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (e) => {
      message.error(motifOu(e, t('supplierInvoices.archiveError', "La facture n'a pas pu être archivée.")))
    },
  })

  // ⚠️ L'AVOIR FOURNISSEUR ÉTAIT INATTEIGNABLE AU CLIC.
  //
  // La route existait et fonctionnait — « POST /supplier-invoices/{id}/credit »
  // rend 201, lignes et montants repris à l'identique — supplierInvoiceAPI.credit()
  // était déclaré dans api.ts… et appelé de nulle part. Aucun écran ne l'offrait :
  // un fournisseur qui envoie son avoir ne pouvait donc pas être enregistré, la
  // dette restait due, le solde fournisseur mentait et la comptabilité ne voyait
  // jamais la contre-passation. Même geste que l'avoir CLIENT : le bouton, la
  // confirmation, l'ouverture en onglet de la pièce créée.
  const creditMutation = useMutation({
    mutationFn: (id: string) => supplierInvoiceAPI.credit(id),
    onSuccess: (response) => {
      const avoir = response.data as { id: string; number: string; source_number: string }
      message.success(
        t('supplierInvoices.creditCreated', 'Avoir établi : relisez-le puis validez-le pour le numéroter.')
      )
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      // La case s'ouvre d'elle-même : sans elle, l'avoir qu'on vient d'établir
      // n'apparaîtrait nulle part dans la liste, et l'on croirait l'avoir perdu.
      setShowCredits(true)
      openDocumentTab(
        'supplier-invoice',
        avoir.id,
        `${t('supplierInvoices.creditTabPrefix', 'Avoir')} ${avoir.number}`
      )
    },
    onError: (e) => {
      message.error(motifOu(e, t('supplierInvoices.creditError', "L'avoir n'a pas pu être établi.")))
    },
  })

  // Group invoices by month with subtotals
  const groupedInvoices = useMemo(() => {
    const invoices = data?.data || []
    const groups: {
      key: string
      label: string
      invoices: Invoice[]
      totalHT: number
      totalTVA: number
      totalTTC: number
      totalRemaining: number
    }[] = []
    const groupMap = new Map<string, Invoice[]>()

    // Sort by date descending
    const sorted = [...invoices].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf())

    sorted.forEach((invoice) => {
      const date = dayjs(invoice.date)
      const key = `${date.year()}-${String(date.month()).padStart(2, '0')}`
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
      }
      groupMap.get(key)!.push(invoice)
    })

    groupMap.forEach((invoices, key) => {
      const [year, month] = key.split('-').map(Number)
      const totalHT = invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_ht || 0), 0)
      const totalTVA = invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_tva || 0), 0)
      const totalTTC = invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_ttc || 0), 0)
      const totalRemaining = invoices.reduce(
        (sum, inv) => sum + signe(inv) * ((inv.total_ttc || 0) - (inv.paid_amount || 0)),
        0
      )
      groups.push({
        key,
        label: `${t(`supplierInvoices.${MONTH_KEYS[month]}`)} ${year}`,
        invoices,
        totalHT,
        totalTVA,
        totalTTC,
        totalRemaining,
      })
    })

    // Sort groups by key descending (most recent first)
    groups.sort((a, b) => b.key.localeCompare(a.key))

    return groups
  }, [data?.data, t])

  // Grand totals — ceux du serveur d'abord (voir le commentaire sur
  // InvoiceListResponse.totals), l'addition des lignes reçues en repli.
  const grandTotals = useMemo(() => {
    const sommes = data?.totals

    if (sommes) {
      return {
        count: sommes.count,
        totalHT: sommes.total_ht,
        totalTVA: sommes.total_tva,
        totalTTC: sommes.total_ttc,
        totalPaid: sommes.paid_amount,
        totalRemaining: sommes.amount_due,
      }
    }

    const invoices = data?.data || []
    return {
      count: invoices.length,
      totalHT: invoices.reduce((sum, inv) => sum + (inv.total_ht || 0), 0),
      totalTVA: invoices.reduce((sum, inv) => sum + (inv.total_tva || 0), 0),
      totalTTC: invoices.reduce((sum, inv) => sum + (inv.total_ttc || 0), 0),
      totalPaid: invoices.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0),
      totalRemaining: invoices.reduce((sum, inv) => sum + ((inv.total_ttc || 0) - (inv.paid_amount || 0)), 0),
    }
  }, [data?.data, data?.totals])

  const handleDownloadPdf = async (invoice: Invoice) => {
    try {
      const response = await api.get(`/supplier-invoices/${invoice.id}/pdf`, { responseType: 'blob', params: { t: Date.now() } })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Facture-fournisseur-${invoice.supplier_invoice_number || invoice.number || invoice.id}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('supplierInvoices.pdfDownloaded'))
    } catch {
      message.error(t('supplierInvoices.pdfDownloadError'))
    }
  }

  // L'ŒIL MONTRE LE PDF, il n'ouvre plus une fenêtre d'aperçu.
  //
  // Les deux boutons se partagent le document : l'œil l'AFFICHE dans un onglet
  // du navigateur, l'icône PDF le TÉLÉCHARGE. On garde donc les deux, ils ne
  // font pas double emploi.
  //
  // ⚠️ L'ONGLET S'OUVRE AVANT L'APPEL, PAS APRÈS. Un window.open() lancé une
  // fois la réponse revenue n'est plus rattaché au clic : les navigateurs le
  // prennent pour une fenêtre surgissante et le bloquent sans un mot. On ouvre
  // l'onglet tout de suite, on y pose le PDF quand il arrive, et on le referme
  // si le serveur refuse.
  const handleViewPdf = async (invoice: Invoice) => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const response = await api.get(`/supplier-invoices/${invoice.id}/pdf`, { responseType: 'blob', params: { t: Date.now() } })
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      if (onglet) {
        onglet.location.href = url
      } else {
        // Onglet refusé par le navigateur : le document ne doit pas être perdu.
        window.open(url, '_blank', 'noopener')
      }
      // Le navigateur a besoin de l'URL le temps de charger le document.
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
    } catch {
      onglet?.close()
      message.error(t('supplierInvoices.pdfLoadError'))
    }
  }

  const handleCreate = () => {
    openDocumentTab('supplier-invoice')
  }

  const handleEdit = (invoice: Invoice) => {
    openDocumentTab('supplier-invoice', invoice.id, `${t('supplierInvoices.tabLabel')} ${invoice.supplier_invoice_number || t('supplierInvoices.noNumber')}`)
  }

  const handleImportAnalyze = async () => {
    if (!importFile) { message.warning(t('supplierInvoices.selectFileWarning')); return }
    setImportLoading(true)
    try {
      const response = await invoiceAPI.importElectronic(importFile)
      const parsed = response.data
      setImportParsedData(parsed)

      // Vérifier si la facture existe déjà (doublon)
      if (parsed.number) {
        try {
          const dupRes = await invoiceAPI.checkDuplicate(parsed.number)
          setImportDuplicate(dupRes.data)
        } catch {
          setImportDuplicate(null)
        }
      } else {
        setImportDuplicate(null)
      }

      // Si pas de lignes dans le XML (profil BasicWL), créer une ligne générique
      if (!parsed.lines || parsed.lines.length === 0) {
        const defaultTva = parsed.total_tva && parsed.total_ht ? Math.round((parsed.total_tva / parsed.total_ht) * 100 * 100) / 100 : 20
        setImportManualLines([{
          key: 0,
          description: parsed.subject || 'Facture ' + (parsed.number || ''),
          quantity: 1,
          unit: 'forfait',
          unit_price: parsed.total_ht || 0,
          tva_rate: defaultTva,
          total_ht: parsed.total_ht || 0,
        }])
      } else {
        setImportManualLines(parsed.lines.map((l: any, i: number) => ({ ...l, key: i })))
      }

      // Rechercher le fournisseur par numéro de TVA
      const sellerVat = response.data.seller_vat
      if (sellerVat && suppliersData?.data) {
        const match = suppliersData.data.find((s: any) =>
          s.tva_intra && s.tva_intra.replace(/\s/g, '').toUpperCase() === sellerVat.replace(/\s/g, '').toUpperCase()
        )
        if (match) {
          setImportSupplierId(match.id)
          message.success(t('supplierInvoices.supplierFoundByVat', { name: match.name }))
        } else {
          setImportSupplierId('')
        }
      }

      setImportStep(2)
    } catch (err: any) {
      message.error(motifOu(err, t('supplierInvoices.analyzeError')))
    } finally {
      setImportLoading(false)
    }
  }

  // Création rapide de fournisseur depuis le modal d'import
  const handleCreateSupplierQuick = async () => {
    try {
      const values = await createSupplierForm.validateFields()
      const response = await supplierAPI.create(values)
      const newSupplier = response.data
      setCreateSupplierVisible(false)
      createSupplierForm.resetFields()
      // Rafraîchir la liste des fournisseurs puis sélectionner le nouveau
      await queryClient.refetchQueries({ queryKey: ['suppliers-for-import'] })
      setImportSupplierId(newSupplier.id)
      message.success(t('supplierInvoices.supplierCreatedSelected', { name: newSupplier.name }))
    } catch (err: any) {
      if (err?.response?.data?.error) {
        message.error(err.response.data.error)
      }
    }
  }

  const handleImportCreate = async () => {
    if (!importParsedData || !importSupplierId) return
    setImportLoading(true)
    try {
      const response = await invoiceAPI.create({
        type: 'supplier',
        supplier_id: importSupplierId,
        supplier_invoice_number: importParsedData.number,
        date: importParsedData.date ? new Date(importParsedData.date).toISOString() : new Date().toISOString(),
        due_date: importParsedData.due_date ? new Date(importParsedData.due_date).toISOString() : undefined,
        subject: importParsedData.subject || `Import ${importParsedData.format?.toUpperCase()} - ${importParsedData.seller_name || ''}`,
        // Totaux du XML — utilisés directement, pas recalculés
        total_ht: importParsedData.total_ht ?? 0,
        total_tva: importParsedData.total_tva ?? 0,
        total_ttc: importParsedData.total_ttc ?? 0,
        discount_percent: importParsedData.discount_percent ?? 0,
        discount_amount: importParsedData.discount_amount ?? 0,
        lines: importManualLines.map((line: any, i: number) => ({
          line_type: 'article',
          position: i + 1,
          description: line.description || 'Article importé',
          quantity: line.quantity ?? 0,
          unit: line.unit || 'pce',
          unit_price: line.unit_price ?? 0,
          purchase_price: line.unit_price ?? 0,
          tva_rate: line.tva_rate ?? 20,
          discount_percent: line.discount_percent ?? 0,
          total_ht: line.total_ht ?? 0,
        })),
      })
      const created = response.data

      // Attacher le fichier original (PDF/XML) comme document lié à la facture
      if (importFile) {
        try {
          const formData = new FormData()
          formData.append('file', importFile)
          formData.append('name', `Facture fournisseur ${importParsedData.number || ''}`)
          formData.append('category', 'invoice')
          formData.append('invoice_id', created.id)
          await documentAPI.upload(formData)
        } catch {
          // Non bloquant — le document n'a pas pu être attaché
          message.warning(t('supplierInvoices.documentAttachWarning'))
        }
      }

      message.success(t('supplierInvoices.createSuccess'))
      setImportModalVisible(false)
      resetImport()
      // ⚠️ « invoices » et non « supplier-invoices » : c'est la clé de la liste
      // de cet écran. La facture importée n'y apparaissait qu'au rechargement
      // de la page — on croyait l'import perdu et on le recommençait.
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      // Ouvrir l'éditeur avec la facture créée
      openDocumentTab('supplier-invoice', created.id, `${t('supplierInvoices.tabLabel')} ${importParsedData.number || ''}`.trim())
    } catch (err: any) {
      message.error(motifOu(err, t('supplierInvoices.createError')))
    } finally {
      setImportLoading(false)
    }
  }

  const resetImport = () => {
    setImportStep(1)
    setImportFile(null)
    setImportSupplierId('')
    setImportParsedData(null)
    setImportManualLines([])
    setImportDuplicate(null)
  }

  const columns = [
    {
      title: t('supplierInvoices.colNumber'),
      dataIndex: 'supplier_invoice_number',
      key: 'number',
      width: columnWidths.number,
      onHeaderCell: () => ({
        width: columnWidths.number,
        onResize: handleResize('number'),
      }),
      sorter: (a: Invoice, b: Invoice) => (a.supplier_invoice_number || '').localeCompare(b.supplier_invoice_number || ''),
      render: (_: unknown, record: Invoice) => (
        <Space size={4}>
          <span>{record.supplier_invoice_number || '-'}</span>
          {/* L'avoir se voit du premier coup d'œil : mêlé aux factures sans
              marque, on lit son montant comme une dette de plus. */}
          {record.is_credit && <Tag color="volcano">{t('supplierInvoices.creditTag', 'AV')}</Tag>}
          {record.is_archived && <Tag color="default">{t('supplierInvoices.archived', 'Archivée')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('supplierInvoices.colSupplier'),
      key: 'supplier',
      width: columnWidths.supplier,
      onHeaderCell: () => ({
        width: columnWidths.supplier,
        onResize: handleResize('supplier'),
      }),
      sorter: (a: Invoice, b: Invoice) => (a.supplier?.name || '').localeCompare(b.supplier?.name || ''),
      render: (_: unknown, record: Invoice) => record.supplier?.name || '-',
    },
    {
      title: t('supplierInvoices.colSubject'),
      dataIndex: 'subject',
      key: 'subject',
      width: columnWidths.subject,
      ellipsis: true,
      onHeaderCell: () => ({
        width: columnWidths.subject,
        onResize: handleResize('subject'),
      }),
      sorter: (a: Invoice, b: Invoice) => (a.subject || '').localeCompare(b.subject || ''),
      render: (v: string) => v || '-',
    },
    {
      title: t('supplierInvoices.colDate'),
      dataIndex: 'date',
      key: 'date',
      width: columnWidths.date,
      onHeaderCell: () => ({
        width: columnWidths.date,
        onResize: handleResize('date'),
      }),
      sorter: (a: Invoice, b: Invoice) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: formatDate,
    },
    {
      title: t('supplierInvoices.colDueDate'),
      dataIndex: 'due_date',
      key: 'due_date',
      width: columnWidths.due_date,
      onHeaderCell: () => ({
        width: columnWidths.due_date,
        onResize: handleResize('due_date'),
      }),
      sorter: (a: Invoice, b: Invoice) => dayjs(a.due_date || 0).valueOf() - dayjs(b.due_date || 0).valueOf(),
      render: formatDate,
    },
    {
      title: t('supplierInvoices.colTotalHT'),
      dataIndex: 'total_ht',
      key: 'total_ht',
      width: columnWidths.total_ht,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.total_ht,
        onResize: handleResize('total_ht'),
      }),
      sorter: (a: Invoice, b: Invoice) => (a.total_ht || 0) - (b.total_ht || 0),
      render: (v: number) => `${v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
    },
    {
      title: t('supplierInvoices.colTotalTTC'),
      dataIndex: 'total_ttc',
      key: 'total_ttc',
      width: columnWidths.total_ttc,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.total_ttc,
        onResize: handleResize('total_ttc'),
      }),
      sorter: (a: Invoice, b: Invoice) => (a.total_ttc || 0) - (b.total_ttc || 0),
      render: (v: number) => `${v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
    },
    {
      title: t('supplierInvoices.colRemaining'),
      key: 'remaining',
      width: columnWidths.remaining,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.remaining,
        onResize: handleResize('remaining'),
      }),
      sorter: (a: Invoice, b: Invoice) =>
        ((a.total_ttc || 0) - (a.paid_amount || 0)) - ((b.total_ttc || 0) - (b.paid_amount || 0)),
      render: (_: unknown, record: Invoice) => {
        const remaining = (record.total_ttc || 0) - (record.paid_amount || 0)
        return `${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`
      },
    },
    {
      title: t('supplierInvoices.colStatus'),
      dataIndex: 'status',
      key: 'status',
      width: columnWidths.status,
      onHeaderCell: () => ({
        width: columnWidths.status,
        onResize: handleResize('status'),
      }),
      sorter: (a: Invoice, b: Invoice) =>
        (statusLabels[a.status] || a.status).localeCompare(statusLabels[b.status] || b.status),
      render: (status: string) => (
        <Tag color={statusColors[status]}>{statusLabels[status] || status}</Tag>
      ),
    },
    {
      title: t('supplierInvoices.colActions'),
      key: 'actions',
      width: columnWidths.actions,
      onHeaderCell: () => ({
        width: columnWidths.actions,
        onResize: handleResize('actions'),
      }),
      // Un clic dans cette colonne n'ouvre pas la facture : les boutons
      // d'action — et les confirmations qu'ils portent — sont ici, et le clic
      // de ligne les doublerait d'une ouverture d'onglet.
      onCell: () => ({ onClick: (event: React.MouseEvent) => event.stopPropagation() }),
      render: (_: unknown, record: Invoice) => (
        <Space size="small">
          <Tooltip title={t('supplierInvoices.viewPdf')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleViewPdf(record)}
            />
          </Tooltip>
          {/* ⚠️ LE CRAYON NE SE FIGE PLUS. Il était éteint sur une facture
              soldée ou annulée : elle ne pouvait alors plus s'ouvrir du tout,
              alors que la consulter est le geste le plus courant. Ouvrir est
              toujours permis — c'est l'ÉDITEUR qui décide de ce qui s'écrit, et
              il le fait déjà (champs éteints, étiquette « Non modifiable »). Le
              crayon fait donc exactement ce que fait le clic sur la ligne, et
              son infobulle le dit. */}
          <Tooltip title={LOCKED_STATUSES.includes(record.status)
            ? t('common.open', 'Ouvrir')
            : t('supplierInvoices.tooltipEdit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t('supplierInvoices.tooltipDownloadPdf')}>
            <Button
              type="text"
              icon={<FilePdfOutlined />}
              size="small"
              onClick={() => handleDownloadPdf(record)}
            />
          </Tooltip>
          {offrirLEcriture && (
          <Tooltip title={t('supplierInvoices.tooltipDuplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              size="small"
              onClick={() => duplicateMutation.mutate(record.id)}
            />
          </Tooltip>
          )}
          {record.status === 'draft' && offrirLaValidation && (
            <Tooltip title={t('supplierInvoices.tooltipReceive')}>
              <Popconfirm
                title={t('supplierInvoices.receiveConfirm')}
                onConfirm={() => sendMutation.mutate(record.id)}
                okText={t('supplierInvoices.yes')}
                cancelText={t('supplierInvoices.no')}
              >
                <Button type="text" icon={<CheckOutlined />} size="small" style={{ color: 'blue' }} />
              </Popconfirm>
            </Tooltip>
          )}
          {/* ⚠️ ÉTABLIR UN AVOIR : la seule façon de défaire une facture d'achat
              enregistrée. Un brouillon n'a rien à contre-passer — il se corrige
              ou s'efface ; une facture annulée non plus. Et l'on n'avoire pas un
              avoir. Même condition que la liste des factures clients. */}
          {!record.is_credit && record.status !== 'draft' && record.status !== 'cancelled' && offrirLEcriture && (
            <Tooltip title={t('supplierInvoices.actionCredit', 'Établir un avoir')}>
              <Popconfirm
                title={t(
                  'supplierInvoices.creditConfirm',
                  'Établir un avoir qui contre-passe cette facture fournisseur ?'
                )}
                onConfirm={() => creditMutation.mutate(record.id)}
                okText={t('supplierInvoices.yes')}
                cancelText={t('supplierInvoices.no')}
              >
                <Button type="text" icon={<RollbackOutlined />} size="small" style={{ color: '#722ed1' }} />
              </Popconfirm>
            </Tooltip>
          )}
          {offrirLEcriture && (
          <Tooltip title={record.is_archived
            ? t('supplierInvoices.actionUnarchive', 'Désarchiver')
            : t('supplierInvoices.actionArchive', 'Archiver')}>
            <Button
              type="text"
              icon={<InboxOutlined />}
              size="small"
              onClick={() => archiveMutation.mutate({ id: record.id, archived: !record.is_archived })}
              style={{ color: record.is_archived ? undefined : '#999' }}
            />
          </Tooltip>
          )}
          {record.status === 'draft' && offrirLEcriture && (
            <Popconfirm
              title={t('supplierInvoices.deleteConfirm')}
              onConfirm={() => deleteMutation.mutate(record.id)}
              okText={t('supplierInvoices.yes')}
              cancelText={t('supplierInvoices.no')}
            >
              <Tooltip title={t('supplierInvoices.tooltipDelete')}>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const formatCurrency = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const tableComponent = (
    <div>
      {isLoading ? (
        <Table loading={true} columns={columns} dataSource={[]} />
      ) : (
        <>
          {groupedInvoices.map((group) => (
            <div key={group.key} style={{ marginBottom: 24 }}>
              <div
                style={{
                  background: '#f0f0f0',
                  padding: '8px 16px',
                  fontWeight: 600,
                  fontSize: 14,
                  borderRadius: '4px 4px 0 0',
                  borderBottom: '2px solid #d9d9d9',
                }}
              >
                {group.label}
              </div>
              <Table
                dataSource={group.invoices}
                columns={columns}
                rowKey="id"
                pagination={false}
                // ⚠️ UN SEUL CLIC OUVRE LA FACTURE, DANS SON ÉDITEUR — il en
                // fallait deux, et c'était le seul geste d'ouverture de
                // l'écran. La colonne « Actions » arrête l'événement dans sa
                // propre cellule (voir onCell), pour qu'un bouton d'action ne
                // déclenche pas deux gestes à la fois.
                onRow={(record) => ({
                  onClick: () => handleEdit(record),
                  style: { cursor: 'pointer' },
                })}
                components={{
                  header: {
                    cell: ResizableHeaderCell,
                  },
                }}
                bordered
                size="small"
              />
              {/* Sous-totaux du mois - alignés avec les colonnes */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ background: '#fff7e6', fontWeight: 600 }}>
                    <td style={{ width: columnWidths.number, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.supplier, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.subject, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.date, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.due_date, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {t('supplierInvoices.subtotal')}
                    </td>
                    <td style={{ width: columnWidths.total_ht, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {formatCurrency(group.totalHT)} €
                    </td>
                    <td style={{ width: columnWidths.total_ttc, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {formatCurrency(group.totalTTC)} €
                    </td>
                    <td style={{ width: columnWidths.remaining, padding: '8px', border: '1px solid #ffd591', textAlign: 'right', color: group.totalRemaining > 0 ? '#fa8c16' : '#52c41a' }}>
                      {formatCurrency(group.totalRemaining)} €
                    </td>
                    <td style={{ width: columnWidths.status, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.actions, padding: '8px', border: '1px solid #ffd591' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {groupedInvoices.length === 0 && (
            <Table columns={columns} dataSource={[]} />
          )}

          {/* Totaux généraux - fixed */}
          {groupedInvoices.length > 0 && (
            <div
              style={{
                background: '#fff1f0',
                padding: '16px 24px',
                borderRadius: 0,
                border: '2px solid #ffa39e',
                borderBottom: 'none',
                position: 'fixed',
                bottom: 0,
                left: sidebarWidth,
                right: 0,
                zIndex: 100,
                boxShadow: '0 -2px 8px rgba(0,0,0,0.15)',
                transition: 'left 0.2s',
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                {t('supplierInvoices.grandTotals', { count: grandTotals.count })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('supplierInvoices.totalHT')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalHT)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('supplierInvoices.totalTVA')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalTVA)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('supplierInvoices.totalTTC')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#cf1322' }}>{formatCurrency(grandTotals.totalTTC)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('supplierInvoices.totalPaid')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>{formatCurrency(grandTotals.totalPaid)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('supplierInvoices.totalRemaining')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: grandTotals.totalRemaining > 0 ? '#fa8c16' : '#52c41a' }}>
                    {formatCurrency(grandTotals.totalRemaining)} €
                  </div>
                </div>
              </div>
            </div>
          )}

                  </>
      )}
    </div>
  )

  return (
    <div style={{ paddingBottom: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t('supplierInvoices.title')}</h1>
        <Space>
          {offrirLEcriture && (
            <>
              <Button icon={<ImportOutlined />} onClick={() => setImportModalVisible(true)}>
                {t('supplierInvoices.importElectronic')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
                {t('supplierInvoices.newInvoice')}
              </Button>
            </>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Input
          placeholder={t('supplierInvoices.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => refetch()}
        />
        <RangePicker
          placeholder={[t('supplierInvoices.dateStart'), t('supplierInvoices.dateEnd')]}
          format="DD/MM/YYYY"
          value={dateRange}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([dates[0], dates[1]])
            }
          }}
          allowClear={false}
          style={{ width: 280 }}
        />
        <Select
          allowClear
          placeholder={t('supplierInvoices.filterStatus', 'Tous les statuts')}
          style={{ width: 190 }}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v)}
          // « validated » n'est qu'un doublon de « sent » : c'est le même état,
          // sous le mot que l'autre route emploie. Le proposer donnerait deux
          // fois « Reçue » dans la liste déroulante.
          options={Object.entries(statusLabels)
            .filter(([value]) => value !== 'validated')
            .map(([value, label]) => ({ value, label }))}
        />
        <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}>
          {t('supplierInvoices.showArchived', 'Afficher les archivées')}
        </Checkbox>
        <Checkbox checked={showCredits} onChange={(e) => setShowCredits(e.target.checked)}>
          {t('supplierInvoices.showCredits', 'Afficher les avoirs')}
        </Checkbox>
        {(search || statusFilter) && (
          <Button
            icon={<FilterOutlined />}
            onClick={() => { setSearch(''); setStatusFilter(undefined) }}
          >
            {t('supplierInvoices.clearSearch')}
          </Button>
        )}
      </div>

      {tableComponent}

      {/* Import Electronic Invoice Modal */}
      <Modal
        title={t('supplierInvoices.importModalTitle')}
        open={importModalVisible}
        onCancel={() => { setImportModalVisible(false); resetImport() }}
        width={800}
        footer={null}
      >
        {importStep === 1 && (
          <div>
            <Alert
              type="info"
              message={t('supplierInvoices.importInfoMessage')}
              description={t('supplierInvoices.importInfoDescription')}
              style={{ marginBottom: 16 }}
            />
            <Form layout="vertical">
              <Form.Item label={t('supplierInvoices.fileLabel')}>
                <Upload.Dragger
                  accept=".xml,.pdf"
                  maxCount={1}
                  beforeUpload={(file) => { setImportFile(file); return false }}
                  onRemove={() => setImportFile(null)}
                  fileList={importFile ? [{ uid: '-1', name: importFile.name, status: 'done' as const }] : []}
                >
                  <p className="ant-upload-drag-icon"><ImportOutlined style={{ fontSize: 32, color: '#1677ff' }} /></p>
                  <p>{t('supplierInvoices.dragText')}</p>
                  <p style={{ color: '#888', fontSize: 12 }}>{t('supplierInvoices.supportedFormats')}</p>
                </Upload.Dragger>
              </Form.Item>
              <Button type="primary" onClick={handleImportAnalyze} loading={importLoading} disabled={!importFile}>
                {t('supplierInvoices.analyzeFile')}
              </Button>
            </Form>
          </div>
        )}

        {importStep === 2 && importParsedData && (
          <div>
            <Alert
              type="success"
              message={t('supplierInvoices.formatDetected', {
                format: importParsedData.format === 'peppol'
                  ? 'Peppol BIS 3.0'
                  : `Factur-X (${t('supplierInvoices.profile')} ${importParsedData.profile || t('supplierInvoices.unknown')})`,
              })}
              style={{ marginBottom: 16 }}
            />

            {importDuplicate?.exists && (
              <Alert
                type="error"
                message={t('supplierInvoices.duplicateTitle')}
                description={t('supplierInvoices.duplicateDescription', {
                  number: importParsedData.number,
                  internalNumber: importDuplicate.internal_number,
                  date: importDuplicate.created_at ? new Date(importDuplicate.created_at).toLocaleDateString('fr-FR') : t('supplierInvoices.unknownDate'),
                })}
                style={{ marginBottom: 16 }}
                showIcon
              />
            )}

            {/* Section fournisseur */}
            <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>{t('supplierInvoices.supplier')}</Text>
              <div style={{ marginBottom: 8 }}>
                <Text>{t('supplierInvoices.sellerDetected')} <Text strong>{importParsedData.seller_name || t('supplierInvoices.notSpecified')}</Text></Text>
                {importParsedData.seller_vat && <Text type="secondary"> — {t('supplierInvoices.vat')} {importParsedData.seller_vat}</Text>}
              </div>

              {importSupplierId ? (
                <Alert
                  type="success"
                  message={t('supplierInvoices.supplierIdentified', { name: suppliersData?.data?.find((s: any) => s.id === importSupplierId)?.name || importSupplierId })}
                  action={<Button size="small" onClick={() => setImportSupplierId('')}>{t('supplierInvoices.change')}</Button>}
                  style={{ marginBottom: 0 }}
                />
              ) : (
                <div>
                  <Alert
                    type="warning"
                    message={t('supplierInvoices.noSupplierFound')}
                    description={t('supplierInvoices.selectOrCreateSupplier')}
                    style={{ marginBottom: 12 }}
                  />
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={t('supplierInvoices.searchSupplierPlaceholder')}
                      value={importSupplierId || undefined}
                      onChange={setImportSupplierId}
                      options={suppliersData?.data?.map((s: any) => ({
                        value: s.id,
                        label: `${s.code} - ${s.name}${s.tva_intra ? ` (${s.tva_intra})` : ''}`,
                      })) || []}
                      style={{ width: '100%' }}
                      allowClear
                    />
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={async () => {
                        try {
                          const codeRes = await supplierAPI.getNextCode()
                          createSupplierForm.setFieldsValue({
                            name: importParsedData?.seller_name || '',
                            tva_intra: importParsedData?.seller_vat || '',
                            code: codeRes.data.code || 'FOUR-001',
                          })
                        } catch {
                          createSupplierForm.setFieldsValue({
                            name: importParsedData?.seller_name || '',
                            tva_intra: importParsedData?.seller_vat || '',
                            code: 'FOUR-001',
                          })
                        }
                        setCreateSupplierVisible(true)
                      }}
                    >
                      {t('supplierInvoices.createThisSupplier')}
                    </Button>
                  </Space>
                </div>
              )}
            </div>

            {/* Informations facture */}
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('supplierInvoices.colNumber')}><Text strong>{importParsedData.number || '-'}</Text></Descriptions.Item>
              <Descriptions.Item label={t('supplierInvoices.colDate')}>{importParsedData.date || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('supplierInvoices.colDueDate')}>{importParsedData.due_date || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('supplierInvoices.currency')}>{importParsedData.currency || 'EUR'}</Descriptions.Item>
              {importParsedData.subject && <Descriptions.Item label={t('supplierInvoices.colSubject')} span={2}>{importParsedData.subject}</Descriptions.Item>}
            </Descriptions>

            {/* Lignes d'articles */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>{t('supplierInvoices.invoiceLines', { count: importManualLines.length })}</Text>
              <Space>
                {(!importParsedData.lines || importParsedData.lines.length === 0) && (
                  <Tag color="orange">{t('supplierInvoices.profileNoDetail')}</Tag>
                )}
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setImportManualLines(prev => [...prev, {
                    key: prev.length,
                    description: '',
                    quantity: 1,
                    unit: 'pce',
                    unit_price: 0,
                    tva_rate: 20,
                    total_ht: 0,
                  }])}
                >
                  {t('supplierInvoices.addLine')}
                </Button>
              </Space>
            </div>
            <Table
              dataSource={importManualLines}
              columns={[
                {
                  title: t('supplierInvoices.lineDescription'), dataIndex: 'description', key: 'desc',
                  render: (v: string, _: any, idx: number) => (
                    <Input size="small" value={v} placeholder={t('supplierInvoices.articleDescriptionPlaceholder')}
                      onChange={e => { const lines = [...importManualLines]; lines[idx] = { ...lines[idx], description: e.target.value }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineQty'), dataIndex: 'quantity', key: 'qty', width: 80,
                  render: (v: number, _: any, idx: number) => (
                    <Input size="small" type="number" value={v} style={{ width: 70 }}
                      onChange={e => { const lines = [...importManualLines]; const q = parseFloat(e.target.value) || 0; lines[idx] = { ...lines[idx], quantity: q, total_ht: q * (lines[idx].unit_price || 0) }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineUnit'), dataIndex: 'unit', key: 'unit', width: 70,
                  render: (v: string, _: any, idx: number) => (
                    <Input size="small" value={v} style={{ width: 60 }}
                      onChange={e => { const lines = [...importManualLines]; lines[idx] = { ...lines[idx], unit: e.target.value }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineUnitPriceHT'), dataIndex: 'unit_price', key: 'price', width: 100,
                  render: (v: number, _: any, idx: number) => (
                    <Input size="small" type="number" value={v} style={{ width: 90 }} suffix="€"
                      onChange={e => { const lines = [...importManualLines]; const p = parseFloat(e.target.value) || 0; lines[idx] = { ...lines[idx], unit_price: p, total_ht: (lines[idx].quantity || 0) * p }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineDiscountPct'), dataIndex: 'discount_percent', key: 'disc', width: 65,
                  render: (v: number, _: any, idx: number) => (
                    <Input size="small" type="number" value={v ?? 0} style={{ width: 55 }}
                      onChange={e => { const lines = [...importManualLines]; lines[idx] = { ...lines[idx], discount_percent: parseFloat(e.target.value) || 0 }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineTvaPct'), dataIndex: 'tva_rate', key: 'tva', width: 70,
                  render: (v: number, _: any, idx: number) => (
                    <Input size="small" type="number" value={v} style={{ width: 60 }}
                      onChange={e => { const lines = [...importManualLines]; lines[idx] = { ...lines[idx], tva_rate: parseFloat(e.target.value) || 0 }; setImportManualLines(lines) }} />
                  ),
                },
                {
                  title: t('supplierInvoices.lineTotalHT'), dataIndex: 'total_ht', key: 'total', width: 100, align: 'right' as const,
                  render: (v: number) => <Text strong>{(v || 0).toFixed(2)} €</Text>,
                },
                {
                  title: '', key: 'del', width: 40,
                  render: (_: any, __: any, idx: number) => importManualLines.length > 1 ? (
                    <Button size="small" danger type="text" icon={<DeleteOutlined />}
                      onClick={() => setImportManualLines(prev => prev.filter((_, i) => i !== idx))} />
                  ) : null,
                },
              ]}
              size="small"
              pagination={false}
              style={{ marginBottom: 16 }}
              rowKey="key"
            />

            {/* Totaux */}
            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <Space direction="vertical" align="end">
                <Text>{t('supplierInvoices.totalHT')} : <Text strong>{importParsedData.total_ht?.toFixed(2) || '0.00'} €</Text></Text>
                <Text>{t('supplierInvoices.totalTVA')} : <Text strong>{importParsedData.total_tva?.toFixed(2) || '0.00'} €</Text></Text>
                <Text style={{ fontSize: 16 }}>{t('supplierInvoices.totalTTC')} : <Text strong style={{ fontSize: 16 }}>{importParsedData.total_ttc?.toFixed(2) || '0.00'} €</Text></Text>
              </Space>
            </div>

            <Divider />
            <Space>
              <Button onClick={() => { setImportStep(1); setImportSupplierId(''); setImportParsedData(null) }}>{t('supplierInvoices.back')}</Button>
              <Button type="primary" onClick={handleImportCreate} loading={importLoading} disabled={!importSupplierId}>
                {t('supplierInvoices.createInvoice')}
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* Modal création rapide fournisseur */}
      <Modal
        title={t('supplierInvoices.createSupplierTitle')}
        open={createSupplierVisible}
        onCancel={() => { setCreateSupplierVisible(false); createSupplierForm.resetFields() }}
        onOk={handleCreateSupplierQuick}
        okText={t('supplierInvoices.createSupplierOk')}
        cancelText={t('supplierInvoices.cancel')}
        width={500}
      >
        <Alert
          type="info"
          message={t('supplierInvoices.sellerPrefilledInfo')}
          style={{ marginBottom: 16 }}
        />
        <Form form={createSupplierForm} layout="vertical">
          <Form.Item name="name" label={t('supplierInvoices.supplierName')} rules={[{ required: true, message: t('supplierInvoices.nameRequired') }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label={t('supplierInvoices.supplierCode')} rules={[{ required: true, message: t('supplierInvoices.codeRequired') }]}>
                <Input placeholder={t('supplierInvoices.supplierCodePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tva_intra" label={t('supplierInvoices.tvaIntra')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="email" label={t('supplierInvoices.emailLabel')}>
                <Input type="email" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label={t('supplierInvoices.phoneLabel')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="address_line1" label={t('supplierInvoices.addressLabel')}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="postal_code" label={t('supplierInvoices.postalCode')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="city" label={t('supplierInvoices.cityLabel')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
