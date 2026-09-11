import { useState } from 'react'
import { Table, Button, Modal, Form, Input, DatePicker, Space, Tag, message, Popconfirm, Alert } from 'antd'
import { PlusOutlined, LockOutlined, DeleteOutlined, UnlockOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import api from '@/services/api'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'

/**
 * Réouverture d'un exercice clos.
 *
 * ⚠️ L'appel ne passe pas par `comptaApi.ts` : ce fichier appartient à une
 * autre équipe et n'a pas encore la route. Il s'écrit donc ici, sur la même
 * instance axios que tout le reste — même base d'URL, même jeton, même
 * traitement des erreurs. À replier dans `comptaAPI` dès que possible.
 */
const rouvrirExercice = (id: string, motif: string) =>
  api.post(`/compta/exercices/${id}/reopen`, { motif }).then(r => r.data)

export default function ExercicesTab() {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  // L'exercice qu'on s'apprête à rouvrir, et le motif qu'on doit donner.
  const [aRouvrir, setARouvrir] = useState<any>(null)
  const [reopenForm] = Form.useForm()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({ queryKey: ['compta.exercices'], queryFn: () => comptaAPI.listExercices() })

  const createMut = useMutation({
    mutationFn: (v: any) => comptaAPI.createExercice({
      ...v, date_debut: v.date_debut.format('YYYY-MM-DD'), date_fin: v.date_fin.format('YYYY-MM-DD'),
    }),
    onSuccess: () => { message.success(t('comptaExercices.exerciceCreated')); setModalOpen(false); form.resetFields(); qc.invalidateQueries({ queryKey: ['compta.exercices'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaExercices.error'))),
  })
  const closeMut = useMutation({
    mutationFn: (id: string) => comptaAPI.closeExercice(id),
    onSuccess: () => { message.success(t('comptaExercices.exerciceClosed')); qc.invalidateQueries({ queryKey: ['compta.exercices'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaExercices.error'))),
  })
  // ⚠️ SANS onError, UN REFUS DU SERVEUR N'EXISTE PAS.
  //
  // La corbeille d'un exercice qui porte des écritures recevait un refus — 400,
  // « Cet exercice porte N écriture(s) : il ne peut pas être supprimé. » — et
  // l'écran ne bougeait pas d'un pixel : la ligne restait, aucun message, le
  // comptable croyait à un clic manqué et recommençait.
  const deleteMut = useMutation({
    mutationFn: (id: string) => comptaAPI.deleteExercice(id),
    onSuccess: () => { message.success(t('comptaExercices.exerciceDeleted')); qc.invalidateQueries({ queryKey: ['compta.exercices'] }) },
    onError: (e: any) => message.error(motifRefus(e, t('comptaExercices.error'))),
  })
  // ⚠️ UNE RÉOUVERTURE SE JUSTIFIE, SINON ELLE SE SUBIT.
  //
  // La route existe et range le motif dans la piste d'audit ; c'est exactement
  // ce qu'un contrôle vient chercher. L'écran le rend donc OBLIGATOIRE : rouvrir
  // un exercice clos défait une numérotation arrêtée, et « pourquoi » ne se
  // reconstitue pas six mois plus tard.
  //
  // Le refus « l'exercice suivant est clos, rouvrez-le d'abord » s'affiche tel
  // quel : il ne dit pas seulement non, il dit par où passer.
  const reopenMut = useMutation({
    mutationFn: ({ id, motif }: { id: string; motif: string }) => rouvrirExercice(id, motif),
    onSuccess: () => {
      message.success(t('comptaExercices.exerciceReopened', 'Exercice rouvert. La réouverture est consignée dans la piste d\'audit.'))
      setARouvrir(null)
      reopenForm.resetFields()
      qc.invalidateQueries({ queryKey: ['compta.exercices'] })
      qc.invalidateQueries({ queryKey: ['compta.ecritures'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaExercices.error'))),
  })

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>{t('comptaExercices.newExercice')}</Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items || []}
        pagination={false}
        size="small"
        columns={[
          { title: t('comptaExercices.colCode'), dataIndex: 'code', width: 100 },
          { title: t('comptaExercices.colLabel'), dataIndex: 'libelle' },
          { title: t('comptaExercices.colStart'), dataIndex: 'date_debut', render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
          { title: t('comptaExercices.colEnd'), dataIndex: 'date_fin', render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
          { title: t('common.status'), dataIndex: 'status', render: (s: string) => <Tag color={s === 'open' ? 'green' : 'red'}>{s === 'open' ? t('comptaExercices.statusOpen') : t('comptaExercices.statusClosed')}</Tag> },
          {
            title: t('common.actions'), width: 200,
            render: (_: any, rec: any) => (
              <Space>
                {rec.status === 'open' && (
                  <Popconfirm title={t('comptaExercices.closeConfirmTitle')} description={t('comptaExercices.closeConfirmDescription')}
                    onConfirm={() => closeMut.mutate(rec.id)}>
                    <Button size="small" icon={<LockOutlined />}>{t('comptaExercices.close')}</Button>
                  </Popconfirm>
                )}
                {rec.status === 'closed' && (
                  <Button size="small" icon={<UnlockOutlined />} onClick={() => { reopenForm.resetFields(); setARouvrir(rec) }}>
                    {t('comptaExercices.reopen', 'Rouvrir')}
                  </Button>
                )}
                {rec.status === 'open' && (
                  <Popconfirm title={t('comptaExercices.deleteConfirmTitle')} onConfirm={() => deleteMut.mutate(rec.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            )
          }
        ]}
      />

      {/* ⚠️ validateFields() REJETTE quand un champ obligatoire manque. Sans
          .catch(), le refus de validation part en exception non rattrapée dans
          la console à chaque « OK » sur une modale vide — les messages de champ
          s'affichent, mais l'application signale une erreur qui n'en est pas
          une. La liste des champs fautifs est déjà rendue par le formulaire :
          il n'y a rien à en faire ici. */}
      <Modal title={t('comptaExercices.newExercice')} open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={() => form.validateFields().then(v => createMut.mutate(v)).catch(() => undefined)} confirmLoading={createMut.isPending}>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label={t('comptaExercices.colCode')} rules={[{ required: true }]}><Input placeholder="2026" /></Form.Item>
          <Form.Item name="libelle" label={t('comptaExercices.colLabel')} rules={[{ required: true }]}><Input placeholder={t('comptaExercices.labelPlaceholder')} /></Form.Item>
          <Form.Item name="date_debut" label={t('comptaExercices.startDate')} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item>
          <Form.Item name="date_fin" label={t('comptaExercices.endDate')} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('comptaExercices.reopenTitle', 'Rouvrir un exercice clos')}
        open={null !== aRouvrir}
        onCancel={() => setARouvrir(null)}
        okText={t('comptaExercices.reopen', 'Rouvrir')}
        okButtonProps={{ danger: true }}
        cancelText={t('common.cancel')}
        confirmLoading={reopenMut.isPending}
        onOk={() => reopenForm.validateFields()
          .then(v => reopenMut.mutate({ id: aRouvrir.id, motif: v.motif }))
          .catch(() => undefined)}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={aRouvrir
            ? t('comptaExercices.reopenWarning', {
              code: aRouvrir.code,
              debut: dayjs(aRouvrir.date_debut).format('DD/MM/YYYY'),
              fin: dayjs(aRouvrir.date_fin).format('DD/MM/YYYY'),
              defaultValue: 'L\'exercice {{code}} ({{debut}} → {{fin}}) redeviendra modifiable.',
            })
            : ''}
          description={t('comptaExercices.reopenWarningDesc', 'Une clôture se défait du plus récent au plus ancien. La réouverture est nominative, datée, et consignée avec son motif dans la piste d\'audit.')}
        />
        <Form form={reopenForm} layout="vertical">
          <Form.Item
            name="motif"
            label={t('comptaExercices.reopenReason', 'Motif de la réouverture')}
            rules={[{ required: true, message: t('comptaExercices.reopenReasonRequired', 'Le motif est obligatoire : c\'est lui qui justifiera la réouverture lors d\'un contrôle.') }]}
          >
            <Input.TextArea rows={3} maxLength={255} showCount placeholder={t('comptaExercices.reopenReasonPlaceholder', 'Ex. : facture fournisseur reçue après la clôture, à comptabiliser sur l\'exercice.')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
