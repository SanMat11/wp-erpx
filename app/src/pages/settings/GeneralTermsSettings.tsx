import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Spin } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { settingsAPI } from '@/services/api'

export default function GeneralTermsSettings() {
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
      const response = await settingsAPI.getGeneralTerms()
      form.setFieldsValue({ general_terms: response.data.general_terms })
    } catch (error) {
      console.error('Error loading general terms:', error)
      message.error(t('generalTermsSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      await settingsAPI.updateGeneralTerms(values.general_terms)
      message.success(t('generalTermsSettings.saveSuccess'))
    } catch (error) {
      console.error('Error saving general terms:', error)
      message.error(t('generalTermsSettings.saveError'))
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
        {t('generalTermsSettings.intro')}
      </p>

      <Form.Item
        name="general_terms"
        label={t('generalTermsSettings.label')}
        extra={t('generalTermsSettings.extra')}
      >
        <Input.TextArea
          rows={45}
          style={{ minHeight: 500, fontFamily: 'monospace', fontSize: 13 }}
          placeholder={t('generalTermsSettings.placeholder')}
        />
      </Form.Item>

      <Form.Item>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          {t('common.save')}
        </Button>
      </Form.Item>
    </Form>
  )
}
