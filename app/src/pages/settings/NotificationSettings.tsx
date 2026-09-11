import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Switch, Button, message, Spin, Input, Tag, Space, Divider } from 'antd'
import { SaveOutlined, PlusOutlined } from '@ant-design/icons'
import { settingsAPI } from '@/services/api'

// ⚠️ N'Y REMETTEZ PAS UN INTERRUPTEUR QUE PERSONNE NE LIT.
//
// « invoice_overdue_email », « quote_reminder_email »,
// « payment_received_email » et « real_time_notifications » étaient offerts
// ici, enregistrés, relus… et consultés par aucun code : quatre interrupteurs
// sur huit ne pilotaient rien. Ils ont été retirés du schéma de
// SettingsStore::schemas(), qui refuse désormais toute clé non déclarée : les
// laisser à l'écran donnerait des interrupteurs éteints qui ne s'enregistrent
// plus. Les quatre qui restent sont réellement appliqués — stock_alert_email
// par Stock::emailStatus(), payment_reminder_* par Invoices. Si ces envois
// arrivent un jour, on rebranche la clé, son lecteur ET son interrupteur dans
// le même mouvement.
interface NotificationData {
  stock_alert_email: boolean
  alert_recipients: string[]
  payment_reminder_enabled: boolean
  payment_reminder_days: string
}

export default function NotificationSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recipients, setRecipients] = useState<string[]>([])
  const [newRecipient, setNewRecipient] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getNotifications()
      form.setFieldsValue(response.data)
      setRecipients(response.data.alert_recipients || [])
    } catch (error) {
      message.error(t('notificationSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleAddRecipient = () => {
    if (!newRecipient) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newRecipient)) {
      message.warning(t('notificationSettings.invalidEmail'))
      return
    }
    if (recipients.includes(newRecipient)) {
      message.warning(t('notificationSettings.emailAlreadyAdded'))
      return
    }
    setRecipients([...recipients, newRecipient])
    setNewRecipient('')
  }

  const handleRemoveRecipient = (email: string) => {
    setRecipients(recipients.filter(r => r !== email))
  }

  const handleSubmit = async (values: NotificationData) => {
    setSaving(true)
    try {
      await settingsAPI.updateNotifications({
        ...values,
        alert_recipients: recipients,
      })
      message.success(t('notificationSettings.saveSuccess'))
    } catch (error) {
      message.error(t('notificationSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      style={{ maxWidth: 600 }}
    >
      <h3>{t('notificationSettings.emailNotificationsTitle')}</h3>
      <p style={{ color: '#666', marginBottom: 24 }}>
        {t('notificationSettings.emailNotificationsDescription')}
      </p>

      <Form.Item
        name="stock_alert_email"
        label={t('notificationSettings.stockAlertsLabel')}
        valuePropName="checked"
        extra={t('notificationSettings.stockAlertsExtra')}
      >
        <Switch />
      </Form.Item>

      <Divider />
      <h3>{t('notificationSettings.dunningTitle')}</h3>
      <p style={{ color: '#666', marginBottom: 16 }}>
        {t('notificationSettings.dunningDescription')}
      </p>

      <Form.Item
        name="payment_reminder_enabled"
        label={t('notificationSettings.dunningEnabledLabel')}
        valuePropName="checked"
        extra={t('notificationSettings.dunningEnabledExtra')}
      >
        <Switch />
      </Form.Item>

      <Form.Item
        name="payment_reminder_days"
        label={t('notificationSettings.dunningDaysLabel')}
        extra={t('notificationSettings.dunningDaysExtra')}
      >
        <Input placeholder="7,15,30" style={{ maxWidth: 200 }} />
      </Form.Item>

      <Divider />
      <h3>{t('notificationSettings.recipientsTitle')}</h3>
      <p style={{ color: '#666', marginBottom: 16 }}>
        {t('notificationSettings.recipientsDescription')}
      </p>

      <div style={{ marginBottom: 16 }}>
        {recipients.map((email) => (
          <Tag
            key={email}
            closable
            onClose={() => handleRemoveRecipient(email)}
            style={{ marginBottom: 8 }}
          >
            {email}
          </Tag>
        ))}
        {recipients.length === 0 && (
          <span style={{ color: '#999' }}>{t('notificationSettings.noRecipients')}</span>
        )}
      </div>

      <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
        <Input
          placeholder={t('notificationSettings.addEmailPlaceholder')}
          value={newRecipient}
          onChange={(e) => setNewRecipient(e.target.value)}
          onPressEnter={handleAddRecipient}
          style={{ flex: 1 }}
        />
        <Button icon={<PlusOutlined />} onClick={handleAddRecipient}>
          {t('notificationSettings.addButton')}
        </Button>
      </Space.Compact>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
          {t('common.save')}
        </Button>
      </Form.Item>
    </Form>
  )
}
