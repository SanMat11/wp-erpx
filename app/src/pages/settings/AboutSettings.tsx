import { useTranslation } from 'react-i18next'
import { Card, Descriptions, Typography, Table } from 'antd'
import { amsbmBoot } from '@/services/api'

const { Paragraph, Link } = Typography

/**
 * À propos : la version, la licence, et ce que l'archive embarque.
 *
 * ⚠️ CET ONGLET A REMPLACÉ « ABONNEMENT », et ce n'est pas un habillage. Le
 * plugin ne se vend plus par édition : ce qu'on installe est complet, et rien
 * n'y est plafonné ni conditionné à une clé. L'écran d'abonnement — clé de
 * licence, échéance, quotas, modules verrouillés — n'avait donc plus d'objet.
 *
 * Il ne reste ici aucun emplacement en attente d'un verrou : ni compteur, ni
 * bouton d'achat, ni mention d'une version supérieure.
 */

/** Ce que l'archive embarque, et sous quelle licence. Voir lib/pdf/VERSIONS.txt. */
const librairies = [
  { nom: 'dompdf/dompdf', version: '3.1.6', licence: 'LGPL-2.1', url: 'https://github.com/dompdf/dompdf' },
  { nom: 'masterminds/html5', version: '—', licence: 'MIT', url: 'https://github.com/Masterminds/html5-php' },
  { nom: 'sabberworm/php-css-parser', version: '—', licence: 'MIT', url: 'https://github.com/MyIntervals/PHP-CSS-Parser' },
  { nom: 'php-font-lib', version: '—', licence: 'LGPL-2.1', url: 'https://github.com/dompdf/php-font-lib' },
  { nom: 'php-svg-lib', version: '—', licence: 'LGPL-2.1', url: 'https://github.com/dompdf/php-svg-lib' },
]

export default function AboutSettings() {
  const { t } = useTranslation()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title={t('aboutSettings.title', { defaultValue: 'À propos' })}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label={t('aboutSettings.version', { defaultValue: 'Version' })}>
            {amsbmBoot.version || '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('aboutSettings.licence', { defaultValue: 'Licence' })}>
            <Link href="https://www.gnu.org/licenses/gpl-2.0.html" target="_blank" rel="noopener noreferrer">
              GPL v2 ou ultérieure
            </Link>
          </Descriptions.Item>
        </Descriptions>

        <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          {t('aboutSettings.body', {
            defaultValue:
              "Tout ce que porte cette extension est installé : aucune fonctionnalité n'est plafonnée, "
              + 'limitée dans le temps ni conditionnée à une clé. Vos données restent dans la base de '
              + 'votre site et ne sont envoyées nulle part.',
          })}
        </Paragraph>
      </Card>

      <Card title={t('aboutSettings.libraries', { defaultValue: 'Librairies embarquées' })}>
        <Paragraph type="secondary">
          {t('aboutSettings.librariesBody', {
            defaultValue:
              "Produire une facture en PDF demande un moteur HTML vers PDF, et WordPress n'en a pas. "
              + 'Ces librairies voyagent avec le code, non modifiées, chacune avec son propre fichier '
              + 'de licence dans son dossier.',
          })}
        </Paragraph>
        <Table
          size="small"
          pagination={false}
          rowKey="nom"
          dataSource={librairies}
          columns={[
            {
              title: t('aboutSettings.library', { defaultValue: 'Librairie' }),
              dataIndex: 'nom',
              render: (nom: string, ligne: { url: string }) => (
                <Link href={ligne.url} target="_blank" rel="noopener noreferrer">{nom}</Link>
              ),
            },
            { title: t('aboutSettings.libVersion', { defaultValue: 'Version' }), dataIndex: 'version' },
            { title: t('aboutSettings.licence', { defaultValue: 'Licence' }), dataIndex: 'licence' },
          ]}
        />
      </Card>
    </div>
  )
}
