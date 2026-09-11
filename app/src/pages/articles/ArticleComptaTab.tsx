import { Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import { comptaAPI } from '@/services/comptaApi'
import ComptaParamsGrid from '@/pages/comptabilite/ComptaParamsGrid'

export default function ArticleComptaTab({ articleId }: { articleId?: string }) {
  const { t } = useTranslation()
  if (!articleId) {
    return <Alert type="info" message={t('articleComptaTab.saveArticleFirst')} />
  }
  return (
    <ComptaParamsGrid
      title={t('articleComptaTab.title')}
      queryKey={['compta.articleParams', articleId]}
      fetcher={() => comptaAPI.listArticleParams(articleId)}
      saver={(params) => comptaAPI.replaceArticleParams(articleId, params)}
      helpText={t('articleComptaTab.helpText')}
    />
  )
}
