import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom'
import { getInitialLang, t as translate, fmt, LangContext, useLang } from './i18n'

const API = '/api'

// ============ 工具 ============
function formatSize(bytes) {
  if (bytes === 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${u[i]}`
}
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = now - d
  const lang = localStorage.getItem('lt_lang') || 'en'
  if (diff < 60000) return lang === 'zh' ? '刚刚' : 'Just now'
  if (diff < 3600000) return lang === 'zh' ? `${Math.floor(diff / 60000)} 分钟前` : `${Math.floor(diff / 60000)} min ago`
  if (diff < 86400000) return lang === 'zh' ? `${Math.floor(diff / 3600000)} 小时前` : `${Math.floor(diff / 3600000)} hr ago`
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function getFileIcon(_category, isDir) {
  if (isDir) return '[DIR]'
  return '[FILE]'
}

// MIME type fallback — used when server doesn't provide X-Enc-Mime-Type header
function getMimeType(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase()
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    pdf: 'application/pdf',
    zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar', gz: 'application/gzip', bz2: 'application/x-bzip2',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain',
    json: 'application/json', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'application/javascript', mjs: 'application/javascript',
    ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript',
    py: 'text/x-python', java: 'text/x-java-source', c: 'text/x-c', cpp: 'text/x-c++',
    h: 'text/x-c', hpp: 'text/x-c++', cs: 'text/plain', go: 'text/plain',
    rs: 'text/plain', rb: 'text/x-ruby', php: 'text/x-php', swift: 'text/plain',
    kt: 'text/plain', scala: 'text/plain', lua: 'text/plain', r: 'text/plain',
    sh: 'text/x-sh', bat: 'text/plain', ps1: 'text/plain',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    exe: 'application/x-msdownload', msi: 'application/x-msdownload',
    apk: 'application/vnd.android.package-archive', dmg: 'application/x-apple-diskimage',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    sql: 'application/sql', db: 'application/octet-stream',
    toml: 'text/plain', ini: 'text/plain', cfg: 'text/plain', conf: 'text/plain',
    env: 'text/plain', lock: 'text/plain',
  }
  return map[ext] || 'application/octet-stream'
}

// ============ API 请求封装（自动带 token + 自动刷新） ============
let _refreshPromise = null

async function api(method, path, body, isFormData) {
  const headers = {}
  if (!isFormData) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  let r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  })

  // Auto-refresh token on 401
  if (r.status === 401 && !path.startsWith('/auth/')) {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      // Deduplicate concurrent refresh attempts
      if (!_refreshPromise) {
        _refreshPromise = fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        }).then(async (rr) => {
          if (rr.ok) {
            const d = await rr.json()
            localStorage.setItem('token', d.token)
            if (d.refreshToken) localStorage.setItem('refreshToken', d.refreshToken)
            return d.token
          }
          return null
        }).finally(() => { _refreshPromise = null })
      }
      const newToken = await _refreshPromise
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`
        r = await fetch(`${API}${path}`, {
          method,
          headers,
          body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
        })
      }
    }
  }

  return r
}

// ============ App 入口 ============
export default function App() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [verifyEmail, setVerifyEmail] = useState('')

  // 语言：'zh' | 'en'
  const [lang, setLang] = useState(getInitialLang)

  const toggleLang = () => {
    setLang(prev => {
      const next = prev === 'zh' ? 'en' : 'zh'
      localStorage.setItem('lt_lang', next)
      return next
    })
  }

  const t = (key) => translate(key, lang)

  // 主题：'auto' | 'light' | 'dark'
  const [theme, setTheme] = useState(() => localStorage.getItem('lt_theme') || 'auto')

  useEffect(() => {
    const applyTheme = () => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else if (theme === 'light') {
        document.documentElement.removeAttribute('data-theme')
      } else {
        // auto: follow system
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.setAttribute('data-theme', 'dark')
        } else {
          document.documentElement.removeAttribute('data-theme')
        }
      }
    }
    applyTheme()
    localStorage.setItem('lt_theme', theme)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { if (theme === 'auto') applyTheme() }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const cycleTheme = () => {
    setTheme(prev => prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto')
  }

  const themeLabel = theme === 'auto' ? '☼' : theme === 'dark' ? '☾' : '☀'

  // 启动时检查登录状态
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { setChecking(false); return }
    api('GET', '/auth/me').then(async (r) => {
      if (r.ok) {
        const d = await r.json()
        setUser(d.user)
      } else {
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
      }
    }).finally(() => setChecking(false))
  }, [])

  const handleLogin = (token, refreshToken, userData) => {
    localStorage.setItem('token', token)
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
    setUser(userData)
  }

  const handleLogout = async () => {
    await api('POST', '/auth/logout')
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    setUser(null)
  }

  const handleRegisterSuccess = (email) => {
    setVerifyEmail(email)
    navigate('/verify')
  }

  const handleVerified = () => {
    navigate('/login')
  }

  if (checking) {
    return <LangContext.Provider value={{ lang, t, toggleLang }}><div className="app"><div className="auth-page"><div className="auth-card anim-fadeInScale"><div style={{ textAlign: 'center', padding: '40px 0' }}><div className="skeleton skeleton-title" style={{ margin: '0 auto' }} /><div className="skeleton skeleton-text" style={{ width: '50%', margin: '12px auto 0' }} /></div></div></div></div></LangContext.Provider>
  }

  if (!user) {
    return (
      <LangContext.Provider value={{ lang, t, toggleLang }}>
      <div className="app">
        <Routes>
          <Route path="/" element={<HomePage user={null} onLogin={handleLogin} themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
          <Route path="/home" element={<HomePage user={null} onLogin={handleLogin} themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
          <Route path="/user/:userId" element={<MainApp user={null} onLogout={handleLogout} pageMode="user" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
          <Route path="/login" element={<LoginPage onLogin={handleLogin} t={t} />} />
          <Route path="/register" element={<RegisterPage onSuccess={handleRegisterSuccess} t={t} />} />
          <Route path="/verify" element={<VerifyPage email={verifyEmail} onVerified={handleVerified} t={t} />} />
          <Route path="/forgot" element={<ForgotPasswordPage t={t} />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </div>
      </LangContext.Provider>
    )
  }

  return (
    <LangContext.Provider value={{ lang, t, toggleLang }}>
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage user={user} onLogin={handleLogin} onLogout={handleLogout} themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
      <Route path="/privateWarehouse" element={<MainApp user={user} onLogout={handleLogout} pageMode="private" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
      <Route path="/publicWarehouse" element={<MainApp user={user} onLogout={handleLogout} pageMode="public" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
      <Route path="/profile" element={<MainApp user={user} onLogout={handleLogout} pageMode="profile" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
      <Route path="/user/:userId" element={<MainApp user={user} onLogout={handleLogout} pageMode="user" themeLabel={themeLabel} cycleTheme={cycleTheme} theme={theme} t={t} toggleLang={toggleLang} />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
    </LangContext.Provider>
  )
}

// ============ 登录页 ============
function LoginPage({ onLogin, t }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/login', { email: email.trim(), password })
      const d = await r.json()
      if (r.ok) {
        onLogin(d.token, d.refreshToken, d.user)
      } else {
        setError(d.error || t('networkError'))
      }
    } catch {
      setError(t('networkError'))
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card anim-fadeInUp">
        <Logo />
        <h2>{t('loginTitle')}</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="auth-input" type="email" placeholder={t('email')}
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          />
          <input
            className="auth-input" type="password" placeholder={t('password')}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="auth-error anim-shake">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? t('loggingIn') : t('login')}
          </button>
        </form>
        <div className="auth-switch">
          {t('noAccount')}<button className="btn-link" onClick={() => navigate('/register')}>{t('registerNow')}</button>
        </div>
        <div className="auth-switch" style={{ marginTop: '8px' }}>
          <button className="btn-link" onClick={() => navigate('/forgot')}>{t('forgotPassword')}</button>
        </div>
      </div>
    </div>
  )
}

// ============ 注册页 ============
function RegisterPage({ onSuccess, t }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !username.trim() || !password) return
    if (password.length < 6) { setError(t('passwordTooShort6')); return }
    if (password !== password2) { setError(t('passwordMismatch')); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/register', { email: email.trim(), username: username.trim(), password })
      const d = await r.json()
      if (r.ok) {
        onSuccess(d.email)
      } else {
        setError(d.error || t('networkError'))
      }
    } catch {
      setError(t('networkError'))
    }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card anim-fadeInUp">
        <Logo />
        <h2>{t('registerTitle')}</h2>
        <form onSubmit={handleSubmit}>
          <input
            className="auth-input" type="email" placeholder={t('email')}
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          />
          <input
            className="auth-input" type="text" placeholder={t('usernamePlaceholder')}
            value={username} onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="auth-input" type="password" placeholder={t('passwordPlaceholder')}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="auth-input" type="password" placeholder={t('confirmPassword')}
            value={password2} onChange={(e) => setPassword2(e.target.value)}
          />
          {error && <div className="auth-error anim-shake">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? t('registering') : t('register')}
          </button>
        </form>
        <div className="auth-switch">
          {t('hasAccount')}<button className="btn-link" onClick={() => navigate('/login')}>{t('loginNow')}</button>
        </div>
      </div>
    </div>
  )
}

// ============ 邮箱验证页 ============
function VerifyPage({ email, onVerified, t }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const handleVerify = async (e) => {
    e.preventDefault()
    if (code.length !== 8) { setError(t('codeRule')); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/verify', { email, code })
      const d = await r.json()
      if (r.ok) {
        setSuccess(true)
      } else {
        setError(d.error || t('networkError'))
      }
    } catch {
      setError(t('networkError'))
    }
    setLoading(false)
  }

  const handleResend = async () => {
    setCountdown(60)
    setError('')
    await api('POST', '/auth/resend', { email })
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card anim-fadeInUp">
          <Logo />
          <h2>{t('verifySuccess')}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
            {t('verifySuccess')}
          </p>
          <button className="auth-btn" onClick={onVerified}>{t('loginNow')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card anim-fadeInUp">
        <Logo />
        <h2>{t('verify')}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          {t('codeSent')} <strong>{email}</strong>
        </p>
        <form onSubmit={handleVerify}>
          <input
            className="auth-input auth-code-input"
            type="text" placeholder={t('codePlaceholder')} maxLength={8}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          {error && <div className="auth-error anim-shake">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? t('verifying') : t('verify')}
          </button>
        </form>
        <div className="auth-switch">
          {countdown > 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>{countdown}s</span>
          ) : (
            <button className="btn-link" onClick={handleResend}>{t('resendCode')}</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 首页（搜索页） ============
function HomePage({ user, onLogin, onLogout, themeLabel, cycleTheme, theme, t, toggleLang }) {
  const navigate = useNavigate()
  const { lang } = useLang()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const userMenuRef = useRef(null)
  const searchBarRef = useRef(null)
  const isLoggedIn = !!user

  // Public profile
  const [publicProfile, setPublicProfile] = useState(!!(user && user.publicProfile))
  const togglePublicProfile = async () => {
    const newVal = !publicProfile
    try {
      const r = await api('PATCH', '/auth/profile', { publicProfile: newVal })
      const d = await r.json()
      if (r.ok) {
        setPublicProfile(d.publicProfile)
      }
    } catch {}
  }

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lt_search_history') || '[]') }
    catch { return [] }
  })

  const saveSearchHistory = (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, 10)
      localStorage.setItem('lt_search_history', JSON.stringify(next))
      return next
    })
  }

  const handleSearch = async (e, queryOverride) => {
    const query = (queryOverride !== undefined ? queryOverride : searchQuery).trim()
    if (e?.preventDefault) e.preventDefault()
    setSearchError('')
    if (!query) { setSearchResults([]); return }
    setSearching(true)
    setSearchQuery(query)
    saveSearchHistory(query)
    try {
      const r = await api('GET', `/users/search?q=${encodeURIComponent(query)}`)
      if (!r.ok) {
        setSearchError(t('searchFailed'))
        setSearchResults([])
        setSearching(false)
        return
      }
      const data = await r.json()
      setSearchResults(data)
      if (data.length === 0) setSearchError(t('noPublicUsersFound'))
    } catch { setSearchError(t('networkError')); setSearchResults([]) }
    setSearching(false)
  }

  // Close menus on outside click
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false)
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) setSearchFocused(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const avatarUrl = user && user.avatar ? `/avatars/${user.avatar}` : null

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <Logo />
        </div>
        <div className="header-right">
          {isLoggedIn ? (
            <div className="user-menu" ref={userMenuRef} onClick={(e) => { e.stopPropagation(); setShowUserMenu(prev => !prev) }}>
              {avatarUrl ? (
                <img className="user-avatar-img" src={avatarUrl} alt={user.username} />
              ) : (
                <span className="user-avatar">{user.username.charAt(0).toUpperCase()}</span>
              )}
              <span className="user-name">{user.username}</span>
              {user.signature && <span className="user-signature">{user.signature}</span>}
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="user-dropdown-item user-dropdown-email">{user.email}</div>
                  <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/privateWarehouse'); setShowUserMenu(false) }}>
                    {t('privateWarehouse')}
                  </div>
                  <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/publicWarehouse'); setShowUserMenu(false) }}>
                    {t('publicWarehouse')}
                  </div>
                  <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/profile'); setShowUserMenu(false) }}>
                    {t('profile')}
                  </div>
                  <div className="user-dropdown-item user-dropdown-theme" onClick={(e) => { e.stopPropagation(); cycleTheme(); }}>
                    {t('themeLabel')}: {theme === 'auto' ? t('themeFollowSystem') : theme === 'dark' ? t('themeDark') : t('themeLight')}
                  </div>
                  <div className="user-dropdown-item user-dropdown-toggle" onClick={togglePublicProfile}>
                    {publicProfile ? t('publicWarehouseOn') : t('publicWarehouseOff')}
                  </div>
                  <div className="user-dropdown-item user-dropdown-logout" onClick={onLogout}>
                    {t('logout')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="home-auth-btns">
              <button className="btn-tool" onClick={() => navigate('/login')}>{t('login')}</button>
              <button className="btn-tool btn-primary" onClick={() => navigate('/register')}>{t('register')}</button>
            </div>
          )}
        </div>
      </header>

      {/* 居中搜索区域 */}
      <div className="home-search">
        <div className="home-search-inner">
          <div className="home-search-title">{t('appTitle')}</div>
          <div className="home-search-subtitle">{t('searchSubtitle')}</div>
          <div className="search-bar home-search-bar" ref={searchBarRef}>
            <form onSubmit={handleSearch} className="search-form">
              <input
                className="search-input home-search-input"
                type="text"
                placeholder={t('searchPublicUsers')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (!e.target.value.trim()) {
                    setSearchError('')
                    setSearchResults([])
                  } else if (searchResults.length > 0 || searchError) {
                    setSearchError('')
                    setSearchResults([])
                  }
                }}
                onFocus={() => setSearchFocused(true)}
              />
              <button className="search-btn home-search-btn" type="submit" disabled={searching}>{t('search')}</button>
            </form>
            {searchFocused && !searchQuery && searchHistory.length > 0 && searchResults.length === 0 && !searchError && (
              <div className="search-results">
                <div className="search-history-header">
                  <span>{t('searchHistory')}</span>
                  <button className="btn-link btn-link-sm" onClick={() => { setSearchHistory([]); localStorage.removeItem('lt_search_history') }}>{t('clear')}</button>
                </div>
                {searchHistory.map((q, i) => (
                  <div key={i} className="search-result-item search-history-item" onMouseDown={(e) => { e.preventDefault(); handleSearch(null, q) }}>
                    <span className="search-history-icon">~</span>
                    <span className="search-result-name">{q}</span>
                    <button className="btn-link btn-link-sm search-history-del" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                      e.stopPropagation()
                      setSearchHistory((prev) => {
                        const next = prev.filter((_, j) => j !== i)
                        localStorage.setItem('lt_search_history', JSON.stringify(next))
                        return next
                      })
                    }}>{t('delete')}</button>
                  </div>
                ))}
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((u) => (
                  <div key={u.id} className="search-result-item" onClick={() => {
                    saveSearchHistory(searchQuery)
                    navigate(`/user/${u.id}`)
                  }}>
                    {u.avatar ? (
                      <img className="search-result-avatar-img" src={`/avatars/${u.avatar}`} alt={u.username} />
                    ) : (
                      <span className="search-result-avatar">{u.username.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="search-result-name">{u.username}</span>
                    <span className="search-result-hint">{t('clickToViewPublic')}</span>
                  </div>
                ))}
              </div>
            )}
            {searchError && !searching && (
              <div className="search-results">
                <div className="search-result-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
                  {searchError}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="app-footer">
        <span className="footer-link" onClick={() => setShowAbout(true)}>{t('about')}</span>
      </footer>
      {showAbout && (
        <Modal onClose={() => setShowAbout(false)} title={t('aboutEmberclouds')}>
          <div className="about-content">
            <div className="about-section">
              <h3 className="about-label">{t('sourceCode')}</h3>
              <a className="about-link" href="https://github.com/Ember5714/Emberclouds" target="_blank" rel="noopener noreferrer">
                github.com/Ember5714/Emberclouds
              </a>
            </div>
            <div className="about-section">
              <h3 className="about-label">{t('socialMedia')}</h3>
              <div className="about-links">
                <a className="about-link" href="https://space.bilibili.com/3493086938270254" target="_blank" rel="noopener noreferrer">
                  bilibili: @Ember5714
                </a>
                <a className="about-link" href="https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w" target="_blank" rel="noopener noreferrer">
                  {t('douyin')}
                </a>
              </div>
            </div>
            <div className="about-section">
              <h3 className="about-label">{t('author')}</h3>
              <span className="about-text">Ember5714</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ============ 主应用（已登录） ============
function MainApp({ user, onLogout, pageMode, themeLabel, cycleTheme, theme, t }) {
  const params = useParams()
  const navigate = useNavigate()
  const [dir, setDir] = useState(null)
  const [items, setItems] = useState([])
  const [parent, setParent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('grid')
  const [selected, setSelected] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)

  // 图片预览时通过 fetch 获取 blob URL（不在 URL 中传 token）
  useEffect(() => {
    if (!previewFile) { setPreviewUrl(null); return }
    let cancelled = false
    const loadPreview = async () => {
      let url
      if (publicUser) {
        url = `${API}/users/${publicUser.id}/public/download?path=${encodeURIComponent(previewFile.path)}`
      } else {
        url = `${API}/files/download?path=${encodeURIComponent(previewFile.path)}&visibility=${visibility}`
      }
      try {
        const token = localStorage.getItem('token')
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {}
        const res = await fetch(url, { headers })
        if (!res.ok) return
        const blob = await res.blob()
        if (!cancelled) setPreviewUrl(URL.createObjectURL(blob))
      } catch (_) {}
    }
    loadPreview()
    return () => { cancelled = true }
  }, [previewFile])
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [renameTarget, setRenameTarget] = useState(null)
  const [notify, setNotify] = useState(null)
  const [showUserMenu, setShowUserMenu] = useState(false)

  // 公开/私密
  const [visibility, setVisibility] = useState(pageMode === 'public' ? 'public' : 'private')

  // 同步 visibility 与 URL 路由
  useEffect(() => {
    if (pageMode === 'public') setVisibility('public')
    else if (pageMode === 'private') setVisibility('private')
  }, [pageMode])
  const [publicProfile, setPublicProfile] = useState(!!user.publicProfile)

  // 搜索用户
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)

  // 点击外部关闭下拉
  const userMenuRef = useRef(null)
  const searchBarRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false)
      }
      if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
        setSearchFocused(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // 正在浏览的公开用户（从 URL 参数获取）
  const publicUser = pageMode === 'user' ? { id: params.userId } : null
  const viewingOwnProfile = pageMode === 'profile'
  const isProfileView = pageMode === 'user' || pageMode === 'profile'
  const isOwnSpace = pageMode === 'private' || pageMode === 'public'

  // 搜索历史（localStorage 持久化，最多 10 条）
  const [searchHistory, setSearchHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lt_search_history') || '[]') }
    catch { return [] }
  })

  // 设置
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [currentUser, setCurrentUser] = useState(user) // 动态更新用户信息

  const toast = useCallback((msg, type = 'info') => {
    setNotify({ msg, type, id: Date.now() })
    setTimeout(() => setNotify(null), 3000)
  }, [])

  const loadDir = useCallback(async (dirPath, targetPublicUser, visOverride) => {
    const pu = targetPublicUser !== undefined ? targetPublicUser : publicUser
    const vis = visOverride !== undefined ? visOverride : visibility
    setLoading(true)
    try {
      let url
      if (pu) {
        const params = dirPath ? `?dir=${encodeURIComponent(dirPath)}` : ''
        url = `/users/${pu.id}/public/browse${params}`
      } else {
        const params = new URLSearchParams()
        params.set('visibility', vis)
        if (dirPath) params.set('dir', dirPath)
        url = `/files/browse?${params.toString()}`
      }
      const r = await api('GET', url)
      const data = await r.json()
      if (r.ok) {
        setDir(data.dir || '')
        setItems(data.items)
        setParent(data.parent)
      } else {
        toast(data.error || t('loadFailed'), 'error')
      }
    } catch { toast(t('networkError'), 'error') }
    setLoading(false)
    setSelected([])
  }, [toast, visibility, pageMode, params.userId])

  useEffect(() => { loadDir() }, [loadDir])

  // 路由变化时加载资料
  useEffect(() => {
    if (pageMode === 'user' && params.userId) {
      setEditingProfile(false)
      setEditBio('')
      fetchProfile({ id: params.userId })
    } else if (pageMode === 'profile') {
      setEditingProfile(false)
      setEditBio('')
      // 加载自己的个人资料
      ;(async () => {
        try {
          const r = await api('GET', '/auth/profile-bio')
          const d = await r.json()
          setProfileInfo({
            id: user.id,
            username: user.username,
            avatar: user.avatar || null,
            background: user.background || null,
            signature: user.signature || '',
            bio: d.bio || '',
          })
        } catch { /* ignore */ }
      })()
    } else {
      setProfileInfo(null)
    }
  }, [pageMode, params.userId])

  const enterDir = (item) => { if (item.isDir) loadDir(item.path) }
  const goUp = () => { if (parent !== null) loadDir(parent) }

  const breadcrumbs = () => {
    if (!dir || dir === '') return []
    const parts = []
    const segs = dir.replace(/\\/g, '/').split('/').filter(Boolean)
    let cur = ''
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg
      parts.push({ name: seg, path: cur })
    }
    parts.unshift({ name: t('rootDir'), path: '' })
    return parts
  }

  const toggleSelect = (item) => {
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.path === item.path)
      if (idx >= 0) return prev.filter((s) => s.path !== item.path)
      return [...prev, item]
    })
  }
  const selectAll = () => {
    if (selected.length === items.length) setSelected([])
    else setSelected([...items])
  }

  const downloadFile = async (item) => {
    if (item.isDir) return
    let url
    if (publicUser) {
      url = `${API}/users/${publicUser.id}/public/download-encrypted?path=${encodeURIComponent(item.path)}`
    } else {
      url = `${API}/files/download-encrypted?path=${encodeURIComponent(item.path)}&visibility=${visibility}`
    }

    try {
      const token = localStorage.getItem('token')
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {}
      const response = await fetch(url, { headers })
      if (!response.ok) {
        const err = await response.text()
        toast(t('downloadFailed').replace('{msg}', err || `HTTP ${response.status}`), 'error')
        return
      }

      const encKeyB64 = response.headers.get('X-Enc-Key')
      const encIvB64 = response.headers.get('X-Enc-IV')
      const originalName = decodeURIComponent(
        response.headers.get('X-Enc-Original-Name') || item.name
      )
      // Read MIME type from server, fallback to extension-based detection
      const mimeType = response.headers.get('X-Enc-Mime-Type') || getMimeType(originalName)

      if (!encKeyB64 || !encIvB64) {
        toast(t('missingEncryptionKey'), 'error')
        return
      }

      // Base64 → Uint8Array
      const keyBytes = Uint8Array.from(atob(encKeyB64), c => c.charCodeAt(0))
      const ivBytes = Uint8Array.from(atob(encIvB64), c => c.charCodeAt(0))
      const encryptedData = await response.arrayBuffer()

      // AES-256-CTR 解密
      const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, false, ['decrypt'])
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: ivBytes, length: 128 },
        cryptoKey,
        encryptedData
      )

      // Gzip 解压
      const ds = new DecompressionStream('gzip')
      const writer = ds.writable.getWriter()
      writer.write(decrypted)
      writer.close()
      const decompressed = await new Response(ds.readable).arrayBuffer()

      // 触发浏览器保存
      const blob = new Blob([decompressed], { type: mimeType })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = originalName
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (err) {
      toast(t('downloadFailed').replace('{msg}', err.message), 'error')
    }
  }

  const copyToMyWarehouse = async (item) => {
    if (!publicUser) return
    try {
      const r = await api('POST', `/users/${publicUser.id}/copytome`, { filePath: item.path })
      if (r.ok) {
        toast(t('copiedToPrivate').replace('{name}', item.name))
      } else {
        const d = await r.json()
        toast(d.error || t('copyFailed'), 'error')
      }
    } catch { toast(t('networkError'), 'error') }
  }

  const preview = (item) => {
    if (item.isDir) return enterDir(item)
    if (item.category === 'image') setPreviewFile(item)
    else downloadFile(item)
  }

  const deleteItems = async (targets) => {
    const names = targets.map((t) => t.name).join(', ')
    if (!confirm(t('confirmDeleteNames').replace('{names}', names))) return
    try {
      for (const t of targets) {
        await api('DELETE', '/files', { path: t.path, visibility })
      }
      toast(t('deletedMsg').replace('{names}', names))
      loadDir(dir)
    } catch { toast(t('deleteFailed'), 'error') }
  }

  const createFolder = async (name) => {
    try {
      const r = await api('POST', '/files/mkdir', { dir, name, visibility })
      const d = await r.json()
      if (r.ok) { toast(t('folderCreated').replace('{name}', name)); loadDir(dir) }
      else toast(d.error || t('createFailed'), 'error')
    } catch { toast(t('networkError'), 'error') }
  }

  const rename = async (oldPath, newName) => {
    try {
      const r = await api('POST', '/files/rename', { path: oldPath, name: newName, visibility })
      const d = await r.json()
      if (r.ok) { toast(t('renamedTo').replace('{name}', newName)); loadDir(dir) }
      else toast(d.error || t('renameFailed'), 'error')
    } catch { toast(t('networkError'), 'error') }
  }

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return
    setShowUpload(false)
    setUploading(true)
    const formData = new FormData()
    formData.append('userId', user.id)
    formData.append('visibility', visibility)
    if (dir) formData.append('dir', dir)
    for (const f of files) formData.append('files', f)
    const startTime = Date.now()
    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const elapsed = (Date.now() - startTime) / 1000
          setUploadProgress({
            percent: Math.round((e.loaded / e.total) * 100),
            speed: elapsed > 0 ? e.loaded / elapsed : 0,
            loaded: e.loaded, total: e.total,
          })
        }
      })
      await new Promise((resolve, reject) => {
        xhr.open('POST', `${API}/files/upload`)
        xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`)
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { resolve(JSON.parse(xhr.responseText)); return }
            try { const d = JSON.parse(xhr.responseText); reject(new Error(d.error || `HTTP ${xhr.status}`)) }
            catch { reject(new Error(`HTTP ${xhr.status}`)) }
          }
        xhr.onerror = () => reject(new Error(t('connectionFailed')))
        xhr.ontimeout = () => reject(new Error(t('timeout')))
        xhr.timeout = 0
        xhr.send(formData)
      })
      toast(t('uploadComplete').replace('{count}', files.length))
      loadDir(dir)
    } catch (e) { toast(t('uploadFailedMsg').replace('{msg}', e.message), 'error') }
    setUploading(false)
    setUploadProgress(null)
  }

  // 保存搜索历史
  const saveSearchHistory = (query) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setSearchHistory((prev) => {
      const next = [trimmed, ...prev.filter((q) => q !== trimmed)].slice(0, 10)
      localStorage.setItem('lt_search_history', JSON.stringify(next))
      return next
    })
  }

  const handleSearch = async (e, queryOverride) => {
    const query = (queryOverride !== undefined ? queryOverride : searchQuery).trim()
    if (e?.preventDefault) e.preventDefault()
    setSearchError('')
    if (!query) { setSearchResults([]); return }
    setSearching(true)
    setSearchQuery(query)
    saveSearchHistory(query)
    try {
      const r = await api('GET', `/users/search?q=${encodeURIComponent(query)}`)
      if (!r.ok) {
        setSearchError(t('searchFailed'))
        setSearchResults([])
        setSearching(false)
        return
      }
      const data = await r.json()
      setSearchResults(data)
      if (data.length === 0) setSearchError(t('noPublicUsersFound'))
    } catch { setSearchError(t('networkError')); setSearchResults([]) }
    setSearching(false)
  }

  // 进入公开用户空间
  const [profileInfo, setProfileInfo] = useState(null) // { username, avatar, background, signature, bio }
  const [editingProfile, setEditingProfile] = useState(false)
  const [editBio, setEditBio] = useState('')
  const bgInputRef = useRef(null)

  const fetchProfile = async (targetUser) => {
    try {
      const r = await api('GET', `/users/${targetUser.id}/profile`)
      if (r.ok) {
        const data = await r.json()
        setProfileInfo(data)
      }
    } catch { setProfileInfo(null) }
  }

  // 搜索后跳转到用户页面
  const openPublicUser = (targetUser, query) => {
    if (query) saveSearchHistory(query)
    navigate(`/user/${targetUser.id}`)
  }

  // 查看自己的个人主页
  const openOwnProfile = () => {
    navigate('/profile')
  }

  // 关闭个人主页（返回我的仓库）
  const closeOwnProfile = () => navigate('/privateWarehouse')
  const backToMySpace = () => navigate('/privateWarehouse')

  // 保存个人简介
  const handleSaveBio = async () => {
    try {
      const r = await api('PUT', '/auth/profile-bio', { content: editBio })
      const d = await r.json()
      if (r.ok) {
        setProfileInfo((prev) => ({ ...prev, bio: editBio }))
        setEditingProfile(false)
        toast(t('bioSaved'))
      } else toast(d.error || t('saveFailed'), 'error')
    } catch { toast(t('networkError'), 'error') }
  }

  // 上传背景图
  const handleBgUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('background', file)
    try {
      const r = await fetch(`${API}/auth/profile-background`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })
      const d = await r.json()
      if (r.ok) {
        setProfileInfo((prev) => ({ ...prev, background: d.background }))
        toast(t('backgroundUpdated'))
      } else toast(d.error || t('uploadFailed'), 'error')
    } catch { toast(t('networkError'), 'error') }
    e.target.value = ''
  }

  // 切换公开资料
  const togglePublicProfile = async () => {
    const newVal = !publicProfile
    try {
      const r = await api('PATCH', '/auth/profile', { publicProfile: newVal })
      const d = await r.json()
      if (r.ok) {
        setPublicProfile(d.publicProfile)
        toast(d.publicProfile ? t('publicProfileEnabled') : t('publicProfileDisabled'))
      } else {
        toast(d.error || t('operationFailed'), 'error')
      }
    } catch { toast(t('networkError'), 'error') }
  }

  // 修改密码
  const handleChangePassword = async (code, newPw) => {
    try {
      const r = await api('PATCH', '/auth/password', { code, newPassword: newPw })
      const d = await r.json()
      if (r.ok) toast(t('passwordChanged'))
      else toast(d.error || t('changeFailed'), 'error')
      return r.ok
    } catch { toast(t('networkError'), 'error'); return false }
  }

  // 修改用户名
  const handleChangeUsername = async (newName) => {
    try {
      const r = await api('PATCH', '/auth/username', { username: newName })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, username: d.username }))
        toast(t('usernameChanged'))
      } else toast(d.error || t('changeFailed'), 'error')
      return r.ok
    } catch { toast(t('networkError'), 'error'); return false }
  }

  // 修改个性签名
  const handleSetSignature = async (signature) => {
    try {
      const r = await api('PATCH', '/auth/signature', { signature })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, signature: d.signature }))
        toast(t('signatureUpdated'))
      } else toast(d.error || t('updateFailed'), 'error')
      return r.ok
    } catch { toast(t('networkError'), 'error'); return false }
  }

  // 上传头像
  const handleUploadAvatar = async (file) => {
    const formData = new FormData()
    formData.append('avatar', file)
    try {
      const r = await fetch(`${API}/auth/avatar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      })
      const d = await r.json()
      if (r.ok) {
        setCurrentUser((prev) => ({ ...prev, avatar: d.avatar }))
        toast(t('avatarUpdated'))
      } else toast(d.error || t('uploadFailed'), 'error')
      return r.ok
    } catch { toast(t('networkError'), 'error'); return false }
  }

  // 注销账号
  const handleDeleteAccount = async (code) => {
    try {
      const r = await api('DELETE', '/auth/account', { code })
      const d = await r.json()
      if (r.ok) {
        toast(t('accountDeleted'))
        localStorage.removeItem('token')
        localStorage.removeItem('refreshToken')
        setTimeout(() => onLogout(), 1000)
      } else toast(d.error || t('deleteFailed'), 'error')
      return r.ok
    } catch { toast(t('networkError'), 'error'); return false }
  }

  const avatarUrl = currentUser.avatar ? `/avatars/${currentUser.avatar}` : null

  const selectedStats = selected.length > 0
    ? t('selectedItems').replace('{count}', selected.length).replace('{size}', formatSize(selected.reduce((s, i) => s + (i.size || 0), 0)))
    : ''

  return (
    <div className="app">
      {notify && <div className={`toast toast-${notify.type}`}>{notify.msg}</div>}

      {isProfileView ? (
        /* ========== 个人主页 / 他人仓库 独立页面 ========== */
        <div className="profile-page">
          <header className="profile-page-header">
            <button className="btn-back" onClick={viewingOwnProfile ? closeOwnProfile : backToMySpace}>
              {t('backToMyWarehouse')}
            </button>
            <div className="profile-page-logo"><Logo /></div>
            <span className="profile-page-title">
              {viewingOwnProfile ? t('myProfile') : t('publicWarehouseOf').replace('{name}', profileInfo?.username || 'User')}
            </span>
          </header>

          {profileInfo && (
            <ProfileCard
              profile={profileInfo}
              isOwner={user && profileInfo.id === user.id}
              editing={editingProfile}
              editBio={editBio}
              onEditBio={setEditBio}
              onStartEdit={() => { setEditingProfile(true); setEditBio(profileInfo.bio || '') }}
              onCancelEdit={() => setEditingProfile(false)}
              onSaveBio={handleSaveBio}
              onBgUpload={handleBgUpload}
              bgInputRef={bgInputRef}
              t={t}
            />
          )}

          {publicUser && (
            <>
              <div className="toolbar">
                <div className="toolbar-left">
                  <div className="breadcrumb">
                    <button className="btn-back" onClick={goUp} disabled={!parent} title={t('backToParent')}>{t('back')}</button>
                    {breadcrumbs().map((b, i) => (
                      <span key={i}>
                        {i > 0 && <span className="bc-sep">/</span>}
                        <button className={`bc-item ${i === breadcrumbs().length - 1 ? 'bc-current' : ''}`} onClick={() => loadDir(b.path)}>
                          {b.name}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="toolbar-right">
                  <button className="btn-tool" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
                    {viewMode === 'grid' ? t('listView') : t('gridView')}
                  </button>
                  <button className="btn-tool" onClick={() => loadDir(dir)}>{t('refresh')}</button>
                </div>
              </div>

              <div className="main-content">
                {loading ? (
                  <div className="content-card" style={{ padding: '24px' }}>
                    <div className="skeleton skeleton-title" />
                    <div className="skeleton skeleton-text" style={{ width: '80%' }} />
                    <div className="skeleton skeleton-text" style={{ width: '65%' }} />
                    <div className="skeleton skeleton-text" />
                    <div className="skeleton skeleton-card" style={{ marginTop: '16px' }} />
                  </div>
                ) : items.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">--</div>
                    <p>{t('thisFolderEmpty')}</p>
                  </div>
                ) : viewMode === 'grid' ? (
                  <div className="content-card">
                    <div className="file-grid">
                      {items.map((item, idx) => {
                        const isSel = selected.some((s) => s.path === item.path)
                        return (
                          <div key={item.path} className={`file-grid-item ${isSel ? 'selected' : ''}`}
                            style={{ animationDelay: `${Math.min(idx * 0.03, 0.5)}s` }}
                            onDoubleClick={() => preview(item)}
                            onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                            <div className="file-icon">{getFileIcon(item.category, item.isDir)}</div>
                            <div className="file-name" title={item.name}>{item.name}</div>
                            <div className="file-meta">{item.isDir ? t('folder') : formatSize(item.size)}</div>
                            <div className="file-actions-overlay">
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? t('open') : t('preview')}>
                                {item.isDir ? t('open') : t('preview')}
                              </button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title={t('download')} disabled={item.isDir}>{t('download')}</button>
                              {user && <button className="act-btn" onClick={(e) => { e.stopPropagation(); copyToMyWarehouse(item) }} title={t('copyToMyWarehouse')}>{t('copy')}</button>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="content-card" style={{ padding: 0 }}>
                    <div className="file-list-table">
                      <div className="file-list-header-row">
                        <div className="col-name">{t('name')}</div>
                        <div className="col-size">{t('size')}</div>
                        <div className="col-date">{t('modifiedTime')}</div>
                        <div className="col-actions">{t('actions')}</div>
                      </div>
                      {items.map((item, idx) => {
                        const isSel = selected.some((s) => s.path === item.path)
                        return (
                          <div key={item.path} className={`file-list-row ${isSel ? 'selected' : ''}`}
                            style={{ animationDelay: `${Math.min(idx * 0.03, 0.5)}s` }}
                            onDoubleClick={() => preview(item)}
                            onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                            <div className="col-name"><span className="list-icon">{getFileIcon(item.category, item.isDir)}</span>{item.name}</div>
                            <div className="col-size">{item.isDir ? '-' : formatSize(item.size)}</div>
                            <div className="col-date">{formatDate(item.mtime)}</div>
                            <div className="col-actions">
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? t('open') : t('preview')}>{item.isDir ? t('open') : t('preview')}</button>
                              <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title={t('download')} disabled={item.isDir}>{t('download')}</button>
                              {user && <button className="act-btn" onClick={(e) => { e.stopPropagation(); copyToMyWarehouse(item) }} title={t('copyToMyWarehouse')}>{t('copy')}</button>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {previewFile && (
                <Modal onClose={() => setPreviewFile(null)} title={previewFile.name} wide>
                  <div className="preview-container">
                    <img src={previewUrl} alt={previewFile.name} className="preview-img" />
                    <div className="preview-info">
                      <span>{previewFile.name}</span>
                      <span>{formatSize(previewFile.size)}</span>
                      <button className="btn-primary" onClick={() => downloadFile(previewFile)}>{t('downloadOriginal')}</button>
                    </div>
                  </div>
                </Modal>
              )}
            </>
          )}
        </div>
      ) : (
        /* ========== 正常文件浏览器 ========== */
        <>
          <header className="header">
            <div className="header-left">
              <Logo />
            </div>
            <div className="header-right">
              <div className="user-menu" ref={userMenuRef} onClick={(e) => { e.stopPropagation(); setShowUserMenu(prev => !prev) }}>
                {avatarUrl ? (
                  <img className="user-avatar-img" src={avatarUrl} alt={currentUser.username} />
                ) : (
                  <span className="user-avatar">{currentUser.username.charAt(0).toUpperCase()}</span>
                )}
                <span className="user-name">{currentUser.username}</span>
                {currentUser.signature && <span className="user-signature">{currentUser.signature}</span>}
                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="user-dropdown-item user-dropdown-email">{currentUser.email}</div>
                    <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/home'); setShowUserMenu(false) }}>
                      {t('home')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/privateWarehouse'); setShowUserMenu(false) }}>
                      {t('privateWarehouse')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-nav" onClick={(e) => { e.stopPropagation(); navigate('/publicWarehouse'); setShowUserMenu(false) }}>
                      {t('publicWarehouse')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-theme" onClick={(e) => { e.stopPropagation(); cycleTheme(); }}>
                      {t('themeLabel')}: {theme === 'auto' ? t('themeFollowSystem') : theme === 'dark' ? t('themeDark') : t('themeLight')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-toggle" onClick={togglePublicProfile}>
                      {publicProfile ? t('publicWarehouseOn') : t('publicWarehouseOff')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-profile" onClick={(e) => { e.stopPropagation(); openOwnProfile(); setShowUserMenu(false) }}>
                      {t('profile')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-settings" onClick={(e) => { e.stopPropagation(); setShowSettings(true); setShowUserMenu(false) }}>
                      {t('accountSettings')}
                    </div>
                    <div className="user-dropdown-item user-dropdown-logout" onClick={onLogout}>
                      {t('logout')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* 搜索栏 */}
          <div className="search-bar" ref={searchBarRef}>
            <form onSubmit={handleSearch} className="search-form">
              <input
                className="search-input"
                type="text"
                placeholder={t('searchPublicUsers')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (!e.target.value.trim()) {
                    setSearchError('')
                    setSearchResults([])
                  } else if (searchResults.length > 0 || searchError) {
                    setSearchError('')
                    setSearchResults([])
                  }
                }}
                onFocus={() => setSearchFocused(true)}
              />
              <button className="search-btn" type="submit" disabled={searching}>{t('search')}</button>
            </form>
            {/* 搜索历史 */}
            {searchFocused && !searchQuery && searchHistory.length > 0 && searchResults.length === 0 && !searchError && (
              <div className="search-results">
                <div className="search-history-header">
                  <span>{t('searchHistory')}</span>
                  <button className="btn-link btn-link-sm" onClick={() => { setSearchHistory([]); localStorage.removeItem('lt_search_history') }}>{t('clear')}</button>
                </div>
                {searchHistory.map((q, i) => (
                  <div key={i} className="search-result-item search-history-item" onMouseDown={(e) => { e.preventDefault(); handleSearch(null, q) }}>
                    <span className="search-history-icon">~</span>
                    <span className="search-result-name">{q}</span>
                    <button className="btn-link btn-link-sm search-history-del" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => {
                      e.stopPropagation()
                      setSearchHistory((prev) => {
                        const next = prev.filter((_, j) => j !== i)
                        localStorage.setItem('lt_search_history', JSON.stringify(next))
                        return next
                      })
                    }}>{t('delete')}</button>
                  </div>
                ))}
              </div>
            )}
            {/* 搜索结果 */}
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((u) => (
                  <div key={u.id} className="search-result-item" onClick={() => openPublicUser(u, searchQuery)}>
                    {u.avatar ? (
                      <img className="search-result-avatar-img" src={`/avatars/${u.avatar}`} alt={u.username} />
                    ) : (
                      <span className="search-result-avatar">{u.username.charAt(0).toUpperCase()}</span>
                    )}
                    <span className="search-result-name">{u.username}</span>
                    <span className="search-result-hint">{t('clickToViewPublic')}</span>
                  </div>
                ))}
              </div>
            )}
            {searchError && !searching && (
              <div className="search-results">
                <div className="search-result-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>
                  {searchError}
                </div>
              </div>
            )}
          </div>

          <div className="toolbar">
            <div className="toolbar-left">
              <div className="breadcrumb">
                <button className="btn-back" onClick={goUp} disabled={!parent} title={t('backToParent')}>{t('back')}</button>
                {breadcrumbs().map((b, i) => (
                  <span key={i}>
                    {i > 0 && <span className="bc-sep">/</span>}
                    <button className={`bc-item ${i === breadcrumbs().length - 1 ? 'bc-current' : ''}`} onClick={() => loadDir(b.path)}>
                      {b.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="toolbar-right">
              {selected.length > 0 && (
                <>
                  <span className="selected-info">{selectedStats}</span>
                  <button className="btn-tool btn-danger" onClick={() => deleteItems(selected)}>{t('deleteSelected')}</button>
                </>
              )}
              <button className="btn-tool" onClick={() => setShowNewFolder(true)}>{t('newFolder')}</button>
              <button className="btn-tool" onClick={() => setShowUpload(true)}>{t('upload')}</button>
              <button className="btn-tool" onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
                {viewMode === 'grid' ? t('listView') : t('gridView')}
              </button>
              <button className="btn-tool" onClick={() => loadDir(dir)}>{t('refresh')}</button>
            </div>
          </div>

          {uploading && uploadProgress && (
            <div className="upload-bar">
              <div className="upload-bar-header">
                <span>{t('uploading')}</span>
                <span>{uploadProgress.percent}% ({formatSize(uploadProgress.loaded)} / {formatSize(uploadProgress.total)})</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${uploadProgress.percent}%` }} />
              </div>
              {uploadProgress.speed > 0 && <span className="upload-speed">{formatSize(uploadProgress.speed)}/s</span>}
            </div>
          )}

          <div className="main-content">
            {loading ? (
              <div className="content-card" style={{ padding: '24px' }}>
                <div className="skeleton skeleton-title" />
                <div className="skeleton skeleton-text" style={{ width: '80%' }} />
                <div className="skeleton skeleton-text" style={{ width: '65%' }} />
                <div className="skeleton skeleton-text" />
                <div className="skeleton skeleton-card" style={{ marginTop: '16px' }} />
              </div>
            ) : items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">--</div>
                <p>{t('thisFolderEmpty')}</p>
                <p className="empty-hint">{t('uploadHint')}</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="content-card">
                <div className="file-grid">
                  <div className="file-grid-item select-all" onClick={selectAll} style={{ animationDelay: '0s' }}>
                    <div className="file-icon">{selected.length === items.length ? '[v]' : '[ ]'}</div>
                    <div className="file-name">{t('selectAll')}</div>
                  </div>
                  {items.map((item, idx) => {
                    const isSel = selected.some((s) => s.path === item.path)
                    return (
                      <div key={item.path} className={`file-grid-item ${isSel ? 'selected' : ''}`}
                        style={{ animationDelay: `${Math.min((idx + 1) * 0.03, 0.5)}s` }}
                        onDoubleClick={() => preview(item)}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                        <div className="file-icon">{getFileIcon(item.category, item.isDir)}</div>
                        <div className="file-name" title={item.name}>{item.name}</div>
                        <div className="file-meta">{item.isDir ? t('folder') : formatSize(item.size)}</div>
                        <div className="file-actions-overlay">
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? t('open') : t('preview')}>
                            {item.isDir ? t('open') : t('preview')}
                          </button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title={t('download')} disabled={item.isDir}>{t('download')}</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); setRenameTarget(item) }} title={t('rename')}>{t('rename')}</button>
                          <button className="act-btn act-del" onClick={(e) => { e.stopPropagation(); deleteItems([item]) }} title={t('delete')}>{t('delete')}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="content-card" style={{ padding: 0 }}>
                <div className="file-list-table">
                  <div className="file-list-header-row">
                    <div className="col-check" onClick={selectAll}>{selected.length === items.length ? '[v]' : '[ ]'}</div>
                    <div className="col-name">{t('name')}</div>
                    <div className="col-size">{t('size')}</div>
                    <div className="col-date">{t('modifiedTime')}</div>
                    <div className="col-actions">{t('actions')}</div>
                  </div>
                  {items.map((item, idx) => {
                    const isSel = selected.some((s) => s.path === item.path)
                    return (
                      <div key={item.path} className={`file-list-row ${isSel ? 'selected' : ''}`}
                        style={{ animationDelay: `${Math.min(idx * 0.03, 0.5)}s` }}
                        onDoubleClick={() => preview(item)}
                        onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(item) }}>
                        <div className="col-check" onClick={(e) => { e.stopPropagation(); toggleSelect(item) }}>{isSel ? '[v]' : '[ ]'}</div>
                        <div className="col-name"><span className="list-icon">{getFileIcon(item.category, item.isDir)}</span>{item.name}</div>
                        <div className="col-size">{item.isDir ? '-' : formatSize(item.size)}</div>
                        <div className="col-date">{formatDate(item.mtime)}</div>
                        <div className="col-actions">
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); preview(item) }} title={item.isDir ? t('open') : t('preview')}>{item.isDir ? t('open') : t('preview')}</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); downloadFile(item) }} title={t('download')} disabled={item.isDir}>{t('download')}</button>
                          <button className="act-btn" onClick={(e) => { e.stopPropagation(); setRenameTarget(item) }} title={t('rename')}>{t('rename')}</button>
                          <button className="act-btn act-del" onClick={(e) => { e.stopPropagation(); deleteItems([item]) }} title={t('delete')}>{t('delete')}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {showUpload && (
            <Modal onClose={() => setShowUpload(false)} title={t('uploadToVisibility').replace('{visibility}', visibility === 'public' ? t('publicVisibility') : t('privateVisibility'))}>
              <UploadPanel onUpload={handleUpload} onClose={() => setShowUpload(false)} t={t} />
            </Modal>
          )}
          {showNewFolder && (
            <Modal onClose={() => setShowNewFolder(false)} title={t('createFolder')}>
              <InputModal placeholder={t('folderNamePlaceholder')} onSubmit={(name) => { createFolder(name); setShowNewFolder(false) }} onClose={() => setShowNewFolder(false)} t={t} />
            </Modal>
          )}
          {renameTarget && (
            <Modal onClose={() => setRenameTarget(null)} title={t('renameTitle')}>
              <InputModal placeholder={t('newName')} defaultValue={renameTarget.name} onSubmit={(name) => { rename(renameTarget.path, name); setRenameTarget(null) }} onClose={() => setRenameTarget(null)} t={t} />
            </Modal>
          )}
          {previewFile && (
            <Modal onClose={() => setPreviewFile(null)} title={previewFile.name} wide>
              <div className="preview-container">
                <img src={previewUrl} alt={previewFile.name} className="preview-img" />
                <div className="preview-info">
                  <span>{previewFile.name}</span>
                  <span>{formatSize(previewFile.size)}</span>
                  <button className="btn-primary" onClick={() => downloadFile(previewFile)}>{t('downloadOriginal')}</button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}
      {showSettings && (
        <SettingsPage
          user={currentUser}
          avatarUrl={avatarUrl}
          onChangePassword={handleChangePassword}
          onChangeUsername={handleChangeUsername}
          onSetSignature={handleSetSignature}
          onUploadAvatar={handleUploadAvatar}
          onDeleteAccount={handleDeleteAccount}
          onClose={() => setShowSettings(false)}
          t={t}
        />
      )}
      {/* 页脚 */}
      <footer className="app-footer">
        <span className="footer-link" onClick={() => setShowAbout(true)}>{t('about')}</span>
      </footer>
      {showAbout && (
        <Modal onClose={() => setShowAbout(false)} title={t('aboutEmberclouds')}>
          <div className="about-content">
            <div className="about-section">
              <h3 className="about-label">{t('sourceCode')}</h3>
              <a className="about-link" href="https://github.com/Ember5714/Emberclouds" target="_blank" rel="noopener noreferrer">
                github.com/Ember5714/Emberclouds
              </a>
            </div>
            <div className="about-section">
              <h3 className="about-label">{t('socialMedia')}</h3>
              <div className="about-links">
                <a className="about-link" href="https://space.bilibili.com/3493086938270254" target="_blank" rel="noopener noreferrer">
                  bilibili: @Ember5714
                </a>
                <a className="about-link" href="https://www.douyin.com/user/MS4wLjABAAAARFMQwKlxUI_B0j0cQwzbeJbZKuBI5QuyesZLXgKdD1w" target="_blank" rel="noopener noreferrer">
                  {t('douyin')}
                </a>
              </div>
            </div>
            <div className="about-section">
              <h3 className="about-label">{t('author')}</h3>
              <span className="about-text">Ember5714</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ============ 找回密码页 ============
function ForgotPasswordPage({ t }) {
  const navigate = useNavigate()
  const [step, setStep] = useState('email') // 'email' | 'reset' | 'done'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(60)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setInterval(() => setCountdown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [countdown])

  const handleSendCode = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError(t('enterEmailForReset')); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/send-reset-code', { email: email.trim() })
      const d = await r.json()
      if (r.ok) {
        setStep('reset')
        setCountdown(60)
      } else {
        setError(d.error || t('sendFailed'))
      }
    } catch { setError(t('networkError')) }
    setLoading(false)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (code.length !== 8) { setError(t('codeRule')); return }
    if (newPassword.length < 6) { setError(t('passwordTooShort6')); return }
    if (newPassword !== newPassword2) { setError(t('passwordMismatch')); return }
    setError('')
    setLoading(true)
    try {
      const r = await api('POST', '/auth/reset-password', { email: email.trim(), code, newPassword })
      const d = await r.json()
      if (r.ok) {
        setStep('done')
      } else {
        setError(d.error || t('resetFailed'))
      }
    } catch { setError(t('networkError')) }
    setLoading(false)
  }

  const handleResend = async () => {
    setCountdown(60)
    setError('')
    await api('POST', '/auth/send-reset-code', { email: email.trim() })
  }

  if (step === 'done') {
    return (
      <div className="auth-page">
        <div className="auth-card anim-fadeInUp">
          <Logo />
          <h2>{t('passwordResetSuccess')}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
            {t('passwordResetMsg')}
          </p>
          <button className="auth-btn" onClick={() => navigate('/login')}>{t('goToLogin')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card anim-fadeInUp">
        <Logo />
        <h2>{t('forgotTitle')}</h2>
        {step === 'email' ? (
          <form onSubmit={handleSendCode}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>
              {t('enterEmailForReset')}
            </p>
            <input
              className="auth-input" type="email" placeholder={t('registrationEmail')}
              value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
            />
            {error && <div className="auth-error anim-shake">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? t('sending') : t('sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>
              {t('codeSent')} <strong>{email}</strong>
            </p>
            <input
              className="auth-input auth-code-input"
              type="text" placeholder={t('codePlaceholder')} maxLength={8}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <input
              className="auth-input" type="password" placeholder={t('newPasswordPlaceholder')}
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="auth-input" type="password" placeholder={t('confirmPasswordPlaceholder')}
              value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)}
            />
            {error && <div className="auth-error anim-shake">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? t('resetting') : t('resetPassword')}
            </button>
            <div className="auth-switch">
              {countdown > 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>{t('codeResendAfter').replace('{countdown}', countdown)}</span>
              ) : (
                <button className="btn-link" type="button" onClick={handleResend}>{t('resendCode')}</button>
              )}
            </div>
          </form>
        )}
        <div className="auth-switch">
          <button className="btn-link" onClick={() => navigate('/login')}>{t('backToLogin')}</button>
        </div>
      </div>
    </div>
  )
}

// ============ 简单 Markdown 渲染 ============
function sanitizeUrl(url) {
  if (!url) return ''
  const trimmed = url.trim()
  // Block dangerous protocols to prevent XSS
  const dangerous = /^(javascript|data|vbscript):/i
  if (dangerous.test(trimmed)) return ''
  // Only allow http, https, and relative URLs
  if (/^(https?:)?\/\//i.test(trimmed) || /^[#?\/]/.test(trimmed) || /^[a-zA-Z0-9._-]+@/.test(trimmed)) {
    return trimmed
  }
  return ''
}

function renderMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (match, text, url) => {
      const safeUrl = sanitizeUrl(url)
      if (!safeUrl) return match
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`
    })
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
  return '<p>' + html + '</p>'
}

// HTML 转 Markdown（递归遍历 DOM）
function htmlToMarkdown(node) {
  if (!node) return ''
  if (node.nodeType === 3) return node.textContent // Text node
  if (node.nodeType !== 1) return ''

  const tag = node.tagName ? node.tagName.toLowerCase() : ''
  let inner = ''
  for (const child of node.childNodes) {
    inner += htmlToMarkdown(child)
  }

  switch (tag) {
    case 'h1': return '# ' + inner + '\n\n'
    case 'h2': return '## ' + inner + '\n\n'
    case 'h3': return '### ' + inner + '\n\n'
    case 'strong': case 'b': return '**' + inner + '**'
    case 'em': case 'i': return '*' + inner + '*'
    case 'code': return '`' + inner + '`'
    case 'a': {
      const href = node.getAttribute('href') || ''
      return '[' + inner + '](' + href + ')'
    }
    case 'li': return '- ' + inner + '\n'
    case 'ul': case 'ol': return inner + '\n'
    case 'p': return inner + '\n\n'
    case 'br': return '\n'
    case 'div': return inner + '\n'
    default: return inner
  }
}

// ============ 个人信息卡片 ============
function ProfileCard({ profile, isOwner, editing, editBio, onEditBio, onStartEdit, onCancelEdit, onSaveBio, onBgUpload, bgInputRef, t }) {
  const textareaRef = useRef(null)
  const previewRef = useRef(null)
  const isInternalUpdate = useRef(false)
  const [showHeadingPicker, setShowHeadingPicker] = useState(false)
  const headingTimerRef = useRef(null)
  const bgStyle = profile.background
    ? { backgroundImage: `url(/backgrounds/${profile.background})` }
    : { background: 'linear-gradient(135deg, var(--brand) 0%, #6366f1 100%)' }

  // 同步 markdown → 预览 HTML
  useEffect(() => {
    if (!previewRef.current || isInternalUpdate.current) return
    const html = renderMarkdown(editBio)
    previewRef.current.innerHTML = html || `<p style="color:var(--text-muted);font-style:italic">${t('noContent')}</p>`
  }, [editBio])

  // 预览面板编辑 → 转回 markdown
  const handlePreviewInput = () => {
    if (!previewRef.current) return
    isInternalUpdate.current = true
    const md = htmlToMarkdown(previewRef.current).replace(/\n{3,}/g, '\n\n').trim()
    onEditBio(md)
    setTimeout(() => { isInternalUpdate.current = false }, 0)
  }

  const insertMarkdown = (before, after = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = editBio.substring(start, end)
    const newText = editBio.substring(0, start) + before + selected + after + editBio.substring(end)
    onEditBio(newText)
    // 恢复光标位置
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + selected.length
    }, 0)
  }

  const mdButtons = [
    { label: 'B', title: t('bold'), before: '**', after: '**' },
    { label: 'I', title: t('italic'), before: '*', after: '*' },
    { label: '·', title: t('list'), before: '- ' },
    { label: '[]', title: t('link'), before: '[', after: '](url)' },
    { label: '<>', title: t('inlineCode'), before: '`', after: '`' },
    { label: '"', title: t('quote'), before: '> ' },
  ]

  const headingLevels = [
    { label: 'H1', prefix: '# ' },
    { label: 'H2', prefix: '## ' },
    { label: 'H3', prefix: '### ' },
    { label: 'H4', prefix: '#### ' },
    { label: 'H5', prefix: '##### ' },
    { label: 'H6', prefix: '###### ' },
  ]

  const handleHeadingHover = () => {
    clearTimeout(headingTimerRef.current)
    setShowHeadingPicker(true)
  }

  const handleHeadingLeave = () => {
    headingTimerRef.current = setTimeout(() => setShowHeadingPicker(false), 200)
  }

  const handleHeadingPick = (prefix) => {
    insertMarkdown(prefix)
    setShowHeadingPicker(false)
  }

  const avatarUrl = profile.avatar ? `/avatars/${profile.avatar}` : null

  return (
    <div className="profile-card anim-fadeInUp">
      <div className="profile-bg" style={bgStyle}>
        {isOwner && (
          <button className="profile-bg-edit" onClick={() => bgInputRef.current?.click()}>
            {t('changeBackground')}
          </button>
        )}
        <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onBgUpload} />
      </div>
      <div className="profile-body">
        <div className="profile-avatar-row">
          <div className="profile-avatar-lg">
            {avatarUrl ? (
              <img className="profile-avatar-img" src={avatarUrl} alt={profile.username} />
            ) : (
              <span className="profile-avatar-text">{profile.username.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="profile-name-row">
            <h2 className="profile-username">{profile.username}</h2>
            {profile.signature && <span className="profile-signature">{profile.signature}</span>}
          </div>
        </div>

        <div className="profile-bio-section">
          <div className="profile-bio-header">
            <span className="profile-bio-label">{t('bio')}</span>
            {isOwner && !editing && (
              <button className="btn-link btn-link-sm" onClick={onStartEdit}>{t('edit')}</button>
            )}
          </div>
          {editing ? (
            <div className="profile-bio-edit">
              <div className="md-toolbar">
                {mdButtons.map((btn) => (
                  <button
                    key={btn.title}
                    className="md-toolbar-btn"
                    title={btn.title}
                    onClick={() => insertMarkdown(btn.before, btn.after)}
                  >
                    {btn.label}
                  </button>
                ))}
                <div
                  className="md-toolbar-heading"
                  onMouseEnter={handleHeadingHover}
                  onMouseLeave={handleHeadingLeave}
                >
                  <button className="md-toolbar-btn" title={t('heading')}>H</button>
                  {showHeadingPicker && (
                    <div
                      className="md-heading-dropdown"
                      onMouseEnter={handleHeadingHover}
                      onMouseLeave={handleHeadingLeave}
                    >
                      {headingLevels.map((hl) => (
                        <button
                          key={hl.label}
                          className="md-heading-item"
                          onClick={() => handleHeadingPick(hl.prefix)}
                        >
                          {hl.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="md-split">
                <div className="md-split-pane md-split-preview">
                  <div className="md-split-label">{t('previewLabel')}</div>
                  <div
                    ref={previewRef}
                    className="profile-bio-md profile-bio-editable"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={handlePreviewInput}
                  />
                </div>
                <div className="md-split-pane md-split-source">
                  <div className="md-split-label">{t('codeLabel')}</div>
                  <textarea
                    ref={textareaRef}
                    className="profile-bio-textarea"
                    value={editBio}
                    onChange={(e) => onEditBio(e.target.value)}
                    placeholder={t('introYourself')}
                  />
                </div>
              </div>
              <div className="profile-bio-actions">
                <button className="btn-primary btn-sm" onClick={onSaveBio}>{t('save')}</button>
                <button className="btn-secondary btn-sm" onClick={onCancelEdit}>{t('cancel')}</button>
                <span className="profile-bio-hint">{t('markdownHint')}</span>
              </div>
            </div>
          ) : (
            <div className="profile-bio-content">
              {profile.bio ? (
                <div className="profile-bio-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(profile.bio) }} />
              ) : (
                <p className="profile-bio-empty">{isOwner ? t('clickEditToAddBio') : t('noBio')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ 设置页 ============
function SettingsPage({ user, avatarUrl, onChangePassword, onChangeUsername, onSetSignature, onUploadAvatar, onDeleteAccount, onClose, t }) {
  const [tab, setTab] = useState('profile')
  const [newPw, setNewPw] = useState('')
  const [pwCode, setPwCode] = useState('')
  const [pwCodeSent, setPwCodeSent] = useState(false)
  const [pwCountdown, setPwCountdown] = useState(60)
  const [newName, setNewName] = useState(user.username)
  const [newSignature, setNewSignature] = useState(user.signature || '')
  const [delCode, setDelCode] = useState('')
  const [delCodeSent, setDelCodeSent] = useState(false)
  const [delCountdown, setDelCountdown] = useState(60)
  const [submitting, setSubmitting] = useState(false)
  const avatarInputRef = useRef(null)

  const tabs = [
    { key: 'profile', label: t('personalInfo') },
    { key: 'password', label: t('changePassword') },
    { key: 'danger', label: t('deleteAccount') },
  ]

  // 倒计时
  useEffect(() => {
    if (pwCountdown <= 0) return
    const timer = setInterval(() => setPwCountdown((c) => c - 1), 1000)
    return () => clearInterval(timer)
  }, [pwCountdown])
  useEffect(() => {
    if (delCountdown <= 0) return
    const timer2 = setInterval(() => setDelCountdown((c) => c - 1), 1000)
    return () => clearInterval(timer2)
  }, [delCountdown])

  const handleAvatar = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setSubmitting(true)
    await onUploadAvatar(file)
    setSubmitting(false)
    e.target.value = ''
  }

  const sendPwCode = async () => {
    setSubmitting(true)
    try {
      const r = await api('POST', '/auth/send-op-code', { operation: 'changePassword' })
      const d = await r.json()
      if (r.ok) {
        setPwCodeSent(true)
        setPwCountdown(60)
      } else {
        alert(d.error || t('sendFailed'))
      }
    } catch { alert(t('networkError')) }
    setSubmitting(false)
  }

  const handleSubmitPassword = async () => {
    if (pwCode.length !== 8) { alert(t('codeRule')); return }
    setSubmitting(true)
    const ok = await onChangePassword(pwCode, newPw)
    if (ok) { setPwCode(''); setNewPw(''); setPwCodeSent(false) }
    setSubmitting(false)
  }

  const handleSubmitName = async () => {
    if (newName.trim() === user.username) return
    setSubmitting(true)
    const ok = await onChangeUsername(newName.trim())
    if (!ok) setNewName(user.username)
    setSubmitting(false)
  }

  const handleSubmitSignature = async () => {
    if (newSignature.trim() === (user.signature || '')) return
    setSubmitting(true)
    const ok = await onSetSignature(newSignature.trim())
    if (!ok) setNewSignature(user.signature || '')
    setSubmitting(false)
  }

  const sendDelCode = async () => {
    setSubmitting(true)
    try {
      const r = await api('POST', '/auth/send-op-code', { operation: 'deleteAccount' })
      const d = await r.json()
      if (r.ok) {
        setDelCodeSent(true)
        setDelCountdown(60)
      } else {
        alert(d.error || t('sendFailed'))
      }
    } catch { alert(t('networkError')) }
    setSubmitting(false)
  }

  const handleDelete = async () => {
    if (!confirm(t('deleteAccountConfirm'))) return
    if (delCode.length !== 8) { alert(t('codeRule')); return }
    setSubmitting(true)
    await onDeleteAccount(delCode)
    setSubmitting(false)
  }

  return (
    <Modal onClose={onClose} title={t('accountSettings')} wide>
      <div className="settings-container">
        <div className="settings-sidebar">
          {tabs.map((t) => (
            <button key={t.key} className={`settings-tab ${tab === t.key ? 'settings-tab-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {tab === 'profile' && (
            <div className="settings-section">
              <h4>{t('personalInfo')}</h4>
              <div className="settings-avatar-row">
                <div className="settings-avatar-preview">
                  {avatarUrl ? (
                    <img className="settings-avatar-img" src={avatarUrl} alt={user.username} />
                  ) : (
                    <span className="settings-avatar-placeholder">{user.username.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="settings-avatar-actions">
                  <button className="btn-primary btn-sm" onClick={() => avatarInputRef.current?.click()} disabled={submitting}>
                    {submitting ? t('uploadingAvatar') : t('changeAvatar')}
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatar} />
                  <p className="settings-hint">{t('avatarFormatHint')}</p>
                </div>
              </div>
              <div className="settings-field">
                <label>{t('email')}</label>
                <input className="auth-input" value={user.email} disabled />
              </div>
              <div className="settings-field">
                <label>{t('username')}</label>
                <div className="settings-inline">
                  <input className="auth-input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={20} />
                  <button className="btn-primary btn-sm" onClick={handleSubmitName} disabled={submitting || newName.trim() === user.username || !newName.trim()}>
                    {t('save')}
                  </button>
                </div>
              </div>
              <div className="settings-field">
                <label>{t('signature')}</label>
                <div className="settings-inline">
                  <input className="auth-input" value={newSignature} onChange={(e) => setNewSignature(e.target.value)} maxLength={50} placeholder={t('signaturePlaceholder')} />
                  <button className="btn-primary btn-sm" onClick={handleSubmitSignature} disabled={submitting || newSignature.trim() === (user.signature || '')}>
                    {t('save')}
                  </button>
                </div>
                <p className="settings-hint">{t('signatureHint')}</p>
              </div>
            </div>
          )}

          {tab === 'password' && (
            <div className="settings-section">
              <h4>{t('changePassword')}</h4>
              <p className="settings-hint" style={{ marginBottom: '12px' }}>{t('changePasswordDesc')}</p>
              <div className="settings-field">
                <label>{t('newPassword')}</label>
                <input className="auth-input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder={t('passwordMinChars')} />
              </div>
              <div className="settings-field">
                <label>{t('codeVerification')}</label>
                <div className="settings-inline">
                  <input className="auth-input auth-code-input" style={{ flex: 1, marginBottom: 0 }} type="text" placeholder={t('code8Digits')} maxLength={8}
                    value={pwCode} onChange={(e) => setPwCode(e.target.value.replace(/\D/g, ''))} />
                  {pwCodeSent && pwCountdown > 0 ? (
                    <button className="btn-secondary btn-sm" disabled>{pwCountdown}s</button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={sendPwCode} disabled={submitting}>
                      {pwCodeSent ? t('resend') : t('sendVerificationCode')}
                    </button>
                  )}
                </div>
              </div>
              <button className="btn-primary" onClick={handleSubmitPassword} disabled={submitting || !pwCode || !newPw || newPw.length < 6}>
                {submitting ? t('changing') : t('changePassword')}
              </button>
            </div>
          )}

          {tab === 'danger' && (
            <div className="settings-section">
              <h4 className="text-danger">{t('deleteAccount')}</h4>
              <p className="settings-warning">{t('deleteAccountWarning')}</p>
              <p className="settings-hint" style={{ marginBottom: '12px' }}>{t('deleteAccountDesc')}</p>
              <div className="settings-field">
                <label>{t('codeVerification')}</label>
                <div className="settings-inline">
                  <input className="auth-input auth-code-input" style={{ flex: 1, marginBottom: 0 }} type="text" placeholder={t('code8Digits')} maxLength={8}
                    value={delCode} onChange={(e) => setDelCode(e.target.value.replace(/\D/g, ''))} />
                  {delCodeSent && delCountdown > 0 ? (
                    <button className="btn-secondary btn-sm" disabled>{delCountdown}s</button>
                  ) : (
                    <button className="btn-secondary btn-sm" onClick={sendDelCode} disabled={submitting}>
                      {delCodeSent ? t('resend') : t('sendVerificationCode')}
                    </button>
                  )}
                </div>
              </div>
              <button className="btn-danger-full" onClick={handleDelete} disabled={submitting || !delCode}>
                {submitting ? t('deleting') : t('confirmDeleteAccount')}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ============ Logo ============
function Logo() {
  const { lang, toggleLang } = useLang()
  const [step, setStep] = useState(0)
  const sources = ['/logo/logo.svg', '/logo/logo.png', '/logo/logo.ico', '/logo.svg']
  const handleError = () => setStep((s) => s + 1)
  const handleClick = (e) => {
    e.stopPropagation()
    toggleLang()
  }
  if (step >= sources.length) return <h1 className="logo" onClick={handleClick} title={lang === 'zh' ? '点击切换语言 / Click to switch language' : 'Click to switch language / 点击切换语言'} style={{ cursor: 'pointer' }}>Emberclouds</h1>
  return <img className="logo-img" src={sources[step]} alt="Emberclouds" onError={handleError} onClick={handleClick} title={lang === 'zh' ? '点击切换语言 / Click to switch language' : 'Click to switch language / 点击切换语言'} style={{ cursor: 'pointer' }} />
}

// ============ Modal ============
function Modal({ children, onClose, title, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>{title}</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ============ UploadPanel ============
function UploadPanel({ onUpload, onClose, t }) {
  const [files, setFiles] = useState([])
  const handleDrop = (e) => { e.preventDefault(); setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]) }
  const handleSelect = (e) => { setFiles((prev) => [...prev, ...Array.from(e.target.files)]); e.target.value = '' }
  const total = files.reduce((s, f) => s + f.size, 0)
  return (
    <div>
      <div className="upload-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} onClick={() => document.getElementById('upload-input').click()}>
        <input id="upload-input" type="file" multiple style={{ display: 'none' }} onChange={handleSelect} />
        <div className="dropzone-icon">📤</div>
        <p>{t('dropToUpload')}</p>
      </div>
      {files.length > 0 && (
        <div className="upload-file-list">
          <div className="upload-file-header"><span>{files.length} {t('filesCount')} ({formatSize(total)})</span><button className="btn-text" onClick={() => setFiles([])}>{t('clear')}</button></div>
          {files.map((f, i) => (
            <div key={i} className="upload-file-item">
              <span className="uf-name">{f.name}</span><span className="uf-size">{formatSize(f.size)}</span>
              <button className="btn-remove" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        <button className="btn-primary" onClick={() => onUpload(files)} disabled={files.length === 0}>{t('startUpload')} ({files.length})</button>
      </div>
    </div>
  )
}

// ============ InputModal ============
function InputModal({ placeholder, defaultValue, onSubmit, onClose, t }) {
  const [value, setValue] = useState(defaultValue || '')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const handleSubmit = () => { if (value.trim()) onSubmit(value.trim()) }
  return (
    <div>
      <input ref={inputRef} className="input-full" type="text" placeholder={placeholder}
        value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }} />
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={!value.trim()}>{t('confirm')}</button>
      </div>
    </div>
  )
}