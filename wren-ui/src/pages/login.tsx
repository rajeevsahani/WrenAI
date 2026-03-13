import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Form, Input, Button, Divider, message } from 'antd';

// ─── Icon Components ──────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022"/>
    <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00"/>
    <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF"/>
    <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900"/>
  </svg>
);

const WrenLogo = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
    <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd"/>
  </svg>
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoginFormValues {
  email: string;
  password: string;
}

type OAuthProvider = 'google' | 'github' | 'microsoft';

// ─── Login Page ───────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      // TODO: replace with your actual auth mutation
      // await apolloClient.mutate({ mutation: LOGIN_MUTATION, variables: values });
      console.log('Login with', values);
      await router.push('/');
    } catch {
      message.error('Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider: OAuthProvider) => {
    // TODO: redirect to OAuth provider
    // window.location.href = `/api/auth/${provider}`;
    console.log(`OAuth: ${provider}`);
  };

  const oauthProviders: { provider: OAuthProvider; icon: JSX.Element; label: string }[] = [
    { provider: 'google',    icon: <GoogleIcon />,    label: 'Continue with Google'    },
    { provider: 'github',    icon: <GitHubIcon />,    label: 'Continue with GitHub'    },
    { provider: 'microsoft', icon: <MicrosoftIcon />, label: 'Continue with Microsoft' },
  ];

  return (
    <>
      <Head>
        <title>Sign In — WrenAI Enterprise</title>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="login-root">
        {/* Background grid */}
        <div className="login-grid" />

        {/* Glow orbs */}
        <div className="login-orb login-orb--top" />
        <div className="login-orb login-orb--bottom" />

        {/* Card */}
        <div className="login-card">

          {/* ── Brand ── */}
          <div className="login-brand">
            <div className="login-brand__logo-row">
              <div className="login-brand__icon">
                <WrenLogo />
              </div>
              <span className="login-brand__name">WrenAI</span>
              <span className="login-brand__badge">Enterprise</span>
            </div>
            <p className="login-brand__welcome">Welcome back</p>
            <h1 className="login-brand__heading">
              Sign in to your organization's workspace
            </h1>
          </div>

          {/* ── OAuth ── */}
          <div className="login-oauth">
            {oauthProviders.map(({ provider, icon, label }) => (
              <button
                key={provider}
                type="button"
                className="login-oauth__btn"
                onClick={() => handleOAuth(provider)}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* ── Divider ── */}
          <Divider className="login-divider">
            <span className="login-divider__text">or use email</span>
          </Divider>

          {/* ── Email / password form ── */}
          <Form
            form={form}
            layout="vertical"
            onFinish={handleEmailLogin}
            requiredMark={false}
            className="login-form"
          >
            <Form.Item
              name="email"
              label="Work Email"
              rules={[
                { required: true, message: 'Please enter your work email' },
                { type: 'email',  message: 'Please enter a valid email address' },
              ]}
            >
              <Input
                placeholder="you@company.com"
                size="large"
                className="login-input"
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: 'Please enter your password' }]}
            >
              <Input.Password
                placeholder="••••••••"
                size="large"
                className="login-input"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                htmlType="submit"
                loading={loading}
                size="large"
                className="login-submit"
                block
              >
                {!loading && (
                  <span className="login-submit__label">
                    Sign In <ArrowRightIcon />
                  </span>
                )}
              </Button>
            </Form.Item>
          </Form>

          {/* ── Footer ── */}
          <p className="login-footer">
            Don't have an account?{' '}
            <a href="mailto:admin@yourcompany.com" className="login-footer__link">
              Request Access
            </a>
          </p>
        </div>
      </div>

      {/* ── Scoped styles ──────────────────────────────────────────────────── */}
      <style jsx global>{`
        /* root */
        .login-root {
          min-height: 100vh;
          background: #0a0a0f;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Sans', 'Helvetica Neue', sans-serif;
          position: relative;
          overflow: hidden;
        }

        /* grid */
        .login-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(99,102,241,.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,.045) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%);
          pointer-events: none;
        }

        /* orbs */
        .login-orb {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .login-orb--top {
          top: 12%; left: 18%;
          width: 420px; height: 420px;
          background: radial-gradient(circle, rgba(99,102,241,.13) 0%, transparent 70%);
        }
        .login-orb--bottom {
          bottom: 12%; right: 14%;
          width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(168,85,247,.09) 0%, transparent 70%);
        }

        /* card */
        .login-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 420px;
          padding: 0 24px;
        }

        /* brand */
        .login-brand {
          text-align: center;
          margin-bottom: 32px;
        }
        .login-brand__logo-row {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .login-brand__icon {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(99,102,241,.4);
          flex-shrink: 0;
        }
        .login-brand__name {
          font-size: 18px;
          font-weight: 700;
          color: #f1f5f9;
          letter-spacing: -.02em;
        }
        .login-brand__badge {
          font-size: 11px;
          font-weight: 600;
          color: #6366f1;
          background: rgba(99,102,241,.12);
          border: 1px solid rgba(99,102,241,.25);
          border-radius: 4px;
          padding: 2px 7px;
          letter-spacing: .05em;
          text-transform: uppercase;
        }
        .login-brand__welcome {
          color: #64748b;
          font-size: 13px;
          margin: 0 0 4px;
        }
        .login-brand__heading {
          color: #f1f5f9;
          font-size: 21px;
          font-weight: 700;
          margin: 0;
          letter-spacing: -.03em;
          line-height: 1.3;
        }

        /* OAuth */
        .login-oauth {
          display: flex;
          flex-direction: column;
          gap: 9px;
          margin-bottom: 20px;
        }
        .login-oauth__btn {
          width: 100%;
          padding: 10px 16px;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 10px;
          color: #cbd5e1;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-family: 'DM Sans', sans-serif;
          transition: background .15s ease, border-color .15s ease;
        }
        .login-oauth__btn:hover {
          background: rgba(255,255,255,.07);
          border-color: rgba(255,255,255,.14);
        }

        /* Ant Divider */
        .login-divider.ant-divider {
          border-color: rgba(255,255,255,.08) !important;
          margin: 0 0 20px !important;
        }
        .login-divider .ant-divider-inner-text {
          padding: 0 12px;
          background: transparent;
        }
        .login-divider__text {
          color: #475569;
          font-size: 12px;
          font-weight: 500;
          font-family: 'DM Sans', sans-serif;
        }

        /* Form labels */
        .login-form .ant-form-item-label > label {
          color: #94a3b8 !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          letter-spacing: .05em !important;
          text-transform: uppercase !important;
          height: auto !important;
          font-family: 'DM Sans', sans-serif !important;
        }
        .login-form .ant-form-item {
          margin-bottom: 14px !important;
        }
        .login-form .ant-form-item-explain-error {
          color: #f87171 !important;
          font-size: 12px !important;
          font-family: 'DM Sans', sans-serif !important;
        }

        /* Ant Input */
        .login-input.ant-input,
        .login-input .ant-input,
        .login-input.ant-input-affix-wrapper {
          background: rgba(255,255,255,.04) !important;
          border: 1px solid rgba(255,255,255,.08) !important;
          border-radius: 10px !important;
          color: #f1f5f9 !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 14px !important;
          box-shadow: none !important;
        }
        .login-input.ant-input::placeholder,
        .login-input .ant-input::placeholder {
          color: #334155 !important;
        }
        .login-input.ant-input:focus,
        .login-input.ant-input-affix-wrapper:focus,
        .login-input.ant-input-affix-wrapper-focused {
          border-color: rgba(99,102,241,.6) !important;
          box-shadow: 0 0 0 3px rgba(99,102,241,.12) !important;
        }
        .login-input .ant-input-suffix .anticon {
          color: #475569 !important;
        }

        /* Submit button */
        .login-submit.ant-btn {
          background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%) !important;
          border: none !important;
          border-radius: 10px !important;
          height: 44px !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          letter-spacing: -.01em !important;
          font-family: 'DM Sans', sans-serif !important;
          box-shadow: 0 4px 20px rgba(99,102,241,.3) !important;
          color: #fff !important;
          transition: box-shadow .2s ease !important;
        }
        .login-submit.ant-btn:hover {
          box-shadow: 0 6px 28px rgba(99,102,241,.45) !important;
        }
        .login-submit__label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .login-submit.ant-btn .ant-btn-loading-icon {
          color: rgba(255,255,255,.7) !important;
        }

        /* Footer */
        .login-footer {
          text-align: center;
          margin-top: 20px;
          margin-bottom: 0;
          font-size: 13px;
          color: #475569;
          font-family: 'DM Sans', sans-serif;
        }
        .login-footer__link {
          color: #818cf8;
          font-weight: 500;
          text-decoration: none;
          transition: color .15s ease;
        }
        .login-footer__link:hover {
          color: #a5b4fc;
        }
      `}</style>
    </>
  );
}
