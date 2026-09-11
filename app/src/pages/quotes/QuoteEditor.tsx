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
  MailOutlined,
  EuroOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  AlignLeftOutlined,
  CalculatorOutlined,
  MinusOutlined,
  HolderOutlined,
  CopyOutlined,
  LockOutlined,
  AuditOutlined,
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

import { quoteAPI, clientAPI, articleAPI, settingsAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useCanValidateDocuments, usePermissionsChargees } from '@/stores/permissionStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import DocumentsSection from '@/components/DocumentsSection'
import SuiviDocument from '@/components/SuiviDocument'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import { useColumnWidths } from '@/hooks/useColumnWidths'
import dayjs from 'dayjs'

interface Client {
  id: string
  code: string
  name: string
  email?: string
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

type LineType = 'article' | 'text' | 'page_break' | 'subtotal'

interface QuoteLine {
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

interface Quote {
  id: string
  number: string
  client_id: string
  client?: { id: string; name: string; code?: string; address?: string; email?: string }
  date: string
  validity_date?: string
  status: string
  subject?: string
  notes?: string
  delivery_address?: string
  discount_percent?: number
  discount_amount?: number
  footer_id?: string
  footer_content?: string
  payment_terms?: string
  deal_id?: string
  deal?: { id: string; number: string; name: string }
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
  is_active?: boolean
}

interface PaymentTerm {
  id: string
  label: string
  days: number
  is_default: boolean
}

interface QuoteEditorProps {
  tabId: string
  documentId?: string
}

// Motif d'un refus du serveur.
//
// ⚠️ WordPress répond { code, message, data:{ status } } ; seules quelques
// routes d'AMS Studio répondent { error }. Les écrans ne lisaient QUE « error » :
// chaque refus se réduisait au libellé de repli, et l'utilisateur ne savait ni
// que son devis était verrouillé, ni qu'il ne restait rien à facturer.
function serverMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data
  return data?.message || data?.error || ''
}

// La règle du droit de valider — miroir de Settings::recalculerCapacitesDeRole()
// côté serveur — vit dans permissionStore, avec les quatre modules concernés :
// cinq écrans en dépendent, et une copie par écran finit par diverger.

export default function QuoteEditor({ tabId, documentId }: QuoteEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { updateTabTitle, setTabDirty, openDocumentTab, setTabDocumentId } = useDocumentTabsStore()
  const { primaryColor } = useThemeStore()
  const { sidebarWidth } = useSidebarStore()
  const { token } = theme.useToken()
  const [form] = Form.useForm()
  const [lines, setLines] = useState<QuoteLine[]>([])
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 900, height: 80 })
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null)
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

  // ID effectif du devis (props ou après création)
  const currentQuoteId = documentId || savedQuoteId

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

  // Fetch VAT rates (output direction for quotes)
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

  // Filter VAT rates for output direction (client quotes)
  //
  // ⚠️ ET SEULEMENT LES TAUX ACTIFS. Le sélecteur proposait les taux DÉSACTIVÉS
  // du paramétrage ; le serveur, lui, ne cherche que dans les actifs et refuse
  // le reste (« Taux de TVA inconnu : 20 % »). L'écran offrait donc un taux
  // qu'aucun enregistrement ne pouvait accepter.
  const outputVatRates = useMemo(() => {
    const rates = vatRatesData?.vat_rates || []
    return rates.filter((r: VATRate) => r.direction === 'output' && r.is_active !== false)
  }, [vatRatesData])

  // Get default VAT rate (use configured default, or first available, or 0)
  const defaultVatRate = useMemo(() => {
    const defaultRate = outputVatRates.find((r: VATRate) => r.is_default)
    if (defaultRate) return defaultRate.rate
    if (outputVatRates.length > 0) return outputVatRates[0].rate
    return 0
  }, [outputVatRates])

  // Apply default payment term for new documents
  useEffect(() => {
    if (!documentId && paymentTermsData?.payment_terms) {
      const defaultTerm = paymentTermsData.payment_terms.find((pt: PaymentTerm) => pt.is_default)
      if (defaultTerm && !selectedPaymentTermId) {
        setSelectedPaymentTermId(defaultTerm.id)
        form.setFieldValue('payment_terms', defaultTerm.label)
        // Calculate validity date based on default payment term
        const currentDate = form.getFieldValue('date') || dayjs()
        form.setFieldValue('validity_date', dayjs(currentDate).add(defaultTerm.days, 'day'))
      }
    }
  }, [documentId, paymentTermsData, selectedPaymentTermId, form])

  // Fetch existing quote if editing
  const { data: quoteData } = useQuery({
    // ⚠️ « currentQuoteId », PAS « documentId ».
    //
    // documentId est l'identifiant que l'ONGLET portait à l'ouverture : sur un
    // devis neuf, il reste vide même après l'enregistrement. La requête ne
    // partait donc jamais, quoteData restait nul — et comme l'étiquette d'état
    // ne s'affiche que si quoteData existe, le devis qu'on venait de créer
    // n'avait PAS D'ÉTAT. Sans état, pas de menu, donc pas de validation, donc
    // rien ne partait chez le client : il fallait fermer l'écran et rouvrir le
    // devis depuis la liste pour le découvrir. Les trois autres éditeurs de
    // documents lisaient déjà leur identifiant courant ; celui-ci non.
    queryKey: ['quote', currentQuoteId],
    queryFn: async () => {
      if (!currentQuoteId) return null
      const response = await quoteAPI.get(currentQuoteId)
      return response.data as Quote
    },
    enabled: !!currentQuoteId,
  })

  // Fetch linked invoices
  const { data: linkedInvoicesData } = useQuery({
    queryKey: ['invoices', 'quote', documentId],
    queryFn: async () => {
      if (!documentId) return { data: [] }
      const response = await quoteAPI.getLinkedInvoices(documentId)
      return response.data
    },
    enabled: !!documentId,
  })

  // Fetch footers for quotes
  const { data: footersData } = useQuery({
    queryKey: ['footers', 'quote'],
    queryFn: async () => {
      const response = await settingsAPI.listFootersByDocumentType('quote')
      return response.data
    },
  })

  // ⚠️ La queryFn rendait la RÉPONSE axios entière, pas son corps. Le sélecteur
  // s'en sortait en lisant footersData.data ; la relecture, elle, cherchait un
  // footersData.footers qui n'a jamais existé — le pied de page enregistré
  // n'était donc jamais re-sélectionné à la réouverture du devis. Une seule
  // forme désormais : le tableau nu que rend le serveur.
  const footers = useMemo(
    () => (Array.isArray(footersData) ? footersData : (footersData?.data || [])) as Array<{ id: string; name: string; content: string }>,
    [footersData]
  )

  // Load quote data when editing
  useEffect(() => {
    if (quoteData) {
      // Only initialize lines once to avoid overwriting user changes when articles are re-fetched
      if (linesInitializedRef.current) {
        return
      }

      form.setFieldsValue({
        client_id: quoteData.client_id,
        date: quoteData.date ? dayjs(quoteData.date) : dayjs(),
        validity_date: quoteData.validity_date ? dayjs(quoteData.validity_date) : dayjs().add(30, 'day'),
        subject: quoteData.subject,
        notes: quoteData.notes,
        delivery_address: quoteData.delivery_address,
        footer_content: quoteData.footer_content || '',
        payment_terms: quoteData.payment_terms || '',
      })

      // Restore selected payment term
      if (quoteData.payment_terms && paymentTermsData?.payment_terms) {
        const term = paymentTermsData.payment_terms.find((pt: PaymentTerm) => pt.label === quoteData.payment_terms)
        if (term) {
          setSelectedPaymentTermId(term.id)
        }
      }

      // Set selected client
      if (quoteData.client_id) {
        const client = clientsData?.data?.find((c: Client) => c.id === quoteData.client_id)
        // Le devis PORTE son client : s'il ne figure pas dans la liste —
        // archivé, ou au-delà de la page demandée — on prend celui du document
        // plutôt que de laisser le champ vide. Un champ vide sur un devis qui a
        // bien un client ne se comprend pas, et fait croire à une perte.
        if (client) {
          setSelectedClient(client)
        } else if (quoteData.client) {
          setSelectedClient({
            id: quoteData.client.id,
            code: quoteData.client.code || '',
            name: quoteData.client.name,
            // Son adresse aussi : c'est elle que la fenêtre d'envoi propose.
            email: quoteData.client.email || '',
          } as Client)
        }
      }

      // Convert quote lines to our format
      const convertedLines: QuoteLine[] = (quoteData.lines || []).map((line, idx) => {
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
      updateTabTitle(tabId, `${t('quoteEditor.quote')} ${quoteData.number}`)

      // Load global discount
      if (quoteData.discount_percent && quoteData.discount_percent > 0) {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(quoteData.discount_percent)
      } else if (quoteData.discount_amount && quoteData.discount_amount > 0) {
        setGlobalDiscountType('amount')
        setGlobalDiscountValue(quoteData.discount_amount)
      } else {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(0)
      }

      // Load selected footer by matching content
      if (quoteData.footer_content && footers.length > 0) {
        const matchingFooter = footers.find((f) => f.content === quoteData.footer_content)
        if (matchingFooter) {
          setSelectedFooterId(matchingFooter.id)
        }
      }
    } else if (!documentId) {
      // New quote
      if (!linesInitializedRef.current) {
        form.setFieldsValue({
          date: dayjs(),
          validity_date: dayjs().add(30, 'day'),
        })
        setLines([createEmptyLine()])
        linesInitializedRef.current = true
      }
    }
  }, [quoteData, articlesData, clientsData, paymentTermsData, footers, documentId, form, tabId, updateTabTitle])

  // Saisie non enregistrée : l'onglet porte déjà son astérisque, mais rien
  // n'arrêtait la main. Recharger la page ou fermer le navigateur emportait le
  // devis en cours sans un mot. (Fermer un onglet DE L'ERP passe par
  // MainLayout, qui ne demande rien non plus — voir le relevé de passation.)
  const isTabDirty = useDocumentTabsStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId)
    return tab?.type === 'document' && tab.isDirty
  })

  useEffect(() => {
    if (!isTabDirty) return
    const garde = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Les navigateurs n'affichent plus le texte fourni, mais exigent toujours
      // qu'une valeur soit posée pour ouvrir leur propre confirmation.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', garde)
    return () => window.removeEventListener('beforeunload', garde)
  }, [isTabDirty])

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

  const createEmptyLine = (lineType: LineType = 'article'): QuoteLine => ({
    key: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    line_type: lineType,
    article_id: undefined,
    description: lineType === 'page_break' ? t('quoteEditor.pageBreakLabel') : lineType === 'subtotal' ? t('quoteEditor.subtotalLabel') : '',
    quantity: 1,
    unit: '',
    purchase_price: 0,
    coefficient: 1,
    unit_price: 0,
    discount_percent: 0,
    vat_rate: defaultVatRate,
  })

  // Mutations
  // Helper to invalidate all quote-related queries (including client history)
  const invalidateQuoteQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['quotes'], refetchType: 'all' })
    // Also invalidate client history queries
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey
      return Array.isArray(key) && key[0] === 'quotes' && key[1] === 'client'
    }})
    // Invalidate dashboard
    queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' })
  }

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => quoteAPI.create(data),
    onSuccess: (response) => {
      message.success(t('quoteEditor.quoteCreated'))
      invalidateQuoteQueries()
      const newQuote = response.data as Quote
      updateTabTitle(tabId, `${t('quoteEditor.quote')} ${newQuote.number}`)
      setTabDirty(tabId, false)
      setSavedQuoteId(newQuote.id)
      // L'onglet ADOPTE le devis qu'il vient de créer : il cesse d'être « neuf »,
      // et le rouvrir plus tard tombe sur le bon document.
      setTabDocumentId(tabId, newQuote.id)
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quoteEditor.quoteCreateError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      quoteAPI.update(id, data),
    onSuccess: () => {
      message.success(t('quoteEditor.quoteUpdated'))
      invalidateQuoteQueries()
      if (currentQuoteId) {
        queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
      }
      setTabDirty(tabId, false)
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quoteEditor.quoteUpdateError'))
    },
  })

  const _validateMutation = useMutation({
    mutationFn: (id: string) => quoteAPI.validate(id),
    onSuccess: () => {
      message.success(t('quoteEditor.quoteValidated'))
      invalidateQuoteQueries()
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
    },
    onError: () => {
      message.error(t('quoteEditor.quoteValidateError'))
    },
  })
  void _validateMutation

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      quoteAPI.updateStatus(id, status),
    // ⚠️ « STATUT MIS À JOUR » SE VÉRIFIE, IL NE SE SUPPOSE PAS.
    //
    // La route rend le devis relu : son statut dit ce qui s'est RÉELLEMENT
    // passé. Certaines demandes repartent avec un 200 franc sans avoir rien
    // changé — un devis validé à qui l'on demande « Envoyé » en est l'exemple
    // vivant, la marque d'envoi n'étant posée que par le courriel. Annoncer
    // « Statut mis à jour » dans ce cas-là est un mensonge, et l'utilisateur
    // recliquait en boucle.
    onSuccess: (reponse, variables) => {
      const obtenu = (reponse?.data as { status?: string } | undefined)?.status

      if (obtenu && obtenu !== variables.status) {
        message.warning(
          t(
            'quoteEditor.statusUnchanged',
            'Le serveur a laissé ce devis en « {{statut}} » : le changement demandé n\'a pas eu lieu.',
            { statut: statusConfig[obtenu]?.label || obtenu }
          ),
          6
        )
      } else {
        message.success(t('quoteEditor.statusUpdated'))
      }

      invalidateQuoteQueries()
      // ⚠️ « currentQuoteId », PAS « documentId » — même piège qu'à la requête
      // du devis (voir plus haut) : sur un devis créé dans l'onglet, documentId
      // reste vide, la clé invalidée n'existe pas, et l'étiquette d'état gardait
      // l'ancien statut jusqu'à la réouverture de l'écran.
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
    },
    // ⚠️ LE MOTIF DU REFUS VIENT DU SERVEUR, ET LUI SEUL SAIT QUOI FAIRE.
    //
    // Un 403 sur la validation dit « Valider un document demande le droit de
    // validation. Demandez-le à un responsable. » — une phrase qui indique la
    // marche à suivre. Le libellé de repli, lui, n'apprend rien. La durée est
    // portée à huit secondes : ces phrases-là se lisent, et trois secondes ne
    // suffisent pas.
    onError: (err: unknown) => {
      const motif = serverMessage(err)

      message.error(motif || t('quoteEditor.statusUpdateError'), motif ? 8 : undefined)
    },
  })

  // ⚠️ LA PASSATION DE MAIN, QUAND ON N'A PAS LE DROIT DE VALIDER.
  //
  // Le rédacteur qui n'a pas « amsbm_validate_documents » finissait son devis et
  // se heurtait à un 403 : il allait le demander de vive voix, ou le devis
  // dormait. La route pose « attente validation » ET prévient par courriel tous
  // ceux qui peuvent valider ; l'écran dit COMBIEN de personnes l'ont été, car
  // « c'est parti » sur zéro destinataire ne vaut rien.
  const requestValidationMutation = useMutation({
    mutationFn: (id: string) => quoteAPI.requestValidation(id),
    onSuccess: (reponse) => {
      const prevenus = Number((reponse?.data as { notified?: number } | undefined)?.notified ?? 0)

      if (prevenus > 0) {
        message.success(
          t(
            'quoteEditor.validationRequested',
            'Demande envoyée : {{count}} personne(s) prévenue(s). Le devis attend sa validation.',
            { count: prevenus }
          )
        )
      } else {
        // Aucun courriel n'est parti : le devis attend bien, mais personne ne le
        // sait. Le dire vaut mieux qu'un « Envoyé ! » qui laisserait croire
        // qu'un responsable a été touché.
        message.warning(
          t(
            'quoteEditor.validationRequestedNobody',
            "Le devis attend sa validation, mais personne n'a pu être prévenu : aucun compte n'a le droit de valider, ou leur adresse de courriel manque."
          ),
          8
        )
      }

      invalidateQuoteQueries()
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
    },
    onError: (err: unknown) => {
      const motif = serverMessage(err)

      message.error(
        motif || t('quoteEditor.validationRequestError', "La demande de validation n'est pas partie."),
        motif ? 8 : undefined
      )
    },
  })

  // Mutation to update article purchase price
  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      articleAPI.update(id, data),
    onSuccess: () => {
      message.success(t('quoteEditor.articlePriceUpdated'))
      queryClient.invalidateQueries({ queryKey: ['articles-for-editor'] })
    },
    onError: () => {
      message.error(t('quoteEditor.articlePriceUpdateError'))
    },
  })

  const peutValider = useCanValidateDocuments()
  const droitsConnus = usePermissionsChargees()

  // Le cycle de vie du devis, tel que le client le décrit et tel que le serveur
  // le rend (voir Quotes::outStatus) :
  //
  //   brouillon → attente validation → validé → envoyé → accepté → (annulé)
  //
  // ⚠️ « attente validation », « validé » et « envoyé » sont TROIS LECTURES DU
  // MÊME ÉTAT INTERNE, distinguées par deux métadonnées (demande de validation,
  // marque d'envoi). N'en déduisez rien sur le verrouillage : le devis n'est
  // figé qu'à partir de « validé » — voir isLocked plus bas.
  //
  // « deposit » et « ordered » ne sortent plus de Quotes::statusMap() ; on les
  // garde ici pour les devis anciens, dont l'étiquette resterait sinon nue.
  const statusConfig: Record<string, { color: string; label: string }> = {
    draft: { color: 'default', label: t('quoteEditor.statusDraft') },
    pending_validation: {
      color: 'orange',
      label: t('quoteEditor.statusPendingValidation', 'Attente validation'),
    },
    validated: { color: 'blue', label: t('quoteEditor.statusValidated', 'Validé') },
    sent: { color: 'cyan', label: t('quoteEditor.statusSent') },
    // ⚠️ « Consulté » est une QUATRIÈME LECTURE du même état interne, comme
    // « attente validation », « validé » et « envoyé » (voir Quotes::outStatus).
    // Le devis reste figé et numéroté ; seul change ce qu'on sait du client.
    // Le violet le distingue du cyan d'« envoyé » sans crier : c'est une bonne
    // nouvelle, pas une alerte.
    consulted: { color: 'purple', label: t('quoteEditor.statusConsulted', 'Consulté') },
    accepted: { color: 'green', label: t('quoteEditor.statusAccepted') },
    refused: { color: 'red', label: t('quoteEditor.statusRefused') },
    // ⚠️ Rouge SOMBRE, et pas le « red » d'Ant Design : « refusé » (le client dit
    // non) et « annulé » (nous retirons le devis) sont deux fins différentes, et
    // deux étiquettes rouges identiques les rendaient impossibles à distinguer
    // d'un coup d'œil dans la liste. #a8071a est le red-8 de la palette Ant.
    cancelled: { color: '#a8071a', label: t('quoteEditor.statusCancelled') },
    invoiced: { color: 'purple', label: t('quoteEditor.statusInvoiced') },
    deposit: { color: 'gold', label: t('quoteEditor.statusDeposit') },
    ordered: { color: 'geekblue', label: t('quoteEditor.statusOrdered') },
  }

  // ⚠️ L'ÉDITEUR N'ÉCRIT QU'UN BROUILLON.
  //
  // Le serveur refuse en 409 (amsbm_document_locked) toute modification d'un
  // devis numéroté. L'écran, lui, ne gelait que deposit/invoiced/ordered : un
  // devis « envoyé » ou « accepté » restait modifiable en apparence, « Enregistrer »
  // restait actif, et la saisie repartait au néant sans autre explication.
  //
  // ⚠️ MAIS « attente validation » RESTE MODIFIABLE. Ce n'est qu'un brouillon
  // dont on a demandé la relecture (post_status DRAFT côté serveur) : le geler
  // interdirait à celui qui relit de corriger ce qu'il vient de lire, et le
  // rédacteur ne pourrait plus rien reprendre après avoir cliqué « Demande de
  // validation ». Le gel commence à « validé », là où le numéro est posé.
  const isLocked = !!quoteData && quoteData.status !== 'draft' && quoteData.status !== 'pending_validation'

  // Les statuts que le moteur pose lui-même ne se choisissent pas à la main :
  // sur ceux-là seulement, le tag cesse d'être déroulant. Un devis envoyé, lui,
  // reste figé quant à son contenu mais doit pouvoir passer à « accepté ».
  const isAutoStatus =
    quoteData?.status === 'deposit' || quoteData?.status === 'invoiced' || quoteData?.status === 'ordered'
  const hasDeal = !!quoteData?.deal_id

  // ⚠️ LE MENU SUIT LE PROCESSUS, PAS LA LISTE DES STATUTS.
  //
  // Les entrées étaient offertes en toutes circonstances : sur un devis refusé,
  // « Annulé » partait en 409 et « Brouillon » en 400, avec pour seule
  // explication « Erreur lors de la mise à jour du statut ». On ne propose donc
  // QUE ce que Documents::changeStatus() et la machine à états
  // (PostStatuses::transitions) acceptent depuis l'état courant :
  //
  //   brouillon           → attente validation, validé, annulé
  //   attente validation  → validé, brouillon, annulé
  //   validé              → envoyé, brouillon, annulé
  //   envoyé              → brouillon, accepté, refusé, annulé
  //   accepté             → annulé, et rien d'autre
  //
  // Deux absences volontaires :
  //  - « accepté » ne s'atteint QUE depuis « envoyé ». Un devis accepté avant
  //    d'être parti chez le client n'a pas de sens, et le serveur le validerait
  //    au passage sans que personne l'ait demandé.
  //  - « brouillon » n'est plus offert depuis « accepté », « refusé » ou
  //    « facturé » : reopen() n'y consent pas, et le refus n'expliquait rien.
  //
  // Le retour en brouillon, lui, CONSERVE le numéro (voir DocumentService::reopen)
  // et efface la demande de validation comme la marque d'envoi : le devis devra
  // être revalidé, puis renvoyé.
  const transitionsParStatut: Record<string, string[]> = {
    draft: ['pending_validation', 'validated', 'cancelled'],
    pending_validation: ['validated', 'draft', 'cancelled'],
    validated: ['sent', 'draft', 'cancelled'],
    sent: ['draft', 'accepted', 'refused', 'cancelled'],
    // Mêmes suites qu'« envoyé » : la consultation ne change pas ce qu'on peut
    // faire du devis, elle change ce qu'on sait de lui.
    consulted: ['draft', 'accepted', 'refused', 'cancelled'],
    accepted: ['cancelled'],
    refused: [],
    cancelled: [],
    deposit: [],
    invoiced: [],
    ordered: [],
  }

  const statusMenuItems = (transitionsParStatut[quoteData?.status || 'draft'] || []).map((key) => ({
    key,
    label: statusConfig[key]?.label || key,
  }))

  const handleStatusChange = async (status: string) => {
    // Block manual selection of deposit/invoiced/ordered statuses
    if (status === 'deposit' || status === 'invoiced' || status === 'ordered') {
      message.warning(t('quoteEditor.statusAutoWarning'))
      return
    }
    // Block status change if quote has a deal
    if (hasDeal) {
      message.warning(t('quoteEditor.statusDealWarning'))
      return
    }
    if (currentQuoteId) {
      // ⚠️ CE QUI SE FIGE DOIT ÊTRE CE QU'ON A SOUS LES YEUX.
      //
      // Valider numérote le devis et en scelle le contenu : la saisie non
      // enregistrée serait alors perdue pour de bon, l'écran continuant de
      // l'afficher. On enregistre donc d'abord — et si l'enregistrement est
      // refusé (date de validité, remise, 409…), ON NE CHANGE PAS LE STATUT :
      // sceller par-dessus un refus était le pire des deux mondes.
      //
      // Sur un devis déjà numéroté l'enregistrement serait de toute façon
      // refusé en 409 : on ne le tente que tant qu'il s'écrit.
      if (!isLocked && (status === 'validated' || status === 'sent' || status === 'accepted')) {
        const enregistre = await handleSave()

        if (!enregistre) return
      }

      updateStatusMutation.mutate({ id: currentQuoteId, status })
    }
  }

  // Send by email modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailPublicLink, setEmailPublicLink] = useState('')

  const handleSendByEmail = () => {
    if (!quoteData) return
    setEmailRecipient(selectedClient?.email || '')
    setEmailMessage('')
    setEmailPublicLink('')
    setEmailModalOpen(true)
  }

  const handleEmailConfirm = async () => {
    if (!currentQuoteId) return
    if (!emailRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRecipient)) {
      message.error(t('quoteEditor.invalidEmail'))
      return
    }
    setEmailLoading(true)
    try {
      const res = await quoteAPI.sendEmail(currentQuoteId, emailRecipient, emailMessage)
      setEmailPublicLink(res.data?.public_link || '')
      message.success(t('quoteEditor.emailSentToClient'))
      // Refresh quote (status sent + public_token)
      //
      // ⚠️ ET LA LISTE AVEC. Envoyer fait passer le devis de « validé » à
      // « envoyé » (Documents::sendEmail pose la marque d'envoi) : la liste,
      // elle, gardait « Validé » jusqu'à sa relecture — on ne savait plus ce
      // qui était réellement parti chez le client.
      invalidateQuoteQueries()
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
    } catch (err: unknown) {
      message.error(serverMessage(err) || t('quoteEditor.sendError'))
    } finally {
      setEmailLoading(false)
    }
  }

  const handleCopyPublicLink = async () => {
    if (!emailPublicLink) return
    try {
      await navigator.clipboard.writeText(emailPublicLink)
      message.success(t('quoteEditor.linkCopied'))
    } catch {
      message.error(t('quoteEditor.linkCopyError'))
    }
  }

  // State for deposit modal
  const [depositModalOpen, setDepositModalOpen] = useState(false)
  const [depositPercent, setDepositPercent] = useState(30)
  const [depositLoading, setDepositLoading] = useState(false)
  const [invoicingInfo, setInvoicingInfo] = useState<{
    deposit_percent: number
    available_percent: number
    deposit_invoiced_ht: number
    can_create_deposit: boolean
  } | null>(null)
  const [invoicingInfoLoading, setInvoicingInfoLoading] = useState(false)

  // Create deposit invoice
  const handleCreateDepositInvoice = async () => {
    if (!documentId || !quoteData) return

    // Fetch invoicing info first
    setInvoicingInfoLoading(true)
    try {
      const response = await quoteAPI.getInvoicingInfo(documentId)
      const info = response.data
      setInvoicingInfo(info)

      // Check if we can create deposit
      if (!info.can_create_deposit) {
        if (info.available_percent <= 0) {
          message.warning(t('quoteEditor.alreadyFullyInvoiced'))
          return
        }
        message.warning(t('quoteEditor.mustBeAcceptedForDeposit'))
        return
      }

      // Set default percent to remaining available or 30%, whichever is smaller
      setDepositPercent(Math.min(30, info.available_percent))
      setDepositModalOpen(true)
    } catch (err) {
      message.error(t('quoteEditor.invoicingInfoError'))
    } finally {
      setInvoicingInfoLoading(false)
    }
  }

  const handleConfirmDeposit = async () => {
    if (!documentId || !quoteData) return
    setDepositLoading(true)
    try {
      const response = await quoteAPI.createDepositInvoice(documentId, depositPercent)
      message.success(t('quoteEditor.depositInvoiceCreated', { percent: depositPercent }))
      setDepositModalOpen(false)
      invalidateQuoteQueries()
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      // Open the created invoice in a new tab
      if (response?.data?.id) {
        openDocumentTab('invoice', response.data.id, `${t('quoteEditor.invoice')} ${response.data.number || ''}`)
      }
    } catch (err: unknown) {
      message.error(serverMessage(err) || t('quoteEditor.depositInvoiceError'))
    } finally {
      setDepositLoading(false)
    }
  }

  // Create full invoice from quote
  const handleCreateInvoice = () => {
    if (!documentId || !quoteData) return
    Modal.confirm({
      title: t('quoteEditor.invoiceThisQuote'),
      content: (
        <div>
          <p>{t('quoteEditor.confirmCreateInvoice')}</p>
          <p style={{ marginTop: 8 }}>
            <strong>{t('quoteEditor.amountHT')}</strong> {quoteData.total_ht?.toFixed(2)} €
          </p>
          <p>
            <strong>{t('quoteEditor.amountTTC')}</strong> {quoteData.total_ttc?.toFixed(2)} €
          </p>
          {linkedInvoicesData?.data?.length > 0 && (
            <p style={{ marginTop: 8, color: '#fa8c16' }}>
              {t('quoteEditor.depositDeductedNote')}
            </p>
          )}
        </div>
      ),
      okText: t('quoteEditor.createInvoice'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const response = await quoteAPI.convert(documentId)
          message.success(t('quoteEditor.invoiceCreatedFromQuote'))
          invalidateQuoteQueries()
          queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
          queryClient.invalidateQueries({ queryKey: ['invoices'] })
          // Open the created invoice in a new tab
          if (response?.data?.id) {
            openDocumentTab('invoice', response.data.id, `${t('quoteEditor.invoice')} ${response.data.number || ''}`)
          }
        } catch (err: unknown) {
          message.error(serverMessage(err) || t('quoteEditor.invoiceCreateError'))
        }
      },
    })
  }

  // Create deal from quote
  const handleCreateDeal = async () => {
    if (!documentId || !quoteData) return
    try {
      // Call API to create deal from quote
      const response = await quoteAPI.createDeal(documentId)
      message.success(t('quoteEditor.dealCreatedFromQuote'))
      // Refresh quote data to show new status and linked deal
      queryClient.invalidateQueries({ queryKey: ['quote', currentQuoteId] })
      // Open the deal in a new tab
      if (response?.data?.id) {
        openDocumentTab('deal', response.data.id, `${t('quoteEditor.deal')} ${response.data.name || ''}`)
      }
    } catch (err: unknown) {
      message.error(serverMessage(err) || t('quoteEditor.dealCreateError'))
    }
  }

  // Open client tab
  const handleOpenClient = () => {
    const clientId = form.getFieldValue('client_id')
    if (clientId) {
      const client = clientsData?.data?.find((c: Client) => c.id === clientId)
      openDocumentTab('client', clientId, client ? `${t('quoteEditor.client')} ${client.name}` : t('quoteEditor.client'))
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
      const duplicatedLine: QuoteLine = {
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

  // ⚠️ REND CE QUI S'EST PASSÉ, ET NON « rien ».
  //
  // L'enregistrement automatique qui précède un changement de statut avait
  // besoin de savoir si la saisie était bien partie : la fonction avalait ses
  // refus (validation du formulaire, remise impossible, 409 du serveur) et
  // rendait undefined dans tous les cas. On validait donc un devis dont
  // l'enregistrement venait d'échouer — et c'est le CONTENU FIGÉ qui partait
  // au client. Le booléen dit « écrit » ou « pas écrit ».
  const handleSave = async (): Promise<boolean> => {
    try {
      await form.validateFields()

      // ⚠️ UN DEVIS NE PEUT PAS EXPIRER AVANT D'ÊTRE ÉMIS.
      //
      // Rien ne s'y opposait : « Devis créé avec succès », et la liste
      // affichait une validité au 01/01/2020 pour un devis daté du 16/08/2026.
      // Un tel devis est périmé à la seconde où il naît — la page publique
      // répond 410 au client qui suit le lien du courriel.
      const dateEmission = form.getFieldValue('date')
      const dateValidite = form.getFieldValue('validity_date')

      if (dateEmission && dateValidite && dateValidite.isBefore(dateEmission, 'day')) {
        message.error(
          t(
            'quoteEditor.validityBeforeDate',
            "La date de validité ne peut pas précéder la date d'émission du devis."
          )
        )
        return false
      }

      // ⚠️ UNE SAISIE FAUTIVE SE REFUSE, ELLE NE SE RECTIFIE PAS EN SILENCE.
      //
      // Les champs de ligne étaient bornés par antd, qui ramène la valeur dans
      // l'intervalle SANS RIEN DIRE : une quantité de 0 devenait 0,001 — une
      // ligne à 0,01 € qui passe inaperçue —, une quantité de −5 aussi, un prix
      // de −10 devenait 0,00 et une remise de 150 % devenait 100 %. L'utilisateur
      // croyait sa saisie prise en compte. Les bornes sont parties des champs :
      // ce sont ces trois refus, et le serveur derrière eux, qui font foi.
      const ligneFautive = lines.find(
        (line) =>
          line.line_type === 'article' &&
          ((line.quantity ?? 0) < 0 ||
            (line.unit_price ?? 0) < 0 ||
            (line.discount_percent ?? 0) < 0 ||
            (line.discount_percent ?? 0) > 100)
      )

      if (ligneFautive) {
        message.error(
          t(
            'quoteEditor.lineOutOfRange',
            'Une ligne porte une valeur impossible : la quantité et le prix ne peuvent pas être négatifs, et la remise se situe entre 0 et 100 %.'
          )
        )
        return false
      }

      // ⚠️ UNE REMISE NE PEUT PAS DÉPASSER CE QU'ELLE REMISE.
      //
      // En euros, aucun plafond : 500 € de remise sur un devis de 100 € HT
      // affichaient « Net HT -400,00 € », « TVA -68,00 € », « Total TTC
      // -468,00 € » — un devis à montant négatif. Le plafond existait déjà pour
      // la remise en %, ramenée à 100. On refuse, on ne rectifie pas en douce.
      if (
        globalDiscountType === 'amount' &&
        globalDiscountValue > totals.totalSaleHTBeforeDiscount
      ) {
        message.error(
          t(
            'quoteEditor.discountTooLarge',
            'La remise globale dépasse le montant du devis : elle ne peut pas le rendre négatif.'
          )
        )
        return false
      }

      // ⚠️ getFieldsValue() NE REND QUE LES CHAMPS DÉCLARÉS.
      //
      // « payment_terms » n'a pas de Form.Item : le sélecteur « Condition de
      // paiement » pose sa valeur par form.setFieldValue(). Elle vivait donc
      // dans le magasin du formulaire sans jamais sortir d'ici, et le choix de
      // l'utilisateur partait à la corbeille à chaque enregistrement — case
      // vide au rechargement, « Condition paiement : - » sur le PDF. Le drapeau
      // rend le magasin entier.
      const values = form.getFieldsValue(true)
      const data = {
        client_id: values.client_id,
        // ⚠️ UNE DATE DE DEVIS EST UN JOUR, PAS UN INSTANT.
        //
        // toISOString() ramène l'heure locale à UTC : à Paris, le 16/08 à minuit
        // partait en « 2026-08-15T22:00:00Z », et le serveur, qui découpe le jour
        // en UTC, enregistrait le 15. La date du devis et sa validité reculaient
        // d'un jour à chaque enregistrement — donc aussi la péremption du lien
        // public. On envoie le jour civil tel que l'utilisateur l'a choisi.
        date: values.date?.format('YYYY-MM-DD'),
        validity_date: values.validity_date?.format('YYYY-MM-DD'),
        subject: values.subject || '',
        notes: values.notes || '',
        delivery_address: values.delivery_address || '',
        footer_content: values.footer_content || '',
        payment_terms: values.payment_terms || '',
        discount_percent: globalDiscountType === 'percent' ? globalDiscountValue : 0,
        discount_amount: globalDiscountType === 'amount' ? globalDiscountValue : 0,
        lines: lines
          // ⚠️ UNE LIGNE SAISIE À LA MAIN EST UNE LIGNE.
          //
          // Le filtre exigeait une référence article : la ligne libre — une
          // prestation décrite à la main, sans article au catalogue — était
          // jetée à l'enregistrement sans un mot. L'écran annonçait
          // « Devis créé avec succès » sur un devis amputé de 100 €, et le
          // client recevait ce montant-là. Le serveur accepte parfaitement une
          // ligne sans article ; ce qu'il écarte, c'est une ligne sans libellé.
          // On filtre donc sur le libellé, comme lui.
          .filter((line) => (line.description || '').trim() !== '')
          .map((line, index) => ({
            line_type: line.line_type,
            article_id: line.article_id || null,
            description: line.description || '',
            quantity: line.line_type === 'article' ? line.quantity : 0,
            unit_price: line.line_type === 'article' ? line.unit_price : 0,
            discount_percent: line.line_type === 'article' ? (line.discount_percent || 0) : 0,
            tva_rate: line.line_type === 'article' ? (line.vat_rate ?? defaultVatRate) : 0,
            position: index + 1,
          })),
      }

      if (currentQuoteId) {
        await updateMutation.mutateAsync({ id: currentQuoteId, data })
      } else {
        await createMutation.mutateAsync(data)
      }

      return true
    } catch (error) {
      console.error('Validation error:', error)

      return false
    }
  }

  const handleDownloadPdf = async () => {
    if (!currentQuoteId) return
    try {
      const response = await quoteAPI.getPdf(currentQuoteId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${t('quoteEditor.quote')}-${quoteData?.number || t('quoteEditor.new')}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('quoteEditor.pdfDownloaded'))
    } catch {
      message.error(t('quoteEditor.pdfDownloadError'))
    }
  }

  const handlePreviewPdf = async () => {
    if (!currentQuoteId) return
    setPdfPreviewLoading(true)
    setPdfPreviewOpen(true)

    try {
      const response = await quoteAPI.getPdf(currentQuoteId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
    } catch {
      message.error(t('quoteEditor.pdfLoadError'))
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
      render: (_: unknown, record: QuoteLine) => <DragHandle id={record.key} />,
    },
    {
      title: t('quoteEditor.colRef'),
      dataIndex: 'article_id',
      key: 'article_id',
      width: columnWidths.article_id,
      onHeaderCell: () => ({
        width: columnWidths.article_id,
        onResize: handleColumnResize('article_id'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        return (
          <Select
            showSearch
            placeholder={t('quoteEditor.colRef')}
            optionFilterProp="label"
            loading={isLoadingArticles}
            value={record.article_id}
            onChange={(value) => handleArticleSelect(value, record.key)}
            disabled={isLocked}
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
      title: t('common.description'),
      dataIndex: 'description',
      key: 'description',
      width: columnWidths.description,
      onHeaderCell: () => ({
        width: columnWidths.description,
        onResize: handleColumnResize('description'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type === 'text') {
          return (
            <Input.TextArea
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('quoteEditor.freeTextPlaceholder')}
              disabled={isLocked}
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
              {t('quoteEditor.pageBreakLabel')}
            </div>
          )
        }
        if (record.line_type === 'subtotal') {
          return (
            <Input
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('quoteEditor.subtotalLabel')}
              disabled={isLocked}
              style={{ fontWeight: 'bold' }}
            />
          )
        }
        return (
          <Input
            value={record.description}
            onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
            placeholder={t('common.description')}
            disabled={isLocked}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colQty')}</div>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right' as const,
      width: columnWidths.quantity,
      onHeaderCell: () => ({
        width: columnWidths.quantity,
        onResize: handleColumnResize('quantity'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.quantity}
            onChange={(value) => handleLineChange(record.key, 'quantity', value ?? 0)}
            disabled={isLocked}
            precision={3}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colUnit')}</div>,
      dataIndex: 'unit',
      key: 'unit',
      align: 'center' as const,
      width: 60,
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        return <span style={{ color: '#888' }}>{record.unit || 'U.'}</span>
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colPurchasePrice')}</div>,
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      align: 'right' as const,
      width: columnWidths.purchase_price,
      onHeaderCell: () => ({
        width: columnWidths.purchase_price,
        onResize: handleColumnResize('purchase_price'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        // Get the original article price from database
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.purchase_price || 0
        return (
          <InputNumber
            value={record.purchase_price}
            onChange={(value) => handleLineChange(record.key, 'purchase_price', value || 0)}
            disabled={isLocked}
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
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colCoef')}</div>,
      dataIndex: 'coefficient',
      key: 'coefficient',
      align: 'right' as const,
      width: columnWidths.coefficient,
      onHeaderCell: () => ({
        width: columnWidths.coefficient,
        onResize: handleColumnResize('coefficient'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.coefficient}
            onChange={(value) => handleLineChange(record.key, 'coefficient', value || 1)}
            disabled={isLocked}
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
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colSalePrice')}</div>,
      dataIndex: 'unit_price',
      key: 'unit_price',
      align: 'right' as const,
      width: columnWidths.unit_price,
      onHeaderCell: () => ({
        width: columnWidths.unit_price,
        onResize: handleColumnResize('unit_price'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        // Get the original article sale price from database
        const article = articlesData?.data?.find((a: Article) => a.id === record.article_id)
        const originalPrice = article?.sale_price || 0
        return (
          <InputNumber
            value={record.unit_price}
            onChange={(value) => handleLineChange(record.key, 'unit_price', value || 0)}
            disabled={isLocked}
            onBlur={() => {
              // Compare current line price with original article price
              if (record.article_id && record.unit_price !== originalPrice) {
                handleSalePriceChange(record.key, record.unit_price)
              }
            }}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colDiscount')}</div>,
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      align: 'right' as const,
      width: columnWidths.discount_percent,
      onHeaderCell: () => ({
        width: columnWidths.discount_percent,
        onResize: handleColumnResize('discount_percent'),
      }),
      render: (_: unknown, record: QuoteLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value ?? 0)}
            disabled={isLocked}
            precision={1}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colVat')}</div>,
      dataIndex: 'vat_rate',
      key: 'vat_rate',
      align: 'right' as const,
      width: columnWidths.vat_rate,
      onHeaderCell: () => ({
        width: columnWidths.vat_rate,
        onResize: handleColumnResize('vat_rate'),
      }),
      render: (_: unknown, record: QuoteLine) => {
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
            disabled={isLocked}
            options={options}
            style={{ width: '100%', textAlign: 'right' }}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('quoteEditor.colTotalHT')}</div>,
      key: 'total',
      align: 'right' as const,
      width: columnWidths.total,
      onHeaderCell: () => ({
        width: columnWidths.total,
        onResize: handleColumnResize('total'),
      }),
      render: (_: unknown, record: QuoteLine, index: number) => {
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
      render: (_: unknown, record: QuoteLine) => (
        <Space size="small">
          <Tooltip title={t('quoteEditor.duplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleDuplicateLine(record.key)}
              disabled={isLocked}
            />
          </Tooltip>
          <Tooltip title={t('common.delete')}>
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

  // ⚠️ « NEUF » CESSE DE L'ÊTRE DÈS QU'IL EST ENREGISTRÉ : la condition portait
  // sur l'identifiant venu de l'onglet, pas sur celui obtenu à la création.
  // Après « Devis créé », l'en-tête gardait « Nouveau devis » et l'étiquette de
  // statut n'apparaissait pas — impossible de valider dans la foulée.
  const isNewQuote = !currentQuoteId
  const _isDraft = quoteData?.status === 'draft' || isNewQuote
  void _isDraft

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
            {isNewQuote ? t('quoteEditor.newQuote') : `${t('quoteEditor.quote')} ${quoteData?.number || ''}`}
          </h2>
          {currentQuoteId && quoteData && (
            // Une étiquette qui s'ouvre sur un menu vide n'apprend rien : sur un
            // devis sans transition possible, elle redevient une simple étiquette.
            isAutoStatus || statusMenuItems.length === 0 ? (
              <Tag
                color={statusConfig[quoteData.status]?.color || 'default'}
                style={{ fontSize: 14, padding: '4px 12px' }}
              >
                {statusConfig[quoteData.status]?.label || quoteData.status}
              </Tag>
            ) : (
              <Dropdown
                menu={{
                  items: statusMenuItems,
                  onClick: ({ key }) => handleStatusChange(key),
                  selectedKeys: [quoteData.status],
                }}
                trigger={['click']}
              >
                <Tag
                  color={statusConfig[quoteData.status]?.color || 'default'}
                  style={{ cursor: 'pointer', fontSize: 14, padding: '4px 12px' }}
                >
                  {statusConfig[quoteData.status]?.label || quoteData.status} <DownOutlined />
                </Tag>
              </Dropdown>
            )
          )}
          {/* ⚠️ DIRE POURQUOI RIEN NE S'ÉCRIT — MAIS COURT.
              Un devis figé s'ouvre encore par double-clic depuis la liste ; ses
              champs sont bien éteints, et rien ne l'expliquait. La phrase
              complète, elle, poussait l'en-tête hors de l'écran et tronquait le
              numéro du devis : l'explication chassait ce qu'elle accompagnait.
              L'étiquette dit l'essentiel, l'infobulle dit le reste. */}
          {isLocked && (
            <Tooltip
              title={t(
                'quoteEditor.lockedHelp',
                "Ce devis est figé : ses montants, son tiers et son numéro ne se modifient plus. Repassez-le en brouillon pour le corriger."
              )}
            >
              <Tag icon={<LockOutlined />} color="warning">
                {t('quoteEditor.lockedShort', 'Non modifiable')}
              </Tag>
            </Tooltip>
          )}
        </Space>
        <Space>
          {/* ⚠️ LE BOUTON N'EXISTE QUE POUR CELUI QUI NE PEUT PAS VALIDER.
              Chez le responsable, il ferait doublon avec « Validé » du menu de
              statut — et lui ferait s'envoyer un courriel à lui-même. Il ne
              paraît que tant que le devis s'écrit (brouillon ou attente
              validation) : au-delà, la route répond « Ce document est déjà
              validé. » */}
          {currentQuoteId &&
            droitsConnus &&
            !peutValider &&
            (quoteData?.status === 'draft' || quoteData?.status === 'pending_validation') && (
              <Tooltip
                title={t(
                  'quoteEditor.requestValidationHelp',
                  'Prévient par courriel les personnes qui ont le droit de valider, et place le devis en attente de validation.'
                )}
              >
                <Button
                  icon={<AuditOutlined />}
                  loading={requestValidationMutation.isPending}
                  // ⚠️ ON ENREGISTRE AVANT DE PRÉVENIR. Le responsable ouvrira
                  // le devis TEL QU'IL EST EN BASE : demander la relecture d'une
                  // saisie restée dans l'écran lui aurait fait valider l'ancienne
                  // version. Si l'enregistrement est refusé, aucun courriel ne
                  // part — handleSave a déjà dit pourquoi.
                  onClick={async () => {
                    const enregistre = await handleSave()

                    if (enregistre) requestValidationMutation.mutate(currentQuoteId)
                  }}
                >
                  {t('quoteEditor.requestValidation', 'Demande de validation')}
                </Button>
              </Tooltip>
            )}
          {currentQuoteId && (
            <>
              <Button icon={<MailOutlined />} onClick={handleSendByEmail}>
                {t('quoteEditor.sendByEmail')}
              </Button>
              <Button icon={<FileSearchOutlined />} onClick={handlePreviewPdf}>
                {t('quoteEditor.viewPdf')}
              </Button>
              <Button icon={<FilePdfOutlined />} onClick={handleDownloadPdf}>
                {t('quoteEditor.downloadPdf')}
              </Button>
            </>
          )}
          {(quoteData?.status === 'accepted' || quoteData?.status === 'deposit') && currentQuoteId && !hasDeal && (
            <>
              <Button icon={<EuroOutlined />} onClick={handleCreateDepositInvoice} loading={invoicingInfoLoading}>
                {t('quoteEditor.invoiceDeposit')}
              </Button>
              <Button icon={<FileTextOutlined />} onClick={handleCreateInvoice} type="primary" ghost>
                {t('quoteEditor.invoiceThisQuote')}
              </Button>
            </>
          )}
          {currentQuoteId && quoteData?.status === 'accepted' && !hasDeal && (
            <Button icon={<FolderOpenOutlined />} onClick={handleCreateDeal}>
              {t('quoteEditor.generateDeal')}
            </Button>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={createMutation.isPending || updateMutation.isPending}
            disabled={isLocked}
          >
            {t('common.save')}
          </Button>
        </Space>
      </div>

      {/* Form Content */}
      <div style={{ flex: 1 }}>
        <div style={{ padding: '24px', paddingBottom: 80 }}>
        {/* setFieldsValue ne déclenche pas onValuesChange : le chargement du
            devis ne marque donc pas l'onglet modifié, seule la frappe le fait. */}
        <Form form={form} layout="vertical" onValuesChange={() => setTabDirty(tabId, true)}>
          <Row gutter={24}>
            <Col span={6}>
              <Form.Item
                label={t('quoteEditor.client')}
                required
                validateStatus={!selectedClient && form.isFieldTouched('client_id') ? 'error' : ''}
                help={!selectedClient && form.isFieldTouched('client_id') ? t('quoteEditor.selectClient') : ''}
              >
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder={isLoadingClients ? t('common.loading') : t('quoteEditor.selectClient')}
                    optionFilterProp="label"
                    loading={isLoadingClients}
                    value={selectedClient?.id}
                    onChange={handleClientChange}
                    disabled={isLocked}
                    options={(() => {
                      const options: Array<{ value: string; label: string }> = (
                        clientsData?.data || []
                      ).map((c: Client) => ({
                        value: c.id,
                        label: `${c.code} - ${c.name}`,
                      }))
                      // Ant Design n'affiche que ce qu'il trouve dans les
                      // options : un client absent de la liste laisserait la
                      // case vide alors qu'il est bien sur le devis.
                      if (selectedClient && !options.some((o) => o.value === selectedClient.id)) {
                        options.unshift({
                          value: selectedClient.id,
                          label: `${selectedClient.code} - ${selectedClient.name}`,
                        })
                      }
                      return options
                    })()}
                    style={{ flex: 1 }}
                  />
                  <Tooltip title={t('quoteEditor.openClientCard')}>
                    <Button
                      icon={<SearchOutlined />}
                      onClick={handleOpenClient}
                      disabled={!selectedClient}
                    />
                  </Tooltip>
                </Space.Compact>
              </Form.Item>
              {/* Hidden field to store client_id for form validation.
                  ⚠️ Sans message explicite, antd compose le sien avec le NOM
                  TECHNIQUE du champ : « Le champ client_id est obligatoire »
                  s'affichait sous le sélecteur, à côté d'un « L'objet est
                  obligatoire » correctement rédigé. */}
              <Form.Item
                name="client_id"
                hidden
                rules={[{ required: true, message: t('quoteEditor.clientRequired', 'Le client est obligatoire') }]}
              >
                <Input />
              </Form.Item>
              {/* Link to associated deal */}
              {quoteData?.deal_id && (
                <div style={{ marginTop: -16, marginBottom: 16 }}>
                  <Button
                    type="link"
                    icon={<FolderOpenOutlined />}
                    onClick={() => openDocumentTab('deal', quoteData.deal_id!, `${t('quoteEditor.deal')} ${quoteData.deal?.number || ''}`)}
                    style={{ padding: 0, height: 'auto' }}
                  >
                    {t('quoteEditor.linkedDeal')}: {quoteData.deal?.number || quoteData.deal_id}
                  </Button>
                </div>
              )}
            </Col>
            <Col span={6}>
              <Form.Item label={t('quoteEditor.billingAddress')}>
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
              <Form.Item name="delivery_address" label={t('quoteEditor.deliveryAddress')}>
                <Input.TextArea
                  rows={5}
                  placeholder={t('quoteEditor.deliveryAddressPlaceholder')}
                  disabled={isLocked}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item
                    name="date"
                    label={t('common.date')}
                    rules={[{ required: true, message: t('quoteEditor.dateRequired') }]}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={isLocked} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="validity_date"
                    label={t('quoteEditor.validity')}
                    rules={[{ required: true, message: t('quoteEditor.dateRequired') }]}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={isLocked} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t('quoteEditor.paymentTerm')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('quoteEditor.selectPaymentTerm')}
                  value={selectedPaymentTermId}
                  disabled={isLocked}
                  onChange={(value) => {
                    setSelectedPaymentTermId(value)
                    if (value) {
                      const term = paymentTermsData?.payment_terms?.find((pt: PaymentTerm) => pt.id === value)
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
                      {term.label} ({term.days === 0 ? t('quoteEditor.cash') : `${term.days}${t('quoteEditor.daysSuffix')}`})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row>
            <Col span={24}>
              <Form.Item name="subject" label={t('quoteEditor.subject')} rules={[{ required: true, message: t('quoteEditor.subjectRequired') }]}>
                <Input placeholder={t('quoteEditor.subjectPlaceholder')} disabled={isLocked} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{t('quoteEditor.quoteLines')}</span>
          <Space size="middle">
            {selectedRowKeys.length > 0 && !isLocked && (
              <>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelection}
                  danger
                >
                  {t('common.delete')} ({selectedRowKeys.length})
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleDuplicateSelection}
                >
                  {t('quoteEditor.duplicate')} ({selectedRowKeys.length})
                </Button>
              </>
            )}
            <Button
              icon={<PlusOutlined />}
              onClick={() => handleAddLine('article')}
              disabled={isLocked}
              style={{ backgroundColor: '#1677ff', borderColor: '#1677ff', color: '#fff' }}
            >
              {t('quoteEditor.lineArticle')}
            </Button>
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleAddLine('text')}
              disabled={isLocked}
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
            >
              {t('quoteEditor.lineText')}
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => handleAddLine('subtotal')}
              disabled={isLocked}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('quoteEditor.lineSubtotal')}
            </Button>
            <Button
              icon={<MinusOutlined />}
              onClick={() => handleAddLine('page_break')}
              disabled={isLocked}
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
            >
              {t('quoteEditor.linePageBreak')}
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

        <Form form={form} onValuesChange={() => setTabDirty(tabId, true)}>
          <Form.Item name="notes" label={t('quoteEditor.notes')}>
            <Input.TextArea rows={3} placeholder={t('quoteEditor.notesPlaceholder')} disabled={isLocked} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label={t('quoteEditor.footer')}>
                <Select
                  allowClear
                  placeholder={t('quoteEditor.selectFooter')}
                  value={selectedFooterId}
                  disabled={isLocked}
                  onChange={(footerId) => {
                    setSelectedFooterId(footerId || null)
                    const footer = footers.find((f) => f.id === footerId)
                    if (footer) {
                      form.setFieldValue('footer_content', footer.content)
                    } else {
                      form.setFieldValue('footer_content', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {footers.map((footer) => (
                    <Select.Option key={footer.id} value={footer.id}>
                      {footer.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="footer_content" label={t('quoteEditor.footerContent')}>
                <Input.TextArea
                  rows={3}
                  placeholder={t('quoteEditor.footerContentPlaceholder')}
                  disabled={isLocked}
                  onChange={() => setTabDirty(tabId, true)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        {/* Tabs: Factures liées et Documents liés */}
        {currentQuoteId && (
          <Tabs
            defaultActiveKey="invoices"
            items={[
              {
                key: 'invoices',
                label: t('quoteEditor.linkedInvoices'),
                children: (() => {
                  const invoices = linkedInvoicesData?.data || []
                  // Calculate totals for all invoices
                  const invoiceTotals = invoices.reduce(
                    (acc: { totalHT: number; totalTTC: number; totalSolde: number }, inv: { total_ht: number; total_ttc: number; paid_amount: number }) => ({
                      totalHT: acc.totalHT + (inv.total_ht || 0),
                      totalTTC: acc.totalTTC + (inv.total_ttc || 0),
                      totalSolde: acc.totalSolde + ((inv.total_ttc || 0) - (inv.paid_amount || 0)),
                    }),
                    { totalHT: 0, totalTTC: 0, totalSolde: 0 }
                  )
                  return (
                    <>
                      <div style={{ marginBottom: 10 }}>
                      <Table
                        dataSource={invoices}
                        columns={[
                          { title: t('quoteEditor.colNumber'), dataIndex: 'number', key: 'number', width: 120 },
                          { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100,
                            render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
                          { title: t('quoteEditor.subject'), dataIndex: 'subject', key: 'subject', width: 200,
                            render: (v: string) => v || '-', ellipsis: true },
                          { title: t('quoteEditor.amountHTShort'), dataIndex: 'total_ht', key: 'total_ht', width: 120, align: 'right' as const,
                            render: (v: number) => `${(v || 0).toFixed(2)} €` },
                          { title: t('quoteEditor.amountTTCShort'), dataIndex: 'total_ttc', key: 'total_ttc', width: 120, align: 'right' as const,
                            render: (v: number) => `${(v || 0).toFixed(2)} €` },
                          { title: t('quoteEditor.balance'), key: 'solde', width: 120, align: 'right' as const,
                            render: (_: unknown, record: { total_ttc: number; paid_amount: number }) => {
                              const solde = (record.total_ttc || 0) - (record.paid_amount || 0)
                              return <span style={{ color: solde > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 500 }}>{solde.toFixed(2)} €</span>
                            }
                          },
                          { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
                            render: (status: string) => {
                              const colors: Record<string, string> = { draft: 'default', sent: 'blue', paid: 'green', partial: 'orange', cancelled: 'red' }
                              const labels: Record<string, string> = {
                                draft: t('quoteEditor.invStatusDraft'),
                                sent: t('quoteEditor.invStatusSent'),
                                paid: t('quoteEditor.invStatusPaid'),
                                partial: t('quoteEditor.invStatusPartial'),
                                cancelled: t('quoteEditor.invStatusCancelled'),
                              }
                              return <Tag color={colors[status]}>{labels[status] || status}</Tag>
                            }
                          },
                        ]}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        locale={{ emptyText: t('quoteEditor.noLinkedInvoice') }}
                        onRow={(record) => ({
                          onDoubleClick: () => openDocumentTab('invoice', (record as Record<string, unknown>).id as string, `${t('quoteEditor.invoice')} ${(record as Record<string, unknown>).number}`),
                          style: { cursor: 'pointer' },
                        })}
                        summary={() => invoices.length > 0 ? (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: token.colorBgLayout, fontWeight: 600 }}>
                              <Table.Summary.Cell index={0} colSpan={3} align="right">
                                <strong>{t('quoteEditor.totals')}</strong>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3} align="right">
                                {invoiceTotals.totalHT.toFixed(2)} €
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={4} align="right">
                                {invoiceTotals.totalTTC.toFixed(2)} €
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={5} align="right">
                                <span style={{ color: invoiceTotals.totalSolde > 0 ? '#ff4d4f' : '#52c41a' }}>
                                  {invoiceTotals.totalSolde.toFixed(2)} €
                                </span>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6}></Table.Summary.Cell>
                            </Table.Summary.Row>
                          </Table.Summary>
                        ) : null}
                      />
                      </div>
                    </>
                  )
                })(),
              },
              {
                key: 'documents',
                label: t('quoteEditor.linkedDocuments'),
                children: <DocumentsSection entityType="quote" entityId={currentQuoteId} title="" />,
              },
              // ⚠️ Le suivi vaut surtout ICI. Sur un devis, la question n'est
              // jamais « qu'ai-je envoyé » mais « l'a-t-il ouvert, et quand
              // l'a-t-il signé » — et cette moitié-là ne se voyait nulle part.
              {
                key: 'suivi',
                label: t('quoteEditor.tabs.timeline', 'Suivi'),
                children: <SuiviDocument route="quotes" documentId={currentQuoteId} />,
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('quoteEditor.purchaseHT')}</div>
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
              {t('quoteEditor.margin')} ({totals.marginPercent}%)
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('quoteEditor.saleHT')}</div>
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>{t('quoteEditor.globalDiscount')}</div>
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('quoteEditor.netHT')}</div>
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
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{t('quoteEditor.globalVat')}</span>
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
              {t('quoteEditor.totalTTC')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
              {totals.totalTTC.toFixed(2)} €
            </div>
          </Card>
        </div>
      </div>
      </div>

      {/* Send by email modal */}
      <Modal
        title={<><MailOutlined /> {t('quoteEditor.sendQuoteByEmail')}</>}
        open={emailModalOpen}
        onCancel={() => setEmailModalOpen(false)}
        okText={emailPublicLink ? t('common.close') : t('quoteEditor.send')}
        cancelText={t('common.cancel')}
        confirmLoading={emailLoading}
        onOk={emailPublicLink ? () => setEmailModalOpen(false) : handleEmailConfirm}
        cancelButtonProps={emailPublicLink ? { style: { display: 'none' } } : undefined}
        destroyOnClose
      >
        {!emailPublicLink ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('quoteEditor.recipient')}</label>
              <Input
                type="email"
                value={emailRecipient}
                onChange={(e) => setEmailRecipient(e.target.value)}
                placeholder={t('quoteEditor.recipientPlaceholder')}
                prefix={<MailOutlined />}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('quoteEditor.customMessage')}</label>
              <Input.TextArea
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                rows={4}
                placeholder={t('quoteEditor.customMessagePlaceholder')}
              />
            </div>
            <div style={{ background: '#f0f5ff', padding: 12, borderRadius: 4, border: '1px solid #adc6ff', fontSize: 13 }}>
              {t('quoteEditor.emailInfoText')}
            </div>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div style={{ padding: 16, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
              <strong>{t('quoteEditor.emailSentTo', { recipient: emailRecipient })}</strong>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t('quoteEditor.publicLinkToShare')}</label>
              <Input.Group compact>
                <Input value={emailPublicLink} readOnly style={{ width: 'calc(100% - 100px)' }} />
                <Button type="primary" icon={<CopyOutlined />} onClick={handleCopyPublicLink} style={{ width: 100 }}>
                  {t('quoteEditor.copy')}
                </Button>
              </Input.Group>
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                {t('quoteEditor.publicLinkInfo')}
              </div>
            </div>
          </Space>
        )}
      </Modal>

      {/* PDF Preview Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 30 }}>
            <span>{t('quoteEditor.pdfPreview')} - {t('quoteEditor.quote')} {quoteData?.number || ''}</span>
            <Space size="small">
              <Button size="small" onClick={() => setModalSize({ width: 600, height: 60 })}>{t('quoteEditor.sizeSmall')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 900, height: 80 })}>{t('quoteEditor.sizeMedium')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: 1200, height: 90 })}>{t('quoteEditor.sizeLarge')}</Button>
              <Button size="small" onClick={() => setModalSize({ width: window.innerWidth - 100, height: 95 })}>{t('quoteEditor.sizeFullscreen')}</Button>
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
            onClick={handleDownloadPdf}
          >
            {t('quoteEditor.download')}
          </Button>,
        ]}
      >
        {pdfPreviewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p>{t('quoteEditor.loadingPdf')}</p>
          </div>
        ) : pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            style={{ width: '100%', height: `${modalSize.height}vh`, border: 'none' }}
            title={`${t('quoteEditor.quote')} ${quoteData?.number}`}
           
          />
        ) : null}
      </Modal>

      {/* Deposit Invoice Modal */}
      <Modal
        title={t('quoteEditor.invoiceDeposit')}
        open={depositModalOpen}
        onOk={handleConfirmDeposit}
        onCancel={() => setDepositModalOpen(false)}
        okText={t('quoteEditor.createInvoice')}
        cancelText={t('common.cancel')}
        confirmLoading={depositLoading}
        okButtonProps={{ disabled: depositPercent <= 0 || depositPercent > (invoicingInfo?.available_percent || 100) }}
      >
        <div>
          {invoicingInfo && invoicingInfo.deposit_percent > 0 && (
            <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, border: '1px solid #ffd591' }}>
              <p style={{ margin: 0, color: '#d48806' }}>
                <strong>{t('quoteEditor.depositAlreadyInvoiced')}</strong> {invoicingInfo.deposit_percent.toFixed(1)}% ({invoicingInfo.deposit_invoiced_ht.toFixed(2)} € HT)
              </p>
              <p style={{ margin: '4px 0 0 0', color: '#d48806' }}>
                <strong>{t('quoteEditor.available')}</strong> {invoicingInfo.available_percent.toFixed(1)}%
              </p>
            </div>
          )}
          <p>{t('quoteEditor.depositPercentPrompt')}</p>
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
            {t('quoteEditor.quoteAmountHT')} {quoteData?.total_ht?.toFixed(2)} €
          </p>
          <p style={{ color: '#1890ff', fontWeight: 'bold' }}>
            {t('quoteEditor.depositAmount')} {((quoteData?.total_ht || 0) * depositPercent / 100).toFixed(2)} € HT
          </p>
          {invoicingInfo && invoicingInfo.deposit_percent > 0 && (
            <p style={{ color: '#52c41a', fontWeight: 'bold' }}>
              {t('quoteEditor.totalInvoicedAfterDeposit')} {(invoicingInfo.deposit_percent + depositPercent).toFixed(1)}%
            </p>
          )}
        </div>
      </Modal>

      {/* Price Modification Modal (purchase or sale) */}
      <Modal
        title={priceModalData?.priceType === 'sale' ? t('quoteEditor.salePriceModification') : t('quoteEditor.purchasePriceModification')}
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
              {priceModalData.priceType === 'sale' ? t('quoteEditor.modifyingSalePrice') : t('quoteEditor.modifyingPurchasePrice')} <strong>{priceModalData.articleName}</strong>
            </p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, padding: 12, background: '#f5f5f5', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('quoteEditor.oldPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#ff4d4f', textDecoration: 'line-through' }}>
                  {priceModalData.oldPrice.toFixed(2)} €
                </div>
              </div>
              <div style={{ flex: 1, padding: 12, background: '#f6ffed', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('quoteEditor.newPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>
                  {priceModalData.newPrice.toFixed(2)} €
                </div>
              </div>
            </div>
            <p style={{ marginBottom: 16, color: '#666' }}>
              {t('quoteEditor.applyModificationPrompt')}
            </p>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                type="primary"
                block
                onClick={() => handlePriceModalConfirm(false)}
              >
                {t('quoteEditor.forThisDocumentOnly')}
              </Button>
              <Button
                type="default"
                block
                onClick={() => handlePriceModalConfirm(true)}
                loading={updateArticleMutation.isPending}
              >
                {t('quoteEditor.forThisDocumentAndArticle')}
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
                {t('common.cancel')}
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  )
}
