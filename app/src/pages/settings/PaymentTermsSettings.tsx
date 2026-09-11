import { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, InputNumber, Checkbox, message, Spin, Space, Popconfirm, Tag } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { settingsAPI } from '@/services/api'

interface PaymentTerm {
  id: string
  label: string
  days: number
  is_default: boolean
  created_at: string
  updated_at: string
}

export default function PaymentTermsSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editingTerm, setEditingTerm] = useState<PaymentTerm | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadPaymentTerms()
  }, [])

  const loadPaymentTerms = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.listPaymentTerms()
      setPaymentTerms(response.data.payment_terms || [])
    } catch (error) {
      message.error(t('paymentTermsSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingTerm(null)
    form.resetFields()
    form.setFieldsValue({
      days: 30,
      is_default: false,
    })
    setModalVisible(true)
  }

  const handleEdit = (term: PaymentTerm) => {
    setEditingTerm(term)
    form.setFieldsValue({
      label: term.label,
      days: term.days,
      is_default: term.is_default,
    })
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await settingsAPI.deletePaymentTerm(id)
      message.success(t('paymentTermsSettings.deleteSuccess'))
      loadPaymentTerms()
    } catch (error) {
      message.error(t('paymentTermsSettings.deleteError'))
    }
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      if (editingTerm) {
        await settingsAPI.updatePaymentTerm(editingTerm.id, values)
        message.success(t('paymentTermsSettings.updateSuccess'))
      } else {
        await settingsAPI.createPaymentTerm(values)
        message.success(t('paymentTermsSettings.createSuccess'))
      }
      setModalVisible(false)
      loadPaymentTerms()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.error(err.response?.data?.error || t('paymentTermsSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<PaymentTerm> = [
    {
      title: t('paymentTermsSettings.columnLabel'),
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: t('paymentTermsSettings.columnDays'),
      dataIndex: 'days',
      key: 'days',
      width: 150,
      render: (days: number) => days === 0 ? t('paymentTermsSettings.cash') : t('paymentTermsSettings.daysValue', { count: days }),
    },
    {
      title: t('paymentTermsSettings.columnDefault'),
      dataIndex: 'is_default',
      key: 'is_default',
      width: 80,
      align: 'center',
      render: (isDefault: boolean) => (
        isDefault ? <Tag color="gold">{t('common.yes')}</Tag> : null
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title={t('paymentTermsSettings.deleteConfirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.yes')}
            cancelText={t('common.no')}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t('paymentTermsSettings.title')}</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('paymentTermsSettings.addButton')}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={paymentTerms}
        rowKey="id"
        pagination={false}
        size="middle"
        locale={{ emptyText: t('paymentTermsSettings.empty') }}
      />

      <Modal
        title={editingTerm ? t('paymentTermsSettings.modalEditTitle') : t('paymentTermsSettings.modalAddTitle')}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={450}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="label"
            label={t('paymentTermsSettings.columnLabel')}
            rules={[{ required: true, message: t('paymentTermsSettings.fieldRequired') }]}
          >
            <Input placeholder={t('paymentTermsSettings.labelPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="days"
            label={t('paymentTermsSettings.columnDays')}
            rules={[{ required: true, message: t('paymentTermsSettings.fieldRequired') }]}
            extra={t('paymentTermsSettings.daysExtra')}
          >
            <InputNumber
              min={0}
              max={365}
              style={{ width: '100%' }}
              addonAfter={t('paymentTermsSettings.daysAddon')}
            />
          </Form.Item>

          <Form.Item
            name="is_default"
            valuePropName="checked"
          >
            <Checkbox>{t('paymentTermsSettings.defaultCheckbox')}</Checkbox>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                {editingTerm ? t('common.edit') : t('paymentTermsSettings.add')}
              </Button>
              <Button onClick={() => setModalVisible(false)}>
                {t('common.cancel')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
