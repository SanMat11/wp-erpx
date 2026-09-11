import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Progress, Card, Spin, message, Statistic, Row, Col } from 'antd'
import { FileOutlined, DatabaseOutlined } from '@ant-design/icons'
import { settingsAPI } from '@/services/api'

interface EncryptionData {
  available: boolean
  files: number
  key_external: boolean
  algorithm: string
  advice: string
}

interface StorageData {
  used_bytes: number
  used_mb: number
  max_mb: number
  usage_percent: number
  file_count: number
  encryption?: EncryptionData
}

export default function StorageSettings() {
  const { t } = useTranslation()
  const [data, setData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const response = await settingsAPI.getStorage()
      setData(response.data)
    } catch (error) {
      message.error(t('storageSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getProgressStatus = (percent: number): 'success' | 'normal' | 'exception' => {
    if (percent >= 90) return 'exception'
    if (percent >= 70) return 'normal'
    return 'success'
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 50 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!data) {
    return <div>{t('storageSettings.noDataAvailable')}</div>
  }

  // ⚠️ « max_mb = 0 » VEUT DIRE « PAS DE QUOTA », PAS « PLAFOND À ZÉRO ».
  //
  // Settings::storage() rend 0 parce qu'un module installé chez soi n'a pas de
  // limite de stockage à faire respecter. L'écran le prenait pour un plafond :
  // il affichait « 0,54 Mo / 0 Mo », un espace disponible de « -0,54 Mo » et
  // deux jauges figées à 0 %. On dit donc « Sans limite », et on ne montre pas
  // de jauge — une jauge qui ne mesure rien n'informe pas, elle inquiète.
  const sansQuota = !data.max_mb || data.max_mb <= 0

  return (
    <div style={{ maxWidth: 600 }}>
      <h3>{t('storageSettings.title')}</h3>
      <p style={{ color: '#666', marginBottom: 24 }}>
        {t('storageSettings.subtitle')}
      </p>

      <Card style={{ marginBottom: 24 }}>
        {!sansQuota && (
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Progress
              type="dashboard"
              percent={Math.round(data.usage_percent)}
              status={getProgressStatus(data.usage_percent)}
              format={(percent) => (
                <div>
                  <div style={{ fontSize: 24, fontWeight: 'bold' }}>{percent}%</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{t('storageSettings.used')}</div>
                </div>
              )}
              size={180}
            />
          </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: sansQuota ? 0 : 16 }}>
          <span style={{ fontSize: 18, fontWeight: 500 }}>
            {data.used_mb.toFixed(2)} Mo
          </span>
          <span style={{ color: '#666' }}>
            {' '}
            / {sansQuota ? t('storageSettings.noLimit') : `${data.max_mb} Mo`}
          </span>
        </div>

        {!sansQuota && (
          <Progress
            percent={data.usage_percent}
            status={getProgressStatus(data.usage_percent)}
            showInfo={false}
          />
        )}
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card>
            <Statistic
              title={t('storageSettings.filesStored')}
              value={data.file_count}
              prefix={<FileOutlined />}
              suffix={t('storageSettings.filesSuffix')}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <Statistic
              title={t('storageSettings.spaceUsed')}
              value={formatBytes(data.used_bytes)}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }}>
        <h4>{t('storageSettings.details')}</h4>
        <table style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td style={{ padding: '8px 0' }}>{t('storageSettings.totalAllocated')}</td>
              <td style={{ textAlign: 'right', fontWeight: 500 }}>
                {sansQuota ? t('storageSettings.noLimit') : `${data.max_mb} Mo`}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0' }}>{t('storageSettings.spaceUsed')}</td>
              <td style={{ textAlign: 'right', fontWeight: 500 }}>{data.used_mb.toFixed(2)} Mo</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0' }}>{t('storageSettings.spaceAvailable')}</td>
              <td style={{ textAlign: 'right', fontWeight: 500 }}>
                {sansQuota
                  ? t('storageSettings.noLimit')
                  : `${(data.max_mb - data.used_mb).toFixed(2)} Mo`}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '8px 0' }}>{t('storageSettings.fileCount')}</td>
              <td style={{ textAlign: 'right', fontWeight: 500 }}>{data.file_count}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* La route sert un bloc « encryption » complet que l'écran n'affichait
          nulle part. C'est pourtant ici que le client doit apprendre que ses
          pièces jointes sont chiffrées — et surtout où se trouve la clé, sans
          laquelle elles deviennent illisibles. */}
      {data.encryption?.available && (
        <Card style={{ marginTop: 16 }}>
          <h4>{t('storageSettings.encryptionTitle')}</h4>
          <table style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ padding: '8px 0' }}>{t('storageSettings.encryptionAlgorithm')}</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{data.encryption.algorithm}</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0' }}>{t('storageSettings.encryptedFiles')}</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>{data.encryption.files}</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 0' }}>{t('storageSettings.encryptionKey')}</td>
                <td style={{ textAlign: 'right', fontWeight: 500 }}>
                  {data.encryption.key_external
                    ? t('storageSettings.keyInConfig')
                    : t('storageSettings.keyInDatabase')}
                </td>
              </tr>
            </tbody>
          </table>

          {data.encryption.advice && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message={data.encryption.advice}
            />
          )}
        </Card>
      )}
    </div>
  )
}
