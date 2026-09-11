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
  ShoppingCartOutlined,
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
import { supplierAPI, purchaseOrderAPI, invoiceAPI, documentAPI, vatAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'

interface SupplierEditorProps {
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
// applique, alors que l'email de la carte d'identité, lui, est vérifié. Le
// serveur ne fait que nettoyer la chaîne — « pas-un-email » finissait donc en
// base tel quel, et ne se voyait qu'au premier envoi raté.
const EMAIL_VALIDE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const emailContactFautif = (valeur?: string): boolean => {
  const saisie = (valeur || '').trim()

  return '' !== saisie && !EMAIL_VALIDE.test(saisie)
}

export default function SupplierEditor({ tabId, documentId }: SupplierEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const isEdit = !!documentId
  const { updateTabTitle, setTabDirty, openDocumentTab, setTabDocumentId, closeTab, getTab } = useDocumentTabsStore()
  const [contacts, setContacts] = useState<Contact[]>([])

  // ⚠️ ON NE QUITTE PLUS UNE FICHE MODIFIÉE SANS UN MOT.
  //
  // L'éditeur n'offrait aucune sortie — ni Annuler, ni Retour, et Échap ne fait
  // rien — et la seule, recliquer « Fournisseurs » dans le menu, perdait la
  // saisie en silence. Ce bouton donne la sortie et l'avertissement. Le clic
  // dans le menu de gauche, lui, reste à couvrir (relais écrit pour MainLayout
  // et documentTabsStore).
  const handleClose = () => {
    const onglet = getTab(tabId)

    if (!onglet || 'document' !== onglet.type || !onglet.isDirty) {
      closeTab(tabId)

      return
    }

    Modal.confirm({
      title: t('supplierEditor.unsavedTitle', 'Modifications non enregistrées'),
      content: t(
        'supplierEditor.unsavedBody',
        'Cette fiche porte des modifications qui ne sont pas enregistrées. Fermer l’onglet les abandonnera.'
      ),
      okText: t('supplierEditor.unsavedDiscard', 'Abandonner les modifications'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: () => closeTab(tabId),
    })
  }

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', documentId],
    queryFn: async () => {
      const response = await supplierAPI.get(documentId!)
      return response.data
    },
    enabled: isEdit,
  })

  // Le code d'une fiche neuve est un numéro d'ordre, pas une invention de
  // l'utilisateur : on le demande au serveur et on le pose dans le champ. Sans
  // cela, chacun tape le sien et deux fiches finissent par porter le même code —
  // que la base refuse, puisque la colonne est unique.
  const { data: nextCode } = useQuery({
    queryKey: ['suppliers', 'next-code'],
    queryFn: async () => {
      const response = await supplierAPI.getNextCode()
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

  // Fetch purchase orders for this supplier
  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders', 'supplier', documentId],
    queryFn: async () => {
      const response = await purchaseOrderAPI.list({ supplier_id: documentId, page: 1, page_size: 100 })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch invoices for this supplier
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', 'supplier', documentId],
    queryFn: async () => {
      const response = await invoiceAPI.list({ supplier_id: documentId, type: 'supplier', page: 1, page_size: 100 })
      return response.data
    },
    enabled: isEdit,
  })

  // Fetch documents for this supplier
  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['documents', 'supplier', documentId],
    queryFn: async () => {
      const response = await documentAPI.list({ supplier_id: documentId, page: 1, page_size: 100 })
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
  // ⚠️ VIES A TROIS RÉPONSES, PAS DEUX : oui, non, et « je n'ai pas pu joindre ».
  //
  // Quand le service européen ne répond pas, le serveur rend valid = null avec
  // le motif. `null` étant falsy, la modale affichait une grosse croix rouge
  // « Numéro de TVA invalide » juste au-dessus du message qui disait exactement
  // le contraire — de quoi faire refuser un fournisseur parfaitement en règle.
  const [vatResult, setVatResult] = useState<{
    valid: boolean | null
    name?: string
    address?: string
    error?: string
  } | null>(null)
  const [vatModalVisible, setVatModalVisible] = useState(false)
  const vatIndetermine = null !== vatResult && null === vatResult.valid
  const vatValide = true === vatResult?.valid

  const handleUpload = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', uploadName || file.name)
    formData.append('category', uploadCategory)
    formData.append('description', uploadDescription)
    formData.append('supplier_id', documentId!)

    try {
      await documentAPI.upload(formData)
      message.success(t('supplierEditor.messages.documentUploaded'))
      setUploadModalVisible(false)
      setUploadName('')
      setUploadDescription('')
      setUploadCategory('other')
      refetchDocuments()
    } catch (e: any) {
      // Le serveur dit lequel des trois refus s'applique — type de fichier
      // interdit, pièce trop lourde, écriture impossible. Un « Erreur lors du
      // téléchargement » sans motif laissait recommencer indéfiniment.
      message.error(e?.message || t('supplierEditor.messages.uploadError'))
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
      message.error(t('supplierEditor.messages.downloadError'))
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    try {
      await documentAPI.delete(docId)
      message.success(t('supplierEditor.messages.documentDeleted'))
      refetchDocuments()
    } catch {
      message.error(t('supplierEditor.messages.deleteError'))
    }
  }

  const handleValidateVat = async () => {
    const vatNumber = form.getFieldValue('tvaIntra')
    if (!vatNumber || vatNumber.trim() === '') {
      message.warning(t('supplierEditor.messages.vatRequired'))
      return
    }

    setVatValidating(true)
    setVatResult(null)

    try {
      const response = await vatAPI.validate(vatNumber)
      const data = response.data
      setVatResult({
        // Tout ce qui n'est pas franchement vrai ou faux vaut « indéterminé ».
        valid: 'boolean' === typeof data.valid ? data.valid : null,
        name: data.name,
        address: data.address,
        error: data.error,
      })
      setVatModalVisible(true)
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } }
      const errorMessage = error.response?.data?.error || t('supplierEditor.messages.vatValidationError')
      message.error(errorMessage)
    } finally {
      setVatValidating(false)
    }
  }

  useEffect(() => {
    if (supplier) {
      updateTabTitle(tabId, supplier.name || t('supplierEditor.defaultTitle', { code: supplier.code }))
      form.setFieldsValue({
        code: supplier.code,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
        mobile: supplier.mobile,
        addressLine1: supplier.address_line1,
        addressLine2: supplier.address_line2,
        postalCode: supplier.postal_code,
        city: supplier.city,
        country: supplier.country || 'France',
        siret: supplier.siret,
        tvaIntra: supplier.tva_intra,
        // ⚠️ `??` ET NON `||` : 0 jour, c'est le paiement comptant.
        // Avec `||`, un délai de 0 — valeur que le serveur sait pourtant
        // traiter et libeller « Comptant » — se réaffichait à 30 jours, puis
        // repartait à 30 jours à l'enregistrement (voir onFinish). Le comptant
        // était littéralement inatteignable depuis l'écran.
        paymentTerms: supplier.payment_terms ?? 30,
        notes: supplier.notes,
        isActive: supplier.is_active ?? true,
        // Le second rôle de la fiche, s'il en a un : c'est le seul endroit d'où
        // on puisse le lui retirer.
        isCustomer: supplier.is_customer ?? false,
      })
      if (supplier.contacts) {
        setContacts(supplier.contacts)
      }
    }
  }, [supplier, form, tabId, updateTabTitle])

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => supplierAPI.create(data),
    onSuccess: (response) => {
      message.success(t('supplierEditor.messages.created'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['suppliers'], refetchType: 'all' })
      if (response.data) {
        updateTabTitle(tabId, response.data.name || t('supplierEditor.defaultTitle', { code: response.data.code }))
      }
      // ⚠️ L'ONGLET DOIT BASCULER EN MODIFICATION, SINON ON CRÉE DEUX FICHES.
      //
      // Sans cela, documentId restait vide : un second clic sur « Enregistrer »
      // repassait par la création et fabriquait un deuxième fournisseur, sous
      // un code voisin, sans que rien à l'écran ne le signale. On repose aussi
      // le code rendu par le serveur, qui n'est pas forcément celui qu'on avait
      // demandé.
      if (response.data?.id) {
        setTabDocumentId(tabId, response.data.id)
      }
      if (response.data?.code) {
        form.setFieldsValue({ code: response.data.code })
      }
    },
    // Le serveur dit précisément ce qui coince — un nom vide, un code trop
    // long : le taire obligeait à chercher au hasard.
    onError: (e: any) => {
      message.error(e?.message || t('supplierEditor.messages.createError'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => supplierAPI.update(documentId!, data),
    onSuccess: () => {
      message.success(t('supplierEditor.messages.updated'))
      setTabDirty(tabId, false)
      queryClient.invalidateQueries({ queryKey: ['suppliers'], refetchType: 'all' })
      queryClient.invalidateQueries({ queryKey: ['supplier', documentId], refetchType: 'all' })
    },
    // Le motif du refus vient du serveur (un code déjà pris, par exemple) :
    // « Erreur » tout court laisserait chercher au hasard ce qui coince.
    onError: (e: any) => {
      message.error(e?.message || t('supplierEditor.messages.updateError'))
      // ⚠️ Le champ Code revient à sa valeur réelle. Après un refus, il gardait
      // le code refusé : la fiche affichait « FOU0001 » alors qu'elle était
      // restée FOU0010, et on pouvait la quitter en le croyant posé.
      if (supplier?.code) {
        form.setFieldsValue({ code: supplier.code })
      }
    },
  })

  const handleValuesChange = () => {
    setTabDirty(tabId, true)
  }

  const onFinish = (values: Record<string, unknown>) => {
    // Refuser plutôt que d'enregistrer une adresse qui ne partira jamais.
    if (contacts.some((contact) => emailContactFautif(contact.email))) {
      message.error(t('supplierEditor.validation.contactEmailInvalid', "L'adresse électronique d'un contact n'est pas valide."))

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
      // ⚠️ `??` : 0 jour est un délai valide (comptant), pas une absence.
      payment_terms: values.paymentTerms ?? 30,
      notes: values.notes || '',
      is_active: values.isActive ?? true,
      // ⚠️ « is_customer » est envoyé DEPUIS LA FICHE FOURNISSEUR, et le serveur
      // n'accepte d'ici que ce drapeau-là (Parties::write) : une fiche
      // fournisseur ne peut pas cesser de l'être sous les yeux de qui
      // l'enregistre.
      is_customer: values.isCustomer ?? false,
      contacts: contacts,
    }

    if (isEdit) {
      updateMutation.mutate(data)
    } else {
      createMutation.mutate(data)
    }
  }

  const handleOpenPurchaseOrder = (order: unknown) => {
    const o = order as { id: string; number: string }
    openDocumentTab('purchase-order', o.id, t('supplierEditor.orderTabTitle', { number: o.number }))
  }

  const handleOpenInvoice = (invoice: unknown) => {
    const inv = invoice as { id: string; number: string }
    // ⚠️ « supplier-invoice », et non « invoice » : nous sommes dans l'historique
    // d'un FOURNISSEUR. Avec « invoice », l'application ouvrait l'éditeur de
    // facture client, et la même facture ouverte depuis les deux écrans donnait
    // deux onglets modifiables — dernier enregistrement gagnant.
    openDocumentTab('supplier-invoice', inv.id, t('supplierEditor.invoiceTabTitle', { number: inv.number }))
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

  const purchaseOrderColumns = [
    { title: t('supplierEditor.columns.number'), dataIndex: 'number', key: 'number', width: 120 },
    { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('supplierEditor.columns.reference'), dataIndex: 'reference', key: 'reference' },
    { title: t('supplierEditor.columns.amountHt'), dataIndex: 'total_ht', key: 'total_ht', width: 120,
      render: (v: number) => `${(v || 0).toFixed(2)} €` },
    { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const colors: Record<string, string> = {
          draft: 'default', confirmed: 'blue', partial: 'orange', received: 'green', cancelled: 'red'
        }
        const labels: Record<string, string> = {
          draft: t('supplierEditor.orderStatus.draft'),
          confirmed: t('supplierEditor.orderStatus.confirmed'),
          partial: t('supplierEditor.orderStatus.partial'),
          received: t('supplierEditor.orderStatus.received'),
          cancelled: t('supplierEditor.orderStatus.cancelled'),
        }
        return <Tag color={colors[status]}>{labels[status] || status}</Tag>
      }
    },
  ]

  const invoiceColumns = [
    { title: t('supplierEditor.columns.number'), dataIndex: 'number', key: 'number', width: 120 },
    { title: t('supplierEditor.columns.subject'), dataIndex: 'subject', key: 'subject', ellipsis: true },
    { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('supplierEditor.columns.dueDate'), dataIndex: 'due_date', key: 'due_date', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleDateString('fr-FR') : '-' },
    { title: t('supplierEditor.columns.amountTtc'), dataIndex: 'total_ttc', key: 'total_ttc', width: 120,
      render: (v: number) => `${(v || 0).toFixed(2)} €` },
    { title: t('supplierEditor.columns.paid'), dataIndex: 'paid_amount', key: 'paid_amount', width: 100,
      render: (v: number) => `${(v || 0).toFixed(2)} €` },
    { title: t('supplierEditor.columns.balance'), key: 'balance', width: 100,
      render: (_: unknown, record: { total_ttc: number; paid_amount: number }) => {
        const balance = (record.total_ttc || 0) - (record.paid_amount || 0)
        return <span style={{ color: balance > 0 ? '#cf1322' : '#389e0d', fontWeight: 500 }}>{balance.toFixed(2)} €</span>
      }
    },
    { title: t('common.status'), dataIndex: 'status', key: 'status', width: 100,
      render: (status: string) => {
        const colors: Record<string, string> = {
          draft: 'default', sent: 'blue', received: 'blue', partial: 'orange', paid: 'green', overdue: 'red', cancelled: 'default'
        }
        const labels: Record<string, string> = {
          draft: t('supplierEditor.invoiceStatus.draft'),
          sent: t('supplierEditor.invoiceStatus.sent'),
          received: t('supplierEditor.invoiceStatus.received'),
          partial: t('supplierEditor.invoiceStatus.partial'),
          paid: t('supplierEditor.invoiceStatus.paid'),
          overdue: t('supplierEditor.invoiceStatus.overdue'),
          cancelled: t('supplierEditor.invoiceStatus.cancelled'),
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
          placeholder={t('supplierEditor.contacts.fullNamePlaceholder')}
        />
      )
    },
    { title: t('supplierEditor.contacts.role'), dataIndex: 'role', key: 'role', width: 150,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.role}
          onChange={(e) => updateContact(index, 'role', e.target.value)}
          placeholder={t('supplierEditor.contacts.role')}
        />
      )
    },
    { title: t('common.email'), dataIndex: 'email', key: 'email', width: 200,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.email}
          onChange={(e) => updateContact(index, 'email', e.target.value)}
          placeholder="email@exemple.com"
          status={emailContactFautif(contacts[index]?.email) ? 'error' : undefined}
        />
      )
    },
    { title: t('common.phone'), dataIndex: 'phone', key: 'phone', width: 150,
      render: (_: unknown, __: unknown, index: number) => (
        <Input
          value={contacts[index]?.phone}
          onChange={(e) => updateContact(index, 'phone', e.target.value)}
          placeholder={t('common.phone')}
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
      key: 'purchase-orders',
      label: <span><ShoppingCartOutlined /> {t('supplierEditor.tabs.purchaseOrders')}</span>,
      children: (
        <Table
          dataSource={purchaseOrdersData?.data || []}
          columns={purchaseOrderColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          onRow={(record) => ({
            onDoubleClick: () => handleOpenPurchaseOrder(record),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: t('supplierEditor.emptyOrders') }}
        />
      ),
    },
    {
      key: 'invoices',
      label: <span><FileDoneOutlined /> {t('supplierEditor.tabs.invoices')}</span>,
      children: (
        <Table
          dataSource={invoicesData?.data || []}
          columns={invoiceColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          onRow={(record) => ({
            onDoubleClick: () => handleOpenInvoice(record),
            style: { cursor: 'pointer' },
          })}
          locale={{ emptyText: t('supplierEditor.emptyInvoices') }}
        />
      ),
    },
  ]

  const tabItems = [
    {
      key: 'history',
      label: <span><HistoryOutlined /> {t('supplierEditor.tabs.history')}</span>,
      children: (
        <Tabs items={historySubTabs} size="small" />
      ),
    },
    {
      key: 'contacts',
      label: <span><TeamOutlined /> {t('supplierEditor.tabs.personnel')}</span>,
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Button type="dashed" icon={<PlusOutlined />} onClick={addContact}>
              {t('supplierEditor.contacts.add')}
            </Button>
          </div>
          <Table
            dataSource={contacts.map((c, i) => ({ ...c, key: i }))}
            columns={contactColumns}
            rowKey="key"
            size="small"
            pagination={false}
            locale={{ emptyText: t('supplierEditor.emptyContacts') }}
          />
        </div>
      ),
    },
    {
      key: 'settings',
      label: <span><SettingOutlined /> {t('supplierEditor.tabs.settings')}</span>,
      children: (
        // ⚠️ NI « REMISE PAR DÉFAUT » NI « COMMANDE AUTOMATIQUE » ICI.
        //
        // Les deux champs existaient à l'écran mais ne partaient nulle part :
        // absents de setFieldsValue comme de onFinish, et sans colonne en base
        // (wp_amsbm_partner n'a ni discount_rate ni auto_order). Deux commandes
        // mortes valent moins que rien : elles font croire à un réglage. Les
        // remettre suppose une migration, la prise en charge dans
        // Parties::write et la restitution dans Parties::toJson — et surtout
        // une fonction de l'ERP qui les consomme, ce qui n'existe pas encore.
        <Row gutter={24}>
          <Col span={12}>
            <Card title={t('supplierEditor.settings.commercialConditions')} size="small">
              <Form.Item name="paymentTerms" label={t('supplierEditor.settings.paymentTerms')}>
                <InputNumber min={0} max={365} style={{ width: '100%' }} />
              </Form.Item>
            </Card>
          </Col>
          <Col span={12}>
            <Card title={t('supplierEditor.settings.parameters')} size="small">
              <Form.Item name="isActive" label={t('supplierEditor.settings.activeSupplier')} valuePropName="checked">
                <Switch />
              </Form.Item>
              {/* ⚠️ LE SECOND RÔLE DE LA FICHE, ET LE SEUL ENDROIT D'OÙ ON PUISSE
                  LE RETIRER.

                  Un fournisseur recevait le drapeau « client » par effet de bord
                  — un devis ou une facture de vente établis à son nom, une fiche
                  ouverte par la mauvaise route avant la garde de rôle — et ne le
                  perdait jamais : « Bois du Nord », FOU0001, ouvrait la liste des
                  Clients et se proposait dans le sélecteur « Client » d'une
                  facture. Le drapeau « fournisseur », lui, ne se retire pas
                  d'ici : la fiche disparaîtrait sous les yeux de qui
                  l'enregistre. */}
              <Form.Item
                name="isCustomer"
                label={t('supplierEditor.settings.alsoCustomer', 'Ce tiers est aussi un client')}
                valuePropName="checked"
                extra={t(
                  'supplierEditor.settings.alsoCustomerHelp',
                  "Actif, la fiche apparaît aussi dans Clients et dans le choix d'une facture de vente."
                )}
              >
                <Switch />
              </Form.Item>
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'ged',
      label: <span><FolderOpenOutlined /> {t('supplierEditor.tabs.ged')}</span>,
      children: (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
              {t('supplierEditor.ged.upload')}
            </Button>
          </div>
          <Table
            dataSource={documentsData?.data || []}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: t('supplierEditor.emptyDocuments') }}
            columns={[
              { title: t('common.name'), dataIndex: 'name', key: 'name' },
              { title: t('supplierEditor.ged.file'), dataIndex: 'original_name', key: 'original_name', ellipsis: true },
              { title: t('supplierEditor.ged.category'), dataIndex: 'category', key: 'category', width: 120,
                render: (cat: string) => {
                  const labels: Record<string, string> = {
                    contract: t('supplierEditor.docCategory.contract'),
                    invoice: t('supplierEditor.docCategory.invoice'),
                    quote: t('supplierEditor.docCategory.quote'),
                    report: t('supplierEditor.docCategory.report'),
                    technical: t('supplierEditor.docCategory.technical'),
                    legal: t('supplierEditor.docCategory.legal'),
                    other: t('supplierEditor.docCategory.other'),
                  }
                  return <Tag>{labels[cat] || cat}</Tag>
                }
              },
              { title: t('supplierEditor.ged.size'), dataIndex: 'size', key: 'size', width: 100,
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
                    <Popconfirm title={t('supplierEditor.ged.deleteConfirm')} onConfirm={() => handleDeleteDocument(record.id)} okText={t('common.yes')} cancelText={t('common.no')}>
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
        initialValues={{ country: 'France', paymentTerms: 30, isActive: true, isCustomer: false }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          padding: '0 8px',
        }}>
          <h2 style={{ margin: 0 }}>{isEdit ? (supplier?.name || t('supplierEditor.supplier')) : t('supplierEditor.newSupplier')}</h2>
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
                label={t('supplierEditor.fields.code')}
                rules={[{ required: true, message: t('supplierEditor.validation.codeRequired') }]}
              >
                {/* Le serveur attribue des codes « FOU… » (Suppliers::codePrefix). */}
                <Input placeholder="FOU0001" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="name"
                label={t('common.name')}
                rules={[{ required: true, whitespace: true, message: t('supplierEditor.validation.nameRequired') }]}
              >
                <Input placeholder={t('supplierEditor.fields.namePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="phone" label={t('common.phone')}>
                <Input placeholder="01 23 45 67 89" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="mobile" label={t('supplierEditor.fields.mobile')}>
                <Input placeholder="06 12 34 56 78" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="email" label={t('common.email')} rules={[{ type: 'email', message: t('supplierEditor.validation.emailInvalid') }]}>
                <Input placeholder="email@exemple.com" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0' }} />

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="addressLine1" label={t('supplierEditor.fields.address')}>
                <Input placeholder={t('supplierEditor.fields.addressPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="addressLine2" label={t('supplierEditor.fields.addressComplement')}>
                <Input placeholder={t('supplierEditor.fields.addressComplementPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={3}>
              <Form.Item name="postalCode" label={t('supplierEditor.fields.postalCode')}>
                <Input placeholder="75001" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="city" label={t('supplierEditor.fields.city')}>
                <Input placeholder="Paris" />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="country" label={t('supplierEditor.fields.country')}>
                <Input placeholder="France" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="siret" label={t('supplierEditor.fields.siret')}>
                <Input placeholder="123 456 789 00012" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="tvaIntra" label={t('supplierEditor.fields.tvaIntra')}>
                <Input
                  placeholder="FR12345678901"
                  suffix={
                    <Button
                      type="text"
                      size="small"
                      icon={vatValidating ? <LoadingOutlined spin /> : <SearchOutlined />}
                      onClick={handleValidateVat}
                      disabled={vatValidating}
                      title={t('supplierEditor.fields.checkVatValidity')}
                      style={{ marginRight: -8 }}
                    />
                  }
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="notes" label={t('supplierEditor.fields.notes')}>
                <Input.TextArea rows={1} placeholder={t('supplierEditor.fields.notesPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        {/* Tabs */}
        {/* ⚠️ LES RÉGLAGES SONT ACCESSIBLES DÈS LA CRÉATION.
            L'écran de création n'avait pas un seul interrupteur : ni « Délai de
            paiement », ni « Fournisseur actif ». Il fallait enregistrer, revenir
            à la liste et rouvrir la fiche pour y accéder — alors que onFinish
            envoie ces deux valeurs depuis toujours, avec leur défaut.
            L'Historique et la GED n'ont rien à montrer d'une fiche qui n'existe
            pas encore : ils restent réservés à la modification. */}
        <Card size="small">
          <Tabs items={isEdit ? tabItems : tabItems.filter((item) => 'settings' === item.key)} />
        </Card>
      </Form>

      {/* Upload Modal */}
      <Modal
        title={t('supplierEditor.ged.upload')}
        open={uploadModalVisible}
        onCancel={() => setUploadModalVisible(false)}
        footer={null}
      >
        <Form layout="vertical">
          <Form.Item label={t('supplierEditor.ged.documentName')}>
            <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={t('supplierEditor.ged.documentName')} />
          </Form.Item>
          <Form.Item label={t('supplierEditor.ged.category')}>
            <Select value={uploadCategory} onChange={setUploadCategory}>
              <Select.Option value="contract">{t('supplierEditor.docCategory.contract')}</Select.Option>
              <Select.Option value="invoice">{t('supplierEditor.docCategory.invoice')}</Select.Option>
              <Select.Option value="quote">{t('supplierEditor.docCategory.quote')}</Select.Option>
              <Select.Option value="report">{t('supplierEditor.docCategory.report')}</Select.Option>
              <Select.Option value="technical">{t('supplierEditor.docCategory.technical')}</Select.Option>
              <Select.Option value="legal">{t('supplierEditor.docCategory.legal')}</Select.Option>
              <Select.Option value="other">{t('supplierEditor.docCategory.other')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('common.description')}>
            <Input.TextArea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} rows={2} placeholder={t('supplierEditor.ged.descriptionPlaceholder')} />
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
              <p className="ant-upload-text">{uploading ? t('supplierEditor.ged.uploading') : t('supplierEditor.ged.dropHint')}</p>
              {/* « Tous types de fichiers acceptés » était faux : le serveur
                  filtre selon la liste WordPress (wp_check_filetype_and_ext) et
                  refuse au-delà de 64 Mo. Annoncer la règle évite le refus. */}
              <p className="ant-upload-hint">
                {t('supplierEditor.ged.acceptedFileTypes', 'PDF, images et documents bureautiques, 64 Mo au plus')}
              </p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      {/* VAT Validation Modal */}
      <Modal
        title={t('supplierEditor.vat.title')}
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
              backgroundColor: vatIndetermine ? '#fffbe6' : vatValide ? '#f6ffed' : '#fff2f0',
              borderRadius: 8,
              border: `1px solid ${vatIndetermine ? '#ffe58f' : vatValide ? '#b7eb8f' : '#ffccc7'}`
            }}>
              {vatIndetermine ? (
                <ExclamationCircleOutlined style={{ fontSize: 48, color: '#faad14' }} />
              ) : vatValide ? (
                <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
              ) : (
                <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              )}
              <div style={{ marginTop: 8, fontSize: 18, fontWeight: 500 }}>
                {vatIndetermine
                  ? t('supplierEditor.vat.unknown', 'Vérification impossible')
                  : vatValide
                    ? t('supplierEditor.vat.valid')
                    : t('supplierEditor.vat.invalid')}
              </div>
            </div>

            {vatResult.error && (
              <div style={{ marginBottom: 16, color: vatIndetermine ? '#ad6800' : '#ff4d4f' }}>
                {vatResult.error}
              </div>
            )}

            {vatValide && vatResult.name && (
              <div style={{ marginBottom: 12 }}>
                <strong>{t('supplierEditor.vat.nameLabel')}</strong>
                <div style={{ marginTop: 4 }}>{vatResult.name}</div>
              </div>
            )}

            {vatValide && vatResult.address && (
              <div>
                <strong>{t('supplierEditor.vat.addressLabel')}</strong>
                <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{vatResult.address}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
