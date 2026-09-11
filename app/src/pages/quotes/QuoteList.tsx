import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Tooltip,
  message,
  Popconfirm,
  DatePicker,
  Checkbox,
  Alert,
  Select,
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
  InboxOutlined,
} from '@ant-design/icons'
import { quoteAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useListColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import dayjs, { Dayjs } from 'dayjs'
import 'dayjs/locale/fr'

dayjs.locale('fr')

// Default column widths for quote list
const DEFAULT_QUOTE_LIST_WIDTHS = {
  number: 120,
  client: 150,
  subject: 200,
  date: 110,
  validity_date: 110,
  total_ht: 120,
  total_ttc: 120,
  status: 100,
  actions: 200,
}

const { RangePicker } = DatePicker

interface QuoteLine {
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

interface Quote {
  id: string
  number: string
  client_id: string
  client?: { id: string; name: string }
  date: string
  validity_date?: string
  status: string
  subject?: string
  notes?: string
  lines?: QuoteLine[]
  discount_percent?: number
  discount_amount?: number
  total_ht: number
  total_tva: number
  total_ttc: number
  is_archived?: boolean
}

interface QuoteListResponse {
  data: Quote[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

// Les couleurs et les libellés du cycle de vie, dans l'ordre où le devis les
// traverse — c'est cet ordre que le filtre de statut reprend.
//
// ⚠️ LA MÊME TABLE QUE CELLE DE QuoteEditor (statusConfig). Deux copies qui
// divergent, c'est un devis « Validé » ici et « Envoyé » là. Toute couleur ou
// tout libellé changé d'un côté se change de l'autre.
//
// « cancelled » est en rouge sombre (#a8071a, le red-8 d'Ant Design) et non en
// rouge : « refusé » (le client dit non) et « annulé » (nous retirons le devis)
// se distinguaient mal dans une liste de deux cents lignes.
const statusColors: Record<string, string> = {
  draft: 'default',
  pending_validation: 'orange',
  validated: 'blue',
  sent: 'cyan',
  // Le client a ouvert son lien : quatrième lecture du même état interne
  // (voir Quotes::outStatus). « Envoyé » et « consulté » appellent deux
  // relances différentes — c'est tout l'intérêt de les distinguer d'un coup
  // d'œil dans une liste de deux cents lignes.
  consulted: 'purple',
  accepted: 'green',
  refused: 'red',
  cancelled: '#a8071a',
  invoiced: 'purple',
  deposit: 'gold',
  ordered: 'geekblue',
  expired: 'orange',
}

const statusLabelKeys: Record<string, string> = {
  draft: 'quotes.statusDraft',
  pending_validation: 'quoteEditor.statusPendingValidation',
  validated: 'quoteEditor.statusValidated',
  sent: 'quotes.statusSent',
  consulted: 'quoteEditor.statusConsulted',
  accepted: 'quotes.statusAccepted',
  refused: 'quotes.statusRefused',
  // Le serveur ne dit plus « expired » d'un devis annulé à la main : le
  // libellé vient de l'éditeur, qui le porte déjà.
  cancelled: 'quoteEditor.statusCancelled',
  invoiced: 'quotes.statusInvoiced',
  deposit: 'quotes.statusDeposit',
  ordered: 'quotes.statusOrdered',
  expired: 'quotes.statusExpired',
}

// Le repli français de chaque statut, employé quand la traduction manque.
const statusLabelDefauts: Record<string, string> = {
  draft: 'Brouillon',
  pending_validation: 'Attente validation',
  validated: 'Validé',
  sent: 'Envoyé',
  consulted: 'Consulté',
  accepted: 'Accepté',
  refused: 'Refusé',
  cancelled: 'Annulé',
  invoiced: 'Facturé',
  deposit: 'Acompte',
  ordered: 'Commandé',
  expired: 'Expiré',
}

// Les statuts que le filtre propose, dans l'ordre du processus.
//
// ⚠️ PAS Object.keys(statusLabelKeys) : la table garde « deposit », « ordered »
// et « expired » pour les devis anciens, que Quotes::statusMap() ne rend plus.
// Les proposer au filtre offrait trois entrées qui ne trouvent jamais rien.
const STATUTS_FILTRABLES = [
  'draft',
  'pending_validation',
  'validated',
  'sent',
  'consulted',
  'accepted',
  'refused',
  'cancelled',
  'invoiced',
]

// Un devis se corrige et se supprime tant qu'il n'est pas numéroté.
//
// ⚠️ « attente validation » EST ENCORE UN BROUILLON : côté serveur, c'est le
// même post_status, seule une métadonnée dit que la relecture est demandée. Le
// traiter comme un document figé interdisait de corriger un devis dont on
// venait justement de demander la relecture.
const estModifiable = (status: string) => 'draft' === status || 'pending_validation' === status

// ⚠️ Le serveur plafonne une page à 200 lignes (Api::perPage), quoi qu'on lui
// demande. Cet écran groupe par mois et totalise l'ensemble : il lui faut la
// période entière, d'où l'enchaînement des pages — et une borne, pour ne pas
// marteler le serveur si la base est énorme.
const PAGE_SIZE = 200
const MAX_PAGES = 50

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

// Motif d'un refus du serveur.
//
// ⚠️ WordPress répond { code, message, data:{ status } } ; les écrans ne
// lisaient que « error », clé qui n'existe pas — chaque refus se réduisait au
// libellé de repli.
function serverMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data
  return data?.message || data?.error || ''
}

export default function QuoteList() {
  const { t } = useTranslation()
  const monthsFr = t('quotes.months', { returnObjects: true }) as string[]
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(11, 'month').startOf('month'),
    dayjs().add(1, 'month').endOf('month'),
  ])
  const [showArchived, setShowArchived] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

  const { openDocumentTab } = useDocumentTabsStore()
  const { sidebarWidth } = useSidebarStore()
  const { columnWidths, handleResize } = useListColumnWidths('erp_quote_list_widths', DEFAULT_QUOTE_LIST_WIDTHS)

  // Vrai quand l'onglet « Devis » est celui qu'on a sous les yeux — voir le
  // minuteur de rafraîchissement plus bas. Si l'écran est monté hors du système
  // d'onglets, aucun onglet ne le porte : on le tient alors pour visible.
  const listeAuPremierPlan = useDocumentTabsStore((etat) => {
    const onglet = etat.tabs.find((o) => o.type === 'static' && o.staticType === 'quotes')
    return !onglet || onglet.id === etat.activeTabId
  })

  const { data, isLoading, refetch } = useQuery<QuoteListResponse & { truncated: boolean }>({
    queryKey: ['quotes', dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD'), showArchived],
    queryFn: async () => {
      // ⚠️ DES DEVIS DISPARAISSAIENT. L'écran demandait page_size: 10000 et
      // montait sa table sans pagination : le serveur en rendait 200, les
      // suivants n'apparaissaient nulle part, et le bandeau de totaux — calculé
      // sur les seules lignes reçues — était faux sans le dire.
      const commun: Record<string, unknown> = {
        page_size: PAGE_SIZE,
        show_archived: showArchived || undefined,
        date_from: dateRange[0].format('YYYY-MM-DD'),
        date_to: dateRange[1].format('YYYY-MM-DD'),
      }

      const premiere = (await quoteAPI.list({ ...commun, page: 1 })).data as QuoteListResponse
      const quotes = [...(premiere.data || [])]
      const pages = premiere.pagination?.total_pages || 1

      for (let page = 2; page <= Math.min(pages, MAX_PAGES); page++) {
        const suite = (await quoteAPI.list({ ...commun, page })).data as QuoteListResponse
        quotes.push(...(suite.data || []))
      }

      return { data: quotes, pagination: premiere.pagination, truncated: pages > MAX_PAGES }
    },
    // ⚠️ UN DEVIS PEUT ÊTRE SIGNÉ EN LIGNE À TOUT MOMENT, ET RIEN NE PRÉVIENT
    // L'ERP. Le serveur passait bien le devis en « Accepté » ; l'écran, lui,
    // affichait l'ancien statut jusqu'à ce qu'on rouvre l'onglet, et l'on
    // croyait devoir le corriger à la main. La liste se relit donc seule.
    //
    // ⚠️ ET SEULEMENT QUAND ON LA REGARDE : depuis la conservation d'état, TOUS
    // les onglets ouverts restent montés (MainLayout les masque en CSS, il ne
    // les démonte plus). Un intervalle inconditionnel interrogerait le serveur
    // pour des écrans que personne n'a sous les yeux — et une seule relecture
    // coûte ici un aller-retour par tranche de 200 devis.
    // refetchIntervalInBackground reste à false (le défaut) : le minuteur
    // s'arrête aussi quand la FENÊTRE perd le focus, ce que le masquage d'un
    // onglet AMS Studio, lui, ne dit pas au navigateur — d'où la condition ci-dessus.
    refetchInterval: listeAuPremierPlan ? 60_000 : false,
    // Revenir sur la fenêtre est le moment le plus naturel pour se remettre à
    // jour. (Le staleTime global d'une minute s'applique : un aller-retour de
    // quelques secondes ne relance pas d'appel.)
    refetchOnWindowFocus: true,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => quoteAPI.delete(id),
    onSuccess: () => {
      message.success(t('quotes.quoteDeleted'))
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quotes.deleteError'))
    },
  })

  const validateMutation = useMutation({
    mutationFn: (id: string) => quoteAPI.validate(id),
    onSuccess: () => {
      message.success(t('quotes.quoteValidated'))
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    // ⚠️ LE MOTIF DU REFUS VIENT DU SERVEUR, ET LUI SEUL DIT QUOI FAIRE.
    //
    // Sans le droit de validation, la route rend un 403 qui dit « Valider un
    // document demande le droit de validation. Demandez-le à un responsable. »
    // Le libellé de repli, lui, n'apprend rien — et huit secondes ne sont pas
    // de trop pour lire une consigne.
    onError: (err: unknown) => {
      const motif = serverMessage(err)

      message.error(motif || t('quotes.validateError'), motif ? 8 : undefined)
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => quoteAPI.duplicate(id),
    onSuccess: (response) => {
      message.success(t('quotes.quoteDuplicated'))
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      // Open the duplicated quote
      openDocumentTab('quote', response.data.id, t('quotes.tabTitle', { number: response.data.number }))
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quotes.duplicateError'))
    },
  })

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => quoteAPI.archive(id, archived),
    onSuccess: (_, variables) => {
      message.success(variables.archived ? t('quotes.quoteArchived') : t('quotes.quoteUnarchived'))
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quotes.archiveError'))
    },
  })

  const archiveBulkMutation = useMutation({
    mutationFn: ({ ids, archived }: { ids: string[]; archived: boolean }) => quoteAPI.archiveBulk(ids, archived),
    onSuccess: (_, variables) => {
      message.success(
        variables.archived
          ? t('quotes.quotesArchived', { count: variables.ids.length })
          : t('quotes.quotesUnarchived', { count: variables.ids.length })
      )
      queryClient.invalidateQueries({ queryKey: ['quotes'] })
      setSelectedRowKeys([])
    },
    onError: (err: unknown) => {
      message.error(serverMessage(err) || t('quotes.archiveError'))
    },
  })

  const handleDownloadPdf = async (quote: Quote) => {
    try {
      const response = await quoteAPI.getPdf(quote.id)
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Devis-${quote.number}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      message.success(t('quotes.pdfDownloaded'))
    } catch {
      message.error(t('quotes.pdfDownloadError'))
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
  const handleViewPdf = async (quote: Quote) => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const response = await quoteAPI.getPdf(quote.id)
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
      message.error(t('quotes.pdfLoadError'))
    }
  }

  const handleCreate = () => {
    openDocumentTab('quote')
  }

  const handleEdit = (quote: Quote) => {
    openDocumentTab('quote', quote.id, t('quotes.tabTitle', { number: quote.number }))
  }

  // ⚠️ UN SEUL CLIC OUVRE LE DEVIS, DANS SON ÉDITEUR.
  //
  // Il fallait un double-clic, et celui-ci n'ouvrait l'éditeur que sur un
  // brouillon : ailleurs il n'affichait qu'une fenêtre d'aperçu. Le geste qui
  // sert cent fois par jour est l'ouverture — elle est la même partout, et sur
  // tous les statuts : QuoteEditor verrouille lui-même ce qui est validé
  // (isLocked), il n'y a donc plus d'enregistrement qui parte au refus.
  //
  // La colonne « Actions » et la case de sélection, elles, n'ouvrent pas :
  // cocher une ligne pour l'archiver ouvrirait un onglet par-dessus, et chaque
  // bouton d'action déclencherait deux gestes à la fois. La colonne « Actions »
  // arrête l'événement dans sa propre cellule (voir onCell plus bas).
  const ouvrirDepuisLaLigne = (quote: Quote) => (event: React.MouseEvent<HTMLElement>) => {
    const cellule = (event.target as HTMLElement).closest('td')
    if (cellule?.classList.contains('ant-table-selection-column')) return
    handleEdit(quote)
  }

  const formatCurrency = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // ⚠️ LA RECHERCHE NE VOYAIT PAS CE QUE LA TABLE AFFICHE.
  //
  // Elle partait au serveur, qui ne regarde que le numéro, le client, la
  // référence et l'objet : chercher « Accepté », une date ou un montant lu à
  // l'écran répondait « aucun résultat », et l'on croyait le devis perdu. La
  // période entière est de toute façon chargée : on filtre ici, sur exactement
  // les colonnes montrées.
  const filteredQuotes = useMemo(() => {
    const tout = data?.data || []
    const quotes = statusFilter ? tout.filter((quote) => quote.status === statusFilter) : tout
    const terme = search.trim().toLowerCase()

    if (!terme) return quotes

    return quotes.filter((quote) =>
      [
        quote.number,
        quote.client?.name,
        quote.subject,
        formatDate(quote.date),
        formatDate(quote.validity_date),
        String(quote.total_ht ?? ''),
        String(quote.total_ttc ?? ''),
        formatCurrency(quote.total_ht || 0),
        formatCurrency(quote.total_ttc || 0),
        statusLabelKeys[quote.status] ? t(statusLabelKeys[quote.status]) : quote.status,
        quote.is_archived ? t('quotes.archived') : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(terme)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data, search, statusFilter, t])

  // Group quotes by month with subtotals
  const groupedQuotes = useMemo(() => {
    const quotes = filteredQuotes
    const groups: {
      key: string
      label: string
      quotes: Quote[]
      totalHT: number
      totalTVA: number
      totalTTC: number
    }[] = []
    const groupMap = new Map<string, Quote[]>()

    const sorted = [...quotes].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf())

    sorted.forEach((quote) => {
      const date = dayjs(quote.date)
      const key = `${date.year()}-${String(date.month()).padStart(2, '0')}`
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
      }
      groupMap.get(key)!.push(quote)
    })

    groupMap.forEach((quotes, key) => {
      const [year, month] = key.split('-').map(Number)
      const totalHT = quotes.reduce((sum, q) => sum + (q.total_ht || 0), 0)
      const totalTVA = quotes.reduce((sum, q) => sum + (q.total_tva || 0), 0)
      const totalTTC = quotes.reduce((sum, q) => sum + (q.total_ttc || 0), 0)
      groups.push({
        key,
        label: `${monthsFr[month]} ${year}`,
        quotes,
        totalHT,
        totalTVA,
        totalTTC,
      })
    })

    groups.sort((a, b) => b.key.localeCompare(a.key))
    return groups
  }, [filteredQuotes, monthsFr])

  // Grand totals
  const grandTotals = useMemo(() => {
    const quotes = filteredQuotes
    return {
      count: quotes.length,
      totalHT: quotes.reduce((sum, q) => sum + (q.total_ht || 0), 0),
      totalTVA: quotes.reduce((sum, q) => sum + (q.total_tva || 0), 0),
      totalTTC: quotes.reduce((sum, q) => sum + (q.total_ttc || 0), 0),
    }
  }, [filteredQuotes])

  // Chaque colonne affichée se trie : c'est la première chose qu'on cherche à
  // faire devant un tableau, et aucune ne le permettait.
  const compareText = (a?: string, b?: string) => (a || '').localeCompare(b || '', 'fr')
  const compareDate = (a?: string, b?: string) => (a ? dayjs(a).valueOf() : 0) - (b ? dayjs(b).valueOf() : 0)
  // ⚠️ UN REPLI FRANÇAIS SUR CHAQUE CLÉ. Sans lui, i18next rend la CLÉ quand la
  // traduction manque : la colonne affichait « quoteEditor.statusValidated » et
  // le filtre proposait la même chose. Deux statuts viennent d'apparaître, leurs
  // traductions ne sont pas encore posées.
  const statusLabel = (status: string) =>
    statusLabelKeys[status] ? t(statusLabelKeys[status], statusLabelDefauts[status] || status) : status

  const columns = [
    {
      title: t('quotes.colNumber'),
      dataIndex: 'number',
      key: 'number',
      width: columnWidths.number,
      sorter: (a: Quote, b: Quote) => compareText(a.number, b.number),
      onHeaderCell: () => ({
        width: columnWidths.number,
        onResize: handleResize('number'),
      }),
    },
    {
      title: t('quotes.colClient'),
      key: 'client',
      width: columnWidths.client,
      sorter: (a: Quote, b: Quote) => compareText(a.client?.name, b.client?.name),
      onHeaderCell: () => ({
        width: columnWidths.client,
        onResize: handleResize('client'),
      }),
      render: (_: unknown, record: Quote) => record.client?.name || '-',
    },
    {
      title: t('quotes.colSubject'),
      dataIndex: 'subject',
      key: 'subject',
      width: columnWidths.subject,
      // ⚠️ PAS « ellipsis: true » ICI, ET C'EST LA RAISON DE TOUT.
      //
      // antd pose alors la classe ant-table-cell-ellipsis sur l'en-tête AUSSI,
      // et avec elle un overflow:hidden qui rognait la poignée de
      // redimensionnement — placée à right:-5px, hors de la cellule. La poignée
      // s'affichait mais aucun glissement ne prenait : « Objet » était la seule
      // colonne à ne pas bouger, et c'est justement celle qu'on a le plus besoin
      // d'élargir puisque c'est elle qu'on tronque. On tronque donc dans la
      // cellule, et l'en-tête reste libre.
      sorter: (a: Quote, b: Quote) => compareText(a.subject, b.subject),
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
      sorter: (a: Quote, b: Quote) => compareDate(a.date, b.date),
      onHeaderCell: () => ({
        width: columnWidths.date,
        onResize: handleResize('date'),
      }),
      render: formatDate,
    },
    {
      title: t('quotes.colValidity'),
      dataIndex: 'validity_date',
      key: 'validity_date',
      width: columnWidths.validity_date,
      sorter: (a: Quote, b: Quote) => compareDate(a.validity_date, b.validity_date),
      onHeaderCell: () => ({
        width: columnWidths.validity_date,
        onResize: handleResize('validity_date'),
      }),
      render: formatDate,
    },
    {
      title: t('quotes.colAmountHT'),
      dataIndex: 'total_ht',
      key: 'total_ht',
      width: columnWidths.total_ht,
      align: 'right' as const,
      sorter: (a: Quote, b: Quote) => (a.total_ht || 0) - (b.total_ht || 0),
      onHeaderCell: () => ({
        width: columnWidths.total_ht,
        onResize: handleResize('total_ht'),
      }),
      render: (v: number) => `${v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
    },
    {
      title: t('quotes.colAmountTTC'),
      dataIndex: 'total_ttc',
      key: 'total_ttc',
      width: columnWidths.total_ttc,
      align: 'right' as const,
      sorter: (a: Quote, b: Quote) => (a.total_ttc || 0) - (b.total_ttc || 0),
      onHeaderCell: () => ({
        width: columnWidths.total_ttc,
        onResize: handleResize('total_ttc'),
      }),
      render: (v: number) => `${v?.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: columnWidths.status,
      sorter: (a: Quote, b: Quote) => compareText(statusLabel(a.status), statusLabel(b.status)),
      onHeaderCell: () => ({
        width: columnWidths.status,
        onResize: handleResize('status'),
      }),
      render: (status: string, record: Quote) => (
        <Space size={4}>
          <Tag color={statusColors[status]}>{statusLabel(status)}</Tag>
          {record.is_archived && <Tag color="default">{t('quotes.archived')}</Tag>}
        </Space>
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
      // Un clic dans cette colonne n'ouvre pas le devis : les boutons d'action
      // — et les confirmations qu'ils portent — sont ici, et le clic de ligne
      // les doublerait d'une ouverture d'onglet.
      onCell: () => ({ onClick: (event: React.MouseEvent) => event.stopPropagation() }),
      render: (_: unknown, record: Quote) => (
        <Space size="small">
          <Tooltip title={t('quotes.viewPdf')}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              size="small"
              onClick={() => handleViewPdf(record)}
            />
          </Tooltip>
          {/* ⚠️ LE CRAYON NE SE FIGE PLUS. Il était éteint hors brouillon : le
              devis ne pouvait alors plus s'ouvrir du tout, alors que le
              consulter est le geste le plus courant. Ouvrir est toujours
              permis — c'est l'ÉDITEUR qui décide de ce qui s'écrit, et il le
              fait déjà (champs éteints, étiquette « Non modifiable »). Le
              crayon fait donc exactement ce que fait le clic sur la ligne, et
              son infobulle le dit. */}
          <Tooltip title={estModifiable(record.status) ? t('common.edit') : t('common.open', 'Ouvrir')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t('quotes.downloadPdf')}>
            <Button
              type="text"
              icon={<FilePdfOutlined />}
              size="small"
              onClick={() => handleDownloadPdf(record)}
            />
          </Tooltip>
          <Tooltip title={t('quotes.duplicate')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              size="small"
              onClick={() => duplicateMutation.mutate(record.id)}
            />
          </Tooltip>
          <Tooltip title={record.is_archived ? t('quotes.unarchive') : t('quotes.archive')}>
            <Button
              type="text"
              icon={<InboxOutlined />}
              size="small"
              onClick={() => archiveMutation.mutate({ id: record.id, archived: !record.is_archived })}
            />
          </Tooltip>
          {estModifiable(record.status) && (
            // Le devis en attente de validation est le premier concerné : c'est
            // exactement celui qu'un responsable ouvre la liste pour valider.
            //
            // ⚠️ « Valider et envoyer » MENTAIT : ce bouton n'appelle que
            // /validate. Aucun courriel ne part, aucun lien public n'est créé,
            // et l'on croyait le devis chez le client. L'envoi se fait depuis
            // l'éditeur, par « Envoyer par courriel ».
            <Tooltip title={t('quotes.validate', { defaultValue: 'Valider' })}>
              <Popconfirm
                title={t('quotes.validateConfirm')}
                onConfirm={() => validateMutation.mutate(record.id)}
                okText={t('common.yes')}
                cancelText={t('common.no')}
              >
                <Button type="text" icon={<CheckOutlined />} size="small" style={{ color: 'green' }} />
              </Popconfirm>
            </Tooltip>
          )}
          <Popconfirm
            title={t('quotes.deleteConfirm')}
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
                disabled={!estModifiable(record.status)}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ paddingBottom: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t('quotes.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('quotes.newQuote')}
        </Button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input
          placeholder={t('quotes.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => refetch()}
        />
        <RangePicker
          placeholder={[t('quotes.dateFrom'), t('quotes.dateTo')]}
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
        {/* Tout le cycle de vie est proposé, dans son ordre : retrouver les
            devis « Attente validation » dans deux cents lignes se faisait à
            l'œil. */}
        <Select
          allowClear
          placeholder={t('quotes.statusFilter', 'Tous les statuts')}
          style={{ width: 200 }}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
          options={STATUTS_FILTRABLES.map((value) => ({
            value,
            label: statusLabel(value),
          }))}
        />
        <Checkbox
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        >
          {t('quotes.showArchived')}
        </Checkbox>
        {selectedRowKeys.length > 0 && (
          <Button
            icon={<InboxOutlined />}
            onClick={() => archiveBulkMutation.mutate({ ids: selectedRowKeys as string[], archived: true })}
          >
            {t('quotes.archiveCount', { count: selectedRowKeys.length })}
          </Button>
        )}
        {search && (
          <Button
            icon={<FilterOutlined />}
            onClick={() => setSearch('')}
          >
            {t('quotes.clearSearch')}
          </Button>
        )}
      </div>

      {data?.truncated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('quotes.tooManyResults', {
            defaultValue:
              "La période retenue dépasse {{count}} devis : seuls les {{count}} premiers sont affichés, totaux compris. Resserrez l'intervalle de dates.",
            count: PAGE_SIZE * MAX_PAGES,
          })}
        />
      )}

      {isLoading ? (
        <Table loading={true} columns={columns} dataSource={[]} />
      ) : (
        <div>
          {groupedQuotes.map((group) => (
            <div key={group.key} style={{ marginBottom: 24 }}>
              <div
                style={{
                  background: '#f5f5f5',
                  padding: '8px 16px',
                  fontWeight: 600,
                  fontSize: 15,
                  borderRadius: '4px 4px 0 0',
                  borderBottom: '2px solid #722ed1',
                }}
              >
                {group.label}
              </div>
              <Table
                dataSource={group.quotes}
                columns={columns}
                rowKey="id"
                pagination={false}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys),
                }}
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
                  <tr style={{ background: '#f9f0ff', fontWeight: 600 }}>
                    <td style={{ width: 40, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.number, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.client, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.subject, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.date, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.validity_date, padding: '8px', border: '1px solid #d3adf7', textAlign: 'right' }}>
                      {t('quotes.subtotal')}
                    </td>
                    <td style={{ width: columnWidths.total_ht, padding: '8px', border: '1px solid #d3adf7', textAlign: 'right' }}>
                      {formatCurrency(group.totalHT)} €
                    </td>
                    <td style={{ width: columnWidths.total_ttc, padding: '8px', border: '1px solid #d3adf7', textAlign: 'right' }}>
                      {formatCurrency(group.totalTTC)} €
                    </td>
                    <td style={{ width: columnWidths.status, padding: '8px', border: '1px solid #d3adf7' }}></td>
                    <td style={{ width: columnWidths.actions, padding: '8px', border: '1px solid #d3adf7' }}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {groupedQuotes.length === 0 && (
            <Table columns={columns} dataSource={[]} />
          )}

          {/* Totaux généraux - fixed */}
          {groupedQuotes.length > 0 && (
            <div
              style={{
                background: '#f9f0ff',
                padding: '16px 24px',
                borderRadius: 0,
                border: '2px solid #722ed1',
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
                {t('quotes.grandTotals', { count: grandTotals.count })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('quotes.totalHT')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalHT)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('quotes.totalTVA')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(grandTotals.totalTVA)} €</div>
                </div>
                <div>
                  <div style={{ color: '#666', fontSize: 12 }}>{t('quotes.totalTTC')}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#722ed1' }}>{formatCurrency(grandTotals.totalTTC)} €</div>
                </div>
              </div>
            </div>
          )}

                  </div>
      )}

    </div>
  )
}
