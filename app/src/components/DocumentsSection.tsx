import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Upload,
  Popconfirm,
  message,
  Spin,
  Radio,
  Row,
  Col,
  Alert,
} from 'antd'
import type { TableRowSelection } from 'antd/es/table/interface'
import {
  UploadOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  EyeOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { documentAPI } from '@/services/api'
import JSZip from 'jszip'

interface DocumentsSectionProps {
  entityType: 'quote' | 'invoice' | 'purchase_order' | 'client' | 'supplier' | 'article' | 'deal' | 'amendment'
  entityId: string
  title?: string
}

interface Document {
  id: string
  name: string
  original_name: string
  mime_type: string
  size: number
  category: string
  created_at: string
}

const categoryKeys = ['contract', 'invoice', 'quote', 'report', 'technical', 'legal', 'other']

export default function DocumentsSection({ entityType, entityId, title }: DocumentsSectionProps) {
  const { t } = useTranslation()
  const categoryLabels: Record<string, string> = {
    contract: t('documentsSection.categories.contract'),
    invoice: t('documentsSection.categories.invoice'),
    quote: t('documentsSection.categories.quote'),
    report: t('documentsSection.categories.report'),
    technical: t('documentsSection.categories.technical'),
    legal: t('documentsSection.categories.legal'),
    other: t('documentsSection.categories.other'),
  }
  const cardTitle = title ?? t('documentsSection.card.defaultTitle')
  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('other')
  const [uploadName, setUploadName] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMode, setUploadMode] = useState<'multiple' | 'merge'>('multiple')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewModalVisible, setPreviewModalVisible] = useState(false)
  const [previewingDocument, setPreviewingDocument] = useState<Document | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDownloading, setBulkDownloading] = useState(false)

  // Build query params based on entity type
  const getQueryParams = () => {
    const params: Record<string, string> = { page: '1', page_size: '100' }
    switch (entityType) {
      case 'quote':
        params.quote_id = entityId
        break
      case 'invoice':
        params.invoice_id = entityId
        break
      case 'purchase_order':
        params.purchase_order_id = entityId
        break
      case 'client':
        params.client_id = entityId
        break
      case 'supplier':
        params.supplier_id = entityId
        break
      case 'article':
        params.article_id = entityId
        break
      case 'deal':
        params.deal_id = entityId
        break
      case 'amendment':
        params.amendment_id = entityId
        break
    }
    return params
  }

  // Build form data with entity reference
  const appendEntityToFormData = (formData: FormData) => {
    switch (entityType) {
      case 'quote':
        formData.append('quote_id', entityId)
        break
      case 'invoice':
        formData.append('invoice_id', entityId)
        break
      case 'purchase_order':
        formData.append('purchase_order_id', entityId)
        break
      case 'client':
        formData.append('client_id', entityId)
        break
      case 'supplier':
        formData.append('supplier_id', entityId)
        break
      case 'article':
        formData.append('article_id', entityId)
        break
      case 'deal':
        formData.append('deal_id', entityId)
        break
      case 'amendment':
        formData.append('amendment_id', entityId)
        break
    }
  }

  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['documents', entityType, entityId],
    queryFn: async () => {
      const response = await documentAPI.list(getQueryParams())
      return response.data
    },
    enabled: !!entityId,
  })

  const closeUploadModal = () => {
    setUploadModalVisible(false)
    setUploadName('')
    setUploadDescription('')
    setUploadCategory('other')
    setUploadMode('multiple')
    setPendingFiles([])
  }

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
      appendEntityToFormData(formData)

      try {
        await documentAPI.upload(formData)
        successCount++
      } catch (error) {
        // Le motif du refus vient du serveur — type interdit, fichier vide,
        // fichier trop gros. Un compteur d'erreurs le jetait, et l'utilisateur
        // n'avait aucun moyen de savoir lequel des trois s'appliquait.
        const motif = error instanceof Error && error.message ? error.message : ''
        refus.push(motif ? `${file.name} : ${motif}` : file.name)
      }
    }

    setUploading(false)

    if (successCount > 0) {
      message.success(t('documentsSection.messages.filesUploaded', { count: successCount }))
    }
    refus.forEach((motif) => message.error(motif))

    closeUploadModal()
    refetchDocuments()
  }

  const handleUploadMerged = async (fileList: File[]) => {
    if (fileList.length === 0) return
    if (!uploadName) {
      message.warning(t('documentsSection.messages.mergedNameRequired'))
      return
    }

    setUploading(true)
    const formData = new FormData()

    // ⚠️ « file[] », avec les crochets, et pas « files ».
    //
    // La route de fusion lit $_FILES['file'] et exige un tableau. Un champ
    // multipart répété SANS crochets n'en fait pas un : PHP ne garde que le
    // dernier fichier. Sous « files », le serveur répondait donc « Aucun
    // fichier reçu » et le mode Fusionner n'a jamais pu aboutir, sur aucun
    // écran — DocumentsSection les sert tous.
    fileList.forEach((file) => {
      formData.append('file[]', file)
    })
    formData.append('name', uploadName)
    formData.append('category', uploadCategory)
    formData.append('description', uploadDescription)
    appendEntityToFormData(formData)

    try {
      await documentAPI.uploadMerged(formData)
      message.success(t('documentsSection.messages.mergeSuccess'))
      closeUploadModal()
      refetchDocuments()
    } catch (error: any) {
      // Le motif du refus vient du serveur — « La fusion ne sait assembler que
      // des images », par exemple. L'intercepteur axios le pose dans
      // error.message ; le masquer derrière un message générique laissait
      // l'utilisateur recommencer sans savoir quoi changer.
      message.error(error?.message || t('documentsSection.messages.mergeError'))
    } finally {
      setUploading(false)
    }
  }

  // ⚠️ UN NOM DE DOCUMENT N'EST PAS UN CHEMIN.
  //
  // Le nom compose le nom du fichier téléchargé et le nom d'entrée de l'archive
  // ZIP du téléchargement groupé. Repris tel quel, « ../../evasion.txt »
  // produisait une archive à chemin d'échappement (zip slip) — le préfixe
  // « id- » posé devant n'y changeait rien, « 12-../../x » remonte encore d'un
  // dossier. Le serveur nettoie désormais au dépôt ; les pièces déjà en base
  // gardent leur nom, d'où ce nettoyage au moment de composer.
  const flatFileName = (name: string) => {
    const flat = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '').trim()
    return flat === '' ? 'document' : flat
  }

  const getDownloadName = (doc: Document) => {
    // Utiliser le nom du document + extension du fichier original
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
      message.error(t('documentsSection.messages.downloadError'))
    }
  }

  const handlePreview = async (doc: Document) => {
    setPreviewingDocument(doc)
    setPreviewLoading(true)
    setPreviewModalVisible(true)

    try {
      const response = await documentAPI.download(doc.id)
      const blob = new Blob([response.data], { type: doc.mime_type })
      const url = window.URL.createObjectURL(blob)
      setPreviewUrl(url)
    } catch {
      message.error(t('documentsSection.messages.loadError'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewModalVisible(false)
    setPreviewingDocument(null)
    if (previewUrl) {
      window.URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  const handleDelete = async (docId: string) => {
    try {
      await documentAPI.delete(docId)
      message.success(t('documentsSection.messages.deleteSuccess'))
      refetchDocuments()
    } catch {
      message.error(t('documentsSection.messages.deleteError'))
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
      message.success(t('documentsSection.messages.documentsDeleted', { count: successCount }))
    }
    if (errorCount > 0) {
      message.error(t('documentsSection.messages.documentsError', { count: errorCount }))
    }

    setSelectedRowKeys([])
    refetchDocuments()
  }

  const showBulkDeleteConfirm = () => {
    Modal.confirm({
      title: t('documentsSection.bulkDelete.confirmTitle'),
      icon: <ExclamationCircleOutlined />,
      content: t('documentsSection.bulkDelete.confirmContent', { count: selectedRowKeys.length }),
      okText: t('documentsSection.actions.delete'),
      okType: 'danger',
      cancelText: t('documentsSection.actions.cancel'),
      onOk: handleBulkDelete,
    })
  }

  const handleBulkDownload = async () => {
    if (selectedRowKeys.length === 0) return

    setBulkDownloading(true)
    const zip = new JSZip()
    let successCount = 0
    let errorCount = 0

    const documents: Document[] = documentsData?.data || []
    const selectedDocs = documents.filter(doc => selectedRowKeys.includes(doc.id))

    for (const doc of selectedDocs) {
      try {
        const response = await documentAPI.download(doc.id)
        const blob = new Blob([response.data])
        // ⚠️ Indexer l'archive par le seul nom de fichier PERD des pièces : deux
        // documents distincts portent souvent le même « scan.pdf », et JSZip
        // écrase silencieusement la première entrée — l'archive en contenait
        // une là où le message annonçait deux téléchargements. L'identifiant
        // garantit l'unicité, et le nom d'affichage rend l'archive lisible.
        zip.file(`${doc.id}-${getDownloadName(doc)}`, blob)
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
        message.success(t('documentsSection.messages.zipDownloaded', { count: successCount }))
      } catch {
        message.error(t('documentsSection.messages.zipError'))
      }
    }

    if (errorCount > 0) {
      message.warning(t('documentsSection.messages.zipNotAdded', { count: errorCount }))
    }

    setBulkDownloading(false)
  }

  const rowSelection: TableRowSelection<Document> = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys)
    },
  }

  const formatSize = (size: number) => {
    if (size < 1024) return `${size} ${t('documentsSection.units.bytes')}`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} ${t('documentsSection.units.kilobytes')}`
    return `${(size / (1024 * 1024)).toFixed(1)} ${t('documentsSection.units.megabytes')}`
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType?.includes('pdf')) return <FilePdfOutlined style={{ color: '#ff4d4f' }} />
    if (mimeType?.includes('image')) return <FileImageOutlined style={{ color: '#52c41a' }} />
    if (mimeType?.includes('word') || mimeType?.includes('document')) return <FileWordOutlined style={{ color: '#1890ff' }} />
    if (mimeType?.includes('excel') || mimeType?.includes('spreadsheet')) return <FileExcelOutlined style={{ color: '#52c41a' }} />
    return <FileOutlined />
  }

  const renderPreviewContent = () => {
    if (previewLoading) {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <p style={{ marginTop: 16 }}>{t('documentsSection.preview.loading')}</p>
        </div>
      )
    }

    if (!previewUrl || !previewingDocument) {
      return null
    }

    const mimeType = previewingDocument.mime_type

    if (mimeType?.includes('pdf')) {
      return (
        <iframe
          src={previewUrl}
          style={{ width: '100%', height: '70vh', border: 'none' }}
          title={previewingDocument.original_name}
         
        />
      )
    }

    if (mimeType?.includes('image')) {
      return (
        <div style={{ textAlign: 'center' }}>
          <img
            src={previewUrl}
            alt={previewingDocument.original_name}
            style={{ maxWidth: '100%', maxHeight: '70vh' }}
          />
        </div>
      )
    }

    // For non-previewable files, show a download prompt
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        {getFileIcon(mimeType)}
        <p style={{ marginTop: 16, fontSize: 16 }}>{previewingDocument.original_name}</p>
        <p style={{ color: '#888' }}>{t('documentsSection.preview.notPreviewable')}</p>
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleDownload(previewingDocument)}>
          {t('documentsSection.actions.download')}
        </Button>
      </div>
    )
  }

  const columns = [
    {
      title: t('documentsSection.columns.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Document) => (
        <Space>
          {getFileIcon(record.mime_type)}
          <span>{name}</span>
        </Space>
      ),
    },
    { title: t('documentsSection.columns.file'), dataIndex: 'original_name', key: 'original_name', ellipsis: true },
    {
      title: t('documentsSection.columns.category'),
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (cat: string) => <Tag>{categoryLabels[cat] || cat}</Tag>,
    },
    {
      title: t('documentsSection.columns.size'),
      dataIndex: 'size',
      key: 'size',
      width: 80,
      render: (size: number) => formatSize(size),
    },
    {
      title: t('documentsSection.columns.date'),
      dataIndex: 'created_at',
      key: 'created_at',
      width: 100,
      render: (v: string) => (v ? new Date(v).toLocaleDateString('fr-FR') : '-'),
    },
    {
      title: t('documentsSection.columns.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Document) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handlePreview(record)}
            title={t('documentsSection.actions.view')}
          />
          <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record)} title={t('documentsSection.actions.download')} />
          <Popconfirm
            title={t('documentsSection.actions.deleteConfirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('documentsSection.actions.yes')}
            cancelText={t('documentsSection.actions.no')}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} title={t('documentsSection.actions.delete')} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const documents: Document[] = documentsData?.data || []

  return (
    <>
      <Card
        title={<span><FolderOpenOutlined /> {cardTitle}</span>}
        size="small"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            {selectedRowKeys.length > 0 && (
              <>
                <Button
                  size="small"
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleBulkDownload}
                  loading={bulkDownloading}
                >
                  {t('documentsSection.toolbar.zip', { count: selectedRowKeys.length })}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={showBulkDeleteConfirm}
                  loading={bulkDeleting}
                >
                  {t('documentsSection.toolbar.deleteCount', { count: selectedRowKeys.length })}
                </Button>
              </>
            )}
            <Button type="primary" size="small" icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
              {t('documentsSection.toolbar.add')}
            </Button>
          </Space>
        }
      >
        {selectedRowKeys.length > 0 && (
          <Alert
            type="info"
            style={{ marginBottom: 8, padding: '4px 12px' }}
            message={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('documentsSection.selection.count', { count: selectedRowKeys.length })}</span>
                <Space>
                  <Button size="small" onClick={() => setSelectedRowKeys([])}>
                    {t('documentsSection.selection.deselect')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={handleBulkDownload}
                    loading={bulkDownloading}
                  >
                    {t('documentsSection.selection.downloadZip')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={showBulkDeleteConfirm}
                    loading={bulkDeleting}
                  >
                    {t('documentsSection.actions.delete')}
                  </Button>
                </Space>
              </div>
            }
          />
        )}
        <Table
          dataSource={documents}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: t('documentsSection.table.empty') }}
          rowSelection={rowSelection}
          loading={bulkDeleting}
          onRow={(record) => ({
            onDoubleClick: () => handlePreview(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* Upload Modal */}
      <Modal
        title={t('documentsSection.uploadModal.title')}
        open={uploadModalVisible}
        onCancel={closeUploadModal}
        footer={null}
        width={600}
      >
        <Form layout="vertical">
          <Form.Item label={t('documentsSection.uploadModal.modeLabel')}>
            <Radio.Group value={uploadMode} onChange={(e) => setUploadMode(e.target.value)}>
              <Radio.Button value="multiple">{t('documentsSection.uploadModal.modeSeparate')}</Radio.Button>
              <Radio.Button value="merge">{t('documentsSection.uploadModal.modeMerge')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={uploadMode === 'merge' ? t('documentsSection.uploadModal.nameMergeLabel') : t('documentsSection.uploadModal.nameOptionalLabel')}>
                <Input
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={uploadMode === 'merge' ? t('documentsSection.uploadModal.nameMergePlaceholder') : t('documentsSection.uploadModal.nameOptionalPlaceholder')}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('documentsSection.uploadModal.categoryLabel')}>
                <Select value={uploadCategory} onChange={setUploadCategory}>
                  {categoryKeys.map((key) => (
                    <Select.Option key={key} value={key}>{categoryLabels[key]}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={t('documentsSection.uploadModal.descriptionLabel')}>
            <Input.TextArea
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              rows={2}
              placeholder={t('documentsSection.uploadModal.descriptionPlaceholder')}
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
                {uploading ? t('documentsSection.uploadModal.uploading') : t('documentsSection.uploadModal.dragText')}
              </p>
              <p className="ant-upload-hint">{t('documentsSection.uploadModal.dragHint')}</p>
            </Upload.Dragger>
          </Form.Item>

          {pendingFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                {t('documentsSection.uploadModal.selectedFiles', { count: pendingFiles.length })}
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
                    {t('documentsSection.uploadModal.uploadSeparate', { count: pendingFiles.length })}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    loading={uploading}
                    onClick={() => handleUploadMerged(pendingFiles)}
                    disabled={!uploadName}
                  >
                    {t('documentsSection.uploadModal.mergeButton')}
                  </Button>
                )}
                <Button onClick={() => setPendingFiles([])}>
                  {t('documentsSection.actions.cancel')}
                </Button>
              </div>
            </div>
          )}
        </Form>
      </Modal>

      {/* Preview Modal */}
      <Modal
        title={
          <Space>
            {previewingDocument && getFileIcon(previewingDocument.mime_type)}
            {previewingDocument?.original_name || t('documentsSection.preview.title')}
          </Space>
        }
        open={previewModalVisible}
        onCancel={closePreview}
        width={900}
        footer={[
          <Button key="close" onClick={closePreview}>
            {t('documentsSection.actions.close')}
          </Button>,
          <Button
            key="download"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => previewingDocument && handleDownload(previewingDocument)}
          >
            {t('documentsSection.actions.download')}
          </Button>,
        ]}
      >
        {renderPreviewContent()}
      </Modal>
    </>
  )
}
