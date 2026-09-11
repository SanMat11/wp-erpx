import { useState, useEffect } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  message,
  Tag,
  Popconfirm,
  Typography,
  Row,
  Col,
  Statistic,
  Upload,
  Select,
  Tooltip,
  Empty,
} from 'antd'
import {
  PlusOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  FileTextOutlined,
  LockOutlined,
  UnlockOutlined,
  SearchOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { bankAccountAPI, bankStatementAPI, invoiceAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { usePermissionStore, usePermissionsChargees } from '@/stores/permissionStore'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TextArea } = Input

/**
 * Un montant, en français.
 *
 * ⚠️ LE FORMATEUR PAR DÉFAUT D'ANTD GROUPE À L'ANGLAISE. Le bandeau de synthèse
 * annonçait « Total crédits 1,443.40€ » et « EUR112,115.74 » au-dessus d'un
 * tableau de lignes qui écrit « 1 170,00 € ». Les tableaux avaient raison : on
 * aligne les cartes dessus, et non l'inverse.
 */
const montantFr = (valeur: number | null | undefined): string =>
  Number(valeur ?? 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })

/**
 * La date d'une pièce, ou null quand elle n'en porte pas.
 *
 * ⚠️ « 0000-00-00 » ET LA CHAÎNE VIDE SONT DES ABSENCES, PAS DES DATES. dayjs
 * en fait un objet invalide, dont toutes les comparaisons rendent faux : le
 * relevé disparaissait du filtre de période, et sa colonne affichait
 * « Invalid Date ».
 */
const jourOuRien = (brute?: string | null): dayjs.Dayjs | null => {
  if (!brute || brute.startsWith('0000')) {
    return null
  }

  const jour = dayjs(brute)

  return jour.isValid() ? jour : null
}

/** Une date au format du pays, ou un tiret quand il n'y en a pas. */
const dateOuTiret = (brute?: string | null): string => jourOuRien(brute)?.format('DD/MM/YYYY') ?? '—'

interface BankStatement {
  id: string
  bank_account_id: string
  statement_number: string
  year: number
  sequence: number
  start_date: string
  end_date: string
  opening_balance: number
  closing_balance: number
  total_debit: number
  total_credit: number
  status: string
  label: string
  notes: string
  lines?: BankStatementLine[]
}

interface LinkedInvoice {
  id: string
  line_id: string
  invoice_id: string
  amount: number
  invoice_number: string
  invoice_type: string
  invoice_total: number
  client_name: string
  supplier_name: string
}

interface BankStatementLine {
  id: string
  statement_id: string
  line_order: number
  date: string
  value_date?: string
  reference: string
  label: string
  debit?: number
  credit?: number
  balance: number
  category: string
  reconciled: boolean
  transfer_account_id?: string | null
  linked_invoice_id?: string
  linked_invoices?: LinkedInvoice[]
}

interface UnpaidInvoice {
  id: string
  number: string
  type: string
  contact_name: string
  date: string
  total_ttc: number
  paid_amount: number
  remaining_amount: number
}

interface BankAccount {
  id: string
  bank_name: string
  iban: string
  bic: string
  label: string
  current_balance: number
  initial_balance: number
}

interface SelectedInvoice {
  invoice_id: string
  amount: number
  invoice: UnpaidInvoice
}

interface LineFormValues {
  date: string
  value_date?: string
  reference?: string
  label: string
  debit?: number | null
  credit?: number | null
  category?: string
  linked_invoice_id?: string
  linked_invoices?: { invoice_id: string; amount: number }[]
  transfer_account_id?: string
}

interface Props {
  tabId: string
  documentId: string
}

export default function BankAccountDetail({ tabId, documentId }: Props) {
  const { t } = useTranslation()
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null)
  const [statementModalVisible, setStatementModalVisible] = useState(false)
  const [lineModalVisible, setLineModalVisible] = useState(false)
  const [editingStatement, setEditingStatement] = useState<BankStatement | null>(null)
  const [editingLine, setEditingLine] = useState<BankStatementLine | null>(null)
  const [selectedInvoiceType, setSelectedInvoiceType] = useState<'client' | 'supplier' | null>(null)
  const [selectedInvoices, setSelectedInvoices] = useState<SelectedInvoice[]>([])
  const [filterContactId, setFilterContactId] = useState<string | null>(null)
  const [invoiceSearchText, setInvoiceSearchText] = useState('')
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  // Compte d'origine quand la ligne n'est pas un règlement mais un VIREMENT :
  // le versement d'une passerelle, un mouvement entre deux comptes de la
  // société. Il exclut le rapprochement de factures — les factures qu'un
  // versement couvre sont déjà soldées.
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null)
  const [otherAccounts, setOtherAccounts] = useState<Array<{ id: string; label: string; kind: string }>>([])
  // Date range filter: rolling year (11 months ago to 1 month ahead)
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(11, 'month').startOf('month'),
    dayjs().add(1, 'month').endOf('month'),
  ])
  const [statementForm] = Form.useForm()
  const [lineForm] = Form.useForm()
  const queryClient = useQueryClient()
  const { openStaticTab, openDocumentTab } = useDocumentTabsStore()

  // ⚠️ LES BOUTONS MENTAIENT AUX RÔLES QUI N'ONT PAS LE DROIT.
  //
  // « Nouveau relevé », « Importer CSV », « Valider », les crayons de ligne :
  // tous offerts au commercial, tous refusés en rouge au clic. Rapprocher n'est
  // pas un marquage décoratif — cela ENREGISTRE UN RÈGLEMENT —, et
  // BankStatements::register() exige donc « amsbm_reconcile_bank » sur chacune de
  // ces routes. La lecture, elle, reste ouverte : on ne masque que l'écriture.
  //
  // Dans la matrice, le module est « treasury », et le niveau « edit » suffit :
  // c'est lui que Settings::applyLevel() traduit en amsbm_reconcile_bank.
  const droitsConnus = usePermissionsChargees()
  const peutTenirLaTresorerie = usePermissionStore((etat) => etat.canEdit('treasury'))

  // ⚠️ TANT QU'ON NE SAIT PAS, ON NE CACHE RIEN. La matrice arrive par un appel ;
  // masquer avant sa réponse ferait clignoter les boutons à chaque chargement.
  const montrerLesEcritures = !droitsConnus || peutTenirLaTresorerie

  // Avoid unused variable warning
  void tabId

  // Fetch bank account details
  const { data: accountData } = useQuery({
    queryKey: ['bank-account', documentId],
    queryFn: async () => {
      const response = await bankAccountAPI.get(documentId)
      return response.data as BankAccount
    },
  })

  // Fetch statements for this account
  const { data: statementsData, isLoading: statementsLoading } = useQuery({
    queryKey: ['bank-statements', documentId],
    queryFn: async () => {
      const response = await bankStatementAPI.list(documentId)
      return response.data
    },
  })

  // Fetch selected statement with lines
  const { data: selectedStatement, isLoading: statementLoading } = useQuery({
    queryKey: ['bank-statement', selectedStatementId],
    queryFn: async () => {
      if (!selectedStatementId) return null
      const response = await bankStatementAPI.get(selectedStatementId)
      // ⚠️ UN SEUL NIVEAU. Le serveur rend le relevé À LA RACINE, il ne
      // l'enveloppe pas dans { data }. En déballant deux fois on obtenait
      // « undefined » : aucun relevé ne s'ouvrait jamais, quel qu'il soit.
      // (Les deux requêtes d'impayés juste en dessous, elles, sont bien
      // enveloppées — d'où la différence, qui n'a rien d'une étourderie.)
      return response.data as BankStatement
    },
    enabled: !!selectedStatementId,
  })

  // Fetch unpaid client invoices (for credits - money coming in)
  const { data: clientInvoicesData } = useQuery({
    queryKey: ['unpaid-invoices', 'client'],
    queryFn: async () => {
      const response = await invoiceAPI.listUnpaid('client')
      return response.data.data as UnpaidInvoice[]
    },
    enabled: lineModalVisible,
  })

  // Fetch unpaid supplier invoices (for debits - money going out)
  const { data: supplierInvoicesData } = useQuery({
    queryKey: ['unpaid-invoices', 'supplier'],
    queryFn: async () => {
      const response = await invoiceAPI.listUnpaid('supplier')
      return response.data.data as UnpaidInvoice[]
    },
    enabled: lineModalVisible,
  })

  /**
   * Rafraîchit TOUT ce qu'une écriture déplace.
   *
   * ⚠️ TROIS REQUÊTES, PAS UNE. Après « Importer CSV », la liste de gauche
   * continuait d'annoncer « 0,00 € » et la date de création du relevé : seul le
   * relevé ouvert était réinvalidé, alors que l'import change aussi ses totaux
   * dans la LISTE (qui a sa propre requête) et les bornes de sa période — que le
   * serveur élargit d'après les lignes reçues. Le solde du COMPTE bouge lui
   * aussi dès qu'une ligne rapprochée enregistre un règlement. Il fallait
   * recharger la page pour voir juste.
   */
  const rafraichirLeCompte = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-statement', selectedStatementId] })
    queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
    queryClient.invalidateQueries({ queryKey: ['bank-account', documentId] })
  }

  // Create statement mutation
  const createStatementMutation = useMutation({
    mutationFn: (values: { date: string; notes?: string }) =>
      bankStatementAPI.create(documentId, values),
    onSuccess: (response) => {
      message.success(t('bankAccountDetail.statementCreated'))
      queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
      // Même remarque qu'au chargement : la création rend le relevé à la racine.
      setSelectedStatementId(response.data.id)
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Update statement mutation
  const updateStatementMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: { date: string; notes?: string } }) =>
      bankStatementAPI.update(id, values),
    onSuccess: () => {
      message.success(t('bankAccountDetail.statementUpdated'))
      queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
      queryClient.invalidateQueries({ queryKey: ['bank-statement', selectedStatementId] })
      setStatementModalVisible(false)
      setEditingStatement(null)
      statementForm.resetFields()
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Delete statement mutation
  const deleteStatementMutation = useMutation({
    mutationFn: (id: string) => bankStatementAPI.delete(id),
    onSuccess: () => {
      message.success(t('bankAccountDetail.statementDeleted'))
      // Supprimer un relevé défait ses rapprochements, donc ses règlements : le
      // solde du compte et les impayés bougent avec lui.
      queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
      queryClient.invalidateQueries({ queryKey: ['bank-account', documentId] })
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
      if (selectedStatementId === editingStatement?.id) {
        setSelectedStatementId(null)
      }
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Validate statement mutation
  const validateStatementMutation = useMutation({
    mutationFn: (id: string) => bankStatementAPI.validate(id),
    onSuccess: () => {
      message.success(t('bankAccountDetail.statementValidated'))
      queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
      queryClient.invalidateQueries({ queryKey: ['bank-statement', selectedStatementId] })
      queryClient.invalidateQueries({ queryKey: ['bank-account', documentId] })
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Unvalidate statement mutation
  const unvalidateStatementMutation = useMutation({
    mutationFn: (id: string) => bankStatementAPI.unvalidate(id),
    onSuccess: () => {
      message.success(t('bankAccountDetail.statementUnvalidated'))
      queryClient.invalidateQueries({ queryKey: ['bank-statements', documentId] })
      queryClient.invalidateQueries({ queryKey: ['bank-statement', selectedStatementId] })
      queryClient.invalidateQueries({ queryKey: ['bank-account', documentId] })
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Add line mutation
  const addLineMutation = useMutation({
    mutationFn: ({ statementId, values }: { statementId: string; values: LineFormValues }) =>
      bankStatementAPI.addLine(statementId, values),
    onSuccess: () => {
      message.success(t('bankAccountDetail.lineAdded'))
      rafraichirLeCompte()
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
      setLineModalVisible(false)
      lineForm.resetFields()
      setSelectedInvoices([])
      setSelectedInvoiceType(null)
      setFilterContactId(null)
      setInvoiceSearchText('')
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Update line mutation
  const updateLineMutation = useMutation({
    mutationFn: ({ lineId, values }: { lineId: string; values: LineFormValues }) =>
      bankStatementAPI.updateLine(lineId, values),
    onSuccess: () => {
      message.success(t('bankAccountDetail.lineUpdated'))
      rafraichirLeCompte()
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
      setLineModalVisible(false)
      setEditingLine(null)
      lineForm.resetFields()
      setSelectedInvoices([])
      setSelectedInvoiceType(null)
      setFilterContactId(null)
      setInvoiceSearchText('')
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Delete line mutation
  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) => bankStatementAPI.deleteLine(lineId),
    onSuccess: () => {
      message.success(t('bankAccountDetail.lineDeleted'))
      rafraichirLeCompte()
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Delete line invoice link mutation (reverts payment)
  const deleteLineInvoiceMutation = useMutation({
    mutationFn: (linkId: string) => bankStatementAPI.deleteLineInvoice(linkId),
    onSuccess: () => {
      message.success(t('bankAccountDetail.linkDeleted'))
      rafraichirLeCompte()
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.error')}: ${error.message}`)
    },
  })

  // Import CSV mutation
  const importCSVMutation = useMutation({
    mutationFn: ({ statementId, file }: { statementId: string; file: File }) =>
      bankStatementAPI.importCSV(statementId, file),
    onSuccess: (response) => {
      const result = response.data.data
      // ⚠️ LES AVERTISSEMENTS DE L'IMPORT SE LISENT, ET UN IMPORT VIDE N'EST PAS
      // UN SUCCÈS.
      //
      // Le bandeau ne disait que « importées / ignorées », et il était vert : un
      // PDF ou un CSV sans aucune colonne reconnaissable se soldait par un
      // message de réussite, alors que le serveur expliquait très bien le refus
      // dans « warnings » — que personne n'affichait.
      const avertissements: string[] = result.warnings || []
      const bilan = t('bankAccountDetail.importDone', {
        imported: result.imported_rows,
        skipped: result.skipped_rows,
      })

      if (result.imported_rows > 0) {
        message.success(bilan)
      } else {
        message.warning(bilan)
      }

      avertissements.forEach((avertissement) => message.warning(avertissement))

      rafraichirLeCompte()
      queryClient.invalidateQueries({ queryKey: ['unpaid-invoices'] })
    },
    onError: (error: Error) => {
      message.error(`${t('bankAccountDetail.importError')}: ${error.message}`)
    },
  })

  const handleOpenStatementModal = (statement?: BankStatement) => {
    if (statement) {
      setEditingStatement(statement)
      statementForm.setFieldsValue({
        date: dayjs(statement.start_date),
        notes: statement.notes,
      })
      setStatementModalVisible(true)
    }
  }

  const handleStatementSubmit = async () => {
    try {
      const values = await statementForm.validateFields()
      const formData = {
        date: values.date.format('YYYY-MM-DD'),
        notes: values.notes || '',
      }

      if (editingStatement) {
        updateStatementMutation.mutate({ id: editingStatement.id, values: formData })
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleOpenLineModal = (line?: BankStatementLine) => {
    setTransferAccountId(line?.transfer_account_id ? String(line.transfer_account_id) : null)

    if (line) {
      setEditingLine(line)
      // Determine invoice type from existing linked invoices
      if (line.linked_invoices && line.linked_invoices.length > 0) {
        const firstInvoice = line.linked_invoices[0]
        setSelectedInvoiceType(firstInvoice.invoice_type === 'supplier' ? 'supplier' : 'client')
        // Convert linked invoices to selected invoices format
        const selected: SelectedInvoice[] = line.linked_invoices.map(li => ({
          invoice_id: li.invoice_id,
          amount: li.amount,
          invoice: {
            id: li.invoice_id,
            number: li.invoice_number,
            type: li.invoice_type,
            contact_name: li.client_name || li.supplier_name,
            date: '',
            total_ttc: li.invoice_total,
            paid_amount: 0,
            remaining_amount: li.amount,
          },
        }))
        setSelectedInvoices(selected)
        // Set filter based on first invoice's contact
        if (firstInvoice.client_name) {
          setFilterContactId(firstInvoice.client_name)
        } else if (firstInvoice.supplier_name) {
          setFilterContactId(firstInvoice.supplier_name)
        }
      } else {
        setSelectedInvoiceType(null)
        setSelectedInvoices([])
        setFilterContactId(null)
      }
      lineForm.setFieldsValue({
        date: dayjs(line.date),
        value_date: line.value_date ? dayjs(line.value_date) : undefined,
        reference: line.reference,
        label: line.label,
        debit: line.debit,
        credit: line.credit,
        category: line.category,
        linked_invoice_id: line.linked_invoice_id,
      })
    } else {
      setEditingLine(null)
      setSelectedInvoiceType(null)
      setSelectedInvoices([])
      setFilterContactId(null)
      setInvoiceSearchText('')
      lineForm.resetFields()
      lineForm.setFieldsValue({
        date: dayjs(),
      })
    }

    // Les autres comptes, pour proposer le virement. Chargés à l'ouverture du
    // modal : c'est court, et ça évite un appel de plus au chargement de la page
    // — chacun coûte cher sur cet hébergement.
    bankAccountAPI
      .list()
      .then((response) => {
        setOtherAccounts(
          (response.data?.data || [])
            .filter((a: { id: string }) => String(a.id) !== String(documentId))
            .map((a: { id: string; label: string; kind?: string }) => ({
              id: String(a.id),
              label: a.label,
              kind: a.kind || 'bank',
            }))
        )
      })
      .catch(() => setOtherAccounts([]))

    setLineModalVisible(true)
  }

  // Handle adding an invoice to the selection
  const handleAddInvoice = (invoiceId: string, type: 'client' | 'supplier') => {
    if (!invoiceId) return

    // Check if already selected
    if (selectedInvoices.some(si => si.invoice_id === invoiceId)) {
      message.warning(t('bankAccountDetail.invoiceAlreadySelected'))
      return
    }

    const invoices = type === 'client' ? clientInvoicesData : supplierInvoicesData
    const invoice = invoices?.find(inv => inv.id === invoiceId)
    if (!invoice) return

    // Set invoice type on first selection
    if (selectedInvoices.length === 0) {
      setSelectedInvoiceType(type)
      setFilterContactId(invoice.contact_name)
    }

    // Add to selection
    const newSelected: SelectedInvoice = {
      invoice_id: invoiceId,
      amount: invoice.remaining_amount,
      invoice,
    }
    setSelectedInvoices(prev => [...prev, newSelected])

    // Update form totals
    updateFormTotals([...selectedInvoices, newSelected], type)

    // Clear the dropdown
    lineForm.setFieldsValue({
      [type === 'client' ? 'client_invoice_id' : 'supplier_invoice_id']: undefined,
    })
  }

  // Handle removing an invoice from selection
  const handleRemoveInvoice = (invoiceId: string) => {
    const newSelected = selectedInvoices.filter(si => si.invoice_id !== invoiceId)
    setSelectedInvoices(newSelected)

    if (newSelected.length === 0) {
      setSelectedInvoiceType(null)
      setFilterContactId(null)
      lineForm.setFieldsValue({ debit: undefined, credit: undefined, label: '' })
    } else {
      updateFormTotals(newSelected, selectedInvoiceType!)
    }
  }

  // Handle changing amount for an invoice
  const handleInvoiceAmountChange = (invoiceId: string, amount: number) => {
    const newSelected = selectedInvoices.map(si =>
      si.invoice_id === invoiceId ? { ...si, amount } : si
    )
    setSelectedInvoices(newSelected)
    updateFormTotals(newSelected, selectedInvoiceType!)
  }

  // Update form debit/credit based on selected invoices
  const updateFormTotals = (invoices: SelectedInvoice[], type: 'client' | 'supplier') => {
    const total = invoices.reduce((sum, si) => sum + si.amount, 0)
    const label = invoices.length === 1
      ? t('bankAccountDetail.paymentLabelSingle', { number: invoices[0].invoice.number, contact: invoices[0].invoice.contact_name })
      : t('bankAccountDetail.paymentLabelMultiple', { count: invoices.length, contact: invoices[0].invoice.contact_name })
    if (type === 'client') {
      lineForm.setFieldsValue({
        credit: total,
        debit: undefined,
        label,
      })
    } else {
      lineForm.setFieldsValue({
        debit: total,
        credit: undefined,
        label,
      })
    }
  }

  // Get filtered invoices based on search text and contact
  const getFilteredInvoices = (invoices: UnpaidInvoice[] | undefined): UnpaidInvoice[] => {
    if (!invoices) return []
    let filtered = invoices

    // Filter by contact if one is already selected
    if (filterContactId) {
      filtered = filtered.filter(inv => inv.contact_name === filterContactId)
    }

    // Filter by search text
    if (invoiceSearchText.trim()) {
      const search = invoiceSearchText.toLowerCase().trim()
      filtered = filtered.filter(inv =>
        inv.contact_name.toLowerCase().includes(search) ||
        inv.number.toLowerCase().includes(search)
      )
    }

    return filtered
  }

  const handleLineSubmit = async () => {
    try {
      const values = await lineForm.validateFields()
      const formData: LineFormValues = {
        date: values.date.format('YYYY-MM-DD'),
        value_date: values.value_date ? values.value_date.format('YYYY-MM-DD') : '',
        reference: values.reference || '',
        label: values.label,
        debit: values.debit || null,
        credit: values.credit || null,
        category: values.category || '',
        linked_invoice_id: '', // Deprecated, use linked_invoices
        linked_invoices: transferAccountId
          ? []
          : selectedInvoices.map(si => ({
              invoice_id: si.invoice_id,
              amount: si.amount,
            })),
        transfer_account_id: transferAccountId || '',
      }

      if (editingLine) {
        updateLineMutation.mutate({ lineId: editingLine.id, values: formData })
      } else if (selectedStatementId) {
        addLineMutation.mutate({ statementId: selectedStatementId, values: formData })
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleImportCSV = (file: File) => {
    if (selectedStatementId) {
      importCSVMutation.mutate({ statementId: selectedStatementId, file })
    }
    return false
  }

  const statements: BankStatement[] = statementsData?.data || []
  const isStatementDraft = selectedStatement?.status === 'draft'

  // ⚠️ UN RELEVÉ SANS DATE N'EST PAS « HORS PÉRIODE », IL EST « SANS DATE ».
  //
  // La plage par défaut couvre l'année glissante, et le filtre comparait la date
  // du relevé à ses deux bornes. Un relevé dont start_date est vide donne un
  // dayjs invalide, dont les DEUX comparaisons rendent faux : il était donc
  // écarté. Ouvrir un tel compte affichait « Aucune donnée » dans le panneau de
  // gauche alors que le panneau du dessous en proposait un — la contradiction
  // était sous les yeux de l'utilisateur.
  //
  // Un filtre de période ne tranche pas ce qu'il ne sait pas dater : ces
  // relevés-là restent visibles en toutes circonstances, et on le DIT plutôt que
  // de laisser croire à une période mal choisie.
  const relevesSansDate = statements.filter((releve) => null === jourOuRien(releve.start_date))

  const relevesAffiches = statements.filter((releve) => {
    const jour = jourOuRien(releve.start_date)

    if (null === jour) {
      return true
    }

    return jour.isAfter(dateRange[0].subtract(1, 'day')) && jour.isBefore(dateRange[1].add(1, 'day'))
  })

  // Auto-select first statement
  useEffect(() => {
    if (statements.length > 0 && !selectedStatementId) {
      setSelectedStatementId(statements[0].id)
    }
  }, [statements, selectedStatementId])

  const statementColumns = [
    {
      title: t('common.date'),
      dataIndex: 'start_date',
      key: 'start_date',
      width: 100,
      // ⚠️ Le comparateur suit l'ordre ANNONCÉ. Il soustrayait a de b tout en
      // déclarant « ascend » : la colonne affichait une flèche montante et
      // rangeait le plus récent en tête, et cliquer dessus faisait l'inverse de
      // ce que la flèche promettait.
      //
      // Et un relevé sans date ne rend plus NaN — une soustraction indéfinie
      // laissait l'ordre au hasard de l'implémentation. Il passe en tête, là où
      // on va le chercher pour lui donner sa date.
      sorter: (a: BankStatement, b: BankStatement) =>
        (jourOuRien(a.start_date)?.valueOf() ?? 0) - (jourOuRien(b.start_date)?.valueOf() ?? 0),
      defaultSortOrder: 'ascend' as const,
      render: (date: string) => dateOuTiret(date),
    },
    {
      title: t('bankAccountDetail.numberShort'),
      dataIndex: 'statement_number',
      key: 'statement_number',
      width: 100,
      render: (num: string, record: BankStatement) => (
        <Space>
          {record.status === 'validated' && (
            <Tooltip title={t('bankAccountDetail.validated')}>
              <LockOutlined style={{ color: '#52c41a' }} />
            </Tooltip>
          )}
          <Text strong>{num}</Text>
        </Space>
      ),
    },
    {
      title: t('bankAccountDetail.openingBalance'),
      dataIndex: 'opening_balance',
      key: 'opening_balance',
      align: 'right' as const,
      render: (balance: number) => (
        <Text style={{ color: balance >= 0 ? '#52c41a' : '#ff4d4f' }}>{montantFr(balance)}</Text>
      ),
    },
    {
      title: t('bankAccountDetail.closingBalance'),
      dataIndex: 'closing_balance',
      key: 'closing_balance',
      align: 'right' as const,
      render: (balance: number) => (
        <Text style={{ color: balance >= 0 ? '#52c41a' : '#ff4d4f', fontWeight: 'bold' }}>
          {montantFr(balance)}
        </Text>
      ),
    },
  ]

  const lineColumns = [
    {
      title: t('common.date'),
      dataIndex: 'date',
      key: 'date',
      width: 100,
      // Une ligne sans date reste lisible : « Invalid Date » n'apprenait rien.
      render: (date: string) => dateOuTiret(date),
    },
    {
      title: t('bankAccountDetail.reference'),
      dataIndex: 'reference',
      key: 'reference',
      width: 120,
    },
    {
      title: t('bankAccountDetail.lineLabel'),
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: t('bankAccountDetail.debit'),
      dataIndex: 'debit',
      key: 'debit',
      width: 120,
      align: 'right' as const,
      render: (debit?: number) => (debit ? <Text type="danger">{montantFr(debit)}</Text> : null),
    },
    {
      title: t('bankAccountDetail.credit'),
      dataIndex: 'credit',
      key: 'credit',
      width: 120,
      align: 'right' as const,
      render: (credit?: number) => (credit ? <Text type="success">{montantFr(credit)}</Text> : null),
    },
    {
      title: t('bankAccountDetail.balance'),
      dataIndex: 'balance',
      key: 'balance',
      width: 130,
      align: 'right' as const,
      render: (balance: number) => (
        <Text strong style={{ color: balance >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {montantFr(balance)}
        </Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      // Le relevé doit être en brouillon ET le lecteur avoir le droit de le
      // tenir : la colonne restait offerte au commercial, qui se heurtait au 403.
      render: (_: unknown, record: BankStatementLine) =>
        isStatementDraft && montrerLesEcritures ? (
          <Space onClick={(e) => e.stopPropagation()}>
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleOpenLineModal(record)} />
            <Popconfirm
              title={t('bankAccountDetail.deleteLineConfirm')}
              onConfirm={() => deleteLineMutation.mutate(record.id)}
              okText={t('common.yes')}
              cancelText={t('common.no')}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ) : null,
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => openStaticTab('treasury')}>
            {t('common.back')}
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {accountData?.label || accountData?.bank_name} - {accountData?.iban?.replace(/(.{4})/g, '$1 ').trim()}
          </Title>
        </Space>
        <Statistic
          title={t('bankAccountDetail.currentBalance')}
          value={accountData?.current_balance || 0}
          formatter={(valeur) => montantFr(Number(valeur))}
          valueStyle={{ color: (accountData?.current_balance || 0) >= 0 ? '#3f8600' : '#cf1322' }}
        />
      </div>

      {/* Main content - Split panel */}
      <Row gutter={16}>
        {/* Left panel - Statements list */}
        <Col span={8}>
          <Card
            title={t('bankAccountDetail.statements')}
            extra={
              montrerLesEcritures ? (
                <Button
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  loading={createStatementMutation.isPending}
                  onClick={() => createStatementMutation.mutate({ date: dayjs().format('YYYY-MM-DD') })}
                >
                  {t('bankAccountDetail.new')}
                </Button>
              ) : null
            }
            bodyStyle={{ padding: 0 }}
          >
            {/* Date range filter */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
              <DatePicker.RangePicker
                size="small"
                value={dateRange}
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    setDateRange([dates[0], dates[1]])
                  }
                }}
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
                allowClear={false}
              />
              {relevesSansDate.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                  {t(
                    'bankAccountDetail.releveSansDate',
                    '{{count}} relevé(s) sans date, affiché(s) quelle que soit la période.',
                    { count: relevesSansDate.length }
                  )}
                </Text>
              )}
            </div>
            <Table
              columns={statementColumns}
              dataSource={relevesAffiches}
              rowKey="id"
              loading={statementsLoading}
              pagination={false}
              size="small"
              onRow={(record) => ({
                onClick: () => {
                  setSelectedStatementId(record.id)
                  setSelectedLineId(null) // Reset line selection when changing statement
                },
                style: {
                  cursor: 'pointer',
                  backgroundColor: selectedStatementId === record.id ? '#e6f7ff' : undefined,
                },
              })}
              scroll={{ y: 350 }}
            />
          </Card>
        </Col>

        {/* Right panel - Statement detail */}
        <Col span={16}>
          {selectedStatement ? (
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <span>{t('bankAccountDetail.statementTitle', { number: selectedStatement.statement_number })}</span>
                  <Tag color={selectedStatement.status === 'validated' ? 'green' : 'orange'}>
                    {selectedStatement.status === 'validated' ? t('bankAccountDetail.validated') : t('bankAccountDetail.draft')}
                  </Tag>
                </Space>
              }
              extra={
                // ⚠️ AUCUN BOUTON D'ÉCRITURE SANS LE DROIT DE TENIR LA
                // TRÉSORERIE. Importer, saisir, corriger, supprimer, valider et
                // dévalider passent tous par « amsbm_reconcile_bank » : les
                // offrir à qui ne l'a pas, c'est promettre six refus.
                montrerLesEcritures ? (
                  <Space>
                    {isStatementDraft ? (
                      <>
                        <Upload
                          accept=".csv,.ofx,.qfx,.txt"
                          showUploadList={false}
                          beforeUpload={handleImportCSV}
                        >
                          <Button icon={<UploadOutlined />} loading={importCSVMutation.isPending}>
                            {t('bankAccountDetail.importCSV')}
                          </Button>
                        </Upload>
                        <Button icon={<PlusOutlined />} onClick={() => handleOpenLineModal()}>
                          {t('bankAccountDetail.addLine')}
                        </Button>
                        <Button icon={<EditOutlined />} onClick={() => handleOpenStatementModal(selectedStatement)}>
                          {t('common.edit')}
                        </Button>
                        <Popconfirm
                          title={t('bankAccountDetail.deleteStatementConfirm')}
                          onConfirm={() => deleteStatementMutation.mutate(selectedStatement.id)}
                          okText={t('common.yes')}
                          cancelText={t('common.no')}
                        >
                          <Button danger icon={<DeleteOutlined />}>
                            {t('common.delete')}
                          </Button>
                        </Popconfirm>
                        <Button
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          onClick={() => validateStatementMutation.mutate(selectedStatement.id)}
                          loading={validateStatementMutation.isPending}
                        >
                          {t('bankAccountDetail.validate')}
                        </Button>
                      </>
                    ) : (
                      <Popconfirm
                        title={t('bankAccountDetail.unvalidateConfirm')}
                        onConfirm={() => unvalidateStatementMutation.mutate(selectedStatement.id)}
                        okText={t('common.yes')}
                        cancelText={t('common.no')}
                      >
                        <Button
                          icon={<UnlockOutlined />}
                          loading={unvalidateStatementMutation.isPending}
                        >
                          {t('bankAccountDetail.unvalidate')}
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ) : null
              }
            >
              {/* Statement summary - Soldes sur une ligne avec fond colore */}
              <div
                style={{
                  backgroundColor: selectedStatement.closing_balance >= 0 ? '#f6ffed' : '#fff2f0',
                  border: `1px solid ${selectedStatement.closing_balance >= 0 ? '#b7eb8f' : '#ffccc7'}`,
                  borderRadius: 8,
                  padding: '16px',
                  marginBottom: 16,
                }}
              >
                <Row gutter={16}>
                  <Col span={6}>
                    <Statistic
                      title={t('bankAccountDetail.openingBalance')}
                      value={selectedStatement.opening_balance}
                      formatter={(valeur) => montantFr(Number(valeur))}
                      valueStyle={{ fontSize: 16 }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('bankAccountDetail.totalDebits')}
                      value={selectedStatement.total_debit}
                      formatter={(valeur) => montantFr(Number(valeur))}
                      valueStyle={{ fontSize: 16, color: '#cf1322' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('bankAccountDetail.totalCredits')}
                      value={selectedStatement.total_credit}
                      formatter={(valeur) => montantFr(Number(valeur))}
                      valueStyle={{ fontSize: 16, color: '#3f8600' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('bankAccountDetail.closingBalance')}
                      value={selectedStatement.closing_balance}
                      formatter={(valeur) => montantFr(Number(valeur))}
                      valueStyle={{ fontSize: 16, fontWeight: 'bold', color: selectedStatement.closing_balance >= 0 ? '#3f8600' : '#cf1322' }}
                    />
                  </Col>
                </Row>
              </div>

              {/* Lines table */}
              <Table
                columns={lineColumns}
                dataSource={selectedStatement.lines || []}
                rowKey="id"
                loading={statementLoading}
                pagination={false}
                size="small"
                scroll={(selectedStatement.lines?.length || 0) > 10 ? { y: 'calc(100vh - 480px)' } : undefined}
                onRow={(record) => ({
                  onClick: () => setSelectedLineId(record.id),
                  style: {
                    cursor: 'pointer',
                    backgroundColor: selectedLineId === record.id ? '#e6f7ff' : undefined,
                  },
                })}
              />

              {/* Line detail - Linked invoices */}
              {selectedLineId && (() => {
                const selectedLine = selectedStatement.lines?.find(l => l.id === selectedLineId)
                if (!selectedLine) return null

                const hasLinkedInvoices = selectedLine.linked_invoices && selectedLine.linked_invoices.length > 0

                return (
                  <div style={{
                    marginTop: 16,
                    padding: 16,
                    backgroundColor: '#f0f5ff',
                    border: '1px solid #adc6ff',
                    borderRadius: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <Text strong style={{ fontSize: 14 }}>
                        {t('bankAccountDetail.lineDetail', { label: selectedLine.label })}
                      </Text>
                      <Button type="text" size="small" onClick={() => setSelectedLineId(null)}>
                        {t('common.close')}
                      </Button>
                    </div>
                    {hasLinkedInvoices ? (
                      <Table
                        size="small"
                        pagination={false}
                        dataSource={selectedLine.linked_invoices}
                        rowKey="id"
                        columns={[
                          {
                            title: t('bankAccountDetail.invoiceNumber'),
                            dataIndex: 'invoice_number',
                            key: 'invoice_number',
                            width: 150,
                            render: (num: string, record: LinkedInvoice) => (
                              <Space size="small">
                                <Tag color={record.invoice_type === 'supplier' ? 'orange' : 'blue'}>
                                  {num}
                                </Tag>
                                <Tooltip title={t('bankAccountDetail.openInvoice')}>
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<EyeOutlined />}
                                    onClick={() => {
                                      const docType = record.invoice_type === 'supplier' ? 'supplier-invoice' : 'invoice'
                                      openDocumentTab(docType, record.invoice_id, num)
                                    }}
                                  />
                                </Tooltip>
                              </Space>
                            ),
                          },
                          {
                            title: t('bankAccountDetail.clientSupplier'),
                            key: 'contact',
                            render: (_: unknown, record: LinkedInvoice) => record.client_name || record.supplier_name,
                          },
                          {
                            title: t('bankAccountDetail.totalTTC'),
                            dataIndex: 'invoice_total',
                            key: 'invoice_total',
                            width: 120,
                            align: 'right' as const,
                            render: (amount: number) => montantFr(amount),
                          },
                          {
                            title: t('bankAccountDetail.amountPaid'),
                            dataIndex: 'amount',
                            key: 'amount',
                            width: 120,
                            align: 'right' as const,
                            render: (amount: number) => (
                              <Text type="success">
                                {montantFr(amount)}
                              </Text>
                            ),
                          },
                          {
                            title: t('bankAccountDetail.remainingBalance'),
                            key: 'remaining',
                            width: 120,
                            align: 'right' as const,
                            render: (_: unknown, record: LinkedInvoice) => {
                              const remaining = record.invoice_total - record.amount
                              return (
                                <Text type={remaining > 0 ? 'warning' : 'success'}>
                                  {montantFr(remaining)}
                                </Text>
                              )
                            },
                          },
                          // Délier un rapprochement SUPPRIME le règlement qu'il
                          // portait et rend la facture due : même droit que le
                          // reste, et non le seul état de brouillon du relevé.
                          ...(isStatementDraft && montrerLesEcritures ? [{
                            title: '',
                            key: 'actions',
                            width: 50,
                            render: (_: unknown, record: LinkedInvoice) => (
                              <Popconfirm
                                title={t('bankAccountDetail.deleteLinkConfirm')}
                                description={t('bankAccountDetail.deleteLinkDescription')}
                                onConfirm={() => deleteLineInvoiceMutation.mutate(record.id)}
                                okText={t('common.yes')}
                                cancelText={t('common.no')}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  loading={deleteLineInvoiceMutation.isPending}
                                />
                              </Popconfirm>
                            ),
                          }] : []),
                        ]}
                        style={{ backgroundColor: '#fff' }}
                      />
                    ) : (
                      <div style={{ padding: 16, backgroundColor: '#fff', borderRadius: 4, textAlign: 'center' }}>
                        <Text type="secondary">{t('bankAccountDetail.noLinkedInvoice')}</Text>
                      </div>
                    )}
                  </div>
                )
              })()}
            </Card>
          ) : (
            <Card>
              <Empty description={t('bankAccountDetail.selectStatement')} />
            </Card>
          )}
        </Col>
      </Row>

      {/* Statement Modal - Edit only */}
      <Modal
        title={t('bankAccountDetail.editStatement')}
        open={statementModalVisible}
        onOk={handleStatementSubmit}
        onCancel={() => {
          setStatementModalVisible(false)
          setEditingStatement(null)
          statementForm.resetFields()
        }}
        okText={t('bankAccountDetail.update')}
        cancelText={t('common.cancel')}
        confirmLoading={updateStatementMutation.isPending}
      >
        <Form form={statementForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="date"
            label={t('bankAccountDetail.statementDate')}
            rules={[{ required: true, message: t('bankAccountDetail.dateRequired') }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="notes" label={t('bankAccountDetail.notes')}>
            <TextArea rows={3} placeholder={t('bankAccountDetail.internalNotesPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Line Modal */}
      <Modal
        title={editingLine ? t('bankAccountDetail.editLine') : t('bankAccountDetail.newLine')}
        open={lineModalVisible}
        onOk={handleLineSubmit}
        onCancel={() => {
          setLineModalVisible(false)
          setEditingLine(null)
          setSelectedInvoiceType(null)
          setSelectedInvoices([])
          setFilterContactId(null)
          setInvoiceSearchText('')
          setTransferAccountId(null)
          lineForm.resetFields()
        }}
        okText={editingLine ? t('bankAccountDetail.update') : t('bankAccountDetail.add')}
        cancelText={t('common.cancel')}
        confirmLoading={addLineMutation.isPending || updateLineMutation.isPending}
        width={700}
      >
        <Form form={lineForm} layout="vertical" style={{ marginTop: 16 }}>
          {/* Invoice linking section */}
          <Card size="small" style={{ marginBottom: 16, backgroundColor: '#f6ffed' }}>
            {/* Search field */}
            <Form.Item label={t('bankAccountDetail.searchByContact')} style={{ marginBottom: 12 }}>
              <Input
                placeholder={t('bankAccountDetail.searchContactPlaceholder')}
                prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
                value={invoiceSearchText}
                onChange={(e) => setInvoiceSearchText(e.target.value)}
                allowClear
                disabled={selectedInvoices.length > 0 || !!transferAccountId}
              />
              {selectedInvoices.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('bankAccountDetail.searchDisabled')}
                </Text>
              )}
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="client_invoice_id"
                  label={t('bankAccountDetail.addClientInvoice')}
                  tooltip={t('bankAccountDetail.addClientInvoiceTooltip')}
                >
                  <Select
                    placeholder={t('bankAccountDetail.selectClientInvoice')}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    disabled={selectedInvoiceType === 'supplier' || !!transferAccountId}
                    onChange={(id) => id && handleAddInvoice(id, 'client')}
                    value={undefined}
                    options={getFilteredInvoices(clientInvoicesData)
                      .filter(inv => !selectedInvoices.some(si => si.invoice_id === inv.id))
                      .map(inv => ({
                        value: inv.id,
                        label: `${inv.number} - ${inv.contact_name} (${montantFr(inv.remaining_amount)})`,
                      }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="supplier_invoice_id"
                  label={t('bankAccountDetail.addSupplierInvoice')}
                  tooltip={t('bankAccountDetail.addSupplierInvoiceTooltip')}
                >
                  <Select
                    placeholder={t('bankAccountDetail.selectSupplierInvoice')}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    disabled={selectedInvoiceType === 'client' || !!transferAccountId}
                    onChange={(id) => id && handleAddInvoice(id, 'supplier')}
                    value={undefined}
                    options={getFilteredInvoices(supplierInvoicesData)
                      .filter(inv => !selectedInvoices.some(si => si.invoice_id === inv.id))
                      .map(inv => ({
                        value: inv.id,
                        label: `${inv.number} - ${inv.contact_name} (${montantFr(inv.remaining_amount)})`,
                      }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* Selected invoices table */}
            {selectedInvoices.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text strong style={{ marginBottom: 8, display: 'block' }}>
                  {t('bankAccountDetail.selectedInvoices', { count: selectedInvoices.length })}
                  {filterContactId && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>{filterContactId}</Tag>
                  )}
                </Text>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={selectedInvoices}
                  rowKey="invoice_id"
                  columns={[
                    {
                      title: t('bankAccountDetail.invoice'),
                      dataIndex: ['invoice', 'number'],
                      key: 'number',
                      width: 120,
                    },
                    {
                      title: t('bankAccountDetail.contact'),
                      dataIndex: ['invoice', 'contact_name'],
                      key: 'contact',
                    },
                    {
                      title: t('bankAccountDetail.remainingDue'),
                      dataIndex: ['invoice', 'remaining_amount'],
                      key: 'remaining',
                      width: 120,
                      align: 'right' as const,
                      render: (amount: number) => montantFr(amount),
                    },
                    {
                      title: t('bankAccountDetail.amountPaid'),
                      dataIndex: 'amount',
                      key: 'amount',
                      width: 140,
                      render: (amount: number, record: SelectedInvoice) => (
                        <InputNumber
                          size="small"
                          value={amount}
                          min={0.01}
                          max={record.invoice.remaining_amount}
                          precision={2}
                          style={{ width: '100%' }}
                          onChange={(val) => handleInvoiceAmountChange(record.invoice_id, val || 0)}
                        />
                      ),
                    },
                    {
                      title: '',
                      key: 'actions',
                      width: 50,
                      render: (_: unknown, record: SelectedInvoice) => (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleRemoveInvoice(record.invoice_id)}
                        />
                      ),
                    },
                  ]}
                />
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Text strong>
                    {t('common.total')}: {montantFr(selectedInvoices.reduce((sum, si) => sum + si.amount, 0))}
                  </Text>
                </div>
              </div>
            )}

            {selectedInvoiceType && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                {selectedInvoiceType === 'client'
                  ? t('bankAccountDetail.autoCollectionsNote')
                  : t('bankAccountDetail.autoPaymentsNote')}
              </Text>
            )}
          </Card>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="date"
                label={t('common.date')}
                rules={[{ required: true, message: t('bankAccountDetail.dateRequired') }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="value_date" label={t('bankAccountDetail.valueDate')}>
                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reference" label={t('bankAccountDetail.reference')}>
            <Input placeholder={t('bankAccountDetail.bankReferencePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="label"
            label={t('bankAccountDetail.lineLabel')}
            rules={[{ required: true, message: t('bankAccountDetail.labelRequired') }]}
          >
            <Input placeholder={t('bankAccountDetail.operationDescriptionPlaceholder')} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="debit" label={t('bankAccountDetail.debitEUR')}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  placeholder="0.00"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="credit" label={t('bankAccountDetail.creditEUR')}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  placeholder="0.00"
                />
              </Form.Item>
            </Col>
          </Row>
          <Card
            size="small"
            title={t('bankAccountDetail.transferSection')}
            style={{ marginBottom: 16, backgroundColor: '#f0f5ff' }}
          >
            <Form.Item label={t('bankAccountDetail.transferAccount')} style={{ marginBottom: 8 }}>
              <Select
                allowClear
                value={transferAccountId || undefined}
                onChange={(value) => setTransferAccountId(value || null)}
                placeholder={t('bankAccountDetail.transferPlaceholder')}
                options={otherAccounts.map((a) => ({
                  value: a.id,
                  label:
                    a.kind === 'gateway'
                      ? `${a.label} (${t('bankAccountDetail.gatewayAccount')})`
                      : a.label,
                }))}
              />
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {t('bankAccountDetail.transferHelp')}
            </Text>
            {transferAccountId && (
              <Text type="warning" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                {t('bankAccountDetail.transferExcludes')}
              </Text>
            )}
          </Card>

          <Form.Item name="category" label={t('bankAccountDetail.category')}>
            <Select
              placeholder={t('bankAccountDetail.categoryPlaceholder')}
              allowClear
              options={[
                { value: 'virement', label: t('bankAccountDetail.categoryTransfer') },
                { value: 'prelevement', label: t('bankAccountDetail.categoryDirectDebit') },
                { value: 'cheque', label: t('bankAccountDetail.categoryCheque') },
                { value: 'carte', label: t('bankAccountDetail.categoryCard') },
                { value: 'frais', label: t('bankAccountDetail.categoryBankFees') },
                { value: 'autre', label: t('bankAccountDetail.categoryOther') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
