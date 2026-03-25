import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';

type AppShellProps = PropsWithChildren<{
  overlays?: ReactNode;
}>;

export function AppShell({ children, overlays }: AppShellProps) {
  const location = useLocation();
  const storedTheme = useMemo<'light' | 'dark' | null>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('cap-theme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  }, []);

  const initialTheme = useMemo<'light' | 'dark'>(() => {
    if (
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('theme-dark')
    ) {
      return 'dark';
    }
    if (storedTheme) return storedTheme;
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, [storedTheme]);

  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [hasUserOverride, setHasUserOverride] = useState(Boolean(storedTheme));
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (hasUserOverride || typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', syncTheme);
    return () => media.removeEventListener('change', syncTheme);
  }, [hasUserOverride]);

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    setHasUserOverride(true);
    window.localStorage.setItem('cap-theme', nextTheme);
  };

  const themeButton = (
    <>
      {theme === 'light' ? (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
      {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
    </>
  );

  const navItems = [
    {
      label: 'Home',
      path: '/',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
          />
        </svg>
      ),
    },
    {
      label: 'Record',
      path: '/record',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="app-shell flex font-sans">
      {/* Sidebar - Desktop */}
      <aside className="sidebar p-4">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-xl text-white"
            style={{
              background: 'var(--accent-blue-gradient)',
              boxShadow: '0 10px 24px rgba(107, 143, 113, 0.26)',
            }}
          >
            C
          </div>
          <span
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Cap4
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-4 border-t">
          <button
            onClick={toggleTheme}
            className="sidebar-link w-full text-left"
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {themeButton}
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div
        className="lg:hidden fixed top-0 w-full z-50 border-b px-4 py-3 flex items-center justify-between backdrop-blur-md bg-opacity-80"
        style={{
          background: 'color-mix(in srgb, var(--bg-surface) 82%, transparent)',
          borderColor: 'color-mix(in srgb, var(--border-default) 82%, transparent)',
        }}
      >
        <Link to="/" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          Cap4
        </Link>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleTheme}
            className="btn-secondary px-2.5 py-2 text-xs"
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {theme === 'light' ? (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
          </button>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={isMobileMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Content */}
      <aside
        aria-hidden={!isMobileMenuOpen}
        className={`lg:hidden fixed left-0 top-0 z-50 flex h-full w-64 flex-col transform transition-transform duration-300 ease-in-out p-6 ${isMobileMenuOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`}
        style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-default)' }}
      >
        <div className="mb-8 font-bold text-xl" style={{ color: 'var(--text-primary)' }}>
          Cap4
        </div>
        <nav className="flex flex-col gap-2">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t pt-4">
          <button
            onClick={toggleTheme}
            className="sidebar-link w-full text-left"
            title={theme === 'light' ? 'Dark mode' : 'Light mode'}
          >
            {themeButton}
          </button>
        </div>
      </aside>

      <main className="app-content min-h-screen pt-16 lg:pt-0">
        <div className="mx-auto w-full max-w-[1720px] px-4 py-8 sm:px-12">
          <div key={location.pathname} className="page-transition-enter">
            {children}
          </div>
        </div>
      </main>
      {overlays}
    </div>
  );
}
