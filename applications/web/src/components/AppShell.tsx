import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
    MagnifyingGlassIcon,
    MoonIcon,
    SunIcon,
    TrashIcon,
    FileTextIcon,
    GearIcon,
    HomeIcon,
} from '@radix-ui/react-icons';
import { Box, Container, Flex, IconButton, TextField, Theme, Text } from '@radix-ui/themes';

type Appearance = 'light' | 'dark';

function useAppearance(): [Appearance, () => void] {
    const [appearance, setAppearance] = useState<Appearance>(() => {
        const stored = localStorage.getItem('appearance');
        if (stored === 'light' || stored === 'dark') return stored;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    useEffect(() => {
        localStorage.setItem('appearance', appearance);
    }, [appearance]);
    return [appearance, () => setAppearance((a) => (a === 'dark' ? 'light' : 'dark'))];
}

export function AppShell() {
    const [appearance, toggleAppearance] = useAppearance();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');

    const submitSearch = (event: React.FormEvent) => {
        event.preventDefault();
        const q = search.trim();
        if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    };

    const navLink = (to: string, label: string, icon: ReactNode, testId: string) => (
        <NavLink to={to} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
                <Flex
                    align="center"
                    gap="2"
                    px="3"
                    py="2"
                    style={{
                        borderRadius: 'var(--radius-2)',
                        background: isActive ? 'var(--accent-a3)' : undefined,
                        color: isActive ? 'var(--accent-11)' : 'var(--gray-12)',
                    }}
                    data-testid={testId}
                >
                    {icon}
                    <Text size="2" weight={isActive ? 'medium' : 'regular'}>
                        {label}
                    </Text>
                </Flex>
            )}
        </NavLink>
    );

    return (
        <Theme appearance={appearance} accentColor="iris" radius="medium">
            <Flex
                direction="column"
                minHeight="100vh"
                style={{ background: 'var(--color-background)' }}
            >
                <header
                    style={{
                        borderBottom: '1px solid var(--gray-a5)',
                        background: 'var(--color-panel-transparent)',
                        padding: 'var(--space-3) var(--space-4)',
                    }}
                >
                    <Container size="4">
                        <Flex align="center" gap="4" wrap="wrap">
                            <Link
                                to="/"
                                style={{
                                    textDecoration: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                }}
                            >
                                <Box
                                    style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 6,
                                        background:
                                            'linear-gradient(135deg, var(--accent-9) 0%, var(--accent-7) 100%)',
                                    }}
                                />
                                <Text size="4" weight="bold">
                                    Antiquary
                                </Text>
                            </Link>
                            <Flex gap="1" align="center">
                                {navLink('/', 'Collections', <HomeIcon />, 'nav-collections')}
                                {navLink(
                                    '/templates',
                                    'Templates',
                                    <FileTextIcon />,
                                    'nav-templates',
                                )}
                                {navLink('/trash', 'Trash', <TrashIcon />, 'nav-trash')}
                                {navLink('/settings', 'Settings', <GearIcon />, 'nav-settings')}
                            </Flex>
                            <Box style={{ flexGrow: 1, minWidth: 180 }} />
                            <form onSubmit={submitSearch} style={{ flex: '0 1 280px' }}>
                                <TextField.Root
                                    data-testid="global-search"
                                    size="2"
                                    placeholder="Search everything…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                >
                                    <TextField.Slot>
                                        <MagnifyingGlassIcon />
                                    </TextField.Slot>
                                </TextField.Root>
                            </form>
                            <IconButton
                                variant="ghost"
                                color="gray"
                                onClick={toggleAppearance}
                                aria-label="Toggle dark mode"
                                data-testid="theme-toggle"
                            >
                                {appearance === 'dark' ? <SunIcon /> : <MoonIcon />}
                            </IconButton>
                        </Flex>
                    </Container>
                </header>
                <main
                    style={{
                        flexGrow: 1,
                        paddingTop: 'var(--space-4)',
                        paddingBottom: 'var(--space-4)',
                    }}
                >
                    <Container size="4">
                        <Outlet />
                    </Container>
                </main>
            </Flex>
        </Theme>
    );
}
