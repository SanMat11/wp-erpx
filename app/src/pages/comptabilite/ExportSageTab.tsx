import { Card, Button, DatePicker, Form, Checkbox, message, Table, Tag, Select } from 'antd'
import { CloudDownloadOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

export default function ExportSageTab() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const qc = useQueryClient()

  const { data: logs } = useQuery({ queryKey: ['compta.export-logs'], queryFn: () => comptaAPI.listExportLogs() })
  const { data: config } = useQuery({ queryKey: ['compta.config'], queryFn: () => comptaAPI.getConfig() })

  const exportMut = useMutation({
    mutationFn: async (v: any) => {
      // ⚠️ Le format doit être DIT. Le serveur sait produire un FEC ou un CSV
      // Sage, mais sans « format » il retombe sur son réglage — « fec » — que
      // rien n'expose à l'écran : la carte annonçait « Export vers sage100 »
      // pendant qu'on téléchargeait un FEC. La cible Sage et le format du
      // fichier sont deux notions différentes ; on demande donc la seconde.
      const resp = await comptaAPI.exportSage({
        date_debut: v.range[0].format('YYYY-MM-DD'),
        date_fin: v.range[1].format('YYYY-MM-DD'),
        only_validated: v.only_validated,
        format: v.format,
      })
      // Téléchargement du fichier
      const blob = resp.data as Blob
      const cd = resp.headers['content-disposition'] || ''
      const matchName = cd.match(/filename="?([^"]+)"?/)
      const filename = matchName ? matchName[1] : `export_${dayjs().format('YYYYMMDD_HHmmss')}.txt`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      // ⚠️ Combien d'écritures sont VRAIMENT parties.
      //
      // Une période sans écriture rend un fichier d'une seule ligne — son
      // en-tête — et l'écran annonçait quand même « Export téléchargé » en
      // vert. Le client remettait un fichier vide au cabinet sans le savoir.
      // Le serveur, lui, journalise déjà « Aucune écriture sur la période ».
      // On lit l'en-tête X-Amsbm-Ecritures dès qu'il existe ; à défaut, les deux
      // formats posent une ligne d'en-tête puis une ligne par écriture, ce qui
      // suffit à distinguer le fichier vide.
      const annonce = resp.headers['x-amsbm-ecritures']

      if (annonce !== undefined) {
        return Number(annonce)
      }

      const lignes = (await blob.text()).split(/\r?\n/).filter(l => l.trim() !== '')

      return Math.max(0, lignes.length - 1)
    },
    onSuccess: (ecritures: number) => {
      if (ecritures === 0) {
        message.warning(t('comptaExportSage.emptyPeriod', 'Aucune écriture sur la période : le fichier téléchargé est vide.'))
      } else {
        message.success(t('comptaExportSage.exportDownloaded'))
      }

      qc.invalidateQueries({ queryKey: ['compta.export-logs'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaExportSage.exportError'))),
  })

  return (
    <div>
      <Card title={t('comptaExportSage.exportTo', { target: config?.sage_target || t('comptaExportSage.notConfigured') })} style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{ only_validated: true, format: 'fec', range: [dayjs().startOf('month'), dayjs().endOf('month')] }}>
          <Form.Item name="range" label={t('comptaExportSage.period')} rules={[{ required: true }]}>
            <RangePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="format" label={t('comptaExportSage.format', 'Format')} rules={[{ required: true }]}>
            <Select
              style={{ width: 200 }}
              options={[
                { value: 'fec', label: t('comptaExportSage.formatFec', 'FEC normalisé (.txt)') },
                { value: 'sage', label: t('comptaExportSage.formatSage', 'CSV Sage (.csv)') },
              ]}
            />
          </Form.Item>
          <Form.Item name="only_validated" valuePropName="checked">
            <Checkbox>{t('comptaExportSage.onlyValidatedEntries')}</Checkbox>
          </Form.Item>
          <Button type="primary" icon={<CloudDownloadOutlined />} loading={exportMut.isPending}
            onClick={() => form.validateFields().then(v => exportMut.mutate(v)).catch(() => undefined)}>
            {t('common.export')}
          </Button>
        </Form>
      </Card>

      <Card title={t('comptaExportSage.exportHistory')}>
        <Table
          rowKey="id"
          dataSource={logs?.items || []}
          pagination={{ pageSize: 20 }}
          size="small"
          columns={[
            { title: t('common.date'), dataIndex: 'export_date', render: (d: string) => dayjs(d).format('DD/MM/YYYY HH:mm') },
            { title: t('comptaExportSage.target'), dataIndex: 'target' },
            { title: t('comptaExportSage.period'), render: (_: any, r: any) => r.date_debut && r.date_fin ? `${dayjs(r.date_debut).format('DD/MM/YYYY')} → ${dayjs(r.date_fin).format('DD/MM/YYYY')}` : '' },
            { title: t('comptaExportSage.entriesCount'), dataIndex: 'ecritures_count' },
            { title: t('comptaExportSage.file'), dataIndex: 'file_name' },
            { title: t('comptaExportSage.size'), dataIndex: 'file_size', render: (s: number) => s ? `${(s/1024).toFixed(1)} ${t('comptaExportSage.kb')}` : '' },
            { title: t('common.status'), dataIndex: 'status', render: (s: string) => <Tag color={s === 'success' ? 'green' : s === 'failed' ? 'red' : 'orange'}>{s}</Tag> },
            { title: t('comptaExportSage.errorColumn'), dataIndex: 'error_message', ellipsis: true },
          ]}
        />
      </Card>
    </div>
  )
}
