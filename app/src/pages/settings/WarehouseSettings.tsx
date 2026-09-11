import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, Button, Modal, Form, Input, Checkbox, message, Spin, Space, Popconfirm, Tag } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { stockAPI } from '@/services/api'

interface Warehouse {
  id: string
  code: string
  name: string
  address: string
  is_default: boolean
  is_active: boolean
  created_at: string
}

export default function WarehouseSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadWarehouses()
  }, [])

  const loadWarehouses = async () => {
    setLoading(true)
    try {
      const response = await stockAPI.getWarehouses()
      setWarehouses(response.data || [])
    } catch (error) {
      message.error(t('warehouseSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingWarehouse(null)
    form.resetFields()
    form.setFieldsValue({
      is_default: false,
      is_active: true,
    })
    setModalVisible(true)
  }

  const handleEdit = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse)
    form.setFieldsValue({
      code: warehouse.code,
      name: warehouse.name,
      address: warehouse.address,
      is_default: warehouse.is_default,
      is_active: warehouse.is_active,
    })
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await stockAPI.deleteWarehouse(id)
      message.success(t('warehouseSettings.deleteSuccess'))
      loadWarehouses()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.error(err.response?.data?.error || t('warehouseSettings.deleteError'))
    }
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      const data = {
        code: values.code as string,
        name: values.name as string,
        address: (values.address as string) || '',
        is_default: (values.is_default as boolean) || false,
        is_active: (values.is_active as boolean) ?? true,
      }
      if (editingWarehouse) {
        await stockAPI.updateWarehouse(editingWarehouse.id, data)
        message.success(t('warehouseSettings.updateSuccess'))
      } else {
        await stockAPI.createWarehouse(data)
        message.success(t('warehouseSettings.createSuccess'))
      }
      setModalVisible(false)
      loadWarehouses()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.error(err.response?.data?.error || t('warehouseSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<Warehouse> = [
    {
      title: t('warehouseSettings.code'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: t('common.name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('warehouseSettings.address'),
      dataIndex: 'address',
      key: 'address',
    },
    {
      title: t('warehouseSettings.isDefault'),
      dataIndex: 'is_default',
      key: 'is_default',
      width: 100,
      align: 'center',
      render: (isDefault: boolean) => (
        isDefault ? <Tag color="gold">{t('common.yes')}</Tag> : null
      ),
    },
    {
      title: t('warehouseSettings.isActive'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      align: 'center',
      render: (isActive: boolean) => (
        isActive ? <Tag color="green">{t('common.yes')}</Tag> : <Tag color="red">{t('common.no')}</Tag>
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
            title={t('warehouseSettings.deleteConfirm')}
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
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t('warehouseSettings.title')}</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('warehouseSettings.add')}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={warehouses}
        rowKey="id"
        pagination={false}
        size="middle"
        locale={{ emptyText: t('warehouseSettings.empty') }}
      />

      <Modal
        title={editingWarehouse ? t('warehouseSettings.editTitle') : t('warehouseSettings.addTitle')}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="code"
            label={t('warehouseSettings.code')}
            rules={[{ required: true, message: t('warehouseSettings.requiredField') }]}
          >
            <Input placeholder="WH-001" />
          </Form.Item>

          <Form.Item
            name="name"
            label={t('common.name')}
            rules={[{ required: true, message: t('warehouseSettings.requiredField') }]}
          >
            <Input placeholder={t('warehouseSettings.namePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="address"
            label={t('warehouseSettings.address')}
          >
            <Input.TextArea rows={2} placeholder={t('warehouseSettings.addressPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="is_default"
            valuePropName="checked"
          >
            <Checkbox>{t('warehouseSettings.isDefault')}</Checkbox>
          </Form.Item>

          {editingWarehouse && (
            <Form.Item
              name="is_active"
              valuePropName="checked"
            >
              <Checkbox>{t('warehouseSettings.isActive')}</Checkbox>
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                {editingWarehouse ? t('common.edit') : t('warehouseSettings.add')}
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
