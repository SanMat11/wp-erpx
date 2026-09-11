import { useEffect, useState } from 'react'
import { Table, Button, Input, Select, Space, message, Alert } from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { usePermissionStore } from '@/stores/permissionStore'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'

export interface ComptaParamRow {
  key: number
  type: 'achat' | 'vente'
  categorie: string
  compte_general: string
  libelle_compte: string
  section_analytique: string
  libelle_section: string
  code_tva: string
  libelle_tva: string
}

let nextKey = 1
const newRow = (type: 'achat' | 'vente' = 'vente'): ComptaParamRow => ({
  key: nextKey++, type,
  categorie: '', compte_general: '', libelle_compte: '',
  section_analytique: '', libelle_section: '',
  code_tva: '', libelle_tva: '',
})

interface Props {
  title: string
  queryKey: any[]
  fetcher: () => Promise<any>
  saver: (params: any[]) => Promise<any>
  /** Permission requise pour pouvoir éditer/sauver. Par défaut 'edit'. */
  editLevel?: 'edit' | 'full'
  /** Aide affichée sous le tableau */
  helpText?: string
}

export default function ComptaParamsGrid({ title, queryKey, fetcher, saver, editLevel = 'edit', helpText }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ComptaParamRow[]>([])
  const qc = useQueryClient()
  const canEdit = usePermissionStore((s) => editLevel === 'full' ? s.getPermissionLevel('compta') === 'full' : s.canEdit('compta'))

  const { data, isLoading } = useQuery({ queryKey, queryFn: fetcher })

  // Plan comptable pour autocomplete compte_general (limité à 500, suffisant pour la majorité des cas)
  const { data: comptes } = useQuery({
    queryKey: ['compta.comptes.full'],
    queryFn: () => comptaAPI.listComptes({ page_size: 500 }),
    staleTime: 5 * 60 * 1000,
  })
  // Codes TVA pour autocomplete — 2 listes distinctes selon le type de la ligne
  const { data: taxesAchat } = useQuery({
    queryKey: ['compta.taxes', 'achat'],
    queryFn: () => comptaAPI.listTaxes('achat'),
    staleTime: 5 * 60 * 1000,
  })
  const { data: taxesVente } = useQuery({
    queryKey: ['compta.taxes', 'vente'],
    queryFn: () => comptaAPI.listTaxes('vente'),
    staleTime: 5 * 60 * 1000,
  })

  const compteOptions = (comptes?.items || []).map((c: any) => ({
    value: c.numero,
    label: `${c.numero} — ${c.libelle}`,
    libelle: c.libelle,
  }))
  const taxeOptionsByType: Record<string, any[]> = {
    achat: (taxesAchat?.items || []).map((tax: any) => ({
      value: tax.code, label: `${tax.code} — ${tax.label} (${t('comptaParams.accountLabel')} ${tax.compte})`, libelle: tax.label,
    })),
    vente: (taxesVente?.items || []).map((tax: any) => ({
      value: tax.code, label: `${tax.code} — ${tax.label} (${t('comptaParams.accountLabel')} ${tax.compte})`, libelle: tax.label,
    })),
  }

  useEffect(() => {
    if (data?.items) {
      setRows(data.items.map((p: any) => ({
        key: nextKey++,
        type: p.type, categorie: p.categorie, compte_general: p.compte_general,
        libelle_compte: p.libelle_compte, section_analytique: p.section_analytique,
        libelle_section: p.libelle_section, code_tva: p.code_tva, libelle_tva: p.libelle_tva,
      })))
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: () => saver(rows.map(({ key, ...rest }) => rest)),
    onSuccess: () => {
      message.success(t('comptaParams.saved'))
      qc.invalidateQueries({ queryKey })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaParams.error'))),
  })

  const update = (key: number, field: keyof ComptaParamRow, value: any) => {
    setRows(rs => rs.map(r => r.key === key ? { ...r, [field]: value } : r))
  }
  /** Sélection d'un compte général dans l'autocomplete → auto-fill du libellé */
  const selectCompte = (key: number, numero: string) => {
    const found = compteOptions.find((o: any) => o.value === numero)
    setRows(rs => rs.map(r => r.key === key
      ? { ...r, compte_general: numero, libelle_compte: found?.libelle || r.libelle_compte }
      : r))
  }
  /** Sélection d'un code TVA dans l'autocomplete → auto-fill du libellé (selon le type de la ligne) */
  const selectTaxe = (key: number, type: string, code: string) => {
    const found = (taxeOptionsByType[type] || []).find((o: any) => o.value === code)
    setRows(rs => rs.map(r => r.key === key
      ? { ...r, code_tva: code, libelle_tva: found?.libelle || r.libelle_tva }
      : r))
  }
  /** Changement de type → reset du code TVA s'il ne correspond plus au nouveau type */
  const changeType = (key: number, type: 'achat' | 'vente') => {
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r
      const stillValid = (taxeOptionsByType[type] || []).some((o: any) => o.value === r.code_tva)
      return stillValid ? { ...r, type } : { ...r, type, code_tva: '', libelle_tva: '' }
    }))
  }
  const remove = (key: number) => setRows(rs => rs.filter(r => r.key !== key))

  return (
    <div style={{ background: '#fff' }}>
      <div style={{ background: '#1e3a5f', color: '#fff', padding: '10px 16px', fontSize: 14, fontWeight: 600 }}>
        {title}
      </div>
      <Table
        size="small"
        bordered
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        rowKey="key"
        locale={{ emptyText: t('comptaParams.emptyText') }}
        columns={[
          ...(canEdit ? [{
            title: '', width: 40, align: 'center' as const,
            render: (_: any, rec: ComptaParamRow) => <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => remove(rec.key)} />,
          }] : []),
          {
            title: t('comptaParams.colType'), width: 100,
            render: (_: any, rec: ComptaParamRow) => (
              <Select value={rec.type} onChange={v => changeType(rec.key, v)} style={{ width: '100%' }} disabled={!canEdit}
                options={[{ value: 'achat', label: t('comptaParams.purchase') }, { value: 'vente', label: t('comptaParams.sale') }]} />
            ),
          },
          {
            title: t('comptaParams.colCategory'),
            render: (_: any, rec: ComptaParamRow) => (
              <Input value={rec.categorie} onChange={e => update(rec.key, 'categorie', e.target.value)} placeholder={t('comptaParams.categoryPlaceholder')} disabled={!canEdit} />
            ),
          },
          {
            title: t('comptaParams.colGeneralAccount'), width: 220,
            render: (_: any, rec: ComptaParamRow) => (
              <Select
                value={rec.compte_general || undefined}
                showSearch
                allowClear
                placeholder={t('comptaParams.searchPlaceholder')}
                optionFilterProp="label"
                style={{ width: '100%' }}
                disabled={!canEdit}
                onChange={(v) => selectCompte(rec.key, v || '')}
                options={compteOptions}
              />
            ),
          },
          {
            title: t('comptaParams.colGeneralAccountLabel'),
            render: (_: any, rec: ComptaParamRow) => (
              <Input value={rec.libelle_compte} onChange={e => update(rec.key, 'libelle_compte', e.target.value)} placeholder={t('comptaParams.generalAccountLabelPlaceholder')} disabled={!canEdit} />
            ),
          },
          {
            title: t('comptaParams.colSection'), width: 100,
            render: (_: any, rec: ComptaParamRow) => (
              <Input value={rec.section_analytique} onChange={e => update(rec.key, 'section_analytique', e.target.value)} disabled={!canEdit} />
            ),
          },
          {
            title: t('comptaParams.colSectionLabel'),
            render: (_: any, rec: ComptaParamRow) => (
              <Input value={rec.libelle_section} onChange={e => update(rec.key, 'libelle_section', e.target.value)} disabled={!canEdit} />
            ),
          },
          {
            title: t('comptaParams.colVatCode'), width: 200,
            render: (_: any, rec: ComptaParamRow) => (
              <Select
                value={rec.code_tva || undefined}
                showSearch
                allowClear
                placeholder={rec.type === 'achat' ? t('comptaParams.vatCodePurchasePlaceholder') : t('comptaParams.vatCodeSalePlaceholder')}
                optionFilterProp="label"
                style={{ width: '100%' }}
                disabled={!canEdit}
                onChange={(v) => selectTaxe(rec.key, rec.type, v || '')}
                options={taxeOptionsByType[rec.type] || []}
              />
            ),
          },
          {
            title: t('comptaParams.colVatLabel'),
            render: (_: any, rec: ComptaParamRow) => (
              <Input value={rec.libelle_tva} onChange={e => update(rec.key, 'libelle_tva', e.target.value)} placeholder={t('comptaParams.vatLabelPlaceholder')} disabled={!canEdit} />
            ),
          },
        ]}
      />
      {canEdit && (
        <Space style={{ marginTop: 12 }}>
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => setRows(rs => [...rs, newRow('vente')])}>
            {t('comptaParams.addSaleRow')}
          </Button>
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => setRows(rs => [...rs, newRow('achat')])}>
            {t('comptaParams.addPurchaseRow')}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
            {t('common.save')}
          </Button>
        </Space>
      )}
      {!canEdit && (
        <Alert type="warning" message={t('comptaParams.readOnly')} style={{ marginTop: 12 }} showIcon />
      )}
      {helpText && <Alert type="info" message={helpText} style={{ marginTop: 16 }} showIcon />}
    </div>
  )
}
