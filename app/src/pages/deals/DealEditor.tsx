import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Form,
  Input,
  Button,
  Row,
  Col,
  Select,
  InputNumber,
  DatePicker,
  message,
  Spin,
  Tabs,
  Tag,
  Card,
  Space,
  Timeline,
  Modal,
  Dropdown,
  Tooltip,
  Table,
  Alert,
  ConfigProvider,
  theme,
} from 'antd'
import {
  SaveOutlined,
  HistoryOutlined,
  UserOutlined,
  PlusOutlined,
  DeleteOutlined,
  PhoneOutlined,
  MailOutlined,
  CalendarOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  DownOutlined,
  SearchOutlined,
  FundOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  AlignLeftOutlined,
  CalculatorOutlined,
  MinusOutlined,
  HolderOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Drag handle component that only activates drag on the handle icon
function DragHandle({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef } = useSortable({ id })
  return (
    <span ref={setNodeRef} {...attributes} {...listeners} style={{ cursor: 'grab' }}>
      <HolderOutlined style={{ color: '#999' }} />
    </span>
  )
}

// Sortable row component - must be defined outside to prevent re-creation on each render
function SortableRow(props: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key'?: string }) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: props['data-row-key'] || '',
  })
  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return <tr {...props} ref={setNodeRef} style={style} />
}

import { dealAPI, clientAPI, articleAPI, quoteAPI, invoiceAPI, purchaseOrderAPI, settingsAPI } from '@/services/api'
import { useCanValidateDocuments, usePermissionsChargees, usePermissionStore } from '@/stores/permissionStore'
import SuiviDocument from '@/components/SuiviDocument'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import dayjs from 'dayjs'

interface DealEditorProps {
  tabId: string
  documentId?: string
}

interface Activity {
  id: string
  type: string
  description: string
  date: string
  completed: boolean
  created_at: string
}

interface Client {
  id: string
  code: string
  name: string
  address_line1?: string
  address_line2?: string
  postal_code?: string
  city?: string
  country?: string
  email?: string
  phone?: string
}

interface Article {
  id: string
  code: string
  name: string
  unit?: string
  purchase_price: number
  sale_price: number
  tva_rate: number
}

type LineType = 'article' | 'text' | 'page_break' | 'subtotal'

interface DealLine {
  key: string
  id?: string  // ID from database for existing lines
  line_type: LineType
  article_id?: string
  description: string
  quantity: number
  purchase_price: number
  coefficient: number
  unit_price: number
  discount_percent: number
  tva_rate: number
  unit?: string
  // Quantity tracking
  ordered_quantity?: number
  supplier_invoiced_quantity?: number
  client_invoiced_quantity?: number
  // Article info
  article?: {
    id: string
    code: string
    name: string
    is_composed?: boolean
  }
}

interface QuoteLine {
  id?: string
  article_id?: string
  description: string
  quantity: number
  unit_price: number
  discount?: number
  vat_rate: number
}

interface Quote {
  id: string
  number: string
  subject?: string
  date: string
  validity_date?: string
  status: string
  total_ht: number
  total_tva: number
  total_ttc: number
  notes?: string
  lines?: QuoteLine[]
  client?: {
    id: string
    name: string
  }
}

interface VATRate {
  id: string
  direction: 'input' | 'output'
  code: string
  country_code: string
  label: string
  rate: number
  is_default: boolean
}

const statusColors: Record<string, string> = {
  attente_validation: 'orange',
  en_cours: 'blue',
  termine: 'green',
  annule: 'red',
  // Legacy values for backwards compatibility
  in_progress: 'blue',
  completed: 'green',
  cancelled: 'red',
  proposal: 'blue',
}

const createEmptyLineWithRate = (vatRate: number = 20, lineType: LineType = 'article'): DealLine => ({
  key: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  line_type: lineType,
  article_id: undefined,
  description: lineType === 'page_break' ? '--- Saut de page ---' : lineType === 'subtotal' ? 'Sous-total' : '',
  quantity: 1,
  unit: '',
  purchase_price: 0,
  coefficient: 1,
  unit_price: 0,
  discount_percent: 0,
  tva_rate: vatRate,
})

export default function DealEditor({ tabId, documentId: initialDocumentId }: DealEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const peutValider = useCanValidateDocuments()
  const droitsConnus = usePermissionsChargees()

  // ⚠️ ET LE DROIT D'ÉCRIRE SUR L'AFFAIRE ELLE-MÊME.
  //
  // Les routes des affaires exigent désormais la capacité dérivée du type
  // (Api::canWriteType), celle que la matrice distribue sous « Affaires ».
  // Sans cette lecture, le niveau « Visualiser » ouvrait le dossier, laissait
  // tout saisir, et le refus n'arrivait qu'au clic sur « Enregistrer ».
  //
  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN : la matrice arrive par un
  // appel, et masquer avant sa réponse ferait clignoter les boutons.
  const peutEcrire = usePermissionStore((etat) => etat.canEdit('deals'))
  const montrerLEcriture = !droitsConnus || peutEcrire

  // Status labels (moved inside component for i18n)
  const statusLabels: Record<string, string> = {
    // ⚠️ Une affaire n'est ni numérotée ni scellée : elle n'a pas de brouillon,
    // et « en cours » EST son état validé (voir Deals::VALIDE). « Attente
    // validation » est un vrai statut d'affaire, et en sortir demande le droit
    // de valider — sinon le circuit ne vaudrait rien.
    attente_validation: t('dealEditor.status.attente_validation', 'Attente validation'),
    en_cours: t('dealEditor.status.en_cours'),
    termine: t('dealEditor.status.termine'),
    annule: t('dealEditor.status.annule'),
    // Legacy values for backwards compatibility
    in_progress: t('dealEditor.status.en_cours'),
    completed: t('dealEditor.status.termine'),
    cancelled: t('dealEditor.status.annule'),
    proposal: t('dealEditor.status.en_cours'),
  }

  const statusMenuItems = [
    { key: 'attente_validation', label: t('dealEditor.status.attente_validation', 'Attente validation') },
    { key: 'en_cours', label: t('dealEditor.status.en_cours') },
    { key: 'termine', label: t('dealEditor.status.termine') },
    { key: 'annule', label: t('dealEditor.status.annule') },
  ]

  const activityTypes = [
    { value: 'call', label: t('dealEditor.activityTypes.call'), icon: <PhoneOutlined /> },
    { value: 'email', label: t('dealEditor.activityTypes.email'), icon: <MailOutlined /> },
    { value: 'meeting', label: t('dealEditor.activityTypes.meeting'), icon: <CalendarOutlined /> },
    { value: 'note', label: t('dealEditor.activityTypes.note'), icon: <FileTextOutlined /> },
    { value: 'task', label: t('dealEditor.activityTypes.task'), icon: <CheckCircleOutlined /> },
  ]
  const watchedStatus = Form.useWatch('status', form)
  const [currentDocumentId, setCurrentDocumentId] = useState<string | undefined>(initialDocumentId)
  const documentId = currentDocumentId
  const isEdit = !!documentId
  const { updateTabTitle, setTabDirty, openDocumentTab, setTabDocumentId } = useDocumentTabsStore()
  const { primaryColor } = useThemeStore()
  const { sidebarWidth } = useSidebarStore()
  const { token } = theme.useToken()
  const [activityModalVisible, setActivityModalVisible] = useState(false)
  const [activityForm] = Form.useForm()
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [lines, setLines] = useState<DealLine[]>([createEmptyLineWithRate()])
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])

  // PDF Preview state
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 900, height: 80 })

  // Global discount state
  const [globalDiscountType, setGlobalDiscountType] = useState<'percent' | 'amount'>('percent')
  const [globalDiscountValue, setGlobalDiscountValue] = useState<number>(0)

  // State for price modification modal (purchase or sale price)
  const [priceModalOpen, setPriceModalOpen] = useState(false)
  const [priceModalData, setPriceModalData] = useState<{
    lineKey: string
    articleId: string
    articleName: string
    oldPrice: number
    newPrice: number
    priceType: 'purchase' | 'sale'
  } | null>(null)

  // Ref to track if lines have been initialized
  const linesInitializedRef = useRef(false)

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Fetch deal data
  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', documentId],
    queryFn: async () => {
      const response = await dealAPI.get(documentId!)
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch activities
  const { data: activitiesData, refetch: refetchActivities } = useQuery({
    queryKey: ['deal-activities', documentId],
    queryFn: async () => {
      const response = await dealAPI.getActivities(documentId!)
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch clients for dropdown
  const { data: clientsData, isLoading: isLoadingClients } = useQuery({
    queryKey: ['clients-for-editor'],
    queryFn: async () => {
      const response = await clientAPI.list({ page: 1, page_size: 1000 })
      return response.data
    },
  })

  // Fetch articles for dropdown
  const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
    queryKey: ['articles-for-editor'],
    queryFn: async () => {
      const response = await articleAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Fetch VAT rates (output direction for deals)
  const { data: vatRatesData } = useQuery({
    queryKey: ['vat-rates'],
    queryFn: async () => {
      const response = await settingsAPI.listVATRates()
      return response.data
    },
  })

  // Fetch payment terms
  const { data: paymentTermsData } = useQuery({
    queryKey: ['payment-terms'],
    queryFn: async () => {
      const response = await settingsAPI.listPaymentTerms()
      return response.data
    },
  })

  // State for selected payment term ID
  const [selectedPaymentTermId, setSelectedPaymentTermId] = useState<string | null>(null)

  // Filter VAT rates for output direction (deals are client-facing)
  const outputVatRates = useMemo(() => {
    const rates = vatRatesData?.vat_rates || []
    return rates.filter((r: VATRate) => r.direction === 'output')
  }, [vatRatesData])

  // Get default VAT rate (use configured default, or first available, or 0)
  const defaultVatRate = useMemo(() => {
    const defaultRate = outputVatRates.find((r: VATRate) => r.is_default)
    if (defaultRate) return defaultRate.rate
    if (outputVatRates.length > 0) return outputVatRates[0].rate
    return 0
  }, [outputVatRates])

  // Create empty line with default VAT rate
  const createEmptyLine = (lineType: LineType = 'article') => createEmptyLineWithRate(defaultVatRate, lineType)

  // Fetch linked quote if deal has quote_id
  const { data: linkedQuoteData } = useQuery({
    queryKey: ['quote', deal?.quote_id],
    queryFn: async () => {
      if (!deal?.quote_id) return null
      const response = await quoteAPI.get(deal.quote_id)
      return response.data as Quote
    },
    enabled: !!deal?.quote_id,
  })

  // Fetch linked purchase orders
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders-deal', documentId],
    queryFn: async () => {
      const response = await purchaseOrderAPI.list({ deal_id: documentId, page: 1, page_size: 100 })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch linked supplier invoices
  const { data: supplierInvoicesData } = useQuery({
    queryKey: ['supplier-invoices-deal', documentId],
    queryFn: async () => {
      const response = await invoiceAPI.list({ deal_id: documentId, type: 'supplier', page: 1, page_size: 100 })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch linked client invoices
  const { data: clientInvoicesData } = useQuery({
    queryKey: ['client-invoices-deal', documentId],
    queryFn: async () => {
      const response = await invoiceAPI.list({ deal_id: documentId, type: 'client', page: 1, page_size: 100 })
      const d = response.data
      // Ensure data is always an array
      return { ...d, data: Array.isArray(d?.data) ? d.data : [] }
    },
    enabled: isEdit,
  })

  // Fetch linked amendments
  const { data: amendmentsData } = useQuery({
    queryKey: ['amendments-deal', documentId],
    queryFn: async () => {
      const response = await dealAPI.getAmendments(documentId!)
      const d = response.data
      // Ensure data is always an array
      return { ...d, data: Array.isArray(d?.data) ? d.data : [] }
    },
    enabled: isEdit,
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => dealAPI.create(data),
    onSuccess: (response) => {
      message.success(t('dealEditor.messages.created'))
      queryClient.invalidateQueries({ queryKey: ['deals'] })
      const dealNumber = response.data?.number
      updateTabTitle(tabId, dealNumber ? t('dealEditor.tabTitle', { number: dealNumber }) : t('dealEditor.tabTitleNew'))
      setTabDirty(tabId, false)
      // Mettre à jour l'onglet avec l'ID de l'affaire créée pour afficher les onglets
      if (response.data?.id) {
        setCurrentDocumentId(response.data.id)
        setTabDocumentId(tabId, response.data.id)
      }
    },
    onError: () => {
      message.error(t('dealEditor.messages.createError'))
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => dealAPI.update(documentId!, data),
    onSuccess: () => {
      message.success(t('dealEditor.messages.updated'))
      queryClient.invalidateQueries({ queryKey: ['deals'] })
      queryClient.invalidateQueries({ queryKey: ['deal', documentId] })
      setTabDirty(tabId, false)
    },
    onError: () => {
      message.error(t('dealEditor.messages.updateError'))
    },
  })

  // Add activity mutation
  const addActivityMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => dealAPI.addActivity(documentId!, data),
    onSuccess: () => {
      message.success(t('dealEditor.messages.activityAdded'))
      refetchActivities()
      setActivityModalVisible(false)
      activityForm.resetFields()
    },
    onError: () => {
      message.error(t('dealEditor.messages.activityAddError'))
    },
  })

  // Mutation to update article price
  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      articleAPI.update(id, data),
    onSuccess: () => {
      message.success(t('dealEditor.messages.articlePriceUpdated'))
      queryClient.invalidateQueries({ queryKey: ['articles-for-editor'] })
    },
    onError: () => {
      message.error(t('dealEditor.messages.articlePriceUpdateError'))
    },
  })

  // Load deal data into form
  useEffect(() => {
    if (deal) {
      // Only initialize lines once to avoid overwriting user changes when articles are re-fetched
      if (linesInitializedRef.current) {
        return
      }

      form.setFieldsValue({
        ...deal,
        due_date: deal.due_date ? dayjs(deal.due_date) : undefined,
      })
      // Update tab title with deal number
      if (deal.number) {
        updateTabTitle(tabId, t('dealEditor.tabTitle', { number: deal.number }))
      }
      // Note: selectedClient is set in a separate effect below
      // Convert deal lines to our format
      if (deal.lines && deal.lines.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const convertedLines: DealLine[] = deal.lines.map((line: any, idx: number) => {
          const lineType = (line.line_type || 'article') as LineType
          const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
          const purchasePrice = line.purchase_price || article?.purchase_price || 0
          const coefficient = purchasePrice > 0 ? line.unit_price / purchasePrice : 1
          return {
            key: `line-${idx}`,
            id: line.id,  // Keep original ID for tracking
            line_type: lineType,
            article_id: line.article_id,
            description: line.description,
            quantity: line.quantity,
            purchase_price: purchasePrice,
            coefficient: Math.round(coefficient * 100) / 100,
            unit_price: line.unit_price,
            discount_percent: line.discount_percent || 0,
            tva_rate: line.tva_rate ?? defaultVatRate,
            unit: line.unit || article?.unit || '',
            // Quantity tracking
            ordered_quantity: line.ordered_quantity || 0,
            supplier_invoiced_quantity: line.supplier_invoiced_quantity || 0,
            client_invoiced_quantity: line.client_invoiced_quantity || 0,
            // Article info with is_composed
            article: line.article ? {
              id: line.article.id,
              code: line.article.code,
              name: line.article.name,
              is_composed: line.article.is_composed || false,
            } : (article ? {
              id: article.id,
              code: article.code,
              name: article.name,
              is_composed: article.is_composed || false,
            } : undefined),
          }
        })
        setLines(convertedLines.length > 0 ? convertedLines : [createEmptyLine()])
      }
      // Restore payment term selection by matching label
      if (deal.payment_terms && paymentTermsData?.payment_terms) {
        const matchingTerm = paymentTermsData.payment_terms.find(
          (term: { id: string; label: string }) => term.label === deal.payment_terms
        )
        if (matchingTerm) {
          setSelectedPaymentTermId(matchingTerm.id)
        }
      }
      linesInitializedRef.current = true
    } else if (!documentId) {
      // New deal
      if (!linesInitializedRef.current) {
        form.setFieldsValue({
          status: 'en_cours',
          expected_amount: 0,
        })
        setLines([createEmptyLine()])
        linesInitializedRef.current = true
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, clientsData, articlesData, paymentTermsData, form, tabId, updateTabTitle, documentId])

  // Set selected client when deal and clientsData are available
  // This is a separate effect to handle the case where clientsData loads after deal
  useEffect(() => {
    if (deal?.client_id && Array.isArray(clientsData?.data) && !selectedClient) {
      const client = clientsData.data.find((c: Client) => c.id === deal.client_id)
      if (client) {
        setSelectedClient(client)
      }
    }
  }, [deal?.client_id, clientsData?.data, selectedClient])

  // Calculate totals
  const totals = useMemo(() => {
    // Totaux des lignes de l'affaire uniquement
    let dealPurchase = 0
    let dealSaleHTBeforeDiscount = 0
    let dealTVABeforeDiscount = 0

    lines.forEach((line) => {
      // Skip non-article lines
      if (line.line_type !== 'article') return

      const lineTotal = line.quantity * line.unit_price
      const lineDiscount = (lineTotal * line.discount_percent) / 100
      const lineTotalAfterDiscount = lineTotal - lineDiscount
      const lineTVA = (lineTotalAfterDiscount * line.tva_rate) / 100

      dealPurchase += line.quantity * line.purchase_price
      dealSaleHTBeforeDiscount += lineTotalAfterDiscount
      dealTVABeforeDiscount += lineTVA
    })

    // Apply global discount on deal lines only
    let globalDiscount = 0
    if (globalDiscountType === 'percent' && globalDiscountValue > 0) {
      globalDiscount = (dealSaleHTBeforeDiscount * globalDiscountValue) / 100
    } else if (globalDiscountType === 'amount' && globalDiscountValue > 0) {
      globalDiscount = globalDiscountValue
    }

    const dealSaleHT = dealSaleHTBeforeDiscount - globalDiscount
    const discountRatio = dealSaleHTBeforeDiscount > 0 ? dealSaleHT / dealSaleHTBeforeDiscount : 1
    const dealTVA = dealTVABeforeDiscount * discountRatio
    const dealTTC = dealSaleHT + dealTVA

    // Totaux des avenants ENGAGÉS
    let amendmentPurchase = 0
    let amendmentSaleHT = 0
    let amendmentTVA = 0
    let amendmentTTC = 0

    if (Array.isArray(amendmentsData?.data)) {
      // ⚠️ UN AVENANT ENVOYÉ ENGAGE DÉJÀ L'AFFAIRE — ON NE COMPTE PAS QUE
      // « ACCEPTÉ ».
      //
      // Le serveur, lui, additionne tout ce qui n'est ni brouillon, ni refusé,
      // ni annulé (Deals::totalsOf) : GET /deals/{id} rendait donc bien
      // amendments_amount 40 et expected_amount 1 040 € pendant que ce bloc
      // affichait 1 000 €. L'écran et le dossier se contredisaient sur le
      // chiffre même que l'affaire existe pour donner.
      const engagedAmendments = amendmentsData.data.filter(
        (a: { status: string }) => !['draft', 'refused', 'cancelled'].includes(a.status)
      )
      engagedAmendments.forEach((a: { total_purchase_ht?: number; total_ht?: number; total_tva?: number; total_ttc?: number }) => {
        amendmentPurchase += a.total_purchase_ht || 0
        amendmentSaleHT += a.total_ht || 0
        amendmentTVA += a.total_tva || 0
        amendmentTTC += a.total_ttc || 0
      })
    }

    // Totaux combinés (affaire + avenants engagés) pour le footer
    const totalPurchase = dealPurchase + amendmentPurchase
    const totalSaleHT = dealSaleHT + amendmentSaleHT
    const totalTVA = dealTVA + amendmentTVA
    const totalTTC = dealTTC + amendmentTTC

    const margin = totalSaleHT - totalPurchase
    const marginPercent = totalPurchase > 0 ? (margin / totalPurchase) * 100 : 0

    return {
      // Totaux affaire seule (pour la ligne sous le tableau)
      dealPurchase: Math.round(dealPurchase * 100) / 100,
      dealSaleHTBeforeDiscount: Math.round(dealSaleHTBeforeDiscount * 100) / 100,
      dealSaleHT: Math.round(dealSaleHT * 100) / 100,
      dealTVA: Math.round(dealTVA * 100) / 100,
      dealTTC: Math.round(dealTTC * 100) / 100,
      // Totaux combinés (affaire + avenants engagés) pour le footer
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalSaleHTBeforeDiscount: Math.round((dealSaleHTBeforeDiscount + amendmentSaleHT) * 100) / 100,
      globalDiscount: Math.round(globalDiscount * 100) / 100,
      totalSaleHT: Math.round(totalSaleHT * 100) / 100,
      totalTVA: Math.round(totalTVA * 100) / 100,
      totalTTC: Math.round(totalTTC * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
    }
  }, [lines, globalDiscountType, globalDiscountValue, amendmentsData])

  // Calculate subtotal for a line (sum of article lines since start or last subtotal)
  const calculateSubtotalForLine = (lineIndex: number): number => {
    let subtotal = 0
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = lines[i]
      if (line.line_type === 'subtotal') break
      if (line.line_type === 'article') {
        const lineTotal = line.quantity * line.unit_price
        const lineDiscount = (lineTotal * line.discount_percent) / 100
        subtotal += lineTotal - lineDiscount
      }
    }
    return Math.round(subtotal * 100) / 100
  }

  // Handle client selection
  const handleClientChange = (clientId: string) => {
    const client = clientsData?.data?.find((c: Client) => c.id === clientId)
    setSelectedClient(client || null)
    form.setFieldsValue({ client_id: clientId })
    setTabDirty(tabId, true)
  }

  // ⚠️ LA PASSATION DE MAIN, QUAND ON N'A PAS LE DROIT DE VALIDER.
  //
  // Sortir une affaire d'attente demande « amsbm_validate_documents » : sans ce
  // bouton, le chargé d'affaires poserait le statut et resterait bloqué dessus,
  // sans savoir qui aller voir. La route prévient dans AMS Studio et par courriel, et
  // retient qui a demandé — pour lui rendre compte une fois le dossier approuvé.
  const requestValidationMutation = useMutation({
    mutationFn: (id: string) => dealAPI.requestValidation(id),
    onSuccess: (reponse) => {
      const prevenus = Number((reponse?.data as { notified?: number } | undefined)?.notified ?? 0)

      if (prevenus > 0) {
        message.success(
          t(
            'dealEditor.validationRequested',
            "Demande envoyée : {{count}} personne(s) prévenue(s). L'affaire attend sa validation.",
            { count: prevenus }
          )
        )
      } else {
        message.warning(
          t(
            'dealEditor.validationRequestedNobody',
            "L'affaire attend sa validation, mais personne n'a pu être prévenu : aucun compte n'a le droit de valider, ou leur adresse de courriel manque."
          ),
          8
        )
      }

      form.setFieldsValue({ status: 'attente_validation' })
      queryClient.invalidateQueries({ queryKey: ['deals'] })
      queryClient.invalidateQueries({ queryKey: ['deal', documentId] })
    },
    onError: (e: unknown) => {
      const corps = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data
      const phrase = corps?.message || corps?.error || ''

      message.error(
        phrase || t('dealEditor.validationRequestError', "La demande de validation n'est pas partie."),
        phrase ? 8 : undefined
      )
    },
  })

  // Handle status change
  const handleStatusChange = (status: string) => {
    form.setFieldsValue({ status })
    setTabDirty(tabId, true)

    // If editing, also save to server
    if (documentId) {
      updateMutation.mutate({ status })
    }
  }

  // Article selection handler
  const handleArticleSelect = (articleId: string, lineKey: string) => {
    const article = articlesData?.data?.find((a: Article) => a.id === articleId)
    if (article) {
      const purchasePrice = article.purchase_price || 0
      const salePrice = article.sale_price || 0
      const coefficient = purchasePrice > 0 ? salePrice / purchasePrice : 1
      setLines((prev) =>
        prev.map((line) =>
          line.key === lineKey
            ? {
                ...line,
                article_id: articleId,
                description: article.name,
                unit: article.unit || '',
                purchase_price: purchasePrice,
                coefficient: Math.round(coefficient * 100) / 100,
                unit_price: salePrice,
                tva_rate: defaultVatRate,
              }
            : line
        )
      )
      setTabDirty(tabId, true)
    }
  }

  // Line change handler
  const handleLineChange = (lineKey: string, field: string, value: number | string) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== lineKey) return line

        const updatedLine = { ...line, [field]: value }

        // Recalculate unit_price when coefficient changes
        if (field === 'coefficient') {
          updatedLine.unit_price = Math.round(updatedLine.purchase_price * (value as number) * 100) / 100
        }

        // Recalculate coefficient when unit_price changes
        if (field === 'unit_price') {
          updatedLine.coefficient = updatedLine.purchase_price > 0
            ? Math.round(((value as number) / updatedLine.purchase_price) * 100) / 100
            : 1
        }

        // Recalculate unit_price when purchase_price changes (keeping coefficient)
        if (field === 'purchase_price') {
          updatedLine.unit_price = Math.round((value as number) * updatedLine.coefficient * 100) / 100
        }

        return updatedLine
      })
    )
    setTabDirty(tabId, true)
  }

  // Handle purchase price change - opens modal to ask if it's for document only or also update article
  const handlePurchasePriceChange = (lineKey: string, newPrice: number) => {
    const line = lines.find((l) => l.key === lineKey)
    if (!line || !line.article_id) {
      return
    }

    const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
    if (!article) {
      return
    }

    if (article.purchase_price === newPrice) {
      return
    }

    setPriceModalData({
      lineKey,
      articleId: line.article_id,
      articleName: article.name,
      oldPrice: article.purchase_price,
      newPrice,
      priceType: 'purchase',
    })
    setPriceModalOpen(true)
  }

  // Handle sale price change - opens modal to ask if it's for document only or also update article
  const handleSalePriceChange = (lineKey: string, newPrice: number) => {
    const line = lines.find((l) => l.key === lineKey)
    if (!line || !line.article_id) {
      return
    }

    const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
    if (!article) {
      return
    }

    if (article.sale_price === newPrice) {
      return
    }

    setPriceModalData({
      lineKey,
      articleId: line.article_id,
      articleName: article.name,
      oldPrice: article.sale_price,
      newPrice,
      priceType: 'sale',
    })
    setPriceModalOpen(true)
  }

  // Apply the price change based on user choice
  const handlePriceModalConfirm = async (updateArticle: boolean) => {
    if (!priceModalData) return

    const articleField = priceModalData.priceType === 'purchase' ? 'purchase_price' : 'sale_price'

    if (updateArticle) {
      await updateArticleMutation.mutateAsync({
        id: priceModalData.articleId,
        data: { [articleField]: priceModalData.newPrice },
      })
    }

    setPriceModalOpen(false)
    setPriceModalData(null)
  }

  const handleAddLine = (lineType: LineType = 'article') => {
    const newLine = createEmptyLine(lineType)
    setLines((prev) => {
      if (selectedLineKey) {
        const selectedIndex = prev.findIndex((line) => line.key === selectedLineKey)
        if (selectedIndex !== -1) {
          const newLines = [...prev]
          newLines.splice(selectedIndex + 1, 0, newLine)
          return newLines
        }
      }
      return [...prev, newLine]
    })
    setSelectedLineKey(newLine.key)
    setTabDirty(tabId, true)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setLines((items) => {
        const oldIndex = items.findIndex((item) => item.key === active.id)
        const newIndex = items.findIndex((item) => item.key === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
      setTabDirty(tabId, true)
    }
  }

  const handleRemoveLine = (lineKey: string) => {
    setLines((prev) => prev.filter((line) => line.key !== lineKey))
    setTabDirty(tabId, true)
  }

  const handleDuplicateLine = (lineKey: string) => {
    setLines((prev) => {
      const lineIndex = prev.findIndex((line) => line.key === lineKey)
      if (lineIndex === -1) return prev

      const lineToDuplicate = prev[lineIndex]
      const duplicatedLine: DealLine = {
        ...lineToDuplicate,
        key: `line-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        id: undefined, // New line, no database ID
      }

      const newLines = [...prev]
      newLines.splice(lineIndex + 1, 0, duplicatedLine)
      return newLines
    })
    setTabDirty(tabId, true)
  }

  // Handler pour supprimer les lignes sélectionnées
  const handleDeleteSelection = () => {
    if (selectedRowKeys.length === 0) return
    setLines((prev) => prev.filter((line) => !selectedRowKeys.includes(line.key)))
    setSelectedRowKeys([])
    setTabDirty(tabId, true)
  }

  // Handler pour dupliquer les lignes sélectionnées
  const handleDuplicateSelection = () => {
    if (selectedRowKeys.length === 0) return
    setLines((prev) => {
      const newLines = [...prev]
      const linesToDuplicate = prev.filter((line) => selectedRowKeys.includes(line.key))
      const lastSelectedIndex = Math.max(
        ...selectedRowKeys.map((key) => prev.findIndex((line) => line.key === key))
      )
      const duplicatedLines = linesToDuplicate.map((line) => ({
        ...line,
        key: `line-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        id: undefined,
      }))
      newLines.splice(lastSelectedIndex + 1, 0, ...duplicatedLines)
      return newLines
    })
    setSelectedRowKeys([])
    setTabDirty(tabId, true)
  }

  // ⚠️ Rend VRAI seulement si l'affaire est réellement enregistrée : la demande
  // de validation s'y enchaîne, et prévenir un responsable d'un dossier qui n'a
  // pas pu s'écrire lui ferait ouvrir la version précédente.
  const handleSave = async (): Promise<boolean> => {
    let values

    try {
      values = await form.validateFields()
    } catch {
      message.error(t('dealEditor.messages.formErrors'))

      return false
    }

    try {
      const data = {
        ...values,
        // ⚠️ Le jour choisi, sans fuseau — même piège que la date d'un échange
        // plus bas. Sérialisé tel quel, un dayjs part en ISO UTC : au Luxembourg
        // le 16/08 à 00:00 devenait « 2026-08-15T22:00:00.000Z », et c'est cette
        // chaîne-là qui se rangeait en méta d'échéance, à la veille du jour saisi.
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : '',
        lines: lines
          .filter((line) => line.line_type !== 'article' || line.description || line.article_id)
          .map((line) => ({
            id: line.id || undefined,  // Send existing line ID for update
            line_type: line.line_type || 'article',
            article_id: line.article_id || null,
            description: line.description || '',
            quantity: line.quantity,
            unit: '',
            purchase_price: line.purchase_price,
            unit_price: line.unit_price,
            discount_percent: line.discount_percent || 0,
            tva_rate: line.tva_rate ?? defaultVatRate,
          })),
      }

      if (isEdit) {
        await updateMutation.mutateAsync(data)
      } else {
        await createMutation.mutateAsync(data)
      }

      return true
    } catch {
      // ⚠️ Pas de « erreurs dans le formulaire » ici : le formulaire est valide,
      // c'est le serveur qui a refusé, et les mutations disent déjà pourquoi.
      // L'ancien message envoyait chercher une faute de saisie inexistante.
      return false
    }
  }

  const handleAddActivity = async () => {
    try {
      const values = await activityForm.validateFields()
      addActivityMutation.mutate({
        ...values,
        // ⚠️ Le jour choisi, sans fuseau : toISOString() convertit en UTC et,
        // au Luxembourg, le 16/08 à 00:00 partait en « 2026-08-15T22:00 » —
        // l'échange était enregistré la veille de sa date. Le DatePicker ne
        // saisit qu'un jour, il n'y a donc pas d'heure à perdre.
        date: values.date.format('YYYY-MM-DD'),
      })
    } catch {
      // Form validation failed
    }
  }

  // Open client tab
  const handleOpenClient = () => {
    const clientId = form.getFieldValue('client_id')
    if (clientId) {
      const client = clientsData?.data?.find((c: Client) => c.id === clientId)
      openDocumentTab('client', clientId, client ? t('dealEditor.tabs.client', { name: client.name }) : t('dealEditor.tabs.clientGeneric'))
    }
  }

  // Open quote tab
  const handleOpenQuote = () => {
    if (deal?.quote_id && linkedQuoteData) {
      openDocumentTab('quote', deal.quote_id, t('dealEditor.tabs.quote', { number: linkedQuoteData.number }))
    }
  }

  // PDF Preview for linked quote
  const handlePreviewQuotePdf = async () => {
    if (!deal?.quote_id) return
    setPdfPreviewLoading(true)
    setPdfPreviewOpen(true)

    try {
      const response = await quoteAPI.getPdf(deal.quote_id)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
    } catch {
      message.error(t('dealEditor.messages.pdfLoadError'))
    } finally {
      setPdfPreviewLoading(false)
    }
  }

  const handleDownloadQuotePdf = async () => {
    if (!deal?.quote_id || !linkedQuoteData) return
    try {
      const response = await quoteAPI.getPdf(deal.quote_id)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `devis_${linkedQuoteData.number}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('dealEditor.messages.pdfDownloaded'))
    } catch {
      message.error(t('dealEditor.messages.pdfDownloadError'))
    }
  }

  const closePdfPreview = () => {
    setPdfPreviewOpen(false)
    if (pdfPreviewUrl) {
      window.URL.revokeObjectURL(pdfPreviewUrl)
      setPdfPreviewUrl(null)
    }
  }

  // Get available lines for supplier documents (non-composed articles, not fully ordered/invoiced)
  const getAvailableLinesForSupplier = (type: 'order' | 'invoice') => {
    return lines.filter(line => {
      if (line.line_type !== 'article') return false
      // Only non-composed articles
      if (line.article?.is_composed) return false
      // Check available quantity
      const availableQty = type === 'order'
        ? line.quantity - (line.ordered_quantity || 0)
        : line.quantity - (line.supplier_invoiced_quantity || 0)
      return availableQty > 0
    }).map(line => {
      // Get current purchase price from article data, not from deal line
      const currentArticle = articlesData?.data?.find((a: Article) => a.id === line.article_id)
      const currentPurchasePrice = currentArticle?.purchase_price ?? line.purchase_price
      return {
        deal_line_id: line.id,
        article_id: line.article_id,
        description: line.description,
        quantity: type === 'order'
          ? line.quantity - (line.ordered_quantity || 0)
          : line.quantity - (line.supplier_invoiced_quantity || 0),
        unit: line.unit,
        unit_price: currentPurchasePrice,
        discount_percent: 0,
        tva_rate: line.tva_rate,
        line_type: 'article',
      }
    })
  }

  // Get available lines for client invoices (not fully invoiced)
  const getAvailableLinesForClient = () => {
    return lines.filter(line => {
      if (line.line_type !== 'article') return false
      const availableQty = line.quantity - (line.client_invoiced_quantity || 0)
      return availableQty > 0
    }).map(line => ({
      deal_line_id: line.id,
      article_id: line.article_id,
      description: line.description,
      quantity: line.quantity - (line.client_invoiced_quantity || 0),
      unit: line.unit,
      unit_price: line.unit_price,
      discount_percent: line.discount_percent,
      tva_rate: line.tva_rate,
      line_type: 'article',
    }))
  }

  // Create purchase order linked to this deal
  const handleCreatePurchaseOrder = () => {
    const availableLines = getAvailableLinesForSupplier('order')
    if (availableLines.length === 0) {
      message.warning(t('dealEditor.messages.allLinesOrdered'))
      return
    }
    openDocumentTab('purchase-order', undefined, t('dealEditor.tabs.newPurchaseOrder'), {
      deal_id: documentId,
      subject: form.getFieldValue('subject') || deal?.subject || '',
      lines: availableLines,
    })
  }

  // Create supplier invoice linked to this deal
  const handleCreateSupplierInvoice = () => {
    const availableLines = getAvailableLinesForSupplier('invoice')
    if (availableLines.length === 0) {
      message.warning(t('dealEditor.messages.allLinesInvoiced'))
      return
    }
    openDocumentTab('supplier-invoice', undefined, t('dealEditor.tabs.newSupplierInvoice'), {
      deal_id: documentId,
      subject: form.getFieldValue('subject') || deal?.subject || '',
      deal_address: form.getFieldValue('deal_address') || deal?.deal_address || '',
      lines: availableLines,
    })
  }

  // Create client invoice linked to this deal
  const handleCreateClientInvoice = () => {
    const availableLines = getAvailableLinesForClient()
    if (availableLines.length === 0) {
      message.warning(t('dealEditor.messages.allLinesInvoiced'))
      return
    }
    openDocumentTab('invoice', undefined, t('dealEditor.tabs.newClientInvoice'), {
      deal_id: documentId,
      client_id: selectedClient?.id,
      subject: form.getFieldValue('subject') || deal?.subject || '',
      lines: availableLines,
    })
  }

  // Open purchase order
  const handleOpenPurchaseOrder = (id: string, number: string) => {
    openDocumentTab('purchase-order', id, t('dealEditor.tabs.purchaseOrder', { number }))
  }

  // Open supplier invoice
  const handleOpenSupplierInvoice = (id: string, number: string) => {
    openDocumentTab('supplier-invoice', id, t('dealEditor.tabs.invoice', { number }))
  }

  // Open client invoice
  const handleOpenClientInvoice = (id: string, number: string) => {
    openDocumentTab('invoice', id, t('dealEditor.tabs.invoice', { number }))
  }

  // Create amendment linked to this deal
  const handleCreateAmendment = () => {
    openDocumentTab('amendment', undefined, t('dealEditor.tabs.newAmendment'), {
      deal_id: documentId,
      client_id: selectedClient?.id,
    })
  }

  // Open amendment
  const handleOpenAmendment = (id: string, number: string) => {
    openDocumentTab('amendment', id, t('dealEditor.tabs.amendment', { number }))
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  const clients = clientsData?.data || []
  const activities: Activity[] = activitiesData?.data || deal?.activities || []

  const getActivityIcon = (type: string) => {
    const activityType = activityTypes.find((a) => a.value === type)
    return activityType?.icon || <FileTextOutlined />
  }

  const getActivityColor = (type: string) => {
    const colors: Record<string, string> = {
      call: 'blue',
      email: 'cyan',
      meeting: 'purple',
      note: 'orange',
      task: 'green',
    }
    return colors[type] || 'gray'
  }

  const isNewDeal = !documentId
  // Le tag de statut se pilote par la valeur SURVEILLÉE du formulaire :
  // form.getFieldValue() ne provoque aucun rendu, si bien que le tag d'une
  // affaire pas encore enregistrée serait resté sur « En cours » quel que soit
  // le choix fait dans le menu.
  const currentStatus = watchedStatus || deal?.status || 'en_cours'

  // Table columns for deal lines
  const lineColumns = [
    {
      title: '',
      dataIndex: 'drag',
      key: 'drag',
      width: 40,
      render: (_: unknown, record: DealLine) => <DragHandle id={record.key} />,
    },
    {
      title: t('dealEditor.columns.article'),
      dataIndex: 'article_id',
      key: 'article_id',
      width: 200,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        return (
          <Select
            showSearch
            placeholder={t('dealEditor.placeholders.selectArticle')}
            optionFilterProp="label"
            loading={isLoadingArticles}
            value={record.article_id}
            onChange={(value) => handleArticleSelect(value, record.key)}
            options={articlesData?.data?.map((a: Article) => ({
              value: a.id,
              label: `${a.code} - ${a.name}`,
            })) || []}
            style={{ width: '100%' }}
            popupMatchSelectWidth={false}
            dropdownStyle={{ minWidth: 350 }}
            allowClear
          />
        )
      },
    },
    {
      title: t('common.description'),
      dataIndex: 'description',
      key: 'description',
      width: 250,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type === 'text') {
          return (
            <Input.TextArea
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('dealEditor.placeholders.freeText')}
              autoSize={{ minRows: 1, maxRows: 4 }}
              style={{ fontStyle: 'italic' }}
            />
          )
        }
        if (record.line_type === 'page_break') {
          return (
            <div
              style={{
                borderTop: `2px dashed ${token.colorBorder}`,
                borderBottom: `2px dashed ${token.colorBorder}`,
                textAlign: 'center',
                color: token.colorTextSecondary,
                padding: '8px 0',
                fontStyle: 'italic',
                background: token.colorBgLayout
              }}
            >
              {t('dealEditor.pageBreak')}
            </div>
          )
        }
        if (record.line_type === 'subtotal') {
          return (
            <Input
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('dealEditor.subtotal')}
              style={{ fontWeight: 'bold' }}
            />
          )
        }
        return (
          <Input
            value={record.description}
            onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
            placeholder={t('common.description')}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.qty')}</div>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.quantity}
            onChange={(value) => handleLineChange(record.key, 'quantity', value || 0)}
            min={0.001}
            precision={3}
            controls={false}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.unit')}</div>,
      dataIndex: 'unit',
      key: 'unit',
      align: 'center' as const,
      width: 60,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        return <span style={{ color: '#888' }}>{record.unit || t('dealEditor.unitDefault')}</span>
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.purchasePrice')}</div>,
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      align: 'right' as const,
      width: 100,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.purchase_price || 0
        return (
          <InputNumber
            value={record.purchase_price}
            onChange={(value) => handleLineChange(record.key, 'purchase_price', value || 0)}
            onBlur={() => {
              if (record.article_id && record.purchase_price !== originalPrice) {
                handlePurchasePriceChange(record.key, record.purchase_price)
              }
            }}
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.coefficient')}</div>,
      dataIndex: 'coefficient',
      key: 'coefficient',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.coefficient}
            onChange={(value) => handleLineChange(record.key, 'coefficient', value || 1)}
            min={0}
            step={0.1}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.salePrice')}</div>,
      dataIndex: 'unit_price',
      key: 'unit_price',
      align: 'right' as const,
      width: 100,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.sale_price || 0
        return (
          <InputNumber
            value={record.unit_price}
            onChange={(value) => handleLineChange(record.key, 'unit_price', value || 0)}
            onBlur={() => {
              if (record.article_id && record.unit_price !== originalPrice) {
                handleSalePriceChange(record.key, record.unit_price)
              }
            }}
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.discountPercent')}</div>,
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value || 0)}
            min={0}
            max={100}
            precision={1}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.vat')}</div>,
      dataIndex: 'tva_rate',
      key: 'tva_rate',
      align: 'right' as const,
      width: 80,
      render: (_: unknown, record: DealLine) => {
        if (record.line_type !== 'article') return null
        const configuredOptions = outputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
        const fallbackOptions = [
          // ⚠️ PAS DE TAUX FRANÇAIS CODÉS EN DUR ICI.
          //
          // Le serveur refuse désormais un taux absent du paramétrage — avant, il
          // l'enregistrait à 0 % sans le dire. Proposer 20 / 10 / 5,5 / 2,1 % à une
          // entreprise luxembourgeoise reviendrait à l'envoyer droit dans un refus.
          { value: 0, label: '0%' },
        ]
        const baseOptions = configuredOptions.length > 0 ? configuredOptions : fallbackOptions
        const options = baseOptions.some((o: { value: number; label: string }) => o.value === record.tva_rate)
          ? baseOptions
          : [...baseOptions, { value: record.tva_rate, label: `${record.tva_rate}%` }]
        return (
          <Select
            value={record.tva_rate}
            onChange={(value) => handleLineChange(record.key, 'tva_rate', value)}
            options={options}
            style={{ width: '100%' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('dealEditor.columns.totalHT')}</div>,
      key: 'total',
      align: 'right' as const,
      width: 110,
      render: (_: unknown, record: DealLine, index: number) => {
        if (record.line_type === 'text' || record.line_type === 'page_break') return null
        if (record.line_type === 'subtotal') {
          const subtotal = calculateSubtotalForLine(index)
          return <strong style={{ display: 'block', textAlign: 'right', color: '#52c41a' }}>{subtotal.toFixed(2)} €</strong>
        }
        const lineTotal = record.quantity * record.unit_price
        const discount = (lineTotal * record.discount_percent) / 100
        const total = lineTotal - discount
        return <strong style={{ display: 'block', textAlign: 'right' }}>{total.toFixed(2)} €</strong>
      },
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: DealLine) => (
        <Space size="small">
          <Tooltip title={t('dealEditor.duplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleDuplicateLine(record.key)}
            />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveLine(record.key)}
              disabled={lines.length <= 1}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: token.colorBgLayout,
        }}
      >
        <Space size="middle">
          <h2 style={{ margin: 0 }}>
            <FundOutlined style={{ marginRight: 8 }} />
            {isNewDeal ? t('dealEditor.newDeal') : t('dealEditor.dealTitle', { number: deal?.number || '' })}
          </h2>
          {/* ⚠️ Le statut se choisit AUSSI à la création. Le tag n'apparaissait
              qu'une fois l'affaire enregistrée : impossible d'ouvrir directement
              un dossier « Terminé » ou « Annulé » — il fallait l'enregistrer en
              cours, puis le corriger. Sans documentId, handleStatusChange se
              contente de poser le champ, que handleSave emporte. */}
          {/* ⚠️ CHANGER D'ÉTAT EST UNE ÉCRITURE. Sans le droit sur l'affaire, le
              menu ne mène qu'à un 403 : l'étiquette reste, elle dit l'état, mais
              elle ne s'ouvre plus. */}
          {montrerLEcriture ? (
            <Dropdown
              menu={{
                items: statusMenuItems,
                onClick: ({ key }) => handleStatusChange(key),
                selectedKeys: [currentStatus],
              }}
              trigger={['click']}
            >
              <Tag
                color={statusColors[currentStatus] || 'default'}
                style={{ cursor: 'pointer', fontSize: 14, padding: '4px 12px' }}
              >
                {statusLabels[currentStatus] || currentStatus} <DownOutlined />
              </Tag>
            </Dropdown>
          ) : (
            <Tag
              color={statusColors[currentStatus] || 'default'}
              style={{ fontSize: 14, padding: '4px 12px' }}
            >
              {statusLabels[currentStatus] || currentStatus}
            </Tag>
          )}
        </Space>
        <Space>
          {/* ⚠️ LE BOUTON N'EXISTE QUE POUR CELUI QUI NE PEUT PAS VALIDER.
              Chez le responsable, il ferait doublon avec le menu de statut — et
              lui ferait s'envoyer un courriel à lui-même. Une affaire terminée
              ou annulée ne se remet pas en validation : la route le refuse. */}
          {documentId &&
            droitsConnus &&
            peutEcrire &&
            !peutValider &&
            (currentStatus === 'en_cours' || currentStatus === 'attente_validation') && (
              <Tooltip
                title={t(
                  'dealEditor.requestValidationHelp',
                  "Prévient les personnes qui ont le droit de valider, et place l'affaire en attente de validation."
                )}
              >
                <Button
                  icon={<AuditOutlined />}
                  loading={requestValidationMutation.isPending}
                  disabled={currentStatus === 'attente_validation'}
                  // ⚠️ ON ENREGISTRE AVANT DE PRÉVENIR : le responsable ouvrira
                  // l'affaire TELLE QU'ELLE EST EN BASE.
                  onClick={async () => {
                    const enregistre = await handleSave()

                    if (enregistre) requestValidationMutation.mutate(documentId)
                  }}
                >
                  {t('dealEditor.requestValidation', 'Demande de validation')}
                </Button>
              </Tooltip>
            )}
          {deal?.quote_id && linkedQuoteData && (
            <>
              <Button icon={<FileTextOutlined />} onClick={handleOpenQuote}>
                {t('dealEditor.viewQuote', { number: linkedQuoteData.number })}
              </Button>
              <Button icon={<FileSearchOutlined />} onClick={handlePreviewQuotePdf}>
                {t('dealEditor.pdfPreview')}
              </Button>
              <Button icon={<FilePdfOutlined />} onClick={handleDownloadQuotePdf}>
                {t('dealEditor.downloadPdf')}
              </Button>
            </>
          )}
          {montrerLEcriture && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {t('common.save')}
            </Button>
          )}
        </Space>
      </div>

      {/* Form Content */}
      <div style={{ flex: 1 }}>
        <div style={{ padding: '24px', paddingBottom: 80 }}>
        {/* ⚠️ UN ÉCRAN GRIS SANS EXPLICATION EST UNE PANNE, PAS UN DROIT.
            Sans « Enregistrer » ni menu de statut, on ne sait pas si le dossier
            est verrouillé, s'il manque un droit, ou si l'écran est cassé. On le
            dit, et on dit à qui le demander. */}
        {droitsConnus && !peutEcrire && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('dealEditor.readOnlyTitle', 'Consultation')}
            description={t(
              'dealEditor.readOnlyHelp',
              "Vous ouvrez ce dossier en lecture : votre rôle n'a pas le droit d'écrire sur les affaires. Demandez le niveau « Créer/modifier » sur le module Affaires à un responsable."
            )}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          // ⚠️ ET LES CHAMPS AVEC. Un dossier qui se saisit entièrement pour
          // n'offrir aucun « Enregistrer » à la fin est pire qu'un refus franc :
          // « disabled » sur le formulaire descend jusqu'à chaque champ.
          disabled={!montrerLEcriture}
          initialValues={{
            status: 'en_cours',
            probability: 50,
            expected_amount: 0,
          }}
          onValuesChange={() => setTabDirty(tabId, true)}
        >
          <Row gutter={24}>
            {/* Colonne 1: Informations principales */}
            <Col span={6}>
              <Form.Item label={t('dealEditor.fields.client')}>
                <Space.Compact style={{ width: '100%' }}>
                  <Form.Item name="client_id" noStyle>
                    <Select
                      showSearch
                      placeholder={isLoadingClients ? t('common.loading') : t('dealEditor.placeholders.selectClient')}
                      optionFilterProp="label"
                      loading={isLoadingClients}
                      value={selectedClient?.id}
                      onChange={handleClientChange}
                      options={clients.map((c: Client) => ({
                        value: c.id,
                        label: `${c.code} - ${c.name}`,
                      }))}
                      style={{ flex: 1 }}
                      allowClear
                    />
                  </Form.Item>
                  <Tooltip title={t('dealEditor.openClientSheet')}>
                    <Button
                      icon={<SearchOutlined />}
                      onClick={handleOpenClient}
                      disabled={!selectedClient}
                    />
                  </Tooltip>
                </Space.Compact>
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label={t('dealEditor.fields.creationDate')}>
                    <DatePicker
                      style={{ width: '100%' }}
                      format="DD/MM/YYYY"
                      value={deal?.created_at ? dayjs(deal.created_at) : dayjs()}
                      disabled
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="due_date" label={t('dealEditor.fields.dueDate')}>
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t('dealEditor.fields.paymentTerm')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('dealEditor.placeholders.selectPaymentTerm')}
                  value={selectedPaymentTermId}
                  onChange={(value) => {
                    setSelectedPaymentTermId(value)
                    if (value) {
                      const term = paymentTermsData?.payment_terms?.find((pt: { id: string; days: number }) => pt.id === value)
                      if (term) {
                        // Store payment terms label for PDF
                        form.setFieldValue('payment_terms', term.label)
                        // Calculate due date from current date + payment term days
                        const currentDate = form.getFieldValue('expected_close_date') || dayjs()
                        form.setFieldValue('due_date', dayjs(currentDate).add(term.days, 'day'))
                      }
                    } else {
                      form.setFieldValue('payment_terms', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {paymentTermsData?.payment_terms?.map((term: { id: string; label: string; days: number }) => (
                    <Select.Option key={term.id} value={term.id}>
                      {term.label} ({term.days === 0 ? t('dealEditor.cash') : t('dealEditor.days', { days: term.days })})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="status" label={t('common.status')} hidden>
                <Input />
              </Form.Item>
            </Col>

            {/* Colonne 2: Coordonnées client */}
            <Col span={6}>
              <Form.Item label={t('dealEditor.fields.clientDetails')}>
                <Input.TextArea
                  value={
                    selectedClient
                      ? [
                          selectedClient.name,
                          selectedClient.address_line1,
                          selectedClient.address_line2,
                          [selectedClient.postal_code, selectedClient.city].filter(Boolean).join(' '),
                          selectedClient.country,
                          selectedClient.email ? t('dealEditor.emailPrefix', { email: selectedClient.email }) : null,
                          selectedClient.phone ? t('dealEditor.phonePrefix', { phone: selectedClient.phone }) : null,
                        ]
                          .filter(Boolean)
                          .join('\n')
                      : ''
                  }
                  disabled
                  rows={7}
                  style={{ backgroundColor: token.colorFillTertiary }}
                />
              </Form.Item>
            </Col>

            {/* Colonne 3: Coordonnées affaire */}
            <Col span={6}>
              <Form.Item name="deal_address" label={t('dealEditor.fields.dealDetails')}>
                <Input.TextArea
                  rows={7}
                  placeholder={t('dealEditor.placeholders.dealAddress')}
                />
              </Form.Item>
            </Col>

            {/* Colonne 4: Notes */}
            <Col span={6}>
              <Form.Item name="notes" label={t('dealEditor.fields.notes')}>
                <Input.TextArea rows={7} placeholder={t('dealEditor.placeholders.notes')} />
              </Form.Item>
            </Col>
          </Row>
          <Row>
            <Col span={24}>
              <Form.Item name="subject" label={t('dealEditor.fields.subject')} rules={[{ required: true, message: t('dealEditor.validation.subjectRequired') }]}>
                <Input.TextArea rows={2} placeholder={t('dealEditor.placeholders.subject')} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{t('dealEditor.dealLines')}</span>
          <Space size="middle" style={montrerLEcriture ? undefined : { display: 'none' }}>
            {selectedRowKeys.length > 0 && (
              <>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelection}
                  danger
                >
                  {t('dealEditor.deleteCount', { count: selectedRowKeys.length })}
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleDuplicateSelection}
                >
                  {t('dealEditor.duplicateCount', { count: selectedRowKeys.length })}
                </Button>
              </>
            )}
            <Button
              icon={<PlusOutlined />}
              onClick={() => handleAddLine('article')}
              style={{ backgroundColor: '#1677ff', borderColor: '#1677ff', color: '#fff' }}
            >
              {t('dealEditor.lineTypes.article')}
            </Button>
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleAddLine('text')}
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
            >
              {t('dealEditor.lineTypes.text')}
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => handleAddLine('subtotal')}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('dealEditor.lineTypes.subtotal')}
            </Button>
            <Button
              icon={<MinusOutlined />}
              onClick={() => handleAddLine('page_break')}
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
            >
              {t('dealEditor.lineTypes.pageBreak')}
            </Button>
          </Space>
        </div>

        {/* ⚠️ LES LIGNES NE SONT PAS DANS LE FORMULAIRE : leurs champs vivent
            dans les cellules du tableau, et « disabled » du Form ne les atteint
            pas. C'est ConfigProvider qui les éteint, elles et les boutons de
            ligne, sans toucher au reste de l'écran — l'en-tête garde ses
            boutons de PDF, qu'un lecteur a le droit d'employer. */}
        <ConfigProvider componentDisabled={!montrerLEcriture}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={lines.map((l) => l.key)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              dataSource={lines}
              columns={lineColumns}
              rowKey="key"
              pagination={false}
              size="small"
              bordered
              scroll={{ x: 1200, y: 'calc(100vh - 500px)' }}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }}
              onRow={(record) => ({
                onClick: () => setSelectedLineKey(record.key),
                style: {
                  backgroundColor: selectedLineKey === record.key ? `${primaryColor}20` : undefined,
                  cursor: 'pointer',
                },
              })}
              components={{
                body: {
                  row: SortableRow,
                },
              }}
            />
          </SortableContext>
        </DndContext>
        </ConfigProvider>

        {/* Totaux sous le tableau - alignés avec les colonnes */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 0',
            borderTop: '2px solid #d9d9d9',
            background: '#fafafa',
          }}
        >
          {/* Espacement pour aligner avec les colonnes: drag(40) + checkbox(48) + Article(200) + Description(250) + Qté(80) + Unité(60) = 678px */}
          <div style={{ flex: 1 }} />
          {/* Total Achat HT - aligné avec colonne P. Achat (100px) */}
          <div style={{ width: 100, textAlign: 'right', paddingRight: 8 }}>
            <div style={{ fontSize: 10, color: '#8c8c8c' }}>{t('dealEditor.totals.totalPurchase')}</div>
            <strong style={{ fontSize: 13, color: '#d48806' }}>
              {totals.dealPurchase.toFixed(2)} €
            </strong>
          </div>
          {/* Coef (80px) */}
          <div style={{ width: 80 }} />
          {/* P. Vente (100px) */}
          <div style={{ width: 100 }} />
          {/* Rem % (80px) */}
          <div style={{ width: 80 }} />
          {/* TVA (80px) */}
          <div style={{ width: 80 }} />
          {/* Total Vente HT - aligné avec colonne Total HT (110px) */}
          <div style={{ width: 110, textAlign: 'right', paddingRight: 8 }}>
            <div style={{ fontSize: 10, color: '#8c8c8c' }}>{t('dealEditor.totals.totalSale')}</div>
            <strong style={{ fontSize: 13, color: '#1890ff' }}>
              {totals.dealSaleHTBeforeDiscount.toFixed(2)} €
            </strong>
          </div>
          {/* Actions (80px) */}
          <div style={{ width: 80 }} />
        </div>

        <div style={{ marginTop: 24 }} />

        {/* Tabs: Activités et Devis liés */}
        {documentId && (
          <Tabs
            defaultActiveKey="activities"
            items={[
              {
                key: 'activities',
                label: (
                  <span>
                    <HistoryOutlined /> {t('dealEditor.tabsLabels.activities', { count: activities.length })}
                  </span>
                ),
                children: (
                  <Card
                    size="small"
                    extra={
                      montrerLEcriture && (
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => setActivityModalVisible(true)}
                        >
                          {t('dealEditor.addActivity')}
                        </Button>
                      )
                    }
                  >
                    {activities.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                        {t('dealEditor.empty.activities')}
                      </div>
                    ) : (
                      <Timeline mode="left">
                        {activities.map((activity: Activity) => (
                          <Timeline.Item
                            key={activity.id}
                            dot={
                              <span style={{ color: getActivityColor(activity.type) }}>
                                {getActivityIcon(activity.type)}
                              </span>
                            }
                            label={dayjs(activity.date).format('DD/MM/YYYY')}
                          >
                            <div>
                              <Tag color={getActivityColor(activity.type)}>
                                {activityTypes.find((at) => at.value === activity.type)?.label ||
                                  activity.type}
                              </Tag>
                              {activity.completed && (
                                <Tag color="green" icon={<CheckCircleOutlined />}>
                                  {t('dealEditor.status.termine')}
                                </Tag>
                              )}
                            </div>
                            <div style={{ marginTop: 8 }}>{activity.description}</div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                              {t('dealEditor.addedOn', { date: dayjs(activity.created_at).format('DD/MM/YYYY HH:mm') })}
                            </div>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    )}
                  </Card>
                ),
              },
              {
                key: 'purchase-orders',
                label: (
                  <span>
                    <ShoppingCartOutlined /> {t('dealEditor.tabsLabels.purchaseOrders', { count: purchaseOrdersData?.data?.length || 0 })}
                  </span>
                ),
                children: (
                  <Card
                    size="small"
                    extra={
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreatePurchaseOrder}
                      >
                        {t('dealEditor.newOrder')}
                      </Button>
                    }
                  >
                    {!purchaseOrdersData?.data?.length ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                        {t('dealEditor.empty.purchaseOrders')}
                      </div>
                    ) : (
                      <Table
                        dataSource={purchaseOrdersData.data}
                        columns={[
                          {
                            title: t('dealEditor.columns.number'),
                            dataIndex: 'number',
                            key: 'number',
                            render: (text: string, record: { id: string; number: string }) => (
                              <a onClick={() => handleOpenPurchaseOrder(record.id, record.number)}>{text}</a>
                            ),
                          },
                          { title: t('dealEditor.columns.supplier'), dataIndex: ['supplier', 'name'], key: 'supplier' },
                          {
                            title: t('common.date'),
                            dataIndex: 'date',
                            key: 'date',
                            render: (d: string) => dayjs(d).format('DD/MM/YYYY'),
                          },
                          {
                            title: t('common.status'),
                            dataIndex: 'status',
                            key: 'status',
                            render: (s: string) => (
                              <Tag color={{ draft: 'default', confirmed: 'blue', partial: 'orange', received: 'green', cancelled: 'red' }[s] || 'default'}>
                                {{ draft: t('dealEditor.poStatus.draft'), confirmed: t('dealEditor.poStatus.confirmed'), partial: t('dealEditor.poStatus.partial'), received: t('dealEditor.poStatus.received'), cancelled: t('dealEditor.poStatus.cancelled') }[s] || s}
                              </Tag>
                            ),
                          },
                          {
                            title: t('dealEditor.columns.totalTTC'),
                            dataIndex: 'total_ttc',
                            key: 'total_ttc',
                            align: 'right' as const,
                            render: (v: number) => `${(v || 0).toFixed(2)} €`,
                          },
                        ]}
                        rowKey="id"
                        size="small"
                        pagination={false}
                      />
                    )}
                  </Card>
                ),
              },
              {
                key: 'supplier-invoices',
                label: (
                  <span>
                    <DollarOutlined /> {t('dealEditor.tabsLabels.supplierInvoices', { count: supplierInvoicesData?.data?.length || 0 })}
                  </span>
                ),
                children: (
                  <Card
                    size="small"
                    extra={
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreateSupplierInvoice}
                      >
                        {t('dealEditor.newInvoice')}
                      </Button>
                    }
                  >
                    {!supplierInvoicesData?.data?.length ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                        {t('dealEditor.empty.supplierInvoices')}
                      </div>
                    ) : (
                      <Table
                        dataSource={supplierInvoicesData.data}
                        columns={[
                          {
                            title: t('dealEditor.columns.number'),
                            dataIndex: 'number',
                            key: 'number',
                            render: (text: string, record: { id: string; number: string }) => (
                              <a onClick={() => handleOpenSupplierInvoice(record.id, record.number)}>{text}</a>
                            ),
                          },
                          { title: t('dealEditor.columns.supplier'), dataIndex: ['supplier', 'name'], key: 'supplier' },
                          {
                            title: t('common.date'),
                            dataIndex: 'date',
                            key: 'date',
                            render: (d: string) => dayjs(d).format('DD/MM/YYYY'),
                          },
                          {
                            title: t('common.status'),
                            dataIndex: 'status',
                            key: 'status',
                            render: (s: string) => (
                              <Tag color={{ draft: 'default', sent: 'blue', partial: 'orange', paid: 'green', cancelled: 'red' }[s] || 'default'}>
                                {{ draft: t('dealEditor.invoiceStatus.draft'), sent: t('dealEditor.invoiceStatus.sent'), partial: t('dealEditor.invoiceStatus.partial'), paid: t('dealEditor.invoiceStatus.paid'), cancelled: t('dealEditor.invoiceStatus.cancelled') }[s] || s}
                              </Tag>
                            ),
                          },
                          {
                            title: t('dealEditor.columns.totalTTC'),
                            dataIndex: 'total_ttc',
                            key: 'total_ttc',
                            align: 'right' as const,
                            render: (v: number) => `${(v || 0).toFixed(2)} €`,
                          },
                        ]}
                        rowKey="id"
                        size="small"
                        pagination={false}
                      />
                    )}
                  </Card>
                ),
              },
              {
                key: 'client-invoices',
                label: (
                  <span>
                    <DollarOutlined /> {t('dealEditor.tabsLabels.clientInvoices', { count: clientInvoicesData?.data?.length || 0 })}
                  </span>
                ),
                children: (
                  <Card
                    size="small"
                    extra={
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreateClientInvoice}
                        disabled={!selectedClient}
                      >
                        {t('dealEditor.newInvoice')}
                      </Button>
                    }
                  >
                    {!clientInvoicesData?.data?.length ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                        {t('dealEditor.empty.clientInvoices')}
                      </div>
                    ) : (
                      <>
                        <Table
                          dataSource={clientInvoicesData.data}
                          columns={[
                            {
                              title: t('dealEditor.columns.number'),
                              dataIndex: 'number',
                              key: 'number',
                              render: (text: string, record: { id: string; number: string }) => (
                                <a onClick={() => handleOpenClientInvoice(record.id, record.number)}>{text}</a>
                              ),
                            },
                            { title: t('dealEditor.columns.client'), dataIndex: ['client', 'name'], key: 'client' },
                            {
                              title: t('common.date'),
                              dataIndex: 'date',
                              key: 'date',
                              render: (d: string) => dayjs(d).format('DD/MM/YYYY'),
                            },
                            {
                              title: t('common.status'),
                              dataIndex: 'status',
                              key: 'status',
                              render: (s: string) => (
                                <Tag color={{ draft: 'default', sent: 'blue', partial: 'orange', paid: 'green', cancelled: 'red' }[s] || 'default'}>
                                  {{ draft: t('dealEditor.invoiceStatus.draft'), sent: t('dealEditor.invoiceStatus.sent'), partial: t('dealEditor.invoiceStatus.partial'), paid: t('dealEditor.invoiceStatus.paid'), cancelled: t('dealEditor.invoiceStatus.cancelled') }[s] || s}
                                </Tag>
                              ),
                            },
                            {
                              title: t('dealEditor.columns.purchaseHT'),
                              dataIndex: 'total_purchase_ht',
                              key: 'total_purchase_ht',
                              align: 'right' as const,
                              render: (v: number) => <span style={{ color: '#d48806' }}>{(v || 0).toFixed(2)} €</span>,
                            },
                            {
                              title: t('dealEditor.columns.saleHT'),
                              dataIndex: 'total_ht',
                              key: 'total_ht',
                              align: 'right' as const,
                              render: (v: number) => <span style={{ color: '#1890ff' }}>{(v || 0).toFixed(2)} €</span>,
                            },
                            {
                              title: t('dealEditor.columns.totalTTC'),
                              dataIndex: 'total_ttc',
                              key: 'total_ttc',
                              align: 'right' as const,
                              render: (v: number) => `${(v || 0).toFixed(2)} €`,
                            },
                            {
                              title: t('dealEditor.columns.balance'),
                              key: 'balance',
                              align: 'right' as const,
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              render: (_: unknown, record: any) => {
                                const balance = (record.total_ttc || 0) - (record.paid_amount || 0)
                                return <span style={{ color: balance > 0 ? '#fa8c16' : '#52c41a', fontWeight: balance > 0 ? 600 : 400 }}>{balance.toFixed(2)} €</span>
                              },
                            },
                          ]}
                          rowKey="id"
                          size="small"
                          pagination={false}
                        />
                        {/* Totaux des factures */}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          padding: '12px 16px',
                          background: '#fafafa',
                          borderTop: '2px solid #d9d9d9',
                          gap: 24
                        }}>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalPurchaseHT')} </span>
                            <strong style={{ color: '#d48806' }}>
                              {(clientInvoicesData.data.reduce((sum: number, inv: { total_purchase_ht?: number }) => sum + (inv.total_purchase_ht || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalSaleHT')} </span>
                            <strong style={{ color: '#1890ff' }}>
                              {(clientInvoicesData.data.reduce((sum: number, inv: { total_ht?: number }) => sum + (inv.total_ht || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalTTC')} </span>
                            <strong>
                              {(clientInvoicesData.data.reduce((sum: number, inv: { total_ttc?: number }) => sum + (inv.total_ttc || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalBalance')} </span>
                            <strong style={{ color: (() => {
                              const totalSolde = clientInvoicesData.data.reduce((sum: number, inv: { total_ttc?: number; paid_amount?: number }) => sum + ((inv.total_ttc || 0) - (inv.paid_amount || 0)), 0)
                              return totalSolde > 0 ? '#fa8c16' : '#52c41a'
                            })() }}>
                              {(clientInvoicesData.data.reduce((sum: number, inv: { total_ttc?: number; paid_amount?: number }) => sum + ((inv.total_ttc || 0) - (inv.paid_amount || 0)), 0)).toFixed(2)} €
                            </strong>
                          </div>
                        </div>
                        {/* Totaux factures payées uniquement */}
                        {Array.isArray(clientInvoicesData.data) && clientInvoicesData.data.some((inv: { status: string }) => inv.status === 'paid') && (
                          <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            padding: '12px 16px',
                            background: '#f6ffed',
                            borderTop: '1px solid #b7eb8f',
                            gap: 24
                          }}>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.paidPurchaseHT')} </span>
                              <strong style={{ color: '#d48806' }}>
                                {(clientInvoicesData.data.filter((inv: { status: string }) => inv.status === 'paid').reduce((sum: number, inv: { total_purchase_ht?: number }) => sum + (inv.total_purchase_ht || 0), 0)).toFixed(2)} €
                              </strong>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.paidSaleHT')} </span>
                              <strong style={{ color: '#1890ff' }}>
                                {(clientInvoicesData.data.filter((inv: { status: string }) => inv.status === 'paid').reduce((sum: number, inv: { total_ht?: number }) => sum + (inv.total_ht || 0), 0)).toFixed(2)} €
                              </strong>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.paidTTC')} </span>
                              <strong style={{ color: '#52c41a' }}>
                                {(clientInvoicesData.data.filter((inv: { status: string }) => inv.status === 'paid').reduce((sum: number, inv: { total_ttc?: number }) => sum + (inv.total_ttc || 0), 0)).toFixed(2)} €
                              </strong>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                ),
              },
              {
                key: 'amendments',
                label: (
                  <span>
                    <FileTextOutlined /> {t('dealEditor.tabsLabels.amendments', { count: amendmentsData?.data?.length || 0 })}
                  </span>
                ),
                children: (
                  <Card
                    size="small"
                    extra={
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleCreateAmendment}
                        disabled={!selectedClient}
                      >
                        {t('dealEditor.newAmendment')}
                      </Button>
                    }
                  >
                    {!amendmentsData?.data?.length ? (
                      <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                        {t('dealEditor.empty.amendments')}
                      </div>
                    ) : (
                      <>
                        <Table
                          dataSource={amendmentsData.data}
                          columns={[
                            {
                              title: t('dealEditor.columns.number'),
                              dataIndex: 'number',
                              key: 'number',
                              render: (text: string, record: { id: string; number: string }) => (
                                <a onClick={() => handleOpenAmendment(record.id, record.number)}>{text}</a>
                              ),
                            },
                            { title: t('dealEditor.columns.client'), dataIndex: ['client', 'name'], key: 'client' },
                            {
                              title: t('common.date'),
                              dataIndex: 'date',
                              key: 'date',
                              render: (d: string) => dayjs(d).format('DD/MM/YYYY'),
                            },
                            {
                              title: t('common.status'),
                              dataIndex: 'status',
                              key: 'status',
                              render: (s: string) => (
                                <Tag color={{ draft: 'default', sent: 'blue', accepted: 'green', refused: 'red', cancelled: 'volcano' }[s] || 'default'}>
                                  {{ draft: t('dealEditor.amendmentStatus.draft'), sent: t('dealEditor.amendmentStatus.sent'), accepted: t('dealEditor.amendmentStatus.accepted'), refused: t('dealEditor.amendmentStatus.refused'), cancelled: t('dealEditor.amendmentStatus.cancelled') }[s] || s}
                                </Tag>
                              ),
                            },
                            {
                              title: t('dealEditor.columns.purchaseHT'),
                              dataIndex: 'total_purchase_ht',
                              key: 'total_purchase_ht',
                              align: 'right' as const,
                              render: (v: number) => <span style={{ color: '#d48806' }}>{(v || 0).toFixed(2)} €</span>,
                            },
                            {
                              title: t('dealEditor.columns.saleHT'),
                              dataIndex: 'total_ht',
                              key: 'total_ht',
                              align: 'right' as const,
                              render: (v: number) => <span style={{ color: '#1890ff' }}>{(v || 0).toFixed(2)} €</span>,
                            },
                            {
                              title: t('dealEditor.columns.totalTTC'),
                              dataIndex: 'total_ttc',
                              key: 'total_ttc',
                              align: 'right' as const,
                              render: (v: number) => `${(v || 0).toFixed(2)} €`,
                            },
                            {
                              title: t('dealEditor.columns.balance'),
                              key: 'balance',
                              align: 'right' as const,
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              render: (_: unknown, record: any) => {
                                const balance = (record.total_ttc || 0) - (record.invoiced_amount || 0)
                                return <span style={{ color: balance > 0 ? '#fa8c16' : '#52c41a', fontWeight: balance > 0 ? 600 : 400 }}>{balance.toFixed(2)} €</span>
                              },
                            },
                          ]}
                          rowKey="id"
                          size="small"
                          pagination={false}
                        />
                        {/* Totaux des avenants */}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          padding: '12px 16px',
                          background: '#fafafa',
                          borderTop: '2px solid #d9d9d9',
                          gap: 24
                        }}>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalPurchaseHT')} </span>
                            <strong style={{ color: '#d48806' }}>
                              {(amendmentsData.data.reduce((sum: number, a: { total_purchase_ht?: number }) => sum + (a.total_purchase_ht || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalSaleHT')} </span>
                            <strong style={{ color: '#1890ff' }}>
                              {(amendmentsData.data.reduce((sum: number, a: { total_ht?: number }) => sum + (a.total_ht || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalTTC')} </span>
                            <strong>
                              {(amendmentsData.data.reduce((sum: number, a: { total_ttc?: number }) => sum + (a.total_ttc || 0), 0)).toFixed(2)} €
                            </strong>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.totalBalance')} </span>
                            <strong style={{ color: (() => {
                              const totalSolde = amendmentsData.data.reduce((sum: number, a: { total_ttc?: number; invoiced_amount?: number }) => sum + ((a.total_ttc || 0) - (a.invoiced_amount || 0)), 0)
                              return totalSolde > 0 ? '#fa8c16' : '#52c41a'
                            })() }}>
                              {(amendmentsData.data.reduce((sum: number, a: { total_ttc?: number; invoiced_amount?: number }) => sum + ((a.total_ttc || 0) - (a.invoiced_amount || 0)), 0)).toFixed(2)} €
                            </strong>
                          </div>
                        </div>
                        {/* Totaux avenants acceptés uniquement */}
                        {Array.isArray(amendmentsData.data) && amendmentsData.data.some((a: { status: string }) => a.status === 'accepted') && (
                          <div style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            padding: '12px 16px',
                            background: '#e6f7ff',
                            borderTop: '1px solid #91d5ff',
                            gap: 24
                          }}>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.acceptedPurchaseHT')} </span>
                              <strong style={{ color: '#d48806' }}>
                                {(amendmentsData.data.filter((a: { status: string }) => a.status === 'accepted').reduce((sum: number, a: { total_purchase_ht?: number }) => sum + (a.total_purchase_ht || 0), 0)).toFixed(2)} €
                              </strong>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.acceptedSaleHT')} </span>
                              <strong style={{ color: '#1890ff' }}>
                                {(amendmentsData.data.filter((a: { status: string }) => a.status === 'accepted').reduce((sum: number, a: { total_ht?: number }) => sum + (a.total_ht || 0), 0)).toFixed(2)} €
                              </strong>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('dealEditor.totals.acceptedBalance')} </span>
                              <strong style={{ color: (() => {
                                const totalSolde = amendmentsData.data.filter((a: { status: string }) => a.status === 'accepted').reduce((sum: number, a: { total_ttc?: number; invoiced_amount?: number }) => sum + ((a.total_ttc || 0) - (a.invoiced_amount || 0)), 0)
                                return totalSolde > 0 ? '#fa8c16' : '#52c41a'
                              })() }}>
                                {(amendmentsData.data.filter((a: { status: string }) => a.status === 'accepted').reduce((sum: number, a: { total_ttc?: number; invoiced_amount?: number }) => sum + ((a.total_ttc || 0) - (a.invoiced_amount || 0)), 0)).toFixed(2)} €
                              </strong>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </Card>
                ),
              },
              {
                key: 'info',
                label: (
                  <span>
                    <UserOutlined /> {t('dealEditor.tabsLabels.info')}
                  </span>
                ),
                children: (
                  <Card size="small">
                    <Row gutter={24}>
                      <Col span={8}>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ color: '#888', marginBottom: 4 }}>{t('dealEditor.info.createdOn')}</div>
                          <div>{deal?.created_at && dayjs(deal.created_at).format('DD/MM/YYYY HH:mm')}</div>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ color: '#888', marginBottom: 4 }}>{t('dealEditor.info.modifiedOn')}</div>
                          <div>{deal?.updated_at && dayjs(deal.updated_at).format('DD/MM/YYYY HH:mm')}</div>
                        </div>
                      </Col>
                      <Col span={8}>
                        {deal?.quote_id && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ color: '#888', marginBottom: 4 }}>{t('dealEditor.info.createdFrom')}</div>
                            <div>{t('dealEditor.quoteLabel')} <a onClick={handleOpenQuote} style={{ cursor: 'pointer' }}>{linkedQuoteData?.number}</a></div>
                          </div>
                        )}
                      </Col>
                    </Row>
                  </Card>
                ),
              },
              // ⚠️ Une affaire n'est ni numérotée ni scellée : son suivi est plus
              // maigre que celui d'un devis — création, changements de statut,
              // demande de validation. C'est tout ce qui lui arrive, et c'est
              // déjà plus que ce qu'on en voyait.
              {
                key: 'suivi',
                label: (
                  <span>
                    <ClockCircleOutlined /> {t('dealEditor.tabs.timeline', 'Suivi')}
                  </span>
                ),
                children: <SuiviDocument route="deals" documentId={documentId} />,
              },
            ]}
          />
        )}
        </div>
      </div>

      {/* Fixed Footer with Totals */}
      {/* ⚠️ ET LA BARRE DE TOTAUX AUSSI : la remise globale et le taux de TVA
          d'ensemble y écrivent sur les lignes, hors du formulaire. */}
      <ConfigProvider componentDisabled={!montrerLEcriture}>
      <div
        style={{
          padding: '12px 24px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout,
          display: 'flex',
          justifyContent: 'flex-end',
          position: 'fixed',
          bottom: 0,
          left: sidebarWidth,
          right: 0,
          zIndex: 100,
          transition: 'left 0.2s',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'stretch',
          }}
        >
          {/* Prix d'achat global */}
          <Card
            size="small"
            style={{
              background: '#fff7e6',
              borderColor: '#ffd591',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('dealEditor.footer.purchaseHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#d48806' }}>
              {totals.totalPurchase.toFixed(2)} €
            </div>
          </Card>

          {/* Marge globale */}
          <Card
            size="small"
            style={{
              background: totals.margin >= 0 ? '#f6ffed' : '#fff2f0',
              borderColor: totals.margin >= 0 ? '#b7eb8f' : '#ffccc7',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>
              {t('dealEditor.footer.margin', { percent: totals.marginPercent })}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: totals.margin >= 0 ? '#52c41a' : '#ff4d4f',
              }}
            >
              {totals.margin.toFixed(2)} €
            </div>
          </Card>

          {/* Prix de vente HT (avant remise) */}
          <Card
            size="small"
            style={{
              background: '#e6f7ff',
              borderColor: '#91d5ff',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('dealEditor.footer.saleHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
              {totals.totalSaleHTBeforeDiscount.toFixed(2)} €
            </div>
          </Card>

          {/* Remise globale */}
          <Card
            size="small"
            style={{
              background: globalDiscountValue > 0 ? '#fff0f6' : token.colorBgLayout,
              borderColor: globalDiscountValue > 0 ? '#ffadd2' : token.colorBorder,
              minWidth: 160,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>{t('dealEditor.footer.globalDiscount')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <InputNumber
                size="small"
                min={0}
                max={globalDiscountType === 'percent' ? 100 : undefined}
                value={globalDiscountValue}
                onChange={(val) => {
                  setGlobalDiscountValue(val || 0)
                  setTabDirty(tabId, true)
                }}
                style={{ width: 70 }}
              />
              <Select
                size="small"
                value={globalDiscountType}
                onChange={(val) => {
                  setGlobalDiscountType(val)
                  setTabDirty(tabId, true)
                }}
                style={{ width: 55 }}
              >
                <Select.Option value="percent">%</Select.Option>
                <Select.Option value="amount">€</Select.Option>
              </Select>
            </div>
            {globalDiscountValue > 0 && (
              <div style={{ fontSize: 12, color: '#eb2f96', marginTop: 4, fontWeight: 500 }}>
                -{totals.globalDiscount.toFixed(2)} €
              </div>
            )}
          </Card>

          {/* Net HT (après remise) */}
          <Card
            size="small"
            style={{
              background: '#f0f5ff',
              borderColor: '#adc6ff',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('dealEditor.footer.netHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#2f54eb' }}>
              {totals.totalSaleHT.toFixed(2)} €
            </div>
          </Card>

          {/* TVA */}
          <Card
            size="small"
            style={{ minWidth: 160 }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{t('dealEditor.footer.globalVat')}</span>
              <Select
                value={(() => {
                  const articleLines = lines.filter(l => l.line_type === 'article')
                  if (articleLines.length === 0) return undefined
                  const firstRate = articleLines[0].tva_rate
                  const allSameRate = articleLines.every(l => l.tva_rate === firstRate)
                  return allSameRate ? firstRate : undefined
                })()}
                onChange={(value) => {
                  setLines((prev) =>
                    prev.map((line) =>
                      line.line_type === 'article' ? { ...line, tva_rate: value } : line
                    )
                  )
                  setTabDirty(tabId, true)
                }}
                style={{ width: 75 }}
                size="small"
                disabled={!lines.some(l => l.line_type === 'article')}
                placeholder=""
                options={
                  outputVatRates.length > 0
                    ? outputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
                    : [
                        // ⚠️ Voir la note plus haut : aucun taux codé en dur.
                        { value: 0, label: '0%' },
                      ]
                }
              />
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {totals.totalTVA.toFixed(2)} €
            </div>
          </Card>

          {/* Total TTC */}
          <Card
            size="small"
            style={{
              background: '#1890ff',
              borderColor: '#1890ff',
              minWidth: 150,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 2 }}>
              {t('dealEditor.footer.totalTTC')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
              {totals.totalTTC.toFixed(2)} €
            </div>
          </Card>
        </div>
      </div>
      </ConfigProvider>

      {/* Activity Modal */}
      <Modal
        title={t('dealEditor.activityModal.title')}
        open={activityModalVisible}
        onOk={handleAddActivity}
        onCancel={() => {
          setActivityModalVisible(false)
          activityForm.resetFields()
        }}
        confirmLoading={addActivityMutation.isPending}
      >
        <Form form={activityForm} layout="vertical" initialValues={{ completed: false }}>
          <Form.Item
            name="type"
            label={t('dealEditor.activityModal.type')}
            rules={[{ required: true, message: t('dealEditor.activityModal.typeRequired') }]}
          >
            <Select placeholder={t('dealEditor.activityModal.selectType')}>
              {activityTypes.map((type) => (
                <Select.Option key={type.value} value={type.value}>
                  <Space>
                    {type.icon}
                    {type.label}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="date"
            label={t('common.date')}
            rules={[{ required: true, message: t('dealEditor.activityModal.dateRequired') }]}
            initialValue={dayjs()}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>

          <Form.Item
            name="description"
            label={t('common.description')}
            rules={[{ required: true, message: t('dealEditor.activityModal.descriptionRequired') }]}
          >
            <Input.TextArea rows={3} placeholder={t('dealEditor.activityModal.descriptionPlaceholder')} />
          </Form.Item>

          {/* ⚠️ Un Select se pilote par « value » : avec valuePropName="checked",
              antd poussait le choix sous une prop que Select ignore, et le champ
              restait vide à l'affichage alors que la valeur partait bien au
              serveur. */}
          <Form.Item name="completed" label={t('dealEditor.activityModal.completed')}>
            <Select>
              <Select.Option value={false}>
                <Space>
                  <ClockCircleOutlined /> {t('dealEditor.status.en_cours')}
                </Space>
              </Select.Option>
              <Select.Option value={true}>
                <Space>
                  <CheckCircleOutlined style={{ color: 'green' }} /> {t('dealEditor.activityModal.completedOption')}
                </Space>
              </Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* PDF Preview Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 30 }}>
            <span>{t('dealEditor.pdfModal.title', { number: linkedQuoteData?.number || '' })}</span>
            <Space size="small">
              <Button size="small" onClick={() => setModalSize({ width: 600, height: 60 })}>{t('dealEditor.pdfModal.small')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 900, height: 80 })}>{t('dealEditor.pdfModal.medium')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 1200, height: 90 })}>{t('dealEditor.pdfModal.large')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: window.innerWidth - 100, height: 95 })}>{t('dealEditor.pdfModal.fullscreen')}</Button>
            </Space>
          </div>
        }
        open={pdfPreviewOpen}
        onCancel={closePdfPreview}
        width={modalSize.width}
        centered
        footer={[
          <Button key="close" onClick={closePdfPreview}>
            {t('common.close')}
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleDownloadQuotePdf}
          >
            {t('dealEditor.pdfModal.download')}
          </Button>,
        ]}
      >
        {pdfPreviewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
            <p>{t('dealEditor.pdfModal.loading')}</p>
          </div>
        ) : pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            style={{ width: '100%', height: `${modalSize.height}vh`, border: 'none' }}
            title={t('dealEditor.tabs.quote', { number: linkedQuoteData?.number })}

          />
        ) : null}
      </Modal>

      {/* Price Modification Modal (purchase or sale) */}
      <Modal
        title={priceModalData?.priceType === 'sale' ? t('dealEditor.priceModal.titleSale') : t('dealEditor.priceModal.titlePurchase')}
        open={priceModalOpen}
        onCancel={() => {
          setPriceModalOpen(false)
          setPriceModalData(null)
        }}
        footer={null}
        width={500}
      >
        {priceModalData && (
          <div>
            <p style={{ marginBottom: 16 }}>
              {priceModalData.priceType === 'sale'
                ? t('dealEditor.priceModal.introSale')
                : t('dealEditor.priceModal.introPurchase')}{' '}
              <strong>{priceModalData.articleName}</strong>
            </p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, padding: 12, background: '#f5f5f5', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('dealEditor.priceModal.oldPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#ff4d4f', textDecoration: 'line-through' }}>
                  {priceModalData.oldPrice.toFixed(2)} €
                </div>
              </div>
              <div style={{ flex: 1, padding: 12, background: '#f6ffed', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('dealEditor.priceModal.newPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>
                  {priceModalData.newPrice.toFixed(2)} €
                </div>
              </div>
            </div>
            <p style={{ marginBottom: 16, color: '#666' }}>
              {t('dealEditor.priceModal.question')}
            </p>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                type="primary"
                block
                onClick={() => handlePriceModalConfirm(false)}
              >
                {t('dealEditor.priceModal.documentOnly')}
              </Button>
              <Button
                type="default"
                block
                onClick={() => handlePriceModalConfirm(true)}
                loading={updateArticleMutation.isPending}
              >
                {t('dealEditor.priceModal.documentAndArticle')}
              </Button>
              <Button
                type="text"
                block
                onClick={() => {
                  const field = priceModalData.priceType === 'purchase' ? 'purchase_price' : 'unit_price'
                  handleLineChange(priceModalData.lineKey, field, priceModalData.oldPrice)
                  setPriceModalOpen(false)
                  setPriceModalData(null)
                }}
              >
                {t('common.cancel')}
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  )
}
