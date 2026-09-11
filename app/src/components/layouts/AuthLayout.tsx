import { Outlet, Navigate } from 'react-router-dom'
import MarqueAmsbm from '@/components/MarqueAmsbm'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import {
  DashboardOutlined,
  SafetyCertificateOutlined,
  CloudServerOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'

export default function AuthLayout() {
  const { t } = useTranslation()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  const features = [
    { icon: <DashboardOutlined />, title: t('authLayout.features.dashboard.title'), desc: t('authLayout.features.dashboard.desc') },
    { icon: <SafetyCertificateOutlined />, title: t('authLayout.features.security.title'), desc: t('authLayout.features.security.desc') },
    { icon: <CloudServerOutlined />, title: t('authLayout.features.multiTenant.title'), desc: t('authLayout.features.multiTenant.desc') },
    { icon: <ThunderboltOutlined />, title: t('authLayout.features.eInvoicing.title'), desc: t('authLayout.features.eInvoicing.desc') },
  ]

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left panel - Branding */}
      <div
        style={{
          flex: '0 0 45%',
          background: 'linear-gradient(160deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative circles */}
        <div
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-80px',
            width: '350px',
            height: '350px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-100px',
            left: '-60px',
            width: '300px',
            height: '300px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 70%)',
          }}
        />

        {/* Logo / Brand */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ marginBottom: '48px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px',
              }}
            >
              <MarqueAmsbm taille={44} />
              <span
                style={{
                  fontSize: '26px',
                  fontWeight: 700,
                  color: '#fff',
                  letterSpacing: '-0.5px',
                }}
              >
                AMS Studio
              </span>
            </div>
            <p
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: '15px',
                margin: 0,
                lineHeight: 1.6,
                maxWidth: '380px',
              }}
            >
              {t('authLayout.tagline')}
            </p>
          </div>

          {/* Features list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {features.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px',
                  animation: `authSlideIn 0.5s ease ${i * 0.1}s both`,
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'rgba(59,130,246,0.12)',
                    border: '1px solid rgba(59,130,246,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    color: '#60a5fa',
                    flexShrink: 0,
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div
                    style={{
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '14px',
                      marginBottom: '2px',
                    }}
                  >
                    {f.title}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px' }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            left: '60px',
            color: 'rgba(255,255,255,0.25)',
            fontSize: '12px',
          }}
        >
          {t('authLayout.footer', { year: new Date().getFullYear() })}
        </div>
      </div>

      {/* Right panel - Form */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          padding: '40px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            animation: 'authFadeIn 0.4s ease',
          }}
        >
          <Outlet />
        </div>
      </div>

      <style>{`
        @keyframes authFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes authSlideIn {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @media (max-width: 900px) {
          div[style*="flex: 0 0 45%"] {
            display: none !important;
          }
        }
      `}</style>
    </div>
  )
}
