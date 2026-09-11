import { useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Form,
  Input,
  Select,
  InputNumber,
  DatePicker,
  Button,
  Table,
  Space,
  Row,
  Col,
  Card,
  message,
  Dropdown,
  Tag,
  Tooltip,
  Tabs,
  theme,
  Modal,
  Checkbox,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  SearchOutlined,
  DownOutlined,
  CheckOutlined,
  AuditOutlined,
  CloseOutlined,
  InboxOutlined,
  AlignLeftOutlined,
  CalculatorOutlined,
  MinusOutlined,
  HolderOutlined,
  FileDoneOutlined,
  CopyOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  LockOutlined,
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

import api, { purchaseOrderAPI, supplierAPI, articleAPI, settingsAPI } from '@/services/api'
import { useCanValidateDocuments, usePermissionsChargees } from '@/stores/permissionStore'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import DocumentsSection from '@/components/DocumentsSection'
import SuiviDocument from '@/components/SuiviDocument'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import { useColumnWidths } from '@/hooks/useColumnWidths'
import dayjs from 'dayjs'

interface Supplier {
  id: string
  code: string
  name: string
  address_line1?: string
  address_line2?: string
  postal_code?: string
  city?: string
  country?: string
  /** Délai de règlement de la fiche fournisseur, en jours. */
  payment_terms?: number
}

interface Article {
  id: string
  code: string
  name: string
  unit?: string
  type: string
  purchase_price: number
  sale_price: number
  tva_rate: number
  stock_managed: boolean
}

type LineType = 'article' | 'text' | 'page_break' | 'subtotal'

interface PurchaseOrderLine {
  key: string
  deal_line_id?: string
  line_type: LineType
  article_id?: string
  description: string
  quantity: number
  unit: string
  purchase_price: number
  coefficient: number
  unit_price: number
  discount_percent: number
  vat_rate: number
}

interface PurchaseOrder {
  id: string
  number: string
  supplier_id: string
  supplier?: { id: string; name: string; code?: string; address?: string }
  date: string
  due_date?: string
  expected_date?: string
  payment_terms?: string
  status: string
  subject?: string
  reference?: string
  delivery_address?: string
  discount_percent?: number
  discount_amount?: number
  notes?: string
  lines?: Array<{
    id?: string
    line_type?: LineType
    article_id: string
    description: string
    quantity: number
    unit_price: number
    discount?: number
    vat_rate?: number
    received_quantity?: number
    invoiced_quantity?: number
  }>
  total_ht: number
  total_tva: number
  total_ttc: number
}

interface PurchaseOrderEditorProps {
  tabId: string
  documentId?: string
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

interface PaymentTerm {
  id: string
  label: string
  days: number
  is_default: boolean
}

interface LinkedInvoice {
  id: string
  number: string
  supplier_invoice_number?: string
  date: string
  status: string
  total_ht: number
  total_ttc: number
}

export default function PurchaseOrderEditor({ tabId, documentId }: PurchaseOrderEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { updateTabTitle, setTabDirty, openDocumentTab, getTab } = useDocumentTabsStore()
  const { primaryColor } = useThemeStore()
  const { sidebarWidth } = useSidebarStore()
  const { token } = theme.useToken()
  const [form] = Form.useForm()
  const [lines, setLines] = useState<PurchaseOrderLine[]>([])
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [savedOrderId, setSavedOrderId] = useState<string | undefined>(documentId)

  // Modal pour créer facture
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const [invoiceForm] = Form.useForm()
  const [invoiceLines, setInvoiceLines] = useState<{ line_id: string; selected: boolean; quantity: number; max_quantity: number; description: string }[]>([])

  // Modal pour réception
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)
  const [receiveForm] = Form.useForm()
  const [receiveLines, setReceiveLines] = useState<{ line_id: string; selected: boolean; quantity: number; max_quantity: number; already_received: number; description: string }[]>([])

  // Modal pour modification de prix
  const [priceModalOpen, setPriceModalOpen] = useState(false)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [priceModalData, setPriceModalData] = useState<{
    lineKey: string
    articleId: string
    articleName: string
    oldPrice: number
    newPrice: number
  } | null>(null)
  const linesInitializedRef = useRef(false)

  // Get metadata from tab (for deal-linked orders)
  const tabMetadata = getTab(tabId)?.type === 'document' ? (getTab(tabId) as { metadata?: Record<string, unknown> })?.metadata : undefined

  // Global discount state
  const [globalDiscountType, setGlobalDiscountType] = useState<'percent' | 'amount'>('percent')
  const [globalDiscountValue, setGlobalDiscountValue] = useState<number>(0)

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Column widths for resizable columns (persisted in localStorage)
  const { columnWidths, handleResize } = useColumnWidths()

  // Fetch suppliers
  const { data: suppliersData, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['suppliers-for-po-editor'],
    queryFn: async () => {
      const response = await supplierAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Fetch articles
  const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
    queryKey: ['articles-for-po-editor'],
    queryFn: async () => {
      const response = await articleAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Fetch VAT rates (input direction for purchase orders)
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

  // Fetch footers for purchase orders
  const { data: footersData } = useQuery({
    queryKey: ['footers', 'purchase_order'],
    queryFn: async () => {
      const response = await settingsAPI.listFootersByDocumentType('purchase_order')
      return response
    },
  })

  // State for selected payment term ID
  const [selectedPaymentTermId, setSelectedPaymentTermId] = useState<string | null>(null)

  // State for footer content
  const [footerContent, setFooterContent] = useState<string>('')

  // Filter VAT rates for input direction (supplier purchase orders)
  const inputVatRates = useMemo(() => {
    const rates = vatRatesData?.vat_rates || []
    return rates.filter((r: VATRate) => r.direction === 'input')
  }, [vatRatesData])

  // Get default VAT rate (use default if set, otherwise first rate, otherwise 0)
  const defaultVatRate = useMemo(() => {
    const defaultRate = inputVatRates.find((r: VATRate) => r.is_default)
    if (defaultRate) return defaultRate.rate
    if (inputVatRates.length > 0) return inputVatRates[0].rate
    return 0
  }, [inputVatRates])

  // Apply default payment term for new documents
  useEffect(() => {
    if (!documentId && paymentTermsData?.payment_terms) {
      const defaultTerm = paymentTermsData.payment_terms.find((term: PaymentTerm) => term.is_default)
      if (defaultTerm && !selectedPaymentTermId) {
        setSelectedPaymentTermId(defaultTerm.id)
        form.setFieldValue('payment_terms', defaultTerm.label)
        // Calculate due date based on default payment term
        const currentDate = form.getFieldValue('date') || dayjs()
        form.setFieldValue('due_date', dayjs(currentDate).add(defaultTerm.days, 'day'))
      }
    }
  }, [documentId, paymentTermsData, selectedPaymentTermId, form])

  // Fetch existing purchase order if editing
  const { data: orderData } = useQuery({
    queryKey: ['purchase-order', savedOrderId],
    queryFn: async () => {
      if (!savedOrderId) return null
      const response = await purchaseOrderAPI.get(savedOrderId)
      return response.data as PurchaseOrder
    },
    enabled: !!savedOrderId,
  })

  // Fetch linked invoices
  //
  // ⚠️ PAR « /supplier-invoices », ET NON PAR « /invoices ».
  //
  // Les factures nées d'une commande d'achat sont des factures FOURNISSEURS, et
  // « /invoices » les rendait avec le statut « validated » — Invoices::outStatus()
  // distingue « validée » d'« envoyée » selon qu'un courriel est parti, ce qui
  // n'a aucun sens pour une facture qu'on reçoit. La colonne Statut de cet
  // onglet affichait donc « validated » en clair et en anglais, comme la liste
  // des factures fournisseurs. Le contrôleur des achats, lui, dit « sent »,
  // c'est-à-dire « Reçue ».
  const { data: linkedInvoicesData } = useQuery({
    queryKey: ['linked-invoices', savedOrderId],
    queryFn: async () => {
      if (!savedOrderId) return null
      const response = await api.get('/supplier-invoices', {
        params: { purchase_order_id: savedOrderId, page_size: 100, type: 'with_credits' },
      })
      return response.data
    },
    enabled: !!savedOrderId,
  })

  // Load order data when editing
  useEffect(() => {
    // Prevent re-initialization when articles cache is invalidated
    if (linesInitializedRef.current) {
      return
    }

    if (orderData) {
      form.setFieldsValue({
        supplier_id: orderData.supplier_id,
        date: orderData.date ? dayjs(orderData.date) : dayjs(),
        due_date: orderData.due_date ? dayjs(orderData.due_date) : null,
        expected_date: orderData.expected_date ? dayjs(orderData.expected_date) : null,
        subject: orderData.subject || '',
        reference: orderData.reference || '',
        notes: orderData.notes,
        payment_terms: orderData.payment_terms || '',
        // ⚠️ CE QUI NE SE RELIT PAS S'EFFACE AU DEUXIÈME ENREGISTREMENT.
        //
        // L'adresse de livraison partait bien en base au premier enregistrement
        // — et s'imprimait correctement — mais l'éditeur ne la relisait jamais :
        // le champ revenait vide, et un second « Enregistrer », le réflexe de
        // n'importe quel utilisateur, la remplaçait par la chaîne vide.
        delivery_address: orderData.delivery_address || '',
      })

      // Même histoire pour la remise globale : le champ repartait à 0,00 et
      // l'enregistrement suivant annulait la remise saisie la veille.
      if (orderData.discount_percent && orderData.discount_percent > 0) {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(orderData.discount_percent)
      } else if (orderData.discount_amount && orderData.discount_amount > 0) {
        setGlobalDiscountType('amount')
        setGlobalDiscountValue(orderData.discount_amount)
      }

      // La condition de paiement se relit comme dans le devis et la facture :
      // sans elle, le sélecteur repartait vide et l'enregistrement effaçait ce
      // qui était en base.
      if (orderData.payment_terms && paymentTermsData?.payment_terms) {
        const term = paymentTermsData.payment_terms.find((pt: PaymentTerm) => pt.label === orderData.payment_terms)
        if (term) {
          setSelectedPaymentTermId(term.id)
        }
      }

      // Set selected supplier
      if (orderData.supplier_id) {
        const supplier = suppliersData?.data?.find((s: Supplier) => s.id === orderData.supplier_id)
        // La commande PORTE son fournisseur : on le prend du document quand la
        // liste ne le contient pas, plutôt que de laisser la case vide.
        if (supplier) {
          setSelectedSupplier(supplier)
        } else if (orderData.supplier) {
          setSelectedSupplier({
            id: orderData.supplier.id,
            code: orderData.supplier.code || '',
            name: orderData.supplier.name,
          } as Supplier)
        }
      }

      const convertedLines: PurchaseOrderLine[] = (orderData.lines || []).map((line, idx) => {
        const lineType = (line.line_type || 'article') as LineType
        const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
        const purchasePrice = line.unit_price || article?.purchase_price || 0
        return {
          key: `line-${idx}-${Math.random().toString(36).substr(2, 9)}`,
          line_type: lineType,
          article_id: line.article_id,
          description: line.description || article?.name || '',
          quantity: line.quantity,
          unit: (line as { unit?: string }).unit || article?.unit || '',
          purchase_price: purchasePrice,
          coefficient: 1,
          unit_price: purchasePrice,
          discount_percent: line.discount || 0,
          vat_rate: line.vat_rate ?? defaultVatRate,
        }
      })

      setLines(convertedLines.length > 0 ? convertedLines : [createEmptyLine()])
      linesInitializedRef.current = true
      updateTabTitle(tabId, t('poEditor.orderTitle', { number: orderData.number }))

      // Load footer content
      setFooterContent((orderData as PurchaseOrder & { footer_content?: string }).footer_content || '')
    } else if (!savedOrderId) {
      // Initialize new order, possibly from deal metadata
      const initialValues: Record<string, unknown> = {
        date: dayjs(),
      }

      // If coming from a deal, use deal data
      if (tabMetadata?.subject) {
        initialValues.subject = tabMetadata.subject
      }

      form.setFieldsValue(initialValues)

      // Set lines from deal metadata or empty line
      if (tabMetadata?.lines && Array.isArray(tabMetadata.lines) && tabMetadata.lines.length > 0) {
        const dealLines = (tabMetadata.lines as Array<{
          deal_line_id?: string
          article_id?: string
          description?: string
          quantity?: number
          unit?: string
          unit_price?: number
          discount_percent?: number
          tva_rate?: number
          line_type?: string
        }>).map((line, idx) => createLineFromDeal(line, idx, defaultVatRate))
        setLines(dealLines)
      } else {
        setLines([createEmptyLine()])
      }
      linesInitializedRef.current = true
    }
  }, [orderData, articlesData, suppliersData, paymentTermsData, savedOrderId, form, tabId, updateTabTitle, tabMetadata, defaultVatRate, t])

  // Handle supplier selection
  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliersData?.data?.find((s: Supplier) => s.id === supplierId)
    setSelectedSupplier(supplier || null)
    form.setFieldsValue({ supplier_id: supplierId })

    // ⚠️ LE DÉLAI DE RÈGLEMENT EST CELUI DE LA FICHE FOURNISSEUR.
    //
    // Un fournisseur réglé à 60 jours voyait sa commande partir avec la
    // condition globale par défaut — « 30 jours » — et une échéance à J+30 :
    // rien n'était repris de sa fiche, alors que son adresse, elle, l'était.
    // La fiche rend le délai en JOURS ; c'est par lui qu'on retrouve la
    // condition de règlement du paramétrage.
    const jours = supplier?.payment_terms
    const terme = typeof jours === 'number'
      ? paymentTermsData?.payment_terms?.find((pt: PaymentTerm) => pt.days === jours)
      : undefined

    if (terme) {
      setSelectedPaymentTermId(terme.id)
      form.setFieldValue('payment_terms', terme.label)

      const dateCommande = form.getFieldValue('date')

      if (dateCommande) {
        form.setFieldValue('due_date', dayjs(dateCommande).add(terme.days, 'day'))
      }
    }

    setTabDirty(tabId, true)
  }

  const createEmptyLine = (lineType: LineType = 'article'): PurchaseOrderLine => ({
    key: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    line_type: lineType,
    article_id: undefined,
    description: lineType === 'page_break' ? t('poEditor.pageBreakLabel') : lineType === 'subtotal' ? t('poEditor.subtotal') : '',
    quantity: 1,
    unit: '',
    purchase_price: 0,
    coefficient: 1,
    unit_price: 0,
    discount_percent: 0,
    vat_rate: defaultVatRate,
  })

  // Create line from deal metadata
  const createLineFromDeal = (dealLine: {
    deal_line_id?: string
    article_id?: string
    description?: string
    quantity?: number
    unit?: string
    unit_price?: number
    discount_percent?: number
    tva_rate?: number
    line_type?: string
  }, idx: number, defaultRate: number): PurchaseOrderLine => ({
    key: `line-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
    deal_line_id: dealLine.deal_line_id,
    line_type: (dealLine.line_type || 'article') as LineType,
    article_id: dealLine.article_id,
    description: dealLine.description || '',
    quantity: dealLine.quantity || 1,
    unit: dealLine.unit || '',
    purchase_price: dealLine.unit_price || 0,  // For purchase orders, unit_price is purchase_price
    coefficient: 1,
    unit_price: dealLine.unit_price || 0,
    discount_percent: dealLine.discount_percent || 0,
    vat_rate: dealLine.tva_rate ?? defaultRate,
  })

  // Helper to invalidate all purchase order queries
  const invalidateOrderQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'], refetchType: 'all' })
    queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' })
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseOrderAPI.create(data),
    onSuccess: (response) => {
      message.success(t('poEditor.orderCreated'))
      invalidateOrderQueries()
      const newOrder = response.data as PurchaseOrder
      setSavedOrderId(newOrder.id) // Sauvegarder l'ID pour les modifications suivantes
      updateTabTitle(tabId, t('poEditor.orderTitle', { number: newOrder.number }))
      setTabDirty(tabId, false)
    },
    onError: (error: Error & { response?: { data?: { error?: string } } }) => {
      const errorMessage = error.response?.data?.error || t('poEditor.errorCreate')
      message.error(errorMessage)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      purchaseOrderAPI.update(id, data),
    onSuccess: (_response, variables) => {
      message.success(t('poEditor.orderUpdated'))
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', variables.id] })
      setTabDirty(tabId, false)
    },
    onError: () => {
      message.error(t('poEditor.errorUpdate'))
    },
  })

  const confirmMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.confirm(id),
    onSuccess: (_response, id) => {
      message.success(t('poEditor.orderConfirmed'))
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
    },
    onError: () => {
      message.error(t('poEditor.errorConfirm'))
    },
  })

  // « Attente validation » posée ou retirée à la main. Aucun état interne ne
  // change : c'est une métadonnée sur un brouillon (voir Documents::ATTENTE).
  const peutValider = useCanValidateDocuments()
  const droitsConnus = usePermissionsChargees()

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => purchaseOrderAPI.updateStatus(id, status),
    onSuccess: (_response, { id }) => {
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
    },
    onError: (e: unknown) => {
      const corps = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data

      message.error(corps?.message || corps?.error || t('poEditor.errorStatus', "Le statut n'a pas changé."), 8)
    },
  })

  // ⚠️ LA PASSATION DE MAIN, QUAND ON N'A PAS LE DROIT DE VALIDER.
  //
  // Sans elle, le rédacteur qui n'a pas « amsbm_validate_documents » finissait sa
  // commande et se heurtait à un 403 sur « Confirmée » : il allait le demander de
  // vive voix, ou la commande dormait. La route prévient dans AMS Studio et par
  // courriel, et retient qui a demandé — pour lui rendre compte une fois fait.
  const requestValidationMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.requestValidation(id),
    onSuccess: (reponse) => {
      const prevenus = Number((reponse?.data as { notified?: number } | undefined)?.notified ?? 0)

      if (prevenus > 0) {
        message.success(
          t(
            'poEditor.validationRequested',
            'Demande envoyée : {{count}} personne(s) prévenue(s). La commande attend sa validation.',
            { count: prevenus }
          )
        )
      } else {
        message.warning(
          t(
            'poEditor.validationRequestedNobody',
            "La commande attend sa validation, mais personne n'a pu être prévenu : aucun compte n'a le droit de valider, ou leur adresse de courriel manque."
          ),
          8
        )
      }

      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', savedOrderId] })
    },
    onError: (e: unknown) => {
      const corps = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data
      const phrase = corps?.message || corps?.error || ''

      message.error(
        phrase || t('poEditor.validationRequestError', "La demande de validation n'est pas partie."),
        phrase ? 8 : undefined
      )
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.cancel(id),
    onSuccess: (_response, id) => {
      message.success(t('poEditor.orderCancelled'))
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
    },
    onError: () => {
      message.error(t('poEditor.errorCancel'))
    },
  })

  const createInvoiceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseOrderAPI.createInvoice(savedOrderId!, data),
    onSuccess: (response) => {
      message.success(t('poEditor.invoiceCreated'))
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['linked-invoices', savedOrderId] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order', savedOrderId] })
      setIsInvoiceModalOpen(false)
      invoiceForm.resetFields()
      // Ouvrir la facture créée
      const invoice = response.data
      openDocumentTab('supplier-invoice', invoice.id, t('poEditor.invoiceTabTitle', { number: invoice.number }))
    },
    onError: (error: Error & { response?: { data?: { error?: string } } }) => {
      const errorMessage = error.response?.data?.error || t('poEditor.errorCreateInvoice')
      message.error(errorMessage)
    },
  })

  const receiveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseOrderAPI.receive(savedOrderId!, data),
    onSuccess: () => {
      message.success(t('poEditor.receptionSaved'))
      invalidateOrderQueries()
      queryClient.invalidateQueries({ queryKey: ['purchase-order', savedOrderId] })
      // ⚠️ ET L'ÉCRAN DES RÉCEPTIONS, S'IL EST OUVERT DANS UN AUTRE ONGLET.
      //
      // Réceptionner CRÉE une pièce : elle doit apparaître tout de suite dans la
      // liste des réceptions, sans qu'on ait à la recharger à la main. Les
      // onglets restent montés — « refetchType: all » rattrape donc aussi celui
      // qu'on ne regarde pas en ce moment. Le stock bouge en même temps, sous
      // ses deux clés selon l'écran qui l'a demandé.
      queryClient.invalidateQueries({ queryKey: ['receipts'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['stock'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['stock-levels'], refetchType: 'all' })
      setIsReceiveModalOpen(false)
      receiveForm.resetFields()
    },
    onError: (error: Error & { response?: { data?: { error?: string } } }) => {
      const errorMessage = error.response?.data?.error || t('poEditor.errorReception')
      message.error(errorMessage)
    },
  })

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      articleAPI.update(id, data),
    onSuccess: () => {
      message.success(t('poEditor.articlePriceUpdated'))
      queryClient.invalidateQueries({ queryKey: ['articles-for-po-editor'] })
    },
    onError: () => {
      message.error(t('poEditor.errorArticleUpdate'))
    },
  })

  // Status configuration
  const statusConfig: Record<string, { color: string; label: string }> = {
    draft: { color: 'default', label: t('poEditor.statusDraft') },
    // ⚠️ « attente validation » n'est pas un état interne de plus : c'est un
    // brouillon dont la validation a été demandée (voir Documents::outStatus).
    // La commande reste modifiable — celui qui relit doit pouvoir corriger.
    pending_validation: {
      color: 'orange',
      label: t('poEditor.statusPendingValidation', 'Attente validation'),
    },
    confirmed: { color: 'blue', label: t('poEditor.statusConfirmed') },
    partial: { color: 'orange', label: t('poEditor.statusPartial') },
    received: { color: 'green', label: t('poEditor.statusReceived') },
    cancelled: { color: 'red', label: t('poEditor.statusCancelled') },
  }

  // ⚠️ ON NE PROPOSE QUE CE QUI AGIT.
  //
  // Le menu offrait les cinq statuts ; handleStatusChange n'en traite que deux,
  // et le serveur ne connaît de toute façon ni « draft » ni « partial » (400
  // « Statut inconnu »). Cliquer sur « Brouillon », « Partielle » ou « Reçue »
  // ne faisait donc rien — pas même un message. « Partielle » et « Reçue » sont
  // d'ailleurs calculées à la réception : les poser à la main n'aurait pas de
  // sens. Elles restent dans statusConfig, qui sert à AFFICHER l'état courant.
  //
  // « Attente validation » s'y ajoute : le rédacteur peut l'annoncer lui-même,
  // sans attendre d'avoir cliqué sur « Demande de validation », et y renoncer.
  // Retirer la demande ne défait rien — la commande est restée un brouillon.
  const transitionsParStatut: Record<string, string[]> = {
    draft: ['pending_validation', 'confirmed', 'cancelled'],
    pending_validation: ['confirmed', 'draft', 'cancelled'],
    confirmed: ['cancelled'],
    partial: [],
    received: [],
    cancelled: [],
  }

  const statusMenuItems = (transitionsParStatut[orderData?.status || 'draft'] || []).map((key) => ({
    key,
    label: statusConfig[key]?.label || key,
  }))

  const handleStatusChange = (status: string) => {
    if (!savedOrderId) return
    if (status === 'confirmed') {
      confirmMutation.mutate(savedOrderId)
    } else if (status === 'cancelled') {
      cancelMutation.mutate(savedOrderId)
    } else if (status === 'pending_validation' || status === 'draft') {
      // Les deux passent par la route de statut : la première pose la demande,
      // la seconde la retire. Aucune des deux ne change l'état interne.
      statusMutation.mutate({ id: savedOrderId, status })
    }
  }

  // Open supplier tab
  const handleOpenSupplier = () => {
    const supplierId = form.getFieldValue('supplier_id')
    if (supplierId) {
      const supplier = suppliersData?.data?.find((s: Supplier) => s.id === supplierId)
      openDocumentTab('supplier', supplierId, supplier ? t('poEditor.supplierTabTitle', { name: supplier.name }) : t('poEditor.supplier'))
    }
  }

  // Ouvrir le modal de création de facture
  const handleOpenInvoiceModal = () => {
    if (!orderData) return

    // Ce qui reste à facturer, c'est ce qui est ARRIVÉ moins ce qui est DÉJÀ
    // FACTURÉ : la fenêtre proposait le reçu tout entier, si bien qu'une commande
    // déjà facturée rouvrait la porte à un doublon que le serveur refusait ensuite.
    const linesToInvoice = orderData.lines
      ?.filter((line) => line.line_type === 'article' || !line.line_type)
      .map((line) => {
        const disponible = (line.received_quantity || 0) - (line.invoiced_quantity || 0)
        return {
          line_id: line.id!,
          selected: true,
          quantity: disponible,
          max_quantity: disponible,
          description: line.description || '',
        }
      })
      .filter((line) => line.max_quantity > 0) || []

    if (linesToInvoice.length === 0) {
      message.warning(t('poEditor.noReceivedQtyToInvoice'))
      return
    }

    setInvoiceLines(linesToInvoice)
    invoiceForm.setFieldsValue({
      invoice_date: dayjs(),
      due_date: dayjs().add(30, 'day'),
      reference: '',
      notes: '',
    })
    setIsInvoiceModalOpen(true)
  }

  // Soumettre la création de facture
  const handleCreateInvoice = async () => {
    try {
      const values = await invoiceForm.validateFields()

      const selectedLines = invoiceLines
        .filter((line) => line.selected && line.quantity > 0)
        .map((line) => ({
          purchase_order_line_id: line.line_id,
          quantity: line.quantity,
        }))

      if (selectedLines.length === 0) {
        message.error(t('poEditor.selectAtLeastOneLineToInvoice'))
        return
      }

      createInvoiceMutation.mutate({
        invoice_date: values.invoice_date.toISOString(),
        due_date: values.due_date?.toISOString(),
        reference: values.reference || '',
        notes: values.notes || '',
        lines: selectedLines,
      })
    } catch (error) {
      // Validation error
    }
  }

  // Ouvrir le modal de réception
  const handleOpenReceiveModal = () => {
    if (!orderData) return

    // Préparer les lignes avec les quantités restant à recevoir
    const linesToReceive = orderData.lines
      ?.filter((line) => line.line_type === 'article' || !line.line_type)
      .map((line) => {
        const alreadyReceived = line.received_quantity || 0
        const remaining = line.quantity - alreadyReceived
        return {
          line_id: line.id!,
          selected: remaining > 0,
          quantity: remaining > 0 ? remaining : 0,
          max_quantity: remaining,
          already_received: alreadyReceived,
          description: line.description || '',
        }
      })
      .filter((line) => line.max_quantity > 0) || []

    if (linesToReceive.length === 0) {
      message.warning(t('poEditor.allQtyAlreadyReceived'))
      return
    }

    setReceiveLines(linesToReceive)
    receiveForm.setFieldsValue({
      date: dayjs(),
      notes: '',
    })
    setIsReceiveModalOpen(true)
  }

  // Soumettre la réception
  const handleReceive = async () => {
    try {
      const values = await receiveForm.validateFields()

      const selectedLines = receiveLines
        .filter((line) => line.selected && line.quantity > 0)
        .map((line) => ({
          purchase_order_line_id: line.line_id,
          quantity: line.quantity,
        }))

      if (selectedLines.length === 0) {
        message.error(t('poEditor.selectAtLeastOneLineToReceive'))
        return
      }

      receiveMutation.mutate({
        date: values.date.toISOString(),
        notes: values.notes || '',
        lines: selectedLines,
      })
    } catch (error) {
      // Validation error
    }
  }

  // Calculate subtotal for a given line (sum of all article lines before it since start or last subtotal)
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

  // Calculate totals
  const totals = useMemo(() => {
    let totalHTBeforeDiscount = 0
    let totalTVABeforeDiscount = 0

    lines.forEach((line) => {
      // Skip non-article lines
      if (line.line_type !== 'article') return

      const lineTotal = line.quantity * line.unit_price
      const lineDiscount = (lineTotal * line.discount_percent) / 100
      const lineTotalAfterDiscount = lineTotal - lineDiscount
      const lineTVA = (lineTotalAfterDiscount * line.vat_rate) / 100

      totalHTBeforeDiscount += lineTotalAfterDiscount
      totalTVABeforeDiscount += lineTVA
    })

    // Apply global discount
    let globalDiscount = 0
    if (globalDiscountType === 'percent' && globalDiscountValue > 0) {
      globalDiscount = (totalHTBeforeDiscount * globalDiscountValue) / 100
    } else if (globalDiscountType === 'amount' && globalDiscountValue > 0) {
      globalDiscount = globalDiscountValue
    }

    const totalHT = totalHTBeforeDiscount - globalDiscount
    // Recalculate TVA proportionally after global discount
    const discountRatio = totalHTBeforeDiscount > 0 ? totalHT / totalHTBeforeDiscount : 1
    const totalTVA = totalTVABeforeDiscount * discountRatio

    const totalTTC = totalHT + totalTVA

    return {
      totalHTBeforeDiscount: Math.round(totalHTBeforeDiscount * 100) / 100,
      globalDiscount: Math.round(globalDiscount * 100) / 100,
      totalHT: Math.round(totalHT * 100) / 100,
      totalTVA: Math.round(totalTVA * 100) / 100,
      totalTTC: Math.round(totalTTC * 100) / 100,
    }
  }, [lines, globalDiscountType, globalDiscountValue])

  const handleArticleSelect = (articleId: string, lineKey: string) => {
    const article = articlesData?.data?.find((a: Article) => a.id === articleId)
    if (article) {
      const purchasePrice = article.purchase_price || 0
      setLines((prev) =>
        prev.map((line) =>
          line.key === lineKey
            ? {
                ...line,
                article_id: articleId,
                description: article.name,
                unit: article.unit || '',
                purchase_price: purchasePrice,
                coefficient: 1,
                unit_price: purchasePrice,
                vat_rate: defaultVatRate,
              }
            : line
        )
      )
      setTabDirty(tabId, true)
    }
  }

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

        // Recalculate unit_price when purchase_price changes
        if (field === 'purchase_price') {
          updatedLine.unit_price = Math.round((value as number) * updatedLine.coefficient * 100) / 100
        }

        return updatedLine
      })
    )
    setTabDirty(tabId, true)
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
      const duplicatedLine: PurchaseOrderLine = {
        ...lineToDuplicate,
        key: `line-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
      }))
      newLines.splice(lastSelectedIndex + 1, 0, ...duplicatedLines)
      return newLines
    })
    setSelectedRowKeys([])
    setTabDirty(tabId, true)
  }

  // Handler for purchase price change - check if different from article price
  const handlePurchasePriceChange = (lineKey: string, newValue: number) => {
    const line = lines.find((l) => l.key === lineKey)
    if (!line || !line.article_id) return

    const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
    const originalPrice = article?.purchase_price || 0

    // If price is different from original article price, show modal
    if (newValue !== originalPrice) {
      setPriceModalData({
        lineKey,
        articleId: line.article_id,
        articleName: article?.name || line.description,
        oldPrice: originalPrice,
        newPrice: newValue,
      })
      setPriceModalOpen(true)
    }
  }

  // Handler for price modal confirmation
  const handlePriceModalConfirm = (action: 'document' | 'article' | 'cancel') => {
    if (!priceModalData) return

    if (action === 'cancel') {
      // Revert to original price
      const article = articlesData?.data?.find((a: Article) => a.id === priceModalData.articleId)
      const originalPrice = article?.purchase_price || 0
      setLines((prev) =>
        prev.map((line) =>
          line.key === priceModalData.lineKey
            ? {
                ...line,
                purchase_price: originalPrice,
                unit_price: originalPrice * line.coefficient,
              }
            : line
        )
      )
    } else if (action === 'article') {
      // Update article in database
      updateArticleMutation.mutate({
        id: priceModalData.articleId,
        data: { purchase_price: priceModalData.newPrice },
      })
    }
    // For 'document' action, price is already updated in the line

    setPriceModalOpen(false)
    setPriceModalData(null)
  }

  // --- PDF handlers ---
  const handleDownloadPdf = async () => {
    if (!savedOrderId) return
    try {
      const response = await purchaseOrderAPI.getPdf(savedOrderId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Commande-${orderData?.number || 'nouvelle'}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('poEditor.pdfDownloaded'))
    } catch {
      message.error(t('poEditor.errorPdfDownload'))
    }
  }

  const handlePreviewPdf = async () => {
    if (!savedOrderId) return
    setPdfPreviewLoading(true)
    setPdfPreviewOpen(true)
    try {
      const response = await purchaseOrderAPI.getPdf(savedOrderId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
    } catch {
      setPdfPreviewOpen(false)
      message.error(t('poEditor.errorPdfLoad'))
    } finally {
      setPdfPreviewLoading(false)
    }
  }

  const closePdfPreview = () => {
    setPdfPreviewOpen(false)
    if (pdfPreviewUrl) {
      window.URL.revokeObjectURL(pdfPreviewUrl)
      setPdfPreviewUrl(null)
    }
  }

  const handleSave = async () => {
    try {
      await form.validateFields()

      const values = form.getFieldsValue()

      // Validate required fields
      if (!values.supplier_id) {
        message.error(t('poEditor.selectSupplierError'))
        return false
      }
      if (!values.subject) {
        message.error(t('poEditor.enterSubjectError'))
        return false
      }

      // ⚠️ UNE SAISIE FAUTIVE SE REFUSE, ELLE NE SE CORRIGE PAS EN DOUCE.
      //
      // Les champs bornaient la quantité à 0,001 et le prix à 0 : une quantité de
      // 0 devenait « 0.001 » et un prix de −10 « 0.00 » sous les yeux de
      // l'utilisateur, sans un mot, et le total suivait. La borne est levée — la
      // valeur saisie reste affichée telle quelle — et c'est ici qu'on la refuse,
      // en disant quoi.
      const lignesArticle = lines.filter((line) => line.line_type === 'article')

      if (lignesArticle.some((line) => line.quantity <= 0)) {
        message.error(t('poEditor.quantityMustBePositive', 'La quantité d\'une ligne d\'article doit être supérieure à zéro.'))
        return false
      }
      if (lignesArticle.some((line) => line.unit_price < 0 || line.purchase_price < 0)) {
        message.error(t('poEditor.priceCannotBeNegative', 'Un prix négatif ne peut pas figurer sur une commande.'))
        return false
      }
      if (lignesArticle.some((line) => !line.article_id && !line.description.trim())) {
        message.error(t('poEditor.lineNeedsArticleOrDescription', 'Chaque ligne doit porter un article du catalogue ou une désignation.'))
        return false
      }

      // On ne se fait pas livrer avant d'avoir commandé.
      if (values.expected_date && values.date && values.expected_date.isBefore(values.date, 'day')) {
        message.error(t('poEditor.expectedBeforeOrderDate', 'La livraison prévue ne peut pas précéder la date de la commande.'))
        return false
      }

      // ⚠️ UNE COMMANDE SANS MARCHANDISE S'ANNONCE AVANT, PAS APRÈS. Elle
      // s'enregistrait à 0,00 € sans un mot, et le refus n'arrivait qu'au clic
      // sur « Confirmer » — « impossible de valider un document sans ligne ».
      if (lignesArticle.length === 0) {
        const poursuivre = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: t('poEditor.emptyOrderTitle', 'Commande sans marchandise'),
            content: t('poEditor.emptyOrderWarning', "Cette commande ne comporte aucune ligne d'article : elle s'enregistrera à 0,00 € et ne pourra pas être confirmée tant qu'elle restera vide."),
            okText: t('poEditor.emptyOrderSaveAnyway', 'Enregistrer quand même'),
            cancelText: t('common.cancel'),
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })

        if (!poursuivre) {
          return false
        }
      }
      // ⚠️ CE QUI N'EST PAS ENVOYÉ EST PERDU — ET PARFOIS EFFACÉ.
      //
      // L'échéance manquait au corps : le serveur réécrit « due_date » depuis
      // ce qu'il reçoit, donc l'absence valait effacement, et un simple
      // enregistrement vidait la date d'échéance de la commande. La condition
      // de paiement, elle, n'était jamais envoyée : toute modification à
      // l'écran repartait au premier rechargement, sans un mot.
      //
      // « payment_terms » se lit dans le magasin du formulaire et non dans
      // values : il n'a pas de Form.Item à lui, il est posé par le sélecteur.
      const data: Record<string, unknown> = {
        supplier_id: values.supplier_id,
        date: values.date?.toISOString(),
        due_date: values.due_date?.toISOString(),
        expected_date: values.expected_date?.toISOString(),
        payment_terms: form.getFieldValue('payment_terms') || '',
        subject: values.subject || '',
        // La référence de la commande CHEZ LE FOURNISSEUR : la donnée était
        // prévue côté serveur et l'éditeur n'avait pas de champ pour elle.
        reference: values.reference || '',
        notes: values.notes || '',
        delivery_address: values.delivery_address || '',
        footer_content: footerContent || '',
        // ⚠️ LA REMISE GLOBALE PARTAIT DANS LE VIDE. L'écran l'affichait, la
        // déduisait du net et du TTC, et ne l'envoyait pas : la pièce
        // enregistrée ne portait pas le montant qu'on venait de lire, et le
        // champ revenait à 0,00 à la réouverture.
        discount_percent: globalDiscountType === 'percent' ? globalDiscountValue : 0,
        discount_amount: globalDiscountType === 'amount' ? globalDiscountValue : 0,
        // ⚠️ UNE LIGNE EN SAISIE LIBRE N'EST PAS UNE LIGNE VIDE. Le filtre
        // écartait toute ligne d'article sans article au catalogue : « Prestation
        // libre, 2 × 30 € » disparaissait du corps envoyé, l'écran continuait
        // d'afficher 60,00 € et la commande s'enregistrait sans aucune ligne,
        // derrière un « Commande créée avec succès ». C'est pourtant la moitié
        // d'un achat — frais de port, prestation ponctuelle. Le serveur, lui,
        // n'exige qu'une désignation, et le refuse clairement si elle manque.
        lines: lines
          .map((line) => ({
            deal_line_id: line.deal_line_id || null,
            line_type: line.line_type || 'article',
            article_id: line.article_id,
            description: line.description || '',
            quantity: line.quantity,
            unit: line.unit || 'unité',
            // Le prix d'achat et le coefficient font le prix unitaire : sans
            // eux, un achat à 80 € au coefficient 1,5 se relit en achat à 120 €
            // au coefficient 1, et la modale de révision des prix travaille sur
            // un chiffre faux.
            purchase_price: line.purchase_price,
            coefficient: line.coefficient,
            unit_price: line.unit_price,
            discount_percent: line.discount_percent || 0,
            tva_rate: line.vat_rate ?? defaultVatRate,
          })),
      }

      // Add deal_id if from deal
      if (tabMetadata?.deal_id) {
        data.deal_id = tabMetadata.deal_id
      }

      if (savedOrderId) {
        await updateMutation.mutateAsync({ id: savedOrderId, data })
      } else {
        await createMutation.mutateAsync(data)
      }

      return true
    } catch (error) {
      console.error('Validation error:', error)

      return false
    }
  }

  // Determine modification rights
  const isNewOrder = !savedOrderId
  // « attente validation » reste modifiable : c'est un brouillon relu.
  const isDraft =
    orderData?.status === 'draft' || orderData?.status === 'pending_validation' || isNewOrder
  const canModify = isNewOrder || isDraft

  // Style for read-only fields
  // Le statut, dit comme l'écran le dit ailleurs : l'étiquette « Non modifiable »
  // le reprend mot pour mot, pour qu'on reconnaisse celui qu'on lit en haut.
  const orderStatusLabel = statusConfig[orderData?.status || '']?.label || orderData?.status || ''

  const readOnlyStyle = !canModify ? {
    color: token.colorText,
    backgroundColor: token.colorBgLayout,
    cursor: 'not-allowed'
  } : {}

  // Number of columns that can be merged for special lines (from icon to total)
  const columns = [
    {
      title: '',
      dataIndex: 'drag',
      key: 'drag',
      width: 40,
      render: (_: unknown, record: PurchaseOrderLine) => <DragHandle id={record.key} />,
    },
    {
      title: t('poEditor.colRef'),
      dataIndex: 'article_id',
      key: 'article_id',
      width: columnWidths.article_id,
      onHeaderCell: () => ({
        width: columnWidths.article_id,
        onResize: handleResize('article_id'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return (
          <Select
            showSearch
            placeholder={t('poEditor.colRef')}
            optionFilterProp="label"
            loading={isLoadingArticles}
            value={record.article_id}
            onChange={(value) => handleArticleSelect(value, record.key)}
            options={articlesData?.data?.filter((a: Article) => a.stock_managed)?.map((a: Article) => ({
              value: a.id,
              label: `${a.code} - ${a.name}`,
            })) || []}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
            popupMatchSelectWidth={false}
            dropdownStyle={{ minWidth: 350 }}
            labelRender={(props) => {
              const article = articlesData?.data?.find((a: Article) => a.id === props.value)
              return article ? article.code : props.label
            }}
            optionRender={(option) => (
              <div>
                <strong>{articlesData?.data?.find((a: Article) => a.id === option.value)?.code}</strong>
                <span style={{ marginLeft: 8, color: '#888' }}>
                  {articlesData?.data?.find((a: Article) => a.id === option.value)?.name}
                </span>
              </div>
            )}
          />
        )
      },
    },
    {
      title: t('common.description'),
      dataIndex: 'description',
      key: 'description',
      width: columnWidths.description,
      onHeaderCell: () => ({
        width: columnWidths.description,
        onResize: handleResize('description'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type === 'text') {
          return (
            <Input.TextArea
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('poEditor.freeTextPlaceholder')}
              disabled={!canModify}
              autoSize={{ minRows: 1, maxRows: 3 }}
              style={{ fontStyle: 'italic', ...readOnlyStyle }}
            />
          )
        }
        if (record.line_type === 'page_break') {
          return (
            <div style={{
              textAlign: 'center',
              color: token.colorTextSecondary,
              borderTop: `2px dashed ${token.colorBorder}`,
              borderBottom: `2px dashed ${token.colorBorder}`,
              padding: '8px 0',
              background: token.colorBgLayout
            }}>
              {t('poEditor.pageBreakLabel')}
            </div>
          )
        }
        if (record.line_type === 'subtotal') {
          return (
            <Input
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('poEditor.subtotal')}
              disabled={!canModify}
              style={{ fontWeight: 'bold', ...readOnlyStyle }}
            />
          )
        }
        return (
          <Input
            value={record.description}
            onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
            placeholder={t('common.description')}
            disabled={!canModify}
            style={readOnlyStyle}
          />
        )
      },
    },
    {
      title: t('poEditor.colQty'),
      dataIndex: 'quantity',
      key: 'quantity',
      width: columnWidths.quantity,
      onHeaderCell: () => ({
        width: columnWidths.quantity,
        onResize: handleResize('quantity'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.quantity}
            onChange={(value) => handleLineChange(record.key, 'quantity', value || 0)}
            // ⚠️ AUCUNE BORNE ICI, ET C'EST VOULU : une saisie fautive doit rester
            // lisible à l'écran pour être expliquée. « min » la remplaçait en
            // silence — 0 devenait 0,001, −5 devenait 0,001 — et l'utilisateur
            // voyait son chiffre changer tout seul. handleSave() la refuse et dit
            // pourquoi.
            precision={3}
            controls={false}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: t('poEditor.colUnit'),
      dataIndex: 'unit',
      key: 'unit',
      width: 70,
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return <span style={{ color: '#888' }}>{record.unit || 'U.'}</span>
      },
    },
    {
      title: t('poEditor.colPurchasePrice'),
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: columnWidths.purchase_price,
      onHeaderCell: () => ({
        width: columnWidths.purchase_price,
        onResize: handleResize('purchase_price'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.purchase_price}
            onChange={(value) => handleLineChange(record.key, 'purchase_price', value || 0)}
            onBlur={() => {
              if (record.article_id) {
                handlePurchasePriceChange(record.key, record.purchase_price)
              }
            }}
            // Voir la note sur la quantité : on refuse à l'enregistrement plutôt
            // que de remplacer la saisie sans le dire.
            precision={2}
            controls={false}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    // ⚠️ PAS DE COEFFICIENT DE MARGE SUR UN BON DE COMMANDE.
    //
    // La colonne « Coef. » multipliait le prix d'achat pour former le prix
    // unitaire (12,50 × 2 = 25,00), et c'est ce prix MAJORÉ qui partait au
    // fournisseur sur le PDF. Un coefficient de marge appartient à la vente ;
    // sur un achat, le prix unitaire est celui qu'on a négocié, et il reste
    // saisissable dans sa propre colonne. Le champ subsiste à 1 dans le modèle
    // de ligne — il est encore lu par la modale de révision des prix — mais il
    // ne s'offre plus à la saisie.
    {
      title: t('poEditor.colUnitPrice'),
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: columnWidths.unit_price,
      onHeaderCell: () => ({
        width: columnWidths.unit_price,
        onResize: handleResize('unit_price'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.unit_price}
            onChange={(value) => handleLineChange(record.key, 'unit_price', value || 0)}
            // Voir la note sur la quantité.
            precision={2}
            controls={false}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: t('poEditor.colDiscount'),
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      width: columnWidths.discount_percent,
      onHeaderCell: () => ({
        width: columnWidths.discount_percent,
        onResize: handleResize('discount_percent'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value || 0)}
            min={0}
            max={100}
            precision={1}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: t('poEditor.colVat'),
      dataIndex: 'vat_rate',
      key: 'vat_rate',
      width: columnWidths.vat_rate,
      onHeaderCell: () => ({
        width: columnWidths.vat_rate,
        onResize: handleResize('vat_rate'),
      }),
      render: (_: unknown, record: PurchaseOrderLine) => {
        if (record.line_type !== 'article') return null
        const configuredOptions = inputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
        const fallbackOptions = [
          // ⚠️ PAS DE TAUX FRANÇAIS CODÉS EN DUR ICI.
          //
          // Le serveur refuse désormais un taux absent du paramétrage — avant, il
          // l'enregistrait à 0 % sans le dire, ce qui donnait des factures dont la
          // TVA affichée n'était pas celle qui partait au client. Proposer 20 / 10 /
          // 5,5 / 2,1 % à une entreprise luxembourgeoise reviendrait donc à l'envoyer
          // droit dans un refus. Tant que les taux ne sont pas paramétrés, seul le
          // taux nul est offrable.
          { value: 0, label: '0%' },
        ]
        const baseOptions = configuredOptions.length > 0 ? configuredOptions : fallbackOptions
        const options = baseOptions.some((o: { value: number; label: string }) => o.value === record.vat_rate)
          ? baseOptions
          : [...baseOptions, { value: record.vat_rate, label: `${record.vat_rate}%` }]
        return (
          <Select
            value={record.vat_rate}
            onChange={(value) => handleLineChange(record.key, 'vat_rate', value)}
            options={options}
            style={{ width: '100%', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: t('poEditor.colTotalHT'),
      key: 'total',
      width: columnWidths.total,
      onHeaderCell: () => ({
        width: columnWidths.total,
        onResize: handleResize('total'),
      }),
      render: (_: unknown, record: PurchaseOrderLine, index: number) => {
        if (record.line_type === 'text' || record.line_type === 'page_break') return null
        if (record.line_type === 'subtotal') {
          const subtotal = calculateSubtotalForLine(index)
          return <strong style={{ color: '#52c41a' }}>{subtotal.toFixed(2)} €</strong>
        }
        const lineTotal = record.quantity * record.unit_price
        const discount = (lineTotal * record.discount_percent) / 100
        const total = lineTotal - discount
        return <strong>{total.toFixed(2)} €</strong>
      },
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: PurchaseOrderLine) => (
        <Space size="small">
          <Tooltip title={t('poEditor.duplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleDuplicateLine(record.key)}
              disabled={!canModify}
            />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveLine(record.key)}
              disabled={!canModify || lines.length <= 1}
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
            {isNewOrder ? t('poEditor.newOrderTitle') : t('poEditor.orderTitle', { number: orderData?.number || '' })}
          </h2>
          {savedOrderId && orderData && (
            <Dropdown
              menu={{
                items: statusMenuItems,
                onClick: ({ key }) => handleStatusChange(key),
                selectedKeys: [orderData.status],
              }}
              trigger={['click']}
              // ⚠️ CHANGER D'ÉTAT N'EST PAS MODIFIER. Le menu était fermé dès que
              // la commande cessait d'être un brouillon : une commande confirmée
              // ne pouvait plus être annulée par là, alors que la machine à états
              // l'accepte. Ce qui décide, ce sont les transitions possibles.
              disabled={statusMenuItems.length === 0}
            >
              <Tag
                color={statusConfig[orderData.status]?.color || 'default'}
                style={{
                  cursor: statusMenuItems.length > 0 ? 'pointer' : 'default',
                  fontSize: 14,
                  padding: '4px 12px',
                }}
              >
                {statusConfig[orderData.status]?.label || orderData.status}{' '}
                {statusMenuItems.length > 0 && <DownOutlined />}
              </Tag>
            </Dropdown>
          )}
          {/* ⚠️ UNE PASTILLE À CÔTÉ DU STATUT, PAS UN BANDEAU EN TÊTE DE PAGE.
              Le bandeau prenait quatre lignes en haut de l'écran et repoussait le
              document à chaque ouverture d'une commande confirmée — c'est-à-dire
              presque toujours. L'information est la même, elle se lit là où on
              regarde déjà : contre l'étiquette d'état, comme sur les factures.
              L'explication vit dans la bulle d'aide, à portée de survol. */}
          {savedOrderId && orderData && !canModify && (
            <Tooltip
              title={t('poEditor.readOnlyHelp', {
                statut: orderStatusLabel,
                defaultValue:
                  'Cette commande est « {{statut}} » : elle ne se corrige plus, parce que des réceptions et des factures en découlent. Pour la défaire, annulez-la ; pour la reprendre, dupliquez-la.',
              })}
            >
              <Tag icon={<LockOutlined />} color="warning" style={{ cursor: 'help' }}>
                {t('poEditor.readOnlyTitle', 'Non modifiable')}
              </Tag>
            </Tooltip>
          )}
        </Space>
        <Space>
          {/* ⚠️ LE BOUTON N'EXISTE QUE POUR CELUI QUI NE PEUT PAS VALIDER.
              Chez le responsable, il ferait doublon avec « Confirmer » — et lui
              ferait s'envoyer un courriel à lui-même. */}
          {savedOrderId &&
            droitsConnus &&
            !peutValider &&
            (orderData?.status === 'draft' || orderData?.status === 'pending_validation') && (
              <Tooltip
                title={t(
                  'poEditor.requestValidationHelp',
                  'Prévient les personnes qui ont le droit de valider, et place la commande en attente de validation.'
                )}
              >
                <Button
                  icon={<AuditOutlined />}
                  loading={requestValidationMutation.isPending}
                  // ⚠️ ON ENREGISTRE AVANT DE PRÉVENIR : le responsable ouvrira la
                  // commande TELLE QU'ELLE EST EN BASE.
                  onClick={async () => {
                    const enregistre = await handleSave()

                    if (enregistre) requestValidationMutation.mutate(savedOrderId)
                  }}
                >
                  {t('poEditor.requestValidation', 'Demande de validation')}
                </Button>
              </Tooltip>
            )}
          {/* « Confirmer » est le geste de validation : il n'a de sens que chez
              qui en a le droit — sinon c'est un 403 au clic. */}
          {savedOrderId &&
            peutValider &&
            (orderData?.status === 'draft' || orderData?.status === 'pending_validation') && (
              <Button
                icon={<CheckOutlined />}
                onClick={() => confirmMutation.mutate(savedOrderId)}
                loading={confirmMutation.isPending}
              >
                {t('common.confirm')}
              </Button>
            )}
          {savedOrderId && (orderData?.status === 'confirmed' || orderData?.status === 'partial') && (
            <Button
              type="primary"
              icon={<InboxOutlined />}
              onClick={handleOpenReceiveModal}
              loading={receiveMutation.isPending}
            >
              {t('poEditor.receive')}
            </Button>
          )}
          {savedOrderId && (orderData?.status === 'partial' || orderData?.status === 'received') && (
            <Button
              icon={<FileDoneOutlined />}
              onClick={handleOpenInvoiceModal}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('poEditor.convertToInvoice')}
            </Button>
          )}
          {savedOrderId && orderData?.status === 'confirmed' && (
            <Button
              danger
              icon={<CloseOutlined />}
              onClick={() => cancelMutation.mutate(savedOrderId)}
              loading={cancelMutation.isPending}
            >
              {t('poEditor.cancelOrder')}
            </Button>
          )}
          {savedOrderId && (
            <>
              <Button icon={<FileSearchOutlined />} onClick={handlePreviewPdf}>
                {t('poEditor.viewPdf')}
              </Button>
              <Button icon={<FilePdfOutlined />} onClick={handleDownloadPdf}>
                {t('poEditor.downloadPdf')}
              </Button>
            </>
          )}
          {/* ⚠️ « ENREGISTRER » NE RESTE PAS SUR UNE COMMANDE QU'ON NE PEUT PLUS
              ÉCRIRE. Il était simplement grisé : à côté de dix-huit champs
              éteints, un bouton d'enregistrement éteint laisse croire à une
              panne, ou qu'il manque un droit. Il n'y a rien à enregistrer — on
              retire le bouton, et l'étiquette dit pourquoi. */}
          {canModify && (
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
        <Form form={form} layout="vertical">
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item
                label={t('poEditor.supplier')}
                required
                validateStatus={!selectedSupplier && form.isFieldTouched('supplier_id') ? 'error' : ''}
                help={!selectedSupplier && form.isFieldTouched('supplier_id') ? t('poEditor.selectSupplier') : ''}
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder={isLoadingSuppliers ? t('common.loading') : t('poEditor.selectSupplier')}
                    optionFilterProp="label"
                    loading={isLoadingSuppliers}
                    value={selectedSupplier?.id}
                    onChange={handleSupplierChange}
                    options={(() => {
                      const options: Array<{ value: string; label: string }> = (
                        suppliersData?.data || []
                      ).map((s: Supplier) => ({
                        value: s.id,
                        label: `${s.code} - ${s.name}`,
                      }))
                      // Ant Design n'affiche que ce qu'il trouve dans les
                      // options : un fournisseur absent de la liste laisserait
                      // la case vide alors qu'il est bien sur la commande.
                      if (selectedSupplier && !options.some((o) => o.value === selectedSupplier.id)) {
                        options.unshift({
                          value: selectedSupplier.id,
                          label: `${selectedSupplier.code} - ${selectedSupplier.name}`,
                        })
                      }
                      return options
                    })()}
                    style={{ flex: 1 }}
                    disabled={!canModify}
                  />
                  <Tooltip title={t('poEditor.openSupplierSheet')}>
                    <Button
                      icon={<SearchOutlined />}
                      onClick={handleOpenSupplier}
                      disabled={!selectedSupplier}
                    />
                  </Tooltip>
                </Space.Compact>
              </Form.Item>
              {/* ⚠️ UN REFUS SE DIT DANS LA LANGUE DE L'ÉCRAN. Sans message
                  explicite, Ant Design compose le sien à partir du NOM DU CHAMP :
                  « Le champ supplier_id est obligatoire », un nom technique servi
                  à l'utilisateur là où l'étiquette dit « Fournisseur ». */}
              <Form.Item
                name="supplier_id"
                hidden
                rules={[{ required: true, message: t('poEditor.supplierRequired', 'Le fournisseur est obligatoire') }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label={t('poEditor.supplierAddress')}>
                <Input.TextArea
                  value={selectedSupplier ? [
                    selectedSupplier.name,
                    selectedSupplier.address_line1,
                    selectedSupplier.address_line2,
                    [selectedSupplier.postal_code, selectedSupplier.city].filter(Boolean).join(' '),
                    selectedSupplier.country
                  ].filter(Boolean).join('\n') : ''}
                  disabled
                  rows={5}
                  style={{ backgroundColor: token.colorFillTertiary }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="delivery_address" label={t('poEditor.deliveryAddress')}>
                <Input.TextArea
                  rows={5}
                  placeholder={t('poEditor.deliveryAddressPlaceholder')}
                  disabled={!canModify}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Row gutter={8}>
                <Col span={8}>
                  <Form.Item
                    name="date"
                    label={t('common.date')}
                    rules={[{ required: true, message: t('poEditor.dateRequired') }]}
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      format="DD/MM/YYYY"
                      disabled={!canModify}
                      onChange={(date) => {
                        // Recalculate due_date when date changes
                        if (date && selectedPaymentTermId) {
                          const term = paymentTermsData?.payment_terms?.find((pt: PaymentTerm) => pt.id === selectedPaymentTermId)
                          if (term) {
                            form.setFieldValue('due_date', date.add(term.days, 'day'))
                          }
                        }
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="due_date"
                    label={t('poEditor.dueDate')}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={!canModify} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item
                    name="expected_date"
                    label={t('poEditor.expectedDelivery')}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={!canModify} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t('poEditor.paymentTerm')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('poEditor.selectPaymentTerm')}
                  disabled={!canModify}
                  value={selectedPaymentTermId}
                  onChange={(value) => {
                    setSelectedPaymentTermId(value)
                    if (value) {
                      const term = paymentTermsData?.payment_terms?.find((pt: PaymentTerm) => pt.id === value)
                      if (term) {
                        // Store payment terms label for PDF
                        form.setFieldValue('payment_terms', term.label)
                        // Calculate due date = date + days
                        const orderDate = form.getFieldValue('date')
                        if (orderDate) {
                          form.setFieldValue('due_date', dayjs(orderDate).add(term.days, 'day'))
                        }
                      }
                    } else {
                      form.setFieldValue('payment_terms', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {paymentTermsData?.payment_terms?.map((term: PaymentTerm) => (
                    <Select.Option key={term.id} value={term.id}>
                      {term.label} ({term.days === 0 ? t('poEditor.cash') : t('poEditor.daysShort', { days: term.days })})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={24}>
            <Col span={18}>
              <Form.Item
                name="subject"
                label={t('poEditor.subject')}
                rules={[{ required: true, message: t('poEditor.subjectRequired') }]}
              >
                <Input placeholder={t('poEditor.subjectPlaceholder')} disabled={!canModify} />
              </Form.Item>
            </Col>
            <Col span={6}>
              {/* La référence de la commande chez le fournisseur : le serveur la
                  portait déjà (« reference »), l'éditeur n'avait pas de champ où
                  l'inscrire — un acheteur n'avait donc aucun moyen de rappeler au
                  fournisseur le repère qu'il lui avait donné. */}
              <Form.Item name="reference" label={t('poEditor.reference', 'Référence')}>
                <Input placeholder={t('poEditor.referencePlaceholder', 'Votre référence chez le fournisseur')} disabled={!canModify} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{t('poEditor.orderLines')}</span>
          <Space size="middle">
            {selectedRowKeys.length > 0 && (
              <>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelection}
                  danger
                  disabled={!canModify}
                >
                  {t('poEditor.deleteCount', { count: selectedRowKeys.length })}
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleDuplicateSelection}
                  disabled={!canModify}
                >
                  {t('poEditor.duplicateCount', { count: selectedRowKeys.length })}
                </Button>
              </>
            )}
            <Button
              icon={<PlusOutlined />}
              onClick={() => handleAddLine('article')}
              disabled={!canModify}
              style={{ backgroundColor: '#1677ff', borderColor: '#1677ff', color: '#fff' }}
            >
              {t('poEditor.lineArticle')}
            </Button>
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleAddLine('text')}
              disabled={!canModify}
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
            >
              {t('poEditor.lineText')}
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => handleAddLine('subtotal')}
              disabled={!canModify}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('poEditor.subtotal')}
            </Button>
            <Button
              icon={<MinusOutlined />}
              onClick={() => handleAddLine('page_break')}
              disabled={!canModify}
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
            >
              {t('poEditor.pageBreak')}
            </Button>
          </Space>
        </div>

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
              columns={columns}
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
                header: {
                  cell: ResizableHeaderCell,
                },
                body: {
                  row: SortableRow,
                },
              }}
            />
          </SortableContext>
        </DndContext>

        <div style={{ marginTop: 24 }} />

        <Form form={form}>
          <Form.Item name="notes" label={t('poEditor.notes')}>
            <Input.TextArea rows={3} placeholder={t('poEditor.notesPlaceholder')} disabled={!canModify} />
          </Form.Item>
        </Form>

        {/* Footer / Pied de page */}
        <Row gutter={24} style={{ marginTop: 16, marginBottom: 16 }}>
          <Col span={6}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('poEditor.footerTemplate')}</div>
            <Select
              allowClear
              placeholder={t('poEditor.selectTemplate')}
              style={{ width: '100%' }}
              disabled={!canModify}
              onChange={(value) => {
                if (value) {
                  const footers = Array.isArray(footersData) ? footersData : (footersData?.data || [])
                  const footer = footers.find((f: { id: string }) => f.id === value)
                  if (footer) {
                    setFooterContent(footer.content)
                    setTabDirty(tabId, true)
                  }
                }
              }}
              options={(Array.isArray(footersData) ? footersData : (footersData?.data || [])).map((f: { id: string; name: string }) => ({
                value: f.id,
                label: f.name,
              }))}
            />
          </Col>
          <Col span={18}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('poEditor.footer')}</div>
            <Input.TextArea
              rows={3}
              value={footerContent}
              onChange={(e) => {
                setFooterContent(e.target.value)
                setTabDirty(tabId, true)
              }}
              placeholder={t('poEditor.footerPlaceholder')}
              disabled={!canModify}
            />
          </Col>
        </Row>

        {/* Factures liées et Documents liés */}
        {savedOrderId && (
          <Tabs
            defaultActiveKey="invoices"
            items={[
              {
                key: 'invoices',
                label: t('poEditor.linkedInvoices', { count: linkedInvoicesData?.data?.length || 0 }),
                children: (
                  <Table<LinkedInvoice>
                    dataSource={linkedInvoicesData?.data || []}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    locale={{ emptyText: t('poEditor.noLinkedInvoices') }}
                    onRow={(record: LinkedInvoice) => ({
                      onClick: () => openDocumentTab('supplier-invoice', record.id, t('poEditor.invoiceTabTitle', { number: record.number })),
                      style: { cursor: 'pointer' },
                    })}
                    columns={[
                      {
                        title: t('poEditor.internalNumber'),
                        dataIndex: 'number',
                        key: 'number',
                        width: 120,
                        render: (number: string) => <a>{number}</a>,
                      },
                      {
                        title: t('poEditor.supplierNumber'),
                        dataIndex: 'supplier_invoice_number',
                        key: 'supplier_invoice_number',
                        width: 140,
                      },
                      {
                        title: t('common.date'),
                        dataIndex: 'date',
                        key: 'date',
                        width: 100,
                        render: (date: string) => dayjs(date).format('DD/MM/YYYY'),
                      },
                      {
                        title: t('common.status'),
                        dataIndex: 'status',
                        key: 'status',
                        width: 100,
                        render: (status: string) => {
                          const invoiceStatusConfig: Record<string, { color: string; label: string }> = {
                            draft: { color: 'default', label: t('poEditor.statusDraft') },
                            // Deux états manquaient à l'appel et sortaient donc
                            // bruts, en anglais : celui d'un brouillon dont la
                            // validation est demandée, et « validated », que
                            // « /invoices » emploie encore là où les achats
                            // disent « sent ». Un statut rendu brut à l'écran est
                            // le défaut le plus commun de ce produit.
                            pending_validation: { color: 'orange', label: t('poEditor.statusPendingValidation', 'Attente validation') },
                            validated: { color: 'blue', label: t('poEditor.statusReceived') },
                            sent: { color: 'blue', label: t('poEditor.statusReceived') },
                            partial: { color: 'orange', label: t('poEditor.statusPartial') },
                            paid: { color: 'green', label: t('poEditor.statusPaid') },
                            cancelled: { color: 'red', label: t('poEditor.statusCancelled') },
                          }
                          const config = invoiceStatusConfig[status] || { color: 'default', label: status }
                          return <Tag color={config.color}>{config.label}</Tag>
                        },
                      },
                      {
                        title: t('poEditor.colTotalHT'),
                        dataIndex: 'total_ht',
                        key: 'total_ht',
                        width: 100,
                        align: 'right' as const,
                        render: (amount: number) => `${amount.toFixed(2)} €`,
                      },
                      {
                        title: t('poEditor.totalTTC'),
                        dataIndex: 'total_ttc',
                        key: 'total_ttc',
                        width: 100,
                        align: 'right' as const,
                        render: (amount: number) => <strong>{amount.toFixed(2)} €</strong>,
                      },
                    ]}
                    summary={() => {
                      const invoices = linkedInvoicesData?.data || []
                      if (invoices.length === 0) return null
                      const totalHT = invoices.reduce((sum: number, inv: LinkedInvoice) => sum + (inv.total_ht || 0), 0)
                      const totalTTC = invoices.reduce((sum: number, inv: LinkedInvoice) => sum + (inv.total_ttc || 0), 0)
                      return (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={4}>
                            <strong>{t('poEditor.totalInvoicesSummary', { count: invoices.length })}</strong>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right">
                            <strong>{totalHT.toFixed(2)} €</strong>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="right">
                            <strong style={{ color: '#1890ff' }}>{totalTTC.toFixed(2)} €</strong>
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      )
                    }}
                  />
                ),
              },
              {
                key: 'documents',
                label: t('poEditor.linkedDocuments'),
                children: <DocumentsSection entityType="purchase_order" entityId={savedOrderId} title="" />,
              },
              {
                key: 'suivi',
                label: t('poEditor.tabs.timeline', 'Suivi'),
                children: <SuiviDocument route="purchase-orders" documentId={savedOrderId} />,
              },
            ]}
          />
        )}
        </div>

        {/* Footer with Totals */}
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
          {/* Total HT (avant remise globale) */}
          <Card
            size="small"
            style={{
              background: '#e6f7ff',
              borderColor: '#91d5ff',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('poEditor.colTotalHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
              {totals.totalHTBeforeDiscount.toFixed(2)} €
            </div>
          </Card>

          {/* Remise globale */}
          <Card
            size="small"
            style={{
              background: '#f9f0ff',
              borderColor: '#d3adf7',
              minWidth: 180,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('poEditor.globalDiscount')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <InputNumber
                value={globalDiscountValue}
                onChange={(value) => {
                  setGlobalDiscountValue(value || 0)
                  setTabDirty(tabId, true)
                }}
                min={0}
                max={globalDiscountType === 'percent' ? 100 : undefined}
                precision={2}
                style={{ width: 80 }}
                size="small"
                disabled={!canModify}
              />
              <Select
                value={globalDiscountType}
                onChange={(value) => {
                  setGlobalDiscountType(value)
                  setGlobalDiscountValue(0)
                  setTabDirty(tabId, true)
                }}
                style={{ width: 60 }}
                size="small"
                options={[
                  { value: 'percent', label: '%' },
                  { value: 'amount', label: '€' },
                ]}
                disabled={!canModify}
              />
            </div>
            {totals.globalDiscount > 0 && (
              <div style={{ fontSize: 12, color: '#722ed1', marginTop: 4 }}>
                -{totals.globalDiscount.toFixed(2)} €
              </div>
            )}
          </Card>

          {/* Net HT (après remise) */}
          <Card
            size="small"
            style={{
              background: '#e6fffb',
              borderColor: '#87e8de',
              minWidth: 140,
            }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('poEditor.netHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#13c2c2' }}>
              {totals.totalHT.toFixed(2)} €
            </div>
          </Card>

          {/* TVA */}
          <Card
            size="small"
            style={{ minWidth: 160 }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{t('poEditor.globalVat')}</span>
              <Select
                value={(() => {
                  const articleLines = lines.filter(l => l.line_type === 'article')
                  if (articleLines.length === 0) return undefined
                  const firstRate = articleLines[0].vat_rate
                  const allSameRate = articleLines.every(l => l.vat_rate === firstRate)
                  return allSameRate ? firstRate : undefined
                })()}
                onChange={(value) => {
                  setLines((prev) =>
                    prev.map((line) =>
                      line.line_type === 'article' ? { ...line, vat_rate: value } : line
                    )
                  )
                  setTabDirty(tabId, true)
                }}
                style={{ width: 75 }}
                size="small"
                disabled={!canModify || !lines.some(l => l.line_type === 'article')}
                placeholder=""
                options={
                  inputVatRates.length > 0
                    ? inputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
                    : [
                        // ⚠️ Voir la note plus haut : aucun taux codé en dur, le
                        // serveur refuse ce qui n'est pas au paramétrage.
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
              {t('poEditor.totalTTC')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
              {totals.totalTTC.toFixed(2)} €
            </div>
          </Card>
        </div>
      </div>
      </div>

      {/* Modal création facture */}
      <Modal
        title={t('poEditor.createInvoiceTitle')}
        open={isInvoiceModalOpen}
        onCancel={() => setIsInvoiceModalOpen(false)}
        onOk={handleCreateInvoice}
        okText={t('poEditor.createInvoiceBtn')}
        cancelText={t('common.cancel')}
        confirmLoading={createInvoiceMutation.isPending}
        width={700}
      >
        <Form form={invoiceForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="invoice_date"
                label={t('poEditor.invoiceDate')}
                rules={[{ required: true, message: t('poEditor.dateRequired') }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="due_date" label={t('poEditor.dueDateFull')}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="reference"
            label={t('poEditor.supplierInvoiceNumber')}
            rules={[{ required: true, message: t('poEditor.supplierInvoiceNumberRequired') }]}
          >
            <Input placeholder={t('poEditor.supplierInvoiceNumberPlaceholder')} />
          </Form.Item>
          <Form.Item name="notes" label={t('poEditor.notes')}>
            <Input.TextArea rows={2} placeholder={t('poEditor.optionalNotes')} />
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>{t('poEditor.linesToInvoice')}</div>
          <Table
            dataSource={invoiceLines}
            rowKey="line_id"
            pagination={false}
            size="small"
            columns={[
              {
                title: '',
                dataIndex: 'selected',
                key: 'selected',
                width: 50,
                render: (selected: boolean, _record, index: number) => (
                  <Checkbox
                    checked={selected}
                    onChange={(e) => {
                      const newLines = [...invoiceLines]
                      newLines[index].selected = e.target.checked
                      setInvoiceLines(newLines)
                    }}
                  />
                ),
              },
              {
                title: t('common.description'),
                dataIndex: 'description',
                key: 'description',
              },
              {
                title: t('poEditor.receivedQty'),
                dataIndex: 'max_quantity',
                key: 'max_quantity',
                width: 100,
                render: (qty: number) => qty.toFixed(2),
              },
              {
                title: t('poEditor.qtyToInvoice'),
                dataIndex: 'quantity',
                key: 'quantity',
                width: 120,
                render: (qty: number, record, index: number) => (
                  <InputNumber
                    value={qty}
                    onChange={(value) => {
                      const newLines = [...invoiceLines]
                      newLines[index].quantity = Math.min(value || 0, record.max_quantity)
                      setInvoiceLines(newLines)
                    }}
                    min={0}
                    max={record.max_quantity}
                    precision={2}
                    style={{ width: '100%' }}
                    disabled={!record.selected}
                  />
                ),
              },
            ]}
          />
        </div>
      </Modal>

      {/* Modal réception */}
      <Modal
        title={t('poEditor.receptionTitle')}
        open={isReceiveModalOpen}
        onCancel={() => setIsReceiveModalOpen(false)}
        onOk={handleReceive}
        okText={t('poEditor.validateReception')}
        cancelText={t('common.cancel')}
        confirmLoading={receiveMutation.isPending}
        width={700}
      >
        <Form form={receiveForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="date"
                label={t('poEditor.receptionDate')}
                rules={[{ required: true, message: t('poEditor.dateRequired') }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="notes" label={t('poEditor.notes')}>
                <Input placeholder={t('poEditor.optionalNotes')} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>{t('poEditor.linesToReceive')}</div>
          <Table
            dataSource={receiveLines}
            rowKey="line_id"
            pagination={false}
            size="small"
            columns={[
              {
                title: '',
                dataIndex: 'selected',
                key: 'selected',
                width: 50,
                render: (selected: boolean, _record, index: number) => (
                  <Checkbox
                    checked={selected}
                    onChange={(e) => {
                      const newLines = [...receiveLines]
                      newLines[index].selected = e.target.checked
                      setReceiveLines(newLines)
                    }}
                  />
                ),
              },
              {
                title: t('common.description'),
                dataIndex: 'description',
                key: 'description',
              },
              {
                title: t('poEditor.alreadyReceived'),
                dataIndex: 'already_received',
                key: 'already_received',
                width: 100,
                render: (qty: number) => <span style={{ color: '#52c41a' }}>{qty.toFixed(2)}</span>,
              },
              {
                title: t('poEditor.remaining'),
                dataIndex: 'max_quantity',
                key: 'max_quantity',
                width: 100,
                render: (qty: number) => qty.toFixed(2),
              },
              {
                title: t('poEditor.qtyToReceive'),
                dataIndex: 'quantity',
                key: 'quantity',
                width: 120,
                render: (qty: number, record, index: number) => (
                  <InputNumber
                    value={qty}
                    onChange={(value) => {
                      const newLines = [...receiveLines]
                      newLines[index].quantity = Math.min(value || 0, record.max_quantity)
                      setReceiveLines(newLines)
                    }}
                    min={0}
                    max={record.max_quantity}
                    precision={2}
                    style={{ width: '100%' }}
                    disabled={!record.selected}
                  />
                ),
              },
            ]}
          />
        </div>
      </Modal>

      {/* Modal modification de prix */}
      <Modal
        title={t('poEditor.priceModalTitle')}
        open={priceModalOpen}
        onCancel={() => handlePriceModalConfirm('cancel')}
        footer={[
          <Button key="cancel" onClick={() => handlePriceModalConfirm('cancel')}>
            {t('common.cancel')}
          </Button>,
          <Button key="document" type="primary" onClick={() => handlePriceModalConfirm('document')}>
            {t('poEditor.priceModalDocumentOnly')}
          </Button>,
          <Button
            key="article"
            type="primary"
            style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
            onClick={() => handlePriceModalConfirm('article')}
            loading={updateArticleMutation.isPending}
          >
            {t('poEditor.priceModalUpdateArticle')}
          </Button>,
        ]}
        width={500}
      >
        {priceModalData && (
          <div>
            <p>
              {t('poEditor.priceModalIntro')} <strong>{priceModalData.articleName}</strong>.
            </p>
            <p>
              {t('poEditor.priceModalCurrentPrice')} <strong>{priceModalData.oldPrice.toFixed(2)} €</strong>
            </p>
            <p>
              {t('poEditor.priceModalNewPrice')} <strong>{priceModalData.newPrice.toFixed(2)} €</strong>
            </p>
            <p style={{ marginTop: 16 }}>{t('poEditor.priceModalQuestion')}</p>
          </div>
        )}
      </Modal>

      {/* PDF Preview Modal */}
      <Modal
        title={t('poEditor.pdfPreviewTitle', { number: orderData?.number || '' })}
        open={pdfPreviewOpen}
        onCancel={closePdfPreview}
        width={900}
        footer={[
          <Button key="close" onClick={closePdfPreview}>
            {t('common.close')}
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleDownloadPdf}
          >
            {t('poEditor.download')}
          </Button>,
        ]}
      >
        {pdfPreviewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p>{t('poEditor.loadingPdf')}</p>
          </div>
        ) : pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            style={{ width: '100%', height: '70vh', border: 'none' }}
            title={t('poEditor.orderTitle', { number: orderData?.number })}
          />
        ) : null}
      </Modal>
    </div>
  )
}
