import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Tag,
  Checkbox,
  message,
  Popconfirm,
  Typography,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { settingsAPI } from '@/services/api'

const { TextArea } = Input

interface Footer {
  id: string
  name: string
  content: string
  document_types: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

const documentTypeColors: Record<string, string> = {
  quote: 'blue',
  client_invoice: 'green',
  supplier_invoice: 'orange',
  purchase_order: 'purple',
  deal: 'cyan',
  amendment: 'magenta',
}

export default function FooterSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingFooter, setEditingFooter] = useState<Footer | null>(null)
  const [filterDocType, setFilterDocType] = useState<string>('')
  const [form] = Form.useForm()

  const documentTypeLabels: Record<string, string> = {
    quote: t('footerSettings.docType.quote'),
    client_invoice: t('footerSettings.docType.client_invoice'),
    supplier_invoice: t('footerSettings.docType.supplier_invoice'),
    purchase_order: t('footerSettings.docType.purchase_order'),
    deal: t('footerSettings.docType.deal'),
    amendment: t('footerSettings.docType.amendment'),
  }

  const documentTypeOptions = Object.entries(documentTypeLabels).map(([value, label]) => ({
    value,
    label,
  }))

  // Fetch footers
  const { data: footersData, isLoading } = useQuery({
    queryKey: ['footers', filterDocType],
    queryFn: () => settingsAPI.listFooters({ document_type: filterDocType }),
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<Footer>) => settingsAPI.createFooter(data),
    onSuccess: () => {
      message.success(t('footerSettings.messages.created'))
      queryClient.invalidateQueries({ queryKey: ['footers'] })
      setIsModalOpen(false)
      form.resetFields()
    },
    onError: () => {
      message.error(t('footerSettings.messages.createError'))
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Footer> }) =>
      settingsAPI.updateFooter(id, data),
    onSuccess: () => {
      message.success(t('footerSettings.messages.updated'))
      queryClient.invalidateQueries({ queryKey: ['footers'] })
      setIsModalOpen(false)
      setEditingFooter(null)
      form.resetFields()
    },
    onError: () => {
      message.error(t('footerSettings.messages.updateError'))
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsAPI.deleteFooter(id),
    onSuccess: () => {
      message.success(t('footerSettings.messages.deleted'))
      queryClient.invalidateQueries({ queryKey: ['footers'] })
    },
    onError: () => {
      message.error(t('footerSettings.messages.deleteError'))
    },
  })

  const handleAdd = () => {
    setEditingFooter(null)
    form.resetFields()
    form.setFieldsValue({
      document_types: ['quote'],
      is_default: false,
    })
    setIsModalOpen(true)
  }

  const handleEdit = (footer: Footer) => {
    setEditingFooter(footer)
    form.setFieldsValue({
      name: footer.name,
      content: footer.content,
      document_types: footer.document_types || [],
      is_default: footer.is_default,
    })
    setIsModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingFooter) {
        updateMutation.mutate({ id: editingFooter.id, data: values })
      } else {
        createMutation.mutate(values)
      }
    } catch {
      message.error(t('footerSettings.messages.formError'))
    }
  }

  const columns = [
    {
      title: t('footerSettings.column.name'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
    },
    {
      title: t('footerSettings.column.documentTypes'),
      dataIndex: 'document_types',
      key: 'document_types',
      width: 300,
      render: (types: string[]) => (
        <Space wrap size={[4, 4]}>
          {(types || []).map((type) => (
            <Tag key={type} color={documentTypeColors[type]}>
              {documentTypeLabels[type] || type}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('footerSettings.column.content'),
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      render: (content: string) => (
        <Typography.Paragraph
          ellipsis={{ rows: 2 }}
          style={{ margin: 0, maxWidth: 400 }}
        >
          {content}
        </Typography.Paragraph>
      ),
    },
    {
      title: t('footerSettings.column.isDefault'),
      dataIndex: 'is_default',
      key: 'is_default',
      width: 100,
      align: 'center' as const,
      render: (isDefault: boolean) =>
        isDefault ? <Tag color="green">{t('footerSettings.yes')}</Tag> : <Tag>{t('footerSettings.no')}</Tag>,
    },
    {
      title: t('footerSettings.column.actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Footer) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('footerSettings.deleteConfirm')}
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText={t('footerSettings.yes')}
            cancelText={t('footerSettings.no')}
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const footers: Footer[] = footersData?.data || []

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Select
            allowClear
            placeholder={t('footerSettings.filterPlaceholder')}
            style={{ width: 200 }}
            value={filterDocType || undefined}
            onChange={(value) => setFilterDocType(value || '')}
          >
            {Object.entries(documentTypeLabels).map(([value, label]) => (
              <Select.Option key={value} value={value}>
                {label}
              </Select.Option>
            ))}
          </Select>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('footerSettings.add')}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={footers}
        rowKey="id"
        loading={isLoading}
        pagination={false}
      />

      <Modal
        title={editingFooter ? t('footerSettings.modal.editTitle') : t('footerSettings.modal.newTitle')}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setIsModalOpen(false)
          setEditingFooter(null)
          form.resetFields()
        }}
        okText={editingFooter ? t('footerSettings.modal.update') : t('footerSettings.modal.create')}
        cancelText={t('footerSettings.modal.cancel')}
        width={700}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('footerSettings.form.name')}
            rules={[{ required: true, message: t('footerSettings.form.nameRequired') }]}
          >
            <Input placeholder={t('footerSettings.form.namePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="document_types"
            label={t('footerSettings.form.documentTypes')}
            rules={[{ required: true, message: t('footerSettings.form.documentTypesRequired') }]}
          >
            <Checkbox.Group style={{ width: '100%' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px 16px',
                padding: '8px 0'
              }}>
                {documentTypeOptions.map((option) => (
                  <Checkbox key={option.value} value={option.value}>
                    <Tag color={documentTypeColors[option.value]} style={{ margin: 0 }}>
                      {option.label}
                    </Tag>
                  </Checkbox>
                ))}
              </div>
            </Checkbox.Group>
          </Form.Item>

          <Form.Item
            name="content"
            label={t('footerSettings.form.content')}
            rules={[{ required: true, message: t('footerSettings.form.contentRequired') }]}
          >
            <TextArea
              rows={6}
              placeholder={t('footerSettings.form.contentPlaceholder')}
            />
          </Form.Item>

          <Form.Item
            name="is_default"
            label={t('footerSettings.form.isDefault')}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Typography.Text type="secondary">
            {t('footerSettings.form.isDefaultHint')}
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  )
}
