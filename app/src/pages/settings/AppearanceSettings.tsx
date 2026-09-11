import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Form, Card, Radio, ColorPicker, Button, message, Space, Typography, Row, Col, Upload, Image, Tooltip } from 'antd'
import { SaveOutlined, FileTextOutlined, UploadOutlined, DeleteOutlined, BgColorsOutlined, AimOutlined } from '@ant-design/icons'
import { settingsAPI } from '@/services/api'
import { useThemeStore } from '@/stores/themeStore'
import type { Color } from 'antd/es/color-picker'
import type { UploadProps } from 'antd'

const { Title, Text } = Typography

// Pipette (EyeDropper API) — disponible sur Chrome, Edge, Opera
const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window

function EyeDropperButton({ onPick }: { onPick: (color: string) => void }) {
  const { t } = useTranslation()
  if (!hasEyeDropper) return null
  const pick = async () => {
    try {
      // @ts-ignore — EyeDropper API pas encore dans les types TS standard
      const dropper = new window.EyeDropper()
      const result = await dropper.open()
      onPick(result.sRGBHex)
    } catch {
      // L'utilisateur a annulé
    }
  }
  return (
    <Tooltip title={t('appearanceSettings.eyeDropperTooltip')}>
      <Button icon={<AimOutlined />} size="small" onClick={pick} style={{ marginLeft: 4 }} />
    </Tooltip>
  )
}

function colorToHex(color: string | Color | undefined, fallback: string): string {
  if (!color) return fallback
  if (typeof color === 'string') return color
  if (typeof color === 'object' && 'toHexString' in color) return (color as Color).toHexString()
  return fallback
}

export default function AppearanceSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const { setTheme, setSidebarColors, sidebarBgColor, sidebarButtonColor, sidebarTitleColor } = useThemeStore()

  // Couleurs gérées en state React (pas dans le form Ant Design)
  const [primaryColor, setPrimaryColor] = useState('#1890ff')
  const [sidebarBg, setSidebarBg] = useState(sidebarBgColor)
  const [sidebarTitle, setSidebarTitle] = useState(sidebarTitleColor)
  const [sidebarButton, setSidebarButton] = useState(sidebarButtonColor)

  // ⚠️ DEUX MODÈLES, ET PAS QUATRE — parce qu'il n'y en a que deux.
  //
  // « Élégant » et « Professionnel » rendaient un HTML OCTET À OCTET IDENTIQUE
  // à « Moderne » : le gabarit ne teste que « classic », et sert la même page
  // pour tout le reste. Quatre noms pour deux présentations, dont trois
  // mentaient — un choix qui ne change rien est pire qu'une absence de choix.
  //
  // Les deux qui restent se distinguent par UNE chose, la seule que le SaaS
  // d'origine faisait varier : de quel côté sont le logo et la société. La
  // description le dit, plutôt qu'un adjectif qui ne décrit rien.
  const pdfTemplates = [
    {
      value: 'classic',
      label: t('appearanceSettings.pdfTemplateClassicLabel'),
      description: t('appearanceSettings.pdfTemplateClassicDescription', 'Société à gauche, logo à droite. Le titre du document est aligné à droite.'),
    },
    {
      value: 'modern',
      label: t('appearanceSettings.pdfTemplateModernLabel'),
      description: t('appearanceSettings.pdfTemplateModernDescription', 'Logo à gauche, société à droite. Le titre du document est aligné à gauche.'),
    },
  ]

  useEffect(() => { loadSettings() }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const [appearanceRes, companyRes] = await Promise.all([
        settingsAPI.getAppearance(),
        settingsAPI.getCompany(),
      ])
      const pc = appearanceRes.data.primary_color || '#1890ff'
      form.setFieldsValue({
        // ⚠️ « elegant » et « professional » n'existent plus : ils rendaient la
        // même page que « modern ». On les y ramène à la lecture, sinon la liste
        // s'affiche sans rien de coché et le premier enregistrement bascule le
        // document sur « classic » — le logo changerait de côté sans qu'on l'ait
        // demandé.
        pdf_template: 'classic' === appearanceRes.data.pdf_template ? 'classic' : 'modern',
        theme_mode: appearanceRes.data.theme_mode || 'light',
      })
      setPrimaryColor(pc)

      // ⚠️ LES COULEURS DE LA BARRE LATÉRALE VIENNENT DU SERVEUR.
      //
      // Elles ne quittaient jamais le navigateur : handleSave ne les envoyait
      // pas, et la relecture tapait dans le MÊME magasin local — l'aller-retour
      // paraissait donc réussi, jusqu'à ce qu'on ouvre l'ERP depuis un autre
      // poste. Repli sur le magasin local tant que le serveur ne renvoie rien.
      const bg = appearanceRes.data.sidebar_bg || sidebarBgColor
      const title = appearanceRes.data.sidebar_title || sidebarTitleColor
      const button = appearanceRes.data.sidebar_button || sidebarButtonColor
      setSidebarBg(bg)
      setSidebarTitle(title)
      setSidebarButton(button)
      setSidebarColors(bg, button, title)
      if (companyRes.data.logo_url) {
        setLogoUrl(companyRes.data.logo_url + '?t=' + Date.now())
      }
    } catch {
      form.setFieldsValue({
        pdf_template: 'classic',
        theme_mode: 'light',
      })
      setPrimaryColor('#1890ff')
      setSidebarBg('#0f172a')
      setSidebarTitle('#94a3b8')
      setSidebarButton('#1e293b')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)

      // Les trois couleurs de la barre latérale partent avec le reste : c'est
      // un réglage de la maison, pas une préférence de navigateur.
      // (Objet nommé et non littéral : la signature de settingsAPI.updateAppearance
      // ne déclare encore que trois clés — voir handoff/L5.md.)
      const payload = {
        pdf_template: values.pdf_template,
        primary_color: primaryColor,
        theme_mode: values.theme_mode,
        sidebar_bg: sidebarBg,
        sidebar_title: sidebarTitle,
        sidebar_button: sidebarButton,
      }

      await settingsAPI.updateAppearance(payload)

      // Appliquer immédiatement le thème et les couleurs sidebar
      setTheme(values.theme_mode as 'light' | 'dark', primaryColor)
      setSidebarColors(sidebarBg, sidebarButton, sidebarTitle)

      // Forcer le re-render du CSS sidebar
      const root = document.documentElement
      root.style.setProperty('--sidebar-title-color', sidebarTitle)
      root.style.setProperty('--sidebar-text-color', sidebarTitle)
      root.style.setProperty('--sidebar-active-bg', sidebarButton + '33')
      root.style.setProperty('--sidebar-active-color', sidebarButton)

      message.success(t('appearanceSettings.appearanceSaved'))
    } catch {
      message.error(t('appearanceSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  // Logo handlers
  const handleLogoUpload: UploadProps['customRequest'] = async (options) => {
    const { file } = options
    setUploading(true)
    try {
      const response = await settingsAPI.uploadLogo(file as File)
      setLogoUrl(response.data.logo_url + '?t=' + Date.now())
      message.success(t('appearanceSettings.logoUploaded'))
    } catch (err: any) {
      message.error(err.response?.data?.error || t('appearanceSettings.uploadError'))
    } finally {
      setUploading(false)
    }
  }

  const handleLogoDelete = async () => {
    try {
      await settingsAPI.deleteLogo()
      setLogoUrl(null)
      message.success(t('appearanceSettings.logoDeleted'))
    } catch {
      message.error(t('appearanceSettings.deleteError'))
    }
  }

  const beforeUpload = (file: File) => {
    const ok = file.type.startsWith('image/')
    if (!ok) message.error(t('appearanceSettings.imageFormatRequired'))
    const small = file.size / 1024 / 1024 < 2
    if (!small) message.error(t('appearanceSettings.maxSize2Mo'))
    return ok && small
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>{t('appearanceSettings.title')}</Title>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          {t('common.save')}
        </Button>
      </div>

      <Form form={form} layout="vertical" disabled={loading}>
        {/* Logo */}
        <Card title={t('appearanceSettings.logoSection')} style={{ marginBottom: 24 }} size="small">
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 8, background: '#fafafa', minWidth: 100, minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {logoUrl ? (
                <Image src={logoUrl} alt="Logo" style={{ maxWidth: 100, maxHeight: 100, objectFit: 'contain' }} />
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>{t('appearanceSettings.noLogo')}</Text>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Upload accept="image/*" showUploadList={false} customRequest={handleLogoUpload} beforeUpload={beforeUpload}>
                <Button icon={<UploadOutlined />} loading={uploading}>
                  {logoUrl ? t('appearanceSettings.change') : t('appearanceSettings.upload')}
                </Button>
              </Upload>
              {logoUrl && (
                <Button danger size="small" icon={<DeleteOutlined />} onClick={handleLogoDelete}>{t('common.delete')}</Button>
              )}
              <Text type="secondary" style={{ fontSize: 11 }}>{t('appearanceSettings.logoHint')}</Text>
            </div>
          </div>
        </Card>

        {/* Couleurs principales */}
        <Card title={<><BgColorsOutlined /> {t('appearanceSettings.mainColorsSection')}</>} style={{ marginBottom: 24 }} size="small">
          <Row gutter={24}>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('appearanceSettings.primaryColor')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ColorPicker showText format="hex" value={primaryColor} onChange={(c) => setPrimaryColor(colorToHex(c, '#1890ff'))} />
                  <EyeDropperButton onPick={(c) => setPrimaryColor(c)} />
                </div>
              </div>
            </Col>
          </Row>
        </Card>

        {/* Barre latérale */}
        <Card title={t('appearanceSettings.sidebarSection')} style={{ marginBottom: 24 }} size="small">
          <Row gutter={24}>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('appearanceSettings.sidebarBackground')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ColorPicker showText format="hex" value={sidebarBg} onChange={(c) => setSidebarBg(colorToHex(c, '#0f172a'))} />
                  <EyeDropperButton onPick={(c) => setSidebarBg(c)} />
                </div>
              </div>
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('appearanceSettings.sidebarText')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ColorPicker showText format="hex" value={sidebarTitle} onChange={(c) => setSidebarTitle(colorToHex(c, '#94a3b8'))} />
                  <EyeDropperButton onPick={(c) => setSidebarTitle(c)} />
                </div>
              </div>
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('appearanceSettings.sidebarActive')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ColorPicker showText format="hex" value={sidebarButton} onChange={(c) => setSidebarButton(colorToHex(c, '#1e293b'))} />
                  <EyeDropperButton onPick={(c) => setSidebarButton(c)} />
                </div>
              </div>
            </Col>
          </Row>
        </Card>

        {/* Thème */}
        <Card title={t('appearanceSettings.themeSection')} style={{ marginBottom: 24 }} size="small">
          <Form.Item name="theme_mode" label={t('appearanceSettings.displayMode')}>
            <Radio.Group>
              <Space>
                <Radio.Button value="light">☀️ {t('appearanceSettings.themeLight')}</Radio.Button>
                <Radio.Button value="dark">🌙 {t('appearanceSettings.themeDark')}</Radio.Button>
              </Space>
            </Radio.Group>
          </Form.Item>
        </Card>

        {/* Modèle PDF */}
        <Card title={<><FileTextOutlined /> {t('appearanceSettings.pdfTemplateSection')}</>} size="small">
          <Form.Item name="pdf_template" label={t('appearanceSettings.pdfDocumentStyle')}>
            <Radio.Group style={{ width: '100%' }}>
              <Row gutter={[12, 12]}>
                {pdfTemplates.map((tpl) => (
                  <Col xs={24} sm={12} key={tpl.value}>
                    <Radio.Button value={tpl.value} style={{ width: '100%', height: 'auto', padding: 12, textAlign: 'left', whiteSpace: 'normal' }}>
                      <Text strong>{tpl.label}</Text><br />
                      <Text type="secondary" style={{ fontSize: 11 }}>{tpl.description}</Text>
                    </Radio.Button>
                  </Col>
                ))}
              </Row>
            </Radio.Group>
          </Form.Item>
        </Card>
      </Form>
    </div>
  )
}
