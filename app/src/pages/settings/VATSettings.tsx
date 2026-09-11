import { useEffect, useState } from 'react'
import { Table, Button, Modal, Form, Input, Select, InputNumber, Checkbox, message, Spin, Space, Popconfirm, Tag } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { CLE_TAUX_TVA, settingsAPI } from '@/services/api'
import { comptaAPI } from '@/services/comptaApi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { europeanCountries } from './CompanySettings'

interface VATRate {
  id: string
  direction: 'input' | 'output'
  code: string
  country_code: string
  label: string
  rate: number
  is_default: boolean
  compte_comptable: string
  created_at: string
  updated_at: string
}

export default function VATSettings() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const direction = Form.useWatch('direction', form)
  const queryClient = useQueryClient()
  const [modalVisible, setModalVisible] = useState(false)
  const [editingRate, setEditingRate] = useState<VATRate | null>(null)
  const [saving, setSaving] = useState(false)

  // Plan comptable (pour autocomplete compte_comptable, filtré par direction)
  const { data: comptes } = useQuery({
    queryKey: ['compta.comptes.full'],
    queryFn: () => comptaAPI.listComptes({ page_size: 500 }),
    staleTime: 5 * 60 * 1000,
  })
  // ⚠️ NE PAS CODER UN PLAN COMPTABLE DANS UN ÉCRAN.
  //
  // Le filtre était écrit en dur sur le plan français (4456x en amont, 4457x en
  // aval) : sur un plan luxembourgeois — celui des installations du client, où
  // la TVA vit en 461411/461412 — aucun compte ne passait, le menu restait
  // désespérément vide et le compte déjà enregistré sur un taux ne figurait
  // même pas dans les options qui auraient permis d'en changer.
  //
  // Le libellé est la seule chose portable d'un plan à l'autre : on garde les
  // comptes de TVA, on affine par direction quand le libellé le dit, et on
  // retombe sur la liste complète plutôt que sur « aucun compte » — mieux vaut
  // trop de choix que pas de choix du tout.
  const tousLesComptes: Array<{ value: string; label: string; recherche: string }> = (comptes?.items || []).map((c: any) => ({
    value: c.numero,
    label: `${c.numero} — ${c.libelle}`,
    recherche: `${c.numero} ${c.libelle}`.toUpperCase(),
  }))

  const comptesTVA = tousLesComptes.filter((c) => c.recherche.includes('TVA'))

  const motsDeLaDirection =
    direction === 'input'
      ? ['AMONT', 'DEDUCTIBLE', 'DÉDUCTIBLE', 'ACHAT']
      : direction === 'output'
        ? ['AVAL', 'COLLECTEE', 'COLLECTÉE', 'VENTE']
        : []

  const comptesDirection = comptesTVA.filter((c) =>
    motsDeLaDirection.some((mot) => c.recherche.includes(mot))
  )

  const compteOptions = (
    comptesDirection.length > 0
      ? comptesDirection
      : comptesTVA.length > 0
        ? comptesTVA
        : tousLesComptes
  ).map(({ value, label }) => ({ value, label }))

  // ⚠️ CET ÉCRAN N'EST PAS SEUL À ÉCRIRE DANS SES TAUX.
  //
  // Les onglets des Réglages sont ceux d'antd : une fois affiché, un onglet
  // reste MONTÉ. Le tableau se remplissait donc au premier coup d'œil et plus
  // jamais ensuite — pendant que l'onglet Société, lui, crée les taux du pays
  // qu'on vient de choisir. Le client voyait « 30 taux ajoutés », revenait ici,
  // et trouvait le tableau d'avant : il fallait recharger la page entière pour
  // que son propre travail apparaisse.
  //
  // La liste vit donc dans le cache partagé, sous une clé que TOUT écrivain
  // peut invalider — c'est ce que fait l'import de l'onglet Société.
  const { data: vatRates = [], isLoading: loading, isError } = useQuery({
    queryKey: CLE_TAUX_TVA,
    queryFn: async (): Promise<VATRate[]> => {
      const response = await settingsAPI.listVATRates()
      return response.data.vat_rates || []
    },
  })

  // Un tableau vide et un échec de lecture se ressemblent trop pour qu'on
  // laisse le second se taire : l'écran disait « aucun taux » quand la route
  // avait refusé.
  useEffect(() => {
    if (isError) {
      message.error(t('vatSettings.loadError'))
    }
  }, [isError, t])

  const loadVATRates = (): void => {
    void queryClient.invalidateQueries({ queryKey: CLE_TAUX_TVA })
  }

  const handleAdd = () => {
    setEditingRate(null)
    form.resetFields()
    form.setFieldsValue({
      direction: 'output',
      rate: 20,
      is_default: false,
    })
    setModalVisible(true)
  }

  const handleEdit = (rate: VATRate) => {
    setEditingRate(rate)
    form.setFieldsValue({
      direction: rate.direction,
      code: rate.code,
      country_code: rate.country_code,
      label: rate.label,
      rate: rate.rate,
      is_default: rate.is_default,
      compte_comptable: rate.compte_comptable || '',
    })
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await settingsAPI.deleteVATRate(id)
      message.success(t('vatSettings.deleteSuccess'))
      loadVATRates()
    } catch (error) {
      message.error(t('vatSettings.deleteError'))
    }
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      if (editingRate) {
        await settingsAPI.updateVATRate(editingRate.id, values)
        message.success(t('vatSettings.updateSuccess'))
      } else {
        await settingsAPI.createVATRate(values)
        message.success(t('vatSettings.createSuccess'))
      }
      setModalVisible(false)
      loadVATRates()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } }
      message.error(err.response?.data?.error || t('vatSettings.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<VATRate> = [
    {
      title: t('vatSettings.colDirection'),
      dataIndex: 'direction',
      key: 'direction',
      width: 100,
      sorter: (a, b) => a.direction.localeCompare(b.direction),
      render: (direction: string) => (
        <Tag color={direction === 'input' ? 'blue' : 'green'}>
          {direction === 'input' ? t('vatSettings.purchase') : t('vatSettings.sale')}
        </Tag>
      ),
      filters: [
        { text: t('vatSettings.purchase'), value: 'input' },
        { text: t('vatSettings.sale'), value: 'output' },
      ],
      onFilter: (value, record) => record.direction === value,
    },
    {
      title: t('vatSettings.colCode'),
      dataIndex: 'code',
      key: 'code',
      width: 120,
      sorter: (a, b) => a.code.localeCompare(b.code),
    },
    {
      title: t('vatSettings.colCountry'),
      dataIndex: 'country_code',
      key: 'country_code',
      width: 150,
      sorter: (a, b) => a.country_code.localeCompare(b.country_code),
      render: (code: string) => {
        const country = europeanCountries.find(c => c.code === code)
        return country ? country.name : code
      },
    },
    {
      title: t('vatSettings.colLabel'),
      dataIndex: 'label',
      key: 'label',
      sorter: (a, b) => a.label.localeCompare(b.label),
    },
    {
      title: t('vatSettings.colRate'),
      dataIndex: 'rate',
      key: 'rate',
      width: 100,
      sorter: (a, b) => a.rate - b.rate,
      defaultSortOrder: 'descend' as const,
      render: (rate: number) => `${rate}%`,
    },
    {
      title: t('vatSettings.colAccount'),
      dataIndex: 'compte_comptable',
      key: 'compte_comptable',
      width: 150,
      sorter: (a, b) => (a.compte_comptable || '').localeCompare(b.compte_comptable || ''),
      render: (v: string) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : <span style={{ color: '#aaa' }}>—</span>,
    },
    {
      title: t('vatSettings.colDefault'),
      dataIndex: 'is_default',
      key: 'is_default',
      width: 80,
      align: 'center',
      sorter: (a, b) => Number(b.is_default) - Number(a.is_default),
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
            title={t('vatSettings.deleteConfirm')}
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
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t('vatSettings.title')}</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          {t('vatSettings.addRate')}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={vatRates}
        rowKey="id"
        pagination={false}
        size="middle"
        locale={{ emptyText: t('vatSettings.emptyText') }}
      />

      <Modal
        title={editingRate ? t('vatSettings.modalEditTitle') : t('vatSettings.modalAddTitle')}
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
            name="direction"
            label={t('vatSettings.colDirection')}
            rules={[{ required: true, message: t('vatSettings.required') }]}
          >
            <Select>
              <Select.Option value="input">{t('vatSettings.purchase')}</Select.Option>
              <Select.Option value="output">{t('vatSettings.sale')}</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="code"
            label={t('vatSettings.colCode')}
            rules={[{ required: true, message: t('vatSettings.required') }]}
          >
            <Input placeholder="TVA20, TVA10, TVA5.5..." />
          </Form.Item>

          <Form.Item
            name="country_code"
            label={t('vatSettings.colCountry')}
            rules={[{ required: true, message: t('vatSettings.required') }]}
          >
            <Select
              placeholder={t('vatSettings.countryPlaceholder')}
              showSearch
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.children as unknown as string)?.toLowerCase().includes(input.toLowerCase())
              }
            >
              {europeanCountries.map(country => (
                <Select.Option key={country.code} value={country.code}>
                  {country.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="label"
            label={t('vatSettings.colLabel')}
            rules={[{ required: true, message: t('vatSettings.required') }]}
          >
            <Input placeholder={t('vatSettings.labelPlaceholder')} />
          </Form.Item>

          <Form.Item
            name="rate"
            label={t('vatSettings.colRate')}
            rules={[{ required: true, message: t('vatSettings.required') }]}
          >
            <InputNumber
              min={0}
              max={100}
              step={0.1}
              precision={2}
              style={{ width: '100%' }}
              addonAfter="%"
            />
          </Form.Item>

          <Form.Item
            name="compte_comptable"
            label={t('vatSettings.colAccount')}
            tooltip={direction === 'input' ? t('vatSettings.accountDeductible') : direction === 'output' ? t('vatSettings.accountCollected') : t('vatSettings.accountGeneral')}
          >
            <Select
              showSearch
              allowClear
              placeholder={direction === 'input' ? t('vatSettings.accountDeductible') : direction === 'output' ? t('vatSettings.accountCollected') : t('vatSettings.accountGeneral')}
              optionFilterProp="label"
              options={compteOptions}
              notFoundContent={comptes ? t('vatSettings.noAccount') : t('common.loading')}
            />
          </Form.Item>

          <Form.Item
            name="is_default"
            valuePropName="checked"
          >
            <Checkbox>{t('vatSettings.defaultForDirection')}</Checkbox>
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                {editingRate ? t('common.edit') : t('vatSettings.add')}
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
