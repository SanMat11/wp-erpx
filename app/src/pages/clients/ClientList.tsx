import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Input, Space, Popconfirm, message, Tag } from 'antd'
import type { TablePaginationConfig } from 'antd'
import type { FilterValue, SorterResult } from 'antd/es/table/interface'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { clientAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import type { Client, PaginatedResponse } from '@/types'

export default function ClientList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // ⚠️ Le tri est celui du SERVEUR, pas un reclassement de la page affichée.
  //
  // Trier les vingt lignes rapportées donnerait un ordre faux dès la deuxième
  // page : « le plus petit code » ne serait que le plus petit des vingt-là.
  // /clients accepte « sort » et « order » (liste blanche de colonnes,
  // Parties::orderBy) ; c'est ce couple qu'on lui passe.
  const [sort, setSort] = useState<string | undefined>(undefined)
  const [order, setOrder] = useState<'asc' | 'desc' | undefined>(undefined)
  const [active, setActive] = useState<string | undefined>(undefined)
  const { openDocumentTab } = useDocumentTabsStore()

  const { data, isLoading } = useQuery({
    queryKey: ['clients', { page, pageSize, search, sort, order, active }],
    queryFn: async () => {
      const response = await clientAPI.list({ page, page_size: pageSize, search, sort, order, active })
      return response.data as PaginatedResponse<Client>
    },
  })

  // ⚠️ UN SEUL point d'entrée pour la pagination, le tri et le filtre. antd
  // appelle « onChange » pour les trois : y remettre systématiquement la page à
  // 1 annulait le clic sur « page 2 » aussitôt après l'avoir pris en compte.
  const handleTableChange = (
    pagination: TablePaginationConfig,
    filters: Record<string, FilterValue | null>,
    sorter: SorterResult<Client> | SorterResult<Client>[],
    extra: { action: 'paginate' | 'sort' | 'filter' },
  ) => {
    if ('paginate' === extra.action) {
      setPage(pagination.current || 1)
      setPageSize(pagination.pageSize || 20)

      return
    }

    const tri = Array.isArray(sorter) ? sorter[0] : sorter
    const colonne = tri?.columnKey ? String(tri.columnKey) : undefined

    // Le troisième clic rend « order » indéfini : on repart de l'ordre naturel
    // du serveur plutôt que de figer le dernier sens choisi.
    setSort(tri?.order ? colonne : undefined)
    setOrder(tri?.order === 'descend' ? 'desc' : tri?.order === 'ascend' ? 'asc' : undefined)

    const statut = filters?.is_active
    setActive(Array.isArray(statut) && statut.length > 0 ? String(statut[0]) : undefined)

    // Trier ou filtrer refait un résultat : la page 3 de l'ancien n'a plus de
    // sens, et le serveur rendrait un tableau vide sous un pied bien rempli.
    setPage(1)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientAPI.delete(id),
    onSuccess: () => {
      message.success(t('clients.deleteSuccess'))
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    // Le serveur refuse la suppression d'un client cité par un devis ou une
    // facture, et dit lesquels : masquer son motif derrière « Erreur lors de la
    // suppression » ne laisse rien à corriger.
    onError: (error: any) => {
      message.error(error?.message || t('clients.deleteError'))
    },
  })

  const handleCreate = () => {
    openDocumentTab('client')
  }

  const handleEdit = (record: Client) => {
    openDocumentTab('client', record.id, record.name || t('clients.defaultLabel', { code: record.code }))
  }

  // Les six colonnes affichées sont triables : la clé est celle qu'attend
  // Parties::orderBy, toute autre est ignorée par le serveur.
  const columns = [
    {
      title: t('clients.colCode'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: true,
    },
    {
      title: t('clients.colName'),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('clients.colEmail'),
      dataIndex: 'email',
      key: 'email',
      sorter: true,
    },
    {
      title: t('clients.colPhone'),
      dataIndex: 'phone',
      key: 'phone',
      sorter: true,
    },
    {
      title: t('clients.colCity'),
      dataIndex: 'city',
      key: 'city',
      sorter: true,
    },
    {
      title: t('clients.colStatus'),
      dataIndex: 'is_active',
      key: 'is_active',
      sorter: true,
      // Une fiche désactivée reste dans la liste, mêlée aux autres : sans filtre,
      // le drapeau ne servait qu'à colorer une étiquette.
      filters: [
        { text: t('clients.statusActive'), value: '1' },
        { text: t('clients.statusInactive'), value: '0' },
      ],
      filterMultiple: false,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? t('clients.statusActive') : t('clients.statusInactive')}
        </Tag>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Client) => (
        // ⚠️ La ligne s'ouvre au clic : sans ce garde, le crayon et la corbeille
        // ouvriraient la fiche par-dessus l'action demandée.
        <Space onClick={(e) => e.stopPropagation()}>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('clients.deleteConfirm')}
            // La fiche part à la corbeille, mais les devis et factures déjà
            // établis à son nom restent : le serveur refuse d'ailleurs la
            // suppression tant qu'il y en a.
            description={t(
              'clients.deleteConfirmDetail',
              'Les devis et factures déjà établis à son nom, eux, resteront.'
            )}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t('clients.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('clients.newClient')}
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder={t('clients.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={search}
          // ⚠️ Toute nouvelle recherche repart de la page 1.
          //
          // Sans cela, chercher depuis la page 2 gardait page:2 dans la requête :
          // le serveur rendait une page vide alors que le pied du tableau
          // annonçait des résultats, et l'écran affichait « No data ».
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          style={{ width: 300 }}
          allowClear
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
          total: data?.pagination.totalItems || 0,
          showSizeChanger: true,
          // ⚠️ « 1 clients » : le pluriel était systématique. On n'emploie pas
          // « count » comme nom de variable, qui ferait chercher à i18next une
          // clé pluralisée (_one / _other) que le fichier de traduction n'a pas.
          showTotal: (total) =>
            total > 1
              ? t('clients.totalPlural', '{{n}} clients', { n: total })
              : t('clients.totalSingular', '{{n}} client', { n: total }),
        }}
        onRow={(record) => ({
          // ⚠️ UN CLIC SIMPLE OUVRE LA FICHE. La ligne portait un curseur
          // « main » qui promettait un clic, et ne répondait qu'au double :
          // il fallait le deviner. Le double-clic reste, il ne coûte rien.
          onClick: () => handleEdit(record),
          onDoubleClick: () => handleEdit(record),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  )
}
