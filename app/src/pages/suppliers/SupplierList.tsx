import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Input, Space, Tooltip, message, Tag, Popconfirm } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { FilterValue, SorterResult } from 'antd/es/table/interface'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { supplierAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'

interface Supplier {
  id: string
  code: string
  name: string
  email?: string
  phone?: string
  city?: string
  is_active: boolean
}

interface SupplierListResponse {
  data: Supplier[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

export default function SupplierList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  // ⚠️ Le tri est celui du SERVEUR. Reclasser la page affichée donnerait un
  // ordre faux dès la deuxième page. /suppliers accepte « sort » et « order »,
  // sur la liste blanche de colonnes de Parties::orderBy.
  const [sort, setSort] = useState<string | undefined>(undefined)
  const [order, setOrder] = useState<'asc' | 'desc' | undefined>(undefined)
  const [active, setActive] = useState<string | undefined>(undefined)
  const { openDocumentTab } = useDocumentTabsStore()

  const { data, isLoading, refetch } = useQuery<SupplierListResponse>({
    queryKey: ['suppliers', page, pageSize, search, sort, order, active],
    queryFn: async () => {
      const response = await supplierAPI.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        sort,
        order,
        active,
      })
      return response.data
    },
  })

  // ⚠️ UN SEUL point d'entrée pour la pagination, le tri et le filtre. antd
  // appelle « onChange » pour les trois : y remettre systématiquement la page à
  // 1 annulait le clic sur « page 2 » aussitôt après l'avoir pris en compte.
  const handleTableChange = (
    pagination: TablePaginationConfig,
    filters: Record<string, FilterValue | null>,
    sorter: SorterResult<Supplier> | SorterResult<Supplier>[],
    extra: { action: 'paginate' | 'sort' | 'filter' },
  ) => {
    if ('paginate' === extra.action) {
      setPage(pagination.current || 1)
      setPageSize(pagination.pageSize || 10)

      return
    }

    const tri = Array.isArray(sorter) ? sorter[0] : sorter
    const colonne = tri?.columnKey ? String(tri.columnKey) : undefined

    setSort(tri?.order ? colonne : undefined)
    setOrder(tri?.order === 'descend' ? 'desc' : tri?.order === 'ascend' ? 'asc' : undefined)

    const statut = filters?.is_active
    setActive(Array.isArray(statut) && statut.length > 0 ? String(statut[0]) : undefined)

    // Trier ou filtrer refait un résultat : la page 3 de l'ancien n'a plus de
    // sens, et le serveur rendrait un tableau vide sous un pied bien rempli.
    setPage(1)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => supplierAPI.delete(id),
    onSuccess: () => {
      message.success(t('suppliers.deleteSuccess'))
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: (error: any) => {
      // Le serveur refuse la suppression d'un fournisseur cité par une commande
      // ou une facture, et dit lequel : masquer son motif derrière « Erreur lors
      // de la suppression » laisse l'utilisateur sans rien à corriger.
      message.error(error?.message || t('suppliers.deleteError'))
    },
  })

  const handleCreate = () => {
    openDocumentTab('supplier')
  }

  const handleEdit = (supplier: Supplier) => {
    openDocumentTab('supplier', supplier.id, supplier.name || t('suppliers.tabTitle', { code: supplier.code }))
  }

  // Les six colonnes affichées sont triables ; la clé est celle qu'attend
  // Parties::orderBy, toute autre est ignorée par le serveur.
  const columns = [
    { title: t('suppliers.colCode'), dataIndex: 'code', key: 'code', width: 100, sorter: true },
    { title: t('suppliers.colName'), dataIndex: 'name', key: 'name', sorter: true, defaultSortOrder: 'ascend' as const },
    { title: t('suppliers.colEmail'), dataIndex: 'email', key: 'email', sorter: true },
    { title: t('suppliers.colPhone'), dataIndex: 'phone', key: 'phone', sorter: true },
    { title: t('suppliers.colCity'), dataIndex: 'city', key: 'city', sorter: true },
    {
      title: t('suppliers.colStatus'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      sorter: true,
      // Un fournisseur désactivé restait mêlé aux actifs, sans aucun moyen de
      // l'écarter : le drapeau ne servait qu'à colorer une étiquette.
      filters: [
        { text: t('suppliers.active'), value: '1' },
        { text: t('suppliers.inactive'), value: '0' },
      ],
      filterMultiple: false,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? t('suppliers.active') : t('suppliers.inactive')}</Tag>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Supplier) => (
        // ⚠️ La ligne s'ouvre au clic : sans ce garde, le crayon et la corbeille
        // ouvriraient la fiche par-dessus l'action demandée.
        <Space size="small" onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('common.edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('suppliers.deleteConfirm')}
            // La fiche part à la corbeille, mais les commandes et les factures
            // qui la citent restent, à son nom : la confirmation doit le dire
            // avant, pas l'utilisateur le découvrir après.
            description={t(
              'suppliers.deleteConfirmDetail',
              'Les commandes et factures déjà établies à son nom, elles, resteront.'
            )}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Tooltip title={t('common.delete')}>
              <Button type="text" danger icon={<DeleteOutlined />} size="small" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t('suppliers.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('suppliers.newSupplier')}
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('suppliers.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          // ⚠️ Revenir à la page 1 à chaque frappe. La page fait partie de la
          // clé de requête : chercher depuis la page 2 interrogeait le serveur
          // en page=2 sur un résultat qui n'en compte qu'une, d'où un tableau
          // vide sous un pied qui annonçait « 3 fournisseurs ». Toutes les
          // autres listes (DealList, StockList) font déjà ce setPage(1).
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          onPressEnter={() => refetch()}
        />
      </div>

      <Table
        dataSource={data?.data || []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: data?.pagination?.total_items || 0,
          showSizeChanger: true,
          // ⚠️ « 1 fournisseurs » : le pluriel était systématique. Pas de
          // variable nommée « count », qui ferait chercher à i18next une clé
          // pluralisée (_one / _other) absente du fichier de traduction.
          showTotal: (total) =>
            total > 1
              ? t('suppliers.totalPlural', '{{n}} fournisseurs', { n: total })
              : t('suppliers.totalSingular', '{{n}} fournisseur', { n: total }),
        }}
        onRow={(record) => ({
          // ⚠️ UN CLIC SIMPLE OUVRE LA FICHE : la ligne portait un curseur
          // « main » qui promettait un clic et ne répondait qu'au double.
          onClick: () => handleEdit(record),
          onDoubleClick: () => handleEdit(record),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  )
}
