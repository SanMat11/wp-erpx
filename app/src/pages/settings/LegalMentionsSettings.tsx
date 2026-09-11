import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Card, Spin } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { settingsAPI } from '@/services/api'

interface LegalMentionsData {
  quote: string
  client_invoice: string
  supplier_invoice: string
  purchase_order: string
}

export default function LegalMentionsSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getLegalMentions()
      form.setFieldsValue(response.data)
    } catch (error) {
      console.error('Error loading legal mentions:', error)
      message.error(t('legalMentionsSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const values: LegalMentionsData = form.getFieldsValue()
      await settingsAPI.updateLegalMentions(values)
      message.success(t('legalMentionsSettings.saveSuccess'))
    } catch (error) {
      console.error('Error saving legal mentions:', error)
      message.error(t('legalMentionsSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Spin />
  }

  return (
    <Form form={form} layout="vertical">
      <p style={{ marginBottom: 16, color: '#666' }}>
        {t('legalMentionsSettings.description')}
      </p>

      <Card title={t('legalMentionsSettings.clientInvoiceTitle')} size="small" style={{ marginBottom: 16 }}>
        <Form.Item
          name="client_invoice"
          extra={t('legalMentionsSettings.clientInvoiceExtra')}
        >
          <Input.TextArea
            rows={4}
            placeholder={t('legalMentionsSettings.clientInvoicePlaceholder')}
          />
        </Form.Item>
      </Card>

      <Card title={t('legalMentionsSettings.quoteTitle')} size="small" style={{ marginBottom: 16 }}>
        <Form.Item
          name="quote"
          extra={t('legalMentionsSettings.quoteExtra')}
        >
          <Input.TextArea
            rows={4}
            placeholder={t('legalMentionsSettings.quotePlaceholder')}
          />
        </Form.Item>
      </Card>

      <Card title={t('legalMentionsSettings.supplierInvoiceTitle')} size="small" style={{ marginBottom: 16 }}>
        <Form.Item
          name="supplier_invoice"
          extra={t('legalMentionsSettings.supplierInvoiceExtra')}
        >
          <Input.TextArea
            rows={4}
            placeholder={t('legalMentionsSettings.supplierInvoicePlaceholder')}
          />
        </Form.Item>
      </Card>

      <Card title={t('legalMentionsSettings.purchaseOrderTitle')} size="small" style={{ marginBottom: 16 }}>
        <Form.Item
          name="purchase_order"
          extra={t('legalMentionsSettings.purchaseOrderExtra')}
        >
          <Input.TextArea
            rows={4}
            placeholder={t('legalMentionsSettings.purchaseOrderPlaceholder')}
          />
        </Form.Item>
      </Card>

      <Form.Item>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          {t('common.save')}
        </Button>
      </Form.Item>
    </Form>
  )
}
