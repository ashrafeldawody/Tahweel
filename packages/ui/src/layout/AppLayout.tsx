import { AppShell, Burger, Button, Divider, Group, NavLink, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBook,
  IconDeviceMobile,
  IconExternalLink,
  IconLayoutDashboard,
  IconLogout,
  IconMessage,
  IconReceipt,
  IconSettings,
  IconWebhook,
  type Icon,
} from '@tabler/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LOGIN_ROUTE } from '../auth/RequireAuth';
import { clearToken } from '../auth/token';
import { BrandMark } from '../components/BrandMark';
import { SettingsProvider } from '../lib/settings';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/app/overview', label: 'Overview', icon: IconLayoutDashboard },
  { to: '/app/devices', label: 'Devices', icon: IconDeviceMobile },
  { to: '/app/messages', label: 'Messages', icon: IconMessage },
  { to: '/app/intents', label: 'Intents', icon: IconReceipt },
  { to: '/app/webhooks', label: 'Webhooks', icon: IconWebhook },
  { to: '/app/settings', label: 'Settings', icon: IconSettings },
];

export function AppLayout() {
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const location = useLocation();
  const navigate = useNavigate();

  const logout = () => {
    clearToken();
    navigate(LOGIN_ROUTE, { replace: true });
  };

  return (
    <SettingsProvider>
      <AppShell
        header={{ height: 52 }}
        navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
        padding="md"
        styles={{ main: { backgroundColor: 'var(--mantine-color-gray-0)' } }}
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="sm">
              <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
              <BrandMark />
              <Text fw={700} fz="lg" c="tahweel.7">
                Tahweel
              </Text>
            </Group>
            <Button variant="subtle" color="gray" size="compact-sm" leftSection={<IconLogout size={16} />} onClick={logout}>
              Log out
            </Button>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={18} stroke={1.6} />}
              active={location.pathname.startsWith(item.to)}
              onClick={closeNav}
              variant="light"
            />
          ))}
          <Divider my="xs" />
          <NavLink
            component="a"
            href="/docs"
            target="_blank"
            rel="noreferrer"
            label="API docs"
            leftSection={<IconBook size={18} stroke={1.6} />}
            rightSection={<IconExternalLink size={14} stroke={1.6} />}
          />
        </AppShell.Navbar>

        <AppShell.Main>
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </SettingsProvider>
  );
}
