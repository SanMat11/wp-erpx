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
  Typography,
  theme,
  Popconfirm,
  Alert,
  Badge,
} from 'antd'
import type { AxiosError } from 'axios'
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  SearchOutlined,
  DownOutlined,
  MailOutlined,
  LockOutlined,
  AlignLeftOutlined,
  CalculatorOutlined,
  MinusOutlined,
  HolderOutlined,
  EyeOutlined,
  BankOutlined,
  CopyOutlined,
  RollbackOutlined,
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

import api, { invoiceAPI, supplierInvoiceAPI, clientAPI, supplierAPI, articleAPI, settingsAPI, bankAccountAPI } from '@/services/api'
import { useCanValidateDocuments, usePermissionsChargees, usePermissionStore } from '@/stores/permissionStore'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import DocumentsSection from '@/components/DocumentsSection'
import SuiviDocument from '@/components/SuiviDocument'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import { useColumnWidths } from '@/hooks/useColumnWidths'
import dayjs from 'dayjs'
// Le serveur date en UTC sans le dire : sans ce greffon, « 08:42 » du journal
// s'afficherait tel quel alors qu'il s'agit de 10:42 chez nous l'été.
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

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

interface Supplier {
  id: string
  code: string
  name: string
  address_line1?: string
  address_line2?: string
  postal_code?: string
  city?: string
  country?: string
  // Le délai de règlement de la fiche, en JOURS (Parties::toJson).
  payment_terms?: number
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

interface InvoiceLine {
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

interface Invoice {
  id: string
  number: string
  supplier_invoice_number?: string // Manual number for supplier invoices
  type: string // 'client', 'supplier', 'credit_note', 'deposit'
  client_id?: string
  supplier_id?: string
  client?: { id: string; name: string; code?: string; address?: string; email?: string }
  supplier?: { id: string; name: string; code?: string; address?: string; email?: string }
  quote_id?: string
  purchase_order_id?: string
  date: string
  due_date?: string
  status: string
  subject?: string
  notes?: string
  delivery_address?: string
  discount_percent?: number
  discount_amount?: number
  footer_id?: string
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
    // Le coût figé de la ligne, quand le serveur le rend.
    purchase_price?: number
  }>
  total_ht: number
  deposit_ht: number
  total_tva: number
  total_ttc: number
  /**
   * Le journal des consultations en ligne : à chaque fois que le client ouvre
   * la facture par son lien, le serveur note l'instant, l'adresse IP et une
   * empreinte du CONTENU. Servi seulement à la lecture d'une facture, jamais
   * dans les listes.
   */
  public_access_log?: AccessLogEntry[]
  /**
   * Ce qui empêchera de valider cette pièce, s'il y a quelque chose.
   *
   * Posé par le pont WooCommerce quand il trouve une facture ou un avoir faux —
   * un écart de TVA, un avoir qui ne retombe pas sur ses pieds. La validation le
   * refuse déjà ; ce champ existe pour le DIRE AVANT le clic, au lieu de laisser
   * l'erreur tomber sans explication. Servi seulement à la lecture d'une pièce.
   */
  blocked_reason?: string | null
}

/**
 * Une consultation de la facture par son lien public.
 *
 * ⚠️ L'empreinte ne porte PAS l'instant. Elle porte le numéro, les dates, le
 * tiers, chaque ligne et les totaux : deux consultations d'une facture inchangée
 * donnent donc la MÊME empreinte, et c'est précisément ce qui prouve que le
 * document n'a pas bougé entre les deux. Une empreinte qui changerait à chaque
 * ouverture ne prouverait rien du tout.
 */
interface AccessLogEntry {
  viewed_at: string
  ip: string
  user_agent: string
  content_hash: string
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

interface InvoicePayment {
  id: string
  bank_account_id: string | null
  account_label: string
  account_number: string
  date: string
  payment_date: string
  amount: number
  fee: number
  net_amount: number
  gateway: string
  method: string
  method_label: string
  label: string
  reference: string
  notes: string
}

interface InvoiceEditorProps {
  tabId: string
  documentId?: string
  invoiceType?: 'client' | 'supplier' // For new invoices, specify type
}

export default function InvoiceEditor({ tabId, documentId, invoiceType = 'client' }: InvoiceEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { updateTabTitle, setTabDirty, openDocumentTab, getTab } = useDocumentTabsStore()
  const { primaryColor } = useThemeStore()
  const { sidebarWidth } = useSidebarStore()
  const { token } = theme.useToken()
  const [form] = Form.useForm()
  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  // Get metadata from tab (for deal-linked invoices)
  const tabMetadata = getTab(tabId)?.type === 'document' ? (getTab(tabId) as { metadata?: Record<string, unknown> })?.metadata : undefined
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [modalSize, setModalSize] = useState({ width: 900, height: 80 })
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailAddress, setEmailAddress] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null)
  const [globalDiscountType, setGlobalDiscountType] = useState<'percent' | 'amount'>('percent')
  const [globalDiscountValue, setGlobalDiscountValue] = useState<number>(0)
  // Doublon de numéro fournisseur détecté à la saisie — voir verifierDoublon().
  const [doublonFournisseur, setDoublonFournisseur] = useState<{
    internal_number?: string
    created_at?: string
  } | null>(null)
  // Saisie d'un règlement — voir addPaymentMutation.
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  // ⚠️ Le tiers manquant ne se signalait qu'une fois le champ TOUCHÉ : sur une
  // facture neuve, où personne n'y touche justement, la case restait blanche et
  // le refus arrivait sans qu'aucun champ ne soit montré du doigt. Un premier
  // enregistrement refusé vaut « touché » pour tout le formulaire.
  const [enregistrementTente, setEnregistrementTente] = useState(false)
  const [paymentForm] = Form.useForm()

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

  // ID effectif de la facture (props ou après création)
  const currentInvoiceId = documentId || savedInvoiceId

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
  const { columnWidths, handleResize } = useColumnWidths()

  // Fetch existing invoice if editing (must be first to determine type)
  // Use currentInvoiceId to also fetch after creation
  const { data: invoiceData } = useQuery({
    queryKey: ['invoice', currentInvoiceId],
    queryFn: async () => {
      if (!currentInvoiceId) return null
      const response = await invoiceAPI.get(currentInvoiceId)
      return response.data as Invoice
    },
    enabled: !!currentInvoiceId,
  })

  // Determine if this is a supplier invoice
  // For existing invoices, use the type from data; for new invoices, use the prop
  // Use invoiceType as fallback while data is loading
  const isSupplierInvoice = documentId
    ? (invoiceData?.type === 'supplier' || (!invoiceData && invoiceType === 'supplier'))
    : invoiceType === 'supplier'

  // ⚠️ ON NE PROPOSE PLUS UN TIERS DÉSACTIVÉ SUR UN DOCUMENT NEUF.
  //
  // Un client ou un fournisseur désactivé l'est pour qu'on cesse de travailler
  // avec lui ; il figurait pourtant dans la liste, sans rien qui le distingue.
  //
  // …mais SEULEMENT sur un document neuf. Sur une facture ANCIENNE dont le
  // tiers a été désactivé depuis, le filtre le ferait disparaître de la liste,
  // et avec lui le nom affiché : la case se vidait sur une facture qui porte
  // pourtant bien son fournisseur.
  const tiersActifsSeulement = documentId ? undefined : 1

  // Fetch clients (only for client invoices)
  const { data: clientsData, isLoading: isLoadingClients } = useQuery({
    queryKey: ['clients-for-invoice-editor', tiersActifsSeulement],
    queryFn: async () => {
      const response = await clientAPI.list({ page: 1, page_size: 100, active: tiersActifsSeulement })
      return response.data
    },
    enabled: !isSupplierInvoice,
  })

  // Fetch suppliers (only for supplier invoices)
  const { data: suppliersData, isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['suppliers-for-invoice-editor', tiersActifsSeulement],
    queryFn: async () => {
      const response = await supplierAPI.list({ page: 1, page_size: 100, active: tiersActifsSeulement })
      return response.data
    },
    enabled: isSupplierInvoice,
  })

  // Fetch articles (for supplier invoices, only non-composed products)
  const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
    queryKey: ['articles-for-invoice-editor', isSupplierInvoice],
    queryFn: async () => {
      const params: Record<string, unknown> = { page: 1, page_size: 100 }
      // For supplier invoices, only show non-composed products (not services)
      if (isSupplierInvoice) {
        params.is_composed = false
        params.type = 'product'
      }
      const response = await articleAPI.list(params)
      return response.data
    },
  })

  // Fetch VAT rates
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

  // Fetch company settings (for tenant address)
  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: async () => {
      const response = await settingsAPI.getCompany()
      return response.data
    },
    enabled: isSupplierInvoice && !documentId, // Only for new supplier invoices
  })

  // Tous les règlements de la facture — pas seulement ceux qui viennent d'un
  // relevé. Un encaissement en ligne, un chèque saisi à la main ou un
  // rapprochement bancaire règlent la même facture et doivent se lire au même
  // endroit : une facture soldée dont l'onglet reste vide est incompréhensible.
  const { data: paymentsData } = useQuery({
    queryKey: ['invoice-payments', currentInvoiceId],
    queryFn: async () => {
      if (!currentInvoiceId) return { data: [], amount_due: 0 }
      const response = await invoiceAPI.getPayments(currentInvoiceId)
      return response.data
    },
    enabled: !!currentInvoiceId,
  })

  // Les comptes bancaires, pour rattacher le règlement à un compte. La liste
  // n'est demandée qu'à l'ouverture de la fenêtre : elle ne sert qu'à elle.
  const { data: bankAccountsData } = useQuery({
    queryKey: ['bank-accounts-for-payment'],
    queryFn: async () => (await bankAccountAPI.list({ page: 1, limit: 200 })).data,
    enabled: paymentModalOpen,
  })

  const payments: InvoicePayment[] = paymentsData?.data || []
  const money = (value: number) =>
    value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

  // ⚠️ UN AVOIR NE S'ENCAISSE PAS, IL SE REMBOURSE.
  //
  // La base garde un total_ttc POSITIF sur un avoir et met le signe sur le
  // RÈGLEMENT : rembourser un avoir de 702 €, c'est enregistrer −702. C'est la
  // convention que suivent déjà PaymentService::refresh(), balanceOf() et
  // BankStatements::planLinks() ; l'écran était le seul à l'ignorer.
  const estUnAvoir = invoiceData?.type === 'credit'

  // Fetch footers for invoices (client or supplier based on invoice type)
  const { data: footersData } = useQuery({
    queryKey: ['footers', isSupplierInvoice ? 'supplier_invoice' : 'client_invoice'],
    queryFn: async () => {
      const docType = isSupplierInvoice ? 'supplier_invoice' : 'client_invoice'
      const response = await settingsAPI.listFootersByDocumentType(docType)
      return response
    },
  })

  // Filter VAT rates based on invoice type (output for client, input for supplier)
  //
  // ⚠️ ET SEULEMENT LES TAUX ACTIFS. Le sélecteur proposait les taux DÉSACTIVÉS
  // du paramétrage ; le serveur, lui, ne cherche que dans les actifs et refuse
  // le reste (« Taux de TVA inconnu : 20 % »).
  const filteredVatRates = useMemo(() => {
    const rates = vatRatesData?.vat_rates || []
    const direction = isSupplierInvoice ? 'input' : 'output'
    return rates.filter((r: VATRate) => r.direction === direction && r.is_active !== false)
  }, [vatRatesData, isSupplierInvoice])

  // Get default VAT rate (use configured default, or first available, or 0)
  const defaultVatRate = useMemo(() => {
    const defaultRate = filteredVatRates.find((r: VATRate) => r.is_default)
    if (defaultRate) return defaultRate.rate
    if (filteredVatRates.length > 0) return filteredVatRates[0].rate
    return 0
  }, [filteredVatRates])

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

  // Load invoice data when editing
  useEffect(() => {
    if (invoiceData) {
      // Only initialize lines once to avoid overwriting user changes when articles are re-fetched
      if (linesInitializedRef.current) {
        return
      }

      const isSupplier = invoiceData.type === 'supplier'
      form.setFieldsValue({
        client_id: invoiceData.client_id,
        supplier_id: invoiceData.supplier_id,
        supplier_invoice_number: invoiceData.supplier_invoice_number,
        date: invoiceData.date ? dayjs(invoiceData.date) : dayjs(),
        due_date: invoiceData.due_date ? dayjs(invoiceData.due_date) : dayjs().add(30, 'day'),
        subject: invoiceData.subject,
        notes: invoiceData.notes,
        delivery_address: invoiceData.delivery_address,
        footer_content: invoiceData.footer_content || '',
        payment_terms: invoiceData.payment_terms || '',
      })

      // Restore selected payment term
      if (invoiceData.payment_terms && paymentTermsData?.payment_terms) {
        const term = paymentTermsData.payment_terms.find((term: PaymentTerm) => term.label === invoiceData.payment_terms)
        if (term) {
          setSelectedPaymentTermId(term.id)
        }
      }

      // Set selected client or supplier
      if (!isSupplier && invoiceData.client_id) {
        const client = clientsData?.data?.find((c: Client) => c.id === invoiceData.client_id)
        // La facture PORTE son client : s'il ne figure pas dans la liste —
        // archivé, ou au-delà de la page demandée — on prend celui du document
        // plutôt que de laisser le champ vide. Un champ vide sur une facture qui
        // a bien un client ne se comprend pas, et fait croire à une perte.
        if (client) {
          setSelectedClient(client)
        } else if (invoiceData.client) {
          setSelectedClient({
            id: invoiceData.client.id,
            code: invoiceData.client.code || '',
            name: invoiceData.client.name,
            // Son adresse aussi : c'est elle que la fenêtre d'envoi propose, et
            // sans elle le champ « destinataire » s'ouvrait vide sur une facture
            // dont le client est parfaitement renseigné.
            email: invoiceData.client.email || '',
          })
        }
      }
      if (isSupplier && invoiceData.supplier_id) {
        const supplier = suppliersData?.data?.find((s: Supplier) => s.id === invoiceData.supplier_id)
        // Même règle que pour le client : la facture PORTE son fournisseur.
        // S'il ne figure pas dans la liste — archivé, ou au-delà de la page
        // demandée — on prend celui du document plutôt que de laisser la case
        // vide sur une facture qui en a bien un.
        if (supplier) {
          setSelectedSupplier(supplier)
        } else if (invoiceData.supplier) {
          setSelectedSupplier({
            id: invoiceData.supplier.id,
            code: invoiceData.supplier.code || '',
            name: invoiceData.supplier.name,
          } as Supplier)
        }
      }

      const convertedLines: InvoiceLine[] = (invoiceData.lines || []).map((line, idx) => {
        const lineType = (line.line_type || 'article') as LineType
        const article = articlesData?.data?.find((a: Article) => a.id === line.article_id)
        // ⚠️ LE COÛT D'UNE LIGNE EST CELUI DU JOUR OÙ ELLE A ÉTÉ SAISIE.
        //
        // Le coût de la ligne d'abord, la fiche article seulement à défaut : à
        // relire la fiche, la marge d'une facture VALIDÉE changeait dès qu'on
        // retouchait le tarif d'achat de l'article, et tombait à zéro quand
        // l'article n'était pas dans les cent premiers rendus par la liste.
        const purchasePrice = line.purchase_price ?? article?.purchase_price ?? line.unit_price
        const coefficient = purchasePrice > 0 ? line.unit_price / purchasePrice : 1
        return {
          key: `line-${idx}`,
          line_type: lineType,
          article_id: line.article_id,
          description: line.description,
          quantity: line.quantity,
          unit: (line as { unit?: string }).unit || article?.unit || '',
          purchase_price: isSupplier ? line.unit_price : purchasePrice,
          coefficient: isSupplier ? 1 : Math.round(coefficient * 100) / 100,
          unit_price: line.unit_price,
          discount_percent: line.discount || 0,
          vat_rate: line.vat_rate ?? defaultVatRate,
        }
      })

      setLines(convertedLines.length > 0 ? convertedLines : [createEmptyLine()])
      linesInitializedRef.current = true
      updateTabTitle(tabId, isSupplier ? t('invoiceEditor.tabTitle.supplier', { number: invoiceData.supplier_invoice_number || t('invoiceEditor.noNumber') }) : t('invoiceEditor.tabTitle.client', { number: invoiceData.number }))

      // Load global discount
      if (invoiceData.discount_percent && invoiceData.discount_percent > 0) {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(invoiceData.discount_percent)
      } else if (invoiceData.discount_amount && invoiceData.discount_amount > 0) {
        setGlobalDiscountType('amount')
        setGlobalDiscountValue(invoiceData.discount_amount)
      } else {
        setGlobalDiscountType('percent')
        setGlobalDiscountValue(0)
      }

      // Load selected footer by matching content
      if (invoiceData.footer_content) {
        const footers = Array.isArray(footersData) ? footersData : (footersData?.data || [])
        const matchingFooter = footers.find(
          (f: { id: string; content: string }) => f.content === invoiceData.footer_content
        )
        if (matchingFooter) {
          setSelectedFooterId(matchingFooter.id)
        }
      }
    } else if (!documentId) {
      // Only initialize once
      if (linesInitializedRef.current) {
        return
      }

      // Initialize new invoice, possibly from deal metadata
      const initialValues: Record<string, unknown> = {
        date: dayjs(),
        due_date: dayjs().add(30, 'day'),
      }

      // If coming from a deal, use deal data
      if (tabMetadata) {
        if (tabMetadata.subject) {
          initialValues.subject = tabMetadata.subject
        }
        if (tabMetadata.client_id && !isSupplierInvoice) {
          initialValues.client_id = tabMetadata.client_id
          const client = clientsData?.data?.find((c: Client) => c.id === tabMetadata.client_id)
          if (client) {
            setSelectedClient(client)
          }
        }
        // For supplier invoices from a deal, use deal address
        if (isSupplierInvoice && tabMetadata.deal_address) {
          initialValues.delivery_address = tabMetadata.deal_address
        }
      }

      // For supplier invoices without deal address, use tenant address
      if (isSupplierInvoice && !initialValues.delivery_address && companySettings?.address) {
        initialValues.delivery_address = companySettings.address
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
  }, [invoiceData, articlesData, clientsData, suppliersData, paymentTermsData, footersData, documentId, form, tabId, updateTabTitle, tabMetadata, isSupplierInvoice, defaultVatRate])

  // Auto-fill delivery address for new supplier invoices when company settings are loaded
  useEffect(() => {
    if (!documentId && isSupplierInvoice && companySettings?.address) {
      // Only set if no address is already set (from deal or user input)
      const currentAddress = form.getFieldValue('delivery_address')
      if (!currentAddress) {
        form.setFieldsValue({ delivery_address: companySettings.address })
      }
    }
  }, [documentId, isSupplierInvoice, companySettings, form])

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

  // Handle supplier selection
  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliersData?.data?.find((s: Supplier) => s.id === supplierId)
    setSelectedSupplier(supplier || null)
    form.setFieldsValue({ supplier_id: supplierId })

    // ⚠️ LE DÉLAI DE RÈGLEMENT EST CELUI DE LA FICHE FOURNISSEUR.
    //
    // Rien n'était repris de sa fiche : un fournisseur réglé à 60 jours voyait
    // sa facture partir à J+30, la condition de règlement restait vide, et
    // l'échéance affichée sur le PDF n'était pas celle du contrat. La fiche rend
    // le délai en JOURS ; c'est par lui qu'on retrouve la condition du
    // paramétrage. Même geste que dans PurchaseOrderEditor.handleSupplierChange.
    const jours = supplier?.payment_terms
    const terme = typeof jours === 'number'
      ? paymentTermsData?.payment_terms?.find((pt: PaymentTerm) => pt.days === jours)
      : undefined

    if (terme) {
      setSelectedPaymentTermId(terme.id)
      form.setFieldValue('payment_terms', terme.label)

      const dateFacture = form.getFieldValue('date')

      if (dateFacture) {
        form.setFieldValue('due_date', dayjs(dateFacture).add(terme.days, 'day'))
      }
    }

    // Note: For supplier invoices, delivery address is where the supplier delivers TO (our address),
    // not the supplier's address. It's pre-filled with tenant/deal address.
    setTabDirty(tabId, true)
  }

  // ⚠️ LA MÊME FACTURE FOURNISSEUR SAISIE DEUX FOIS SE PAIE DEUX FOIS.
  //
  // La route /invoices/check-duplicate existe, fonctionne, et n'était appelée
  // que par la fenêtre d'import de SupplierInvoiceList : celui qui saisit à la
  // main n'était averti de rien, et rien en base n'empêche deux factures de
  // porter le même numéro fournisseur (c'est volontaire — deux fournisseurs
  // peuvent numéroter pareil). C'est donc à la saisie qu'il faut le dire.
  //
  // Un avertissement, pas un refus : le doublon peut être légitime.
  const verifierDoublon = async (numero: string) => {
    const propre = (numero || '').trim()

    if ('' === propre) {
      setDoublonFournisseur(null)

      return
    }

    try {
      const res = await invoiceAPI.checkDuplicate(propre)

      // La facture en cours d'édition est évidemment « déjà en base » : ce
      // n'est pas un doublon.
      if (res.data?.exists && String(res.data.id) !== String(currentInvoiceId)) {
        setDoublonFournisseur({
          internal_number: res.data.internal_number,
          created_at: res.data.created_at,
        })
      } else {
        setDoublonFournisseur(null)
      }
    } catch {
      // Le contrôle est un confort : son échec ne doit pas gêner la saisie.
      setDoublonFournisseur(null)
    }
  }

  const createEmptyLine = (lineType: LineType = 'article'): InvoiceLine => ({
    key: `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    line_type: lineType,
    article_id: undefined,
    description: lineType === 'page_break' ? t('invoiceEditor.lines.pageBreakText') : lineType === 'subtotal' ? t('invoiceEditor.lines.subtotalLabel') : '',
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
  }, idx: number, defaultRate: number): InvoiceLine => ({
    key: `line-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
    deal_line_id: dealLine.deal_line_id,
    line_type: (dealLine.line_type || 'article') as LineType,
    article_id: dealLine.article_id,
    description: dealLine.description || '',
    quantity: dealLine.quantity || 1,
    unit: dealLine.unit || '',
    purchase_price: dealLine.unit_price || 0,
    coefficient: 1,
    unit_price: dealLine.unit_price || 0,
    discount_percent: dealLine.discount_percent || 0,
    vat_rate: dealLine.tva_rate ?? defaultRate,
  })

  // Helper to invalidate all invoice-related queries (including client/supplier history)
  const peutValider = useCanValidateDocuments()
  const droitsConnus = usePermissionsChargees()

  // ⚠️ LES BOUTONS MENTAIENT AUX RÔLES QUI N'ONT PAS LE DROIT.
  //
  // Le serveur s'est fermé, l'écran ne l'avait pas appris : le commercial se
  // voyait offrir « Enregistrer un règlement », « Valider » et les crayons de
  // ligne, et récoltait un bandeau rouge à chaque clic. Un bouton qui ne peut
  // pas aboutir n'est pas une invitation, c'est un piège.
  //
  // Deux droits distincts, parce que le serveur en vérifie deux :
  //  - écrire la PIÈCE tient au module documentaire (Api::canWriteType) ;
  //  - encaisser tient à « amsbm_reconcile_bank », que Settings::applyLevel()
  //    accorde au module « treasury » à partir du niveau « edit ».
  const modulePiece = isSupplierInvoice ? 'supplier_invoices' : 'invoices'
  const peutEcrireLaPiece = usePermissionStore((etat) => etat.canEdit(modulePiece))
  const peutEncaisser = usePermissionStore((etat) => etat.canEdit('treasury'))

  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN. La matrice arrive par un appel
  // (MainLayout la charge au montage) : masquer avant sa réponse ferait
  // clignoter les boutons chez celui qui y a pourtant droit. Même garde que
  // pour « Demande de validation » — voir usePermissionsChargees().
  const montrerLEcriture = !droitsConnus || peutEcrireLaPiece
  const montrerLesReglements = !droitsConnus || peutEncaisser

  // Le journal ne descend qu'avec la LECTURE d'une facture, jamais avec les
  // listes : c'est voulu côté serveur, une liste n'a pas à porter ça.
  const journalConsultations = invoiceData?.public_access_log ?? []

  const invalidateInvoiceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['invoices'], refetchType: 'all' })
    // Invalidate client history queries
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey
      return Array.isArray(key) && key[0] === 'invoices' && key[1] === 'client'
    }})
    // Invalidate supplier history queries
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey
      return Array.isArray(key) && key[0] === 'invoices' && key[1] === 'supplier'
    }})
    // Invalidate dashboard stats and charts
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'charts'] })
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => invoiceAPI.create(data),
    onSuccess: (response) => {
      message.success(t('invoiceEditor.messages.created'))
      invalidateInvoiceQueries()
      const newInvoice = response.data as Invoice
      const titlePrefix = newInvoice.type === 'supplier' ? t('invoiceEditor.titlePrefix.supplier') : t('invoiceEditor.titlePrefix.client')
      updateTabTitle(tabId, `${titlePrefix} ${newInvoice.number}`)
      setTabDirty(tabId, false)
      setSavedInvoiceId(newInvoice.id)
      // Invalidate the query so it refetches with the new ID
      queryClient.invalidateQueries({ queryKey: ['invoice', newInvoice.id] })
    },
    // ⚠️ Le motif vient du serveur — « le numéro de la facture du fournisseur
    // est obligatoire », par exemple. L'avaler pour afficher « erreur de
    // création » laissait chercher au hasard, et donnait l'impression que la
    // facture avait été créée sans apparaître nulle part.
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('invoiceEditor.messages.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      invoiceAPI.update(id, data),
    onSuccess: () => {
      message.success(t('invoiceEditor.messages.updated'))
      invalidateInvoiceQueries()
      if (currentInvoiceId) {
        queryClient.invalidateQueries({ queryKey: ['invoice', currentInvoiceId] })
      }
      setTabDirty(tabId, false)
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('invoiceEditor.messages.updateError'))
    },
  })

  const _sendMutation = useMutation({
    // ⚠️ Sur une facture FOURNISSEUR, « réceptionner » la valide : elle passe de
    // brouillon à reçue et prend son numéro interne. Envoyer un courriel au
    // fournisseur avec sa propre facture n'aurait aucun sens — et c'est pourtant
    // ce que faisait ce bouton, ce qui laissait le document en brouillon.
    mutationFn: (id: string) => ( isSupplierInvoice ? supplierInvoiceAPI.validate(id) : invoiceAPI.send(id) ),
    onSuccess: () => {
      message.success(isSupplierInvoice ? t('invoiceEditor.messages.received') : t('invoiceEditor.messages.sent'))
      invalidateInvoiceQueries()
      if (currentInvoiceId) {
        queryClient.invalidateQueries({ queryKey: ['invoice', currentInvoiceId] })
      }
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || ( isSupplierInvoice ? t('invoiceEditor.messages.receiveError') : t('invoiceEditor.messages.sendError') ))
    },
  })
  void _sendMutation

  // ⚠️ AUCUN RÈGLEMENT NE POUVAIT ÊTRE SAISI DEPUIS L'ERP.
  //
  // La route POST /invoices/{id}/payments existe et fonctionne (partiel →
  // « Partielle », solde → « Soldée »), invoiceAPI.addPayment était définie… et
  // appelée NULLE PART : le bloc « Paiements » se contentait d'afficher ce que
  // le rapprochement bancaire avait posé. Une facture réglée par chèque ou en
  // espèces restait donc éternellement due, et une facture fournisseur ne
  // pouvait pas être soldée du tout.
  const addPaymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      invoiceAPI.addPayment(id, data),
    onSuccess: () => {
      message.success(t('invoiceEditor.payments.saved', 'Règlement enregistré.'))
      setPaymentModalOpen(false)
      paymentForm.resetFields()
      invalidateInvoiceQueries()
      if (currentInvoiceId) {
        queryClient.invalidateQueries({ queryKey: ['invoice', currentInvoiceId] })
        queryClient.invalidateQueries({ queryKey: ['invoice-payments', currentInvoiceId] })
      }
    },
    // Le serveur refuse un montant nul avec ses propres mots : on les montre.
    onError: (e: any) => {
      message.error(
        e?.response?.data?.message
          || e?.response?.data?.error
          || e?.message
          || t('invoiceEditor.payments.saveError', "Le règlement n'a pas pu être enregistré.")
      )
    },
  })

  const handleAddPayment = async () => {
    if (!currentInvoiceId) return

    const values = await paymentForm.validateFields()

    addPaymentMutation.mutate({
      id: currentInvoiceId,
      data: {
        amount: values.amount,
        fee: values.fee || 0,
        // Une date de règlement n'a pas de fuseau non plus (voir handleSave).
        date: values.date ? values.date.format('YYYY-MM-DD') : undefined,
        method: values.method || 'transfer',
        reference: values.reference || '',
        notes: values.notes || '',
        bank_account_id: values.bank_account_id || 0,
      },
    })
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      invoiceAPI.updateStatus(id, status),
    onSuccess: () => {
      message.success(t('invoiceEditor.messages.statusUpdated'))
      invalidateInvoiceQueries()
      if (currentInvoiceId) {
        queryClient.invalidateQueries({ queryKey: ['invoice', currentInvoiceId] })
      }
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || e?.message || t('invoiceEditor.messages.statusUpdateError'))
    },
  })

  // Mutation to update article price
  const updateArticleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      articleAPI.update(id, data),
    onSuccess: () => {
      message.success(t('invoiceEditor.messages.articlePriceUpdated'))
      queryClient.invalidateQueries({ queryKey: ['articles-for-editor'] })
    },
    onError: () => {
      message.error(t('invoiceEditor.messages.articleUpdateError'))
    },
  })

  // Status configuration - different label for supplier invoices
  const sentLabel = isSupplierInvoice ? t('invoiceEditor.status.received') : t('invoiceEditor.status.sent')
  const statusConfig: Record<string, { color: string; label: string }> = {
    draft: { color: 'default', label: t('invoiceEditor.status.draft') },
    // ⚠️ « attente validation » et « validée » sont DEUX LECTURES d'états
    // internes existants — brouillon avec une demande posée, validée sans envoi
    // (voir Documents::outStatus et Invoices::outStatus). Ce ne sont pas des
    // statuts de plus : la facture est modifiable dans le premier cas, figée et
    // numérotée dans le second, exactement comme avant.
    pending_validation: {
      color: 'orange',
      label: t('invoiceEditor.status.pendingValidation', 'Attente validation'),
    },
    validated: { color: 'blue', label: t('invoiceEditor.status.validated', 'Validée') },
    sent: { color: 'cyan', label: sentLabel },
    // ⚠️ « Consultée » est une CINQUIÈME lecture du même état interne : la
    // facture reste validée en base, numérotée et figée (voir
    // Invoices::outStatus et PublicInvoices::consulte). Ce qui change, c'est ce
    // qu'on SAIT — le client a ouvert son lien. Envoyée et consultée n'appellent
    // pas la même relance.
    //
    // Une facture FOURNISSEUR ne peut pas la porter : elle n'a pas de lien
    // public. Le libellé est donc au féminin des factures que nous émettons.
    consulted: { color: 'purple', label: t('invoiceEditor.status.consulted', 'Consultée') },
    paid: { color: 'green', label: t('invoiceEditor.status.paid') },
    partial: { color: 'orange', label: t('invoiceEditor.status.partial') },
    cancelled: { color: 'red', label: t('invoiceEditor.status.cancelled') },
  }

  // ⚠️ LE MENU NE PROPOSE QUE CE QUE LA MACHINE À ÉTATS ACCEPTE.
  //
  // Il offrait les cinq statuts à tout moment. Sur un brouillon, « Payée »
  // partait en 409 (« le passage de Brouillon à Clôturé n'est pas permis »),
  // « Paiement partiel » en 400, et « Brouillon » sur un document numéroté
  // aussi : trois entrées qui ne pouvaient jamais aboutir, offertes à côté des
  // deux qui marchent. Un document numéroté ne redevient jamais brouillon, et
  // « partiel » se déduit des règlements — il ne se pose pas à la main sur une
  // facture. Les transitions suivies sont celles de PostStatuses::transitions().
  //
  // ⚠️ LE RETOUR EN BROUILLON N'EST OFFERT QUE DEPUIS « attente validation ».
  //
  // Retirer sa demande de relecture ne défait rien : la facture est restée un
  // brouillon, on efface une métadonnée. Une facture VALIDÉE, elle, est
  // numérotée et scellée — elle ne redevient jamais brouillon, et le serveur le
  // refuse (reopen() ne consent qu'aux devis et aux avenants). C'est ce que dit
  // le produit partout ailleurs : une pièce comptable se corrige par un avoir.
  //
  // ⚠️ « Validée » ne s'offre PAS sur une facture fournisseur. Elle nous
  // arrive : nous ne l'envoyons pas, et son état validé se lit « Reçue »
  // (SupplierInvoices ne distingue pas validé d'envoyé, contrairement à
  // Invoices). Proposer les deux ferait choisir « Validée » pour obtenir
  // « Reçue » — un aller-retour incompréhensible.
  const valide = isSupplierInvoice ? 'sent' : 'validated'
  const transitionsParStatut: Record<string, string[]> = {
    draft: ['pending_validation', valide, 'cancelled'],
    pending_validation: [valide, 'draft', 'cancelled'],
    validated: ['sent', 'paid', 'cancelled'],
    sent: ['paid', 'cancelled'],
    // La consultation ne change pas ce qu'on PEUT faire, seulement ce qu'on
    // sait : les mêmes suites qu'« envoyée ». Sans cette entrée, le menu de
    // statut d'une facture consultée devenait vide.
    consulted: ['paid', 'cancelled'],
    partial: ['paid', 'cancelled'],
    paid: [],
    cancelled: [],
  }

  const statusLabels: Record<string, string> = {
    draft: t('invoiceEditor.status.draft'),
    pending_validation: t('invoiceEditor.status.pendingValidation', 'Attente validation'),
    validated: t('invoiceEditor.status.validated', 'Validée'),
    sent: sentLabel,
    consulted: t('invoiceEditor.status.consulted', 'Consultée'),
    paid: t('invoiceEditor.status.paid'),
    partial: t('invoiceEditor.status.partial'),
    cancelled: t('invoiceEditor.status.cancelled'),
  }

  // ⚠️ « VALIDÉE » NE S'OFFRE QU'À QUI PEUT VALIDER.
  //
  // C'est le partage que décrit déjà permissionStore : « le bouton "Demande de
  // validation" paraît chez celui qui ne l'a pas, l'entrée "Validé" du menu de
  // statut chez celui qui l'a ». Le menu les offrait toutes les deux à tout le
  // monde : le commercial choisissait « Validée » et récoltait un 403. Valider
  // numérote la pièce dans une série continue et la scelle — c'est le niveau
  // « tous les droits » du module, et rien de moins.
  //
  // ⚠️ ET C'EST LA RÈGLE DU SERVEUR, PAS UNE AUTRE.
  //
  // On exigeait ici « tous les droits » sur CE module-ci. Or le serveur demande
  // « amsbm_validate_documents », que Settings::recalculerCapacitesDeRole()
  // accorde dès qu'UN SEUL des quatre modules documentaires est au niveau
  // complet. Les deux règles ne se recouvrent pas, et l'écart fermait la porte :
  //
  //   un rôle « devis : tous les droits, factures : créer/modifier »
  //     — n'a pas « full » sur les factures  -> l'entrée « Validée » disparaît ;
  //     — a bien amsbm_validate_documents     -> « Demande de validation »
  //       disparaît aussi, puisqu'elle ne s'offre qu'à qui NE PEUT PAS valider.
  //
  // Ce rôle n'avait donc PLUS AUCUN CHEMIN pour sortir une facture du brouillon,
  // alors que le serveur, lui, répondait 200. Éprouvé. L'écran suit le serveur :
  // c'est « peutValider », déjà calculé plus haut, qui décide.
  //
  // Tant que la matrice n'est pas chargée, l'entrée reste offerte : la faire
  // apparaître une seconde après coup est aussi déroutant qu'un refus.
  const montrerLaValidation = !droitsConnus || peutValider

  const statusMenuItems = (transitionsParStatut[invoiceData?.status || 'draft'] || [])
    .filter((key) => key !== valide || montrerLaValidation)
    .map((key) => ({
      key,
      label: statusLabels[key] || key,
    }))

  const handleStatusChange = (status: string) => {
    if (currentInvoiceId) {
      updateStatusMutation.mutate({ id: currentInvoiceId, status })
    }
  }

  // ⚠️ ÉTABLIR UN AVOIR : le produit y renvoie, rien ne le permettait.
  //
  // « Ce document est validé […] Pour le corriger, établissez un avoir » :
  // c'est le refus que le serveur oppose à toute modification d'une facture
  // émise. Le mot « avoir » n'apparaissait nulle part dans l'interface. L'avoir
  // naît en brouillon et s'ouvre aussitôt : il se relit, se corrige, et prend
  // son numéro à sa validation.
  // ⚠️ LA PASSATION DE MAIN, QUAND ON N'A PAS LE DROIT DE VALIDER.
  //
  // Le rédacteur qui n'a pas « amsbm_validate_documents » finissait sa facture et
  // se heurtait à un 403 : il allait le demander de vive voix, ou la facture
  // dormait. La route pose « attente validation », prévient dans AMS Studio et par
  // courriel tous ceux qui peuvent valider, et retient QUI a demandé — pour lui
  // rendre compte le jour où c'est fait. L'écran dit COMBIEN de personnes ont
  // été touchées : « c'est parti » sur zéro destinataire ne vaut rien.
  const requestValidationMutation = useMutation({
    mutationFn: (id: string) =>
      isSupplierInvoice ? supplierInvoiceAPI.requestValidation(id) : invoiceAPI.requestValidation(id),
    onSuccess: (reponse) => {
      const prevenus = Number((reponse?.data as { notified?: number } | undefined)?.notified ?? 0)

      if (prevenus > 0) {
        message.success(
          t(
            'invoiceEditor.validationRequested',
            'Demande envoyée : {{count}} personne(s) prévenue(s). La facture attend sa validation.',
            { count: prevenus }
          )
        )
      } else {
        message.warning(
          t(
            'invoiceEditor.validationRequestedNobody',
            "La facture attend sa validation, mais personne n'a pu être prévenu : aucun compte n'a le droit de valider, ou leur adresse de courriel manque."
          ),
          8
        )
      }

      invalidateInvoiceQueries()
      queryClient.invalidateQueries({ queryKey: ['invoice', currentInvoiceId] })
    },
    onError: (e: unknown) => {
      const motif = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data
      const phrase = motif?.message || motif?.error || ''

      message.error(
        phrase || t('invoiceEditor.validationRequestError', "La demande de validation n'est pas partie."),
        phrase ? 8 : undefined
      )
    },
  })

  const creditMutation = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/credit`),
    onSuccess: (response) => {
      const avoir = response.data as { id: string; number: string }
      message.success(
        t('invoiceEditor.messages.creditCreated', 'Avoir établi : relisez-le puis validez-le pour le numéroter.')
      )
      invalidateInvoiceQueries()
      openDocumentTab('invoice', avoir.id, `${t('invoices.creditTabPrefix', 'Avoir')} ${avoir.number}`)
    },
    onError: (e: unknown) => {
      message.error(
        (e as Error)?.message || t('invoiceEditor.messages.creditError', "Erreur lors de l'établissement de l'avoir")
      )
    },
  })

  // Open client tab
  const handleOpenClient = () => {
    const clientId = form.getFieldValue('client_id')
    if (clientId) {
      const client = clientsData?.data?.find((c: Client) => c.id === clientId)
      openDocumentTab('client', clientId, client ? `${t('invoiceEditor.tab.client')} ${client.name}` : t('invoiceEditor.tab.client'))
    }
  }

  // Open email modal with client email pre-filled
  const handleOpenEmailModal = () => {
    if (!documentId) return
    // Pre-fill with client email if available
    const clientEmail = selectedClient?.email || ''
    setEmailAddress(clientEmail)
    setEmailModalOpen(true)
  }

  // Send invoice by email with PDF attachment
  const handleSendEmail = async () => {
    if (!documentId || !emailAddress) return

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailAddress)) {
      message.error(t('invoiceEditor.email.invalidAddress'))
      return
    }

    setEmailSending(true)
    try {
      await invoiceAPI.sendEmail(documentId, emailAddress)
      message.success(t('invoiceEditor.email.sentTo', { email: emailAddress }))
      setEmailModalOpen(false)
      setEmailAddress('')
    } catch (error: unknown) {
      // ⚠️ Le serveur explique son refus sous « message » (WP_Error), pas sous
      // « error » : le motif — « validez le document avant de l'envoyer », ou
      // le reste à facturer — était remplacé par un générique, et l'utilisateur
      // n'avait aucun moyen de savoir ce qu'on attendait de lui.
      const err = error as { response?: { data?: { message?: string; error?: string } } }
      message.error(
        err?.response?.data?.message || err?.response?.data?.error || t('invoiceEditor.email.sendError')
      )
    } finally {
      setEmailSending(false)
    }
  }

  // Calculate totals
  const totals = useMemo(() => {
    let totalPurchase = 0
    let totalSaleHTBeforeDiscount = 0
    let totalTVABeforeDiscount = 0

    lines.forEach((line) => {
      // Skip non-article lines
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

    // Get deposit amount from invoice data (if exists)
    const depositHT = invoiceData?.deposit_ht || 0

    // If there are deposits, recalculate TVA on remaining amount
    let netHT = totalSaleHT
    let netTVA = totalTVA
    if (depositHT > 0) {
      netHT = totalSaleHT - depositHT
      // Recalculate TVA proportionally on net amount
      const tvaRatio = totalSaleHT > 0 ? totalTVA / totalSaleHT : 0
      netTVA = netHT * tvaRatio
    }

    const totalTTC = netHT + netTVA
    const margin = totalSaleHT - totalPurchase
    const marginPercent = totalPurchase > 0 ? (margin / totalPurchase) * 100 : 0

    return {
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalSaleHTBeforeDiscount: Math.round(totalSaleHTBeforeDiscount * 100) / 100,
      globalDiscount: Math.round(globalDiscount * 100) / 100,
      totalSaleHT: Math.round(totalSaleHT * 100) / 100,
      depositHT: Math.round(depositHT * 100) / 100,
      netHT: Math.round(netHT * 100) / 100,
      totalTVA: Math.round(netTVA * 100) / 100,
      totalTTC: Math.round(totalTTC * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPercent: Math.round(marginPercent * 10) / 10,
    }
  }, [lines, invoiceData, globalDiscountType, globalDiscountValue])

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

  const handleArticleSelect = (articleId: string, lineKey: string) => {
    const article = articlesData?.data?.find((a: Article) => a.id === articleId)
    if (article) {
      const purchasePrice = article.purchase_price || 0
      const salePrice = article.sale_price || 0

      // For supplier invoices, use purchase price as unit price
      if (isSupplierInvoice) {
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
      } else {
        // For client invoices, use sale price
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
      }
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
      const duplicatedLine: InvoiceLine = {
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

  const handleSave = async () => {
    // ⚠️ UN REFUS DE SAISIE NE SE TAIT PAS.
    //
    // validateFields() partait dans le catch de fin, qui se contentait d'un
    // console.error : on cliquait « Enregistrer », il ne se passait RIEN, et
    // rien à l'écran ne disait quel champ était en cause. Le catch commun ne
    // peut pas s'en charger — il attrape aussi les refus du serveur, que les
    // mutations annoncent déjà avec leurs propres mots.
    try {
      await form.validateFields()
    } catch {
      setEnregistrementTente(true)
      message.error(
        t(
          'invoiceEditor.messages.formInvalid',
          'La facture ne peut pas être enregistrée : vérifiez les champs signalés en rouge.'
        )
      )

      return false
    }

    // ⚠️ UNE FACTURE S'ÉTABLIT POUR QUELQU'UN.
    //
    // « POST /invoices {client_id: 0} » répondait 201 : un brouillon sans tiers
    // s'installait dans la liste, et n'était refusé qu'à la validation, bien
    // plus tard, sans qu'on comprenne. Le serveur refuse désormais en 400 ; on
    // le dit ici avec les mêmes mots, avant l'aller-retour.
    //
    // Cela n'enferme PAS les brouillons sans client déjà en base : ils
    // s'ouvrent et se modifient comme avant — il suffit de leur choisir un
    // tiers pour pouvoir les enregistrer.
    const tiers = isSupplierInvoice ? form.getFieldValue('supplier_id') : form.getFieldValue('client_id')

    if (!tiers) {
      setEnregistrementTente(true)
      message.error(
        isSupplierInvoice
          ? t(
              'invoiceEditor.messages.supplierRequired',
              "Une facture fournisseur se rattache à quelqu'un : choisissez le fournisseur avant d'enregistrer."
            )
          : t(
              'invoiceEditor.messages.clientRequired',
              "Une facture s'établit pour quelqu'un : choisissez le client avant d'enregistrer."
            )
      )

      return false
    }

    try {
      // ⚠️ UNE ÉCHÉANCE NE PRÉCÈDE PAS L'ÉMISSION.
      //
      // Aucun contrôle : une facture datée du 16/08/2026 acceptait une échéance
      // au 01/01/2026 et naissait échue de sept mois — elle entrait aussitôt
      // dans la fenêtre des relances d'impayés.
      const dateEmission = form.getFieldValue('date')
      const dateEcheance = form.getFieldValue('due_date')

      if (dateEmission && dateEcheance && dateEcheance.isBefore(dateEmission, 'day')) {
        message.error(
          t(
            'invoiceEditor.messages.dueBeforeDate',
            "L'échéance ne peut pas précéder la date d'émission de la facture."
          )
        )
        return false
      }

      // ⚠️ UNE SAISIE FAUTIVE SE REFUSE, ELLE NE SE RECTIFIE PAS EN SILENCE.
      //
      // Les champs de ligne étaient bornés par antd, qui ramène la valeur dans
      // l'intervalle SANS RIEN DIRE : −5 devenait 0, −100 devenait 0,00,
      // 150 % devenait 100 % et −20 % devenait 0 %. Celui qui tape 150 croit
      // avoir mis 150. Les bornes sont parties des champs : ce refus, et le
      // serveur derrière lui, font foi.
      const ligneFautive = lines.find(
        (line) =>
          (line.line_type || 'article') === 'article' &&
          ((line.quantity ?? 0) < 0 ||
            (line.unit_price ?? 0) < 0 ||
            (line.purchase_price ?? 0) < 0 ||
            (line.discount_percent ?? 0) < 0 ||
            (line.discount_percent ?? 0) > 100)
      )

      if (ligneFautive) {
        message.error(
          t(
            'invoiceEditor.messages.lineOutOfRange',
            'Une ligne porte une valeur impossible : la quantité et le prix ne peuvent pas être négatifs, et la remise se situe entre 0 et 100 %.'
          )
        )
        return false
      }

      // ⚠️ UNE REMISE NE PEUT PAS DÉPASSER CE QU'ELLE REMISE : en euros, aucun
      // plafond n'existait, et le pied affichait un net et un TTC négatifs.
      if (
        globalDiscountType === 'amount' &&
        globalDiscountValue > totals.totalSaleHTBeforeDiscount
      ) {
        message.error(
          t(
            'invoiceEditor.messages.discountTooLarge',
            'La remise globale dépasse le montant de la facture : elle ne peut pas le rendre négatif.'
          )
        )
        return false
      }

      // ⚠️ UNE FACTURE SANS CONTENU S'ANNONCE, ELLE NE SE GLISSE PAS DANS LA LISTE.
      //
      // La ligne unique laissée intacte (aucun article, aucune désignation) est
      // écartée à l'envoi : le serveur recevait lines:[] et répondait 201, et
      // « Facture créée avec succès » entrait une facture à 0,00 € sans aucun
      // contenu dans la liste et dans le bandeau des totaux. Le garde du serveur,
      // lui, n'intervient qu'à la VALIDATION. On avertit donc à l'enregistrement,
      // sans interdire : un brouillon d'attente reste légitime.
      const lignesRetenues = lines.filter((line) => (line.description || '').trim() !== '')

      if (lignesRetenues.length === 0) {
        const continuer = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: t('invoiceEditor.messages.emptyInvoiceTitle', 'Cette facture ne porte aucune ligne'),
            content: t(
              'invoiceEditor.messages.emptyInvoiceBody',
              "Elle sera enregistrée à 0,00 € et ne pourra pas être validée tant qu'elle n'aura pas de ligne. L'enregistrer quand même ?"
            ),
            okText: t('common.yes'),
            cancelText: t('common.no'),
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })

        if (!continuer) {
          return false
        }
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
      const data: Record<string, unknown> = {
        // ⚠️ UNE DATE DE DOCUMENT N'A PAS DE FUSEAU.
        //
        // toISOString() convertissait en UTC : au Luxembourg (UTC+2 en été), le
        // 16/08 à 00:00 partait en « 2026-08-15T22:00:00.000Z », et le serveur,
        // qui ramène au jour, enregistrait la veille. La pièce comptable, son
        // numéro et son PDF portaient un jour de moins que celui choisi.
        date: values.date?.format('YYYY-MM-DD'),
        due_date: values.due_date?.format('YYYY-MM-DD'),
        subject: values.subject || '',
        notes: values.notes || '',
        delivery_address: values.delivery_address || '',
        footer_content: values.footer_content || '',
        payment_terms: values.payment_terms || '',
        // ⚠️ UNE LIGNE SAISIE À LA MAIN EST UNE LIGNE.
        //
        // Le filtre exigeait une référence article : une facture entièrement
        // saisie librement partait avec lines:[], le serveur répondait 201 et
        // l'écran annonçait « Facture créée » sur une facture vide. Le serveur
        // accepte parfaitement une ligne sans article ; ce qu'il écarte, c'est
        // une ligne sans libellé. On filtre donc sur le libellé, comme lui.
        lines: lignesRetenues
          .map((line) => ({
            deal_line_id: line.deal_line_id || null,
            line_type: line.line_type || 'article',
            article_id: line.article_id,
            description: line.description || '',
            quantity: line.quantity,
            unit: line.unit || 'unité',
            unit_price: isSupplierInvoice ? line.purchase_price : line.unit_price,
            // Le coût de la ligne, tel qu'il était au moment de la saisie. Il
            // fige la marge : sans lui, la relecture la recalcule depuis le
            // tarif d'achat COURANT de l'article et la marge d'une facture déjà
            // validée bouge toute seule.
            unit_cost: isSupplierInvoice ? undefined : line.purchase_price,
            discount_percent: line.discount_percent || 0,
            tva_rate: line.vat_rate ?? defaultVatRate,
          })),
      }

      // Add deal_id if from deal
      if (tabMetadata?.deal_id) {
        data.deal_id = tabMetadata.deal_id
      }

      // Add global discount
      data.discount_percent = globalDiscountType === 'percent' ? globalDiscountValue : 0
      data.discount_amount = globalDiscountType === 'amount' ? globalDiscountValue : 0

      // Add client_id or supplier_id and type based on invoice type
      if (isSupplierInvoice) {
        data.supplier_id = values.supplier_id
        data.supplier_invoice_number = values.supplier_invoice_number || ''
        data.type = 'supplier'
        // Factures fournisseur (souvent importées Factur-X/Peppol) : on transmet les totaux
        // AFFICHÉS (validés par l'utilisateur) pour qu'ils soient conservés tels quels côté
        // backend, au lieu d'être recalculés depuis les lignes (ce qui peut diverger des
        // totaux du XML en cas d'arrondis fournisseur). Cf. correctif totaux import (FA3245).
        data.total_ht = totals.totalSaleHT
        data.total_tva = totals.totalTVA
        data.total_ttc = totals.totalTTC
      } else {
        data.client_id = values.client_id
        data.type = 'client'
      }

      if (currentInvoiceId) {
        await updateMutation.mutateAsync({ id: currentInvoiceId, data })
      } else {
        await createMutation.mutateAsync(data)
      }

      return true
    } catch (error) {
      console.error('Validation error:', error)

      return false
    }
  }

  // Interface for Factur-X validation error response
  interface FacturXValidationError {
    error: string
    tenant_errors?: string[]
    client_errors?: string[]
  }

  // ⚠️ UNE ERREUR ARRIVÉE EN BLOB RESTE UNE ERREUR.
  //
  // getPdf() demande responseType:'blob' : sur un refus, axios rend le JSON du
  // serveur sous forme de Blob. `data.tenant_errors` était donc toujours
  // indéfini, la modale « informations manquantes » ne s'ouvrait jamais, et
  // l'utilisateur ne lisait qu'« Erreur de chargement du PDF » sans savoir
  // quelle adresse ou quel identifiant manquait.
  const lireCorpsErreur = async (data: unknown): Promise<FacturXValidationError | undefined> => {
    if (data instanceof Blob) {
      try {
        return JSON.parse(await data.text()) as FacturXValidationError
      } catch {
        return undefined
      }
    }
    return data as FacturXValidationError | undefined
  }

  // Show Factur-X validation error modal
  const showFacturXValidationError = (errorData: FacturXValidationError) => {
    Modal.error({
      title: t('invoiceEditor.facturx.missingInfoTitle'),
      width: 500,
      content: (
        <div style={{ marginTop: 16 }}>
          <Typography.Paragraph>
            {t('invoiceEditor.facturx.missingInfoIntro')}
          </Typography.Paragraph>
          {errorData.tenant_errors && errorData.tenant_errors.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong style={{ color: '#cf1322' }}>
                {t('invoiceEditor.facturx.companyErrors')}
              </Typography.Text>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {errorData.tenant_errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {errorData.client_errors && errorData.client_errors.length > 0 && (
            <div>
              <Typography.Text strong style={{ color: '#cf1322' }}>
                {t('invoiceEditor.facturx.clientErrors')}
              </Typography.Text>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                {errorData.client_errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ),
    })
  }

  const handleDownloadPdf = async () => {
    if (!currentInvoiceId) return
    try {
      const response = await invoiceAPI.getPdf(currentInvoiceId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${t('invoiceEditor.titlePrefix.client')}-${invoiceData?.number || t('invoiceEditor.pdf.newFileName')}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('invoiceEditor.pdf.downloaded'))
    } catch (error) {
      const axiosError = error as AxiosError<FacturXValidationError>
      const corps = await lireCorpsErreur(axiosError.response?.data)
      if (axiosError.response?.status === 400 && (corps?.tenant_errors || corps?.client_errors)) {
        showFacturXValidationError(corps)
      } else {
        message.error(t('invoiceEditor.pdf.downloadError'))
      }
    }
  }

  const handlePreviewPdf = async () => {
    if (!currentInvoiceId) return
    setPdfPreviewLoading(true)
    setPdfPreviewOpen(true)

    try {
      const response = await invoiceAPI.getPdf(currentInvoiceId)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      setPdfPreviewUrl(url)
    } catch (error) {
      setPdfPreviewOpen(false)
      const axiosError = error as AxiosError<FacturXValidationError>
      const corps = await lireCorpsErreur(axiosError.response?.data)
      if (axiosError.response?.status === 400 && (corps?.tenant_errors || corps?.client_errors)) {
        showFacturXValidationError(corps)
      } else {
        message.error(t('invoiceEditor.pdf.loadError'))
      }
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

  // Move canModify before columns so it can be used in column renderers
  // ⚠️ « NEUVE » CESSE DE L'ÊTRE DÈS QU'ELLE EST ENREGISTRÉE.
  //
  // La condition portait sur documentId — l'identifiant venu de l'onglet —, pas
  // sur celui obtenu à la création : après « Facture créée avec succès »,
  // l'en-tête gardait le titre « Nouvelle facture » et AUCUNE étiquette de
  // statut n'apparaissait. Il fallait quitter l'écran et rouvrir la facture
  // depuis la liste pour pouvoir la valider.
  const isNewInvoice = !currentInvoiceId
  // ⚠️ « attente validation » RESTE MODIFIABLE : c'est un brouillon dont on a
  // demandé la relecture (post_status DRAFT côté serveur). Le geler interdirait
  // à celui qui relit de corriger ce qu'il vient de lire, et le rédacteur ne
  // pourrait plus rien reprendre après avoir cliqué « Demande de validation ».
  // Le gel commence à « validée », là où le numéro est posé.
  const isDraft =
    invoiceData?.status === 'draft' || invoiceData?.status === 'pending_validation' || isNewInvoice

  // Client invoices (client, deposit or credit type) cannot be modified once sent/validated.
  // ⚠️ L'avoir client suit la même règle : c'est une pièce que NOUS émettons,
  // numérotée et scellée à sa validation.
  const isClientInvoice =
    invoiceData?.type === 'client' || invoiceData?.type === 'deposit' || invoiceData?.type === 'credit'
  // ⚠️ ET LE DROIT D'ÉCRIRE, PAS SEULEMENT L'ÉTAT DE LA PIÈCE.
  //
  // canModify commande TOUT ce qui s'écrit ici — les champs, les crayons de
  // ligne, le bouton « Enregistrer ». Il ne regardait que le statut : le
  // commercial saisissait sa facture entière avant d'apprendre, au clic final,
  // que le serveur ne voulait pas d'elle. Le refus doit venir avant la saisie,
  // pas après. Voir montrerLEcriture pour la garde du chargement.
  const canModify =
    (isNewInvoice || (isClientInvoice ? isDraft : invoiceData?.status !== 'paid' && invoiceData?.status !== 'cancelled'))
    && montrerLEcriture

  // ⚠️ CHANGER D'ÉTAT N'EST PAS MODIFIER. Le menu était conditionné à
  // canModify : une facture validée — donc figée, donc non modifiable — n'avait
  // plus aucune transition possible et restait « Envoyée » à jamais, y compris
  // pour être annulée. Ce qui décide, c'est la machine à états, et elle seule.
  // Changer d'état est une écriture : le serveur exige le droit d'écrire sur
  // cette pièce-là (Api::canWriteType). Sans lui, le menu ne mène qu'à un 403.
  const canChangeStatus = statusMenuItems.length > 0 && montrerLEcriture

  // Un avoir ne s'avoire pas, un brouillon n'a rien à contre-passer, une
  // facture annulée non plus.
  // ⚠️ ÉTABLIR UN AVOIR EST UNE ÉCRITURE. Le bouton s'offrait sur le seul état
  // de la pièce ; il mène à « POST /invoices/{id}/credit », que le serveur borne
  // au droit d'écrire sur ce module-là.
  const canCreateCredit =
    montrerLEcriture &&
    !!currentInvoiceId &&
    invoiceData?.type !== 'credit' &&
    invoiceData?.type !== 'supplier' &&
    !!invoiceData &&
    invoiceData.status !== 'draft' &&
    invoiceData.status !== 'cancelled'

  // Style for read-only fields (when invoice is sent/paid but still readable)
  const readOnlyStyle = !canModify ? {
    color: token.colorText,
    backgroundColor: token.colorBgLayout,
    cursor: 'not-allowed'
  } : {}

  // Common columns for all invoice types
  const commonColumns = [
    {
      title: '',
      dataIndex: 'drag',
      key: 'drag',
      width: 40,
      render: (_: unknown, record: InvoiceLine) => <DragHandle id={record.key} />,
    },
    {
      title: t('invoiceEditor.columns.ref'),
      dataIndex: 'article_id',
      key: 'article_id',
      width: columnWidths.article_id,
      onHeaderCell: () => ({
        width: columnWidths.article_id,
        onResize: handleResize('article_id'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <Select
            showSearch
            placeholder={t('invoiceEditor.columns.ref')}
            optionFilterProp="label"
            loading={isLoadingArticles}
            value={record.article_id}
            onChange={(value) => handleArticleSelect(value, record.key)}
            options={articlesData?.data?.map((a: Article) => ({
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
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type === 'text') {
          return (
            <Input.TextArea
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('invoiceEditor.lines.freeTextPlaceholder')}
              autoSize={{ minRows: 1, maxRows: 4 }}
              style={{ fontStyle: 'italic', ...readOnlyStyle }}
              disabled={!canModify}
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
              {t('invoiceEditor.lines.pageBreakText')}
            </div>
          )
        }
        if (record.line_type === 'subtotal') {
          return (
            <Input
              value={record.description}
              onChange={(e) => handleLineChange(record.key, 'description', e.target.value)}
              placeholder={t('invoiceEditor.lines.subtotalLabel')}
              style={{ fontWeight: 'bold', ...readOnlyStyle }}
              disabled={!canModify}
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
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.qty')}</div>,
      dataIndex: 'quantity',
      key: 'quantity',
      align: 'right' as const,
      width: columnWidths.quantity,
      onHeaderCell: () => ({
        width: columnWidths.quantity,
        onResize: handleResize('quantity'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.quantity}
            onChange={(value) => handleLineChange(record.key, 'quantity', value ?? 0)}
            precision={3}
            controls={false}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.unit')}</div>,
      dataIndex: 'unit',
      key: 'unit',
      align: 'center' as const,
      width: 60,
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return <span style={{ color: '#888' }}>{record.unit || 'U.'}</span>
      },
    },
  ]

  // Client invoice specific columns
  const clientInvoiceColumns = [
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.purchasePrice')}</div>,
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      align: 'right' as const,
      width: columnWidths.purchase_price,
      onHeaderCell: () => ({
        width: columnWidths.purchase_price,
        onResize: handleResize('purchase_price'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
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
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.coef')}</div>,
      dataIndex: 'coefficient',
      key: 'coefficient',
      align: 'right' as const,
      width: columnWidths.coefficient,
      onHeaderCell: () => ({
        width: columnWidths.coefficient,
        onResize: handleResize('coefficient'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.coefficient}
            onChange={(value) => handleLineChange(record.key, 'coefficient', value || 1)}
            min={0}
            step={0.1}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.salePrice')}</div>,
      dataIndex: 'unit_price',
      key: 'unit_price',
      align: 'right' as const,
      width: columnWidths.unit_price,
      onHeaderCell: () => ({
        width: columnWidths.unit_price,
        onResize: handleResize('unit_price'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
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
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.discountShort')}</div>,
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      align: 'right' as const,
      width: columnWidths.discount_percent,
      onHeaderCell: () => ({
        width: columnWidths.discount_percent,
        onResize: handleResize('discount_percent'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value ?? 0)}
            precision={1}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.vat')}</div>,
      dataIndex: 'vat_rate',
      key: 'vat_rate',
      align: 'right' as const,
      width: columnWidths.vat_rate,
      onHeaderCell: () => ({
        width: columnWidths.vat_rate,
        onResize: handleResize('vat_rate'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        const configuredOptions = filteredVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
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
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.totalHT')}</div>,
      key: 'total',
      align: 'right' as const,
      width: columnWidths.total,
      onHeaderCell: () => ({
        width: columnWidths.total,
        onResize: handleResize('total'),
      }),
      render: (_: unknown, record: InvoiceLine, index: number) => {
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
  ]

  // Supplier invoice specific columns
  const supplierInvoiceColumns = [
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.purchasePrice')}</div>,
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      align: 'right' as const,
      width: columnWidths.purchase_price,
      onHeaderCell: () => ({
        width: columnWidths.purchase_price,
        onResize: handleResize('purchase_price'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.purchase_price}
            onChange={(value) => handleLineChange(record.key, 'purchase_price', value || 0)}
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.discount')}</div>,
      dataIndex: 'discount_percent',
      key: 'discount_percent',
      align: 'right' as const,
      width: columnWidths.discount_percent,
      onHeaderCell: () => ({
        width: columnWidths.discount_percent,
        onResize: handleResize('discount_percent'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        return (
          <InputNumber
            value={record.discount_percent}
            onChange={(value) => handleLineChange(record.key, 'discount_percent', value ?? 0)}
            precision={1}
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.netPurchasePrice')}</div>,
      key: 'net_purchase_price',
      align: 'right' as const,
      width: 100,
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        const netPrice = record.purchase_price * (1 - (record.discount_percent || 0) / 100)
        return <span style={{ display: 'block', textAlign: 'right' }}>{netPrice.toFixed(2)} €</span>
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.vat')}</div>,
      dataIndex: 'vat_rate',
      key: 'vat_rate',
      align: 'right' as const,
      width: columnWidths.vat_rate,
      onHeaderCell: () => ({
        width: columnWidths.vat_rate,
        onResize: handleResize('vat_rate'),
      }),
      render: (_: unknown, record: InvoiceLine) => {
        if (record.line_type !== 'article') return null
        const configuredOptions = filteredVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
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
            style={{ width: '100%', textAlign: 'right', ...readOnlyStyle }}
            disabled={!canModify}
          />
        )
      },
    },
    {
      title: <div style={{ textAlign: 'center' }}>{t('invoiceEditor.columns.totalHT')}</div>,
      key: 'total',
      align: 'right' as const,
      width: columnWidths.total,
      onHeaderCell: () => ({
        width: columnWidths.total,
        onResize: handleResize('total'),
      }),
      render: (_: unknown, record: InvoiceLine, index: number) => {
        if (record.line_type === 'text' || record.line_type === 'page_break') return null
        if (record.line_type === 'subtotal') {
          const subtotal = calculateSubtotalForLine(index)
          return <strong style={{ display: 'block', textAlign: 'right', color: '#52c41a' }}>{subtotal.toFixed(2)} €</strong>
        }
        const netPrice = record.purchase_price * (1 - (record.discount_percent || 0) / 100)
        const total = record.quantity * netPrice
        return <strong style={{ display: 'block', textAlign: 'right' }}>{total.toFixed(2)} €</strong>
      },
    },
  ]

  // Actions column (common to all)
  const actionsColumn = {
    title: '',
    key: 'actions',
    width: 80,
    render: (_: unknown, record: InvoiceLine) => (
      <Space size="small">
        <Tooltip title={t('invoiceEditor.actions.duplicate')}>
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
  }

  // Build final columns based on invoice type
  const columns = [
    ...commonColumns,
    ...(isSupplierInvoice ? supplierInvoiceColumns : clientInvoiceColumns),
    actionsColumn,
  ]

  // Get the reason why the invoice cannot be modified
  const getLockedMessage = () => {
    if (isNewInvoice) return null
    if (!canModify) {
      return t('invoiceEditor.lockedMessage')
    }
    return null
  }
  const lockedMessage = getLockedMessage()

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
            {isNewInvoice
              ? t('invoiceEditor.header.newInvoice')
              : (isSupplierInvoice
                  ? t('invoiceEditor.header.supplierInvoice', { number: invoiceData?.supplier_invoice_number || t('invoiceEditor.noNumber') })
                  : invoiceData?.type === 'credit'
                    // Un avoir intitulé « Facture » se prend pour ce qu'il défait.
                    ? `${t('invoices.creditTabPrefix', 'Avoir')} ${invoiceData?.number || ''}`
                    : t('invoiceEditor.header.clientInvoice', { number: invoiceData?.number || '' }))}
          </h2>
          {currentInvoiceId && invoiceData && (
            <Dropdown
              menu={{
                items: statusMenuItems,
                onClick: ({ key }) => handleStatusChange(key),
                selectedKeys: [invoiceData.status],
              }}
              trigger={['click']}
              disabled={!canChangeStatus}
            >
              <Tag
                color={statusConfig[invoiceData.status]?.color || 'default'}
                style={{ cursor: canChangeStatus ? 'pointer' : 'default', fontSize: 14, padding: '4px 12px' }}
              >
                {statusConfig[invoiceData.status]?.label || invoiceData.status} {canChangeStatus && <DownOutlined />}
              </Tag>
            </Dropdown>
          )}
          {lockedMessage && (
            <Tag icon={<LockOutlined />} color="warning">
              {lockedMessage}
            </Tag>
          )}
        </Space>
        <Space>
          {/* ⚠️ LE BOUTON N'EXISTE QUE POUR CELUI QUI NE PEUT PAS VALIDER.
              Chez le responsable, il ferait doublon avec « Validée » du menu de
              statut — et lui ferait s'envoyer un courriel à lui-même. Il ne
              paraît que tant que la facture s'écrit : au-delà, la route répond
              « Ce document est déjà validé. » */}
          {currentInvoiceId &&
            droitsConnus &&
            !peutValider &&
            (invoiceData?.status === 'draft' || invoiceData?.status === 'pending_validation') && (
              <Tooltip
                title={t(
                  'invoiceEditor.requestValidationHelp',
                  'Prévient les personnes qui ont le droit de valider, et place la facture en attente de validation.'
                )}
              >
                <Button
                  icon={<AuditOutlined />}
                  loading={requestValidationMutation.isPending}
                  // ⚠️ ON ENREGISTRE AVANT DE PRÉVENIR. Le responsable ouvrira la
                  // facture TELLE QU'ELLE EST EN BASE : demander la relecture
                  // d'une saisie restée dans l'écran lui ferait valider l'ancienne
                  // version. Si l'enregistrement est refusé, rien ne part.
                  onClick={async () => {
                    const enregistre = await handleSave()

                    if (enregistre) requestValidationMutation.mutate(currentInvoiceId)
                  }}
                >
                  {t('invoiceEditor.requestValidation', 'Demande de validation')}
                </Button>
              </Tooltip>
            )}
          {currentInvoiceId && (
            <>
              {!isSupplierInvoice && (
                <>
                  {/* ⚠️ ENVOYER EST UNE ÉCRITURE — c'était le seul bouton de la
                      barre qui écrit sans lire le moindre droit. Les deux boutons
                      de PDF, eux, restent ouverts à la lecture. */}
                  {montrerLEcriture && (
                    <Button icon={<MailOutlined />} onClick={handleOpenEmailModal}>
                      {t('invoiceEditor.buttons.sendByEmail')}
                    </Button>
                  )}
                  <Button icon={<FileSearchOutlined />} onClick={handlePreviewPdf}>
                    {t('invoiceEditor.buttons.viewPdf')}
                  </Button>
                  <Button icon={<FilePdfOutlined />} onClick={handleDownloadPdf}>
                    {t('invoiceEditor.buttons.downloadPdf')}
                  </Button>
                </>
              )}
              {canCreateCredit && (
                <Popconfirm
                  title={t('invoices.creditConfirm', 'Établir un avoir qui contre-passe cette facture ?')}
                  onConfirm={() => creditMutation.mutate(currentInvoiceId)}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                >
                  <Button icon={<RollbackOutlined />} loading={creditMutation.isPending}>
                    {t('invoices.actionCredit', 'Établir un avoir')}
                  </Button>
                </Popconfirm>
              )}
            </>
          )}
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={createMutation.isPending || updateMutation.isPending}
            disabled={!canModify}
          >
            {t('common.save')}
          </Button>
        </Space>
      </div>

      {/* ⚠️ CE QUI EMPÊCHERA DE VALIDER, DIT AVANT LE CLIC.
          Le pont WooCommerce marque une pièce qu'il a trouvée fausse — un écart
          de TVA, un avoir qui ne retombe pas sur ses pieds — et la validation la
          refuse. Le refus arrivait sans que rien ne l'ait annoncé : l'utilisateur
          cliquait « Valider », recevait une erreur, et n'avait aucun moyen de
          savoir que la pièce était marquée depuis des jours. */}
      {invoiceData?.blocked_reason && (
        <Alert
          type="warning"
          showIcon
          banner
          message={t('invoiceEditor.blocked.title', 'Cette pièce ne peut pas être validée')}
          description={invoiceData.blocked_reason}
        />
      )}

      {/* Form Content */}
      <div style={{ flex: 1 }}>
        <div style={{ padding: '24px', paddingBottom: 80 }}>
        <Form form={form} layout="vertical">
          <Row gutter={24}>
            <Col span={6}>
              {isSupplierInvoice ? (
                <>
                  <Form.Item
                    label={t('invoiceEditor.fields.supplier')}
                    required
                    validateStatus={!selectedSupplier && (enregistrementTente || form.isFieldTouched('supplier_id')) ? 'error' : ''}
                    help={!selectedSupplier && (enregistrementTente || form.isFieldTouched('supplier_id')) ? t('invoiceEditor.fields.selectSupplier') : ''}
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Select
                        showSearch
                        placeholder={isLoadingSuppliers ? t('common.loading') : t('invoiceEditor.fields.selectSupplier')}
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
                          // Un fournisseur absent de la liste laisserait la case
                          // vide alors qu'il est bien sur la facture.
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
                      <Tooltip title={t('invoiceEditor.fields.openSupplier')}>
                        <Button
                          icon={<SearchOutlined />}
                          onClick={() => {
                            if (selectedSupplier) {
                              openDocumentTab('supplier', selectedSupplier.id, `${t('invoiceEditor.tab.supplier')} ${selectedSupplier.name}`)
                            }
                          }}
                          disabled={!selectedSupplier}
                        />
                      </Tooltip>
                    </Space.Compact>
                  </Form.Item>
                  {/* ⚠️ Sans message explicite, antd compose le sien avec le NOM
                      TECHNIQUE du champ : « Le champ supplier_id est
                      obligatoire » s'affichait à l'utilisateur. */}
                  <Form.Item
                    name="supplier_id"
                    hidden
                    rules={[{ required: true, message: t('invoiceEditor.fields.supplierRequired', 'Le fournisseur est obligatoire') }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="supplier_invoice_number"
                    label={t('invoiceEditor.fields.supplierInvoiceNumber')}
                    tooltip={t('invoiceEditor.fields.supplierInvoiceNumberTooltip')}
                    required
                    rules={[{ required: true, message: t('invoiceEditor.fields.supplierInvoiceNumberRequired') }]}
                  >
                    <Input
                      placeholder={t('invoiceEditor.fields.supplierInvoiceNumberPlaceholder')}
                      disabled={!canModify}
                      onBlur={(e) => verifierDoublon(e.target.value)}
                    />
                  </Form.Item>
                  {doublonFournisseur && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginTop: -12, marginBottom: 16 }}
                      message={t('invoiceEditor.duplicate.title', 'Ce numéro existe déjà')}
                      description={t(
                        'invoiceEditor.duplicate.body',
                        'Une facture portant ce numéro est déjà en base ({{internalNumber}}), enregistrée le {{date}}. Vérifiez que vous ne la saisissez pas une seconde fois.',
                        {
                          internalNumber: doublonFournisseur.internal_number || '—',
                          date: doublonFournisseur.created_at
                            ? dayjs(doublonFournisseur.created_at).format('DD/MM/YYYY')
                            : '—',
                        }
                      )}
                    />
                  )}
                </>
              ) : (
                <>
                  <Form.Item
                    label={t('invoiceEditor.fields.client')}
                    required
                    validateStatus={!selectedClient && (enregistrementTente || form.isFieldTouched('client_id')) ? 'error' : ''}
                    help={!selectedClient && (enregistrementTente || form.isFieldTouched('client_id'))
                      ? t('invoiceEditor.fields.clientRequired', 'Le client est obligatoire')
                      : ''}
                  >
                    <Space.Compact style={{ width: '100%' }}>
                      <Select
                        showSearch
                        placeholder={isLoadingClients ? t('common.loading') : t('invoiceEditor.fields.selectClient')}
                        optionFilterProp="label"
                        loading={isLoadingClients}
                        value={selectedClient?.id}
                        onChange={handleClientChange}
                        options={(() => {
                          const options: Array<{ value: string; label: string }> = (
                            clientsData?.data || []
                          ).map((c: Client) => ({
                            value: c.id,
                            label: `${c.code} - ${c.name}`,
                          }))
                          // Ant Design n'affiche que ce qu'il trouve dans les
                          // options : un client absent de la liste laisserait la
                          // case vide alors qu'il est bien sur la facture.
                          if (selectedClient && !options.some((o) => o.value === selectedClient.id)) {
                            options.unshift({
                              value: selectedClient.id,
                              label: `${selectedClient.code} - ${selectedClient.name}`,
                            })
                          }
                          return options
                        })()}
                        style={{ flex: 1 }}
                        disabled={!canModify}
                      />
                      <Tooltip title={t('invoiceEditor.fields.openClient')}>
                        <Button
                          icon={<SearchOutlined />}
                          onClick={handleOpenClient}
                          disabled={!selectedClient}
                        />
                      </Tooltip>
                    </Space.Compact>
                  </Form.Item>
                  {/* ⚠️ Même piège : le nom technique du champ ne se montre pas. */}
                  <Form.Item
                    name="client_id"
                    hidden
                    rules={[{ required: true, message: t('invoiceEditor.fields.clientRequired', 'Le client est obligatoire') }]}
                  >
                    <Input />
                  </Form.Item>
                  {/* Devis lié - affiché uniquement si la facture est liée à un devis */}
                  {invoiceData?.quote_id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <Typography.Text type="secondary">{t('invoiceEditor.fields.linkedQuote')}</Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => openDocumentTab('quote', invoiceData.quote_id!, t('invoiceEditor.tab.quote'))}
                        style={{ padding: 0 }}
                      >
                        {t('invoiceEditor.fields.viewQuote')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </Col>
            <Col span={6}>
              <Form.Item label={t('invoiceEditor.fields.billingAddress')}>
                <Input.TextArea
                  value={isSupplierInvoice
                    ? (selectedSupplier ? [
                        selectedSupplier.name,
                        selectedSupplier.address_line1,
                        selectedSupplier.address_line2,
                        [selectedSupplier.postal_code, selectedSupplier.city].filter(Boolean).join(' '),
                        selectedSupplier.country
                      ].filter(Boolean).join('\n') : '')
                    : (selectedClient ? [
                        selectedClient.name,
                        selectedClient.address_line1,
                        selectedClient.address_line2,
                        [selectedClient.postal_code, selectedClient.city].filter(Boolean).join(' '),
                        selectedClient.country
                      ].filter(Boolean).join('\n') : '')
                  }
                  disabled
                  rows={5}
                  style={{ backgroundColor: token.colorFillTertiary }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="delivery_address" label={t('invoiceEditor.fields.deliveryAddress')}>
                <Input.TextArea
                  rows={5}
                  placeholder={t('invoiceEditor.fields.deliveryAddressPlaceholder')}
                  disabled={!canModify}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item
                    name="date"
                    label={t('common.date')}
                    rules={[{ required: true, message: t('invoiceEditor.fields.dateRequired') }]}
                  >
                    <DatePicker
                      style={{ width: '100%' }}
                      format="DD/MM/YYYY"
                      disabled={!canModify}
                      onChange={(date) => {
                        // Recalculate due_date when date changes
                        if (date && selectedPaymentTermId) {
                          const term = paymentTermsData?.payment_terms?.find((item: { id: string }) => item.id === selectedPaymentTermId)
                          if (term) {
                            form.setFieldValue('due_date', date.add(term.days, 'day'))
                          }
                        }
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="due_date"
                    label={t('invoiceEditor.fields.dueDate')}
                    rules={[{ required: true, message: t('invoiceEditor.fields.dateRequired') }]}
                  >
                    <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" disabled={!canModify} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t('invoiceEditor.fields.paymentTerm')} style={{ marginBottom: 8 }}>
                <Select
                  allowClear
                  placeholder={t('invoiceEditor.fields.selectPaymentTerm')}
                  disabled={!canModify}
                  value={selectedPaymentTermId}
                  onChange={(value) => {
                    setSelectedPaymentTermId(value)
                    if (value) {
                      const term = paymentTermsData?.payment_terms?.find((term: PaymentTerm) => term.id === value)
                      if (term) {
                        // Calculate due date = date + days
                        const invoiceDate = form.getFieldValue('date')
                        if (invoiceDate) {
                          form.setFieldValue('due_date', dayjs(invoiceDate).add(term.days, 'day'))
                        }
                        // Store payment terms label for PDF
                        form.setFieldValue('payment_terms', term.label)
                      }
                    } else {
                      form.setFieldValue('payment_terms', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {paymentTermsData?.payment_terms?.map((term: PaymentTerm) => (
                    <Select.Option key={term.id} value={term.id}>
                      {term.label} ({term.days === 0 ? t('invoiceEditor.fields.cash') : t('invoiceEditor.fields.daysSuffix', { days: term.days })})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row>
            <Col span={24}>
              <Form.Item name="subject" label={t('invoiceEditor.fields.subject')} rules={[{ required: true, message: t('invoiceEditor.fields.subjectRequired') }]}>
                <Input placeholder={t('invoiceEditor.fields.subjectPlaceholder')} disabled={!canModify} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontWeight: 500, fontSize: 16 }}>{t('invoiceEditor.lines.title')}</span>
          <Space size="middle">
            {selectedRowKeys.length > 0 && (
              <>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteSelection}
                  danger
                  disabled={!canModify}
                >
                  {t('invoiceEditor.lines.deleteSelection', { count: selectedRowKeys.length })}
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={handleDuplicateSelection}
                  disabled={!canModify}
                >
                  {t('invoiceEditor.lines.duplicateSelection', { count: selectedRowKeys.length })}
                </Button>
              </>
            )}
            <Button
              icon={<PlusOutlined />}
              onClick={() => handleAddLine('article')}
              disabled={!canModify}
              style={{ backgroundColor: '#1677ff', borderColor: '#1677ff', color: '#fff' }}
            >
              {t('invoiceEditor.lines.addArticle')}
            </Button>
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleAddLine('text')}
              disabled={!canModify}
              style={{ backgroundColor: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
            >
              {t('invoiceEditor.lines.addText')}
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => handleAddLine('subtotal')}
              disabled={!canModify}
              style={{ backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
            >
              {t('invoiceEditor.lines.addSubtotal')}
            </Button>
            <Button
              icon={<MinusOutlined />}
              onClick={() => handleAddLine('page_break')}
              disabled={!canModify}
              style={{ backgroundColor: '#fa8c16', borderColor: '#fa8c16', color: '#fff' }}
            >
              {t('invoiceEditor.lines.addPageBreak')}
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
          <Form.Item name="notes" label={t('invoiceEditor.fields.notes')}>
            <Input.TextArea rows={3} placeholder={t('invoiceEditor.fields.notesPlaceholder')} disabled={!canModify} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label={t('invoiceEditor.fields.footer')}>
                <Select
                  allowClear
                  placeholder={t('invoiceEditor.fields.selectFooter')}
                  disabled={!canModify}
                  value={selectedFooterId}
                  onChange={(footerId) => {
                    setSelectedFooterId(footerId || null)
                    const footers = Array.isArray(footersData) ? footersData : (footersData?.data || [])
                    const footer = footers.find((f: { id: string }) => f.id === footerId)
                    if (footer) {
                      form.setFieldValue('footer_content', footer.content)
                    } else {
                      form.setFieldValue('footer_content', '')
                    }
                    setTabDirty(tabId, true)
                  }}
                >
                  {(Array.isArray(footersData) ? footersData : (footersData?.data || [])).map((footer: { id: string; name: string }) => (
                    <Select.Option key={footer.id} value={footer.id}>
                      {footer.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="footer_content" label={t('invoiceEditor.fields.footerContent')}>
                <Input.TextArea
                  rows={3}
                  placeholder={t('invoiceEditor.fields.footerContentPlaceholder')}
                  disabled={!canModify}
                  onChange={() => setTabDirty(tabId, true)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        {/* Tabs: Paiements et Documents liés */}
        {currentInvoiceId && (
          <Tabs
            defaultActiveKey="payments"
            items={[
              {
                key: 'payments',
                label: (
                  <Space>
                    <BankOutlined />
                    {t('invoiceEditor.payments.title')}
                    {payments.length > 0 && <Tag color="green">{payments.length}</Tag>}
                  </Space>
                ),
                children: (
                  <div>
                    {/* Le seul chemin de saisie d'un règlement dans tout l'ERP :
                        sans lui, seule la trésorerie pouvait solder une facture,
                        et rien du tout ne soldait une facture fournisseur. */}
                    {/* ⚠️ Masqué à qui n'a pas le droit de tenir la trésorerie :
                        le serveur exige « amsbm_reconcile_bank » sur cette route,
                        et le bouton n'aboutissait que sur un refus rouge. */}
                    {montrerLesReglements && (
                      <div style={{ marginBottom: 12 }}>
                        <Button
                          type="primary"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            // ⚠️ LE MONTANT PRÉREMPLI DOIT SOLDER LA PIÈCE, ET
                            // C'EST LE SERVEUR QUI SAIT DANS QUEL SENS.
                            //
                            // « Math.max(0, …) » l'interdisait sur un avoir : on
                            // acceptait 702,00 sur un avoir de 702 €, le reste dû
                            // passait à 1 404 € et la pièce restait « Partielle »
                            // pour toujours. Il fallait deviner « −702 ».
                            //
                            // La convention de signe appartient à PaymentService,
                            // pas à cet écran : /payments rend « suggested_amount »,
                            // signe compris. Le repli ne sert qu'aux sessions
                            // ouvertes avant le déploiement du serveur.
                            const reste = Number(paymentsData?.amount_due ?? 0)
                            const propose = paymentsData?.suggested_amount

                            paymentForm.setFieldsValue({
                              date: dayjs(),
                              method: 'transfer',
                              amount: propose === undefined || propose === null
                                ? (estUnAvoir ? (reste > 0 ? -reste : 0) : Math.max(0, reste))
                                : Number(propose),
                              fee: 0,
                            })
                            setPaymentModalOpen(true)
                          }}
                        >
                          {estUnAvoir
                            ? t('invoiceEditor.payments.addRefund', 'Enregistrer un remboursement')
                            : t('invoiceEditor.payments.add', 'Enregistrer un règlement')}
                        </Button>
                      </div>
                    )}
                    {payments.length > 0 ? (
                      <Table
                        size="small"
                        dataSource={payments}
                        rowKey="id"
                        pagination={false}
                        columns={[
                          {
                            title: t('invoiceEditor.payments.account'),
                            dataIndex: 'account_label',
                            key: 'account',
                            width: 200,
                            render: (label: string, record: InvoicePayment) => (
                              <Typography.Text ellipsis style={{ maxWidth: 190 }}>
                                {label || record.account_number || '—'}
                              </Typography.Text>
                            ),
                          },
                          {
                            title: t('common.date'),
                            dataIndex: 'date',
                            key: 'date',
                            width: 110,
                            render: (date: string) => (date ? dayjs(date).format('DD/MM/YYYY') : '—'),
                          },
                          {
                            title: t('invoiceEditor.payments.label'),
                            dataIndex: 'label',
                            key: 'label',
                            ellipsis: true,
                          },
                          {
                            title: t('invoiceEditor.payments.method'),
                            dataIndex: 'method_label',
                            key: 'method',
                            width: 130,
                            render: (value: string) => <Tag>{value}</Tag>,
                          },
                          {
                            title: t('invoiceEditor.payments.amount'),
                            dataIndex: 'amount',
                            key: 'amount',
                            width: 170,
                            align: 'right' as const,
                            render: (amount: number, record: InvoicePayment) => (
                              <div>
                                <Typography.Text strong type={amount < 0 ? 'danger' : 'success'}>
                                  {money(amount)}
                                </Typography.Text>
                                {record.fee > 0 && (
                                  <Typography.Text
                                    type="secondary"
                                    style={{ display: 'block', fontSize: 11, lineHeight: 1.3 }}
                                  >
                                    {t('invoiceEditor.payments.commission', {
                                      fee: money(record.fee),
                                      net: money(record.net_amount),
                                    })}
                                  </Typography.Text>
                                )}
                              </div>
                            ),
                          },
                          {
                            title: t('invoiceEditor.payments.action'),
                            key: 'action',
                            width: 80,
                            align: 'center' as const,
                            render: (_: unknown, record: InvoicePayment) =>
                              record.bank_account_id ? (
                                <Tooltip title={t('invoiceEditor.payments.viewAccount')}>
                                  <Button
                                    type="link"
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={() =>
                                      openDocumentTab(
                                        'bank-account',
                                        record.bank_account_id as string,
                                        t('invoiceEditor.tab.statement')
                                      )
                                    }
                                  />
                                </Tooltip>
                              ) : null,
                          },
                        ]}
                        summary={() => {
                          const total = payments.reduce((sum, p) => sum + p.amount, 0)
                          const due = Number(paymentsData?.amount_due ?? 0)

                          // ⚠️ SUR UN AVOIR, CES DEUX LIGNES DISAIENT LE CONTRAIRE
                          // DE CE QU'ELLES MONTRAIENT. « Total des règlements »
                          // en vert sur un −702,00 € qui est un décaissement, et
                          // « Reste à régler » sur une somme qu'on doit RENDRE.
                          // Le sens de la pièce décide des mots et de la couleur.
                          return (
                            <>
                              <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={4}>
                                  <Typography.Text strong>
                                    {estUnAvoir
                                      ? t('invoiceEditor.payments.totalRefunds', 'Total des remboursements')
                                      : t('invoiceEditor.payments.totalPayments')}
                                  </Typography.Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={4} align="right">
                                  <Typography.Text strong type={total < 0 ? 'danger' : 'success'}>
                                    {money(total)}
                                  </Typography.Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={5} />
                              </Table.Summary.Row>
                              <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={4}>
                                  <Typography.Text type="secondary">
                                    {estUnAvoir
                                      ? t('invoiceEditor.payments.remainingToRefund', 'Reste à rembourser')
                                      : t('invoiceEditor.payments.remaining')}
                                  </Typography.Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={4} align="right">
                                  <Typography.Text type={Math.abs(due) > 0.004 ? 'warning' : 'secondary'}>
                                    {money(due)}
                                  </Typography.Text>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={5} />
                              </Table.Summary.Row>
                            </>
                          )
                        }}
                      />
                    ) : (
                      <p style={{ color: '#999' }}>{t('invoiceEditor.payments.noPayments')}</p>
                    )}
                  </div>
                ),
              },
              {
                key: 'documents',
                label: t('invoiceEditor.tabs.linkedDocuments'),
                children: <DocumentsSection entityType="invoice" entityId={currentInvoiceId} title="" />,
              },
              // ⚠️ LE SUIVI REMPLACE L'ONGLET « CONSULTATIONS ».
              //
              // Savoir que le client a ouvert sa facture est utile ; savoir qui
              // l'a créée, qui l'a validée, qui l'a envoyée et quand elle a été
              // réglée l'est autant. Les consultations n'étaient qu'un cinquième
              // de l'histoire, et deux onglets pour une même chronologie
              // auraient obligé à lire deux fois.
              //
              // ⚠️ ANCIEN COMMENTAIRE, TOUJOURS VRAI :
              //
              // Le serveur note chaque ouverture du lien public — instant, IP,
              // empreinte du contenu — et le sert avec la facture. Aucun écran
              // ne le montrait : la preuve existait en base et ne servait à
              // personne. C'est pourtant exactement ce qu'on cherche le jour où
              // un client affirme n'avoir jamais reçu sa facture.
              //
              // Onglet réservé aux factures CLIENTS : une facture fournisseur
              // n'a pas de lien public, son journal serait vide par nature.
              ...([
                    {
                      key: 'suivi',
                      label: (
                        <span>
                          {t('invoiceEditor.tabs.timeline', 'Suivi')}
                          {journalConsultations.length > 0 && (
                            <Badge
                              count={journalConsultations.length}
                              title={t('invoiceEditor.tabs.viewCount', 'Consultations par le client')}
                              style={{ marginLeft: 8, backgroundColor: token.colorWarning }}
                            />
                          )}
                        </span>
                      ),
                      children: (
                        <SuiviDocument
                          route={isSupplierInvoice ? 'supplier-invoices' : 'invoices'}
                          documentId={currentInvoiceId}
                        />
                      ),
                    },
                  ]),
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
          {/* ⚠️ Achat, marge et vente n'ont de sens que sur une facture CLIENT.
              Sur une facture fournisseur, le prix d'achat de la ligne EST son
              prix unitaire : les deux séries portent la même valeur, la carte
              « Marge » affichait donc invariablement « Marge (0 %) — 0,00 € »,
              et « Vente HT » parlait d'une vente qui n'existe pas. */}
          {!isSupplierInvoice && (
            <>
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
                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('invoiceEditor.totals.purchaseHT')}</div>
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
                  {t('invoiceEditor.totals.margin', { percent: totals.marginPercent })}
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

              {/* Prix de vente HT (avant remise globale) */}
              <Card
                size="small"
                style={{
                  background: '#e6f7ff',
                  borderColor: '#91d5ff',
                  minWidth: 140,
                }}
                bodyStyle={{ padding: '8px 12px' }}
              >
                <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('invoiceEditor.totals.saleHT')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
                  {totals.totalSaleHTBeforeDiscount.toFixed(2)} €
                </div>
              </Card>
            </>
          )}

          {/* Sur une facture d'ACHAT, la même somme s'appelle « Total HT » : le
              bandeau n'en portait aucune, et l'on passait directement de la
              remise au net sans jamais voir le brut sur lequel elle s'applique. */}
          {isSupplierInvoice && (
            <Card
              size="small"
              style={{
                background: '#e6f7ff',
                borderColor: '#91d5ff',
                minWidth: 140,
              }}
              bodyStyle={{ padding: '8px 12px' }}
            >
              <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>
                {t('invoiceEditor.totals.grossHT', 'Total HT')}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>
                {totals.totalSaleHTBeforeDiscount.toFixed(2)} €
              </div>
            </Card>
          )}

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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('invoiceEditor.totals.globalDiscount')}</div>
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
            <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('invoiceEditor.totals.netHT')}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#13c2c2' }}>
              {totals.totalSaleHT.toFixed(2)} €
            </div>
          </Card>

          {/* Acompte HT - Only show if deposit exists */}
          {totals.depositHT > 0 && (
            <Card
              size="small"
              style={{
                background: '#fff2e8',
                borderColor: '#ffbb96',
                minWidth: 140,
              }}
              bodyStyle={{ padding: '8px 12px' }}
            >
              <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>{t('invoiceEditor.totals.depositHT')}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#fa541c' }}>
                -{totals.depositHT.toFixed(2)} €
              </div>
            </Card>
          )}

          {/* TVA */}
          <Card
            size="small"
            style={{ minWidth: 160 }}
            bodyStyle={{ padding: '8px 12px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#8c8c8c' }}>{t('invoiceEditor.totals.globalVat')}</span>
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
                  filteredVatRates.length > 0
                    ? filteredVatRates.map((r: VATRate) => ({ value: r.rate, label: r.code }))
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
              {t('invoiceEditor.totals.totalTTC')}
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
            <span>{t('invoiceEditor.pdf.previewTitle', { number: invoiceData?.number || '' })}</span>
            <Space size="small">
              <Button size="small" onClick={() => setModalSize({ width: 600, height: 60 })}>
                {t('invoiceEditor.pdf.sizeSmall')}
              </Button>
              <Button size="small" onClick={() => setModalSize({ width: 900, height: 80 })}>
                {t('invoiceEditor.pdf.sizeMedium')}
              </Button>
              <Button size="small" onClick={() => setModalSize({ width: 1200, height: 90 })}>
                {t('invoiceEditor.pdf.sizeLarge')}
              </Button>
              <Button size="small" onClick={() => setModalSize({ width: window.innerWidth - 100, height: 95 })}>
                {t('invoiceEditor.pdf.sizeFullscreen')}
              </Button>
            </Space>
          </div>
        }
        open={pdfPreviewOpen}
        onCancel={closePdfPreview}
        width={modalSize.width}
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
            {t('invoiceEditor.pdf.download')}
          </Button>,
        ]}
        centered
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {pdfPreviewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p>{t('invoiceEditor.pdf.loading')}</p>
          </div>
        ) : pdfPreviewUrl ? (
          <iframe
            src={pdfPreviewUrl}
            style={{ width: '100%', height: `${modalSize.height}vh`, border: 'none' }}
            title={t('invoiceEditor.titlePrefix.client') + ` ${invoiceData?.number}`}
           
          />
        ) : null}
      </Modal>

      {/* Email Send Modal */}
      <Modal
        title={t('invoiceEditor.email.modalTitle', { number: invoiceData?.number || '' })}
        open={emailModalOpen}
        onCancel={() => {
          setEmailModalOpen(false)
          setEmailAddress('')
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setEmailModalOpen(false)
            setEmailAddress('')
          }}>
            {t('common.cancel')}
          </Button>,
          <Button
            key="send"
            type="primary"
            icon={<MailOutlined />}
            loading={emailSending}
            onClick={handleSendEmail}
            disabled={!emailAddress}
          >
            {t('invoiceEditor.email.send')}
          </Button>,
        ]}
        width={500}
      >
        <div style={{ marginBottom: 16 }}>
          <p>{t('invoiceEditor.email.description')}</p>
        </div>
        <Form layout="vertical">
          <Form.Item
            label={t('invoiceEditor.email.recipientLabel')}
            required
            help={selectedClient?.email ? t('invoiceEditor.email.clientEmailHelp', { email: selectedClient.email }) : undefined}
          >
            <Input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder={t('invoiceEditor.email.placeholder')}
              prefix={<MailOutlined />}
              onPressEnter={handleSendEmail}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Saisie d'un règlement — voir addPaymentMutation. */}
      <Modal
        title={estUnAvoir
          ? t('invoiceEditor.payments.addRefund', 'Enregistrer un remboursement')
          : t('invoiceEditor.payments.add', 'Enregistrer un règlement')}
        open={paymentModalOpen}
        onCancel={() => setPaymentModalOpen(false)}
        onOk={handleAddPayment}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={addPaymentMutation.isPending}
        width={520}
        destroyOnClose
      >
        <Form form={paymentForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label={t('invoiceEditor.payments.amount')}
                // Le signe n'est pas une subtilité d'écran : c'est lui qui dit
                // dans quel sens l'argent va, et le serveur refuse l'autre.
                extra={estUnAvoir
                  ? t(
                      'invoiceEditor.payments.creditSignHint',
                      "Un avoir se rembourse : le montant est négatif, l'argent repart."
                    )
                  : undefined}
                rules={[{ required: true, message: t('invoiceEditor.payments.amountRequired', 'Le montant du règlement est obligatoire.') }]}
              >
                <InputNumber style={{ width: '100%' }} precision={2} addonAfter="€" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="date" label={t('common.date')} rules={[{ required: true, message: t('invoiceEditor.payments.dateRequired', 'La date du règlement est obligatoire.') }]}>
                {/* ⚠️ UN RÈGLEMENT NE SE DATE PAS DANS L'AVENIR : il n'a pas
                    encore eu lieu. « 2099-01-01 » passait sans un mot, et le
                    serveur le refuse désormais. Le PASSÉ reste entièrement
                    ouvert — le comptable saisit toujours après coup. */}
                <DatePicker
                  style={{ width: '100%' }}
                  format="DD/MM/YYYY"
                  disabledDate={(courante) => !!courante && courante > dayjs().endOf('day')}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="method" label={t('invoiceEditor.payments.method')}>
                <Select
                  options={[
                    // Les sept moyens de PaymentService::methods(), dans le même
                    // ordre : le serveur n'en accepte pas d'autres.
                    { value: 'transfer', label: t('invoiceEditor.payments.methodTransfer', 'Virement') },
                    { value: 'card', label: t('invoiceEditor.payments.methodCard', 'Carte bancaire') },
                    { value: 'check', label: t('invoiceEditor.payments.methodCheck', 'Chèque') },
                    { value: 'cash', label: t('invoiceEditor.payments.methodCash', 'Espèces') },
                    { value: 'direct', label: t('invoiceEditor.payments.methodDirect', 'Prélèvement') },
                    { value: 'online', label: t('invoiceEditor.payments.methodOnline', 'Paiement en ligne') },
                    { value: 'other', label: t('invoiceEditor.payments.methodOther', 'Autre') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_account_id" label={t('invoiceEditor.payments.account')}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('invoiceEditor.payments.accountPlaceholder', 'Compte bancaire (facultatif)')}
                  options={(bankAccountsData?.data || []).map((c: { id: string; label?: string; iban?: string }) => ({
                    value: c.id,
                    label: c.label || c.iban || c.id,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="reference" label={t('invoiceEditor.payments.reference', 'Référence')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="fee"
                label={t('invoiceEditor.payments.fee', 'Commission')}
                tooltip={t('invoiceEditor.payments.feeTooltip', 'Frais retenus par la plateforme de paiement, le cas échéant.')}
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={2} addonAfter="€" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label={t('invoiceEditor.payments.notes', 'Note')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Price Modification Modal (purchase or sale) */}
      <Modal
        title={priceModalData?.priceType === 'sale' ? t('invoiceEditor.priceModal.titleSale') : t('invoiceEditor.priceModal.titlePurchase')}
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
                ? t('invoiceEditor.priceModal.introSale')
                : t('invoiceEditor.priceModal.introPurchase')} <strong>{priceModalData.articleName}</strong>
            </p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
              <div style={{ flex: 1, padding: 12, background: '#f5f5f5', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('invoiceEditor.priceModal.oldPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#ff4d4f', textDecoration: 'line-through' }}>
                  {priceModalData.oldPrice.toFixed(2)} €
                </div>
              </div>
              <div style={{ flex: 1, padding: 12, background: '#f6ffed', borderRadius: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{t('invoiceEditor.priceModal.newPrice')}</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>
                  {priceModalData.newPrice.toFixed(2)} €
                </div>
              </div>
            </div>
            <p style={{ marginBottom: 16, color: '#666' }}>
              {t('invoiceEditor.priceModal.question')}
            </p>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Button
                type="primary"
                block
                onClick={() => handlePriceModalConfirm(false)}
              >
                {t('invoiceEditor.priceModal.documentOnly')}
              </Button>
              <Button
                type="default"
                block
                onClick={() => handlePriceModalConfirm(true)}
                loading={updateArticleMutation.isPending}
              >
                {t('invoiceEditor.priceModal.documentAndArticle')}
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
