import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Form,
  Input,
  Button,
  Row,
  Col,
  Switch,
  InputNumber,
  Select,
  message,
  Spin,
  Table,
  Tabs,
  Tag,
  Space,
  Modal,
} from 'antd'
import { SaveOutlined, PlusOutlined, DeleteOutlined, InboxOutlined } from '@ant-design/icons'
import { articleAPI, settingsAPI, stockAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import DocumentsSection from '@/components/DocumentsSection'
import ArticleComptaTab from './ArticleComptaTab'
import { usePermissionStore } from '@/stores/permissionStore'

interface ArticleEditorProps {
  tabId: string
  documentId?: string
}

interface ArticleComponent {
  id: string
  parent_id: string
  child_id: string
  quantity: number
  child?: Article
}

interface Article {
  id: string
  code: string
  name: string
  description?: string
  type: string
  unit: string
  purchase_price: number
  sale_price: number
  is_composed: boolean
  stock_managed: boolean
  min_stock: number
  barcode?: string
  is_active: boolean
  shop_visible?: boolean
  tva_rate?: number
  components?: ArticleComponent[]
}

interface VATRate {
  id: string
  code: string
  label: string
  rate: number
  direction: string
  is_default?: boolean
}

interface ArticleListResponse {
  data: Article[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

interface StockLevel {
  id: string
  article_id: string
  warehouse_id: string
  quantity: number
  reserved_quantity: number
  min_threshold?: number
  warehouse?: { id: string; name: string }
}

interface StockMovement {
  id: string
  article_id: string
  warehouse_id: string
  type: string
  quantity: number
  reference?: string
  notes?: string
  created_at: string
}

interface Warehouse {
  id: string
  code: string
  name: string
  is_default?: boolean
}

interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

export default function ArticleEditor({ tabId, documentId }: ArticleEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const typeOptions = [
    { value: 'product', label: t('articleEditor.typeProduct') },
    { value: 'service', label: t('articleEditor.typeService') },
  ]

  const unitOptions = [
    { value: 'U.', label: t('articleEditor.unitUnit') },
    { value: 'kg', label: t('articleEditor.unitKilogram') },
    { value: 'l', label: t('articleEditor.unitLiter') },
    { value: 'm', label: t('articleEditor.unitMeter') },
    { value: 'h', label: t('articleEditor.unitHour') },
    { value: 'day', label: t('articleEditor.unitDay') },
    { value: 'pack', label: t('articleEditor.unitPack') },
  ]

  const [form] = Form.useForm()
  const isEdit = !!documentId
  const { updateTabTitle, setTabDirty } = useDocumentTabsStore()
  const canViewCompta = usePermissionStore((s) => s.canView('compta'))
  const [isComposed, setIsComposed] = useState(false)
  const [stockManaged, setStockManaged] = useState(true)
  // ⚠️ Chaque interrupteur de l'en-tête a besoin de son état.
  //
  // Ils vivent hors du <Form> : un `checked={form.getFieldValue(...)}` ne
  // provoque aucun rendu quand on le bascule, et l'interrupteur restait
  // visuellement figé — on croyait l'écran bloqué.
  const [isActive, setIsActive] = useState(true)
  // Visibilité en boutique : décide si l'article est relié à WooCommerce.
  const [shopVisible, setShopVisible] = useState(false)
  const [articleType, setArticleType] = useState<string>('product')
  const [movementModalOpen, setMovementModalOpen] = useState(false)
  const [movementForm] = Form.useForm()

  // ⚠️ ÉCHAP NE FERMAIT PAS LA FENÊTRE.
  //
  // antd n'écoute la touche que sur l'enveloppe de la modale : elle ne se
  // referme donc que si le focus est passé DEDANS, ce qui n'arrive qu'à la fin
  // de l'animation d'ouverture. Quand celle-ci ne se joue pas — animations
  // coupées, navigateur piloté —, la frappe part sur le corps du document et
  // n'atteint jamais l'écouteur : seule la croix fermait la fenêtre. On écoute
  // donc au niveau du document, en laissant la main aux listes déroulantes
  // ouvertes, pour lesquelles Échap veut dire « referme la liste ».
  useEffect(() => {
    if (!movementModalOpen) return

    const auClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Une liste déroulante ouverte, un sélecteur de date ou une demande de
      // confirmation par-dessus se ferment d'abord : Échap leur appartient.
      if (document.querySelector('.ant-select-open, .ant-picker-focused, .ant-modal-confirm')) return

      setMovementModalOpen(false)
    }

    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  }, [movementModalOpen])

  // Stock management is only available for non-composed products (not services)
  const canManageStock = !isComposed && articleType !== 'service'

  const { data: article, isLoading } = useQuery({
    queryKey: ['article', documentId],
    queryFn: async () => {
      const response = await articleAPI.get(documentId!)
      return response.data as Article
    },
    enabled: isEdit,
  })

  // Fetch all articles for component selection
  const { data: allArticlesData, isLoading: isLoadingAllArticles } = useQuery<ArticleListResponse>({
    queryKey: ['articles-for-components'],
    queryFn: async () => {
      const response = await articleAPI.list({ page: 1, page_size: 100 })
      return response.data
    },
  })

  // Taux de TVA du référentiel.
  //
  // ⚠️ Pas de saisie libre : Articles::taxRateId ne reconnaît qu'un taux qui
  // existe déjà dans amsbm_tax_rate et rend null pour tout autre — un 17 % tapé
  // à la main sur un référentiel qui ne le connaît pas se perdrait en silence.
  const { data: vatRatesData } = useQuery({
    queryKey: ['vat-rates'],
    queryFn: async () => {
      const response = await settingsAPI.listVATRates()
      return response.data
    },
  })

  const tvaOptions = useMemo(() => {
    const rates: VATRate[] = vatRatesData?.vat_rates || []
    // La TVA d'un article est celle qu'on collecte à la vente ; on retombe sur
    // l'ensemble du référentiel si aucun taux « collecté » n'est défini.
    const collectes = rates.filter((r) => 'output' === r.direction)
    const retenus = collectes.length > 0 ? collectes : rates

    return [...new Set(retenus.map((r) => Number(r.rate)))]
      .sort((a, b) => b - a)
      .map((rate) => ({ value: rate, label: `${rate} %` }))
  }, [vatRatesData])

  // Fetch stock levels for this article
  const { data: stockLevelsData } = useQuery<PaginatedResponse<StockLevel>>({
    queryKey: ['stock-levels-article', documentId],
    queryFn: async () => {
      const response = await stockAPI.getLevels({ article_id: documentId })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch stock movements for this article
  const [movementsPage, setMovementsPage] = useState(1)
  const { data: stockMovementsData, isLoading: isLoadingMovements } = useQuery<PaginatedResponse<StockMovement>>({
    queryKey: ['stock-movements-article', documentId, movementsPage],
    queryFn: async () => {
      const response = await stockAPI.getMovements({
        article_id: documentId,
        page: movementsPage,
        page_size: 10,
      })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch warehouses for the movement form
  const { data: warehousesData } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const response = await stockAPI.getWarehouses()
      return response.data
    },
    enabled: isEdit && canManageStock && stockManaged,
  })

  // Create stock movement mutation
  const createMovementMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return stockAPI.createMovement(data)
    },
    onSuccess: () => {
      message.success(t('articleEditor.movementCreated'))
      setMovementModalOpen(false)
      movementForm.resetFields()
      queryClient.invalidateQueries({ queryKey: ['stock-movements-article', documentId] })
      queryClient.invalidateQueries({ queryKey: ['stock-levels-article', documentId] })
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
    },
    // ⚠️ REMONTER LE MESSAGE DU SERVEUR, PAS UN TEXTE FIXE.
    //
    // L'intercepteur d'api.ts recopie déjà le motif du refus dans
    // error.message. En l'ignorant, l'écran affichait « Erreur lors de la
    // création » quel que soit le refus — l'utilisateur ne pouvait pas
    // deviner ce qui n'allait pas.
    onError: (error: Error) => {
      message.error(error.message || t('articleEditor.movementCreateError'))
    },
  })

  // Calculate total stock
  const totalStock = stockLevelsData?.data?.reduce((sum, level) => sum + level.quantity, 0) || 0
  const totalReserved = stockLevelsData?.data?.reduce((sum, level) => sum + (level.reserved_quantity || 0), 0) || 0
  const availableStock = totalStock - totalReserved

  useEffect(() => {
    if (article) {
      updateTabTitle(tabId, article.name || `Article ${article.code}`)
      setIsComposed(!!article.is_composed)
      setArticleType(article.type || 'product')
      // Stock management is only for non-composed products
      const canStock = !article.is_composed && article.type !== 'service'
      // ⚠️ ON GARDE LA POSITION ENREGISTRÉE, MÊME QUAND L'INTERRUPTEUR EST CACHÉ.
      //
      // Elle était écrasée par « false » dès que l'article était un service ou
      // un composé : repasser en « Produit » laissait « Gestion stock » éteint
      // et le seuil d'alerte déjà saisi hors de vue. Ce qui part au serveur est
      // calculé à l'enregistrement (voir onFinish), pas stocké éteint ici.
      setStockManaged(article.stock_managed ?? true)
      setShopVisible(!!article.shop_visible)
      setIsActive(article.is_active ?? true)
      form.setFieldsValue({
        code: article.code,
        name: article.name,
        description: article.description,
        type: article.type,
        unit: article.unit,
        purchase_price: article.purchase_price,
        sale_price: article.sale_price,
        is_composed: article.is_composed,
        stock_managed: canStock ? article.stock_managed : false,
        min_stock: article.min_stock,
        tva_rate: article.tva_rate,
        barcode: article.barcode,
        is_active: article.is_active,
        shop_visible: article.shop_visible ?? false,
        components: article.components?.map((c) => ({
          child_id: c.child_id,
          quantity: c.quantity,
        })) || [],
      })
    }
  }, [article, form, tabId, updateTabTitle])

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const { components, ...articleData } = data
      const response = await articleAPI.create(articleData)
      const articleId = response.data?.id

      // Add components — seulement si l'article est bien composé : le magasin
      // du formulaire garde les lignes saisies même après extinction de
      // l'interrupteur, et on les reposerait sur un article simple.
      if (articleId && isComposed && Array.isArray(components) && components.length > 0) {
        for (const comp of components) {
          if (comp?.child_id && comp?.quantity) {
            await articleAPI.addComponent(articleId, {
              childId: comp.child_id,
              quantity: comp.quantity,
            })
          }
        }
      }
      return response
    },
    onSuccess: (response) => {
      message.success(t('articleEditor.articleCreated'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['articles'], refetchType: 'all' })
      if (response.data) {
        updateTabTitle(tabId, response.data.name || `Article ${response.data.code}`)
      }
    },
    onError: (error: Error) => {
      message.error(error.message || t('articleEditor.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const { components, ...articleData } = data
      const response = await articleAPI.update(documentId!, articleData)

      // ⚠️ ON RETIRE CE QUE LE SERVEUR PORTE, PAS CE QU'ON A LU EN ARRIVANT.
      //
      // La boucle défaisait la nomenclature de la fiche telle qu'elle avait été
      // chargée, et seulement si celle-ci était déjà composée : éteindre
      // « Article composé » laissait donc l'ancienne nomenclature en base, et
      // deux enregistrements d'affilée retiraient des lignes déjà retirées.
      const actuels = await articleAPI.getComponents(documentId!)

      for (const comp of (actuels.data?.data || []) as ArticleComponent[]) {
        await articleAPI.removeComponent(documentId!, String(comp.child_id))
      }

      if (isComposed && Array.isArray(components) && components.length > 0) {
        for (const comp of components) {
          if (comp?.child_id && comp?.quantity) {
            await articleAPI.addComponent(documentId!, {
              childId: comp.child_id,
              quantity: comp.quantity,
            })
          }
        }
      }
      return response
    },
    onSuccess: () => {
      message.success(t('articleEditor.articleUpdated'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['articles'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['article', documentId], refetchType: 'all' })
    },
    onError: (error: Error) => {
      message.error(error.message || t('articleEditor.updateError'))
    },
  })

  const handleValuesChange = () => {
    setTabDirty(tabId, true)
  }

  const onFinish = (values: Record<string, unknown>) => {
    // ⚠️ LE MAGASIN COMPLET, PAS LES SEULS CHAMPS MONTÉS.
    //
    // Les quatre interrupteurs de l'en-tête (Actif, Boutique, Gestion stock,
    // Composé) vivent HORS du <Form> : ils écrivent bien dans le magasin par
    // setFieldValue, mais rc-field-form ne remonte à onFinish que les champs
    // enregistrés par un Form.Item. Les quatre commandes ne partaient donc
    // jamais au serveur — on les basculait, « Enregistré » s'affichait, et
    // rien n'avait changé. getFieldsValue(true) rend tout le magasin ; les
    // valeurs validées gardent le dernier mot.
    //
    // La gestion de stock, elle, se calcule : un service et un article composé
    // n'en ont pas, quelle que soit la position d'un interrupteur qu'on ne
    // montre même plus.
    const payload = { ...form.getFieldsValue(true), ...values, stock_managed: canManageStock && stockManaged }

    if (isEdit) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const availableArticles = allArticlesData?.data?.filter(
    (a) => a.id !== documentId && !a.is_composed
  ) || []

  const calculatePricesFromComponents = () => {
    const components = form.getFieldValue('components') || []
    let totalPurchasePrice = 0
    let totalSalePrice = 0

    components.forEach((comp: { child_id?: string; quantity?: number }) => {
      if (comp?.child_id && comp?.quantity) {
        const art = availableArticles.find(a => a.id === comp.child_id)
        if (art) {
          totalPurchasePrice += (art.purchase_price || 0) * comp.quantity
          totalSalePrice += (art.sale_price || 0) * comp.quantity
        }
      }
    })

    form.setFieldsValue({
      purchase_price: Math.round(totalPurchasePrice * 100) / 100,
      sale_price: Math.round(totalSalePrice * 100) / 100,
    })
  }

  if (isEdit && isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const movementColumns = [
    {
      title: t('common.date'),
      dataIndex: 'created_at',
      key: 'date',
      width: 150,
      render: formatDate,
    },
    {
      title: t('articleEditor.movementType'),
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (type: string) => {
        const colors: Record<string, string> = {
          in: 'green',
          out: 'red',
          transfer: 'blue',
          adjustment: 'orange',
        }
        const labels: Record<string, string> = {
          in: t('articleEditor.movementIn'),
          out: t('articleEditor.movementOut'),
          transfer: t('articleEditor.movementTransfer'),
          adjustment: t('articleEditor.movementAdjustment'),
        }
        return <Tag color={colors[type]}>{labels[type] || type}</Tag>
      },
    },
    {
      title: t('articleEditor.quantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (v: number, record: StockMovement) => {
        const sign = record.type === 'in' ? '+' : record.type === 'out' ? '-' : ''
        return (
          <span style={{ color: record.type === 'in' ? '#52c41a' : record.type === 'out' ? '#ff4d4f' : undefined }}>
            {sign}{v?.toFixed(2)}
          </span>
        )
      },
    },
    { title: t('articleEditor.reference'), dataIndex: 'reference', key: 'reference' },
    { title: t('articleEditor.notes'), dataIndex: 'notes', key: 'notes' },
  ]

  return (
    <div style={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          background: '#fafafa',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <h2 style={{ margin: 0 }}>{isEdit ? t('articleEditor.editTitle') : t('articleEditor.newTitle')}</h2>
        <Space size="middle">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ fontSize: 14, color: '#333' }}>{t('articleEditor.active')}</span>
            <Switch
              checked={isActive}
              onChange={(checked) => {
                setIsActive(checked)
                form.setFieldValue('is_active', checked)
                // Hors du <Form>, onValuesChange ne se déclenche pas : sans
                // cela, l'onglet ne se marquait pas modifié et se fermait sans
                // prévenir.
                setTabDirty(tabId, true)
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ fontSize: 14, color: '#333' }} title="Publie l'article dans la boutique WooCommerce et le tient à jour dans les deux sens.">
              Visible sur la boutique
            </span>
            <Switch
              checked={shopVisible}
              onChange={(checked) => {
                setShopVisible(checked)
                form.setFieldValue('shop_visible', checked)
                setTabDirty(tabId, true)
              }}
            />
          </div>
          {canManageStock && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span style={{ fontSize: 14, color: '#333' }}>{t('articleEditor.stockManagement')}</span>
              <Switch
                checked={stockManaged}
                onChange={(checked) => {
                  setStockManaged(checked)
                  form.setFieldValue('stock_managed', checked)
                  setTabDirty(tabId, true)
                }}
              />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ fontSize: 14, color: '#333' }}>{t('articleEditor.composedArticle')}</span>
            <Switch
              checked={isComposed}
              onChange={(checked) => {
                setIsComposed(checked)
                form.setFieldValue('is_composed', checked)
                setTabDirty(tabId, true)
              }}
            />
          </div>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={createMutation.isPending || updateMutation.isPending}
            onClick={() => form.submit()}
          >
            {t('common.save')}
          </Button>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column' }}>
      <Form
        form={form}
        layout="vertical"
        size="small"
        onFinish={onFinish}
        onValuesChange={handleValuesChange}
        initialValues={{
          type: 'product',
          unit: 'U.',
          stock_managed: true,
          is_active: true,
          shop_visible: false,
          is_composed: false,
          components: [],
        }}
        style={{ marginBottom: 0 }}
      >
        <Row gutter={12}>
          <Col span={4}>
            <Form.Item
              name="code"
              label={t('articleEditor.code')}
              rules={[{ required: true, message: t('articleEditor.required') }]}
              style={{ marginBottom: 8 }}
              normalize={(value) => value?.toUpperCase()}
            >
              <Input placeholder="ART001" style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name="name"
              label={t('articleEditor.designation')}
              rules={[{ required: true, message: t('articleEditor.required') }]}
              style={{ marginBottom: 8 }}
            >
              <Input placeholder={t('articleEditor.namePlaceholder')} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="type" label={t('articleEditor.type')} rules={[{ required: true }]} style={{ marginBottom: 8 }}>
              <Select
                options={typeOptions}
                // Un service n'a pas de stock : l'interrupteur disparaît
                // (canManageStock), mais on n'efface pas sa position — un
                // aller-retour Service → Produit rendait autrement le seuil
                // d'alerte invisible et la gestion de stock éteinte en silence.
                onChange={(value) => setArticleType(value)}
              />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="unit" label={t('articleEditor.unit')} style={{ marginBottom: 8 }}>
              <Select options={unitOptions} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="barcode" label={t('articleEditor.barcode')} style={{ marginBottom: 8 }}>
              <Input placeholder="EAN13..." />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={4}>
            <Form.Item name="purchase_price" label={t('articleEditor.purchasePrice')} style={{ marginBottom: 8 }}>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="sale_price" label={t('articleEditor.salePrice')} style={{ marginBottom: 8 }}>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item
              label={t('articleEditor.margin')}
              style={{ marginBottom: 8 }}
              shouldUpdate={(prev, curr) =>
                prev.purchase_price !== curr.purchase_price || prev.sale_price !== curr.sale_price
              }
            >
              {() => {
                const purchasePrice = form.getFieldValue('purchase_price') || 0
                const salePrice = form.getFieldValue('sale_price') || 0
                const margin = salePrice - purchasePrice
                const marginPercent = purchasePrice > 0 ? ((margin / purchasePrice) * 100).toFixed(1) : '0'
                return (
                  <div
                    style={{
                      padding: '2px 8px',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      backgroundColor: '#fafafa',
                      color: margin >= 0 ? 'green' : 'red',
                      fontWeight: 500,
                      fontSize: 12,
                    }}
                  >
                    {margin.toFixed(2)} EUR ({marginPercent}%)
                  </div>
                )
              }}
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="tva_rate" label={t('articleEditor.tvaRate', 'TVA')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                options={tvaOptions}
                placeholder={t('articleEditor.tvaRatePlaceholder', 'Taux du référentiel')}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={16}>
            {/* La description était chargée dans le magasin mais montée nulle
                part : ni affichée, ni modifiable. Le serveur, lui, la conserve
                et la rend à chaque lecture. */}
            <Form.Item name="description" label={t('articleEditor.description', 'Description')} style={{ marginBottom: 8 }}>
              <Input.TextArea rows={2} placeholder={t('articleEditor.descriptionPlaceholder', 'Description commerciale de l’article')} />
            </Form.Item>
          </Col>
        </Row>

        {canManageStock && stockManaged && (
              <Row gutter={12}>
                <Col span={4}>
                  <Form.Item
                    name="min_stock"
                    label={t('articleEditor.alertThreshold')}
                    tooltip={t('articleEditor.alertThresholdTooltip')}
                    style={{ marginBottom: 8 }}
                  >
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      precision={0}
                      placeholder="10"
                    />
                  </Form.Item>
                </Col>
                {isEdit && (
                  <>
                    <Col span={4}>
                      <Form.Item label={t('articleEditor.totalStock')} style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            padding: '2px 8px',
                            border: '1px solid #d9d9d9',
                            borderRadius: 4,
                            backgroundColor: '#f5f5f5',
                            fontWeight: 500,
                            fontSize: 12,
                            color: totalStock <= 0 ? '#ff4d4f' : totalStock <= (article?.min_stock || 0) ? '#faad14' : '#52c41a',
                          }}
                        >
                          {totalStock.toFixed(2)}
                        </div>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label={t('articleEditor.reserved')} style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            padding: '2px 8px',
                            border: '1px solid #d9d9d9',
                            borderRadius: 4,
                            backgroundColor: '#f5f5f5',
                            fontSize: 12,
                          }}
                        >
                          {totalReserved.toFixed(2)}
                        </div>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label={t('articleEditor.available')} style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            padding: '2px 8px',
                            border: '1px solid #d9d9d9',
                            borderRadius: 4,
                            backgroundColor: '#f5f5f5',
                            fontWeight: 500,
                            fontSize: 12,
                            color: availableStock <= 0 ? '#ff4d4f' : availableStock <= (article?.min_stock || 0) ? '#faad14' : '#52c41a',
                          }}
                        >
                          {availableStock.toFixed(2)}
                        </div>
                      </Form.Item>
                    </Col>
                  </>
                )}
              </Row>
        )}

      </Form>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: 12 }}>
        <Tabs
          // ⚠️ L'ONGLET QUI APPARAÎT PREND LA MAIN.
          //
          // On allumait « Article composé » et il ne se passait rien de
          // visible : l'onglet « Sous-articles » s'ajoutait à gauche pendant
          // que « Comptabilité » restait actif. Changer la clé remonte la barre
          // d'onglets, qui active alors le premier — « Sous-articles » quand
          // l'article est composé, le premier onglet restant sinon. Rien n'est
          // perdu : la nomenclature en cours de saisie vit dans le magasin du
          // formulaire, pas dans l'onglet.
          key={isComposed ? 'avec-sous-articles' : 'sans-sous-articles'}
          size="small"
          style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          items={[
            // Onglet Sous-articles (visible uniquement si article composé)
            ...(isComposed ? [{
              key: 'sub-articles',
              label: t('articleEditor.subArticles'),
              children: (
                <div style={{ overflow: 'auto' }}>
                  {/* ⚠️ PAS DE SECOND <Form form={form}> ICI.
                      Cet onglet vit DÉJÀ à l'intérieur du formulaire principal.
                      En rattachant une deuxième balise à la même instance, antd
                      remplaçait le onFinish du premier par celui-ci — qui n'en a
                      pas : le bouton « Enregistrer » devenait inerte dès qu'on
                      avait affiché l'onglet, sans requête, sans message, sans
                      erreur. Il était donc impossible d'enregistrer un article
                      composé. Un Form.List suffit, et se relie tout seul au
                      formulaire qui l'entoure. */}
                  <Form.List name="components">
                      {(fields, { add, remove }) => (
                        <div>
                          <Table
                            dataSource={fields.map((field) => ({ ...field, key: field.key }))}
                            pagination={false}
                            size="small"
                            bordered
                            locale={{ emptyText: t('articleEditor.noSubArticles') }}
                            columns={[
                              {
                                title: t('articleEditor.article'),
                                dataIndex: 'name',
                                render: (_: unknown, record: { name: number }) => (
                                  <Form.Item
                                    name={[record.name, 'child_id']}
                                    rules={[{ required: true, message: t('articleEditor.required') }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <Select
                                      showSearch
                                      placeholder={isLoadingAllArticles ? t('articleEditor.loading') : t('articleEditor.selectArticle')}
                                      optionFilterProp="label"
                                      style={{ width: '100%' }}
                                      loading={isLoadingAllArticles}
                                      options={availableArticles.map((a) => ({
                                        value: a.id,
                                        label: `${a.code} - ${a.name}`,
                                      }))}
                                      onChange={() => setTimeout(calculatePricesFromComponents, 100)}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: t('articleEditor.quantity'),
                                width: 100,
                                render: (_: unknown, record: { name: number }) => (
                                  <Form.Item
                                    name={[record.name, 'quantity']}
                                    rules={[{ required: true, message: t('articleEditor.required') }]}
                                    style={{ marginBottom: 0 }}
                                  >
                                    <InputNumber
                                      style={{ width: '100%' }}
                                      min={0.001}
                                      precision={3}
                                      placeholder={t('articleEditor.qtyShort')}
                                      onChange={() => setTimeout(calculatePricesFromComponents, 100)}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: '',
                                width: 50,
                                render: (_: unknown, record: { name: number }) => (
                                  <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => {
                                      remove(record.name)
                                      setTimeout(calculatePricesFromComponents, 100)
                                    }}
                                    size="small"
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({ quantity: 1 })}
                            style={{ width: '100%', marginTop: 8 }}
                            icon={<PlusOutlined />}
                            size="small"
                          >
                            {t('articleEditor.addSubArticle')}
                          </Button>
                        </div>
                      )}
                  </Form.List>
                </div>
              ),
            }] : []),
            // Onglet Stock (visible en mode edit + produit non composé avec gestion stock)
            ...(isEdit && documentId && canManageStock && stockManaged ? [{
              key: 'stock-levels',
              label: <span><InboxOutlined /> {t('articleEditor.stock')}</span>,
              children: (
                <div style={{ overflow: 'auto' }}>
                  <Table
                    dataSource={stockLevelsData?.data || []}
                    rowKey="id"
                    pagination={false}
                    size="small"
                    locale={{ emptyText: t('articleEditor.noStock') }}
                    columns={[
                      {
                        title: t('articleEditor.warehouse'),
                        key: 'warehouse',
                        render: (_: unknown, record: StockLevel) => record.warehouse?.name || '-',
                      },
                      {
                        title: t('articleEditor.qtyShort'),
                        dataIndex: 'quantity',
                        key: 'quantity',
                        width: 80,
                        render: (v: number) => v?.toFixed(2),
                      },
                      {
                        title: t('articleEditor.reserved'),
                        dataIndex: 'reserved_quantity',
                        key: 'reserved',
                        width: 80,
                        render: (v: number) => v?.toFixed(2),
                      },
                      {
                        title: t('articleEditor.availableShort'),
                        key: 'available',
                        width: 80,
                        render: (_: unknown, record: StockLevel) =>
                          ((record.quantity || 0) - (record.reserved_quantity || 0)).toFixed(2),
                      },
                      {
                        title: t('articleEditor.threshold'),
                        dataIndex: 'min_threshold',
                        key: 'min_threshold',
                        width: 60,
                        render: (v?: number) => v?.toFixed(0) || '-',
                      },
                      {
                        title: t('articleEditor.statusColumn'),
                        key: 'status',
                        width: 80,
                        render: (_: unknown, record: StockLevel) => {
                          // ⚠️ LE DISPONIBLE, PAS LA QUANTITÉ BRUTE — comme
                          // l'onglet Alertes et comme l'écran Stock. La même
                          // ligne portait un « OK » vert ici et une
                          // « Rupture » rouge là, avec sa colonne
                          // « Disponible » à 0,00 deux colonnes plus à gauche.
                          const dispo = (record.quantity || 0) - (record.reserved_quantity || 0)

                          if (dispo <= 0) return <Tag color="red">{t('articleEditor.statusOutOfStock')}</Tag>
                          if (record.min_threshold && dispo <= record.min_threshold) return <Tag color="orange">{t('articleEditor.statusLow')}</Tag>
                          return <Tag color="green">{t('articleEditor.statusOk')}</Tag>
                        },
                      },
                    ]}
                  />
                </div>
              ),
            }] : []),
            // Onglet Mouvements (visible en mode edit + produit non composé, grisé si pas de gestion stock)
            ...(isEdit && documentId && canManageStock ? [{
              key: 'movements',
              label: t('articleEditor.movements'),
              disabled: !stockManaged,
              children: (
                <div style={{ overflow: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      size="small"
                      onClick={() => {
                        movementForm.resetFields()
                        setMovementModalOpen(true)
                      }}
                    >
                      {t('articleEditor.addStockMovement')}
                    </Button>
                  </div>
                  <Table
                    dataSource={stockMovementsData?.data || []}
                    columns={movementColumns}
                    rowKey="id"
                    size="small"
                    loading={isLoadingMovements}
                    locale={{ emptyText: t('articleEditor.noMovements') }}
                    pagination={{
                      current: movementsPage,
                      pageSize: 10,
                      total: stockMovementsData?.pagination?.total_items || 0,
                      showSizeChanger: false,
                      size: 'small',
                      showTotal: (total) => t('articleEditor.movementsTotal', { count: total }),
                      onChange: (p) => setMovementsPage(p),
                    }}
                  />
                </div>
              ),
            }] : []),
            // Onglet Documents (visible en mode edit uniquement)
            ...(isEdit && documentId ? [{
              key: 'documents',
              label: t('articleEditor.documents'),
              children: (
                <div style={{ overflow: 'auto' }}>
                  <DocumentsSection
                    entityType="article"
                    entityId={documentId}
                    title={t('articleEditor.documents')}
                  />
                </div>
              ),
            }] : []),
            ...(canViewCompta ? [{
              key: 'compta',
              label: t('articleEditor.accounting'),
              children: (
                <div style={{ overflow: 'auto' }}>
                  <ArticleComptaTab articleId={documentId} />
                </div>
              ),
            }] : []),
          ]}
        />
      </div>

      <Modal
        title={t('articleEditor.addStockMovement')}
        open={movementModalOpen}
        onCancel={() => setMovementModalOpen(false)}
        onOk={() => movementForm.submit()}
        confirmLoading={createMovementMutation.isPending}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form
          form={movementForm}
          layout="vertical"
          onFinish={(values) => {
            createMovementMutation.mutate({
              article_id: documentId,
              warehouse_id: values.warehouse_id,
              type: values.type,
              quantity: values.quantity,
              reference: values.reference || undefined,
              notes: values.notes || undefined,
            })
          }}
        >
          <Form.Item
            name="type"
            label={t('articleEditor.movementType')}
            rules={[{ required: true, message: t('articleEditor.selectTypeRequired') }]}
          >
            <Select
              placeholder={t('articleEditor.selectType')}
              options={[
                { value: 'in', label: t('articleEditor.movementIn') },
                { value: 'out', label: t('articleEditor.movementOut') },
                { value: 'adjustment', label: t('articleEditor.movementAdjustment') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={t('articleEditor.quantity')}
            rules={[
              { required: true, message: t('articleEditor.enterQuantityRequired') },
              { type: 'number', min: 0.001, message: t('articleEditor.quantityMustBePositive', 'La quantité doit être supérieure à zéro.') },
            ]}
          >
            {/* ⚠️ PAS DE « min » SUR LE CHAMP LUI-MÊME.
                InputNumber remplace la saisie par le minimum dès la frappe : on
                tapait 0 ou -5, le champ affichait 0,001, la règle ne se
                déclenchait jamais et l'ERP enregistrait un millième d'unité en
                annonçant que tout allait bien. La saisie reste ce qu'elle est,
                et c'est la règle qui refuse — un refus vaut mieux qu'une
                correction en douce. */}
            <InputNumber style={{ width: '100%' }} precision={3} placeholder="0.00" />
          </Form.Item>
          <Form.Item
            name="warehouse_id"
            label={t('articleEditor.warehouse')}
            rules={[{ required: true, message: t('articleEditor.selectWarehouseRequired') }]}
          >
            <Select
              placeholder={t('articleEditor.selectWarehouse')}
              showSearch
              optionFilterProp="label"
              options={(warehousesData || []).map((w) => ({
                value: w.id,
                label: `${w.code} - ${w.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="reference" label={t('articleEditor.reference')}>
            <Input placeholder={t('articleEditor.referenceOptional')} />
          </Form.Item>
          <Form.Item name="notes" label={t('articleEditor.notes')}>
            <Input.TextArea rows={3} placeholder={t('articleEditor.notesOptional')} />
          </Form.Item>
        </Form>
      </Modal>
      </div>
    </div>
  )
}
