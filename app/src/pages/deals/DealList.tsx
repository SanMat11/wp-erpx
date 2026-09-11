import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Table, Button, Input, Tag, Select, Space, Tooltip, Popconfirm, message } from 'antd'
import type { SortOrder } from 'antd/es/table/interface'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, FundOutlined, CopyOutlined, EyeOutlined } from '@ant-design/icons'
import { dealAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'
import { useListColumnWidths } from '@/hooks/useColumnWidths'
import { ResizableHeaderCell } from '@/components/ResizableTable'
import dayjs from 'dayjs'

// Default column widths for deal list
const DEFAULT_DEAL_LIST_WIDTHS = {
  number: 120,
  subject: 200,
  client: 150,
  expected_amount: 130,
  total_invoiced: 120,
  total_paid: 120,
  remaining_to_invoice: 130,
  due_date: 110,
  status: 100,
  actions: 100,
}

interface Deal {
  id: string
  number?: string
  name: string
  subject?: string
  client_id?: string
  client?: { id: string; name: string }
  status: string
  due_date?: string
  expected_amount: number
  expected_close_date?: string
  source?: string
  notes?: string
  total_invoiced: number
  total_paid: number
  remaining_to_invoice: number
  created_at: string
  updated_at: string
}

const statusColors: Record<string, string> = {
  attente_validation: 'orange',
  en_cours: 'blue',
  termine: 'green',
  annule: 'red',
  // Legacy values
  in_progress: 'blue',
  completed: 'green',
  cancelled: 'red',
  proposal: 'blue',
}

export default function DealList() {
  const { t } = useTranslation()
  const { openDocumentTab } = useDocumentTabsStore()

  // ⚠️ ON N'OFFRE PAS UN GESTE QU'ON SAIT REFUSÉ.
  // Les routes d'écriture des affaires exigent désormais le droit sur l'entité
  // — le magasinier ouvrait, renommait et supprimait un dossier, la matrice
  // n'y pouvait rien. Le serveur refuse ; l'écran ne doit plus le proposer.
  //
  // ⚠️ ET TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN : la matrice arrive par un
  // appel, et avant sa réponse canEdit() rend « faux » pour tout le monde.
  const peutEcrire = usePermissionStore((etat) => etat.canEdit('deals'))
  const droitsConnus = usePermissionsChargees()
  const offrirLEcriture = !droitsConnus || peutEcrire

  // Status label keys (mapped to translation keys)
  const statusLabelKeys: Record<string, string> = {
    attente_validation: 'deals.statusPendingValidation',
    en_cours: 'deals.statusInProgress',
    termine: 'deals.statusCompleted',
    annule: 'deals.statusCancelled',
    // Legacy values
    in_progress: 'deals.statusInProgress',
    completed: 'deals.statusCompleted',
    cancelled: 'deals.statusCancelled',
    proposal: 'deals.statusInProgress',
  }

  // Options pour le filtre (sans les valeurs legacy)
  const statusFilterOptions = [
    { value: 'attente_validation', label: t('deals.statusPendingValidation', 'Attente validation') },
    { value: 'en_cours', label: t('deals.statusInProgress') },
    { value: 'termine', label: t('deals.statusCompleted') },
    { value: 'annule', label: t('deals.statusCancelled') },
  ]

  const { columnWidths, handleResize } = useListColumnWidths('erp_deal_list_widths', DEFAULT_DEAL_LIST_WIDTHS)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // ⚠️ LE TRI SE FAIT AU SERVEUR, PAS DANS LE TABLEAU.
  //
  // Un `sorter` de fonction ne réordonne que la page affichée : sur 23 affaires
  // en pages de 10, « la plus grosse » aurait désigné la plus grosse des dix
  // premières. La liste envoie donc orderby/order, et Deals::index sait trier
  // jusque sur les montants, qu'il recalcule.
  const [sortField, setSortField] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<SortOrder>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  // Fetch deals
  const { data: dealsData, isLoading, refetch } = useQuery({
    queryKey: ['deals', search, statusFilter, page, pageSize, sortField, sortOrder],
    queryFn: async () => {
      const params: Record<string, unknown> = { page, page_size: pageSize }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (sortField && sortOrder) {
        params.orderby = sortField
        params.order = sortOrder === 'ascend' ? 'asc' : 'desc'
      }
      const response = await dealAPI.list(params)
      return response.data
    },
    // La liste se remet à jour au retour sur la fenêtre : les montants facturés
    // et réglés d'une affaire bougent au gré des factures, et l'écran gardait
    // les anciens jusqu'à la réouverture de l'onglet. Pas de minuteur ici : ces
    // changements viennent de l'intérieur du produit.
    refetchOnWindowFocus: true,
  })

  // Entêtes triables : l'ordre courant se relit dans la colonne concernée, et
  // seulement dans celle-là — sans quoi antd afficherait plusieurs flèches.
  const sortable = (key: string) => ({
    sorter: true,
    sortOrder: sortField === key ? sortOrder : null,
  })

  const handleOpenDeal = (deal: Deal) => {
    openDocumentTab('deal', deal.id, `${t('deals.tabPrefix')} - ${deal.name}`)
  }

  // ⚠️ UN SEUL CLIC OUVRE L'AFFAIRE — il en fallait deux.
  //
  // La case de sélection, elle, n'ouvre pas : cocher une ligne pour la
  // supprimer ouvrirait un onglet par-dessus. La colonne « Actions » arrête
  // l'événement dans sa propre cellule (voir onCell plus bas).
  const ouvrirDepuisLaLigne = (deal: Deal) => (event: React.MouseEvent<HTMLElement>) => {
    const cellule = (event.target as HTMLElement).closest('td')
    if (cellule?.classList.contains('ant-table-selection-column')) return
    handleOpenDeal(deal)
  }

  const handleNewDeal = () => {
    openDocumentTab('deal', undefined, t('deals.newDeal'))
  }

  const handleDelete = async (id: string) => {
    try {
      await dealAPI.delete(id)
      message.success(t('deals.deleteSuccess'))
      refetch()
    } catch (error: unknown) {
      // ⚠️ Le serveur nomme son motif « message » — « error » n'existe pas dans
      // l'enveloppe d'erreur de WP_Error. À ne lire que « error », le motif du
      // refus était systématiquement remplacé par le texte générique.
      const err = error as { response?: { data?: { message?: string; error?: string } } }
      const errorMessage = err.response?.data?.message || err.response?.data?.error || t('deals.deleteError')
      message.error(errorMessage, 8) // Afficher pendant 8 secondes
    }
  }

  // ⚠️ Le motif du refus vient du serveur — « 2 factures client la citent
  // encore ». Une suppression d'affaire peut désormais être REFUSÉE : sans ce
  // texte, l'utilisateur ne saurait pas quoi détacher.
  const deleteReason = (error: unknown): string | null => {
    const err = error as { response?: { data?: { message?: string; error?: string } } }
    return err.response?.data?.message || err.response?.data?.error || null
  }

  // Suppression groupée : une affaire refusée n'arrête pas les autres, et le
  // compte final dit exactement ce qui est passé et ce qui ne l'est pas.
  const handleDeleteSelection = async () => {
    const ids = selectedRowKeys.map(String)
    if (ids.length === 0) return
    setBulkDeleting(true)
    let supprimees = 0
    const refus: string[] = []

    for (const id of ids) {
      try {
        await dealAPI.delete(id)
        supprimees += 1
      } catch (error: unknown) {
        refus.push(deleteReason(error) || t('deals.deleteError'))
      }
    }

    setSelectedRowKeys([])
    setBulkDeleting(false)
    refetch()

    if (supprimees > 0) {
      message.success(t('deals.bulkDeleteDone', '{{count}} affaire(s) supprimée(s)', { count: supprimees }))
    }
    if (refus.length > 0) {
      message.error(
        `${t('deals.bulkDeleteRefused', '{{count}} affaire(s) conservée(s) :', { count: refus.length })} ${refus[0]}`,
        10
      )
    }
  }

  // Duplication d'une affaire : on relit le dossier complet (la liste ne porte
  // ni les lignes de budget ni les notes) et on en rouvre un neuf. Le numéro,
  // lui, est attribué par la séquence — on ne recopie jamais un numéro.
  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id)
    try {
      const { data: source } = await dealAPI.get(id)
      await dealAPI.create({
        name: `${source.subject || source.name || ''} ${t('deals.copySuffix', '(copie)')}`.trim(),
        subject: `${source.subject || source.name || ''} ${t('deals.copySuffix', '(copie)')}`.trim(),
        client_id: source.client_id,
        status: 'en_cours',
        source: source.source,
        deal_address: source.deal_address,
        payment_terms: source.payment_terms,
        notes: source.notes,
        // Les lignes sont recopiées SANS leur identifiant : ce sont de
        // nouvelles lignes, pas les mêmes rangées ailleurs.
        lines: (source.lines || []).map((line: Record<string, unknown>) => ({
          line_type: line.line_type,
          article_id: line.article_id ?? null,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          purchase_price: line.purchase_price,
          discount_percent: line.discount_percent,
          tva_rate: line.tva_rate,
        })),
      })
      message.success(t('deals.duplicateSuccess', 'Affaire dupliquée'))
      refetch()
    } catch (error: unknown) {
      message.error(deleteReason(error) || t('deals.duplicateError', 'Erreur lors de la duplication'), 8)
    } finally {
      setDuplicatingId(null)
    }
  }

  // Le dossier d'affaire en PDF, porté par l'œil : c'est le geste « Voir » des
  // autres listes. La route existe et répond depuis toujours ; aucun bouton de
  // l'interface ne l'atteignait.
  //
  // ⚠️ L'ONGLET S'OUVRE AVANT L'APPEL, PAS APRÈS. Un window.open() lancé une
  // fois la réponse revenue n'est plus rattaché au clic : les navigateurs le
  // prennent pour une fenêtre surgissante et le bloquent sans un mot. On ouvre
  // l'onglet tout de suite, on y pose le PDF quand il arrive, et on le referme
  // si le serveur refuse.
  const handleViewPdf = async (id: string) => {
    const onglet = window.open('', '_blank')
    if (onglet) onglet.opener = null

    try {
      const response = await dealAPI.getPdf(id)
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
      message.error(t('deals.pdfError', "Erreur lors de l'ouverture du PDF"))
    }
  }

  const deals: Deal[] = dealsData?.data || []
  // ⚠️ Le total est dans « pagination », pas à la racine : à la racine il valait
  // toujours 0, le compteur annonçait « 0 affaire(s) » et la pagination restait
  // inerte — les affaires au-delà de la première page devenaient inatteignables.
  // Les deux graphies sont rendues par le serveur, on lit les deux.
  const total = dealsData?.pagination?.totalItems ?? dealsData?.pagination?.total_items ?? dealsData?.total ?? 0

  const formatMoney = (v: number) => `${v?.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

  const columns = [
    {
      title: t('deals.colNumber'),
      dataIndex: 'number',
      key: 'number',
      ...sortable('number'),
      width: columnWidths.number,
      onHeaderCell: () => ({
        width: columnWidths.number,
        onResize: handleResize('number'),
      }),
      render: (number: string, record: Deal) => (
        <a onClick={() => handleOpenDeal(record)} style={{ cursor: 'pointer', fontWeight: 500 }}>
          {number || '-'}
        </a>
      ),
    },
    {
      title: t('deals.colSubject'),
      dataIndex: 'subject',
      key: 'subject',
      ...sortable('subject'),
      width: columnWidths.subject,
      onHeaderCell: () => ({
        width: columnWidths.subject,
        onResize: handleResize('subject'),
      }),
      render: (subject: string, record: Deal) => (
        <a onClick={() => handleOpenDeal(record)} style={{ cursor: 'pointer' }}>
          {subject || record.name || '-'}
        </a>
      ),
    },
    {
      title: t('deals.colClient'),
      dataIndex: ['client', 'name'],
      key: 'client',
      ...sortable('client'),
      width: columnWidths.client,
      onHeaderCell: () => ({
        width: columnWidths.client,
        onResize: handleResize('client'),
      }),
      render: (name: string) => name || <span style={{ color: '#999' }}>-</span>,
    },
    {
      title: t('deals.colExpectedAmount'),
      dataIndex: 'expected_amount',
      key: 'expected_amount',
      ...sortable('expected_amount'),
      width: columnWidths.expected_amount,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.expected_amount,
        onResize: handleResize('expected_amount'),
      }),
      render: (v: number) => (
        <span style={{ fontWeight: 500 }}>{formatMoney(v)}</span>
      ),
    },
    {
      title: t('deals.colInvoiced'),
      dataIndex: 'total_invoiced',
      key: 'total_invoiced',
      ...sortable('total_invoiced'),
      width: columnWidths.total_invoiced,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.total_invoiced,
        onResize: handleResize('total_invoiced'),
      }),
      render: (v: number) => (
        <span>{formatMoney(v)}</span>
      ),
    },
    {
      title: t('deals.colPaid'),
      dataIndex: 'total_paid',
      key: 'total_paid',
      ...sortable('total_paid'),
      width: columnWidths.total_paid,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.total_paid,
        onResize: handleResize('total_paid'),
      }),
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#52c41a' : undefined }}>{formatMoney(v)}</span>
      ),
    },
    {
      title: t('deals.colRemainingToInvoice'),
      dataIndex: 'remaining_to_invoice',
      key: 'remaining_to_invoice',
      ...sortable('remaining_to_invoice'),
      width: columnWidths.remaining_to_invoice,
      align: 'right' as const,
      onHeaderCell: () => ({
        width: columnWidths.remaining_to_invoice,
        onResize: handleResize('remaining_to_invoice'),
      }),
      render: (v: number) => (
        <span style={{ color: v > 0 ? '#fa8c16' : '#52c41a' }}>{formatMoney(v)}</span>
      ),
    },
    {
      title: t('deals.colDueDate'),
      dataIndex: 'due_date',
      key: 'due_date',
      ...sortable('due_date'),
      width: columnWidths.due_date,
      onHeaderCell: () => ({
        width: columnWidths.due_date,
        onResize: handleResize('due_date'),
      }),
      render: (date: string) =>
        date ? dayjs(date).format('DD/MM/YYYY') : <span style={{ color: '#999' }}>-</span>,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      ...sortable('status'),
      width: columnWidths.status,
      onHeaderCell: () => ({
        width: columnWidths.status,
        onResize: handleResize('status'),
      }),
      render: (status: string) => (
        <Tag color={statusColors[status]}>
          {statusLabelKeys[status] ? t(statusLabelKeys[status]) : status}
        </Tag>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: columnWidths.actions,
      align: 'center' as const,
      onHeaderCell: () => ({
        width: columnWidths.actions,
        onResize: handleResize('actions'),
      }),
      // Un clic dans cette colonne n'ouvre pas l'affaire : les boutons d'action
      // — et les confirmations qu'ils portent — sont ici, et le clic de ligne
      // les doublerait d'une ouverture d'onglet.
      onCell: () => ({ onClick: (event: React.MouseEvent) => event.stopPropagation() }),
      render: (_: unknown, record: Deal) => (
        <Space size={0}>
          {/* L'œil porte le dossier PDF ; l'icône « fichier PDF » qui était ici
              faisait exactement la même chose — un seul bouton suffit, et c'est
              le même œil que dans les quatre autres listes. */}
          <Tooltip title={t('deals.pdf', 'Dossier PDF')}>
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleViewPdf(record.id)}
            />
          </Tooltip>
          <Tooltip title={t('deals.viewEdit')}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleOpenDeal(record)}
            />
          </Tooltip>
          {offrirLEcriture && (
            <Tooltip title={t('deals.duplicate', 'Dupliquer')}>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                loading={duplicatingId === record.id}
                onClick={() => handleDuplicate(record.id)}
              />
            </Tooltip>
          )}
          {offrirLEcriture && (
            <Popconfirm
              title={t('deals.deleteConfirm')}
              description={t('deals.deleteIrreversible')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('common.delete')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Tooltip title={t('common.delete')}>
                <Button type="text" size="small" icon={<DeleteOutlined />} danger />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>
          <FundOutlined style={{ marginRight: 8 }} />
          {t('deals.title')}
        </h1>
        {offrirLEcriture && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNewDeal}>
            {t('deals.newDeal')}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        <Input
          placeholder={t('deals.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <Select
          placeholder={t('deals.filterByStatus')}
          style={{ width: 200 }}
          allowClear
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value)
            setPage(1)
          }}
        >
          {statusFilterOptions.map(({ value, label }) => (
            <Select.Option key={value} value={value}>
              <Tag color={statusColors[value]}>{label}</Tag>
            </Select.Option>
          ))}
        </Select>
        {offrirLEcriture && selectedRowKeys.length > 0 && (
          <Popconfirm
            title={t('deals.bulkDeleteConfirm', 'Supprimer les affaires sélectionnées ?')}
            description={t('deals.deleteIrreversible')}
            onConfirm={handleDeleteSelection}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} loading={bulkDeleting}>
              {t('deals.bulkDelete', 'Supprimer ({{count}})', { count: selectedRowKeys.length })}
            </Button>
          </Popconfirm>
        )}
      </div>

      {/* Table */}
      <Table
        dataSource={deals}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        onChange={(_pagination, _filters, sorter) => {
          const tri = Array.isArray(sorter) ? sorter[0] : sorter
          const champ = tri?.order ? (tri.columnKey as string) : undefined
          const sens = tri?.order ?? null
          // ⚠️ Seulement si le TRI a bougé. antd appelle aussi onChange à chaque
          // changement de page : remettre page=1 sans condition annulait le
          // bouton « suivant » aussitôt après l'avoir cliqué.
          if (champ !== sortField || sens !== sortOrder) {
            setSortField(champ)
            setSortOrder(sens)
            setPage(1)
          }
        }}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: total,
          showSizeChanger: true,
          showTotal: (total) => t('deals.totalCount', { count: total }),
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
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
    </div>
  )
}
