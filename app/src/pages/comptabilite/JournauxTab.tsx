import { useState } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, Switch, message, Popconfirm } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'

export default function JournauxTab() {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form] = Form.useForm()
  const qc = useQueryClient()

  const typeLabels: Record<string, string> = {
    vente: t('comptaJournaux.typeVente'),
    achat: t('comptaJournaux.typeAchat'),
    banque: t('comptaJournaux.typeBanque'),
    caisse: t('comptaJournaux.typeCaisse'),
    od: t('comptaJournaux.typeOd'),
    an: t('comptaJournaux.typeAn'),
  }

  const { data, isLoading } = useQuery({ queryKey: ['compta.journaux'], queryFn: () => comptaAPI.listJournaux() })

  const createMut = useMutation({
    mutationFn: (v: any) => comptaAPI.createJournal(v),
    onSuccess: () => { message.success(t('comptaJournaux.createSuccess')); setModalOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['compta.journaux'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaJournaux.error'))),
  })
  const updateMut = useMutation({
    mutationFn: (v: any) => comptaAPI.updateJournal(editing.id, v),
    onSuccess: () => { message.success(t('comptaJournaux.updateSuccess')); setModalOpen(false); setEditing(null); qc.invalidateQueries({ queryKey: ['compta.journaux'] }) },
    // Seule des trois mutations à n'avoir aucun onError : un enregistrement
    // refusé refermait la modale sur rien du tout, sans un mot.
    onError: (e: any) => message.error(motifRefus(e, t('comptaJournaux.error'))),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => comptaAPI.deleteJournal(id),
    onSuccess: () => { message.success(t('comptaJournaux.deleteSuccess')); qc.invalidateQueries({ queryKey: ['compta.journaux'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaJournaux.error'))),
  })

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true) }}>{t('comptaJournaux.newJournal')}</Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={false}
        size="small"
        columns={[
          { title: t('comptaJournaux.colCode'), dataIndex: 'code', width: 100 },
          { title: t('comptaJournaux.colLibelle'), dataIndex: 'libelle' },
          { title: t('comptaJournaux.colType'), dataIndex: 'type', width: 120, render: (v: string) => typeLabels[v] || v },
          { title: t('comptaJournaux.colContrepartie'), dataIndex: 'compte_contrepartie', width: 130 },
          { title: t('comptaJournaux.colActif'), dataIndex: 'actif', width: 80, render: (v: boolean) => v ? t('common.yes') : t('common.no') },
          {
            title: t('common.actions'), width: 100,
            render: (_: any, rec: any) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(rec); form.setFieldsValue(rec); setModalOpen(true) }} />
                <Popconfirm title={t('comptaJournaux.deleteConfirm')} onConfirm={() => deleteMut.mutate(rec.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
              </Space>
            )
          }
        ]}
      />

      {/* ⚠️ .catch() : un champ obligatoire vide fait REJETER validateFields(),
          et le rejet non rattrapé partait en exception dans la console à chaque
          « OK » sur une modale vide. Le formulaire affiche déjà les champs
          fautifs ; il n'y a rien d'autre à en faire. */}
      <Modal title={editing ? t('comptaJournaux.editTitle') : t('comptaJournaux.newJournal')} open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then(v => editing ? updateMut.mutate(v) : createMut.mutate(v)).catch(() => undefined)}
        confirmLoading={createMut.isPending || updateMut.isPending}>
        <Form form={form} layout="vertical">
          {!editing && <Form.Item name="code" label={t('comptaJournaux.colCode')} rules={[{ required: true }]}><Input /></Form.Item>}
          <Form.Item name="libelle" label={t('comptaJournaux.colLibelle')} rules={[{ required: true }]}><Input /></Form.Item>
          {!editing && <Form.Item name="type" label={t('comptaJournaux.colType')} rules={[{ required: true }]}>
            <Select options={[
              { value: 'vente', label: t('comptaJournaux.typeVente') }, { value: 'achat', label: t('comptaJournaux.typeAchat') },
              { value: 'banque', label: t('comptaJournaux.typeBanque') }, { value: 'caisse', label: t('comptaJournaux.typeCaisse') },
              { value: 'od', label: t('comptaJournaux.typeOd') }, { value: 'an', label: t('comptaJournaux.typeAn') },
            ]} />
          </Form.Item>}
          <Form.Item name="compte_contrepartie" label={t('comptaJournaux.contrepartieLabel')}><Input /></Form.Item>
          {/* La colonne « Actif » s'affiche et le serveur répond « il peut être
              désactivé, pas supprimé » — mais aucun champ ne permettait de le
              désactiver : le conseil était sans suite. Seulement en modification :
              createJournal() pose actif = 1 sans lire la requête, un interrupteur
              à la création ne piloterait rien. */}
          {editing && (
            <Form.Item name="actif" label={t('comptaJournaux.actif')} valuePropName="checked"><Switch /></Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
