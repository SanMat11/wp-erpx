import { useState, useEffect } from 'react'
import { Modal, Table, Tag, Button, Checkbox, message, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { invoiceAPI } from '@/services/api'

export interface PendingReminder {
  invoice_id: string
  number: string
  client_name: string
  client_email: string
  due_date: string
  days_overdue: number
  remaining: number
  reminder_count: number
  next_level: number
  last_reminder_at?: string
}

function formatMoney(n: number): string {
  if (n === undefined || n === null || isNaN(n)) return '0,00'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR')
}

function levelTag(level: number, t: (key: string) => string) {
  if (level >= 3) return <Tag color="red">{t('paymentReminders.levels.formalNotice')}</Tag>
  if (level === 2) return <Tag color="orange">{t('paymentReminders.levels.second')}</Tag>
  return <Tag color="blue">{t('paymentReminders.levels.first')}</Tag>
}

export default function PaymentRemindersModal({
  open,
  reminders,
  onClose,
}: {
  open: boolean
  reminders: PendingReminder[]
  /** `nePlusAfficher` demande à ne plus proposer cette fenêtre à l'ouverture. */
  onClose: (nePlusAfficher?: boolean) => void
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [nePlusAfficher, setNePlusAfficher] = useState(false)

  // ⚠️ UNE MISE EN DEMEURE NE PART PAS D'UN CLIC DISTRAIT.
  //
  // Tout était coché d'avance, niveau 3 compris : la fenêtre s'ouvrant SEULE à
  // l'arrivée dans l'ERP, un seul clic sur le bouton principal expédiait des
  // mises en demeure à des clients. Les deux premiers niveaux restent cochés —
  // c'est le geste courant — la mise en demeure se coche à la main.
  useEffect(() => {
    if (open) {
      setSelected(reminders.filter((r) => r.next_level < 3).map((r) => r.invoice_id))
      setNePlusAfficher(false)
    }
  }, [open, reminders])

  const fermer = () => onClose(nePlusAfficher)

  const handleSend = async () => {
    if (selected.length === 0) {
      message.warning(t('paymentReminders.messages.selectAtLeastOne'))
      return
    }
    setSending(true)
    try {
      const res = await invoiceAPI.sendReminders(selected)
      // ⚠️ Le serveur rend « sent » et « failed » comme des TABLEAUX, et ne rend
      // aucun « total ». Comparer le tableau à un nombre était toujours faux :
      // même quand les trois relances partaient, l'écran affichait un envoi
      // partiel — et interpolait « [object Object] » dans le message.
      const sent: Array<{ id?: string; email?: string }> = res.data?.sent ?? []
      const failed: Array<{ id?: string; error?: string }> = res.data?.failed ?? []
      // Le total de référence est ce que l'utilisateur a demandé : une facture
      // que le serveur a sautée (introuvable) n'apparaît ni dans « sent » ni
      // dans « failed », et compter sent+failed la ferait disparaître du compte
      // rendu comme si elle avait été traitée.
      const total = selected.length
      if (failed.length === 0 && sent.length === total) {
        message.success(t('paymentReminders.messages.sentSuccess', { count: sent.length }))
      } else {
        // Le motif du premier échec vaut mieux qu'un compteur : c'est lui qui dit
        // s'il manque une adresse ou si la remise a été refusée.
        const motif = failed.find((f) => f.error)?.error
        message.warning(
          `${t('paymentReminders.messages.sentPartial', { sent: sent.length, total })}${motif ? ` — ${motif}` : ''}`,
          8
        )
      }
      fermer()
    } catch (err: any) {
      // Même remarque : l'enveloppe d'erreur du serveur nomme son motif
      // « message », « error » n'y figure pas.
      message.error(err?.response?.data?.message || err?.response?.data?.error || t('paymentReminders.messages.sendError'))
    } finally {
      setSending(false)
    }
  }

  const columns: ColumnsType<PendingReminder> = [
    { title: t('paymentReminders.columns.invoice'), dataIndex: 'number', key: 'number' },
    { title: t('paymentReminders.columns.client'), dataIndex: 'client_name', key: 'client_name' },
    { title: t('paymentReminders.columns.dueDate'), dataIndex: 'due_date', key: 'due_date', render: (v: string) => formatDate(v) },
    {
      title: t('paymentReminders.columns.overdue'),
      dataIndex: 'days_overdue',
      key: 'days_overdue',
      align: 'right',
      render: (v: number) => <span style={{ color: v >= 30 ? '#cf1322' : '#d46b08' }}>{t('paymentReminders.values.days', { count: v })}</span>,
    },
    {
      title: t('paymentReminders.columns.remaining'),
      dataIndex: 'remaining',
      key: 'remaining',
      align: 'right',
      render: (v: number) => `${formatMoney(v)} €`,
    },
    {
      title: t('paymentReminders.columns.reminders'),
      dataIndex: 'reminder_count',
      key: 'reminder_count',
      align: 'center',
      render: (v: number, r) =>
        v > 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('paymentReminders.values.sentCount', { count: v })}{r.last_reminder_at ? ` — ${formatDate(r.last_reminder_at)}` : ''}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('paymentReminders.values.never')}</Typography.Text>
        ),
    },
    { title: t('paymentReminders.columns.next'), dataIndex: 'next_level', key: 'next_level', render: (v: number) => levelTag(v, t) },
  ]

  return (
    <Modal
      title={t('paymentReminders.title')}
      open={open}
      onCancel={() => fermer()}
      width={900}
      // ⚠️ Un clic à côté ne referme pas cette fenêtre : elle s'ouvre seule à
      // l'arrivée, et un clic distrait sur le masque la faisait disparaître
      // jusqu'à la session suivante — les relances du jour avec elle. On sort
      // par « Plus tard », par la croix ou par Échap, c'est-à-dire exprès.
      maskClosable={false}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Checkbox checked={nePlusAfficher} onChange={(e) => setNePlusAfficher(e.target.checked)}>
            {t('paymentReminders.buttons.dontShowAgain', { defaultValue: 'Ne plus afficher à l\'ouverture' })}
          </Checkbox>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button key="later" onClick={() => fermer()}>
              {t('paymentReminders.buttons.later')}
            </Button>
            <Button key="send" type="primary" loading={sending} disabled={selected.length === 0} onClick={handleSend}>
              {t('paymentReminders.buttons.send', { count: selected.length })}
            </Button>
          </div>
        </div>
      }
    >
      <p style={{ color: '#666', marginBottom: 12 }}>
        {t('paymentReminders.intro')}
      </p>
      <Table
        size="small"
        rowKey="invoice_id"
        dataSource={reminders}
        columns={columns}
        pagination={false}
        scroll={{ y: 380 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as string[]),
        }}
      />
    </Modal>
  )
}
