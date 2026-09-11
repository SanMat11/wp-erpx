import { useMemo, useState } from 'react'
import { Table, Input, Button, Modal, Form, InputNumber, Select, Space, Switch, Tag, message, Popconfirm, Alert, Empty } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'

export default function PlanComptableTab() {
  const { t } = useTranslation()
  // Une seule table de libellés pour le tableau ET le formulaire : c'est la
  // divergence entre les deux qui laissait « general » et « both » à l'écran.
  const typeLabels: Record<string, string> = {
    general: t('comptaPlan.typeGeneral'),
    auxiliaire_client: t('comptaPlan.typeAuxClient'),
    auxiliaire_fournisseur: t('comptaPlan.typeAuxFournisseur'),
  }
  const sensLabels: Record<string, string> = {
    debit: t('comptaPlan.sensDebit'),
    credit: t('comptaPlan.sensCredit'),
    both: t('comptaPlan.sensMixte'),
  }
  const enOptions = (labels: Record<string, string>) =>
    Object.entries(labels).map(([value, label]) => ({ value, label }))
  const [search, setSearch] = useState('')
  const [classe, setClasse] = useState<number | undefined>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  // Un compte mouvementé ne se supprime pas — le serveur répond « il peut être
  // désactivé, pas supprimé ». Encore faut-il pouvoir le désactiver, et que le
  // geste serve à quelque chose : les comptes inactifs sortent des listes.
  const [afficherInactifs, setAfficherInactifs] = useState(false)
  const [form] = Form.useForm()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['compta.comptes', search, classe],
    queryFn: () => comptaAPI.listComptes({ search, classe, page_size: 500 }),
  })

  // ⚠️ Le filtre se fait ici, faute de mieux : listComptes ne sait pas encore
  // filtrer sur « actif ». À déplacer côté serveur le jour où la route
  // acceptera le paramètre, sans quoi un plan long tronqué par la limite
  // masquerait des comptes actifs.
  const comptes = useMemo(() => {
    const items = data?.items || []

    return afficherInactifs ? items : items.filter((c: any) => false !== c.actif)
  }, [data?.items, afficherInactifs])

  const createMut = useMutation({
    mutationFn: (v: any) => comptaAPI.createCompte(v),
    onSuccess: () => { message.success(t('comptaPlan.accountCreated')); setModalOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['compta.comptes'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaPlan.error'))),
  })
  const updateMut = useMutation({
    mutationFn: (v: any) => comptaAPI.updateCompte(editing.id, v),
    onSuccess: () => { message.success(t('comptaPlan.accountUpdated')); setModalOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ['compta.comptes'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaPlan.error'))),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => comptaAPI.deleteCompte(id),
    onSuccess: () => { message.success(t('comptaPlan.accountDeleted')); qc.invalidateQueries({ queryKey: ['compta.comptes'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaPlan.error'))),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ classe: 7, type: 'general', actif: true })
    setModalOpen(true)
  }
  const openEdit = (rec: any) => {
    setEditing(rec)
    form.setFieldsValue(rec)
    setModalOpen(true)
  }
  // ⚠️ .catch() obligatoire : validateFields() REJETTE quand un champ requis
  // manque, et le rejet non rattrapé partait en exception dans la console à
  // chaque « OK » sur une modale vide. Les messages de champ sont déjà à
  // l'écran, posés par le formulaire lui-même.
  const onSubmit = () => {
    form.validateFields().then(v => {
      if (editing) updateMut.mutate(v)
      else createMut.mutate(v)
    }).catch(() => undefined)
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input.Search placeholder={t('comptaPlan.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ width: 240 }} />
        <Select placeholder={t('comptaPlan.classe')} allowClear value={classe} onChange={setClasse} style={{ width: 120 }}
          options={[1,2,3,4,5,6,7,8].map(c => ({ value: c, label: t('comptaPlan.classeN', { n: c }) }))} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('comptaPlan.newAccount')}</Button>
        <Space size={8}>
          <Switch size="small" checked={afficherInactifs} onChange={setAfficherInactifs} />
          <span>{t('comptaPlan.showInactive', 'Afficher les comptes inactifs')}</span>
        </Space>
      </Space>

      {/* ⚠️ CE QUI N'EST PAS ARRIVÉ NE SE TRIE PAS ET NE SE CHERCHE PAS.
          La liste est ramenée d'un bloc — cinq cents comptes — puis paginée
          ici. Tant que le plan tient dans ce bloc, tout est exact ; au-delà, la
          page 25 n'existerait pas et la recherche ne verrait que le début du
          plan. Le serveur, lui, sait combien il y en a : on le dit plutôt que
          de laisser croire que le plan est complet. */}
      {(data?.total || 0) > (data?.items || []).length && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('comptaPlan.truncated', {
            shown: (data?.items || []).length,
            total: data?.total || 0,
            defaultValue: 'Plan tronqué : {{shown}} comptes affichés sur {{total}}. Affinez la recherche ou le filtre de classe pour voir les autres.',
          })}
        />
      )}

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={comptes}
        pagination={{ pageSize: 20, showTotal: (n: number) => t('comptaPlan.accountCount', { count: n, defaultValue: '{{count}} compte(s)' }) }}
        size="small"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                (data?.items || []).length > 0
                  ? t('comptaPlan.emptyInactive', 'Tous les comptes trouvés sont inactifs : activez « Afficher les comptes inactifs ».')
                  : t('comptaPlan.emptySearch', 'Aucun compte ne correspond à cette recherche.')
              }
            />
          ),
        }}
        columns={[
          { title: t('comptaPlan.numero'), dataIndex: 'numero', width: 100 },
          {
            title: t('comptaPlan.libelle'), dataIndex: 'libelle',
            render: (v: string, rec: any) => false === rec.actif
              ? <Space>{v}<Tag>{t('comptaPlan.inactif', 'Inactif')}</Tag></Space>
              : v,
          },
          { title: t('comptaPlan.classe'), dataIndex: 'classe', width: 80 },
          // Les colonnes rendaient le vocabulaire de la base — « general »,
          // « both » — alors que le formulaire du même écran connaît déjà les
          // libellés traduits.
          {
            title: t('comptaPlan.type'), dataIndex: 'type', width: 130,
            render: (v: string) => typeLabels[v] ?? v,
          },
          {
            title: t('comptaPlan.sens'), dataIndex: 'sens', width: 80,
            render: (v: string) => sensLabels[v] ?? v,
          },
          { title: t('comptaPlan.lettrable'), dataIndex: 'lettrable', width: 90, render: (v: boolean) => v ? t('common.yes') : '' },
          { title: t('comptaPlan.tvaPercent'), dataIndex: 'tva_rate', width: 80, render: (v: number) => v != null ? `${v}%` : '' },
          {
            title: t('common.actions'), width: 100, fixed: 'right' as const,
            render: (_: any, rec: any) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(rec)} />
                <Popconfirm title={t('comptaPlan.deleteConfirm')} onConfirm={() => deleteMut.mutate(rec.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />

      <Modal title={editing ? t('comptaPlan.editAccount') : t('comptaPlan.newAccount')} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={onSubmit} confirmLoading={createMut.isPending || updateMut.isPending}>
        <Form form={form} layout="vertical">
          {!editing && <Form.Item name="numero" label={t('comptaPlan.numero')} rules={[{ required: true }]}><Input /></Form.Item>}
          <Form.Item name="libelle" label={t('comptaPlan.libelle')} rules={[{ required: true }]}><Input /></Form.Item>
          {!editing && <Form.Item name="classe" label={t('comptaPlan.classe')} rules={[{ required: true }]}>
            <Select options={[1,2,3,4,5,6,7,8].map(c => ({ value: c, label: t('comptaPlan.classeN', { n: c }) }))} />
          </Form.Item>}
          {!editing && <Form.Item name="type" label={t('comptaPlan.type')}><Select options={enOptions(typeLabels)} /></Form.Item>}
          <Form.Item name="sens" label={t('comptaPlan.sens')}><Select allowClear options={enOptions(sensLabels)} /></Form.Item>
          <Form.Item name="lettrable" label={t('comptaPlan.lettrable')} valuePropName="checked"><input type="checkbox" /></Form.Item>
          <Form.Item name="tva_rate" label={t('comptaPlan.tvaRateLabel')}><InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} /></Form.Item>
          {/* Le serveur accepte déjà « actif » ; sans cette case, le message
              « il peut être désactivé, pas supprimé » renvoyait vers un geste
              qui n'existait nulle part dans l'application. */}
          <Form.Item name="actif" label={t('comptaPlan.actif', 'Compte actif')} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
