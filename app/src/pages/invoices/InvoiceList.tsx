import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Tooltip,
  message,
  DatePicker,
  Popconfirm,
  Checkbox,
  Select,
  Pagination,
} from 'antd'
import {
  PlusOutlined,
  SearchOutlined,
  FilePdfOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  SendOutlined,
  FilterOutlined,
  CopyOutlined,
  RollbackOutlined,
  InboxOutlined,
} from '@ant-design/icons'
import api, { invoiceAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useListColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/fr'

dayjs.locale('fr')

// Clés des mois pour i18n
const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

// Default column widths for invoice list
const DEFAULT_INVOICE_LIST_WIDTHS = {
  number: 140,
  client: 150,
  subject: 200,
  date: 110,
  due_date: 110,
  total_ht: 120,
  total_ttc: 120,
  remaining: 120,
  status: 100,
  actions: 220,
}

const { RangePicker } = DatePicker

// Le serveur plafonne sa page ; on la remplit et on tourne les pages, plutôt
// que de demander un nombre fantaisiste et de perdre le reste en silence.
const PAGE_SIZE = 500
const MAX_PAGES = 40

const _invoiceListVersion = 'v2.0.1'
void _invoiceListVersion

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
  lines?: InvoiceLine[]
  discount_percent?: number
  discount_amount?: number
  total_ht: number
  total_tva: number
  total_ttc: number
  paid_amount: number
  is_archived?: boolean
}

interface InvoiceListResponse {
  data: Invoice[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

const statusColors: Record<string, string> = {
  draft: 'default',
  // Deux lectures d'états existants : brouillon dont la validation est demandée,
  // et facture validée mais pas encore partie (voir Invoices::outStatus).
  pending_validation: 'orange',
  validated: 'blue',
  sent: 'cyan',
  // Le client a ouvert son lien public : cinquième lecture du même état interne
  // (voir Invoices::outStatus). C'est ce que le propriétaire veut lire d'un coup
  // d'œil dans la liste — envoyée, consultée, partielle, payée — sans avoir à
  // ouvrir une seule pièce.
  consulted: 'purple',
  partial: 'orange',
  paid: 'green',
  overdue: 'red',
  cancelled: 'default',
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

export default function InvoiceList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // ⚠️ CET ÉCRAN N'AVAIT AUCUNE GARDE DE DROIT — pas une seule.
  //
  // Sept gestes s'y affichaient sans condition : nouvelle facture, dupliquer,
  // archiver, envoyer, établir un avoir, supprimer, archiver la sélection. Tous
  // écrivent, tous sont bornés côté serveur, et un lecteur — ou un magasinier —
  // n'y récoltait que des 403. Le refus était juste ; c'est l'écran qui mentait.
  //
  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN : la matrice arrive par un
  // appel, et masquer avant sa réponse ferait clignoter les boutons.
  const droitsConnus = usePermissionsChargees()
  const peutEcrire = usePermissionStore((etat) => etat.canEdit('invoices'))
  const montrerLEcriture = !droitsConnus || peutEcrire

  const statusLabels: Record<string, string> = {
    draft: t('invoices.statusDraft'),
    pending_validation: t('invoices.statusPendingValidation', 'Attente validation'),
    validated: t('invoices.statusValidated', 'Validée'),
    sent: t('invoices.statusSent'),
    consulted: t('invoiceEditor.status.consulted', 'Consultée'),
    partial: t('invoices.statusPartial'),
    paid: t('invoices.statusPaid'),
    overdue: t('invoices.statusOverdue'),
    cancelled: t('invoices.statusCancelled'),
  }

  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(11, 'month').startOf('month'),
    dayjs().add(1, 'month').endOf('month'),
  ])
  const [showArchived, setShowArchived] = useState(false)
  // Les avoirs ne se mêlent aux factures que si on le demande : ils défont un
  // chiffre d'affaires, ils ne s'y ajoutent pas.
  const [showCredits, setShowCredits] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  // ⚠️ 180 LIGNES RENDUES D'UN BLOC, SANS LE MOINDRE MOYEN DE TOURNER LA PAGE.
  //
  // La liste charge toute la période — il le faut : les sous-totaux du mois, le
  // bandeau « Totaux généraux » et la recherche portent sur l'ENSEMBLE, pas sur
  // ce qui est visible, et c'est ce qui les empêche de mentir. Ce qui manquait
  // n'était donc pas une pagination serveur mais un moyen de ne pas tout
  // afficher à la fois. On pagine donc l'AFFICHAGE : les totaux restent exacts,
  // la recherche continue de voir toute la période, et l'écran ne monte plus
  // que quelques dizaines de lignes.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const { openDocumentTab } = useDocumentTabsStore()
  const { sidebarWidth } = useSidebarStore()
  const { columnWidths, handleResize } = useListColumnWidths('erp_invoice_list_widths', DEFAULT_INVOICE_LIST_WIDTHS)

  const { data, isLoading, refetch } = useQuery<InvoiceListResponse & { truncated: boolean }>({
    queryKey: [
      'invoices',
      'client',
      dateRange[0].format('YYYY-MM-DD'),
      dateRange[1].format('YYYY-MM-DD'),
      showArchived,
      showCredits,
    ],
    queryFn: async () => {
      // ⚠️ DES FACTURES DISPARAISSAIENT SANS UN MOT. L'écran demandait
      // page_size: 10000 et montait sa table sans pagination : le serveur
      // plafonne, les suivantes n'apparaissaient nulle part, et le bandeau de
      // totaux — calculé sur les seules lignes reçues — se disait « Totaux
      // généraux (n factures) » sur une partie du réel. On parcourt les pages.
      const commun: Record<string, unknown> = {
        type: showCredits ? 'client_with_credits' : 'client',
        page_size: PAGE_SIZE,
        show_archived: showArchived || undefined,
        date_from: dateRange[0].format('YYYY-MM-DD'),
        date_to: dateRange[1].format('YYYY-MM-DD'),
      }

      const premiere = (await invoiceAPI.list({ ...commun, page: 1 })).data as InvoiceListResponse
      const invoices = [...(premiere.data || [])]
      const pages = premiere.pagination?.total_pages || 1

      for (let page = 2; page <= Math.min(pages, MAX_PAGES); page++) {
        const suite = (await invoiceAPI.list({ ...commun, page })).data as InvoiceListResponse
        invoices.push(...(suite.data || []))
      }

      return { data: invoices, pagination: premiere.pagination, truncated: pages > MAX_PAGES }
    },
    // La liste se remet à jour au retour sur la fenêtre : un règlement encaissé
    // ou une facture établie depuis un autre poste changeait le statut sans que
    // cet écran en sache rien jusqu'à la réouverture de l'onglet. Pas de
    // minuteur ici : ces changements viennent de l'intérieur du produit, qui
    // invalide déjà « invoices » à chaque écriture.
    refetchOnWindowFocus: true,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => invoiceAPI.delete(id),
    onSuccess: () => {
      message.success(t('invoices.invoiceDeleted'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    // Le serveur dit pourquoi il refuse ; l'intercepteur d'api.ts a déjà
    // recopié ce motif dans error.message.
    onError: (error: Error) => {
      message.error(error.message || t('invoices.deleteError'))
    },
  })

  const sendMutation = useMutation({
    mutationFn: (id: string) => invoiceAPI.send(id),
    onSuccess: () => {
      message.success(t('invoices.invoiceSent'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    // Le serveur dit pourquoi il refuse — « validez le document avant de
    // l'envoyer », adresse manquante, courriel non configuré. L'intercepteur
    // d'api.ts a déjà recopié ce motif dans error.message.
    onError: (error: Error) => {
      message.error(error.message || t('invoices.sendError'))
    },
  })

  // ⚠️ L'AVOIR EST LA SEULE ISSUE, ET AUCUN BOUTON NE L'OFFRAIT.
  //
  // Le serveur refuse toute modification d'une facture émise en renvoyant
  // l'utilisateur vers l'avoir ; le mot n'apparaissait nulle part dans l'IHM.
  // On contre-passe donc d'ici, et on ouvre l'avoir aussitôt : c'est un
  // brouillon, il reste à relire et à valider pour prendre son numéro.
  const creditMutation = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/credit`),
    onSuccess: (response) => {
      const avoir = response.data as { id: string; number: string; source_number: string }
      message.success(
        t('invoices.creditCreated', 'Avoir établi : relisez-le puis validez-le pour le numéroter.')
      )
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      setShowCredits(true)
      openDocumentTab(
        'invoice',
        avoir.id,
        `${t('invoices.creditTabPrefix', 'Avoir')} ${avoir.number}`
      )
    },
    onError: (error: Error) => {
      message.error(error.message || t('invoices.creditError', "Erreur lors de l'établissement de l'avoir"))
    },
  })

  // ⚠️ LA CASE « AFFICHER LES ARCHIVES » ÉTAIT LÀ, LE GESTE D'ARCHIVER NON.
  //
  // On pouvait donc voir les archives et jamais en faire une : aucune facture
  // ne pouvait quitter la liste courante, et les brouillons abandonnés
  // continuaient d'entrer dans le bandeau des totaux. Les devis et les
  // commandes offrent ce geste depuis toujours ; c'est le même, et la même
  // route commune (Documents::registerCommonActions).
  //
  // ⚠️ LE BOOLÉEN PART TOUJOURS EXPLICITEMENT. Un corps vide DÉSARCHIVE côté
  // serveur — rest_sanitize_boolean(null) vaut faux —, et « Archiver » aurait
  // fait l'inverse de ce qu'il annonce.
  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.post(`/invoices/${id}/archive`, { archived }),
    onSuccess: (_response, variables) => {
      message.success(
        variables.archived
          ? t('invoices.invoiceArchived', 'Facture archivée.')
          : t('invoices.invoiceUnarchived', 'Facture désarchivée.')
      )
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (error: Error) => {
      message.error(error.message || t('invoices.archiveError', "L'archivage n'a pas abouti."))
    },
  })

  const archiveBulkMutation = useMutation({
    mutationFn: ({ ids, archived }: { ids: string[]; archived: boolean }) =>
      api.post('/invoices/archive-bulk', { ids, archived }),
    onSuccess: (_response, variables) => {
      message.success(
        variables.archived
          ? t('invoices.invoicesArchived', '{{count}} facture(s) archivée(s).', { count: variables.ids.length })
          : t('invoices.invoicesUnarchived', '{{count}} facture(s) désarchivée(s).', { count: variables.ids.length })
      )
      setSelectedRowKeys([])
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
    },
    onError: (error: Error) => {
      message.error(error.message || t('invoices.archiveError', "L'archivage n'a pas abouti."))
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => invoiceAPI.duplicate(id),
    onSuccess: (response) => {
      message.success(t('invoices.invoiceDuplicated'))
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      openDocumentTab('invoice', response.data.id, `${t('invoices.invoiceTabPrefix')} ${response.data.number}`)
    },
    onError: () => {
      message.error(t('invoices.duplicateError'))
    },
  })

  const handleDownloadPdf = async (invoice: Invoice) => {
    try {
      const response = await invoiceAPI.getPdf(invoice.id)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Facture-${invoice.number}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('invoices.pdfDownloaded'))
    } catch {
      message.error(t('invoices.pdfDownloadError'))
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
      const response = await invoiceAPI.getPdf(invoice.id)
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
      message.error(t('invoices.pdfLoadError'))
    }
  }

  const handleCreate = () => {
    openDocumentTab('invoice')
  }

  const handleEdit = (invoice: Invoice) => {
    openDocumentTab('invoice', invoice.id, `${t('invoices.invoiceTabPrefix')} ${invoice.number}`)
  }

  // ⚠️ COCHER UNE LIGNE POUR L'ARCHIVER NE DOIT PAS L'OUVRIR. La case de
  // sélection est dans la ligne, dont le clic ouvre la facture : sans cette
  // garde, chaque case cochée empilait un onglet par-dessus la liste. Même
  // geste que la liste des devis.
  const ouvrirDepuisLaLigne = (invoice: Invoice) => (event: React.MouseEvent<HTMLElement>) => {
    const cellule = (event.target as HTMLElement).closest('td')
    if (cellule?.classList.contains('ant-table-selection-column')) return
    handleEdit(invoice)
  }

  // Chaque colonne affichée se trie : c'est la première chose qu'on cherche à
  // faire devant un tableau de soixante factures, et aucune ne le permettait.
  const compareText = (a?: string, b?: string) => (a || '').localeCompare(b || '', 'fr')
  const compareDate = (a?: string, b?: string) => (a ? dayjs(a).valueOf() : 0) - (b ? dayjs(b).valueOf() : 0)
  const statusLabel = (status: string) => statusLabels[status] || status

  // ⚠️ UN SEUL FORMAT DE MONTANT DANS L'ÉCRAN. Les colonnes bornaient la
  // décimale par le bas seulement (« minimumFractionDigits ») : un total de
  // 1 170,567 sortait avec trois décimales à côté des sous-totaux qui en ont
  // deux. Le même formatage partout, celui des pieds de tableau.
  const formatCurrency = (value: number) =>
    value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const columns = [
    {
      title: t('invoices.colNumber'),
      dataIndex: 'number',
      key: 'number',
      width: columnWidths.number,
      sorter: (a: Invoice, b: Invoice) => compareText(a.number, b.number),
      onHeaderCell: () => ({
        width: columnWidths.number,
        onResize: handleResize('number'),
      }),
      render: (number: string, record: Invoice) => (
        <Space>
          {number}
          {record.type === 'deposit' && <Tag color="purple">AC</Tag>}
          {record.type === 'credit' && <Tag color="volcano">{t('invoices.creditTag', 'AV')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('invoices.colClient'),
      key: 'client',
      width: columnWidths.client,
      sorter: (a: Invoice, b: Invoice) => compareText(a.client?.name, b.client?.name),
      onHeaderCell: () => ({
        width: columnWidths.client,
        onResize: handleResize('client'),
      }),
      render: (_: unknown, record: Invoice) => record.client?.name || '-',
    },
    {
      title: t('invoices.colSubject'),
      dataIndex: 'subject',
      key: 'subject',
      width: columnWidths.subject,
      // ⚠️ PAS « ellipsis: true » : antd pose alors ant-table-cell-ellipsis sur
      // l'EN-TÊTE aussi, et son overflow:hidden rogne la poignée de
      // redimensionnement placée à right:-5px. La colonne qu'on tronque est
      // justement celle qu'on veut élargir. On tronque donc dans la cellule.
      sorter: (a: Invoice, b: Invoice) => compareText(a.subject, b.subject),
      onHeaderCell: () => ({
        width: columnWidths.subject,
        onResize: handleResize('subject'),
      }),
      render: (v: string) => (
        <div
          title={v || undefined}
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {v || '-'}
        </div>
      ),
    },
    {
      title: t('common.date'),
      dataIndex: 'date',
      key: 'date',
      width: columnWidths.date,
      sorter: (a: Invoice, b: Invoice) => compareDate(a.date, b.date),
      onHeaderCell: () => ({
        width: columnWidths.date,
        onResize: handleResize('date'),
      }),
      render: formatDate,
    },
    {
      title: t('invoices.colDueDate'),
      dataIndex: 'due_date',
      key: 'due_date',
      width: columnWidths.due_date,
      sorter: (a: Invoice, b: Invoice) => compareDate(a.due_date, b.due_date),
      onHeaderCell: () => ({
        width: columnWidths.due_date,
        onResize: handleResize('due_date'),
      }),
      render: formatDate,
    },
    {
      title: t('invoices.colAmountHT'),
      dataIndex: 'total_ht',
      key: 'total_ht',
      width: columnWidths.total_ht,
      align: 'right' as const,
      sorter: (a: Invoice, b: Invoice) => (a.total_ht || 0) - (b.total_ht || 0),
      onHeaderCell: () => ({
        width: columnWidths.total_ht,
        onResize: handleResize('total_ht'),
      }),
      render: (v: number) => `${formatCurrency(v || 0)} €`,
    },
    {
      title: t('invoices.colAmountTTC'),
      dataIndex: 'total_ttc',
      key: 'total_ttc',
      width: columnWidths.total_ttc,
      align: 'right' as const,
      sorter: (a: Invoice, b: Invoice) => (a.total_ttc || 0) - (b.total_ttc || 0),
      onHeaderCell: () => ({
        width: columnWidths.total_ttc,
        onResize: handleResize('total_ttc'),
      }),
      render: (v: number) => `${formatCurrency(v || 0)} €`,
    },
    {
      title: t('invoices.colRemaining'),
      key: 'remaining',
      width: columnWidths.remaining,
      align: 'right' as const,
      sorter: (a: Invoice, b: Invoice) =>
        ((a.total_ttc || 0) - (a.paid_amount || 0)) - ((b.total_ttc || 0) - (b.paid_amount || 0)),
      onHeaderCell: () => ({
        width: columnWidths.remaining,
        onResize: handleResize('remaining'),
      }),
      render: (_: unknown, record: Invoice) => {
        const remaining = (record.total_ttc || 0) - (record.paid_amount || 0)
        return `${formatCurrency(remaining)} €`
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: columnWidths.status,
      sorter: (a: Invoice, b: Invoice) => compareText(statusLabel(a.status), statusLabel(b.status)),
      onHeaderCell: () => ({
        width: columnWidths.status,
        onResize: handleResize('status'),
      }),
      render: (status: string) => (
        <Tag color={statusColors[status]}>{statusLabels[status] || status}</Tag>
      ),
    },
    {
      title: t('common.actions'),
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
          <Tooltip title={t('invoices.viewPdf')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleViewPdf(record)}
            />
          </Tooltip>
          {/* ⚠️ LE CRAYON NE SE FIGE PLUS. Il était éteint hors brouillon : la
              facture ne pouvait alors plus s'ouvrir du tout, alors que la
              consulter est le geste le plus courant. Ouvrir est toujours
              permis — c'est l'ÉDITEUR qui décide de ce qui s'écrit, et il le
              fait déjà (champs éteints, étiquette « Non modifiable »). Le
              crayon fait donc exactement ce que fait le clic sur la ligne, et
              son infobulle le dit. */}
          <Tooltip title={record.status === 'draft' ? t('common.edit') : t('common.open', 'Ouvrir')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t('invoices.actionDownloadPdf')}>
            <Button
              type="text"
              icon={<FilePdfOutlined />}
              size="small"
              onClick={() => handleDownloadPdf(record)}
            />
          </Tooltip>
          {montrerLEcriture && (
            <Tooltip title={t('invoices.actionDuplicate')}>
              <Button
                type="text"
                icon={<CopyOutlined />}
                size="small"
                onClick={() => duplicateMutation.mutate(record.id)}
              />
            </Tooltip>
          )}
          {/* Archiver n'est pas un état : la facture reste ce qu'elle est, on
              ne veut simplement plus la voir dans la liste courante. Le geste
              vaut donc sur tous les statuts, y compris une facture soldée. */}
          {montrerLEcriture && (
            <Tooltip title={record.is_archived
              ? t('invoices.unarchive', 'Désarchiver')
              : t('invoices.archive', 'Archiver')}>
              <Button
                type="text"
                icon={<InboxOutlined />}
                size="small"
                onClick={() => archiveMutation.mutate({ id: record.id, archived: !record.is_archived })}
              />
            </Tooltip>
          )}
          {/* ⚠️ L'AVION SE PROPOSE SUR LES FACTURES VALIDÉES, PAS SUR LES BROUILLONS.
              C'était exactement l'inverse, et le serveur refuse justement les
              brouillons (« validez le document avant de l'envoyer ») : le
              bouton ne pouvait aboutir sur aucune facture. Une facture annulée
              n'a pas non plus à partir. */}
          {montrerLEcriture && record.status !== 'draft' && record.status !== 'cancelled' && (
            <Tooltip title={t('invoices.actionSend')}>
              <Popconfirm
                title={t('invoices.sendConfirm')}
                onConfirm={() => sendMutation.mutate(record.id)}
                okText={t('common.yes')}
                cancelText={t('common.no')}
              >
                <Button type="text" icon={<SendOutlined />} size="small" style={{ color: 'blue' }} />
              </Popconfirm>
            </Tooltip>
          )}
          {/* ⚠️ ÉTABLIR UN AVOIR : la seule façon de défaire une facture émise.
              Un brouillon n'a rien à contre-passer — il se corrige ou
              s'efface ; une facture annulée non plus. Un avoir ne s'avoire
              pas davantage. */}
          {montrerLEcriture && record.type !== 'credit' && record.status !== 'draft' && record.status !== 'cancelled' && (
            <Tooltip title={t('invoices.actionCredit', 'Établir un avoir')}>
              <Popconfirm
                title={t(
                  'invoices.creditConfirm',
                  'Établir un avoir qui contre-passe cette facture ?'
                )}
                onConfirm={() => creditMutation.mutate(record.id)}
                okText={t('common.yes')}
                cancelText={t('common.no')}
              >
                <Button type="text" icon={<RollbackOutlined />} size="small" style={{ color: '#722ed1' }} />
              </Popconfirm>
            </Tooltip>
          )}
          {/* ⚠️ UN BROUILLON SE RETIRE, UNE FACTURE ÉMISE JAMAIS.
              Le bouton était masqué pour TOUTES les factures clients : un
              brouillon créé par erreur ne pouvait plus jamais quitter la liste
              et continuait d'entrer dans le bandeau des totaux. Le serveur, lui,
              ne supprime déjà que les brouillons — on l'affiche là où il aboutit. */}
          {montrerLEcriture && record.status === 'draft' && (
            <Popconfirm
              title={t('invoices.deleteConfirm')}
              onConfirm={() => deleteMutation.mutate(record.id)}
              okText={t('common.yes')}
              cancelText={t('common.no')}
            >
              <Tooltip title={t('common.delete')}>
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

  // ⚠️ LA RECHERCHE NE VOYAIT PAS CE QUE LA TABLE AFFICHE.
  //
  // Elle partait au serveur, qui ne regarde que le numéro, le tiers, sa
  // référence et l'objet : chercher « Facture A », un montant ou un statut lu à
  // l'écran répondait « Aucune donnée », et l'on croyait la facture perdue. La
  // période entière est de toute façon chargée : on filtre ici, sur exactement
  // les colonnes montrées.
  const filteredInvoices = useMemo(() => {
    const tout = data?.data || []
    // ⚠️ « EN RETARD » N'A QU'UNE SEULE DÉFINITION, ET ELLE EST AU SERVEUR.
    //
    // Le statut « overdue » se déduit de l'échéance et du reste dû dans
    // Invoices::toJson() ; il n'existe dans aucune colonne, et ne se filtre donc
    // qu'ici, sur ce que le serveur a dit. On ne le RECALCULE pas : c'est
    // précisément d'avoir deux calculs que venait le désaccord entre cette
    // liste, la fenêtre des relances et le tableau de bord — le serveur ne
    // marquait « en retard » que les factures ENVOYÉES, jamais celles qui sont
    // seulement validées, qui le sont pourtant tout autant.
    const invoices = statusFilter ? tout.filter((invoice) => invoice.status === statusFilter) : tout
    const terme = search.trim().toLowerCase()

    if (!terme) return invoices

    return invoices.filter((invoice) =>
      [
        invoice.number,
        invoice.client?.name,
        invoice.subject,
        formatDate(invoice.date),
        formatDate(invoice.due_date),
        String(invoice.total_ht ?? ''),
        String(invoice.total_ttc ?? ''),
        formatCurrency(invoice.total_ht || 0),
        formatCurrency(invoice.total_ttc || 0),
        statusLabels[invoice.status] || invoice.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(terme)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data, search, statusFilter, t])

  // ⚠️ UN AVOIR SE RETRANCHE, IL NE S'AJOUTE PAS. Il porte des montants
  // positifs en base — c'est son sens comptable qui est négatif. Additionner
  // un avoir de 1 170 € au chiffre d'affaires le gonflerait du double de ce
  // qu'il défait.
  const signe = (invoice: Invoice) => (invoice.type === 'credit' ? -1 : 1)

  const clefDuMois = (invoice: Invoice) => {
    const date = dayjs(invoice.date)

    return `${date.year()}-${String(date.month()).padStart(2, '0')}`
  }

  // La liste entière, du plus récent au plus ancien : c'est elle qui fait foi
  // pour les totaux, et c'est dans cet ordre qu'on la découpe en pages.
  const triees = useMemo(
    () => [...filteredInvoices].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf()),
    [filteredInvoices]
  )

  // ⚠️ LA PAGE NE SURVIT PAS À UN CHANGEMENT DE FILTRE. Rester en page 4 après
  // avoir resserré la recherche montrait une liste vide alors qu'il y avait des
  // résultats — le défaut classique des listes paginées.
  const nombreDePages = Math.max(1, Math.ceil(triees.length / pageSize))
  const pageCourante = Math.min(page, nombreDePages)

  const facturesDeLaPage = useMemo(
    () => triees.slice((pageCourante - 1) * pageSize, pageCourante * pageSize),
    [triees, pageCourante, pageSize]
  )

  // Grouper les factures par mois avec sous-totaux
  //
  // ⚠️ LE SOUS-TOTAL PORTE SUR LE MOIS ENTIER, PAS SUR LA TRANCHE AFFICHÉE.
  // Un mois coupé en deux par la pagination donnerait sinon deux sous-totaux
  // partiels qui ne veulent rien dire. L'en-tête du mois annonce combien de
  // lignes il porte, et combien sont sous les yeux.
  const groupedInvoices = useMemo(() => {
    const totauxParMois = new Map<string, Invoice[]>()

    triees.forEach((invoice) => {
      const key = clefDuMois(invoice)

      if (!totauxParMois.has(key)) totauxParMois.set(key, [])
      totauxParMois.get(key)!.push(invoice)
    })

    const groups: {
      key: string
      label: string
      invoices: Invoice[]
      countMois: number
      totalHT: number
      totalTVA: number
      totalTTC: number
      totalRemaining: number
    }[] = []
    const groupMap = new Map<string, Invoice[]>()

    facturesDeLaPage.forEach((invoice) => {
      const key = clefDuMois(invoice)

      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(invoice)
    })

    groupMap.forEach((invoices, key) => {
      const [year, month] = key.split('-').map(Number)
      const duMois = totauxParMois.get(key) || invoices
      const totalHT = duMois.reduce((sum, inv) => sum + signe(inv) * (inv.total_ht || 0), 0)
      const totalTVA = duMois.reduce((sum, inv) => sum + signe(inv) * (inv.total_tva || 0), 0)
      const totalTTC = duMois.reduce((sum, inv) => sum + signe(inv) * (inv.total_ttc || 0), 0)
      const totalRemaining = duMois.reduce(
        (sum, inv) => sum + signe(inv) * ((inv.total_ttc || 0) - (inv.paid_amount || 0)),
        0
      )
      groups.push({
        key,
        label: `${t(`invoices.months.${MONTH_KEYS[month]}`)} ${year}`,
        invoices,
        countMois: duMois.length,
        totalHT,
        totalTVA,
        totalTTC,
        totalRemaining,
      })
    })

    // Trier les groupes par date décroissante
    groups.sort((a, b) => b.key.localeCompare(a.key))
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triees, facturesDeLaPage, t])

  // Totaux généraux
  const grandTotals = useMemo(() => {
    const invoices = filteredInvoices
    return {
      count: invoices.length,
      totalHT: invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_ht || 0), 0),
      totalTVA: invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_tva || 0), 0),
      totalTTC: invoices.reduce((sum, inv) => sum + signe(inv) * (inv.total_ttc || 0), 0),
      totalPaid: invoices.reduce((sum, inv) => sum + signe(inv) * (inv.paid_amount || 0), 0),
      totalRemaining: invoices.reduce(
        (sum, inv) => sum + signe(inv) * ((inv.total_ttc || 0) - (inv.paid_amount || 0)),
        0
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredInvoices])

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
                  background: '#f5f5f5',
                  padding: '8px 16px',
                  fontWeight: 600,
                  fontSize: 15,
                  borderRadius: '4px 4px 0 0',
                  borderBottom: '2px solid #1890ff',
                }}
              >
                {group.label}
                {group.countMois > group.invoices.length && (
                  <span style={{ fontWeight: 400, fontSize: 13, color: '#666', marginLeft: 8 }}>
                    {t('invoices.monthSplit', '({{shown}} sur {{total}} — la suite page suivante)', {
                      shown: group.invoices.length,
                      total: group.countMois,
                    })}
                  </span>
                )}
              </div>
              <Table
                dataSource={group.invoices}
                columns={columns}
                rowKey="id"
                pagination={false}
                // Des cases à cocher qui ne mènent à aucun bouton n'ont plus
                // d'objet : la sélection disparaît avec l'archivage en lot.
                rowSelection={montrerLEcriture ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                  preserveSelectedRowKeys: true,
                } : undefined}
                // ⚠️ UN SEUL CLIC OUVRE LA FACTURE, DANS SON ÉDITEUR — il en
                // fallait deux, et c'était le seul geste d'ouverture de
                // l'écran. La colonne « Actions » arrête l'événement dans sa
                // propre cellule (voir onCell), pour qu'un bouton d'action ne
                // déclenche pas deux gestes à la fois.
                onRow={(record) => ({
                  onClick: ouvrirDepuisLaLigne(record),
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
                  <tr style={{ background: '#e6f7ff', fontWeight: 600 }}>
                    {/* La colonne des cases à cocher, pour que le pied reste
                        aligné sur le tableau du dessus. */}
                    <td style={{ width: 40, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.number, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.client, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.subject, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.date, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.due_date, padding: '8px', border: '1px solid #91d5ff', textAlign: 'right' }}>
                      {t('invoices.subtotal')}
                    </td>
                    <td style={{ width: columnWidths.total_ht, padding: '8px', border: '1px solid #91d5ff', textAlign: 'right' }}>
                      {formatCurrency(group.totalHT)} €
                    </td>
                    <td style={{ width: columnWidths.total_ttc, padding: '8px', border: '1px solid #91d5ff', textAlign: 'right' }}>
                      {formatCurrency(group.totalTTC)} €
                    </td>
                    <td style={{ width: columnWidths.remaining, padding: '8px', border: '1px solid #91d5ff', textAlign: 'right', color: group.totalRemaining > 0 ? '#fa8c16' : '#52c41a' }}>
                      {formatCurrency(group.totalRemaining)} €
                    </td>
                    <td style={{ width: columnWidths.status, padding: '8px', border: '1px solid #91d5ff' }}></td>
                    <td style={{ width: columnWidths.actions, padding: '8px', border: '1px solid #91d5ff' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {groupedInvoices.length === 0 && (
            <Table columns={columns} dataSource={[]} />
          )}

          {/* La pagination de l'AFFICHAGE : les totaux du bas et la recherche
              portent, eux, sur toute la période chargée. */}
          {triees.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Pagination
                current={pageCourante}
                pageSize={pageSize}
                total={triees.length}
                showSizeChanger
                pageSizeOptions={['25', '50', '100', '200']}
                onChange={(p, taille) => {
                  setPage(p)
                  setPageSize(taille)
                }}
                showTotal={(total, [debut, fin]) =>
                  t('invoices.paginationRange', '{{debut}}–{{fin}} sur {{total}} factures', {
                    debut,
                    fin,
                    total,
                  })
                }
              />
            </div>
          )}

          {/* Totaux généraux - fixed */}
          {groupedInvoices.length > 0 && (
            <div
              style={{
                background: '#f6ffed',
                padding: '16px 24px',
                borderRadius: 0,
                border: '2px solid #52c41a',
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
                {t('invoices.grandTotals', { count: grandTotals.count })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('invoices.totalHT')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalHT)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('invoices.totalTVA')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalTVA)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('invoices.totalTTC')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#1890ff' }}>{formatCurrency(grandTotals.totalTTC)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('invoices.totalPaid')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#52c41a' }}>{formatCurrency(grandTotals.totalPaid)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('invoices.totalRemaining')}</div>
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
        <h1 style={{ margin: 0 }}>{t('invoices.title')}</h1>
        {montrerLEcriture && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('invoices.newInvoice')}
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Input
          placeholder={t('invoices.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          onPressEnter={() => refetch()}
        />
        <RangePicker
          placeholder={[t('invoices.dateStart'), t('invoices.dateEnd')]}
          format="DD/MM/YYYY"
          value={dateRange}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([dates[0], dates[1]])
              setPage(1)
            }
          }}
          allowClear={false}
          style={{ width: 280 }}
        />
        {/* Huit statuts sont possibles et la colonne les affiche : retrouver les
            impayées d'une liste de soixante lignes se faisait à l'œil. */}
        <Select
          allowClear
          placeholder={t('invoices.statusFilter', 'Tous les statuts')}
          style={{ width: 180 }}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value)
            setPage(1)
          }}
          options={[
            'draft',
            'pending_validation',
            'validated',
            'sent',
            'consulted',
            'partial',
            'paid',
            'overdue',
            'cancelled',
          ].map((value) => ({
            value,
            label: statusLabels[value] || value,
          }))}
        />
        <Checkbox
          checked={showArchived}
          onChange={(e) => {
            setShowArchived(e.target.checked)
            setPage(1)
          }}
        >
          {t('invoices.showArchived', 'Afficher les archives')}
        </Checkbox>
        <Checkbox
          checked={showCredits}
          onChange={(e) => {
            setShowCredits(e.target.checked)
            setPage(1)
          }}
        >
          {t('invoices.showCredits', 'Afficher les avoirs')}
        </Checkbox>
        {/* En lot : la sélection peut porter sur plusieurs mois, elle survit
            donc au changement de page (preserveSelectedRowKeys). Le sens de
            l'action suit la case « Afficher les archives » — on désarchive
            depuis la vue des archives, on archive depuis la liste courante. */}
        {montrerLEcriture && selectedRowKeys.length > 0 && (
          <Button
            icon={<InboxOutlined />}
            onClick={() =>
              archiveBulkMutation.mutate({
                ids: selectedRowKeys as string[],
                archived: !showArchived,
              })
            }
            loading={archiveBulkMutation.isPending}
          >
            {showArchived
              ? t('invoices.unarchiveCount', 'Désarchiver ({{count}})', { count: selectedRowKeys.length })
              : t('invoices.archiveCount', 'Archiver ({{count}})', { count: selectedRowKeys.length })}
          </Button>
        )}
        {search && (
          <Button
            icon={<FilterOutlined />}
            onClick={() => setSearch('')}
          >
            {t('invoices.clearSearch')}
          </Button>
        )}
      </div>

      {data?.truncated && (
        <div style={{ marginBottom: 12, color: '#fa8c16' }}>
          {t(
            'invoices.listTruncated',
            'Trop de factures pour cet intervalle : la liste et ses totaux sont incomplets. Resserrez la période.'
          )}
        </div>
      )}

      {tableComponent}

    </div>
  )
}
