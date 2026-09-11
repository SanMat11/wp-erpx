import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Dropdown, Empty, List, Typography, Space, Tag, Tooltip, theme } from 'antd'
import {
  BellOutlined,
  CheckOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  DollarOutlined,
  WarningOutlined,
  AuditOutlined,
  FileDoneOutlined,
  SignatureOutlined,
} from '@ant-design/icons'
import { notification as antNotification } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNotificationStore, WSTypes } from '@/stores/notificationStore'
import { useWebSocket, TEMPS_REEL_DECLARE } from '@/hooks/useWebSocket'
import { useDocumentTabsStore, DocumentType } from '@/stores/documentTabsStore'
import { notificationAPI } from '@/services/api'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import utc from 'dayjs/plugin/utc'
import 'dayjs/locale/fr'

dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.locale('fr')

const { Text } = Typography

/**
 * La cloche d'AMS Studio.
 *
 * ⚠️ ELLE N'A JAMAIS RIEN MONTRÉ, ET NE POUVAIT PAS.
 *
 * Sa seule source était le serveur temps réel du SaaS, que WordPress n'a pas :
 * le panneau affichait invariablement « Aucune notification », et on avait fini
 * par la masquer purement et simplement. Elle lit maintenant `/notifications`,
 * alimentée par le circuit de validation — demandes reçues côté valideur,
 * comptes rendus côté demandeur.
 *
 * Pas de temps réel pour autant : un scrutin d'une minute, plus un rafraîchisse-
 * ment au retour sur l'onglet. Ce n'est pas une messagerie, et une demande de
 * validation vue à la minute suivante ne gêne personne. Le canal WebSocket reste
 * branché pour le jour où VITE_WS_URL sera déclarée ; les deux sources se
 * fondent dans la même liste.
 */

/** Ce que la route rend. */
interface NotificationServeur {
  id: string
  type: string
  titre: string
  message: string
  date: string
  lu: boolean
  lien?: { type: string; id: string }
}

/** Ce que la liste affiche, quelle que soit la provenance. */
interface Ligne {
  id: string
  type: string
  titre: string
  message: string
  date: dayjs.Dayjs
  lu: boolean
  lien?: { type: string; id: string }
  /** Le serveur en garde la trace ; le temps réel, non. */
  distante: boolean
}

// Les onglets que l'écran sait ouvrir. Une réception n'a pas d'éditeur — son
// lien ne mène nulle part, on n'en fait donc pas un lien du tout.
const ONGLETS: DocumentType[] = [
  'quote',
  'amendment',
  'invoice',
  'supplier-invoice',
  'purchase-order',
  'deal',
]

function icone(type: string): React.ReactNode {
  switch (type) {
    case 'validation_request':
      return <AuditOutlined style={{ color: '#faad14' }} />
    case 'validation':
      return <FileDoneOutlined style={{ color: '#52c41a' }} />
    case 'quote_signed':
      return <SignatureOutlined style={{ color: '#52c41a' }} />
    case WSTypes.STOCK_ALERT:
      return <WarningOutlined style={{ color: '#faad14' }} />
    case WSTypes.INVOICE_SENT:
      return <DollarOutlined style={{ color: '#1890ff' }} />
    case WSTypes.INVOICE_PAID:
      return <DollarOutlined style={{ color: '#52c41a' }} />
    case WSTypes.INVOICE_OVERDUE:
      return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
    default:
      return <BellOutlined />
  }
}

function couleur(type: string): string {
  switch (type) {
    case 'validation_request':
      return 'gold'
    case 'validation':
      return 'green'
    case 'quote_signed':
      return 'green'
    case WSTypes.STOCK_ALERT:
      return 'orange'
    case WSTypes.INVOICE_SENT:
      return 'blue'
    case WSTypes.INVOICE_PAID:
      return 'green'
    case WSTypes.INVOICE_OVERDUE:
      return 'red'
    default:
      return 'default'
  }
}

function categorie(type: string, t: (key: string, repli: string) => string): string {
  switch (type) {
    case 'validation_request':
      return t('notificationCenter.categories.validationRequest', 'À valider')
    case 'validation':
      return t('notificationCenter.categories.validation', 'Validation')
    case 'quote_signed':
      return t('notificationCenter.categories.signature', 'Signature')
    case WSTypes.STOCK_ALERT:
      return t('notificationCenter.categories.stock', 'Stock')
    case WSTypes.INVOICE_SENT:
      return t('notificationCenter.categories.invoice', 'Facture')
    case WSTypes.INVOICE_PAID:
      return t('notificationCenter.categories.payment', 'Paiement')
    case WSTypes.INVOICE_OVERDUE:
      return t('notificationCenter.categories.overdue', 'Retard')
    default:
      return t('notificationCenter.categories.info', 'Information')
  }
}

function LigneNotification({ item, onClick }: { item: Ligne; onClick: (item: Ligne) => void }) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const ouvrable = !!item.lien && ONGLETS.includes(item.lien.type as DocumentType)

  return (
    <List.Item
      style={{
        padding: '12px 16px',
        background: item.lu ? 'transparent' : token.colorPrimaryBg,
        cursor: 'pointer',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
      onClick={() => onClick(item)}
    >
      <List.Item.Meta
        avatar={icone(item.type)}
        title={
          <Space size={8}>
            <Text strong={!item.lu}>{item.titre}</Text>
            <Tag color={couleur(item.type)} style={{ fontSize: 10, padding: '0 4px' }}>
              {categorie(item.type, t)}
            </Tag>
          </Space>
        }
        description={
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {item.message}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {item.date.fromNow()}
              {ouvrable ? ` · ${t('notificationCenter.open', 'ouvrir le document')}` : ''}
            </Text>
          </Space>
        }
      />
    </List.Item>
  )
}

export default function NotificationCenter() {
  const { t } = useTranslation()
  // ⚠️ Les couleurs viennent du THÈME, jamais en dur.
  //
  // Le panneau était peint en #fff avec un en-tête #fafafa : en thème sombre,
  // antd passait le texte en clair et le panneau restait blanc — illisible.
  // C'est la même règle que dans MainLayout.
  const { token } = theme.useToken()
  const queryClient = useQueryClient()
  const openDocumentTab = useDocumentTabsStore((s) => s.openDocumentTab)

  useWebSocket()

  const { notifications: tempsReel, markAsRead, markAllAsRead, clearNotifications, isConnected } =
    useNotificationStore()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const reponse = await notificationAPI.list()
      return reponse.data as { data: NotificationServeur[]; unread: number }
    },
    // Une minute suffit, et le retour sur l'onglet rattrape le reste : c'est un
    // circuit de validation, pas une conversation.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Une cloche muette parce que la requête a échoué ne doit pas faire de bruit
    // dans la console de l'utilisateur — elle réessaiera au tour suivant.
    retry: 1,
  })

  const distantes: Ligne[] = (data?.data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    titre: n.titre || t('notificationCenter.title'),
    message: n.message,
    // Le serveur date en UTC (`current_time( 'mysql', true )`) sans le dire :
    // lu comme heure locale, « il y a 2 minutes » devenait « dans 2 heures ».
    date: dayjs.utc(n.date).local(),
    lu: n.lu,
    lien: n.lien && n.lien.type ? n.lien : undefined,
    distante: true,
  }))

  const locales: Ligne[] = tempsReel.map((n) => ({
    id: n.id,
    type: n.type,
    titre: n.message,
    message: n.description ?? '',
    date: dayjs(n.timestamp),
    lu: n.read,
    distante: false,
  }))

  const lignes = [...distantes, ...locales].sort((a, b) => b.date.valueOf() - a.date.valueOf())
  const nonLues = lignes.filter((l) => !l.lu).length

  const lire = useMutation({
    mutationFn: (id?: string) => notificationAPI.read(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const vider = useMutation({
    mutationFn: () => notificationAPI.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // Une notification annonce un document : le clic doit l'ouvrir. Sans ça, elle
  // apprend qu'il s'est passé quelque chose et laisse l'utilisateur le chercher.
  const ouvrir = (item: Ligne) => {
    if (!item.lu) {
      if (item.distante) {
        lire.mutate(item.id)
      } else {
        markAsRead(item.id)
      }
    }

    if (item.lien && ONGLETS.includes(item.lien.type as DocumentType)) {
      openDocumentTab(item.lien.type as DocumentType, item.lien.id)
    }
  }

  const toutLire = () => {
    if (distantes.some((l) => !l.lu)) {
      lire.mutate(undefined)
    }

    markAllAsRead()
  }

  const toutVider = () => {
    if (distantes.length > 0) {
      vider.mutate()
    }

    clearNotifications()
  }

  // Un bandeau au moment où la notification arrive, pour celui qui est déjà à
  // l'écran. Uniquement sur le canal temps réel : le scrutin, lui, ramènerait
  // les mêmes à chaque tour.
  useEffect(() => {
    const unsubscribe = useNotificationStore.subscribe((state, prevState) => {
      if (state.notifications.length <= prevState.notifications.length) {
        return
      }

      const arrivee = state.notifications[0]

      if (!arrivee) {
        return
      }

      let genre: 'info' | 'success' | 'warning' | 'error' = 'info'

      if (arrivee.type === WSTypes.STOCK_ALERT) {
        genre = 'warning'
      } else if (arrivee.type === WSTypes.INVOICE_PAID) {
        genre = 'success'
      } else if (arrivee.type === WSTypes.INVOICE_OVERDUE) {
        genre = 'error'
      }

      antNotification[genre]({
        message: arrivee.message,
        description: arrivee.description,
        placement: 'topRight',
        duration: 5,
      })
    })

    return () => unsubscribe()
  }, [])

  const panneau = (
    <div
      style={{
        width: 380,
        maxHeight: 450,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgElevated,
        borderRadius: 8,
        boxShadow: token.boxShadowSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: token.colorFillQuaternary,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <Space>
          <Text strong>{t('notificationCenter.title')}</Text>
          {/* ⚠️ Pas de pastille tant qu'aucun serveur temps réel n'est déclaré.
              WordPress n'en a pas : la pastille était donc ROUGE en permanence,
              avec l'infobulle « déconnecté ». L'utilisateur croyait à une panne
              là où il n'y a simplement rien à quoi se connecter. */}
          {TEMPS_REEL_DECLARE &&
            (isConnected ? (
              <Tooltip title={t('notificationCenter.status.connected')}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: token.colorSuccess }} />
              </Tooltip>
            ) : (
              <Tooltip title={t('notificationCenter.status.disconnected')}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: token.colorError }} />
              </Tooltip>
            ))}
        </Space>
        <Space>
          {nonLues > 0 && (
            <Button type="link" size="small" icon={<CheckOutlined />} onClick={toutLire}>
              {t('notificationCenter.actions.markAllRead')}
            </Button>
          )}
          {lignes.length > 0 && (
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={toutVider}>
              {t('notificationCenter.actions.clear')}
            </Button>
          )}
        </Space>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {lignes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('notificationCenter.empty')}
            style={{ padding: '40px 0' }}
          />
        ) : (
          <List dataSource={lignes} renderItem={(item) => <LigneNotification item={item} onClick={ouvrir} />} />
        )}
      </div>
    </div>
  )

  return (
    <Dropdown dropdownRender={() => panneau} trigger={['click']} placement="bottomRight">
      <Badge count={nonLues} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined />} style={{ fontSize: 18 }} />
      </Badge>
    </Dropdown>
  )
}
