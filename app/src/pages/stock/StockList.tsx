import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  Button,
  Input,
  Tag,
  Tabs,
  Card,
  Statistic,
  Row,
  Col,
  Modal,
  Form,
  Select,
  InputNumber,
  message,
  Popconfirm,
  Space,
  Tooltip,
  DatePicker,
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { PlusOutlined, SearchOutlined, WarningOutlined, MailOutlined, HomeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { SorterResult } from 'antd/es/table/interface'
import { stockAPI, articleAPI } from '@/services/api'
import { useDocumentTabsStore } from '@/stores/documentTabsStore'
import { usePermissionStore } from '@/stores/permissionStore'
import WarehouseSettings from '@/pages/settings/WarehouseSettings'

interface StockLevel {
  id: string
  article_id: string
  warehouse_id: string
  quantity: number
  reserved_quantity: number
  min_threshold?: number
  max_threshold?: number
  article?: { id: string; code: string; name: string; sale_price: number }
  warehouse?: { id: string; name: string; code?: string }
}

interface StockMovement {
  id: string
  article_id: string
  warehouse_id: string
  type: string
  quantity: number
  reference?: string
  notes?: string
  created_at: string
  article?: { id: string; code: string; name: string }
}

interface StockAlert {
  article_id: string
  article_name: string
  article_code: string
  warehouse_id: string
  warehouse_name: string
  current_quantity: number
  min_threshold: number
  alert_type: string  // 'low_stock' | 'out_of_stock'
}

interface Article {
  id: string
  code: string
  name: string
  type?: string
  stock_managed?: boolean
}

interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    page_size: number
    total_items: number
    total_pages: number
  }
}

interface StockLevelsResponse extends PaginatedResponse<StockLevel> {
  /**
   * Agrégats calculés par le SERVEUR sur toute la sélection, hors pagination.
   * Absents tant que /stock/levels ne les rend pas — voir plus bas.
   */
  totals?: {
    stock_value?: number
    articles_count?: number
  }
}

/**
 * ⚠️ L'HEURE ARRIVE EN UTC, SANS LE DIRE.
 *
 * created_at sort de la base au format « YYYY-MM-DD HH:MM:SS », que V8
 * interprète comme une heure LOCALE : un mouvement saisi à 20 h 56 s'affichait
 * 18 h 56 en France. On rétablit donc le marqueur de fuseau quand la chaîne
 * n'en porte pas ; une chaîne déjà en ISO 8601 (avec « T », « Z » ou un
 * décalage) est laissée telle quelle — le jour où le serveur en renverra une,
 * rien ici ne sera à défaire.
 */
const parseServerDate = (dateStr: string) => {
  const hasZone = /[TZ]|[+-]\d{2}:?\d{2}$/.test(dateStr)

  return new Date(hasZone ? dateStr : `${dateStr.replace(' ', 'T')}Z`)
}

/**
 * Le motif du refus tel que le serveur le formule.
 *
 * WordPress sérialise ses WP_Error en { code, message, data: { status } } ;
 * l'ancien SaaS parlait, lui, de « error ». Les deux graphies sont lues ici une
 * fois pour toutes.
 */
type StockMutationError = { response?: { data?: { message?: string; error?: string } } }

const errorMessage = (error: StockMutationError): string =>
  error?.response?.data?.message || error?.response?.data?.error || ''

/**
 * Une quantité telle qu'elle est réellement stockée.
 *
 * ⚠️ La base tient six décimales, l'écran n'en affichait que deux : un
 * mouvement de 0,001 s'affichait « +0.00 » — donc nul — et un niveau de
 * 16,003000 s'affichait « 16.00 ». Un stock pouvait paraître rond sans l'être,
 * et un mouvement paraître sans effet alors qu'il avait bougé le stock. On
 * garde les deux décimales habituelles quand elles suffisent, et on montre le
 * reste quand il existe.
 */
const formatQty = (v?: number | null): string => {
  if (v === undefined || v === null || Number.isNaN(v)) return '-'

  const arrondi = Math.round(v * 100) / 100

  return arrondi === v ? v.toFixed(2) : v.toFixed(6).replace(/0+$/, '')
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '-'
  return parseServerDate(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * L'ordre demandé par un en-tête, dans le vocabulaire du serveur.
 *
 * ⚠️ LE TRI NE PEUT PAS ÊTRE CELUI DU NAVIGATEUR. Les deux tableaux sont
 * paginés par le serveur : trier les dix lignes reçues ferait croire que
 * l'article le plus fourni de la base est en tête de liste. La colonne cliquée
 * part donc dans la requête, et c'est le SQL qui ordonne.
 */
type Tri = { sort?: string; order?: 'asc' | 'desc' }

function lireTri<T>(sorter: SorterResult<T> | SorterResult<T>[]): Tri {
  const premier = Array.isArray(sorter) ? sorter[0] : sorter

  if (!premier?.order || !premier.columnKey) return {}

  return { sort: String(premier.columnKey), order: premier.order === 'descend' ? 'desc' : 'asc' }
}

export default function StockList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // ⚠️ « VOIR TOUT » DOIT ARRIVER SUR LE BON SOUS-ONGLET.
  //
  // Le sous-onglet était un état purement local : le lien « Voir tout » de la
  // carte « Articles en alerte » du tableau de bord ouvrait bien l'écran Stock,
  // mais sur « Niveaux », et le lecteur n'avait aucun moyen de deviner que ce
  // qu'il cherchait vivait deux onglets plus loin. Il voyage désormais dans le
  // metadata de l'onglet (documentTabsStore.openStaticTab(type, sousOnglet)).
  //
  // C'est le metadata (l'OBJET) qu'on observe et non la seule chaîne : sa
  // référence change à chaque appel d'openStaticTab, ce qui fait revenir sur
  // « Alertes » même quand l'onglet Stock est déjà ouvert et qu'on l'a quitté
  // entre-temps. Sur la chaîne seule, un second clic n'aurait rien fait.
  const demandeOnglet = useDocumentTabsStore(
    (etat) =>
      etat.tabs.find((o) => o.type === 'static' && o.staticType === 'stock')?.metadata
  )
  const sousOngletDemande = demandeOnglet?.sousOnglet as string | undefined

  // L'onglet « Entrepôts » monte WarehouseSettings, dont TOUTES les écritures
  // exigent « amsbm_manage_settings » — un référentiel se modifie avec les droits
  // des réglages, et c'est volontaire (Warehouses::writePermission). L'offrir au
  // magasinier ne lui donnait que des boutons qui refusent.
  const peutGererLesReglages = usePermissionStore((etat) => etat.hasAccess('settings'))

  const [activeTab, setActiveTab] = useState(sousOngletDemande || 'levels')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  const [triNiveaux, setTriNiveaux] = useState<Tri>({})
  const [triMouvements, setTriMouvements] = useState<Tri>({})
  // L'onglet Mouvements n'offrait ni recherche ni filtre : sur un historique de
  // 166 lignes, retrouver les sorties d'un article demandait de tourner les
  // pages une à une.
  const [moveSearch, setMoveSearch] = useState('')
  const [moveType, setMoveType] = useState<string | undefined>()
  const [movementModalOpen, setMovementModalOpen] = useState(false)
  const [editingMovement, setEditingMovement] = useState<StockMovement | null>(null)
  const [form] = Form.useForm()
  const [alertFilter, setAlertFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all')
  const [alertSearch, setAlertSearch] = useState('')
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailForm] = Form.useForm()

  // L'état initial ne suffit pas : quand l'onglet Stock est DÉJÀ ouvert, le
  // composant est monté depuis longtemps (MainLayout garde tous les onglets en
  // display:none) et seul cet effet le fait suivre la nouvelle demande.
  useEffect(() => {
    if (!sousOngletDemande) return

    setActiveTab(sousOngletDemande)
    setPage(1)
  }, [demandeOnglet, sousOngletDemande])

  // ⚠️ ÉCHAP NE FERMAIT AUCUNE DES DEUX FENÊTRES.
  //
  // antd n'écoute la touche que sur l'enveloppe de la modale : elle ne se
  // referme donc que si le focus est passé DEDANS, ce qui n'arrive qu'à la fin
  // de l'animation d'ouverture. Quand celle-ci ne se joue pas — animations
  // coupées, navigateur piloté —, la frappe part sur le corps du document et
  // n'atteint jamais l'écouteur : seule la croix fermait la fenêtre. On écoute
  // donc au niveau du document, en laissant la main aux listes déroulantes
  // ouvertes, pour lesquelles Échap veut dire « referme la liste ».
  useEffect(() => {
    if (!movementModalOpen && !emailModalOpen) return

    const auClavier = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Une liste déroulante ouverte, un sélecteur de date ou une demande de
      // confirmation par-dessus se ferment d'abord : Échap leur appartient.
      if (document.querySelector('.ant-select-open, .ant-picker-focused, .ant-modal-confirm')) return

      if (movementModalOpen) {
        setMovementModalOpen(false)
        setEditingMovement(null)
        form.resetFields()
      }

      if (emailModalOpen) {
        setEmailModalOpen(false)
        emailForm.resetFields()
      }
    }

    document.addEventListener('keydown', auClavier)
    return () => document.removeEventListener('keydown', auClavier)
  }, [movementModalOpen, emailModalOpen, form, emailForm])

  // Fetch stock levels
  const { data: levelsData, isLoading: levelsLoading } = useQuery<StockLevelsResponse>({
    queryKey: ['stock-levels', page, pageSize, search, triNiveaux],
    queryFn: async () => {
      const response = await stockAPI.getLevels({
        page,
        page_size: pageSize,
        search: search || undefined,
        ...triNiveaux,
      })
      return response.data
    },
    enabled: activeTab === 'levels',
  })

  // Fetch stock movements
  const { data: movementsData, isLoading: movementsLoading } = useQuery<PaginatedResponse<StockMovement>>({
    queryKey: ['stock-movements', page, pageSize, triMouvements, moveSearch, moveType],
    queryFn: async () => {
      const response = await stockAPI.getMovements({
        page,
        page_size: pageSize,
        search: moveSearch || undefined,
        type: moveType,
        ...triMouvements,
      })
      return response.data
    },
    enabled: activeTab === 'movements',
  })

  // Fetch alerts
  const { data: alertsData } = useQuery<StockAlert[]>({
    queryKey: ['stock-alerts'],
    queryFn: async () => {
      const response = await stockAPI.getAlerts()
      return response.data
    },
  })

  // Check if email service is configured
  const { data: emailStatus } = useQuery<{ configured: boolean }>({
    queryKey: ['stock-alerts-email-status'],
    queryFn: async () => {
      const response = await stockAPI.getEmailStatus()
      return response.data
    },
  })

  // Send alerts email mutation
  const sendEmailMutation = useMutation({
    mutationFn: (email: string) => stockAPI.sendAlertsEmail(email),
    onSuccess: (response) => {
      // ⚠️ Le retour nominal du serveur ne porte NI message NI alerts_count : le
      // toast annonçait « undefined (2 alertes) ». On n'affiche que ce qui
      // existe, et on retombe sur le nombre d'alertes connu de l'écran.
      const data = response.data as { message?: string; alerts_count?: number; sent?: number }
      const count = data.alerts_count ?? alertsData?.length ?? 0
      const suffix = t('stock.alertsCountSuffix', { count })
      message.success(data.message ? `${data.message} (${suffix})` : suffix)
      setEmailModalOpen(false)
      emailForm.resetFields()
    },
    onError: (error: StockMutationError) => {
      message.error(errorMessage(error) || t('stock.emailSendError'))
    },
  })

  // Fetch articles for movement form
  //
  // ⚠️ SEULS LES ARTICLES QUI SE STOCKENT.
  //
  // La liste était demandée sans le moindre filtre : elle proposait les
  // services et les articles sans gestion de stock, et le serveur acceptait le
  // mouvement. On créait ainsi un niveau de stock sur une prestation — compté
  // dans la valeur du stock, mais jamais dans les alertes, qui n'écoutent que
  // les articles stockables. Les deux onglets du même écran se contredisaient.
  const { data: articlesData } = useQuery<PaginatedResponse<Article>>({
    queryKey: ['articles-for-stock'],
    queryFn: async () => {
      const response = await articleAPI.list({ page: 1, page_size: 100, type: 'product' })
      return response.data
    },
  })

  // Un produit peut malgré tout être suivi « hors stock » : le filtre du
  // serveur ne porte que sur le type, celui-ci sur la gestion de stock.
  const stockableArticles = (articlesData?.data || []).filter((a) => a.stock_managed !== false)

  // Fetch warehouses for movement form
  const { data: warehousesData } = useQuery<{ id: string; code: string; name: string; is_default: boolean }[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const response = await stockAPI.getWarehouses()
      return response.data
    },
  })

  // Create movement mutation
  const createMovementMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => stockAPI.createMovement(data),
    onSuccess: () => {
      message.success(t('stock.movementCreated'))
      setMovementModalOpen(false)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] })
    },
    // ⚠️ LE MOTIF DU REFUS, PAS UN TEXTE PASSE-PARTOUT.
    //
    // Les trois onError de cet écran ne recevaient même pas l'erreur : un droit
    // manquant, un code en double et une quantité nulle donnaient tous
    // « Erreur lors de la création du mouvement », et l'utilisateur n'avait
    // aucun moyen de savoir ce qu'on lui reprochait.
    onError: (error: StockMutationError) => {
      message.error(errorMessage(error) || t('stock.movementCreateError'))
    },
  })

  // Update movement mutation
  const updateMovementMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => stockAPI.updateMovement(id, data),
    onSuccess: () => {
      message.success(t('stock.movementUpdated'))
      setMovementModalOpen(false)
      setEditingMovement(null)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] })
    },
    onError: (error: StockMutationError) => {
      message.error(errorMessage(error) || t('stock.movementUpdateError'))
    },
  })

  // Delete movement mutation
  const deleteMovementMutation = useMutation({
    mutationFn: (id: string) => stockAPI.deleteMovement(id),
    onSuccess: () => {
      message.success(t('stock.movementDeleted'))
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] })
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] })
    },
    onError: (error: StockMutationError) => {
      message.error(errorMessage(error) || t('stock.movementDeleteError'))
    },
  })

  // Calculate stats
  //
  // ⚠️ LES AGRÉGATS VIENNENT DU SERVEUR, ET DE NULLE PART AILLEURS.
  //
  // La valeur du stock était la somme de la PAGE AFFICHÉE : le même stock
  // valait 3 275,62 EUR en pages de 10 et 370,00 EUR en pages de 2. Elle était
  // en outre calculée au prix de VENTE, ce qui la gonflait de toute la marge —
  // un stock valorisé 2,5 fois son coût. Les deux se corrigent au même endroit,
  // et cet endroit est le serveur : lui seul voit la sélection entière, et lui
  // seul connaît le prix d'achat, que /stock/levels n'expose même pas.
  //
  // Tant que la route ne rend pas 'totals', on affiche un tiret. Un chiffre
  // faux mais plausible est pire que pas de chiffre du tout : celui-là, au
  // moins, ne se retrouve pas recopié dans un tableau de bord. Le changement
  // attendu côté src/Rest/Stock.php est décrit dans recette/correctifs/handoff/L5.md.
  const stockValue = levelsData?.totals?.stock_value
  // Même remarque pour le compte : total_items compte les couples
  // article × entrepôt, donc deux fois un article stocké dans deux dépôts.
  const totalArticles = levelsData?.totals?.articles_count ?? levelsData?.pagination?.total_items ?? 0
  const alertsCount = alertsData?.filter((a) => a.alert_type === 'low_stock').length || 0
  const outOfStockCount = alertsData?.filter((a) => a.alert_type === 'out_of_stock').length || 0

  // Filter alerts based on search and type filter
  const filteredAlerts = alertsData?.filter((alert) => {
    // Type filter
    if (alertFilter !== 'all' && alert.alert_type !== alertFilter) {
      return false
    }
    // Search filter
    if (alertSearch) {
      const searchLower = alertSearch.toLowerCase()
      return (
        alert.article_code.toLowerCase().includes(searchLower) ||
        alert.article_name.toLowerCase().includes(searchLower) ||
        alert.warehouse_name?.toLowerCase().includes(searchLower)
      )
    }
    return true
  }) || []

  const handleCreateMovement = async (values: {
    article_id: string
    warehouse_id?: string
    type: string
    quantity: number
    reference?: string
    notes?: string
    date?: Dayjs
  }) => {
    // If no warehouse specified, use the default warehouse from stock levels
    const warehouseId = values.warehouse_id || levelsData?.data?.[0]?.warehouse_id || undefined
    // ⚠️ LA DATE DU MOUVEMENT, ET NON CELLE DU CLIC.
    //
    // La fenêtre n'offrait aucun sélecteur de date : tout mouvement était
    // horodaté à l'instant de la saisie, et une réception de la veille était
    // donc impossible à enregistrer à sa date.
    const data = { ...values, warehouse_id: warehouseId, date: values.date?.toISOString() }

    if (editingMovement) {
      // ⚠️ RÉÉCRIRE UN MOUVEMENT N'EST PAS ANODIN.
      //
      // Un mouvement est un fait daté — c'est ce que dit le code du serveur
      // juste au-dessus de la méthode qui le modifie. La correction passait
      // sans un mot : la ligne d'origine était réécrite, le niveau recalculé,
      // et rien ne gardait trace de ce qui avait été changé. Faute d'un
      // journal, on demande au moins confirmation.
      Modal.confirm({
        title: t('stock.confirmEditTitle', 'Modifier un mouvement déjà enregistré ?'),
        content: t(
          'stock.confirmEditContent',
          "Un mouvement de stock est un fait daté : la ligne d'origine sera réécrite et le niveau recalculé, sans trace de la valeur précédente."
        ),
        okText: t('common.confirm', 'Confirmer'),
        cancelText: t('common.cancel'),
        onOk: () => updateMovementMutation.mutate({ id: editingMovement.id, data }),
      })

      return
    }

    const avertissements: string[] = []

    // ⚠️ UNE QUANTITÉ ABERRANTE SE SIGNALE.
    //
    // Une entrée de 1 000 000 a été acceptée sans un mot : le niveau est passé
    // à 1 000 016 et la tuile « Valeur du stock » a affiché 25 005 104,65 EUR à
    // tous les utilisateurs. Le champ n'a aucun maximum, et il n'en aura pas —
    // un stock peut légitimement se compter en centaines de milliers ; mais on
    // demande confirmation plutôt que d'enregistrer un zéro de trop.
    if (values.quantity >= 100000) {
      avertissements.push(
        t('stock.confirmHugeQuantity', 'La quantité saisie est très élevée : {{qty}}.', {
          qty: formatQty(values.quantity),
        })
      )
    }

    // ⚠️ UN STOCK QUI PASSE EN NÉGATIF SE DIT.
    //
    // Une sortie de 100 sur un article qui en détenait 10 passait en silence :
    // le niveau tombait à -90 et s'affichait tel quel. Autoriser le négatif se
    // défend — la marchandise est parfois sortie avant d'être saisie — mais un
    // magasinier qui se trompe de zéro ne le savait jamais.
    if (values.type === 'out' && warehouseId) {
      try {
        const reponse = await stockAPI.getLevels({ article_id: values.article_id, warehouse_id: warehouseId })
        const ligne = ((reponse.data?.data || []) as StockLevel[])[0]
        const dispo = ligne ? (ligne.quantity || 0) - (ligne.reserved_quantity || 0) : 0

        if (values.quantity > dispo) {
          avertissements.push(
            t('stock.confirmNegativeStock', 'Il ne reste que {{dispo}} en stock : le niveau passera à {{apres}}.', {
              dispo: formatQty(dispo),
              apres: formatQty(dispo - values.quantity),
            })
          )
        }
      } catch {
        // Le niveau n'a pas pu être relu : on n'empêche pas la saisie pour
        // autant, l'avertissement est un garde-fou, pas une condition.
      }
    }

    if (avertissements.length > 0) {
      Modal.confirm({
        title: t('stock.confirmMovementTitle', 'Confirmer ce mouvement ?'),
        content: avertissements.join(' '),
        okText: t('common.confirm', 'Confirmer'),
        cancelText: t('common.cancel'),
        onOk: () => createMovementMutation.mutate(data),
      })

      return
    }

    createMovementMutation.mutate(data)
  }

  const levelColumns = [
    {
      title: t('stock.colArticle'),
      key: 'article',
      sorter: true,
      render: (_: unknown, record: StockLevel) => record.article?.name || '-',
    },
    {
      title: t('stock.colCode'),
      key: 'code',
      sorter: true,
      render: (_: unknown, record: StockLevel) => record.article?.code || '-',
    },
    {
      title: t('stock.colWarehouse'),
      key: 'warehouse',
      sorter: true,
      // ⚠️ LE CODE, PAS SEULEMENT LE NOM.
      //
      // Deux entrepôts peuvent porter le même nom — le jeu de départ en a deux
      // qui s'appellent « Dépôt principal » (MAIN et PRIN) — et un article
      // stocké dans les deux donnait deux lignes rigoureusement identiques à
      // l'œil. La fenêtre de saisie, elle, montre bien « MAIN - … ».
      render: (_: unknown, record: StockLevel) =>
        record.warehouse?.code ? `${record.warehouse.code} - ${record.warehouse.name}` : record.warehouse?.name || '-',
    },
    {
      title: t('stock.colQuantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      sorter: true,
      render: (v: number) => formatQty(v),
    },
    {
      // ⚠️ CETTE COLONNE NE SE REMPLIT QUE PAR LA BOUTIQUE, ET IL FAUT LE DIRE.
      //
      // Aucun document de l'ERP — devis, commande, facture — ne réserve quoi
      // que ce soit : le seul appelant de StockService::hold() est le pont
      // WooCommerce. La colonne affichait donc 0,00 partout et « Disponible »
      // recopiait « Quantité », en laissant croire à un calcul qui n'a pas
      // lieu. Faire réserver les documents est un choix produit, pas une
      // correction d'écran ; en attendant, l'infobulle dit ce qui alimente la
      // colonne au lieu de laisser deviner.
      title: (
        <Tooltip
          title={t(
            'stock.reservedTooltip',
            "Seules les commandes de la boutique réservent du stock : les devis et factures de l'ERP n'en posent pas."
          )}
        >
          <span style={{ borderBottom: '1px dotted #bfbfbf' }}>{t('stock.colReserved')}</span>
        </Tooltip>
      ),
      dataIndex: 'reserved_quantity',
      key: 'reserved',
      sorter: true,
      render: (v: number) => formatQty(v),
    },
    {
      title: t('stock.colAvailable'),
      key: 'available',
      sorter: true,
      render: (_: unknown, record: StockLevel) =>
        formatQty((record.quantity || 0) - (record.reserved_quantity || 0)),
    },
    {
      title: t('stock.colMinThreshold'),
      dataIndex: 'min_threshold',
      key: 'min_threshold',
      sorter: true,
      render: (v?: number) => formatQty(v) || '-',
    },
    {
      title: t('common.status'),
      key: 'status',
      sorter: true,
      render: (_: unknown, record: StockLevel) => {
        // ⚠️ LE DISPONIBLE, PAS LA QUANTITÉ BRUTE.
        //
        // Le statut se calculait sur la seule quantité, alors que l'onglet
        // Alertes compare le disponible (quantité - réservé) au seuil : la même
        // ligne portait un « OK » vert ici et une « Rupture » rouge là, avec sa
        // colonne « Disponible » à 0,00 deux colonnes plus à gauche.
        const dispo = (record.quantity || 0) - (record.reserved_quantity || 0)

        if (dispo <= 0) {
          return <Tag color="red">{t('stock.statusOutOfStock')}</Tag>
        }
        if (record.min_threshold && dispo <= record.min_threshold) {
          return <Tag color="orange">{t('stock.statusLowStock')}</Tag>
        }
        return <Tag color="green">{t('stock.statusOk')}</Tag>
      },
    },
  ]

  const movementColumns = [
    {
      title: t('common.date'),
      dataIndex: 'created_at',
      key: 'date',
      sorter: true,
      render: formatDate,
    },
    {
      title: t('stock.colArticle'),
      key: 'article',
      sorter: true,
      render: (_: unknown, record: StockMovement) =>
        record.article?.name || '-',
    },
    {
      title: t('stock.colType'),
      dataIndex: 'type',
      key: 'type',
      sorter: true,
      render: (type: string) => {
        const colors: Record<string, string> = {
          in: 'green',
          out: 'red',
          transfer: 'blue',
          adjustment: 'orange',
        }
        const labels: Record<string, string> = {
          in: t('stock.typeIn'),
          out: t('stock.typeOut'),
          transfer: t('stock.typeTransfer'),
          adjustment: t('stock.typeAdjustment'),
        }
        return <Tag color={colors[type]}>{labels[type] || type}</Tag>
      },
    },
    {
      title: t('stock.colQuantity'),
      dataIndex: 'quantity',
      key: 'quantity',
      sorter: true,
      render: (v: number, record: StockMovement) => {
        const sign = record.type === 'in' ? '+' : record.type === 'out' ? '-' : ''
        return `${sign}${formatQty(v)}`
      },
    },
    { title: t('stock.colReference'), dataIndex: 'reference', key: 'reference', sorter: true },
    { title: t('stock.colNotes'), dataIndex: 'notes', key: 'notes' },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 100,
      render: (_: unknown, record: StockMovement) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            size="small"
            onClick={() => {
              setEditingMovement(record)
              form.setFieldsValue({
                article_id: record.article_id,
                warehouse_id: record.warehouse_id,
                type: record.type,
                quantity: record.quantity,
                reference: record.reference,
                notes: record.notes,
              })
              setMovementModalOpen(true)
            }}
          />
          <Popconfirm
            title={t('stock.deleteMovementTitle')}
            description={t('stock.deleteMovementDescription')}
            onConfirm={() => deleteMovementMutation.mutate(record.id)}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              icon={<DeleteOutlined />}
              size="small"
              danger
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'levels',
      label: t('stock.tabLevels'),
      children: (
        <div>
          {/*
            ⚠️ LA RECHERCHE EST CELLE DES NIVEAUX, ET DE RIEN D'AUTRE.
            Elle était rendue hors des onglets, donc visible sur les quatre :
            sur « Mouvements », taper dedans ne déclenchait rien — la requête
            des mouvements ne l'envoie pas et sa clé de cache ne la contient
            pas — et l'onglet « Alertes » avait la sienne juste en dessous.
          */}
          <div style={{ marginBottom: 16 }}>
            <Input
              placeholder={t('stock.searchPlaceholder')}
              prefix={<SearchOutlined />}
              style={{ width: 300 }}
              allowClear
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Table
            dataSource={levelsData?.data || []}
            columns={levelColumns}
            rowKey="id"
            loading={levelsLoading}
            onChange={(_pagination, _filtres, sorter) => {
              const tri = lireTri(sorter as SorterResult<StockLevel> | SorterResult<StockLevel>[])

              // Le tableau appelle onChange pour la pagination aussi : sans ce
              // test, changer de page ramènerait toujours à la première.
              if (tri.sort !== triNiveaux.sort || tri.order !== triNiveaux.order) {
                setTriNiveaux(tri)
                setPage(1)
              }
            }}
            pagination={{
              current: page,
              pageSize: pageSize,
              total: levelsData?.pagination?.total_items || 0,
              showSizeChanger: true,
              showTotal: (total) => t('stock.totalRows', { count: total }),
              onChange: (p, ps) => {
                setPage(p)
                setPageSize(ps)
              },
            }}
          />
        </div>
      ),
    },
    {
      key: 'movements',
      label: t('stock.tabMovements'),
      children: (
        <div>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
          <Input
            placeholder={t('stock.searchMovementPlaceholder', 'Article, code ou référence…')}
            prefix={<SearchOutlined />}
            style={{ width: 300 }}
            allowClear
            value={moveSearch}
            onChange={(e) => {
              setMoveSearch(e.target.value)
              setPage(1)
            }}
          />
          <Select
            placeholder={t('stock.movementType')}
            allowClear
            style={{ width: 200 }}
            value={moveType}
            onChange={(value) => {
              setMoveType(value)
              setPage(1)
            }}
            options={[
              { value: 'in', label: t('stock.typeIn') },
              { value: 'out', label: t('stock.typeOut') },
              { value: 'adjustment', label: t('stock.typeAdjustment') },
              { value: 'transfer', label: t('stock.typeTransfer') },
            ]}
          />
        </div>
        <Table
          dataSource={movementsData?.data || []}
          columns={movementColumns}
          rowKey="id"
          loading={movementsLoading}
          onChange={(_pagination, _filtres, sorter) => {
            const tri = lireTri(sorter as SorterResult<StockMovement> | SorterResult<StockMovement>[])

            if (tri.sort !== triMouvements.sort || tri.order !== triMouvements.order) {
              setTriMouvements(tri)
              setPage(1)
            }
          }}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: movementsData?.pagination?.total_items || 0,
            showSizeChanger: true,
            showTotal: (total) => t('stock.totalMovements', { count: total }),
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
        />
        </div>
      ),
    },
    {
      key: 'alerts',
      label: (
        <span>
          {t('stock.tabAlerts')}{' '}
          {(alertsCount + outOfStockCount) > 0 && (
            <Tag color="red">{alertsCount + outOfStockCount}</Tag>
          )}
        </span>
      ),
      children: (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
            <Input
              placeholder={t('stock.searchArticlePlaceholder')}
              prefix={<SearchOutlined />}
              style={{ width: 300 }}
              allowClear
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
            />
            <Select
              style={{ width: 200 }}
              value={alertFilter}
              onChange={setAlertFilter}
              options={[
                { value: 'all', label: t('stock.filterAllAlerts') },
                { value: 'low_stock', label: t('stock.filterLowStockOnly') },
                { value: 'out_of_stock', label: t('stock.filterOutOfStockOnly') },
              ]}
            />
            <div style={{ marginLeft: 'auto' }}>
              <Button
                icon={<MailOutlined />}
                onClick={() => setEmailModalOpen(true)}
                disabled={!emailStatus?.configured || (alertsData?.length || 0) === 0}
                title={!emailStatus?.configured ? t('stock.emailServiceNotConfigured') : undefined}
              >
                {t('stock.sendByEmail')}
              </Button>
            </div>
          </div>
          <Table
            dataSource={filteredAlerts}
            columns={[
              { title: t('stock.colCode'), dataIndex: 'article_code', key: 'code', width: 120 },
              { title: t('stock.colArticle'), dataIndex: 'article_name', key: 'name' },
              { title: t('stock.colWarehouse'), dataIndex: 'warehouse_name', key: 'warehouse', width: 150 },
              {
                title: t('stock.colCurrentStock'),
                dataIndex: 'current_quantity',
                key: 'qty',
                width: 120,
                render: (v: number) => (
                  <span style={{ color: v <= 0 ? '#ff4d4f' : '#faad14', fontWeight: 500 }}>
                    {formatQty(v)}
                  </span>
                ),
              },
              {
                title: t('stock.colAlertThreshold'),
                dataIndex: 'min_threshold',
                key: 'threshold',
                width: 120,
                render: (v: number) => formatQty(v),
              },
              {
                title: t('stock.colMissing'),
                key: 'missing',
                width: 120,
                render: (_: unknown, record: StockAlert) => {
                  // ⚠️ UN MANQUE S'ÉCRIT EN POSITIF.
                  //
                  // La valeur calculée (seuil - disponible) est déjà positive,
                  // et l'affichage lui ajoutait un signe moins : un manque de
                  // 95 unités s'affichait « -95,00 » dans une colonne intitulée
                  // « Manquant », ce qui se lit spontanément comme un excédent.
                  const missing = record.min_threshold - record.current_quantity
                  return missing > 0 ? (
                    <span style={{ color: '#ff4d4f' }}>{formatQty(missing)}</span>
                  ) : '-'
                },
              },
              {
                title: t('common.status'),
                key: 'status',
                width: 120,
                render: (_: unknown, record: StockAlert) =>
                  record.alert_type === 'out_of_stock' ? (
                    <Tag color="red">{t('stock.statusOutOfStock')}</Tag>
                  ) : (
                    <Tag color="orange">{t('stock.statusLowStock')}</Tag>
                  ),
              },
            ]}
            rowKey={(record) => `${record.article_id}-${record.warehouse_id}`}
            pagination={{
              showSizeChanger: true,
              showTotal: (total) => t('stock.totalAlerts', { count: total }),
            }}
          />
        </div>
      ),
    },
    // Réservé à qui peut réellement écrire dans le référentiel — voir la note
    // sur peutGererLesReglages en tête de composant. La LECTURE des entrepôts
    // reste accessible à tous par le sélecteur de la fenêtre de mouvement, qui
    // passe par GET /stock/warehouses.
    ...(peutGererLesReglages
      ? [
          {
            key: 'warehouses',
            label: (
              <span>
                <HomeOutlined style={{ marginRight: 6 }} />
                {t('stock.tabWarehouses')}
              </span>
            ),
            children: <WarehouseSettings />,
          },
        ]
      : []),
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t('stock.pageTitle')}</h1>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            const defaultWh = warehousesData?.find(w => w.is_default)
            if (defaultWh) form.setFieldsValue({ warehouse_id: defaultWh.id })
            setMovementModalOpen(true)
          }}
        >
          {t('stock.newMovement')}
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title={t('stock.statTotalArticles')} value={totalArticles} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            {undefined === stockValue ? (
              <Statistic title={t('stock.statStockValue')} value="—" />
            ) : (
              <Statistic
                title={t('stock.statStockValue')}
                value={stockValue}
                precision={2}
                suffix="EUR"
              />
            )}
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('stock.statAlerts')}
              value={alertsCount}
              prefix={<WarningOutlined />}
              valueStyle={{ color: alertsCount > 0 ? '#faad14' : undefined }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('stock.statOutOfStock')}
              value={outOfStockCount}
              valueStyle={{ color: outOfStockCount > 0 ? '#ff4d4f' : undefined }}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={tabItems}
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key)
          setPage(1)
        }}
      />

      <Modal
        title={editingMovement ? t('stock.editMovementTitle') : t('stock.newMovementTitle')}
        open={movementModalOpen}
        onCancel={() => {
          setMovementModalOpen(false)
          setEditingMovement(null)
          form.resetFields()
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateMovement}
        >
          <Form.Item
            name="article_id"
            label={t('stock.colArticle')}
            rules={[{ required: true, message: t('stock.selectArticle') }]}
          >
            <Select
              showSearch
              placeholder={t('stock.selectArticle')}
              optionFilterProp="children"
              filterOption={(input, option) =>
                (option?.label?.toString() || '').toLowerCase().includes(input.toLowerCase())
              }
              options={stockableArticles.map((a) => ({
                value: a.id,
                label: `${a.code} - ${a.name}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="warehouse_id"
            label={t('stock.colWarehouse')}
            rules={[{ required: true, message: t('stock.selectWarehouse') }]}
            initialValue={warehousesData?.find(w => w.is_default)?.id}
          >
            <Select
              placeholder={t('stock.selectWarehouse')}
              options={warehousesData?.map((w) => ({
                value: w.id,
                label: `${w.code} - ${w.name}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            name="type"
            label={t('stock.movementType')}
            rules={[{ required: true, message: t('stock.selectType') }]}
          >
            <Select
              options={[
                { value: 'in', label: t('stock.typeIn') },
                { value: 'out', label: t('stock.typeOut') },
                { value: 'adjustment', label: t('stock.typeAdjustment') },
                // Pas de « Transfert » ici : StockService le refuse tant que la
                // table n'a pas de colonne de destination — un transfert
                // retirerait la marchandise de l'entrepôt source sans la rendre
                // nulle part. Le proposer serait promettre une fonction qui
                // détruit du stock.
              ]}
            />
          </Form.Item>

          {!editingMovement && (
            <Form.Item
              name="date"
              label={t('common.date')}
              initialValue={dayjs()}
              // La date n'est pas modifiable après coup : le serveur refuse de
              // déplacer un mouvement dans le temps comme il refuse de le
              // changer d'entrepôt.
            >
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY HH:mm" showTime={{ format: 'HH:mm' }} />
            </Form.Item>
          )}

          <Form.Item
            name="quantity"
            label={t('stock.colQuantity')}
            rules={[
              { required: true, message: t('stock.enterQuantity') },
              { type: 'number', min: 0.001, message: t('stock.quantityMustBePositive') },
            ]}
          >
            {/* ⚠️ PAS DE « min » SUR LE CHAMP LUI-MÊME.
                InputNumber remplace la saisie par le minimum dès la frappe : on
                tapait 0 ou -5, le champ affichait 0,001, la règle juste
                au-dessus ne se déclenchait donc jamais, et l'ERP enregistrait
                un millième d'unité en annonçant « Mouvement créé ». Une
                correction silencieuse de la saisie est pire qu'un refus. */}
            <InputNumber style={{ width: '100%' }} step={1} precision={3} />
          </Form.Item>

          <Form.Item name="reference" label={t('stock.colReference')}>
            <Input placeholder={t('stock.referencePlaceholder')} />
          </Form.Item>

          <Form.Item name="notes" label={t('stock.colNotes')}>
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={createMovementMutation.isPending || updateMovementMutation.isPending}
              block
            >
              {editingMovement ? t('stock.editMovementButton') : t('stock.createMovementButton')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('stock.sendAlertsByEmailTitle')}
        open={emailModalOpen}
        onCancel={() => {
          setEmailModalOpen(false)
          emailForm.resetFields()
        }}
        footer={null}
      >
        <Form
          form={emailForm}
          layout="vertical"
          onFinish={(values: { email: string }) => {
            sendEmailMutation.mutate(values.email)
          }}
        >
          <p style={{ marginBottom: 16 }}>
            {t('stock.emailReportInfo', { count: alertsData?.length || 0 })}
          </p>
          <Form.Item
            name="email"
            label={t('stock.emailAddress')}
            rules={[
              { required: true, message: t('stock.enterEmailAddress') },
              { type: 'email', message: t('stock.invalidEmailAddress') },
            ]}
          >
            <Input placeholder={t('stock.emailPlaceholder')} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={sendEmailMutation.isPending}
              block
              icon={<MailOutlined />}
            >
              {t('stock.sendReport')}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
