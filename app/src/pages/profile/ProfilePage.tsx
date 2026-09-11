import { useEffect } from 'react'
import { Tabs, Form, Input, Button, Card, message, Tag, Alert, Typography, Spin } from 'antd'
import { SafetyOutlined, LockOutlined, UserOutlined, PhoneOutlined, MailOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { amsbmBoot, profileAPI } from '@/services/api'

interface ProfileData {
  first_name: string
  last_name: string
  email: string
  phone?: string
  two_factor_enabled: boolean
}

const { Text, Title } = Typography

// ⚠️ TROIS ONGLETS REPOSAIENT SUR NEUF ROUTES QUI N'EXISTENT PAS.
//
// « 2FA », « Passkeys » et « Accès mobile » sont des vestiges du SaaS : le
// plugin n'expose que /amsbm/v1/profile, et les neuf autres appels répondaient
// 404 — dont deux vers /profile/passkeys lancés à CHAQUE ouverture de l'écran.
//
// Les passkeys et l'accès mobile n'ont aucune implémentation serveur : leurs
// onglets sont retirés plutôt que laissés à faire semblant. La double
// authentification, elle, EXISTE VRAIMENT (src/Capabilities/TwoFactor.php) :
// elle est obligatoire pour qui accède au module, et se configure sur le profil
// WordPress, où le nonce, les codes de secours et le contrôle du mot de passe
// sont déjà en place. L'onglet dit donc l'état réel du compte et y renvoie.
//
// Rien ici ne permet de la désactiver : ce n'est pas un oubli.
const profilWordPress = `${amsbmBoot.adminUrl.replace(/\/?$/, '/')}profile.php#amsbm-2fa`

export default function ProfilePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [profileForm] = Form.useForm()
  const [passwordForm] = Form.useForm()

  // Charger le profil
  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await profileAPI.getProfile()
      return res.data
    },
  })

  useEffect(() => {
    if (profile) {
      profileForm.setFieldsValue({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone,
      })
    }
  }, [profile, profileForm])

  // L'adresse a-t-elle bougé par rapport à celle en base ? C'est la seule
  // modification du profil qui demande le mot de passe.
  const emailSaisi = Form.useWatch('email', profileForm)
  const adresseChangee =
    !!profile?.email && !!emailSaisi && String(emailSaisi).trim().toLowerCase() !== String(profile.email).trim().toLowerCase()

  // Mutation mise à jour profil
  const updateProfileMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => profileAPI.updateProfile(values),
    onSuccess: () => {
      message.success(t('profilePage.profileUpdated'))
      // Le mot de passe ne traîne pas dans le formulaire après coup.
      profileForm.setFieldValue('current_password', undefined)
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
    // Le serveur refuse maintenant une adresse invalide : on montre SON message
    // plutôt qu'un « Profil mis à jour » qui ne serait pas vrai.
    onError: (error: any) =>
      message.error(error?.response?.data?.error || t('profilePage.updateError')),
  })

  // Mutation changement mot de passe
  const changePasswordMutation = useMutation({
    mutationFn: (values: { current_password: string; new_password: string }) =>
      profileAPI.changePassword(values.current_password, values.new_password),
    onSuccess: () => {
      message.success(t('profilePage.passwordChanged'))
      passwordForm.resetFields()
    },
    onError: () => message.error(t('profilePage.passwordChangeError')),
  })

  if (isLoading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />

  const tabItems = [
    {
      key: 'info',
      label: (
        <span><UserOutlined /> {t('profilePage.info')}</span>
      ),
      children: (
        <Card>
          <Form
            form={profileForm}
            layout="vertical"
            onFinish={(values) => updateProfileMutation.mutate(values)}
            style={{ maxWidth: 500 }}
          >
            <Form.Item name="first_name" label={t('profilePage.firstName')} rules={[{ required: true, message: t('profilePage.firstNameRequired') }]}>
              <Input prefix={<UserOutlined />} />
            </Form.Item>
            <Form.Item name="last_name" label={t('profilePage.lastName')} rules={[{ required: true, message: t('profilePage.lastNameRequired') }]}>
              <Input prefix={<UserOutlined />} />
            </Form.Item>
            {/* ⚠️ CHANGER SON ADRESSE, C'EST CHANGER LA SERRURE.
                Le serveur exige désormais le mot de passe courant : sans lui,
                une session volée devenait une prise de compte définitive — on
                change l'adresse, on demande « mot de passe oublié », et le
                véritable titulaire n'entre plus jamais. Le champ n'apparaît donc
                que si l'adresse a bougé : le reste du profil se corrige sans
                cérémonie. */}
            <Form.Item name="email" label={t('profilePage.emailLabel')} rules={[{ required: true, type: 'email', message: t('profilePage.emailValidRequired') }]}>
              <Input prefix={<MailOutlined />} />
            </Form.Item>
            {adresseChangee && (
              <Form.Item
                name="current_password"
                label={t('profilePage.currentPasswordForEmail', 'Mot de passe actuel')}
                extra={t(
                  'profilePage.currentPasswordForEmailHelp',
                  'Exigé pour changer votre adresse de courriel : c\'est elle qui permet de réinitialiser votre mot de passe.'
                )}
                rules={[{ required: true, message: t('profilePage.currentPasswordRequired', 'Saisissez votre mot de passe actuel.') }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
            )}
            <Form.Item name="phone" label={t('profilePage.phone')}>
              <Input prefix={<PhoneOutlined />} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={updateProfileMutation.isPending}>
                {t('profilePage.save')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    {
      key: 'password',
      label: (
        <span><LockOutlined /> {t('profilePage.password')}</span>
      ),
      children: (
        <Card>
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={(values) => changePasswordMutation.mutate({
              current_password: values.current_password,
              new_password: values.new_password,
            })}
            style={{ maxWidth: 500 }}
          >
            <Form.Item
              name="current_password"
              label={t('profilePage.currentPassword')}
              rules={[{ required: true, message: t('profilePage.required') }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="new_password"
              label={t('profilePage.newPassword')}
              rules={[
                { required: true, message: t('profilePage.required') },
                { min: 8, message: t('profilePage.minChars') },
                {
                  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/,
                  message: t('profilePage.passwordPattern'),
                },
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label={t('profilePage.confirmPassword')}
              dependencies={['new_password']}
              rules={[
                { required: true, message: t('profilePage.required') },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                    return Promise.reject(new Error(t('profilePage.passwordsDoNotMatch')))
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={changePasswordMutation.isPending}>
                {t('profilePage.changePassword')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      ),
    },
    {
      key: '2fa',
      label: (
        <span><SafetyOutlined /> {t('profilePage.twoFactor')}</span>
      ),
      children: (
        <Card>
          <div style={{ maxWidth: 500 }}>
            <div style={{ marginBottom: 24 }}>
              <Text strong>{t('profilePage.statusLabel')} </Text>
              {profile?.two_factor_enabled ? (
                <Tag color="green">{t('profilePage.enabled')}</Tag>
              ) : (
                <Tag color="orange">{t('profilePage.disabled')}</Tag>
              )}
            </div>

            <Alert
              type={profile?.two_factor_enabled ? 'success' : 'info'}
              message={profile?.two_factor_enabled
                ? t('profilePage.twoFAEnabledMessage')
                : t('profilePage.secureYourAccount')}
              description={profile?.two_factor_enabled
                ? t('profilePage.twoFAEnabledDesc')
                : t('profilePage.secureYourAccountDesc')}
              style={{ marginBottom: 16 }}
            />

            <Button type="primary" icon={<SafetyOutlined />} href={profilWordPress}>
              {t('profilePage.enable2FA')}
            </Button>
          </div>
        </Card>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ marginBottom: 24 }}>{t('profilePage.title')}</Title>
      <Tabs items={tabItems} />
    </div>
  )
}
