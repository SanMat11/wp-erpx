import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  Button,
  Input,
  Space,
  Tag,
  Card,
  Select,
  Modal,
  Form,
  message,
  Popconfirm,
  Upload,
  Row,
  Col,
  Radio,
  Alert,
} from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import {
  SearchOutlined,
  DownloadOutlined,
  DeleteOutlined,
  UploadOutlined,
  FolderOpenOutlined,
  EyeOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { documentAPI, clientAPI, supplierAPI } from '@/services/api'
import JSZip from 'jszip'

interface Document {
  id: string
  name: string
  original_name: string
  mime_type: string
  size: number
  category: string
  description: string
  client_id?: string
  supplier_id?: string
  article_id?: string
  quote_id?: string
  invoice_id?: string
  deal_id?: string
  created_at: string
  client?: { name: string }
  supplier?: { name: string }
  quote?: { number: string }
  invoice?: { number: string }
  article?: { name: string }
  deal?: { name: string }
}

const categoryColors: Record<string, string> = {
  contract: 'blue',
  invoice: 'green',
  quote: 'orange',
  report: 'purple',
  technical: 'cyan',
  legal: 'red',
  other: 'default',
}

export default function GEDList() {
  const { t } = useTranslation()
  const categoryLabels: Record<string, string> = {
    contract: t('ged.categoryContract'),
    invoice: t('ged.categoryInvoice'),
    quote: t('ged.categoryQuote'),
    report: t('ged.categoryReport'),
    technical: t('ged.categoryTechnical'),
    legal: t('ged.categoryLegal'),
    other: t('ged.categoryOther'),
  }
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('other')
  const [uploadName, setUploadName] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>()
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | undefined>()
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewType, setPreviewType] = useState<'pdf' | 'image'>('pdf')
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingDocument, setEditingDocument] = useState<Document | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadMode, setUploadMode] = useState<'multiple' | 'merge'>('multiple')
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDownloading, setBulkDownloading] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents', page, pageSize, search, categoryFilter],
    queryFn: async () => {
      const params: Record<string, unknown> = { page, page_size: pageSize }
      if (search) params.search = search
      if (categoryFilter) params.category = categoryFilter
      const response = await documentAPI.list(params)
      return response.data
    },
  })

  const { data: clientsData, isLoading: isLoadingClients, isError: isErrorClients } = useQuery({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const response = await clientAPI.list({ page: 1, page_size: 200 })
      return response.data
    },
  })

  const { data: suppliersData, isLoading: isLoadingSuppliers, isError: isErrorSuppliers } = useQuery({
    queryKey: ['suppliers-select'],
    queryFn: async () => {
      const response = await supplierAPI.list({ page: 1, page_size: 200 })
      return response.data
    },
  })

  const _handleUpload = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', uploadName || file.name)
    formData.append('category', uploadCategory)
    formData.append('description', uploadDescription)
    if (selectedClientId) formData.append('client_id', selectedClientId)
    if (selectedSupplierId) formData.append('supplier_id', selectedSupplierId)

    try {
      await documentAPI.upload(formData)
      message.success(t('ged.documentUploaded', { name: file.name }))
    } catch {
      message.error(t('ged.uploadError', { name: file.name }))
    }
    return false
  }
  void _handleUpload

  const handleUploadMultiple = async (fileList: File[]) => {
    if (fileList.length === 0) return

    setUploading(true)
    let successCount = 0
    const refus: string[] = []

    for (const file of fileList) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', fileList.length === 1 && uploadName ? uploadName : file.name)
      formData.append('category', uploadCategory)
      formData.append('description', uploadDescription)
      if (selectedClientId) formData.append('client_id', selectedClientId)
      if (selectedSupplierId) formData.append('supplier_id', selectedSupplierId)

      try {
        await documentAPI.upload(formData)
        successCount++
      } catch (error) {
        // ⚠️ LE MOTIF DU REFUS VIENT DU SERVEUR, ET IL LE FORMULE BIEN.
        //
        // Un simple compteur d'erreurs le jetait : « 1 document(s) en erreur »
        // pour un type interdit, un fichier trop gros ou un serveur tombé, sans
        // que rien ne permette de les distinguer. L'intercepteur axios a déjà
        // remonté le texte dans error.message ; on le montre, fichier par
        // fichier.
        const motif = error instanceof Error && error.message ? error.message : ''
        refus.push(motif ? `${file.name} : ${motif}` : file.name)
      }
    }

    setUploading(false)

    if (successCount > 0) {
      message.success(t('ged.documentsUploadedCount', { count: successCount }))
    }
    refus.forEach((motif) => message.error(motif))

    if (successCount > 0) {
      setUploadModalVisible(false)
      setUploadName('')
      setUploadDescription('')
      setUploadCategory('other')
      setSelectedClientId(undefined)
      setSelectedSupplierId(undefined)
      setPendingFiles([])
      refetch()
    }
  }

  const closeUploadModal = () => {
    setUploadModalVisible(false)
    setPendingFiles([])
    setUploadName('')
    setUploadDescription('')
    setUploadCategory('other')
    setSelectedClientId(undefined)
    setSelectedSupplierId(undefined)
    setUploadMode('multiple')
  }

  const handleUploadMerged = async (fileList: File[]) => {
    if (fileList.length === 0) return
    if (!uploadName) {
      message.warning(t('ged.mergeNameRequired'))
      return
    }

    setUploading(true)
    const formData = new FormData()

    // ⚠️ « file[] », avec les crochets, et surtout pas « files ».
    //
    // Le serveur lit $_FILES['file'] et attend un tableau : ce sont les crochets
    // qui le lui donnent. Sous « files », PHP ne retenait que le DERNIER fichier
    // et sous une autre clé — la route répondait donc « Aucun fichier reçu » à
    // chaque tentative, et la fusion n'a jamais fonctionné.
    fileList.forEach((file) => {
      formData.append('file[]', file)
    })
    formData.append('name', uploadName)
    formData.append('category', uploadCategory)
    formData.append('description', uploadDescription)
    if (selectedClientId) formData.append('client_id', selectedClientId)
    if (selectedSupplierId) formData.append('supplier_id', selectedSupplierId)

    try {
      await documentAPI.uploadMerged(formData)
      message.success(t('ged.documentsMerged'))
      closeUploadModal()
      refetch()
    } catch (error) {
      // Le serveur dit pourquoi il refuse — un PDF glissé parmi les images, une
      // extension PHP manquante à la fabrication du document. « Erreur lors de
      // la fusion » ne laissait aucune prise.
      const motif = error instanceof Error && error.message ? error.message : ''
      message.error(motif || t('ged.mergeError'))
    } finally {
      setUploading(false)
    }
  }

  // ⚠️ UN NOM DE DOCUMENT N'EST PAS UN CHEMIN.
  //
  // Le nom alimente le nom du fichier téléchargé ET le nom d'entrée de
  // l'archive ZIP. Repris tel quel, « ../../evasion.txt » produisait une
  // archive à chemin d'échappement (zip slip) : l'archive contenait « ../ »,
  // « ../../ » et l'entrée elle-même, et un outil d'extraction naïf écrivait le
  // fichier deux dossiers au-dessus du dossier cible. Le serveur nettoie
  // désormais le nom au dépôt, mais les pièces déjà enregistrées gardent le
  // leur : le nettoyage doit aussi se faire ici, au moment de composer le nom.
  const flatFileName = (name: string) => {
    const flat = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '').trim()
    return flat === '' ? 'document' : flat
  }

  const getDownloadName = (doc: Document) => {
    let name = flatFileName(doc.name || doc.original_name)
    const origExt = doc.original_name?.split('.').pop()
    if (origExt && !name.includes('.')) {
      name = `${name}.${origExt}`
    }
    return name
  }

  const handleDownload = async (doc: Document) => {
    try {
      const response = await documentAPI.download(doc.id)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', getDownloadName(doc))
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      message.error(t('ged.downloadError'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await documentAPI.delete(id)
      message.success(t('ged.documentDeleted'))
      refetch()
    } catch {
      message.error(t('ged.deleteError'))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) return

    setBulkDeleting(true)
    let successCount = 0
    let errorCount = 0

    for (const id of selectedRowKeys) {
      try {
        await documentAPI.delete(id as string)
        successCount++
      } catch {
        errorCount++
      }
    }

    setBulkDeleting(false)

    if (successCount > 0) {
      message.success(t('ged.documentsDeletedCount', { count: successCount }))
    }
    if (errorCount > 0) {
      message.error(t('ged.documentsErrorCount', { count: errorCount }))
    }

    setSelectedRowKeys([])
    refetch()
  }

  const showBulkDeleteConfirm = () => {
    Modal.confirm({
      title: t('ged.bulkDeleteConfirmTitle'),
      icon: <ExclamationCircleOutlined />,
      content: t('ged.bulkDeleteConfirmContent', { count: selectedRowKeys.length }),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: handleBulkDelete,
    })
  }

  const handleBulkDownload = async () => {
    if (selectedRowKeys.length === 0) return

    setBulkDownloading(true)
    const zip = new JSZip()
    let successCount = 0
    let errorCount = 0

    // Get the documents data to access original names
    const documents: Document[] = data?.data || []
    const selectedDocs = documents.filter(doc => selectedRowKeys.includes(doc.id))

    for (const doc of selectedDocs) {
      try {
        const response = await documentAPI.download(doc.id)
        const blob = new Blob([response.data])
        zip.file(getDownloadName(doc), blob)
        successCount++
      } catch {
        errorCount++
      }
    }

    if (successCount > 0) {
      try {
        const content = await zip.generateAsync({ type: 'blob' })
        const url = window.URL.createObjectURL(content)
        const link = document.createElement('a')
        link.href = url
        const now = new Date()
        const dateStr = now.toISOString().slice(0, 10)
        link.setAttribute('download', `documents_${dateStr}.zip`)
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
        message.success(t('ged.zipDownloadSuccess', { count: successCount }))
      } catch {
        message.error(t('ged.zipCreationError'))
      }
    }

    if (errorCount > 0) {
      message.warning(t('ged.zipAddError', { count: errorCount }))
    }

    setBulkDownloading(false)
  }

  const rowSelection: TableRowSelection<Document> = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys)
    },
  }

  const handleEdit = (doc: Document) => {
    setEditingDocument(doc)
    setEditName(doc.name || doc.original_name)
    setEditCategory(doc.category)
    setEditDescription(doc.description || '')
    setEditModalVisible(true)
  }

  const handleSaveEdit = async () => {
    if (!editingDocument) return
    // Le bouton est déjà désactivé sur un nom vide ; la garde reste ici parce
    // que c'est le seul endroit que traversent tous les chemins d'envoi.
    if (editName.trim() === '') return
    setSaving(true)
    try {
      await documentAPI.update(editingDocument.id, {
        name: editName.trim(),
        category: editCategory,
        description: editDescription,
      })
      message.success(t('ged.documentUpdated'))
      setEditModalVisible(false)
      setEditingDocument(null)
      refetch()
    } catch {
      message.error(t('ged.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const canPreview = (mimeType: string) => {
    return mimeType === 'application/pdf' || mimeType.startsWith('image/')
  }

  const handlePreview = async (doc: Document) => {
    try {
      const response = await documentAPI.download(doc.id)
      const blob = new Blob([response.data], { type: doc.mime_type })
      const url = window.URL.createObjectURL(blob)
      setPreviewUrl(url)
      setPreviewTitle(doc.name || doc.original_name)
      setPreviewType(doc.mime_type === 'application/pdf' ? 'pdf' : 'image')
      setPreviewVisible(true)
    } catch {
      message.error(t('ged.loadError'))
    }
  }

  const closePreview = () => {
    setPreviewVisible(false)
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  const formatFileSize = (size: number) => {
    if (size < 1024) return `${size} o`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`
    return `${(size / (1024 * 1024)).toFixed(1)} Mo`
  }

  const columns = [
    {
      title: t('common.name'),
      dataIndex: 'name',
      key: 'name',
      // Le tri se fait sur la page affichée : la route rend l'ordre de dépôt et
      // ne sait pas trier autrement. C'est le geste le plus courant sur une GED,
      // et aucune colonne ne l'offrait.
      sorter: (a: Document, b: Document) =>
        (a.name || a.original_name).localeCompare(b.name || b.original_name, 'fr'),
      render: (name: string, record: Document) => (
        <div>
          <div style={{ fontWeight: 500 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{record.original_name}</div>
        </div>
      ),
    },
    {
      title: t('ged.category'),
      dataIndex: 'category',
      key: 'category',
      width: 120,
      render: (cat: string) => (
        <Tag color={categoryColors[cat]}>{categoryLabels[cat] || cat}</Tag>
      ),
    },
    {
      title: t('ged.linkedTo'),
      key: 'linked',
      width: 250,
      render: (_: unknown, record: Document) => {
        const links: React.ReactNode[] = []

        if (record.client) {
          links.push(<Tag key="client" color="blue">{t('ged.linkClient')}: {record.client.name}</Tag>)
        } else if (record.client_id) {
          links.push(<Tag key="client" color="blue">{t('ged.linkClient')}</Tag>)
        }

        if (record.supplier) {
          links.push(<Tag key="supplier" color="orange">{t('ged.linkSupplier')}: {record.supplier.name}</Tag>)
        } else if (record.supplier_id) {
          links.push(<Tag key="supplier" color="orange">{t('ged.linkSupplier')}</Tag>)
        }

        if (record.quote) {
          links.push(<Tag key="quote" color="purple">{t('ged.linkQuote')}: {record.quote.number}</Tag>)
        } else if (record.quote_id) {
          links.push(<Tag key="quote" color="purple">{t('ged.linkQuote')}</Tag>)
        }

        if (record.invoice) {
          links.push(<Tag key="invoice" color="green">{t('ged.linkInvoice')}: {record.invoice.number}</Tag>)
        } else if (record.invoice_id) {
          links.push(<Tag key="invoice" color="green">{t('ged.linkInvoice')}</Tag>)
        }

        if (record.article) {
          links.push(<Tag key="article" color="cyan">{t('ged.linkArticle')}: {record.article.name}</Tag>)
        } else if (record.article_id) {
          links.push(<Tag key="article" color="cyan">{t('ged.linkArticle')}</Tag>)
        }

        if (record.deal) {
          links.push(<Tag key="deal" color="magenta">{t('ged.linkDeal')}: {record.deal.name}</Tag>)
        } else if (record.deal_id) {
          links.push(<Tag key="deal" color="magenta">{t('ged.linkDeal')}</Tag>)
        }

        return links.length > 0 ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{links}</div> : <span style={{ color: '#999' }}>-</span>
      },
    },
    {
      title: t('ged.size'),
      dataIndex: 'size',
      key: 'size',
      width: 100,
      sorter: (a: Document, b: Document) => a.size - b.size,
      render: formatFileSize,
    },
    {
      title: t('common.date'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 100,
      sorter: (a: Document, b: Document) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-',
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 180,
      render: (_: unknown, record: Document) => (
        <Space>
          {canPreview(record.mime_type) && (
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handlePreview(record)}
              title={t('ged.preview')}
            />
          )}
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            title={t('common.edit')}
          />
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(record)}
            title={t('ged.download')}
          />
          <Popconfirm
            title={t('ged.deleteConfirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} title={t('common.delete')} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Card
        title={
          <Space>
            <FolderOpenOutlined />
            <span>{t('ged.title')}</span>
          </Space>
        }
        extra={
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
            {t('ged.uploadDocument')}
          </Button>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Input
                placeholder={t('ged.searchPlaceholder')}
                prefix={<SearchOutlined />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
              />
            </Col>
            <Col span={4}>
              <Select
                placeholder={t('ged.category')}
                value={categoryFilter || undefined}
                onChange={(v) => setCategoryFilter(v || '')}
                allowClear
                style={{ width: '100%' }}
              >
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <Select.Option key={key} value={key}>{label}</Select.Option>
                ))}
              </Select>
            </Col>
          </Row>
        </div>

        {selectedRowKeys.length > 0 && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('ged.selectedCount', { count: selectedRowKeys.length })}</span>
                <Space>
                  <Button size="small" onClick={() => setSelectedRowKeys([])}>
                    {t('ged.deselectAll')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={handleBulkDownload}
                    loading={bulkDownloading}
                  >
                    {t('ged.downloadZip')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={showBulkDeleteConfirm}
                    loading={bulkDeleting}
                  >
                    {t('ged.deleteSelection')}
                  </Button>
                </Space>
              </div>
            }
          />
        )}

        <Table
          dataSource={data?.data || []}
          columns={columns}
          rowKey="id"
          loading={isLoading || bulkDeleting}
          rowSelection={rowSelection}
          onRow={(record) => ({
            onDoubleClick: () => {
              if (canPreview(record.mime_type)) {
                handlePreview(record)
              }
            },
            style: { cursor: canPreview(record.mime_type) ? 'pointer' : 'default' },
          })}
          pagination={{
            current: page,
            pageSize: pageSize,
            // ⚠️ Le serveur rend le compte sous « pagination.totalItems », jamais
            // sous « total » à la racine : lu là, il valait toujours 0 — antd
            // n'affichait qu'une page et tout document au-delà du 20e devenait
            // inatteignable, alors que la route paginait correctement.
            total: data?.pagination?.totalItems || 0,
            showSizeChanger: true,
            showTotal: (total) => t('ged.totalDocuments', { count: total }),
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
        />
      </Card>

      {/* Upload Modal */}
      <Modal
        title={t('ged.uploadModalTitle')}
        open={uploadModalVisible}
        onCancel={closeUploadModal}
        footer={null}
        width={600}
      >
        <Form layout="vertical">
          <Form.Item label={t('ged.uploadMode')}>
            <Radio.Group value={uploadMode} onChange={(e) => setUploadMode(e.target.value)}>
              <Radio.Button value="multiple">{t('ged.modeSeparate')}</Radio.Button>
              <Radio.Button value="merge">{t('ged.modeMerge')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={uploadMode === 'merge' ? t('ged.mergedNameLabel') : t('ged.optionalNameLabel')}>
                <Input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={uploadMode === 'merge' ? t('ged.mergedNamePlaceholder') : t('ged.optionalNamePlaceholder')}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('ged.category')}>
                <Select value={uploadCategory} onChange={setUploadCategory}>
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <Select.Option key={key} value={key}>{label}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={t('ged.linkToClient')}>
                <Select
                  placeholder={isLoadingClients ? t('common.loading') : isErrorClients ? t('ged.loadingError') : t('ged.selectClient')}
                  value={selectedClientId}
                  onChange={(v) => {
                    setSelectedClientId(v)
                    if (v) setSelectedSupplierId(undefined)
                  }}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                  loading={isLoadingClients}
                  status={isErrorClients ? 'error' : undefined}
                  notFoundContent={isLoadingClients ? t('common.loading') : t('ged.noClientFound')}
                >
                  {clientsData?.data?.map((client: { id: string; name: string }) => (
                    <Select.Option key={client.id} value={client.id}>{client.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('ged.linkToSupplier')}>
                <Select
                  placeholder={isLoadingSuppliers ? t('common.loading') : isErrorSuppliers ? t('ged.loadingError') : t('ged.selectSupplier')}
                  value={selectedSupplierId}
                  onChange={(v) => {
                    setSelectedSupplierId(v)
                    if (v) setSelectedClientId(undefined)
                  }}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                  loading={isLoadingSuppliers}
                  status={isErrorSuppliers ? 'error' : undefined}
                  notFoundContent={isLoadingSuppliers ? t('common.loading') : t('ged.noSupplierFound')}
                >
                  {suppliersData?.data?.map((supplier: { id: string; name: string }) => (
                    <Select.Option key={supplier.id} value={supplier.id}>{supplier.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={t('common.description')}>
            <Input.TextArea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              rows={2}
              placeholder={t('ged.descriptionPlaceholder')}
            />
          </Form.Item>

          <Form.Item>
            <Upload.Dragger
              accept=".pdf,.txt,.docx,.png,.jpg,.jpeg"
              multiple={true}
              showUploadList={false}
              beforeUpload={(file, fileList) => {
                // Only add files on the first call (when file === fileList[0])
                if (file === fileList[0]) {
                  setPendingFiles(prev => [...prev, ...fileList.map(f => f as unknown as File)])
                }
                return false
              }}
              disabled={uploading}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ fontSize: 32, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">
                {uploading ? t('ged.uploading') : t('ged.dragDropHint')}
              </p>
              <p className="ant-upload-hint">{t('ged.multipleFilesAccepted')}</p>
            </Upload.Dragger>
          </Form.Item>

          {pendingFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                {t('ged.selectedFiles', { count: pendingFiles.length })}
              </div>
              <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid #d9d9d9', borderRadius: 4, padding: 8 }}>
                {pendingFiles.map((file, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {file.name}
                    </span>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== index))}
                    />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                {uploadMode === 'multiple' ? (
                  <Button
                    type="primary"
                    loading={uploading}
                    onClick={() => handleUploadMultiple(pendingFiles)}
                  >
                    {t('ged.uploadSeparately', { count: pendingFiles.length })}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    loading={uploading}
                    onClick={() => handleUploadMerged(pendingFiles)}
                    disabled={!uploadName}
                  >
                    {t('ged.mergeIntoPdf')}
                  </Button>
                )}
                <Button onClick={() => setPendingFiles([])}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </Form>
      </Modal>

      {/* Preview Modal */}
      <Modal
        title={previewTitle}
        open={previewVisible}
        onCancel={closePreview}
        width={1000}
        footer={[
          <Button key="close" onClick={closePreview}>
            {t('common.close')}
          </Button>,
        ]}
        centered
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {previewUrl && previewType === 'pdf' && (
          <iframe
            src={previewUrl}
            style={{ width: '100%', height: '80vh', border: 'none' }}
            title={previewTitle}
           
          />
        )}
        {previewUrl && previewType === 'image' && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
            <img
              src={previewUrl}
              alt={previewTitle}
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
            />
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={t('ged.editModalTitle')}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveEdit}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        // ⚠️ Un nom vide était accepté et enregistré : la colonne « Nom » de la
        // liste rendait alors une première ligne blanche au-dessus du nom de
        // fichier. On refuse plutôt que d'enregistrer un document sans nom.
        okButtonProps={{ disabled: '' === editName.trim() }}
        width={500}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label={t('ged.documentName')}>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t('ged.documentName')}
            />
          </Form.Item>
          <Form.Item label={t('ged.category')}>
            <Select value={editCategory} onChange={setEditCategory} style={{ width: '100%' }}>
              {Object.entries(categoryLabels).map(([key, label]) => (
                <Select.Option key={key} value={key}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t('common.description')}>
            <Input.TextArea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              placeholder={t('ged.descriptionPlaceholder')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
