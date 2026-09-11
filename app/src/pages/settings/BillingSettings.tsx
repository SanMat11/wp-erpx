import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { NOMS, languesOffertes } from '@/i18n/locale'

import { Form, Input, Select, Button, message, Spin, Row, Col, Divider } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { amsbmBoot, settingsAPI } from '@/services/api'

interface BillingData {
  currency: string
  language: string
  timezone: string
  date_format: string
  quote_prefix: string
  invoice_prefix: string
  deal_prefix: string
  purchase_order_prefix: string
  supplier_invoice_prefix: string
  e_invoicing_format: string
  peppol_id: string
}

const timezones = [
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'America/New_York', label: 'America/New_York' },
]

const dateFormats = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
]

export default function BillingSettings() {
  const { t, i18n } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const currencies = [
    { value: 'EUR', label: t('billingSettings.currencies.eur') },
    { value: 'USD', label: t('billingSettings.currencies.usd') },
    { value: 'GBP', label: t('billingSettings.currencies.gbp') },
    { value: 'CHF', label: t('billingSettings.currencies.chf') },
  ]

  // ⚠️ CE MENU N'ÉTAIT LU PAR PERSONNE, et il offrait quatre langues.
  //
  // « language » était déclaré dans SettingsStore avec « fr » en dur, l'écran
  // l'écrivait en base, et aucune ligne de code ne le relisait jamais : choisir
  // « Deutsch » enregistrait « de » et ne changeait strictement rien. C'était un
  // vestige des écrans du SaaS, et il en offrait deux de plus qu'il n'existe de
  // catalogues.
  //
  // Il commande désormais la langue d'AMS Studio pour de bon. Le défaut, vide, veut
  // dire « suis WordPress » — le cas de tout le monde. La dérogation sert au cas
  // réel : une société française dont le site public est en anglais, et qui
  // travaille au quotidien en français dans son ERP.
  const languages = [
    { value: '', label: t('billingSettings.languageSameAsWordPress', 'Identique à WordPress') },
    ...languesOffertes().map((code) => ({ value: code, label: NOMS[code] })),
  ]

  // ⚠️ « Aucun » DOIT exister, et il n'existait pas.
  //
  // La conformité électronique BLOQUE l'impression : une facture à qui il manque
  // le code postal du client ne sort pas en PDF, et c'est voulu — mieux vaut
  // refuser d'imprimer qu'émettre une facture que le portail du client rejettera.
  // Mais sans ce choix, la règle s'appliquait aussi à qui n'émet pas de facture
  // électronique du tout : sur le banc, 32 factures sur 152 étaient devenues
  // inimprimables pour un numéro de TVA manquant.
  const eInvoicingFormats = [
    { value: 'none', label: t('billingSettings.eInvoicingFormats.none', 'Aucune — factures PDF ordinaires') },
    { value: 'facturx', label: t('billingSettings.eInvoicingFormats.facturx') },
    { value: 'peppol', label: t('billingSettings.eInvoicingFormats.peppol') },
  ]

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getBilling()
      form.setFieldsValue(response.data)
    } catch (error) {
      message.error(t('billingSettings.messages.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (values: BillingData) => {
    setSaving(true)
    try {
      await settingsAPI.updateBilling(values as unknown as Record<string, unknown>)
      message.success(t('billingSettings.messages.saveSuccess'))

      // ⚠️ ET ON L'APPLIQUE TOUT DE SUITE. La langue de départ est lue une seule
      // fois, à l'amorçage : sans cette ligne, le client choisit sa langue, voit
      // « Réglages enregistrés » en français, et croit que le réglage ne marche
      // pas — il ne marcherait qu'au prochain rechargement de la page.
      // Le serveur, lui, relit l'option à chaque requête : il suit déjà.
      const voulue = String(values.language || '') || String(amsbmBoot.locale || 'fr').slice(0, 2)

      if (voulue !== i18n.language) {
        await i18n.changeLanguage(voulue)
      }
    } catch (error) {
      message.error(t('billingSettings.messages.saveError'))
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
      <h3>{t('billingSettings.regionalSettings')}</h3>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="currency" label={t('billingSettings.currency')}>
            <Select options={currencies} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="language" label={t('billingSettings.language')}>
            <Select options={languages} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="timezone" label={t('billingSettings.timezone')}>
            <Select options={timezones} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="date_format" label={t('billingSettings.dateFormat')}>
            <Select options={dateFormats} />
          </Form.Item>
        </Col>
      </Row>

      <Divider />
      <h3>{t('billingSettings.documentNumbering')}</h3>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="quote_prefix"
            label={t('billingSettings.quotePrefix')}
            tooltip={t('billingSettings.quotePrefixTooltip')}
          >
            <Input placeholder="DEV-" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="invoice_prefix"
            label={t('billingSettings.invoicePrefix')}
            tooltip={t('billingSettings.invoicePrefixTooltip')}
          >
            <Input placeholder="FAC-" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="deal_prefix"
            label={t('billingSettings.dealPrefix')}
            tooltip={t('billingSettings.dealPrefixTooltip')}
          >
            <Input placeholder="AFF-" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="purchase_order_prefix"
            label={t('billingSettings.purchaseOrderPrefix')}
            tooltip={t('billingSettings.purchaseOrderPrefixTooltip')}
          >
            <Input placeholder="CF-" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="supplier_invoice_prefix"
            label={t('billingSettings.supplierInvoicePrefix')}
            tooltip={t('billingSettings.supplierInvoicePrefixTooltip')}
          >
            <Input placeholder="FF-" />
          </Form.Item>
        </Col>
      </Row>

      <Divider />
      <h3>{t('billingSettings.eInvoicing')}</h3>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="e_invoicing_format"
            label={t('billingSettings.eInvoicingFormat')}
            tooltip={t('billingSettings.eInvoicingFormatTooltip')}
            extra={t(
              'billingSettings.eInvoicingFormatExtra',
              "Avec un format choisi, une facture incomplète refuse de s'imprimer plutôt que de partir non conforme. Sans format, les factures sortent en PDF ordinaire."
            )}
          >
            <Select options={eInvoicingFormats} />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item noStyle shouldUpdate={(prev, cur) => prev.e_invoicing_format !== cur.e_invoicing_format}>
        {() =>
          form.getFieldValue('e_invoicing_format') === 'peppol' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="peppol_id"
                  label={t('billingSettings.peppolId')}
                  extra={t('billingSettings.peppolIdExtra')}
                >
                  <Input placeholder="0009:12345678" />
                </Form.Item>
              </Col>
            </Row>
          ) : null
        }
      </Form.Item>

      <Form.Item style={{ marginTop: 24 }}>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
          {t('common.save')}
        </Button>
      </Form.Item>
    </Form>
  )
}
