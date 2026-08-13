import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  Layers,
  LayoutDashboard,
  Moon,
  Play,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react';
import { LogoLockup } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RouteErrorBoundary } from './ErrorBoundary';
import { useTheme } from './theme';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/decks', label: 'Decks', icon: Layers },
  { to: '/create/text', label: 'Create', icon: Sparkles },
  { to: '/practice', label: 'Practice', icon: Play },
  { to: '/progress', label: 'Progress', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
          <NavLink
            to="/dashboard"
            className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <LogoLockup />
          </NavLink>
          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>

      {/* Inside the layout, so a page that throws keeps the nav and the user
          can walk out of it. The root boundary in providers.tsx catches the
          case where the layout itself is what broke. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <RouteErrorBoundary>
          <Outlet />
        </RouteErrorBoundary>
      </main>

      <footer className="text-muted-foreground border-t px-4 py-4 text-center text-xs">
        Every number on this site is counted from your own review log · see docs/SPEC.md
      </footer>
    </div>
  );
}
