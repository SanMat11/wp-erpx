import { useEffect, useState } from 'react'
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
  message,
  Spin,
  Tabs,
  Table,
  Tag,
  Card,
  Space,
  Divider,
  Upload,
  Select,
  Modal,
  Popconfirm,
} from 'antd'
import {
  SaveOutlined,
  HistoryOutlined,
  TeamOutlined,
  SettingOutlined,
  FileTextOutlined,
  FileDoneOutlined,
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  UploadOutlined,
  DownloadOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CloseOutlined,
} from '@ant-design/icons'
import { clientAPI, quoteAPI, invoiceAPI, documentAPI, vatAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'

interface ClientEditorProps {
  tabId: string
  documentId?: string
}

interface Contact {
  id?: string
  name: string
  role: string
  email: string
  phone: string
}

// Les lignes de contact vivent hors du formulaire antd : aucune règle ne s'y
// applique, alors que le courriel de la carte d'identité, lui, est vérifié.
// « pas-un-mail » partait donc en base tel quel et ne se découvrait qu'au
// premier envoi resté sans réponse.
const EMAIL_VALIDE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const emailContactFautif = (valeur?: string): boolean => {
  const saisie = (valeur || '').trim()

  return '' !== saisie && !EMAIL_VALIDE.test(saisie)
}

export default function ClientEditor({ tabId, documentId }: ClientEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const isEdit = !!documentId
  const { updateTabTitle, setTabDirty, openDocumentTab, setTabDocumentId, closeTab, getTab } = useDocumentTabsStore()
  const [contacts, setContacts] = useState<Contact[]>([])

  // ⚠️ ON NE QUITTE PLUS UNE FICHE MODIFIÉE SANS UN MOT.
  //
  // L'éditeur suivait l'état « modifié » (setTabDirty) et personne ne s'en
  // servait : la saisie disparaissait en silence. Il n'y avait d'ailleurs aucune
  // sortie — ni Annuler, ni Retour, ni Échap : la seule était de recliquer
  // « Clients » dans le menu de gauche, qui ne prévient toujours pas (voir le
  // relais écrit pour MainLayout / documentTabsStore).
  const handleClose = () => {
    const onglet = getTab(tabId)

    if (!onglet || 'document' !== onglet.type || !onglet.isDirty) {
      closeTab(tabId)

      return
    }

    Modal.confirm({
      title: t('clientEditor.unsavedTitle', 'Modifications non enregistrées'),
      content: t(
        'clientEditor.unsavedBody',
        'Cette fiche porte des modifications qui ne sont pas enregistrées. Fermer l’onglet les abandonnera.'
      ),
      okText: t('clientEditor.unsavedDiscard', 'Abandonner les modifications'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => closeTab(tabId),
    })
  }

  // Historique et GED : la pagination est celle du SERVEUR, pas un découpage de
  // ce qui a été rapporté. Les trois listes demandaient cent lignes et n'en
  // montraient que dix à la fois : au-delà de cent devis, cent factures ou cent
  // documents, le reste était invisible et rien ne le disait.
  const SOUS_TABLE_PAGE_SIZE = 10
  const [quotesPage, setQuotesPage] = useState(1)
  const [invoicesPage, setInvoicesPage] = useState(1)
  const [documentsPage, setDocumentsPage] = useState(1)

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', documentId],
    queryFn: async () => {
      const response = await clientAPI.get(documentId!)
      return response.data
    },
    enabled: isEdit,
  })

  // Le code d'une fiche neuve est un numéro d'ordre, pas une invention de
  // l'utilisateur : on le demande au serveur et on le pose dans le champ. Sans
  // cela, chacun tape le sien et deux fiches finissent par porter le même code —
  // que la base refuse, puisque la colonne est unique.
  const { data: nextCode } = useQuery({
    queryKey: ['clients', 'next-code'],
    queryFn: async () => {
      const response = await clientAPI.getNextCode()
      return String(response.data?.code || '')
    },
    enabled: !isEdit,
    staleTime: 0,
    gcTime: 0,
  })

  useEffect(() => {
    if (!isEdit && nextCode && !form.getFieldValue('code')) {
      form.setFieldsValue({ code: nextCode })
    }
  }, [isEdit, nextCode, form])

  // Fetch quotes for this client
  const { data: quotesData } = useQuery({
    queryKey: ['quotes', 'client', documentId, quotesPage],
    queryFn: async () => {
      const response = await quoteAPI.list({ client_id: documentId, page: quotesPage, page_size: SOUS_TABLE_PAGE_SIZE })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch invoices for this client
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', 'client', documentId, invoicesPage],
    queryFn: async () => {
      const response = await invoiceAPI.list({ client_id: documentId, type: 'client', page: invoicesPage, page_size: SOUS_TABLE_PAGE_SIZE })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch documents for this client
  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['documents', 'client', documentId, documentsPage],
    queryFn: async () => {
      const response = await documentAPI.list({ client_id: documentId, page: documentsPage, page_size: SOUS_TABLE_PAGE_SIZE })
      return response.data
    },
    enabled: isEdit,
  })

  const [uploadModalVisible, setUploadModalVisible] = useState(false)
  const [uploadCategory, setUploadCategory] = useState('other')
  const [uploadName, setUploadName] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)

  // VAT validation states
  const [vatValidating, setVatValidating] = useState(false)
  // ⚠️ TROIS RÉPONSES POSSIBLES, PAS DEUX. Le serveur distingue le numéro mal
  // formé (false), le verdict de VIES (true/false) et le service européen
  // injoignable (null). Typé « boolean », le null tombait du côté « invalide » :
  // une grosse croix rouge et « Numéro de TVA invalide » pour un numéro
  // parfaitement valable, simplement parce que VIES ne répondait pas.
  const [vatResult, setVatResult] = useState<{
    valid: boolean | null
    name?: string
    address?: string
    error?: string
  } | null>(null)
  const [vatModalVisible, setVatModalVisible] = useState(false)

  const handleUpload = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', uploadName || file.name)
    formData.append('category', uploadCategory)
    formData.append('description', uploadDescription)
    formData.append('client_id', documentId!)

    try {
      await documentAPI.upload(formData)
      message.success(t('clientEditor.documentUploaded'))
      setUploadModalVisible(false)
      setUploadName('')
      setUploadDescription('')
      setUploadCategory('other')
      refetchDocuments()
    } catch {
      message.error(t('clientEditor.uploadError'))
    } finally {
      setUploading(false)
    }
    return false
  }

  const handleDownload = async (doc: { id: string; original_name: string }) => {
    try {
      const response = await documentAPI.download(doc.id)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', doc.original_name)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      message.error(t('clientEditor.downloadError'))
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    try {
      await documentAPI.delete(docId)
      message.success(t('clientEditor.documentDeleted'))
      refetchDocuments()
    } catch {
      message.error(t('clientEditor.deleteError'))
    }
  }

  const handleValidateVat = async () => {
    const vatNumber = form.getFieldValue('tvaIntra')
    if (!vatNumber || vatNumber.trim() === '') {
      message.warning(t('clientEditor.vatNumberRequired'))
      return
    }

    setVatValidating(true)
    setVatResult(null)

    try {
      const response = await vatAPI.validate(vatNumber)
      const data = response.data
      setVatResult({
        // null tel quel : « on ne sait pas » n'est pas « non ».
        valid: data.valid === null || data.valid === undefined ? null : Boolean(data.valid),
        name: data.name,
        address: data.address,
        error: data.error,
      })
      setVatModalVisible(true)
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } }
      const errorMessage = error.response?.data?.error || t('clientEditor.validationError')
      message.error(errorMessage)
    } finally {
      setVatValidating(false)
    }
  }

  useEffect(() => {
    if (client) {
      updateTabTitle(tabId, client.name || t('clientEditor.clientTitleWithCode', { code: client.code }))
      form.setFieldsValue({
        code: client.code,
        name: client.name,
        email: client.email,
        phone: client.phone,
        mobile: client.mobile,
        addressLine1: client.address_line1,
        addressLine2: client.address_line2,
        postalCode: client.postal_code,
        city: client.city,
        country: client.country || 'France',
        siret: client.siret,
        tvaIntra: client.tva_intra,
        // ⚠️ « ?? » et non « || » : 0 est un délai de paiement parfaitement
        // valable — c'est le comptant. Avec « || », il était réaffiché à 30
        // jours, puis réenregistré à 30 : le comptant était impossible à saisir.
        paymentTerms: client.payment_terms ?? 30,
        notes: client.notes,
        isActive: client.is_active ?? true,
        // Le second rôle de la fiche, s'il en a un : c'est le seul endroit d'où
        // on puisse le lui retirer.
        isSupplier: client.is_supplier ?? false,
      })
      if (client.contacts) {
        setContacts(client.contacts)
      }
    }
  }, [client, form, tabId, updateTabTitle, t])

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => clientAPI.create(data),
    onSuccess: (response) => {
      message.success(t('clientEditor.clientCreated'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['clients'], refetchType: 'all' })
      if (response.data) {
        updateTabTitle(tabId, response.data.name || t('clientEditor.clientTitleWithCode', { code: response.data.code }))
        // Le code réellement attribué, reposé dans le champ : l'écran doit
        // montrer la fiche telle qu'elle est en base, pas telle qu'on l'a
        // demandée.
        if (response.data.code) {
          form.setFieldsValue({ code: response.data.code })
        }
        // ⚠️ L'ONGLET DOIT ADOPTER LA FICHE QU'IL VIENT DE CRÉER.
        //
        // Sans cela, documentId reste vide : le bouton « Enregistrer » repart
        // sur une création et fabrique une deuxième fiche à chaque clic (la
        // seconde recevant un code de série, le premier étant déjà pris). Au
        // passage, l'onglet cesse d'être « neuf », ce qui débloque l'Historique
        // et la GED, restés vides jusque-là.
        setTabDocumentId(tabId, String(response.data.id))
      }
    },
    // Le motif du refus vient du serveur (un code trop long, par exemple) :
    // « Erreur lors de la création » laisserait chercher au hasard.
    onError: (e: any) => {
      message.error(e?.message || t('clientEditor.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => clientAPI.update(documentId!, data),
    onSuccess: () => {
      message.success(t('clientEditor.clientUpdated'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['clients'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['client', documentId], refetchType: 'all' })
    },
    // Le motif du refus vient du serveur (un code déjà pris, par exemple) :
    // « Erreur » tout court laisserait chercher au hasard ce qui coince.
    onError: (e: any) => {
      message.error(e?.message || t('clientEditor.updateError'))
      // ⚠️ Le champ Code revient à sa valeur réelle. Après un refus, il gardait
      // le code refusé : la fiche affichait un code qui n'était pas le sien tant
      // qu'on ne la rechargeait pas, et on pouvait la quitter en le croyant posé.
      if (client?.code) {
        form.setFieldsValue({ code: client.code })
      }
    },
  })

  const handleValuesChange = () => {
    setTabDirty(tabId, true)
  }

  const onFinish = (values: Record<string, unknown>) => {
    // Refuser plutôt que d'enregistrer une adresse qui ne partira jamais.
    if (contacts.some((contact) => emailContactFautif(contact.email))) {
      message.error(t('clientEditor.contactEmailInvalid', "L'adresse électronique d'un contact n'est pas valide."))

      return
    }

    const data = {
      code: values.code,
      name: values.name,
      email: values.email || '',
      phone: values.phone || '',
      mobile: values.mobile || '',
      address_line1: values.addressLine1 || '',
      address_line2: values.addressLine2 || '',
      postal_code: values.postalCode || '',
      city: values.city || '',
      country: values.country || 'France',
      siret: values.siret || '',
      tva_intra: values.tvaIntra || '',
      // ⚠️ Voir plus haut : « || » renvoyait un comptant (0) à 30 jours au
      // moment même de l'enregistrement.
      payment_terms: values.paymentTerms ?? 30,
      notes: values.notes || '',
      is_active: values.isActive ?? true,
      // ⚠️ « is_supplier » est envoyé DEPUIS LA FICHE CLIENT, et le serveur
      // n'accepte d'ici que ce drapeau-là (Parties::write) : une fiche cliente
      // ne peut pas cesser d'être cliente sous les yeux de qui l'enregistre.
      is_supplier: values.isSupplier ?? false,
      contacts: contacts,
    }

    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const handleOpenQuote = (quote: unknown) => {
    const q = quote as { id: string; number: string }
    openDocumentTab('quote', q.id, t('clientEditor.quoteTabTitle', { number: q.number }))
  }

  const handleOpenInvoice = (invoice: unknown) => {
    const inv = invoice as { id: string; number: string }
    openDocumentTab('invoice', inv.id, t('clientEditor.invoiceTabTitle', { number: inv.number }))
  }

  const addContact = () => {
    setContacts([...contacts, { name: '', role: '', email: '', phone: '' }])
    setTabDirty(tabId, true)
  }

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index))
    setTabDirty(tabId, true)
  }

  const updateContact = (index: number, field: keyof Contact, value: string) => {
    const newContacts = [...contacts]
    newContacts[index] = { ...newContacts[index], [field]: value }
    setContacts(newContacts)
    setTabDirty(tabId, true)
  }

  const quoteColumns = [
    { title: t('clientEditor.number'), dataIndex: 'number', key: 'number', width: 120 },
    { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('clientEditor.subject'), dataIndex: 'subject', key: 'subject' },
    { title: t('clientEditor.amountHt'), dataIndex: 'total_ht', key: 'total_ht', width: 120,
      render: (v: number) => `${(v || 0).toFixed(2)} EUR` },
    { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const colors: Record<string, string> = {
          draft: 'default', sent: 'blue', accepted: 'green', refused: 'red', invoiced: 'purple'
        }
        const labels: Record<string, string> = {
          draft: t('clientEditor.quoteStatus.draft'),
          sent: t('clientEditor.quoteStatus.sent'),
          accepted: t('clientEditor.quoteStatus.accepted'),
          refused: t('clientEditor.quoteStatus.refused'),
          invoiced: t('clientEditor.quoteStatus.invoiced'),
        }
        return <Tag color={colors[status]}>{labels[status] || status}</Tag>
      }
    },
  ]

  const invoiceColumns = [
    { title: t('clientEditor.number'), dataIndex: 'number', key: 'number', width: 120 },
    { title: t('clientEditor.subject'), dataIndex: 'subject', key: 'subject', ellipsis: true },
    { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('clientEditor.dueDate'), dataIndex: 'due_date', key: 'due_date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('clientEditor.amountTtc'), dataIndex: 'total_ttc', key: 'total_ttc', width: 120,
      render: (v: number) => `${(v || 0).toFixed(2)} €` },
    { title: t('clientEditor.paid'), dataIndex: 'paid_amount', key: 'paid_amount', width: 100,
      render: (v: number) => `${(v || 0).toFixed(2)} €` },
    { title: t('clientEditor.balance'), key: 'balance', width: 100,
      render: (_: unknown, record: { total_ttc: number; paid_amount: number }) => {
        const balance = (record.total_ttc || 0) - (record.paid_amount || 0)
        return <span style={{ color: balance > 0 ? '#cf1322' : '#389e0d', fontWeight: 500 }}>{balance.toFixed(2)} €</span>
      }
    },
    { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const colors: Record<string, string> = {
          draft: 'default', sent: 'blue', partial: 'orange', paid: 'green', overdue: 'red', cancelled: 'default'
        }
        const labels: Record<string, string> = {
          draft: t('clientEditor.invoiceStatus.draft'),
          sent: t('clientEditor.invoiceStatus.sent'),
          partial: t('clientEditor.invoiceStatus.partial'),
          paid: t('clientEditor.invoiceStatus.paid'),
          overdue: t('clientEditor.invoiceStatus.overdue'),
          cancelled: t('clientEditor.invoiceStatus.cancelled'),
        }
        return <Tag color={colors[status]}>{labels[status] || status}</Tag>
      }
    },
  ]

  const contactColumns = [
    { title: t('common.name'), dataIndex: 'name', key: 'name',
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.name}
          onChange={(e) => updateContact(index, 'name', e.target.value)}
          placeholder={t('clientEditor.fullNamePlaceholder')}
        />
      )
    },
    { title: t('clientEditor.role'), dataIndex: 'role', key: 'role', width: 150,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.role}
          onChange={(e) => updateContact(index, 'role', e.target.value)}
          placeholder={t('clientEditor.role')}
        />
      )
    },
    { title: t('common.email'), dataIndex: 'email', key: 'email', width: 200,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.email}
          onChange={(e) => updateContact(index, 'email', e.target.value)}
          placeholder="email@exemple.com"
        />
      )
    },
    { title: t('clientEditor.phone'), dataIndex: 'phone', key: 'phone', width: 150,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.phone}
          onChange={(e) => updateContact(index, 'phone', e.target.value)}
          placeholder={t('clientEditor.phone')}
        />
      )
    },
    { title: '', key: 'action', width: 50,
      render: (_: unknown, __: unknown, index: number) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeContact(index)} />
      )
    },
  ]

  if (isEdit && isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  const historySubTabs = [
    {
      key: 'quotes',
      label: <span><FileTextOutlined /> {t('clientEditor.clientQuotes')}</span>,
      children: (
        <Table
          dataSource={quotesData?.data || []}
          columns={quoteColumns}
          rowKey="id"
          size="small"
          pagination={{
            current: quotesPage,
            pageSize: SOUS_TABLE_PAGE_SIZE,
            total: quotesData?.pagination?.totalItems || 0,
            onChange: setQuotesPage,
            showSizeChanger: false,
            showTotal: (total: number) => t('clientEditor.totalRows', { count: total, defaultValue: '{{count}} au total' }),
          }}
          onRow={(record) => ({
            onDoubleClick: () => handleOpenQuote(record),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: t('clientEditor.noQuote') }}
        />
      ),
    },
    {
      key: 'invoices',
      label: <span><FileDoneOutlined /> {t('clientEditor.clientInvoices')}</span>,
      children: (
        <Table
          dataSource={invoicesData?.data || []}
          columns={invoiceColumns}
          rowKey="id"
          size="small"
          pagination={{
            current: invoicesPage,
            pageSize: SOUS_TABLE_PAGE_SIZE,
            total: invoicesData?.pagination?.totalItems || 0,
            onChange: setInvoicesPage,
            showSizeChanger: false,
            showTotal: (total: number) => t('clientEditor.totalRows', { count: total, defaultValue: '{{count}} au total' }),
          }}
          onRow={(record) => ({
            onDoubleClick: () => handleOpenInvoice(record),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: t('clientEditor.noInvoice') }}
        />
      ),
    },
  ]

  const tabItems = [
    {
      key: 'history',
      label: <span><HistoryOutlined /> {t('clientEditor.history')}</span>,
      children: (
        <Tabs items={historySubTabs} size="small" />
      ),
    },
    {
      key: 'contacts',
      label: <span><TeamOutlined /> {t('clientEditor.staff')}</span>,
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Button type="dashed" icon={<PlusOutlined />} onClick={addContact}>
              {t('clientEditor.addContact')}
            </Button>
          </div>
          <Table
            dataSource={contacts.map((c, i) => ({ ...c, key: i }))}
            columns={contactColumns}
            rowKey="key"
            size="small"
            pagination={false}
            locale={{ emptyText: t('clientEditor.noContact') }}
          />
        </div>
      ),
    },
    {
      key: 'settings',
      label: <span><SettingOutlined /> {t('clientEditor.settings')}</span>,
      children: (
        <Row gutter={24}>
          <Col span={12}>
            <Card title={t('clientEditor.commercialConditions')} size="small">
              {/* ⚠️ « Remise par défaut (%) » a été RETIRÉE, ne pas la remettre
                  sans la chaîne complète derrière. Le champ existait à l'écran
                  seul : ni onFinish, ni write(), ni la table amsbm_partner ne le
                  connaissaient. La saisie disparaissait en silence, sous un
                  « Client enregistré ». Pour la rétablir : migration
                  discount_rate DECIMAL(6,3), prise en charge dans write() et
                  toJson, puis le champ ici. Idem « Envoyer les relances »
                  (send_reminders) dans la carte voisine. */}
              <Form.Item name="paymentTerms" label={t('clientEditor.paymentTerms')}>
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
          </Col>
          <Col span={12}>
            <Card title={t('clientEditor.parameters')} size="small">
              <Form.Item name="isActive" label={t('clientEditor.activeClient')} valuePropName="checked">
                <Switch />
              </Form.Item>
              {/* ⚠️ LE SECOND RÔLE DE LA FICHE, ET LE SEUL ENDROIT D'OÙ ON PUISSE
                  LE RETIRER.

                  Un tiers recevait le drapeau « fournisseur » par effet de bord
                  — un achat établi à son nom, une fiche ouverte par la mauvaise
                  route — et ne le perdait jamais : il restait pour toujours dans
                  la liste des fournisseurs et dans le sélecteur d'une facture
                  d'achat, sans que rien à l'écran ne le montre ni ne l'explique.
                  Le drapeau « client », lui, ne se retire pas d'ici : la fiche
                  disparaîtrait sous les yeux de qui l'enregistre. */}
              <Form.Item
                name="isSupplier"
                label={t('clientEditor.alsoSupplier', 'Ce tiers est aussi un fournisseur')}
                valuePropName="checked"
                extra={t(
                  'clientEditor.alsoSupplierHelp',
                  "Actif, la fiche apparaît aussi dans Fournisseurs et dans le choix d'une facture d'achat."
                )}
              >
                <Switch />
              </Form.Item>
              {/* ⚠️ « Envoyer les relances » retiré : voir la note de la carte
                  voisine. Le réglage n'existe nulle part côté serveur, et les
                  relances se pilotent aujourd'hui depuis Réglages > Notifications. */}
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'ged',
      label: <span><FolderOpenOutlined /> {t('clientEditor.ged')}</span>,
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
              {t('clientEditor.uploadDocument')}
            </Button>
          </div>
          <Table
            dataSource={documentsData?.data || []}
            rowKey="id"
            size="small"
            pagination={{
              current: documentsPage,
              pageSize: SOUS_TABLE_PAGE_SIZE,
              total: documentsData?.pagination?.totalItems || 0,
              onChange: setDocumentsPage,
              showSizeChanger: false,
              showTotal: (total: number) => t('clientEditor.totalRows', { count: total, defaultValue: '{{count}} au total' }),
            }}
            locale={{ emptyText: t('clientEditor.noDocument') }}
            columns={[
              { title: t('common.name'), dataIndex: 'name', key: 'name' },
              { title: t('clientEditor.file'), dataIndex: 'original_name', key: 'original_name', ellipsis: true },
              { title: t('clientEditor.category'), dataIndex: 'category', key: 'category', width: 120,
                render: (cat: string) => {
                  const labels: Record<string, string> = {
                    contract: t('clientEditor.docCategory.contract'),
                    invoice: t('clientEditor.docCategory.invoice'),
                    quote: t('clientEditor.docCategory.quote'),
                    report: t('clientEditor.docCategory.report'),
                    technical: t('clientEditor.docCategory.technical'),
                    legal: t('clientEditor.docCategory.legal'),
                    other: t('clientEditor.docCategory.other'),
                  }
                  return <Tag>{labels[cat] || cat}</Tag>
                }
              },
              { title: t('clientEditor.size'), dataIndex: 'size', key: 'size', width: 100,
                render: (size: number) => {
                  if (size < 1024) return `${size} o`
                  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`
                  return `${(size / (1024 * 1024)).toFixed(1)} Mo`
                }
              },
              { title: t('common.date'), dataIndex: 'created_at', key: 'created_at', width: 100,
                render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-'
              },
              { title: t('common.actions'), key: 'actions', width: 120,
                render: (_: unknown, record: { id: string; original_name: string }) => (
                  <Space>
                    <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(record)} />
                    <Popconfirm title={t('clientEditor.deleteDocumentConfirm')} onConfirm={() => handleDeleteDocument(record.id)} okText={t('common.yes')} cancelText={t('common.no')}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )
              },
            ]}
          />
        </div>
      ),
    },
  ]

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        onValuesChange={handleValuesChange}
        initialValues={{ country: 'France', paymentTerms: 30, isActive: true, isSupplier: false }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          padding: '0 8px',
        }}>
          <h2 style={{ margin: 0 }}>{isEdit ? (client?.name || t('clientEditor.client')) : t('clientEditor.newClient')}</h2>
          <Space>
            <Button icon={<CloseOutlined />} onClick={handleClose}>
              {t('common.close')}
            </Button>
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

        {/* Main Info */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={4}>
              <Form.Item
                name="code"
                label={t('clientEditor.code')}
                rules={[{ required: true, message: t('clientEditor.codeRequired') }]}
              >
                <Input placeholder="CLI001" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="name"
                label={t('common.name')}
                rules={[{ required: true, message: t('clientEditor.nameRequired') }]}
              >
                <Input placeholder={t('clientEditor.clientNamePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="phone" label={t('clientEditor.phone')}>
                <Input placeholder="01 23 45 67 89" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="mobile" label={t('clientEditor.mobile')}>
                <Input placeholder="06 12 34 56 78" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="email" label={t('common.email')} rules={[{ type: 'email', message: t('clientEditor.emailInvalid') }]}>
                <Input placeholder="email@exemple.com" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0' }} />

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="addressLine1" label={t('clientEditor.address')}>
                <Input placeholder={t('clientEditor.addressPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="addressLine2" label={t('clientEditor.addressComplement')}>
                <Input placeholder={t('clientEditor.addressComplementPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={3}>
              <Form.Item name="postalCode" label={t('clientEditor.postalCode')}>
                <Input placeholder="75001" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="city" label={t('clientEditor.city')}>
                <Input placeholder="Paris" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="country" label={t('clientEditor.country')}>
                <Input placeholder="France" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="siret" label={t('clientEditor.siret')}>
                <Input placeholder="123 456 789 00012" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="tvaIntra" label={t('clientEditor.vatIntra')}>
                <Input
                  placeholder="FR12345678901"
                  suffix={
                    <Button
                      type="text"
                      size="small"
                      icon={vatValidating ? <LoadingOutlined spin /> : <SearchOutlined />}
                      onClick={handleValidateVat}
                      disabled={vatValidating}
                      title={t('clientEditor.checkValidityVies')}
                      style={{ marginRight: -8 }}
                    />
                  }
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="notes" label={t('clientEditor.notes')}>
                <Input.TextArea rows={1} placeholder={t('clientEditor.internalNotesPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* ⚠️ LES RÉGLAGES SONT ACCESSIBLES DÈS LA CRÉATION.
            L'écran de création n'avait pas un seul interrupteur : ni « Délai de
            paiement », ni « Client actif ». Il fallait enregistrer, revenir à la
            liste et rouvrir la fiche par le crayon pour y accéder — alors que
            onFinish envoie ces deux valeurs depuis toujours, avec leur défaut.
            L'Historique et la GED, eux, n'ont rien à montrer d'une fiche qui
            n'existe pas encore : ils restent réservés à la modification. */}
        <Card size="small">
          <Tabs items={isEdit ? tabItems : tabItems.filter((item) => 'settings' === item.key)} />
        </Card>
      </Form>

      {/* Upload Modal */}
      <Modal
        title={t('clientEditor.uploadDocument')}
        open={uploadModalVisible}
        onCancel={() => setUploadModalVisible(false)}
        footer={null}
      >
        <Form layout="vertical">
          <Form.Item label={t('clientEditor.documentName')}>
            <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={t('clientEditor.documentName')} />
          </Form.Item>
          <Form.Item label={t('clientEditor.category')}>
            <Select value={uploadCategory} onChange={setUploadCategory}>
              <Select.Option value="contract">{t('clientEditor.docCategory.contract')}</Select.Option>
              <Select.Option value="invoice">{t('clientEditor.docCategory.invoice')}</Select.Option>
              <Select.Option value="quote">{t('clientEditor.docCategory.quote')}</Select.Option>
              <Select.Option value="report">{t('clientEditor.docCategory.report')}</Select.Option>
              <Select.Option value="technical">{t('clientEditor.docCategory.technical')}</Select.Option>
              <Select.Option value="legal">{t('clientEditor.docCategory.legal')}</Select.Option>
              <Select.Option value="other">{t('clientEditor.docCategory.other')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('common.description')}>
            <Input.TextArea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} placeholder={t('clientEditor.documentDescriptionPlaceholder')} />
          </Form.Item>
          <Form.Item>
            <Upload.Dragger
              accept="*"
              multiple={false}
              showUploadList={false}
              beforeUpload={handleUpload}
              disabled={uploading}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined style={{ fontSize: 32, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">{uploading ? t('clientEditor.uploadInProgress') : t('clientEditor.dragFileHere')}</p>
              <p className="ant-upload-hint">{t('clientEditor.allFileTypesAccepted')}</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      {/* VAT Validation Modal */}
      <Modal
        title={t('clientEditor.vatValidationTitle')}
        open={vatModalVisible}
        onCancel={() => setVatModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setVatModalVisible(false)}>
            {t('common.close')}
          </Button>
        ]}
      >
        {vatResult && (
          <div>
            <div style={{
              textAlign: 'center',
              marginBottom: 24,
              padding: 16,
              // Le verdict inconnu a sa propre couleur : orange, ni le vert du
              // valide ni le rouge de l'invalide.
              backgroundColor: vatResult.valid === true ? '#f6ffed' : vatResult.valid === false ? '#fff2f0' : '#fffbe6',
              borderRadius: 8,
              border: `1px solid ${vatResult.valid === true ? '#b7eb8f' : vatResult.valid === false ? '#ffccc7' : '#ffe58f'}`
            }}>
              {vatResult.valid === true ? (
                <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
              ) : vatResult.valid === false ? (
                <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              ) : (
                <ExclamationCircleOutlined style={{ fontSize: 48, color: '#faad14' }} />
              )}
              <div style={{ marginTop: 8, fontSize: 18, fontWeight: 500 }}>
                {vatResult.valid === true
                  ? t('clientEditor.vatValid')
                  : vatResult.valid === false
                    ? t('clientEditor.vatInvalid')
                    : t('clientEditor.vatUnknown', { defaultValue: 'Vérification impossible' })}
              </div>
            </div>

            {vatResult.error && (
              <div style={{ marginBottom: 16, color: vatResult.valid === false ? '#ff4d4f' : '#d48806' }}>
                {vatResult.error}
              </div>
            )}

            {vatResult.valid && vatResult.name && (
              <div style={{ marginBottom: 12 }}>
                <strong>{t('clientEditor.nameLabel')}</strong>
                <div style={{ marginTop: 4 }}>{vatResult.name}</div>
              </div>
            )}

            {vatResult.valid && vatResult.address && (
              <div>
                <strong>{t('clientEditor.addressLabel')}</strong>
                <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{vatResult.address}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
