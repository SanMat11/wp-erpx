import { useQuery } from '@tanstack/react-query'
import { Table, Typography, Tag, Tooltip, Empty, Spin, Alert, theme } from 'antd'
import {
  FileAddOutlined,
  CheckCircleOutlined,
  SwapOutlined,
  MailOutlined,
  EyeOutlined,
  SignatureOutlined,
  EuroCircleOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import 'dayjs/locale/fr'
import api from '@/services/api'

dayjs.extend(utc)

/**
 * La vie d'un document, du plus RÉCENT au plus ancien.
 *
 * ⚠️ TOUT ÉTAIT DÉJÀ ENREGISTRÉ, ET RIEN NE L'AFFICHAIT.
 *
 * La table d'audit retient depuis toujours qui a validé, qui a changé le statut,
 * qui a envoyé — avec l'heure et l'adresse IP. Les consultations du client
 * vivaient dans deux métadonnées séparées. Cinq sources, aucune visible : pour
 * savoir si un client avait ouvert son devis, il fallait ouvrir la base.
 *
 * ⚠️ UN TABLEAU, ET PAS UNE FRISE. La première version empilait les événements
 * verticalement, chacun sur trois lignes : dix événements remplissaient l'écran
 * et la moitié droite de l'onglet restait vide. Ce qu'on cherche, c'est ce qui
 * vient de se passer — donc le plus de lignes possible, du plus récent au plus
 * ancien, sur toute la largeur.
 *
 * ⚠️ CE QUI EST ANTÉRIEUR N'EXISTE PAS. Les pièces créées avant ce suivi n'ont
 * que ce que la base retenait déjà. C'est dit dans une infobulle, pas dans un
 * paragraphe : l'avertissement compte moins que les lignes qu'il chasserait.
 */

interface Evenement {
  quand: string
  genre: 'creation' | 'validation' | 'statut' | 'envoi' | 'client' | 'signature' | 'reglement' | 'autre'
  libelle: string
  acteur: string
  par: 'employe' | 'client' | 'systeme'
  ip: string
  detail: string
}

const ICONES: Record<string, React.ReactNode> = {
  creation: <FileAddOutlined />,
  validation: <CheckCircleOutlined />,
  statut: <SwapOutlined />,
  envoi: <MailOutlined />,
  client: <EyeOutlined />,
  signature: <SignatureOutlined />,
  reglement: <EuroCircleOutlined />,
  autre: <ClockCircleOutlined />,
}

// La couleur dit QUI a agi autant que QUOI : ce que nous faisons est froid, ce
// que le CLIENT fait est ambre — c'est la moitié qu'on cherche des yeux.
const COULEURS: Record<string, string> = {
  creation: '#8c8c8c',
  validation: '#52c41a',
  statut: '#1890ff',
  envoi: '#13c2c2',
  client: '#fa8c16',
  signature: '#52c41a',
  reglement: '#722ed1',
  autre: '#8c8c8c',
}

export default function SuiviDocument({ route, documentId }: { route: string; documentId?: string }) {
  const { t } = useTranslation()
  const { token } = theme.useToken()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['timeline', route, documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const reponse = await api.get(`/${route}/${documentId}/timeline`)
      return (reponse.data as { data: Evenement[] }).data ?? []
    },
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })

  if (!documentId) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('suivi.nouveau', "Le suivi commence à l'enregistrement du document.")}
        style={{ padding: '24px 0' }}
      />
    )
  }

  if (isLoading) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (isError) {
    return <Alert type="error" showIcon message={t('suivi.erreur', "Le suivi de ce document n'a pas pu être lu.")} />
  }

  // ⚠️ Le serveur rend du plus ancien au plus récent — c'est l'ordre juste pour
  // un journal qu'on archive. À l'écran on veut l'inverse : ce qui compte, c'est
  // ce qui vient de se passer, et on ne doit pas faire défiler pour le trouver.
  const evenements = [...(data ?? [])].reverse()

  if (0 === evenements.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('suivi.vide', 'Aucun événement enregistré sur ce document.')}
        style={{ padding: '24px 0' }}
      />
    )
  }

  return (
    <Table<Evenement>
      rowKey={(e, index) => `${e.quand}-${e.genre}-${index}`}
      size="small"
      dataSource={evenements}
      pagination={evenements.length > 50 ? { pageSize: 50, size: 'small' } : false}
      // Une ligne par événement, et rien qui la fasse enfler : c'est tout
      // l'intérêt du tableau sur la frise.
      style={{ marginTop: -8 }}
      columns={[
        {
          title: t('suivi.quand', 'Quand'),
          dataIndex: 'quand',
          key: 'quand',
          width: 155,
          // Le serveur date en UTC sans le dire : lu tel quel, un horodatage
          // décalerait de deux heures l'été.
          render: (v: string) => (
            <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {dayjs.utc(v).local().format('DD/MM/YY HH:mm:ss')}
            </span>
          ),
        },
        {
          title: t('suivi.evenement', 'Événement'),
          dataIndex: 'libelle',
          key: 'libelle',
          width: 250,
          render: (v: string, e: Evenement) => (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: COULEURS[e.genre] ?? COULEURS.autre, marginRight: 8 }}>
                {ICONES[e.genre] ?? ICONES.autre}
              </span>
              {v}
            </span>
          ),
        },
        {
          title: t('suivi.acteur', 'Par'),
          dataIndex: 'acteur',
          key: 'acteur',
          width: 170,
          render: (v: string, e: Evenement) =>
            v || 'client' === e.par ? (
              <Tag color={'client' === e.par ? 'orange' : 'default'} style={{ marginInlineEnd: 0 }}>
                {v || t('suivi.leClient', 'le client')}
              </Tag>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            ),
        },
        {
          title: t('suivi.detail', 'Détail'),
          dataIndex: 'detail',
          key: 'detail',
          ellipsis: { showTitle: false },
          render: (v: string) =>
            v ? (
              <Tooltip title={v} placement="topLeft">
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {v}
                </Typography.Text>
              </Tooltip>
            ) : null,
        },
        {
          // L'adresse relevée, à droite : elle ne sert que le jour où l'on
          // conteste, mais ce jour-là elle est la première chose qu'on cherche.
          title: (
            <Tooltip
              title={t(
                'suivi.avertissement',
                "Les documents créés avant la mise en place de ce suivi n'affichent que ce qui était déjà enregistré : leur création, leur validation et leurs envois."
              )}
            >
              <span>
                {t('suivi.ip', 'IP')} <InfoCircleOutlined style={{ color: token.colorTextTertiary }} />
              </span>
            </Tooltip>
          ),
          dataIndex: 'ip',
          key: 'ip',
          width: 130,
          render: (v: string) =>
            v ? (
              <Typography.Text code style={{ fontSize: 11 }}>
                {v}
              </Typography.Text>
            ) : null,
        },
      ]}
    />
  )
}
