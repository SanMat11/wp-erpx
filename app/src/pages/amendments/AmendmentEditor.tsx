import { useEffect, useState, useMemo, useRef } from 'react'
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
  Modal,
  Dropdown,
  Tag,
  Tooltip,
  Tabs,
  theme,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  SearchOutlined,
  DownOutlined,
  AlignLeftOutlined,
  CalculatorOutlined,
  MinusOutlined,
  HolderOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  EuroOutlined,
  FileTextOutlined,
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
import { useTranslation } from 'react-i18next'

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

import { amendmentAPI, clientAPI, articleAPI, settingsAPI, dealAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import DocumentsSection from '@/components/DocumentsSection'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import { useColumnWidths } from '@/hooks/useColumnWidths'
import dayjs from 'dayjs'

interface Client {
  id: string
  code: string
  name: string
  address_line1?: string
  address_line2?: string
  postal_code?: string
  city?: string
  country?: string
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

interface Deal {
  id: string
  number: string
  name: string
  client_id?: string
  client?: Client
}

type LineType = 'article' | 'text' | 'page_break' | 'subtotal'

interface AmendmentLine {
  key: string
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

interface Amendment {
  id: string
  number: string
  deal_id: string
  client_id: string
  client?: { id: string; name: string; address?: string }
  deal?: Deal
  date: string
  validity_date?: string
  status: string
  subject?: string
  notes?: string
  delivery_address?: string
  discount_percent?: number
  discount_amount?: number
  footer_content?: string
  payment_terms?: string
  lines?: Array<{
    line_type?: string
    article_id: string
    description: string
    quantity: number
    unit_price: number
    discount: number
    vat_rate: number
  }>
  total_ht: number
  total_tva: number
  total_ttc: number
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

interface AmendmentEditorProps {
  tabId: string
  documentId?: string
  dealId?: string
}

export default function AmendmentEditor({ tabId, documentId, dealId }: AmendmentEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { updateTabTitle, setTabDirty, openDocumentTab, getTabMetadata } = useDocumentTabsStore()
  const { primaryColor } = useThemeStore()
  const { sidebarWidth } = useSidebarStore()
  const { token } = theme.useToken()
  const [form] = Form.useForm()
  const [lines, setLines] = useState<AmendmentLine[]>([])
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 900, height: 80 })
  const [savedAmendmentId, setSavedAmendmentId] = useState<string | null>(null)
  const [globalDiscountType, setGlobalDiscountType] = useState<'percent' | 'amount'>('percent')
  const [globalDiscountValue, setGlobalDiscountValue] = useState<number>(0)

  // State for deposit invoice modal
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [depositPercent, setDepositPercent] = useState(30)
  const [depositLoading, setDepositLoading] = useState(false)
  const [invoicingInfo, setInvoicingInfo] = useState<{
    deposit_percent: number
    available_percent: number
    deposit_invoiced_ht: number
    can_create_deposit: boolean
    can_create_final: boolean
    deposit_invoices: Array<{
      id: string
      number: string
      type: string
      date: string
      status: string
      total_ht: number
      total_ttc: number
    }>
  } | null>(null)
  const [invoicingInfoLoading, setInvoicingInfoLoading] = useState(false)

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

  // Get metadata from tab (deal_id passed when creating from DealEditor)
  const metadata = getTabMetadata(tabId)
  const effectiveDealId = dealId || (metadata?.deal_id as string) || undefined

  // ID effectif de l'avenant (props ou après création)
  const currentAmendmentId = documentId || savedAmendmentId

  // Ref to track if lines have been initialized (to avoid re-loading on article cache invalidation)
  const linesInitializedRef = useRef(false)

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Column widths for resizable columns (persisted in localStorage)
  const { columnWidths, handleResize: handleColumnResize } = useColumnWidths()

  // Fetch clients
  const { data: clientsData, isLoading: isLoadingClients } = useQuery({
    queryKey: ['clients-for-editor'],
    queryFn: async () => {
      const response = await clientAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Fetch articles
  const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
    queryKey: ['articles-for-editor'],
    queryFn: async () => {
      const response = await articleAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Fetch VAT rates (output direction for amendments)
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

  // State for selected footer ID
  const [selectedFooterId, setSelectedFooterId] = useState<string | null>(null)

  // Filter VAT rates for output direction (client amendments)
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

  // Fetch deal if dealId is provided
  const { data: dealData } = useQuery({
    queryKey: ['deal', effectiveDealId],
    queryFn: async () => {
      if (!effectiveDealId) return null
      const response = await dealAPI.get(effectiveDealId)
      return response.data as Deal
    },
    enabled: !!effectiveDealId,
  })

  // Initialize deal when data is loaded
  useEffect(() => {
    if (dealData && !selectedDeal) {
      setSelectedDeal(dealData)
      // Also set client if deal has one
      if (dealData.client) {
        setSelectedClient(dealData.client)
        form.setFieldsValue({ client_id: dealData.client.id })
      }
    }
  }, [dealData, selectedDeal, form])

  // Apply default payment term for new documents
  useEffect(() => {
    if (!documentId && paymentTermsData?.payment_terms) {
      const defaultTerm = paymentTermsData.payment_terms.find((t: PaymentTerm) => t.is_default)
      if (defaultTerm && !selectedPaymentTermId) {
        setSelectedPaymentTermId(defaultTerm.id)
        form.setFieldValue('payment_terms', defaultTerm.label)
        // Calculate validity date based on default payment term
        const currentDate = form.getFieldValue('date') || dayjs()
        form.setFieldValue('validity_date', dayjs(currentDate).add(defaultTerm.days, 'day'))
      }
    }
  }, [documentId, paymentTermsData, selectedPaymentTermId, form])

  // Fetch existing amendment if editing (or after creation)
  const { data: amendmentData } = useQuery({
    queryKey: ['amendment', currentAmendmentId],
    queryFn: async () => {
      if (!currentAmendmentId) return null
      const response = await amendmentAPI.get(currentAmendmentId)
      return response.data as Amendment
    },
    enabled: !!currentAmendmentId,
  })

  // Fetch footers for amendments
  const { data: footersData } = useQuery({
    queryKey: ['footers', 'amendment'],
    queryFn: async () => {
      const response = await settingsAPI.listFootersByDocumentType('amendment')
      return response
    },
  })

  // ⚠️ La route rend un TABLEAU NU, pas un objet { footers: [...] }. Lu sous
  // cette dernière forme, le pied de page choisi ne se retrouvait jamais à la
  // réouverture : le sélecteur restait vide alors que le contenu était bien là.
  // Une seule lecture ici, plutôt que la même gymnastique à trois endroits.
  const footers = useMemo(
    () =>
      (Array.isArray(footersData) ? footersData : (footersData?.data ?? [])) as Array<{
        id: string
        name: string
        content: string
      }>,
    [footersData]
  )

  // Load amendment data when editing
  useEffect(() => {
    if (amendmentData) {
      // Only initialize lines once to avoid overwriting user changes when articles are re-fetched
      if (linesInitializedRef.current) {
        return
      }

      form.setFieldsValue({
        client_id: amendmentData.client_id,
        date: amendmentData.date ? dayjs(amendmentData.date) : dayjs(),
        validity_date: amendmentData.validity_date ? dayjs(amendmentData.validity_date) : dayjs().add(30, 'day'),
        subject: amendmentData.subject,
        notes: amendmentData.notes,
        delivery_address: amendmentData.delivery_address,
        footer_content: amendmentData.footer_content || '',
        payment_terms: amendmentData.payment_terms || '',
      })

      // Restore selected payment term
      if (amendmentData.payment_terms && paymentTermsData?.payment_terms) {
        const term = paymentTermsData.payment_terms.find((t: PaymentTerm) => t.label === amendmentData.payment_terms)
        if (term) {
          setSelectedPaymentTermId(term.id)
        }
      }

      // Set selected client
      if (amendmentData.client_id && clientsData?.data) {
        const client = clientsData.data.find((c: Client) => c.id === amendmentData.client_id)
        if (client) setSelectedClient(client)
      }

      // Set selected deal
      if (amendmentData.deal) {
        setSelectedDeal(amendmentData.deal)
      }

      // Convert amendment lines to our format
      const convertedLines: AmendmentLine[] = (amendmentData.lines || []).map((line, idx) => {
        const lineType = (line.line_type || 'article') as LineType
        const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
        const purchasePrice = article?.purchase_price || 0
        const coefficient = purchasePrice > 0 ? line.unit_price / purchasePrice : 1
        return {
          key: `line-${idx}`,
          line_type: lineType,
          article_id: line.article_id,
          description: line.description,
          quantity: line.quantity,
          unit: article?.unit || '',
          purchase_price: purchasePrice,
          coefficient: Math.round(coefficient * 100) / 100,
          unit_price: line.unit_price,
          discount_percent: line.discount || 0,
          vat_rate: line.vat_rate ?? defaultVatRate,
        }
      })

      setLines(convertedLines.length > 0 ? convertedLines : [createEmptyLine()])
      linesInitializedRef.current = true
      updateTabTitle(tabId, t('amendmentEditor.tabTitle', { number: amendmentData.number }))

      // Load global discount
      if (amendmentData.discount_percent && amendmentData.discount_percent > 0) {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(amendmentData.discount_percent)
      } else if (amendmentData.discount_amount && amendmentData.discount_amount > 0) {
        setGlobalDiscountType('amount')
        setGlobalDiscountValue(amendmentData.discount_amount)
      } else {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(0)
      }

      // Load selected footer by matching content
      if (amendmentData.footer_content && footers.length > 0) {
        const matchingFooter = footers.find(
          (f: { id: string; content: string }) => f.content === amendmentData.footer_content
        )
        if (matchingFooter) {
          setSelectedFooterId(matchingFooter.id)
        }
      }
    } else if (!documentId) {
      // New amendment
      if (!linesInitializedRef.current) {
        form.setFieldsValue({
          date: dayjs(),
          validity_date: dayjs().add(30, 'day'),
        })
        setLines([createEmptyLine()])
        linesInitializedRef.current = true
      }
    }
  }, [amendmentData, articlesData, clientsData, paymentTermsData, footers, documentId, form, tabId, updateTabTitle])

  // ⚠️ LE NUMÉRO ARRIVE APRÈS, À LA VALIDATION — L'ONGLET DOIT SUIVRE.
  //
  // Le titre n'était posé que dans l'effet de chargement ci-dessus, lequel sort
  // aussitôt une fois les lignes initialisées. Un avenant passé de « Brouillon »
  // à « Envoyé » recevait bien son AVN-2026-XXXX, mais l'onglet restait intitulé
  // « Avenant Brouillon » pour le reste de la session. Un effet à part, qui ne
  // dépend que du numéro, le remet à jour à chaque fois qu'il change.
  useEffect(() => {
    if (amendmentData?.number) {
      updateTabTitle(tabId, t('amendmentEditor.tabTitle', { number: amendmentData.number }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amendmentData?.number, tabId])

  // Handle client selection
  const handleClientChange = (clientId: string) => {
    const client = clientsData?.data?.find((c: Client) => c.id === clientId)
    setSelectedClient(client || null)
    form.setFieldsValue({ client_id: clientId })
    // Auto-fill delivery address with client address if empty
    if (client && !form.getFieldValue('delivery_address')) {
      const fullAddress = [
        client.address_line1,
        client.address_line2,
        [client.postal_code, client.city].filter(Boolean).join(' '),
        client.country
      ].filter(Boolean).join('\n')
      form.setFieldsValue({ delivery_address: fullAddress })
    }
    setTabDirty(tabId, true)
  }

  const createEmptyLine = (lineType: LineType = 'article'): AmendmentLine => ({
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
    vat_rate: defaultVatRate,
  })

  // Mutations
  // Helper to invalidate all amendment-related queries
  const invalidateAmendmentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['amendments'], refetchType: 'all' })

    // ⚠️ LA CLÉ DE L'ONGLET « AVENANTS CLIENTS » EST « amendments-deal ».
    //
    // On invalidait ['amendments','deal',…], une clé que PERSONNE n'emploie :
    // l'affaire, elle, interroge ['amendments-deal', id] (DealEditor). Les deux
    // ne se rencontraient jamais, et comme la fraîcheur globale est d'une
    // minute, l'onglet restait « Avenants clients (0) » et « Aucun avenant
    // client lié » même après fermeture et réouverture de l'affaire.
    queryClient.invalidateQueries({ queryKey: ['amendments-deal'], refetchType: 'all' })

    // L'affaire elle-même porte le rapprochement (montant attendu, avenants,
    // reste à facturer) : il bouge dès qu'un avenant bouge.
    const dealId = effectiveDealId || amendmentData?.deal_id
    if (dealId) {
      queryClient.invalidateQueries({ queryKey: ['deal', dealId], refetchType: 'all' })
    }
    queryClient.invalidateQueries({ queryKey: ['deals'] })
  }

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => amendmentAPI.create(data),
    onSuccess: (response) => {
      message.success(t('amendmentEditor.messages.created'))
      invalidateAmendmentQueries()
      const newAmendment = response.data as Amendment
      updateTabTitle(tabId, t('amendmentEditor.tabTitle', { number: newAmendment.number }))
      setTabDirty(tabId, false)
      setSavedAmendmentId(newAmendment.id)
      // Invalidate to refetch with the new ID (for status display)
      queryClient.invalidateQueries({ queryKey: ['amendment', newAmendment.id] })
    },
    // ⚠️ Le motif vient du serveur — « ce document est validé », par exemple.
    // L'avaler pour afficher une erreur générique laissait chercher au hasard.
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('amendmentEditor.messages.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      amendmentAPI.update(id, data),
    onSuccess: () => {
      message.success(t('amendmentEditor.messages.updated'))
      invalidateAmendmentQueries()
      if (currentAmendmentId) {
        queryClient.invalidateQueries({ queryKey: ['amendment', currentAmendmentId] })
      }
      setTabDirty(tabId, false)
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('amendmentEditor.messages.updateError'))
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      amendmentAPI.updateStatus(id, status),
    onSuccess: () => {
      message.success(t('amendmentEditor.messages.statusUpdated'))
      invalidateAmendmentQueries()
      queryClient.invalidateQueries({ queryKey: ['amendment', currentAmendmentId] })
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('amendmentEditor.messages.statusUpdateError'))
    },
  })

  // Mutation to update article purchase price
  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      articleAPI.update(id, data),
    onSuccess: () => {
      message.success(t('amendmentEditor.messages.articlePriceUpdated'))
      queryClient.invalidateQueries({ queryKey: ['articles-for-editor'] })
    },
    onError: () => {
      message.error(t('amendmentEditor.messages.articleUpdateError'))
    },
  })

  // Status configuration
  const statusConfig: Record<string, { color: string; label: string }> = {
    draft: { color: 'default', label: t('amendmentEditor.status.draft') },
    sent: { color: 'blue', label: t('amendmentEditor.status.sent') },
    accepted: { color: 'green', label: t('amendmentEditor.status.accepted') },
    refused: { color: 'red', label: t('amendmentEditor.status.refused') },
    // L'avenant facturé existait côté serveur (post_status amsbm-done) mais pas
    // ici : son étiquette s'affichait en anglais et sans couleur.
    invoiced: { color: 'purple', label: t('amendmentEditor.status.invoiced', 'Facturé') },
    cancelled: { color: 'orange', label: t('amendmentEditor.status.cancelled') },
  }

  // ⚠️ LE SERVEUR FIGE DÈS L'ENVOI, PAS SEULEMENT À L'ACCEPTATION.
  //
  // Un avenant validé répond 409 « amsbm_document_locked » au PUT : montants,
  // tiers et numéro sont figés, il faut un avoir. L'écran ne verrouillait que
  // « accepted » et « refused » : sur un avenant envoyé, tous les champs
  // restaient saisissables et la saisie se perdait à l'enregistrement, sous un
  // « Erreur lors de la mise à jour » qui n'expliquait rien.
  const isLocked = ['sent', 'accepted', 'refused', 'invoiced', 'cancelled'].includes(amendmentData?.status ?? '')

  // Le contenu est figé, mais le statut, lui, avance encore : un avenant envoyé
  // s'accepte ou se refuse. Seuls les états terminaux perdent leur menu.
  const statutFige = ['accepted', 'refused', 'invoiced', 'cancelled'].includes(amendmentData?.status ?? '')

  // Statuses available for manual selection
  const statusMenuItems = [
    { key: 'draft', label: t('amendmentEditor.status.draft') },
    { key: 'sent', label: t('amendmentEditor.status.sent') },
    { key: 'accepted', label: t('amendmentEditor.status.accepted') },
    { key: 'refused', label: t('amendmentEditor.status.refused') },
    { key: 'cancelled', label: t('amendmentEditor.status.cancelled') },
  ]

  const handleStatusChange = async (status: string) => {
    if (currentAmendmentId) {
      // Auto-save before changing status to accepted — mais pas sur un avenant
      // déjà figé : l'enregistrement répondrait 409 et l'acceptation
      // s'accompagnerait d'un message d'erreur qui n'a pas lieu d'être.
      if (status === 'accepted' && !isLocked) {
        await handleSave()
      }
      updateStatusMutation.mutate({ id: currentAmendmentId, status })
    }
  }

  // Create deposit invoice
  const handleCreateDepositInvoice = async () => {
    if (!currentAmendmentId || !amendmentData) return

    // Fetch invoicing info first
    setInvoicingInfoLoading(true)
    try {
      const response = await amendmentAPI.getInvoicingInfo(currentAmendmentId)
      const info = response.data
      setInvoicingInfo(info)

      // Check if we can create deposit
      if (!info.can_create_deposit) {
        if (info.available_percent <= 0) {
          message.warning(t('amendmentEditor.messages.alreadyFullyInvoiced'))
          return
        }
        message.warning(t('amendmentEditor.messages.mustBeAcceptedForDeposit'))
        return
      }

      // Set default percent to remaining available or 30%, whichever is smaller
      setDepositPercent(Math.min(30, info.available_percent))
      setDepositModalOpen(true)
    } catch {
      message.error(t('amendmentEditor.messages.invoicingInfoError'))
    } finally {
      setInvoicingInfoLoading(false)
    }
  }

  const handleConfirmDeposit = async () => {
    if (!currentAmendmentId || !amendmentData) return
    setDepositLoading(true)
    try {
      const response = await amendmentAPI.createDepositInvoice(currentAmendmentId, depositPercent)
      message.success(t('amendmentEditor.messages.depositInvoiceCreated', { percent: depositPercent }))
      setDepositModalOpen(false)
      invalidateAmendmentQueries()
      queryClient.invalidateQueries({ queryKey: ['amendment', currentAmendmentId] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      // Open the created invoice in a new tab
      if (response?.data?.id) {
        openDocumentTab('invoice', response.data.id, t('amendmentEditor.invoiceTabTitle', { number: response.data.number || '' }))
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } }
      const errorMsg = error?.response?.data?.error || t('amendmentEditor.messages.depositInvoiceError')
      message.error(errorMsg)
    } finally {
      setDepositLoading(false)
    }
  }

  // Create full invoice from amendment
  const handleCreateInvoice = () => {
    if (!currentAmendmentId || !amendmentData) return
    Modal.confirm({
      title: t('amendmentEditor.invoiceModal.title'),
      content: (
        <div>
          <p>{t('amendmentEditor.invoiceModal.question')}</p>
          <p style={{ marginTop: 8 }}>
            <strong>{t('amendmentEditor.invoiceModal.amountHT')}</strong> {amendmentData.total_ht?.toFixed(2)} €
          </p>
          <p>
            <strong>{t('amendmentEditor.invoiceModal.amountTTC')}</strong> {amendmentData.total_ttc?.toFixed(2)} €
          </p>
          {invoicingInfo && invoicingInfo.deposit_invoices?.length > 0 && (
            <p style={{ marginTop: 8, color: '#fa8c16' }}>
              {t('amendmentEditor.invoiceModal.depositNote')}
            </p>
          )}
        </div>
      ),
      okText: t('amendmentEditor.invoiceModal.okText'),
      cancelText: t('amendmentEditor.buttons.cancel'),
      onOk: async () => {
        try {
          const response = await amendmentAPI.convert(currentAmendmentId)
          message.success(t('amendmentEditor.messages.invoiceCreated'))
          invalidateAmendmentQueries()
          queryClient.invalidateQueries({ queryKey: ['amendment', currentAmendmentId] })
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
          // Open the created invoice in a new tab
          if (response?.data?.id) {
            openDocumentTab('invoice', response.data.id, t('amendmentEditor.invoiceTabTitle', { number: response.data.number || '' }))
          }
        } catch (err: unknown) {
          const error = err as { response?: { data?: { error?: string } } }
          const errorMsg = error?.response?.data?.error || t('amendmentEditor.messages.invoiceCreateError')
          message.error(errorMsg)
        }
      },
    })
  }

  // Fetch invoicing info when amendment is loaded and status is accepted
  useEffect(() => {
    if (currentAmendmentId && amendmentData?.status === 'accepted') {
      amendmentAPI.getInvoicingInfo(currentAmendmentId)
        .then(response => setInvoicingInfo(response.data))
        .catch(() => {})
    }
  }, [currentAmendmentId, amendmentData?.status])

  // Open client tab
  const handleOpenClient = () => {
    const clientId = form.getFieldValue('client_id')
    if (clientId) {
      const client = clientsData?.data?.find((c: Client) => c.id === clientId)
      openDocumentTab('client', clientId, client ? t('amendmentEditor.clientTabTitle', { name: client.name }) : t('amendmentEditor.clientTabTitleDefault'))
    }
  }

  // Open deal tab
  const handleOpenDeal = () => {
    if (selectedDeal) {
      openDocumentTab('deal', selectedDeal.id, t('amendmentEditor.dealTabTitle', { name: selectedDeal.name }))
    }
  }

  // Calculate totals (only for article lines)
  const totals = useMemo(() => {
    let totalPurchase = 0
    let totalSaleHTBeforeDiscount = 0
    let totalTVABeforeDiscount = 0

    lines.forEach((line) => {
      // Skip non-article lines in total calculation
      if (line.line_type !== 'article') return

      const lineTotal = line.quantity * line.unit_price
      const lineDiscount = (lineTotal * line.discount_percent) / 100
      const lineTotalAfterDiscount = lineTotal - lineDiscount
      const lineTVA = (lineTotalAfterDiscount * line.vat_rate) / 100

      totalPurchase += line.quantity * line.purchase_price
      totalSaleHTBeforeDiscount += lineTotalAfterDiscount
      totalTVABeforeDiscount += lineTVA
    })

    // Apply global discount
    let globalDiscount = 0
    if (globalDiscountType === 'percent' && globalDiscountValue > 0) {
      globalDiscount = (totalSaleHTBeforeDiscount * globalDiscountValue) / 100
    } else if (globalDiscountType === 'amount' && globalDiscountValue > 0) {
      globalDiscount = globalDiscountValue
    }

    const totalSaleHT = totalSaleHTBeforeDiscount - globalDiscount
    // Recalculate TVA proportionally after global discount
    const discountRatio = totalSaleHTBeforeDiscount > 0 ? totalSaleHT / totalSaleHTBeforeDiscount : 1
    const totalTVA = totalTVABeforeDiscount * discountRatio

    const totalTTC = totalSaleHT + totalTVA
    const margin = totalSaleHT - totalPurchase
    const marginPercent = totalPurchase > 0 ? (margin / totalPurchase) * 100 : 0

    return {
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalSaleHTBeforeDiscount: Math.round(totalSaleHTBeforeDiscount * 100) / 100,
      globalDiscount: Math.round(globalDiscount * 100) / 100,
      totalSaleHT: Math.round(totalSaleHT * 100) / 100,
      totalTVA: Math.round(totalTVA * 100) / 100,
      totalTTC: Math.round(totalTTC * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
    }
  }, [lines, globalDiscountType, globalDiscountValue])

  // Calculate subtotal for a given line position (sum of article lines since last subtotal)
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

    // If the price hasn't changed from article, don't show the modal
    if (article.purchase_price === newPrice) {
      return
    }

    // Open the modal
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

    // If the price hasn't changed from article, don't show the modal
    if (article.sale_price === newPrice) {
      return
    }

    // Open the modal
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

    // The line is already updated via onChange, no need to update again

    // Optionally update the article in database
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
      const duplicatedLine: AmendmentLine = {
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
      // Trouver les lignes à dupliquer dans l'ordre
      const linesToDuplicate = prev.filter((line) => selectedRowKeys.includes(line.key))
      // Trouver l'index de la dernière ligne sélectionnée
      const lastSelectedIndex = Math.max(
        ...selectedRowKeys.map((key) => prev.findIndex((line) => line.key === key))
      )
      // Créer les duplicatas
      const duplicatedLines = linesToDuplicate.map((line) => ({
        ...line,
        key: `line-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      }))
      // Insérer après la dernière ligne sélectionnée
      newLines.splice(lastSelectedIndex + 1, 0, ...duplicatedLines)
      return newLines
    })
    setSelectedRowKeys([])
    setTabDirty(tabId, true)
  }

  const handleSave = async () => {
    try {
      await form.validateFields()

      if (!effectiveDealId && !amendmentData?.deal_id) {
        message.error(t('amendmentEditor.messages.noLinkedDeal'))
        return
      }

      const values = form.getFieldsValue()
      const data = {
        deal_id: effectiveDealId || amendmentData?.deal_id,
        client_id: values.client_id,
        date: values.date?.toISOString(),
        validity_date: values.validity_date?.toISOString(),
        subject: values.subject || '',
        notes: values.notes || '',
        delivery_address: values.delivery_address || '',
        footer_content: values.footer_content || '',
        payment_terms: values.payment_terms || '',
        discount_percent: globalDiscountType === 'percent' ? globalDiscountValue : 0,
        discount_amount: globalDiscountType === 'amount' ? globalDiscountValue : 0,
        lines: lines
          // ⚠️ UNE LIGNE SAISIE À LA MAIN N'A PAS D'ARTICLE, ET C'EST NORMAL.
          //
          // Le filtre ne gardait que les lignes pointant un article du catalogue :
          // « R11 travaux supplémentaires, 2 × 250 € » partait donc à la poubelle
          // avant l'envoi. L'avenant s'enregistrait « avec succès » à 0,00 €, sans
          // aucune ligne, et refusait ensuite de se valider (« impossible de
          // valider un document sans ligne ») pendant que l'écran continuait
          // d'afficher 585 €. On garde donc toute ligne qui porte QUELQUE CHOSE —
          // une description ou un article — exactement comme l'éditeur d'affaire.
          .filter((line) => line.line_type !== 'article' || line.description || line.article_id)
          .map((line, index) => ({
            line_type: line.line_type,
            article_id: line.article_id || null,
            description: line.description || '',
            quantity: line.line_type === 'article' ? line.quantity : 0,
            purchase_price: line.line_type === 'article' ? (line.purchase_price || 0) : 0,
            unit_price: line.line_type === 'article' ? line.unit_price : 0,
            discount_percent: line.line_type === 'article' ? (line.discount_percent || 0) : 0,
            tva_rate: line.line_type === 'article' ? (line.vat_rate ?? defaultVatRate) : 0,
            position: index + 1,
          })),
      }

      if (currentAmendmentId) {
        await updateMutation.mutateAsync({ id: currentAmendmentId, data })
      } else {
        await createMutation.mutateAsync(data)
      }
    } catch (error) {
      console.error('Validation error:', error)
    }
  }

  const handleDownloadPdf = async () => {
    if (!currentAmendmentId) return
    try {
      const response = await amendmentAPI.getPdf(currentAmendmentId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `avenant_${amendmentData?.number || 'nouveau'}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('amendmentEditor.messages.pdfDownloaded'))
    } catch {
      message.error(t('amendmentEditor.messages.pdfDownloadError'))
    }
  }

  const handlePreviewPdf = async () => {
    if (!currentAmendmentId) return
    setPdfPreviewLoading(true)
    setPdfPreviewOpen(true)

    try {
      const response = await amendmentAPI.getPdf(currentAmendmentId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
    } catch {
      message.error(t('amendmentEditor.messages.pdfLoadError'))
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

  const columns = [
    {
      title: '',
      dataIndex: 'drag',
      key: 'drag',
      width: 40,
      render: (_: unknown, record: AmendmentLine) => <DragHandle id={record.key} />,
    },
    {
      title: t('amendmentEditor.columns.ref'),
      dataIndex: 'article_id',
      key: 'article_id',
      width: columnWidths.article_id,
      onHeaderCell: () => ({
        width: columnWidths.article_id,
        onResize: handleColumnResize('article_id'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        return (
          <Select
            showSearch
            placeholder={t('amendmentEditor.columns.ref')}
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
      title: t('amendmentEditor.columns.description'),
      dataIndex: 'description',
      key: 'description',
      width: columnWidths.description,
      onHeaderCell: () => ({
        width: columnWidths.description,
        onResize: handleColumnResize('description'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type === 'text') {
          return (
            <Input.TextArea
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('amendmentEditor.placeholders.freeText')}
              autoSize={{ minRows: 1, maxRows: 4 }}
              style={{ width: '100%', fontStyle: 'italic' }}
            />
          )
        }
        if (record.line_type === 'page_break') {
          return (
            <div style={{
              textAlign: 'center',
              color: token.colorTextSecondary,
              fontStyle: 'italic',
              borderTop: `2px dashed ${token.colorBorder}`,
              borderBottom: `2px dashed ${token.colorBorder}`,
              padding: '8px 0',
              background: token.colorBgLayout
            }}>
              {t('amendmentEditor.pageBreakLabel')}
            </div>
          )
        }
        if (record.line_type === 'subtotal') {
          return (
            <Input
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('amendmentEditor.placeholders.subtotal')}
              style={{ fontWeight: 'bold' }}
            />
          )
        }
        return (
          <Input
            value={record.description}
            onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
            placeholder={t('amendmentEditor.placeholders.description')}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.qty')}</div>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right' as const,
      width: columnWidths.quantity,
      onHeaderCell: () => ({
        width: columnWidths.quantity,
        onResize: handleColumnResize('quantity'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.quantity}
            onChange={(value) => handleLineChange(record.key, 'quantity', value || 0)}
            min={0.001}
            precision={3}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.unit')}</div>,
      dataIndex: 'unit',
      key: 'unit',
      align: 'center' as const,
      width: 60,
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        return <span style={{ color: '#888' }}>{record.unit || t('amendmentEditor.columns.unitDefault')}</span>
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.purchasePrice')}</div>,
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      align: 'right' as const,
      width: columnWidths.purchase_price,
      onHeaderCell: () => ({
        width: columnWidths.purchase_price,
        onResize: handleColumnResize('purchase_price'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        // Get the original article price from database
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.purchase_price || 0
        return (
          <InputNumber
            value={record.purchase_price}
            onChange={(value) => handleLineChange(record.key, 'purchase_price', value || 0)}
            onBlur={() => {
              // Compare current line price with original article price
              if (record.article_id && record.purchase_price !== originalPrice) {
                handlePurchasePriceChange(record.key, record.purchase_price)
              }
            }}
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.coefficient')}</div>,
      dataIndex: 'coefficient',
      key: 'coefficient',
      align: 'right' as const,
      width: columnWidths.coefficient,
      onHeaderCell: () => ({
        width: columnWidths.coefficient,
        onResize: handleColumnResize('coefficient'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.coefficient}
            onChange={(value) => handleLineChange(record.key, 'coefficient', value || 1)}
            min={0}
            step={0.1}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.salePrice')}</div>,
      dataIndex: 'unit_price',
      key: 'unit_price',
      align: 'right' as const,
      width: columnWidths.unit_price,
      onHeaderCell: () => ({
        width: columnWidths.unit_price,
        onResize: handleColumnResize('unit_price'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        // Get the original article sale price from database
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.sale_price || 0
        return (
          <InputNumber
            value={record.unit_price}
            onChange={(value) => handleLineChange(record.key, 'unit_price', value || 0)}
            onBlur={() => {
              // Compare current line price with original article price
              if (record.article_id && record.unit_price !== originalPrice) {
                handleSalePriceChange(record.key, record.unit_price)
              }
            }}
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.discountPercent')}</div>,
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      align: 'right' as const,
      width: columnWidths.discount_percent,
      onHeaderCell: () => ({
        width: columnWidths.discount_percent,
        onResize: handleColumnResize('discount_percent'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value || 0)}
            min={0}
            max={100}
            precision={1}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.vat')}</div>,
      dataIndex: 'vat_rate',
      key: 'vat_rate',
      align: 'right' as const,
      width: columnWidths.vat_rate,
      onHeaderCell: () => ({
        width: columnWidths.vat_rate,
        onResize: handleColumnResize('vat_rate'),
      }),
      render: (_: unknown, record: AmendmentLine) => {
        if (record.line_type !== 'article') return null
        const configuredOptions = outputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
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
        // Ajouter la valeur actuelle si elle n'est pas dans les options
        const options = baseOptions.some((o: { value: number; label: string }) => o.value === record.vat_rate)
          ? baseOptions
          : [...baseOptions, { value: record.vat_rate, label: `${record.vat_rate}%` }]
        return (
          <Select
            value={record.vat_rate}
            onChange={(value) => handleLineChange(record.key, 'vat_rate', value)}
            options={options}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('amendmentEditor.columns.totalHT')}</div>,
      key: 'total',
      align: 'right' as const,
      width: columnWidths.total,
      onHeaderCell: () => ({
        width: columnWidths.total,
        onResize: handleColumnResize('total'),
      }),
      render: (_: unknown, record: AmendmentLine, index: number) => {
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
      render: (_: unknown, record: AmendmentLine) => (
        <Space size="small">
          <Tooltip title={t('amendmentEditor.buttons.duplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleDuplicateLine(record.key)}
              disabled={isLocked}
            />
          </Tooltip>
          <Tooltip title={t('amendmentEditor.buttons.delete')}>
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleRemoveLine(record.key)}
              disabled={isLocked || lines.length <= 1}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  const isNewAmendment = !documentId

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
            {isNewAmendment ? t('amendmentEditor.newAmendment') : t('amendmentEditor.tabTitle', { number: amendmentData?.number || '' })}
          </h2>
          {currentAmendmentId && amendmentData && (
            statutFige ? (
              <Tag
                color={statusConfig[amendmentData.status]?.color || 'default'}
                style={{ fontSize: 14, padding: '4px 12px' }}
              >
                {statusConfig[amendmentData.status]?.label || amendmentData.status}
              </Tag>
            ) : (
              <Dropdown
                menu={{
                  items: statusMenuItems,
                  onClick: ({ key }) => handleStatusChange(key),
                  selectedKeys: [amendmentData.status],
                }}
                trigger={['click']}
              >
                <Tag
                  color={statusConfig[amendmentData.status]?.color || 'default'}
                  style={{ cursor: 'pointer', fontSize: 14, padding: '4px 12px' }}
                >
                  {statusConfig[amendmentData.status]?.label || amendmentData.status} <DownOutlined />
                </Tag>
              </Dropdown>
            )
          )}
        </Space>
        <Space>
          {currentAmendmentId && (
            <>
              <Button icon={<FileSearchOutlined />} onClick={handlePreviewPdf}>
                {t('amendmentEditor.buttons.viewPdf')}
              </Button>
              <Button icon={<FilePdfOutlined />} onClick={handleDownloadPdf}>
                {t('amendmentEditor.buttons.downloadPdf')}
              </Button>
            </>
          )}
          {amendmentData?.status === 'accepted' && currentAmendmentId && (
            <>
              <Button icon={<EuroOutlined />} onClick={handleCreateDepositInvoice} loading={invoicingInfoLoading}>
                {t('amendmentEditor.buttons.invoiceDeposit')}
              </Button>
              <Button icon={<FileTextOutlined />} onClick={handleCreateInvoice} type="primary" ghost>
                {t('amendmentEditor.buttons.invoiceAmendment')}
              </Button>
            </>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={createMutation.isPending || updateMutation.isPending}
            disabled={isLocked}
          >
            {t('amendmentEditor.buttons.save')}
          </Button>
        </Space>
      </div>

      {/* Form Content */}
      <div style={{ flex: 1 }}>
        <div style={{ padding: '24px', paddingBottom: 80 }}>
        <Form form={form} layout="vertical">
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item
                label={t('amendmentEditor.fields.client')}
                required
                validateStatus={!selectedClient && form.isFieldTouched('client_id') ? 'error' : ''}
                help={!selectedClient && form.isFieldTouched('client_id') ? t('amendmentEditor.validation.selectClient') : ''}
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder={isLoadingClients ? t('amendmentEditor.placeholders.loading') : t('amendmentEditor.placeholders.selectClient')}
                    optionFilterProp="label"
                    loading={isLoadingClients}
                    value={selectedClient?.id}
                    onChange={handleClientChange}
                    disabled={isLocked}
                    options={clientsData?.data?.map((c: Client) => ({
                      value: c.id,
                      label: `${c.code} - ${c.name}`,
                    })) || []}
                    style={{ flex: 1 }}
                  />
                  <Tooltip title={t('amendmentEditor.tooltips.openClient')}>
                    <Button
                      icon={<SearchOutlined />}
                      onClick={handleOpenClient}
                      disabled={!selectedClient}
                    />
                  </Tooltip>
                </Space.Compact>
              </Form.Item>
              {/* Hidden field to store client_id for form validation */}
              <Form.Item name="client_id" hidden rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              {/* Link to associated deal */}
              {selectedDeal && (
                <div style={{ marginTop: -16, marginBottom: 16 }}>
                  <Button
                    type="link"
                    icon={<FolderOpenOutlined />}
                    onClick={handleOpenDeal}
                    style={{ padding: 0, height: 'auto' }}
                  >
                    {t('amendmentEditor.linkedDeal', { ref: selectedDeal.number || selectedDeal.name })}
                  </Button>
                </div>
              )}
            </Col>
            <Col span={6}>
              <Form.Item label={t('amendmentEditor.fields.billingAddress')}>
                <Input.TextArea
                  value={selectedClient ? [
                    selectedClient.name,
                    selectedClient.address_line1,
                    selectedClient.address_line2,
                    [selectedClient.postal_code, selectedClient.city].filter(Boolean).join(' '),
                    selectedClient.country
                  ].filter(Boolean).join('\n') : ''}
                  disabled
                  rows={5}
                  style={{ backgroundColor: token.colorFillTertiary }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="delivery_address" label={t('amendmentEditor.fields.deliveryAddress')}>
                <Input.TextArea
                  rows={5}
                  placeholder={t('amendmentEditor.placeholders.deliveryAddress')}
                  disabled={isLocked}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item
                    name="date"
                    label={t('amendmentEditor.fields.date')}
                    rules={[{ required: true, message: t('amendmentEditor.validation.dateRequired') }]}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={isLocked} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="validity_date"
                    label={t('amendmentEditor.fields.validity')}
                    rules={[{ required: true, message: t('amendmentEditor.validation.dateRequired') }]}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={isLocked} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t('amendmentEditor.fields.paymentTerm')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('amendmentEditor.placeholders.selectPaymentTerm')}
                  value={selectedPaymentTermId}
                  disabled={isLocked}
                  onChange={(value) => {
                    setSelectedPaymentTermId(value)
                    if (value) {
                      const term = paymentTermsData?.payment_terms?.find((t: PaymentTerm) => t.id === value)
                      if (term) {
                        // Store payment terms label for PDF
                        form.setFieldValue('payment_terms', term.label)
                        // Calculate validity date from document date + payment term days
                        const documentDate = form.getFieldValue('date') || dayjs()
                        form.setFieldValue('validity_date', dayjs(documentDate).add(term.days, 'day'))
                      }
                    } else {
                      form.setFieldValue('payment_terms', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {paymentTermsData?.payment_terms?.map((term: PaymentTerm) => (
                    <Select.Option key={term.id} value={term.id}>
                      {term.label} ({term.days === 0 ? t('amendmentEditor.paymentTermCash') : t('amendmentEditor.paymentTermDays', { days: term.days })})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row>
            <Col span={24}>
              <Form.Item name="subject" label={t('amendmentEditor.fields.subject')} rules={[{ required: true, message: t('amendmentEditor.validation.subjectRequired') }]}>
                <Input placeholder={t('amendmentEditor.placeholders.subject')} disabled={isLocked} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{t('amendmentEditor.linesTitle')}</span>
          <Space size="middle">
            {selectedRowKeys.length > 0 && !isLocked && (
              <>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelection}
                  danger
                >
                  {t('amendmentEditor.buttons.deleteCount', { count: selectedRowKeys.length })}
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleDuplicateSelection}
                >
                  {t('amendmentEditor.buttons.duplicateCount', { count: selectedRowKeys.length })}
                </Button>
              </>
            )}
            <Button
              icon={<PlusOutlined />}
              onClick={() => handleAddLine('article')}
              disabled={isLocked}
              style={{ backgroundColor: '#1677ff', borderColor: '#1677ff', color: '#fff' }}
            >
              {t('amendmentEditor.buttons.addArticle')}
            </Button>
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleAddLine('text')}
              disabled={isLocked}
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
            >
              {t('amendmentEditor.buttons.addText')}
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => handleAddLine('subtotal')}
              disabled={isLocked}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('amendmentEditor.buttons.addSubtotal')}
            </Button>
            <Button
              icon={<MinusOutlined />}
              onClick={() => handleAddLine('page_break')}
              disabled={isLocked}
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
            >
              {t('amendmentEditor.buttons.addPageBreak')}
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
          <Form.Item name="notes" label={t('amendmentEditor.fields.notes')}>
            <Input.TextArea rows={3} placeholder={t('amendmentEditor.placeholders.notes')} disabled={isLocked} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label={t('amendmentEditor.fields.footer')}>
                <Select
                  allowClear
                  placeholder={t('amendmentEditor.placeholders.selectFooter')}
                  value={selectedFooterId}
                  disabled={isLocked}
                  onChange={(footerId) => {
                    setSelectedFooterId(footerId || null)
                    const footer = footers.find((f: { id: string }) => f.id === footerId)
                    if (footer) {
                      form.setFieldValue('footer_content', footer.content)
                    } else {
                      form.setFieldValue('footer_content', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {footers.map((footer: { id: string; name: string }) => (
                    <Select.Option key={footer.id} value={footer.id}>
                      {footer.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="footer_content" label={t('amendmentEditor.fields.footerContent')}>
                <Input.TextArea
                  rows={3}
                  placeholder={t('amendmentEditor.placeholders.footerContent')}
                  disabled={isLocked}
                  onChange={() => setTabDirty(tabId, true)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        {/* Tabs: Factures liées et Documents liés */}
        {currentAmendmentId && (
          <Tabs
            defaultActiveKey="invoices"
            items={[
              {
                key: 'invoices',
                label: invoicingInfo?.deposit_invoices?.length
                  ? t('amendmentEditor.tabs.linkedInvoicesCount', { count: invoicingInfo.deposit_invoices.length })
                  : t('amendmentEditor.tabs.linkedInvoices'),
                children: (() => {
                  const invoices = invoicingInfo?.deposit_invoices || []
                  // Calculate totals for all invoices
                  const totalHT = invoices.reduce((sum, inv) => sum + (inv.total_ht || 0), 0)
                  const totalTTC = invoices.reduce((sum, inv) => sum + (inv.total_ttc || 0), 0)

                  const statusConfig: Record<string, { color: string; label: string }> = {
                    draft: { color: 'default', label: t('amendmentEditor.invoiceStatus.draft') },
                    sent: { color: 'blue', label: t('amendmentEditor.invoiceStatus.sent') },
                    paid: { color: 'green', label: t('amendmentEditor.invoiceStatus.paid') },
                    partial: { color: 'orange', label: t('amendmentEditor.invoiceStatus.partial') },
                    cancelled: { color: 'red', label: t('amendmentEditor.invoiceStatus.cancelled') },
                  }

                  return (
                    <div>
                      {invoices.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                          {t('amendmentEditor.noLinkedInvoices')}
                        </div>
                      ) : (
                        <>
                          <Table
                            dataSource={invoices}
                            rowKey="id"
                            pagination={false}
                            size="small"
                            onRow={(record) => ({
                              onClick: () => openDocumentTab('invoice', record.id, t('amendmentEditor.invoiceTabTitle', { number: record.number })),
                              style: { cursor: 'pointer' },
                            })}
                            columns={[
                              {
                                title: t('amendmentEditor.invoiceColumns.number'),
                                dataIndex: 'number',
                                key: 'number',
                                width: 150,
                              },
                              {
                                title: t('amendmentEditor.invoiceColumns.type'),
                                dataIndex: 'type',
                                key: 'type',
                                width: 100,
                                render: (type: string) => (
                                  <Tag color={type === 'deposit' ? 'gold' : 'blue'}>
                                    {type === 'deposit' ? t('amendmentEditor.invoiceType.deposit') : t('amendmentEditor.invoiceType.invoice')}
                                  </Tag>
                                ),
                              },
                              {
                                title: t('amendmentEditor.invoiceColumns.date'),
                                dataIndex: 'date',
                                key: 'date',
                                width: 120,
                                render: (date: string) => new Date(date).toLocaleDateString('fr-FR'),
                              },
                              {
                                title: t('amendmentEditor.invoiceColumns.status'),
                                dataIndex: 'status',
                                key: 'status',
                                width: 120,
                                render: (status: string) => (
                                  <Tag color={statusConfig[status]?.color || 'default'}>
                                    {statusConfig[status]?.label || status}
                                  </Tag>
                                ),
                              },
                              {
                                title: t('amendmentEditor.invoiceColumns.totalHT'),
                                dataIndex: 'total_ht',
                                key: 'total_ht',
                                width: 120,
                                align: 'right' as const,
                                render: (val: number) => `${(val || 0).toFixed(2)} €`,
                              },
                              {
                                title: t('amendmentEditor.invoiceColumns.totalTTC'),
                                dataIndex: 'total_ttc',
                                key: 'total_ttc',
                                width: 120,
                                align: 'right' as const,
                                render: (val: number) => `${(val || 0).toFixed(2)} €`,
                              },
                            ]}
                          />
                          <div
                            style={{
                              marginTop: 16,
                              padding: 12,
                              background: '#f5f5f5',
                              borderRadius: 4,
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: 24,
                            }}
                          >
                            <span>
                              <strong>{t('amendmentEditor.totals.totalHTLabel')}</strong> {totalHT.toFixed(2)} €
                            </span>
                            <span>
                              <strong>{t('amendmentEditor.totals.totalTTCLabel')}</strong> {totalTTC.toFixed(2)} €
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })(),
              },
              {
                key: 'documents',
                label: t('amendmentEditor.tabs.linkedDocuments'),
                children: <DocumentsSection entityType="amendment" entityId={currentAmendmentId} title="" />,
              },
            ]}
          />
        )}
        </div>

        {/* Footer with Totals - Right aligned summary panel */}
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('amendmentEditor.summary.purchaseHT')}</div>
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
              {t('amendmentEditor.summary.margin', { percent: totals.marginPercent })}
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('amendmentEditor.summary.saleHT')}</div>
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>{t('amendmentEditor.summary.globalDiscount')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <InputNumber
                size="small"
                min={0}
                max={globalDiscountType === 'percent' ? 100 : undefined}
                value={globalDiscountValue}
                disabled={isLocked}
                onChange={(val) => {
                  setGlobalDiscountValue(val || 0)
                  setTabDirty(tabId, true)
                }}
                style={{ width: 70 }}
              />
              <Select
                size="small"
                value={globalDiscountType}
                disabled={isLocked}
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('amendmentEditor.summary.netHT')}</div>
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
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{t('amendmentEditor.summary.globalVat')}</span>
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
                disabled={isLocked || !lines.some(l => l.line_type === 'article')}
                placeholder=""
                options={
                  outputVatRates.length > 0
                    ? outputVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
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
              {t('amendmentEditor.summary.totalTTC')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
              {totals.totalTTC.toFixed(2)} €
            </div>
          </Card>
        </div>
      </div>
      </div>

      {/* PDF Preview Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 30 }}>
            <span>{t('amendmentEditor.pdfModal.title', { number: amendmentData?.number || '' })}</span>
            <Space size="small">
              <Button size="small" onClick={() => setModalSize({ width: 600, height: 60 })}>{t('amendmentEditor.pdfModal.sizeSmall')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 900, height: 80 })}>{t('amendmentEditor.pdfModal.sizeMedium')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 1200, height: 90 })}>{t('amendmentEditor.pdfModal.sizeLarge')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: window.innerWidth - 100, height: 95 })}>{t('amendmentEditor.pdfModal.sizeFullscreen')}</Button>
            </Space>
          </div>
        }
        open={pdfPreviewOpen}
        onCancel={closePdfPreview}
        width={modalSize.width}
        centered
        footer={[
          <Button key="close" onClick={closePdfPreview}>
            {t('amendmentEditor.buttons.close')}
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleDownloadPdf}
          >
            {t('amendmentEditor.buttons.download')}
          </Button>,
        ]}
      >
        {pdfPreviewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p>{t('amendmentEditor.pdfModal.loading')}</p>
          </div>
        ) : pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            style={{ width: '100%', height: `${modalSize.height}vh`, border: 'none' }}
            title={t('amendmentEditor.tabTitle', { number: amendmentData?.number })}
           
          />
        ) : null}
      </Modal>

      {/* Deposit Invoice Modal */}
      <Modal
        title={t('amendmentEditor.depositModal.title')}
        open={depositModalOpen}
        onOk={handleConfirmDeposit}
        onCancel={() => setDepositModalOpen(false)}
        okText={t('amendmentEditor.invoiceModal.okText')}
        cancelText={t('amendmentEditor.buttons.cancel')}
        confirmLoading={depositLoading}
        okButtonProps={{ disabled: depositPercent <= 0 || depositPercent > (invoicingInfo?.available_percent || 100) }}
      >
        <div>
          {invoicingInfo && invoicingInfo.deposit_percent > 0 && (
            <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
              <p style={{ margin: 0, color: '#d48806' }}>
                <strong>{t('amendmentEditor.depositModal.alreadyInvoicedLabel')}</strong> {invoicingInfo.deposit_percent.toFixed(1)}% ({invoicingInfo.deposit_invoiced_ht.toFixed(2)} € HT)
              </p>
              <p style={{ margin: '4px 0 0 0', color: '#d48806' }}>
                <strong>{t('amendmentEditor.depositModal.availableLabel')}</strong> {invoicingInfo.available_percent.toFixed(1)}%
              </p>
            </div>
          )}
          <p>{t('amendmentEditor.depositModal.question')}</p>
          <InputNumber
            value={depositPercent}
            onChange={(value) => setDepositPercent(value || 0)}
            min={0.01}
            max={invoicingInfo?.available_percent || 100}
            precision={2}
            addonAfter="%"
            style={{ width: '100%' }}
          />
          <p style={{ marginTop: 16, color: '#666' }}>
            {t('amendmentEditor.depositModal.amountHT', { amount: amendmentData?.total_ht?.toFixed(2) })}
          </p>
          <p style={{ color: '#1890ff', fontWeight: 'bold' }}>
            {t('amendmentEditor.depositModal.depositAmount', { amount: ((amendmentData?.total_ht || 0) * depositPercent / 100).toFixed(2) })}
          </p>
          {invoicingInfo && invoicingInfo.deposit_percent > 0 && (
            <p style={{ color: '#52c41a', fontWeight: 'bold' }}>
              {t('amendmentEditor.depositModal.totalAfter', { percent: (invoicingInfo.deposit_percent + depositPercent).toFixed(1) })}
            </p>
          )}
        </div>
      </Modal>

      {/* Price Modification Modal (purchase or sale) */}
      <Modal
        title={priceModalData?.priceType === 'sale' ? t('amendmentEditor.priceModal.titleSale') : t('amendmentEditor.priceModal.titlePurchase')}
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
                ? t('amendmentEditor.priceModal.introSale')
                : t('amendmentEditor.priceModal.introPurchase')} <strong>{priceModalData.articleName}</strong>
            </p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, padding: 12, background: '#f5f5f5', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('amendmentEditor.priceModal.oldPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#ff4d4f', textDecoration: 'line-through' }}>
                  {priceModalData.oldPrice.toFixed(2)} €
                </div>
              </div>
              <div style={{ flex: 1, padding: 12, background: '#f6ffed', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('amendmentEditor.priceModal.newPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>
                  {priceModalData.newPrice.toFixed(2)} €
                </div>
              </div>
            </div>
            <p style={{ marginBottom: 16, color: '#666' }}>
              {t('amendmentEditor.priceModal.applyQuestion')}
            </p>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                type="primary"
                block
                onClick={() => handlePriceModalConfirm(false)}
              >
                {t('amendmentEditor.priceModal.documentOnly')}
              </Button>
              <Button
                type="default"
                block
                onClick={() => handlePriceModalConfirm(true)}
                loading={updateArticleMutation.isPending}
              >
                {t('amendmentEditor.priceModal.documentAndArticle')}
              </Button>
              <Button
                type="text"
                block
                onClick={() => {
                  // Revert to original price
                  const field = priceModalData.priceType === 'purchase' ? 'purchase_price' : 'unit_price'
                  handleLineChange(priceModalData.lineKey, field, priceModalData.oldPrice)
                  setPriceModalOpen(false)
                  setPriceModalData(null)
                }}
              >
                {t('amendmentEditor.buttons.cancel')}
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  )
}
