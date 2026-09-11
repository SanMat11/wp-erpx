import { useState, useEffect } from 'react'
import { Form, Input, Button, message, Spin, Row, Col, Divider, Select, Modal } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { CLE_TAUX_TVA, settingsAPI } from '@/services/api'

// VAT rates by country (standard and reduced rates)
interface VATRateDefinition {
  code: string
  label: string
  rate: number
}

const vatRatesByCountry: Record<string, VATRateDefinition[]> = {
  DE: [
    { code: 'DE19', label: 'TVA normale', rate: 19 },
    { code: 'DE7', label: 'TVA réduite', rate: 7 },
  ],
  AT: [
    { code: 'AT20', label: 'TVA normale', rate: 20 },
    { code: 'AT13', label: 'TVA réduite 13%', rate: 13 },
    { code: 'AT10', label: 'TVA réduite 10%', rate: 10 },
  ],
  BE: [
    { code: 'BE21', label: 'TVA normale', rate: 21 },
    { code: 'BE12', label: 'TVA réduite 12%', rate: 12 },
    { code: 'BE6', label: 'TVA réduite 6%', rate: 6 },
  ],
  BG: [
    { code: 'BG20', label: 'TVA normale', rate: 20 },
    { code: 'BG9', label: 'TVA réduite', rate: 9 },
  ],
  CY: [
    { code: 'CY19', label: 'TVA normale', rate: 19 },
    { code: 'CY9', label: 'TVA réduite 9%', rate: 9 },
    { code: 'CY5', label: 'TVA réduite 5%', rate: 5 },
  ],
  HR: [
    { code: 'HR25', label: 'TVA normale', rate: 25 },
    { code: 'HR13', label: 'TVA réduite 13%', rate: 13 },
    { code: 'HR5', label: 'TVA réduite 5%', rate: 5 },
  ],
  DK: [
    { code: 'DK25', label: 'TVA normale', rate: 25 },
  ],
  ES: [
    { code: 'ES21', label: 'IVA general', rate: 21 },
    { code: 'ES10', label: 'IVA reducido', rate: 10 },
    { code: 'ES4', label: 'IVA superreducido', rate: 4 },
  ],
  EE: [
    { code: 'EE22', label: 'TVA normale', rate: 22 },
    { code: 'EE9', label: 'TVA réduite', rate: 9 },
  ],
  FI: [
    { code: 'FI24', label: 'TVA normale', rate: 24 },
    { code: 'FI14', label: 'TVA réduite 14%', rate: 14 },
    { code: 'FI10', label: 'TVA réduite 10%', rate: 10 },
  ],
  FR: [
    { code: 'FR20', label: 'TVA normale', rate: 20 },
    { code: 'FR10', label: 'TVA intermédiaire', rate: 10 },
    { code: 'FR5.5', label: 'TVA réduite', rate: 5.5 },
    { code: 'FR2.1', label: 'TVA super-réduite', rate: 2.1 },
  ],
  EL: [
    { code: 'EL24', label: 'TVA normale', rate: 24 },
    { code: 'EL13', label: 'TVA réduite 13%', rate: 13 },
    { code: 'EL6', label: 'TVA réduite 6%', rate: 6 },
  ],
  HU: [
    { code: 'HU27', label: 'TVA normale', rate: 27 },
    { code: 'HU18', label: 'TVA réduite 18%', rate: 18 },
    { code: 'HU5', label: 'TVA réduite 5%', rate: 5 },
  ],
  IE: [
    { code: 'IE23', label: 'TVA normale', rate: 23 },
    { code: 'IE13.5', label: 'TVA réduite 13.5%', rate: 13.5 },
    { code: 'IE9', label: 'TVA réduite 9%', rate: 9 },
    { code: 'IE0', label: 'TVA zéro', rate: 0 },
  ],
  IT: [
    { code: 'IT22', label: 'IVA ordinaria', rate: 22 },
    { code: 'IT10', label: 'IVA ridotta 10%', rate: 10 },
    { code: 'IT5', label: 'IVA ridotta 5%', rate: 5 },
    { code: 'IT4', label: 'IVA minima', rate: 4 },
  ],
  LV: [
    { code: 'LV21', label: 'TVA normale', rate: 21 },
    { code: 'LV12', label: 'TVA réduite 12%', rate: 12 },
    { code: 'LV5', label: 'TVA réduite 5%', rate: 5 },
  ],
  LT: [
    { code: 'LT21', label: 'TVA normale', rate: 21 },
    { code: 'LT9', label: 'TVA réduite 9%', rate: 9 },
    { code: 'LT5', label: 'TVA réduite 5%', rate: 5 },
  ],
  LU: [
    { code: 'LU17', label: 'TVA normale', rate: 17 },
    { code: 'LU14', label: 'TVA intermédiaire', rate: 14 },
    { code: 'LU8', label: 'TVA réduite 8%', rate: 8 },
    { code: 'LU3', label: 'TVA super-réduite', rate: 3 },
  ],
  MT: [
    { code: 'MT18', label: 'TVA normale', rate: 18 },
    { code: 'MT7', label: 'TVA réduite 7%', rate: 7 },
    { code: 'MT5', label: 'TVA réduite 5%', rate: 5 },
  ],
  NL: [
    { code: 'NL21', label: 'BTW normaal', rate: 21 },
    { code: 'NL9', label: 'BTW laag', rate: 9 },
  ],
  PL: [
    { code: 'PL23', label: 'TVA normale', rate: 23 },
    { code: 'PL8', label: 'TVA réduite 8%', rate: 8 },
    { code: 'PL5', label: 'TVA réduite 5%', rate: 5 },
  ],
  PT: [
    { code: 'PT23', label: 'IVA normal', rate: 23 },
    { code: 'PT13', label: 'IVA intermedio', rate: 13 },
    { code: 'PT6', label: 'IVA reduzido', rate: 6 },
  ],
  CZ: [
    { code: 'CZ21', label: 'TVA normale', rate: 21 },
    { code: 'CZ12', label: 'TVA réduite', rate: 12 },
  ],
  RO: [
    { code: 'RO19', label: 'TVA normale', rate: 19 },
    { code: 'RO9', label: 'TVA réduite 9%', rate: 9 },
    { code: 'RO5', label: 'TVA réduite 5%', rate: 5 },
  ],
  SK: [
    { code: 'SK20', label: 'TVA normale', rate: 20 },
    { code: 'SK10', label: 'TVA réduite', rate: 10 },
  ],
  SI: [
    { code: 'SI22', label: 'TVA normale', rate: 22 },
    { code: 'SI9.5', label: 'TVA réduite 9.5%', rate: 9.5 },
    { code: 'SI5', label: 'TVA réduite 5%', rate: 5 },
  ],
  SE: [
    { code: 'SE25', label: 'Moms normal', rate: 25 },
    { code: 'SE12', label: 'Moms reducerad 12%', rate: 12 },
    { code: 'SE6', label: 'Moms reducerad 6%', rate: 6 },
  ],
}

// European countries with ISO codes and phone prefixes
const europeanCountries = [
  { name: 'Allemagne', code: 'DE', prefix: '+49' },
  { name: 'Autriche', code: 'AT', prefix: '+43' },
  { name: 'Belgique', code: 'BE', prefix: '+32' },
  { name: 'Bulgarie', code: 'BG', prefix: '+359' },
  { name: 'Chypre', code: 'CY', prefix: '+357' },
  { name: 'Croatie', code: 'HR', prefix: '+385' },
  { name: 'Danemark', code: 'DK', prefix: '+45' },
  { name: 'Espagne', code: 'ES', prefix: '+34' },
  { name: 'Estonie', code: 'EE', prefix: '+372' },
  { name: 'Finlande', code: 'FI', prefix: '+358' },
  { name: 'France', code: 'FR', prefix: '+33' },
  { name: 'Grèce', code: 'EL', prefix: '+30' },
  { name: 'Hongrie', code: 'HU', prefix: '+36' },
  { name: 'Irlande', code: 'IE', prefix: '+353' },
  { name: 'Italie', code: 'IT', prefix: '+39' },
  { name: 'Lettonie', code: 'LV', prefix: '+371' },
  { name: 'Lituanie', code: 'LT', prefix: '+370' },
  { name: 'Luxembourg', code: 'LU', prefix: '+352' },
  { name: 'Malte', code: 'MT', prefix: '+356' },
  { name: 'Pays-Bas', code: 'NL', prefix: '+31' },
  { name: 'Pologne', code: 'PL', prefix: '+48' },
  { name: 'Portugal', code: 'PT', prefix: '+351' },
  { name: 'République tchèque', code: 'CZ', prefix: '+420' },
  { name: 'Roumanie', code: 'RO', prefix: '+40' },
  { name: 'Slovaquie', code: 'SK', prefix: '+421' },
  { name: 'Slovénie', code: 'SI', prefix: '+386' },
  { name: 'Suède', code: 'SE', prefix: '+46' },
]

interface CompanyData {
  company_name: string
  address: string
  postal_code: string
  city: string
  country: string
  country_code: string
  phone_prefix: string
  phone: string
  email: string
  siret: string
  tva_number: string
  logo_url: string
  website: string
  iban: string
  bic: string
  legal_form: string
  capital: string
  rcs: string
  pdf_footer_text: string
  cgv: string
}

export default function CompanySettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState<typeof europeanCountries[0] | null>(null)
  const [vatModalVisible, setVatModalVisible] = useState(false)
  const [pendingCountry, setPendingCountry] = useState<typeof europeanCountries[0] | null>(null)
  const [addingVatRates, setAddingVatRates] = useState(false)
  const queryClient = useQueryClient()
  const indicatif = Form.useWatch('phone_prefix', form)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getCompany()
      form.setFieldsValue(response.data)
      // Set selected country based on loaded data
      if (response.data.country) {
        const country = europeanCountries.find(c => c.name === response.data.country)
        if (country) {
          setSelectedCountry(country)
        }
      }
    } catch (error) {
      message.error(t('companySettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleCountryChange = (countryName: string) => {
    const country = europeanCountries.find(c => c.name === countryName)
    if (country) {
      // Check if VAT rates exist for this country
      const countryVatRates = vatRatesByCountry[country.code]
      if (countryVatRates && countryVatRates.length > 0) {
        // Store the country and show modal
        setPendingCountry(country)
        setVatModalVisible(true)
      } else {
        // No VAT rates defined, just update the country
        applyCountryChange(country)
      }
    }
  }

  const applyCountryChange = (country: typeof europeanCountries[0]) => {
    setSelectedCountry(country)
    form.setFieldsValue({
      country: country.name,
      country_code: country.code,
      phone_prefix: country.prefix,
    })
  }

  const handleVatModalCancel = () => {
    // User declined, just apply country change without adding VAT rates
    if (pendingCountry) {
      applyCountryChange(pendingCountry)
    }
    setVatModalVisible(false)
    setPendingCountry(null)
  }

  const handleVatModalConfirm = async () => {
    if (!pendingCountry) return

    const countryVatRates = vatRatesByCountry[pendingCountry.code]
    if (!countryVatRates) {
      handleVatModalCancel()
      return
    }

    setAddingVatRates(true)
    try {
      let addedCount = 0
      const errors: string[] = []

      // Add VAT rates for both directions (input and output)
      for (const direction of ['input', 'output'] as const) {
        for (let i = 0; i < countryVatRates.length; i++) {
          const vatRate = countryVatRates[i]
          const isFirst = i === 0 // First rate is the standard rate, set as default

          // Format rate for code (e.g., 5.5 -> "5.5", 20 -> "20")
          const rateStr = vatRate.rate % 1 === 0 ? vatRate.rate.toString() : vatRate.rate.toFixed(1)

          // ⚠️ LE PAYS FAIT PARTIE DU CODE.
          //
          // L'index uq_code de wp_amsbm_tax_rate est global : il ne comporte pas
          // le pays. Bâti sur le seul taux, « D20 » posé pour la France faisait
          // échouer en 500 le « D20 » de l'Autriche, et un pays sur deux
          // repartait avec la moitié de ses taux — dont le taux normal, le seul
          // marqué par défaut : le pays se retrouvait sans taux par défaut.
          // Code : D pour la TVA déductible, C pour la collectée.
          const code = `${direction === 'input' ? 'D' : 'C'}${pendingCountry.code}${rateStr}`

          // Label: TVA déductible xx% for input, TVA collectée xx% for output
          const label = direction === 'input'
            ? `TVA déductible ${rateStr}%`
            : `TVA collectée ${rateStr}%`

          try {
            await settingsAPI.createVATRate({
              direction,
              code,
              country_code: pendingCountry.code,
              label,
              rate: vatRate.rate,
              is_default: isFirst,
            })
            addedCount++
          } catch (error: unknown) {
            // Les refus arrivent sous « message », jamais sous « error » :
            // l'ancienne lecture rendait tous les échecs muets.
            const err = error as { message?: string; response?: { data?: { message?: string } } }
            errors.push(err.response?.data?.message || err.message || t('companySettings.vatRateError', { code }))
          }
        }
      }

      if (addedCount > 0) {
        message.success(t('companySettings.vatRatesAdded', { count: addedCount, country: pendingCountry.name }))

        // ⚠️ ET ON PRÉVIENT LE TABLEAU. L'onglet TVA reste monté derrière
        // celui-ci : sans cette ligne il continue d'afficher les taux d'avant,
        // et le client croit que son import n'a rien fait.
        void queryClient.invalidateQueries({ queryKey: CLE_TAUX_TVA })
      }
      if (errors.length > 0) {
        message.warning(t('companySettings.vatRatesPartialError', { errors: errors.slice(0, 3).join(', ') }))
      }

      // Apply country change
      applyCountryChange(pendingCountry)
    } catch (error) {
      message.error(t('companySettings.vatRatesAddError'))
    } finally {
      setAddingVatRates(false)
      setVatModalVisible(false)
      setPendingCountry(null)
    }
  }

  const handleSubmit = async (values: CompanyData) => {
    setSaving(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { logo_url, ...dataToSave } = values
      await settingsAPI.updateCompany(dataToSave as unknown as Record<string, unknown>)
      message.success(t('companySettings.saveSuccess'))
    } catch (error: unknown) {
      // ⚠️ Le serveur rédige un motif — « L'adresse de courriel de la société
      // n'est pas valide. », « Le champ postal_code dépasse 16 caractères. » —
      // et on le remplaçait par « Erreur lors de la sauvegarde ». Le client ne
      // pouvait pas savoir ce qu'on lui refusait. Les refus arrivent sous
      // « message » (WP_Error) ou sous « error » selon la route.
      const err = error as { response?: { data?: { message?: string; error?: string } } }
      message.error(err.response?.data?.message || err.response?.data?.error || t('companySettings.saveError'))
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
      style={{ maxWidth: 800 }}
    >
      <h3>{t('companySettings.generalInfo')}</h3>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="company_name"
            label={t('companySettings.companyName')}
            rules={[{ required: true, message: t('companySettings.fieldRequired') }]}
          >
            {/* Les bornes sont celles du serveur (voir Settings::companyLengths) :
                elles partent sur les documents imprimés et dans les fichiers
                d'échange, qui bornent leurs champs. Aucune n'existait — une
                raison sociale de cinq mille caractères s'enregistrait. */}
            <Input placeholder={t('companySettings.companyNamePlaceholder')} maxLength={200} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="legal_form" label={t('companySettings.legalForm')}>
            <Input placeholder="SARL, SAS, EURL..." maxLength={60} />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="address" label={t('companySettings.address')}>
        <Input placeholder={t('companySettings.addressPlaceholder')} maxLength={400} />
      </Form.Item>

      <Row gutter={16}>
        <Col span={8}>
          <Form.Item name="postal_code" label={t('companySettings.postalCode')}>
            <Input placeholder="L-1234" maxLength={16} />
          </Form.Item>
        </Col>
        <Col span={16}>
          <Form.Item name="city" label={t('companySettings.city')}>
            <Input placeholder="Luxembourg" maxLength={100} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={8}>
          <Form.Item name="country" label={t('companySettings.country')}>
            <Select
              placeholder={t('companySettings.selectCountry')}
              showSearch
              optionFilterProp="children"
              onChange={handleCountryChange}
              filterOption={(input, option) =>
                (option?.children as unknown as string)?.toLowerCase().includes(input.toLowerCase())
              }
            >
              {europeanCountries.map(country => (
                <Select.Option key={country.code} value={country.name}>
                  {country.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        {/* ⚠️ DEUX CHAMPS VERROUILLÉS QUI NE SE RÉALIMENTENT QU'AU CHANGEMENT DE
            PAYS. Un dossier arrivé avec « Luxembourg » et « +33 » — l'indicatif
            par défaut de la fiche — ne pouvait pas être corrigé sans rejouer le
            changement de pays, lequel rouvre par-dessus la modale d'ajout des
            taux de TVA. Ils restent alimentés par le pays, et se corrigent. */}
        <Col span={8}>
          <Form.Item name="country_code" label={t('companySettings.isoCode')} extra={t('companySettings.followsCountry', 'Renseigné par le pays, modifiable.')}>
            <Input placeholder="FR" maxLength={2} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="phone_prefix" label={t('companySettings.phonePrefix')} extra={t('companySettings.followsCountry', 'Renseigné par le pays, modifiable.')}>
            <Input placeholder="+33" maxLength={8} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          {/* L'indicatif montré est celui de la FICHE, pas celui du pays choisi :
              les deux peuvent diverger, et c'est la fiche qui part sur les
              documents. */}
          <Form.Item name="phone" label={t('common.phone')}>
            <Input
              placeholder="1 23 45 67 89"
              maxLength={32}
              addonBefore={indicatif || selectedCountry?.prefix || '+33'}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* ⚠️ « type=email » LAISSE LE REFUS AU NAVIGATEUR.
              Une adresse malformée ne déclenchait rien de visible : pas de
              requête, pas de message, pas de champ en rouge — seulement la bulle
              native du navigateur, en anglais, sur une interface entièrement en
              français. On refuse ici, dans la langue de l'écran ; le serveur
              refuse de son côté, car cette barrière-là se contourne. */}
          <Form.Item
            name="email"
            label={t('common.email')}
            rules={[{ type: 'email', message: t('companySettings.emailInvalid', 'Cette adresse de courriel n\'est pas valide.') }]}
          >
            <Input placeholder="contact@masociete.fr" maxLength={190} />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        name="website"
        label={t('companySettings.website')}
        rules={[{
          pattern: /^(https?:\/\/)?[^\s/]+\.[^\s/]{2,}/i,
          message: t('companySettings.websiteInvalid', "Cette adresse de site web n'est pas valide."),
        }]}
      >
        <Input placeholder="https://www.masociete.fr" maxLength={255} />
      </Form.Item>

      <Divider />
      <h3>{t('companySettings.legalInfo')}</h3>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="siret" label="SIRET">
            <Input placeholder="123 456 789 00012" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="tva_number" label={t('companySettings.tvaNumber')}>
            <Input placeholder="FR12345678901" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="rcs" label="RCS">
            <Input placeholder="Paris B 123 456 789" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="capital" label={t('companySettings.capital')}>
            <Input placeholder="10 000 EUR" />
          </Form.Item>
        </Col>
      </Row>

      <Divider />
      <h3>{t('companySettings.bankDetails')}</h3>

      <Row gutter={16}>
        <Col span={16}>
          <Form.Item name="iban" label="IBAN">
            <Input placeholder="FR76 1234 5678 9012 3456 7890 123" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name="bic" label="BIC">
            <Input placeholder="BNPAFRPP" />
          </Form.Item>
        </Col>
      </Row>

      <Divider />
      <h3>{t('companySettings.pdfFooter')}</h3>

      <Form.Item
        name="pdf_footer_text"
        label={t('companySettings.pdfFooterLabel')}
        extra={t('companySettings.pdfFooterExtra')}
      >
        <Input.TextArea
          rows={2}
          placeholder="Ex: N° Siret : 123 456 789 00012 | N.A.F. : 6201Z | N° TVA : FR12345678901"
        />
      </Form.Item>

      <Divider />
      <h3>{t('companySettings.cgv', 'Conditions générales de vente')}</h3>

      {/* Imprimées en dernière page des devis et des factures. Laissées vides,
          la page n'est pas produite : mieux vaut pas de CGV du tout qu'une page
          titrée et blanche envoyée au client. */}
      <Form.Item
        name="cgv"
        label={t('companySettings.cgvLabel', 'Texte des conditions générales')}
        extra={t(
          'companySettings.cgvExtra',
          "Ce texte s'imprime en dernière page des documents. Laissez vide pour ne pas ajouter de page."
        )}
      >
        <Input.TextArea rows={10} maxLength={20000} showCount />
      </Form.Item>

      <Form.Item style={{ marginTop: 24 }}>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
          {t('common.save')}
        </Button>
      </Form.Item>

      <Modal
        title={t('companySettings.addVatRatesTitle')}
        open={vatModalVisible}
        onOk={handleVatModalConfirm}
        onCancel={handleVatModalCancel}
        okText={t('companySettings.addVatRatesOk')}
        cancelText={t('companySettings.addVatRatesCancel')}
        confirmLoading={addingVatRates}
      >
        {pendingCountry && (
          <div>
            <p>
              {t('companySettings.countrySelectedPrefix')} <strong>{pendingCountry.name}</strong>.
            </p>
            <p>
              {t('companySettings.addVatRatesQuestion')}
            </p>
            {vatRatesByCountry[pendingCountry.code] && (
              <div style={{ marginTop: 16 }}>
                <p style={{ marginBottom: 8, fontWeight: 500 }}>{t('companySettings.ratesToBeAdded')}</p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {vatRatesByCountry[pendingCountry.code].map((rate) => (
                    <li key={rate.code}>
                      <strong>{rate.rate}%</strong> - {rate.label}
                    </li>
                  ))}
                </ul>
                <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>
                  {t('companySettings.bothDirectionsNote')}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Form>
  )
}

// Export the european countries list for use in other components
export { europeanCountries }
