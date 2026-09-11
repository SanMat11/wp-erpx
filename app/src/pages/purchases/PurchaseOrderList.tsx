import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Row,
  Col,
  DatePicker,
  Divider,
  Typography,
  Tooltip,
  Checkbox,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined,
  SearchOutlined,
  FilterOutlined,
  CopyOutlined,
  FileDoneOutlined,
  FilePdfOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { purchaseOrderAPI } from '@/services/api'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useListColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/fr'

dayjs.locale('fr')

const DEFAULT_PO_LIST_WIDTHS = {
  number: 120,
  supplier: 150,
  notes: 200,
  date: 100,
  expected_date: 110,
  status: 110,
  total_ht: 110,
  total_ttc: 110,
  actions: 220,
}

const { RangePicker } = DatePicker
const { Text } = Typography

const _purchaseOrderListVersion = 'v2.0.1'
void _purchaseOrderListVersion

// ⚠️ Ne JAMAIS jeter le motif du serveur.
//
// Les sept actions de cette liste affichaient un libellé générique — « Erreur
// lors de l'annulation » — alors que le serveur explique précisément son refus :
// « le passage de "Soldé" à "Annulé" n'est pas permis », « un document validé ne
// se supprime pas : il a un numéro, et la série doit rester continue ». La
// facturation, elle, lisait « data.error », clé qu'un WP_Error ne porte pas.
// L'intercepteur d'api.ts recopie le message du serveur dans error.message : on
// le prend, et le libellé générique ne sert plus que de dernier recours.
const motifOu = (e: unknown, repli: string): string => {
  const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string }

  return err?.response?.data?.message || err?.response?.data?.error || err?.message || repli
}

interface PurchaseOrderLine {
  id?: string
  line_type?: string
  description?: string
  article_id: string
  article?: {
    id: string
    name: string
    reference: string
  }
  quantity: number
  unit_price: number
  discount_percent?: number
  tva_rate: number
  total_ht: number
  received_quantity?: number
  invoiced_quantity?: number
}

interface PurchaseOrder {
  id: string
  number: string
  supplier_id: string
  supplier?: {
    id: string
    name: string
  }
  date: string
  expected_date?: string
  status: string
  subject?: string
  discount_percent?: number
  discount_amount?: number
  total_ht: number
  total_tva: number
  total_ttc: number
  notes?: string
  lines?: PurchaseOrderLine[]
  created_at: string
  is_archived?: boolean
  is_fully_invoiced?: boolean
}

const statusColors: Record<string, string> = {
  draft: 'default',
  // Un brouillon dont la validation est demandée (voir Documents::outStatus).
  pending_validation: 'orange',
  confirmed: 'blue',
  partial: 'orange',
  received: 'green',
  cancelled: 'red',
}

export default function PurchaseOrderList() {
  const { t } = useTranslation()

  const monthsFr = [
    t('purchaseOrders.monthJanuary'),
    t('purchaseOrders.monthFebruary'),
    t('purchaseOrders.monthMarch'),
    t('purchaseOrders.monthApril'),
    t('purchaseOrders.monthMay'),
    t('purchaseOrders.monthJune'),
    t('purchaseOrders.monthJuly'),
    t('purchaseOrders.monthAugust'),
    t('purchaseOrders.monthSeptember'),
    t('purchaseOrders.monthOctober'),
    t('purchaseOrders.monthNovember'),
    t('purchaseOrders.monthDecember'),
  ]

  const statusLabels: Record<string, string> = {
    draft: t('purchaseOrders.statusDraft'),
    pending_validation: t('purchaseOrders.statusPendingValidation', 'Attente validation'),
    confirmed: t('purchaseOrders.statusConfirmed'),
    partial: t('purchaseOrders.statusPartial'),
    received: t('purchaseOrders.statusReceived'),
    cancelled: t('purchaseOrders.statusCancelled'),
  }

  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false)
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null)
  const [invoicingOrder, setInvoicingOrder] = useState<PurchaseOrder | null>(null)
  const [invoiceLines, setInvoiceLines] = useState<{ line_id: string; selected: boolean; quantity: number; max_quantity: number; description: string }[]>([])
  const [search, setSearch] = useState('')
  // ⚠️ UNE PLAGE DE DATES QUI NE S'EFFACE PAS REND DES COMMANDES INATTEIGNABLES.
  //
  // La plage par défaut couvre douze mois ; une commande datée hors de cette
  // fenêtre — une livraison programmée l'année suivante — n'apparaissait pas,
  // aucun message ne disait qu'un filtre était actif, et le sélecteur n'avait
  // pas de croix pour le lever. Elle est désormais effaçable (null = toutes les
  // dates), et une recherche porte sur TOUTE la base : chercher un numéro qu'on
  // a sous les yeux et s'entendre répondre « Aucune donnée » n'a aucun sens.
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().subtract(11, 'month').startOf('month'),
    dayjs().add(1, 'month').endOf('month'),
  ])
  const [showArchived, setShowArchived] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [receiveForm] = Form.useForm()
  const [invoiceForm] = Form.useForm()
  const queryClient = useQueryClient()

  const { openDocumentTab } = useDocumentTabsStore()
  const { sidebarWidth } = useSidebarStore()
  const { columnWidths, handleResize } = useListColumnWidths('erp_purchase_order_list_widths', DEFAULT_PO_LIST_WIDTHS)

  // ⚠️ « full » sur le module est le seul niveau que la matrice sache dire pour
  // un geste de ce genre — elle ne porte pas « amsbm_cancel_documents » lui-même
  // (voir Settings::levelFor). Elle écarte donc déjà le lecteur et le rédacteur,
  // qui voyaient la croix et n'obtenaient qu'un 403.
  const peutAnnuler = usePermissionStore((etat) => etat.canValidate('purchase_orders'))
  const droitsConnus = usePermissionsChargees()

  // La plage ne s'applique pas pendant une recherche : ce qu'on cherche par son
  // numéro, son objet ou son fournisseur doit se trouver, quelle que soit sa date.
  const plageActive = search === '' && dateRange !== null

  const { data: ordersData, isLoading } = useQuery({
    queryKey: [
      'purchase-orders',
      search,
      plageActive ? dateRange![0].format('YYYY-MM-DD') : '',
      plageActive ? dateRange![1].format('YYYY-MM-DD') : '',
      showArchived,
    ],
    queryFn: () => {
      const params: Record<string, unknown> = {
        page: 1,
        page_size: 10000,
      }
      if (plageActive) {
        params.date_from = dateRange![0].format('YYYY-MM-DD')
        params.date_to = dateRange![1].format('YYYY-MM-DD')
      }
      if (search) {
        params.search = search
      }
      if (showArchived) {
        params.show_archived = true
      }
      return purchaseOrderAPI.list(params)
    },
    // La liste se remet à jour au retour sur la fenêtre : une réception ou une
    // facturation passée depuis un autre poste changeait le statut sans que cet
    // écran en sache rien jusqu'à la réouverture de l'onglet. Pas de minuteur
    // ici : ces changements viennent de l'intérieur du produit, qui invalide
    // déjà « purchase-orders » à chaque écriture.
    refetchOnWindowFocus: true,
  })

  const orders: PurchaseOrder[] = ordersData?.data?.data || []

  // Group orders by month with subtotals
  const groupedOrders = useMemo(() => {
    const groups: {
      key: string
      year: number
      month: number
      orders: PurchaseOrder[]
      totalHT: number
      totalTVA: number
      totalTTC: number
    }[] = []
    const groupMap = new Map<string, PurchaseOrder[]>()

    const sorted = [...orders].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf())

    sorted.forEach((order) => {
      const date = dayjs(order.date)
      const key = `${date.year()}-${String(date.month()).padStart(2, '0')}`
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
      }
      groupMap.get(key)!.push(order)
    })

    groupMap.forEach((orders, key) => {
      const [year, month] = key.split('-').map(Number)
      const totalHT = orders.reduce((sum, o) => sum + (o.total_ht || 0), 0)
      const totalTVA = orders.reduce((sum, o) => sum + (o.total_tva || 0), 0)
      const totalTTC = orders.reduce((sum, o) => sum + (o.total_ttc || 0), 0)
      groups.push({
        key,
        year,
        month,
        orders,
        totalHT,
        totalTVA,
        totalTTC,
      })
    })

    groups.sort((a, b) => b.key.localeCompare(a.key))
    return groups
  }, [orders])

  // Grand totals
  const grandTotals = useMemo(() => {
    return {
      count: orders.length,
      totalHT: orders.reduce((sum, o) => sum + (o.total_ht || 0), 0),
      totalTVA: orders.reduce((sum, o) => sum + (o.total_tva || 0), 0),
      totalTTC: orders.reduce((sum, o) => sum + (o.total_ttc || 0), 0),
    }
  }, [orders])

  const formatCurrency = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.delete(id),
    onSuccess: () => {
      message.success(t('purchaseOrders.deleteSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (e) => message.error(motifOu(e, t('purchaseOrders.deleteError'))),
  })

  const confirmMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.confirm(id),
    onSuccess: () => {
      message.success(t('purchaseOrders.confirmSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (e) => message.error(motifOu(e, t('purchaseOrders.confirmError'))),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.cancel(id),
    onSuccess: () => {
      message.success(t('purchaseOrders.cancelSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (e) => message.error(motifOu(e, t('purchaseOrders.cancelError'))),
  })

  const receiveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      purchaseOrderAPI.receive(id, data),
    onSuccess: () => {
      message.success(t('purchaseOrders.receiveSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['stock'], refetchType: 'all' })
      // ⚠️ La réception qu'on vient de créer doit paraître SANS DÉLAI dans
      // l'écran des réceptions, même s'il est ouvert dans un autre onglet.
      queryClient.invalidateQueries({ queryKey: ['receipts'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['stock-levels'], refetchType: 'all' })
      setIsReceiveModalOpen(false)
      setReceivingOrder(null)
      receiveForm.resetFields()
    },
    onError: (e) => message.error(motifOu(e, t('purchaseOrders.receiveError'))),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => purchaseOrderAPI.duplicate(id),
    onSuccess: (response) => {
      message.success(t('purchaseOrders.duplicateSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      openDocumentTab('purchase-order', response.data.id, t('purchaseOrders.tabTitle', { number: response.data.number }))
    },
    onError: (e) => {
      message.error(motifOu(e, t('purchaseOrders.duplicateError')))
    },
  })

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => purchaseOrderAPI.archive(id, archived),
    onSuccess: (_, variables) => {
      message.success(variables.archived ? t('purchaseOrders.archiveSuccess') : t('purchaseOrders.unarchiveSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
    onError: (e) => {
      message.error(motifOu(e, t('purchaseOrders.archiveError')))
    },
  })

  const archiveBulkMutation = useMutation({
    mutationFn: ({ ids, archived }: { ids: string[]; archived: boolean }) => purchaseOrderAPI.archiveBulk(ids, archived),
    onSuccess: (_, variables) => {
      message.success(variables.archived
        ? t('purchaseOrders.archiveBulkSuccess', { count: variables.ids.length })
        : t('purchaseOrders.unarchiveBulkSuccess', { count: variables.ids.length }))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      setSelectedRowKeys([])
    },
    onError: (e) => {
      message.error(motifOu(e, t('purchaseOrders.archiveError')))
    },
  })

  const createInvoiceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      purchaseOrderAPI.createInvoice(id, data),
    onSuccess: (response) => {
      message.success(t('purchaseOrders.invoiceCreateSuccess'))
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setIsInvoiceModalOpen(false)
      setInvoicingOrder(null)
      invoiceForm.resetFields()
      // Ouvrir la facture créée
      const invoice = response.data
      openDocumentTab('supplier-invoice', invoice.id, t('purchaseOrders.invoiceTabTitle', { number: invoice.number }))
    },
    onError: (e) => {
      message.error(motifOu(e, t('purchaseOrders.invoiceCreateError')))
    },
  })

  const handleCreate = () => {
    openDocumentTab('purchase-order')
  }

  const handleEdit = (order: PurchaseOrder) => {
    openDocumentTab('purchase-order', order.id, t('purchaseOrders.tabTitle', { number: order.number }))
  }

  const handleDownloadPdf = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderAPI.getPdf(order.id)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Commande-${order.number}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('purchaseOrders.pdfDownloaded'))
    } catch {
      message.error(t('purchaseOrders.pdfError'))
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
  const handleViewPdf = async (order: PurchaseOrder) => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const response = await purchaseOrderAPI.getPdf(order.id)
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
      message.error(t('purchaseOrders.pdfError'))
    }
  }

  // ⚠️ UN SEUL CLIC OUVRE LA COMMANDE, DANS SON ÉDITEUR.
  //
  // Il fallait un double-clic. La colonne « Actions » et la case de sélection,
  // elles, n'ouvrent pas : cocher une ligne pour l'archiver ouvrirait un onglet
  // par-dessus, et chaque bouton d'action déclencherait deux gestes à la fois.
  // La colonne « Actions » arrête l'événement dans sa propre cellule (onCell).
  const ouvrirDepuisLaLigne = (order: PurchaseOrder) => (event: React.MouseEvent<HTMLElement>) => {
    const cellule = (event.target as HTMLElement).closest('td')
    if (cellule?.classList.contains('ant-table-selection-column')) return
    handleEdit(order)
  }

  const handleReceive = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderAPI.get(order.id)
      setReceivingOrder(response.data)
      // ⚠️ ON NE RÉCEPTIONNE QUE DE LA MARCHANDISE.
      //
      // Toutes les lignes étaient proposées, sous-totaux et sauts de page
      // compris : « Commandé 1 / Restant 1 », nom vide, et il fallait les
      // « recevoir » pour que la commande puisse être soldée — la réception
      // établie portait alors en base une ligne « --- Saut de page --- » livrée
      // à 1. Une ligne déjà soldée n'a rien à faire là non plus.
      const lines = response.data.lines
        ?.filter((line: PurchaseOrderLine) => !line.line_type || line.line_type === 'article')
        .map((line: PurchaseOrderLine) => ({
          line_id: line.id,
          article_id: line.article_id,
          // Le nom de l'article, à défaut sa désignation : la colonne restait
          // vide sur toutes les lignes d'une ligne libre, et le magasinier
          // validait des quantités en face de cases blanches.
          article_name: line.article?.name || line.description || '',
          ordered: line.quantity,
          already_received: line.received_quantity || 0,
          remaining: line.quantity - (line.received_quantity || 0),
          quantity: line.quantity - (line.received_quantity || 0),
        }))
        .filter((line: { remaining: number }) => line.remaining > 0) || []

      if (lines.length === 0) {
        message.warning(t('purchaseOrders.allQtyAlreadyReceived', 'Tout ce qui pouvait être réceptionné sur cette commande l\'est déjà.'))
        return
      }

      receiveForm.setFieldsValue({
        date: dayjs(),
        lines,
      })
      setIsReceiveModalOpen(true)
    } catch {
      message.error(t('purchaseOrders.loadError'))
    }
  }

  const handleReceiveSubmit = async () => {
    try {
      const values = await receiveForm.validateFields()
      const lines = values.lines
        .filter((line: { quantity: number }) => line.quantity > 0)
        .map((line: { line_id: string; quantity: number }) => ({
          purchase_order_line_id: line.line_id,
          quantity: line.quantity,
        }))

      if (lines.length === 0) {
        message.warning(t('purchaseOrders.receiveQuantityWarning'))
        return
      }

      receiveMutation.mutate({
        id: receivingOrder!.id,
        data: {
          date: values.date.toISOString(),
          lines,
        },
      })
    } catch {
      // Validation error
    }
  }

  // Ouvrir le modal de création de facture
  const handleOpenInvoiceModal = async (order: PurchaseOrder) => {
    try {
      const response = await purchaseOrderAPI.get(order.id)
      const orderData = response.data

      // Préparer les lignes avec les quantités disponibles à facturer (reçu - déjà facturé)
      const linesToInvoice = orderData.lines
        ?.filter((line: PurchaseOrderLine) => line.line_type === 'article' || !line.line_type)
        .filter((line: PurchaseOrderLine) => {
          const received = line.received_quantity || 0
          const invoiced = line.invoiced_quantity || 0
          return received > invoiced
        })
        .map((line: PurchaseOrderLine) => {
          const received = line.received_quantity || 0
          const invoiced = line.invoiced_quantity || 0
          const available = received - invoiced
          return {
            line_id: line.id!,
            selected: true,
            quantity: available,
            max_quantity: available,
            description: line.article?.name || line.description || '',
          }
        }) || []

      if (linesToInvoice.length === 0) {
        message.warning(t('purchaseOrders.noQuantityToInvoice'))
        return
      }

      setInvoicingOrder(orderData)
      setInvoiceLines(linesToInvoice)
      invoiceForm.setFieldsValue({
        invoice_date: dayjs(),
        due_date: dayjs().add(30, 'day'),
        reference: '',
        notes: '',
      })
      setIsInvoiceModalOpen(true)
    } catch {
      message.error(t('purchaseOrders.orderLoadError'))
    }
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
        message.error(t('purchaseOrders.selectLineToInvoice'))
        return
      }

      createInvoiceMutation.mutate({
        id: invoicingOrder!.id,
        data: {
          invoice_date: values.invoice_date.toISOString(),
          due_date: values.due_date?.toISOString(),
          reference: values.reference || '',
          notes: values.notes || '',
          lines: selectedLines,
        },
      })
    } catch {
      // Validation error
    }
  }

  const columns: ColumnsType<PurchaseOrder> = [
    {
      title: t('purchaseOrders.colNumber'),
      dataIndex: 'number',
      key: 'number',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (a.number || '').localeCompare(b.number || ''),
      width: columnWidths.number,
      onHeaderCell: () => ({
        width: columnWidths.number,
        onResize: handleResize('number'),
      }),
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: t('purchaseOrders.colSupplier'),
      dataIndex: 'supplier',
      key: 'supplier',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (a.supplier?.name || '').localeCompare(b.supplier?.name || ''),
      width: columnWidths.supplier,
      onHeaderCell: () => ({
        width: columnWidths.supplier,
        onResize: handleResize('supplier'),
      }),
      render: (supplier) => supplier?.name || '-',
    },
    {
      title: t('purchaseOrders.colSubject'),
      dataIndex: 'subject',
      key: 'subject',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (a.subject || '').localeCompare(b.subject || ''),
      width: columnWidths.notes,
      ellipsis: true,
      onHeaderCell: () => ({
        width: columnWidths.notes,
        onResize: handleResize('notes'),
      }),
      render: (v) => v || '-',
    },
    {
      title: t('common.date'),
      dataIndex: 'date',
      key: 'date',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      width: columnWidths.date,
      onHeaderCell: () => ({
        width: columnWidths.date,
        onResize: handleResize('date'),
      }),
      render: (date) => dayjs(date).format('DD/MM/YYYY'),
    },
    {
      title: t('purchaseOrders.colExpectedDate'),
      dataIndex: 'expected_date',
      key: 'expected_date',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => dayjs(a.expected_date || 0).valueOf() - dayjs(b.expected_date || 0).valueOf(),
      width: columnWidths.expected_date,
      onHeaderCell: () => ({
        width: columnWidths.expected_date,
        onResize: handleResize('expected_date'),
      }),
      render: (date) => (date ? dayjs(date).format('DD/MM/YYYY') : '-'),
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (statusLabels[a.status] || a.status).localeCompare(statusLabels[b.status] || b.status),
      width: columnWidths.status,
      onHeaderCell: () => ({
        width: columnWidths.status,
        onResize: handleResize('status'),
      }),
      render: (status, record) => (
        <Space size={4}>
          <Tag color={statusColors[status]}>{statusLabels[status] || status}</Tag>
          {record.is_archived && <Tag color="default">{t('purchaseOrders.archived')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('purchaseOrders.colTotalHT'),
      dataIndex: 'total_ht',
      key: 'total_ht',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (a.total_ht || 0) - (b.total_ht || 0),
      width: columnWidths.total_ht,
      align: 'right',
      onHeaderCell: () => ({
        width: columnWidths.total_ht,
        onResize: handleResize('total_ht'),
      }),
      render: (value) => `${value?.toFixed(2) || '0.00'} €`,
    },
    {
      title: t('purchaseOrders.colTotalTTC'),
      dataIndex: 'total_ttc',
      key: 'total_ttc',
      sorter: (a: PurchaseOrder, b: PurchaseOrder) => (a.total_ttc || 0) - (b.total_ttc || 0),
      width: columnWidths.total_ttc,
      align: 'right',
      onHeaderCell: () => ({
        width: columnWidths.total_ttc,
        onResize: handleResize('total_ttc'),
      }),
      render: (value) => `${value?.toFixed(2) || '0.00'} €`,
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: columnWidths.actions,
      onHeaderCell: () => ({
        width: columnWidths.actions,
        onResize: handleResize('actions'),
      }),
      // Un clic dans cette colonne n'ouvre pas la commande : les boutons
      // d'action — et les confirmations qu'ils portent — sont ici, et le clic
      // de ligne les doublerait d'une ouverture d'onglet.
      onCell: () => ({ onClick: (event: React.MouseEvent) => event.stopPropagation() }),
      render: (_, record) => (
        <Space size="small">
          <Tooltip title={t('purchaseOrders.actionViewPdf', 'Voir le PDF')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleViewPdf(record)}
            />
          </Tooltip>
          <Tooltip title={t('purchaseOrders.actionDownloadPdf')}>
            <Button
              type="text"
              icon={<FilePdfOutlined />}
              size="small"
              onClick={() => handleDownloadPdf(record)}
            />
          </Tooltip>
          <Tooltip title={t('purchaseOrders.actionDuplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              size="small"
              onClick={() => duplicateMutation.mutate(record.id)}
            />
          </Tooltip>
          <Tooltip title={record.is_archived ? t('purchaseOrders.actionUnarchive') : t('purchaseOrders.actionArchive')}>
            <Button
              type="text"
              icon={<InboxOutlined />}
              size="small"
              onClick={() => archiveMutation.mutate({ id: record.id, archived: !record.is_archived })}
              style={{ color: record.is_archived ? undefined : '#999' }}
            />
          </Tooltip>
          {/* ⚠️ LE CRAYON NE SE FIGE PLUS, ET NE DISPARAÎT PLUS. Il n'était
              rendu que sur un brouillon : une commande confirmée ne pouvait
              alors plus s'ouvrir du tout, alors que la consulter est le geste
              le plus courant. Ouvrir est toujours permis — c'est l'ÉDITEUR qui
              décide de ce qui s'écrit, et il le fait déjà (champs éteints,
              étiquette « Non modifiable »). Le crayon fait donc exactement ce
              que fait le clic sur la ligne, et son infobulle le dit. */}
          <Tooltip title={record.status === 'draft' ? t('common.edit') : t('common.open', 'Ouvrir')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          {record.status === 'draft' && (
            <>
              <Tooltip title={t('common.confirm')}>
                <Button
                  type="text"
                  icon={<CheckOutlined />}
                  size="small"
                  style={{ color: '#1890ff' }}
                  onClick={() => confirmMutation.mutate(record.id)}
                />
              </Tooltip>
              <Popconfirm
                title={t('purchaseOrders.deleteConfirm')}
                onConfirm={() => deleteMutation.mutate(record.id)}
                okText={t('common.yes')}
                cancelText={t('common.no')}
              >
                <Tooltip title={t('common.delete')}>
                  <Button type="text" icon={<DeleteOutlined />} size="small" danger />
                </Tooltip>
              </Popconfirm>
            </>
          )}
          {(record.status === 'confirmed' || record.status === 'partial') && (
            <Tooltip title={t('purchaseOrders.actionReceive')}>
              <Button
                type="primary"
                icon={<InboxOutlined />}
                size="small"
                onClick={() => handleReceive(record)}
              />
            </Tooltip>
          )}
          {(record.status === 'partial' || record.status === 'received') && (
            <Tooltip title={record.is_fully_invoiced ? t('purchaseOrders.fullyInvoiced') : t('purchaseOrders.actionConvertToInvoice')}>
              <Button
                icon={<FileDoneOutlined />}
                size="small"
                onClick={() => handleOpenInvoiceModal(record)}
                disabled={record.is_fully_invoiced}
                style={record.is_fully_invoiced
                  ? { backgroundColor: '#d9d9d9', borderColor: '#d9d9d9', color: '#999' }
                  : { backgroundColor: '#52c41a', borderColor: '#52c41a', color: '#fff' }
                }
              />
            </Tooltip>
          )}
          {/* ⚠️ ON N'OFFRE PAS UN GESTE QU'ON SAIT REFUSÉ.
              « POST /purchase-orders/{id}/cancel » exige le droit d'annuler des
              pièces (voir la table des routes d'Api.php) : la croix rouge
              s'affichait pour tout le monde et rendait 403 à qui ne l'a pas —
              un lecteur, un rédacteur. On lit donc les droits avant de la poser.

              ⚠️ ET TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN. La matrice arrive
              par un appel ; avant sa réponse, canValidate() rend « faux » pour
              tout le monde. Sans « droitsConnus », la croix disparaîtrait une
              seconde chez celui qui y a droit puis reviendrait — on croirait
              l'écran instable. */}
          {record.status === 'confirmed' && (!droitsConnus || peutAnnuler) && (
            <Popconfirm
              title={t('purchaseOrders.cancelConfirm')}
              onConfirm={() => cancelMutation.mutate(record.id)}
              okText={t('common.yes')}
              cancelText={t('common.no')}
            >
              <Tooltip title={t('common.cancel')}>
                <Button
                  type="text"
                  icon={<CloseOutlined />}
                  size="small"
                  danger
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ paddingBottom: 120 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('purchaseOrders.title')}</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('purchaseOrders.newOrder')}
        </Button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input
          placeholder={t('purchaseOrders.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <RangePicker
          placeholder={[t('purchaseOrders.dateFrom'), t('purchaseOrders.dateTo')]}
          format="DD/MM/YYYY"
          value={dateRange}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([dates[0], dates[1]])
            } else {
              setDateRange(null)
            }
          }}
          allowClear
          style={{ width: 280 }}
        />
        {plageActive && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('purchaseOrders.dateRangeNotice', 'Seules les commandes de cette période sont affichées.')}
          </Text>
        )}
        <Checkbox
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        >
          {t('purchaseOrders.showArchived')}
        </Checkbox>
        {selectedRowKeys.length > 0 && (
          <Button
            icon={<InboxOutlined />}
            onClick={() => archiveBulkMutation.mutate({ ids: selectedRowKeys as string[], archived: true })}
          >
            {t('purchaseOrders.archiveSelected', { count: selectedRowKeys.length })}
          </Button>
        )}
        {search && (
          <Button
            icon={<FilterOutlined />}
            onClick={() => {
              setSearch('')
            }}
          >
            {t('purchaseOrders.clearSearch')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Table loading={true} columns={columns} dataSource={[]} />
      ) : (
        <div>
          {groupedOrders.map((group) => (
            <div key={group.key} style={{ marginBottom: 24 }}>
              <div
                style={{
                  background: '#f5f5f5',
                  padding: '8px 16px',
                  fontWeight: 600,
                  fontSize: 15,
                  borderRadius: '4px 4px 0 0',
                  borderBottom: '2px solid #fa8c16',
                }}
              >
                {`${monthsFr[group.month]} ${group.year}`}
              </div>
              <Table
                columns={columns}
                dataSource={group.orders}
                rowKey="id"
                pagination={false}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                }}
                components={{ header: { cell: ResizableHeaderCell } }}
                bordered
                size="small"
                onRow={(record) => ({
                  onClick: ouvrirDepuisLaLigne(record),
                  style: { cursor: 'pointer' },
                })}
              />
              {/* Sous-totaux du mois - alignés avec les colonnes */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ background: '#fff7e6', fontWeight: 600 }}>
                    <td style={{ width: 40, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.number, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.supplier, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.notes, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.date, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.expected_date, padding: '8px', border: '1px solid #ffd591' }}></td>
                    <td style={{ width: columnWidths.status, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {t('purchaseOrders.subtotal')}
                    </td>
                    <td style={{ width: columnWidths.total_ht, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {formatCurrency(group.totalHT)} €
                    </td>
                    <td style={{ width: columnWidths.total_ttc, padding: '8px', border: '1px solid #ffd591', textAlign: 'right' }}>
                      {formatCurrency(group.totalTTC)} €
                    </td>
                    <td style={{ width: columnWidths.actions, padding: '8px', border: '1px solid #ffd591' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {groupedOrders.length === 0 && (
            <Table columns={columns} dataSource={[]} />
          )}

          {/* Totaux généraux - fixed */}
          {groupedOrders.length > 0 && (
            <div
              style={{
                background: '#fff7e6',
                padding: '16px 24px',
                borderRadius: 0,
                border: '2px solid #fa8c16',
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
                {t('purchaseOrders.grandTotals', { count: grandTotals.count })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('purchaseOrders.totalHT')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalHT)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('purchaseOrders.totalTVA')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalTVA)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('purchaseOrders.totalTTC')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#fa8c16' }}>{formatCurrency(grandTotals.totalTTC)} €</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Receive Modal */}
      <Modal
        title={t('purchaseOrders.receiveModalTitle', { number: receivingOrder?.number })}
        open={isReceiveModalOpen}
        onOk={handleReceiveSubmit}
        onCancel={() => {
          setIsReceiveModalOpen(false)
          setReceivingOrder(null)
          receiveForm.resetFields()
        }}
        width={700}
        okText={t('purchaseOrders.validateReceipt')}
        cancelText={t('common.cancel')}
      >
        <Form form={receiveForm} layout="vertical">
          <Form.Item
            name="date"
            label={t('purchaseOrders.receiptDate')}
            rules={[{ required: true, message: t('purchaseOrders.selectDate') }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>

          <Divider>{t('purchaseOrders.articlesToReceive')}</Divider>

          <Form.List name="lines">
            {(fields) => (
              <div>
                {fields.map(({ key, name }) => (
                  <Row gutter={16} key={key} align="middle" style={{ marginBottom: 8 }}>
                    <Col span={10}>
                      <Form.Item noStyle name={[name, 'article_name']}>
                        <Input disabled />
                      </Form.Item>
                      <Form.Item hidden name={[name, 'line_id']}>
                        <Input />
                      </Form.Item>
                      <Form.Item hidden name={[name, 'article_id']}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item noStyle name={[name, 'ordered']}>
                        <InputNumber disabled style={{ width: '100%' }} />
                      </Form.Item>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t('purchaseOrders.ordered')}</Text>
                    </Col>
                    <Col span={4}>
                      <Form.Item noStyle name={[name, 'remaining']}>
                        <InputNumber disabled style={{ width: '100%' }} />
                      </Form.Item>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t('purchaseOrders.remaining')}</Text>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        noStyle
                        name={[name, 'quantity']}
                        rules={[{ required: true }]}
                      >
                        <InputNumber
                          min={0}
                          max={receiveForm.getFieldValue(['lines', name, 'remaining'])}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Text type="secondary" style={{ fontSize: 12 }}>{t('purchaseOrders.toReceive')}</Text>
                    </Col>
                  </Row>
                ))}
              </div>
            )}
          </Form.List>

          <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
            <Text type="secondary">
              {t('purchaseOrders.receiveStockNote')}
            </Text>
          </div>
        </Form>
      </Modal>

      {/* Invoice Modal */}
      <Modal
        title={t('purchaseOrders.invoiceModalTitle', { number: invoicingOrder?.number })}
        open={isInvoiceModalOpen}
        onOk={handleCreateInvoice}
        onCancel={() => {
          setIsInvoiceModalOpen(false)
          setInvoicingOrder(null)
          invoiceForm.resetFields()
        }}
        width={700}
        okText={t('purchaseOrders.createInvoice')}
        cancelText={t('common.cancel')}
        confirmLoading={createInvoiceMutation.isPending}
      >
        <Form form={invoiceForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="invoice_date"
                label={t('purchaseOrders.invoiceDate')}
                rules={[{ required: true, message: t('purchaseOrders.dateRequired') }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="due_date" label={t('purchaseOrders.dueDate')}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="reference"
            label={t('purchaseOrders.supplierInvoiceNumber')}
            rules={[{ required: true, message: t('purchaseOrders.supplierInvoiceNumberRequired') }]}
          >
            <Input placeholder={t('purchaseOrders.supplierInvoiceNumberPlaceholder')} />
          </Form.Item>
          <Form.Item name="notes" label={t('purchaseOrders.notes')}>
            <Input.TextArea rows={2} placeholder={t('purchaseOrders.notesPlaceholder')} />
          </Form.Item>
        </Form>

        <Divider>{t('purchaseOrders.linesToInvoice')}</Divider>

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
              title: t('purchaseOrders.colQtyReceived'),
              dataIndex: 'max_quantity',
              key: 'max_quantity',
              width: 100,
              render: (qty: number) => qty.toFixed(2),
            },
            {
              title: t('purchaseOrders.colQtyToInvoice'),
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
      </Modal>
    </div>
  )
}
