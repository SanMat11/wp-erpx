import { useEffect, useState } from 'react'
import { Form, Input, Select, InputNumber, Button, Card, message, DatePicker, Switch, Row, Col, Divider, Modal, Space, Alert, Popconfirm } from 'antd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import { motifRefus } from './comptaErreurs'
import dayjs from 'dayjs'
import ComptaParamsGrid from './ComptaParamsGrid'

export default function ComptaConfigTab() {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const [initModalOpen, setInitModalOpen] = useState(false)
  const [initForm] = Form.useForm()
  const qc = useQueryClient()

  const { data: config, isLoading } = useQuery({
    queryKey: ['compta.config'],
    queryFn: () => comptaAPI.getConfig(),
  })

  // Ce que la dernière génération automatique a réellement fait. Le serveur
  // les rend depuis qu'elle est branchée ; sans elles, l'écran ne pourrait que
  // promettre.
  const cronDernier = (config as { cron_last_run?: string } | undefined)?.cron_last_run ?? ''
  const cronCombien = Number((config as { cron_last_count?: number } | undefined)?.cron_last_count ?? 0)

  useEffect(() => {
    if (config) {
      form.setFieldsValue({
        ...config,
        date_demarrage: config.date_demarrage ? dayjs(config.date_demarrage) : null,
      })
    }
  }, [config, form])

  const updateMut = useMutation({
    mutationFn: (data: any) => comptaAPI.updateConfig(data),
    onSuccess: () => {
      message.success(t('comptaConfig.configSaved'))
      qc.invalidateQueries({ queryKey: ['compta.config'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaConfig.error'))),
  })

  const initMut = useMutation({
    mutationFn: (data: any) => comptaAPI.init(data),
    onSuccess: () => {
      message.success(t('comptaConfig.moduleInitialized'))
      setInitModalOpen(false)
      qc.invalidateQueries({ queryKey: ['compta.config'] })
      qc.invalidateQueries({ queryKey: ['compta.exercices'] })
      qc.invalidateQueries({ queryKey: ['compta.journaux'] })
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaConfig.error'))),
  })

  const testMut = useMutation({
    mutationFn: () => comptaAPI.testSage(),
    onSuccess: () => message.success(t('comptaConfig.sageConnectionOk')),
    onError: (e: any) => message.error(motifRefus(e, t('comptaConfig.connectionFailed'))),
  })

  const applyDefaultsMut = useMutation({
    mutationFn: (force: boolean) => comptaAPI.applyDefaultsToAllArticles(force),
    onSuccess: (r: any) => {
      message.success(
        t('comptaConfig.applyResultBase', { touched: r.articles_touched, inserted: r.params_inserted }) +
        (r.params_removed ? t('comptaConfig.applyResultRemoved', { removed: r.params_removed }) : '') +
        (r.articles_skipped ? t('comptaConfig.applyResultSkipped', { skipped: r.articles_skipped }) : '')
      )
    },
    onError: (e: any) => message.error(motifRefus(e, t('comptaConfig.error'))),
  })

  const onSave = () => {
    const v = form.getFieldsValue()
    const data: any = { ...v }
    if (v.date_demarrage) data.date_demarrage = v.date_demarrage.format('YYYY-MM-DD')
    updateMut.mutate(data)
  }

  if (isLoading) return <div>{t('common.loading')}</div>

  return (
    <div>
      {!config?.module_enabled && (
        <Alert
          type="info"
          showIcon
          message={t('comptaConfig.notInitializedTitle')}
          description={
            <Space direction="vertical">
              <span>{t('comptaConfig.notInitializedDesc')}</span>
              <Button type="primary" onClick={() => setInitModalOpen(true)}>{t('comptaConfig.initButton')}</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Card title={t('comptaConfig.sageTargetCard')}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sage_target" label={t('comptaConfig.sageTargetLabel')}>
                <Select options={[
                  { value: 'sage50', label: t('comptaConfig.sageTargetSage50') },
                  { value: 'sage100', label: t('comptaConfig.sageTargetSage100') },
                  { value: 'sage_cloud', label: t('comptaConfig.sageTargetSageCloud') },
                ]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="date_demarrage" label={t('comptaConfig.startDateLabel')}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="module_enabled" label={t('comptaConfig.moduleEnabledLabel')} valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">{t('comptaConfig.sageCloudDivider')}</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sage_cloud_client_id" label={t('comptaConfig.clientIdLabel')} extra={t('comptaConfig.leaveEmptyIfSet')}>
                <Input.Password placeholder={config?.has_cloud_credentials ? t('comptaConfig.alreadySetPlaceholder') : ''} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sage_cloud_client_secret" label={t('comptaConfig.clientSecretLabel')}>
                <Input.Password placeholder={config?.has_cloud_credentials ? t('comptaConfig.alreadySetPlaceholder') : ''} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sage_cloud_company_id" label={t('comptaConfig.companyIdLabel')}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sage_cloud_base_url" label={t('comptaConfig.baseUrlLabel')}>
                <Input placeholder="https://api.sageone.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label=" ">
                <Button onClick={() => testMut.mutate()} loading={testMut.isPending}>{t('comptaConfig.testConnection')}</Button>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">{t('comptaConfig.defaultAccountsDivider')}</Divider>
          <Row gutter={16}>
            <Col span={6}><Form.Item name="compte_client_default" label={t('comptaConfig.accountClient')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_fournisseur_default" label={t('comptaConfig.accountSupplier')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_vente_default" label={t('comptaConfig.accountSale')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_achat_default" label={t('comptaConfig.accountPurchase')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_banque_default" label={t('comptaConfig.accountBank')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_caisse_default" label={t('comptaConfig.accountCash')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_tva_collectee_default" label={t('comptaConfig.accountVatCollected')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="compte_tva_deductible_default" label={t('comptaConfig.accountVatDeductible')}><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="left">{t('comptaConfig.auxAccountsDivider')}</Divider>
          <Row gutter={16}>
            <Col span={6}><Form.Item name="prefix_client_aux" label={t('comptaConfig.prefixClient')}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="prefix_fournisseur_aux" label={t('comptaConfig.prefixSupplier')}><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="left">{t('comptaConfig.cronDivider')}</Divider>
          {/* ⚠️ CET AVERTISSEMENT A ÉTÉ VRAI, IL NE L'EST PLUS.
              Le réglage s'enregistrait et personne ne le lisait : aucune tâche
              planifiée ne le consultait, rien n'était jamais généré à l'heure
              dite, et l'écran le disait honnêtement. Le rendez-vous est
              désormais posé (AccountingService::syncSchedule, sur « init »).
              On montre donc ce qui s'est réellement passé plutôt qu'une
              promesse : un réglage qui annonce une génération nocturne doit
              pouvoir prouver qu'elle a eu lieu. */}
          {cronDernier ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('comptaConfig.cronLastRunTitle', 'Dernière génération automatique')}
              description={t('comptaConfig.cronLastRunDesc', {
                defaultValue: 'Le {{quand}} — {{count}} écriture(s) produite(s).',
                // ⚠️ CETTE HEURE N'EST PAS EN UTC, malgré les apparences.
                // Elle vient de current_time('mysql') — sans le second argument,
                // WordPress rend l'heure LOCALE DU SITE (Europe/Paris ici :
                // 14:30 enregistré pendant qu'il est 12:30 en UTC). La relire
                // comme de l'UTC puis la « convertir » ajoutait deux heures en
                // été à une heure déjà locale. On l'affiche telle qu'elle est
                // écrite, comme toutes les autres dates de ces écrans.
                quand: dayjs(cronDernier).format('DD/MM/YYYY [à] HH:mm'),
                count: cronCombien,
              })}
            />
          ) : (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('comptaConfig.cronNeverRunTitle', "La génération automatique n'a pas encore tourné.")}
              description={t(
                'comptaConfig.cronNeverRunDesc',
                "Elle se déclenche à l'heure indiquée, à condition que le site reçoive une visite : WordPress n'a pas d'horloge à lui. Sur un site peu fréquenté, une vraie tâche planifiée sur le serveur est plus sûre. En attendant, « Générer écritures » dans l'onglet Écritures fait le même travail à la demande."
              )}
            />
          )}
          <Row gutter={16}>
            <Col span={6}><Form.Item name="cron_enabled" label={t('comptaConfig.cronEnabledLabel')} valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="cron_hour" label={t('comptaConfig.cronHourLabel')}><InputNumber min={0} max={23} /></Form.Item></Col>
            <Col span={6}><Form.Item name="cron_minute" label={t('comptaConfig.cronMinuteLabel')}><InputNumber min={0} max={59} /></Form.Item></Col>
          </Row>

          <Button type="primary" onClick={onSave} loading={updateMut.isPending}>{t('common.save')}</Button>
        </Form>
      </Card>

      <div style={{ marginTop: 24 }}>
        <ComptaParamsGrid
          title={t('comptaConfig.defaultParamsTitle')}
          queryKey={['compta.defaultArticleParams']}
          fetcher={() => comptaAPI.listDefaultArticleParams()}
          saver={(params) => comptaAPI.replaceDefaultArticleParams(params)}
          editLevel="full"
          helpText={t('comptaConfig.defaultParamsHelp')}
        />
        <Card style={{ marginTop: 12 }} size="small">
          <Space direction="vertical" style={{ width: '100%' }}>
            <span><b>{t('comptaConfig.applyToExistingTitle')}</b></span>
            <Space wrap>
              <Popconfirm
                title={t('comptaConfig.applyMissingConfirmTitle')}
                description={t('comptaConfig.applyMissingConfirmDesc')}
                onConfirm={() => applyDefaultsMut.mutate(false)}
                okText={t('comptaConfig.applyOkText')}
              >
                <Button type="primary" loading={applyDefaultsMut.isPending}>
                  {t('comptaConfig.applyMissingButton')}
                </Button>
              </Popconfirm>
              <Popconfirm
                title={t('comptaConfig.resetAllConfirmTitle')}
                description={t('comptaConfig.resetAllConfirmDesc')}
                onConfirm={() => applyDefaultsMut.mutate(true)}
                okText={t('comptaConfig.resetAllOkText')}
                okButtonProps={{ danger: true }}
              >
                <Button danger loading={applyDefaultsMut.isPending}>
                  {t('comptaConfig.resetAllButton')}
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        </Card>
      </div>

      <Modal
        title={t('comptaConfig.initModalTitle')}
        open={initModalOpen}
        onCancel={() => setInitModalOpen(false)}
        // ⚠️ .catch() : un champ obligatoire vide fait REJETER validateFields(),
        // et le rejet non rattrapé partait en exception dans la console à chaque
        // « OK » sur une modale incomplète. Les champs fautifs sont déjà
        // signalés par le formulaire.
        onOk={() => {
          initForm.validateFields().then((v) => {
            const data = {
              ...v,
              exercice_date_debut: v.exercice_date_debut.format('YYYY-MM-DD'),
              exercice_date_fin: v.exercice_date_fin.format('YYYY-MM-DD'),
            }
            initMut.mutate(data)
          }).catch(() => undefined)
        }}
        confirmLoading={initMut.isPending}
        width={600}
      >
        <Form form={initForm} layout="vertical" initialValues={{
          plan_comptable: 'pcn_lu',
          exercice_code: String(new Date().getFullYear()),
          exercice_libelle: t('comptaConfig.exerciceDefaultLabel', { year: new Date().getFullYear() }),
          exercice_date_debut: dayjs().startOf('year'),
          exercice_date_fin: dayjs().endOf('year'),
          generate_aux_clients: true,
          generate_aux_suppliers: true,
        }}>
          <Form.Item name="plan_comptable" label={t('comptaConfig.planComptableLabel')} rules={[{ required: true }]}>
            <Select options={[
              { value: 'pcn_lu', label: t('comptaConfig.planPcnLu') },
              { value: 'pcg_fr', label: t('comptaConfig.planPcgFr') },
              { value: 'none', label: t('comptaConfig.planNone') },
            ]} />
          </Form.Item>
          <Row gutter={8}>
            <Col span={12}><Form.Item name="exercice_code" label={t('comptaConfig.exerciceCodeLabel')} rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="exercice_libelle" label={t('comptaConfig.exerciceLibelleLabel')} rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={8}>
            <Col span={12}><Form.Item name="exercice_date_debut" label={t('comptaConfig.dateStartLabel')} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item></Col>
            <Col span={12}><Form.Item name="exercice_date_fin" label={t('comptaConfig.dateEndLabel')} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" /></Form.Item></Col>
          </Row>
          <Form.Item name="generate_aux_clients" valuePropName="checked"><Switch /> <span style={{ marginLeft: 8 }}>{t('comptaConfig.generateAuxClients')}</span></Form.Item>
          <Form.Item name="generate_aux_suppliers" valuePropName="checked"><Switch /> <span style={{ marginLeft: 8 }}>{t('comptaConfig.generateAuxSuppliers')}</span></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
