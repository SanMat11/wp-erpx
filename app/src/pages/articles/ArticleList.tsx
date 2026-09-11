import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Table, Button, Input, Tag, Space, Tooltip, Select, message, Popconfirm } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons'
import type { SorterResult } from 'antd/es/table/interface'
import { articleAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'

interface Article {
  id: string
  code: string
  name: string
  type: string
  purchase_price: number
  sale_price: number
  is_composed: boolean
  is_active: boolean
  components_count?: number
}

interface ArticleListResponse {
  data: Article[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

export default function ArticleList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | undefined>()
  const [composedFilter, setComposedFilter] = useState<boolean | undefined>()
  // ⚠️ LE TRI EST CELUI DU SERVEUR.
  //
  // Aucune des neuf colonnes n'était triable, et il ne suffisait pas d'ouvrir
  // le tri d'antd : la liste est paginée par le serveur, un tri local
  // n'aurait réordonné que les lignes de la page affichée — sur un catalogue de
  // plusieurs centaines d'articles, « les plus chers » n'auraient jamais été
  // les plus chers.
  const [tri, setTri] = useState<{ sort?: string; order?: 'asc' | 'desc' }>({})
  const { openDocumentTab } = useDocumentTabsStore()

  const typeOptions = [
    { value: 'product', label: t('articles.typeProduct') },
    { value: 'service', label: t('articles.typeService') },
  ]

  const { data, isLoading, refetch } = useQuery<ArticleListResponse>({
    queryKey: ['articles', page, pageSize, search, typeFilter, composedFilter, tri],
    queryFn: async () => {
      const response = await articleAPI.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        type: typeFilter,
        is_composed: composedFilter,
        ...tri,
      })
      return response.data
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => articleAPI.delete(id),
    onSuccess: () => {
      message.success(t('articles.deleteSuccess'))
      queryClient.invalidateQueries({ queryKey: ['articles'] })
    },
    // ⚠️ LE MOTIF DU REFUS, PAS UN TEXTE PASSE-PARTOUT.
    //
    // Le serveur refuse maintenant de supprimer un article qui figure sur un
    // document ou dans une nomenclature, et il dit lequel. L'écran jetait ce
    // texte et affichait « Erreur lors de la suppression » : l'utilisateur
    // n'avait aucun moyen de savoir ce qu'on lui reprochait.
    onError: (error: Error) => {
      message.error(error.message || t('articles.deleteError'))
    },
  })

  // ⚠️ DUPLIQUER, PARCE QUE TOUT RESAISIR N'EST PAS UNE MÉTHODE.
  //
  // Un catalogue se construit par variantes : la liste n'offrait que le crayon
  // et la corbeille, et créer un article voisin imposait de retaper les neuf
  // champs. Le code vient du serveur (next-code) plutôt que d'un « -COPIE »
  // fabriqué ici : la colonne est unique, et un code inventé finit par en
  // heurter un autre.
  const duplicateMutation = useMutation({
    mutationFn: async (article: Article) => {
      const source = await articleAPI.get(article.id)
      const suivant = await articleAPI.getNextCode()
      const { id, created_at, updated_at, ...champs } = source.data

      return articleAPI.create({
        ...champs,
        code: suivant.data?.code,
        name: t('articles.copyOf', '{{name}} (copie)', { name: source.data.name }),
      })
    },
    onSuccess: (response) => {
      message.success(t('articles.duplicateSuccess', 'Article dupliqué.'))
      queryClient.invalidateQueries({ queryKey: ['articles'] })

      if (response.data?.id) {
        openDocumentTab('article', response.data.id, response.data.name)
      }
    },
    onError: (error: Error) => {
      message.error(error.message || t('articles.duplicateError', "L'article n'a pas pu être dupliqué."))
    },
  })

  const handleCreate = () => {
    openDocumentTab('article')
  }

  const handleEdit = (article: Article) => {
    openDocumentTab('article', article.id, article.name || t('articles.tabTitle', { code: article.code }))
  }

  const columns = [
    { title: t('articles.code'), dataIndex: 'code', key: 'code', width: 100, sorter: true },
    { title: t('articles.designation'), dataIndex: 'name', key: 'name', sorter: true },
    {
      title: t('articles.type'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      sorter: true,
      render: (type: string) => (
        <Tag color={type === 'product' ? 'blue' : 'purple'}>
          {type === 'product' ? t('articles.typeProduct') : t('articles.typeService')}
        </Tag>
      ),
    },
    {
      title: t('articles.components'),
      dataIndex: 'is_composed',
      key: 'is_composed',
      width: 110,
      render: (v: boolean, record: Article) =>
        v ? (
          <Tag color="orange">{t('articles.componentsCount', { count: record.components_count || 0 })}</Tag>
        ) : null,
    },
    {
      title: t('articles.purchasePrice'),
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 110,
      sorter: true,
      render: (v: number) => `${(v || 0).toFixed(2)} EUR`,
    },
    {
      title: t('articles.salePrice'),
      dataIndex: 'sale_price',
      key: 'sale_price',
      width: 110,
      sorter: true,
      render: (v: number) => `${(v || 0).toFixed(2)} EUR`,
    },
    {
      title: t('articles.margin'),
      key: 'margin',
      width: 100,
      sorter: true,
      render: (_: unknown, record: Article) => {
        const margin = (record.sale_price || 0) - (record.purchase_price || 0)
        // ⚠️ SANS PRIX D'ACHAT, PAS DE POURCENTAGE — surtout pas « 0 % ».
        //
        // Le prix d'achat vaut 0 pour tout utilisateur qui n'a pas
        // amsbm_view_costs (Articles.php le masque volontairement) : le
        // pourcentage annonçait donc « 0 % » de marge sur TOUT le catalogue, à
        // côté d'un montant qui valait le prix de vente entier. Rien plutôt
        // qu'un chiffre faux.
        const marginPercent =
          record.purchase_price > 0
            ? ((margin / record.purchase_price) * 100).toFixed(1)
            : null
        const amount = (
          <span style={{ color: margin >= 0 ? 'green' : 'red' }}>
            {margin.toFixed(2)} EUR
          </span>
        )

        return marginPercent === null ? amount : <Tooltip title={`${marginPercent}%`}>{amount}</Tooltip>
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      sorter: true,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? t('articles.active') : t('articles.inactive')}</Tag>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 130,
      render: (_: unknown, record: Article) => (
        <Space size="small">
          <Tooltip title={t('common.edit')}>
            <Button
              type="text"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title={t('articles.duplicate', 'Dupliquer')}>
            <Button
              type="text"
              icon={<CopyOutlined />}
              size="small"
              loading={duplicateMutation.isPending}
              onClick={() => duplicateMutation.mutate(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('articles.deleteConfirm')}
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
        <h1 style={{ margin: 0 }}>{t('articles.title')}</h1>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('articles.newArticle')}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <Input
          placeholder={t('articles.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          allowClear
          value={search}
          // Une recherche repart de la première page : lancée depuis la page 3,
          // elle demandait la page 3 d'un résultat qui n'en a qu'une, et le
          // tableau s'affichait vide alors que des lignes correspondaient.
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          onPressEnter={() => refetch()}
        />
        <Select
          placeholder={t('articles.type')}
          allowClear
          style={{ width: 150 }}
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
        />
        <Select
          placeholder={t('articles.composition')}
          allowClear
          style={{ width: 150 }}
          value={composedFilter}
          onChange={setComposedFilter}
          options={[
            { value: true, label: t('articles.composed') },
            { value: false, label: t('articles.simple') },
          ]}
        />
      </div>

      <Table
        dataSource={data?.data || []}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        onChange={(_pagination, _filtres, sorter) => {
          const demande = Array.isArray(sorter) ? sorter[0] : (sorter as SorterResult<Article>)
          const suivant = demande?.order && demande.columnKey
            ? { sort: String(demande.columnKey), order: demande.order === 'descend' ? ('desc' as const) : ('asc' as const) }
            : {}

          // Le tableau appelle onChange pour la pagination aussi : sans ce
          // test, changer de page ramènerait toujours à la première.
          if (suivant.sort !== tri.sort || suivant.order !== tri.order) {
            setTri(suivant)
            setPage(1)
          }
        }}
        pagination={{
          current: page,
          pageSize: pageSize,
          total: data?.pagination?.total_items || 0,
          showSizeChanger: true,
          showTotal: (total) => t('articles.totalCount', { count: total }),
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
        onRow={(record) => ({
          onDoubleClick: () => handleEdit(record),
          style: { cursor: 'pointer' },
        })}
      />
    </div>
  )
}
