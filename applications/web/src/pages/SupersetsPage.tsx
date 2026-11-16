import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { Badge, Box, Card, Flex, Grid, Heading, Skeleton, Text, TextField } from '@radix-ui/themes';
import { api } from '../api';
import type { SupersetInfoDto } from '../api';
import { EmptyState } from '../components/Dialogs';
import { useToast } from '../components/Toast';

export function SupersetsPage() {
    const toast = useToast();
    const [catalogs, setCatalogs] = useState<SupersetInfoDto[] | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        api.supersets
            .list()
            .then(setCatalogs)
            .catch((error) =>
                toast({
                    title: 'Could not load catalogs',
                    description: String(error),
                    variant: 'error',
                }),
            );
    }, [toast]);

    const filtered = useMemo(() => {
        if (!catalogs) return null;
        const needle = search.trim().toLowerCase();
        const list = [...catalogs].sort((a, b) => a.name.localeCompare(b.name));
        if (!needle) return list;
        return list.filter(
            (catalog) =>
                catalog.name.toLowerCase().includes(needle) ||
                catalog.key.toLowerCase().includes(needle),
        );
    }, [catalogs, search]);

    return (
        <Flex direction="column" gap="4" data-testid="catalogs-page">
            <Flex align="center" gap="3" wrap="wrap">
                <Box style={{ flexGrow: 1 }}>
                    <Heading size="6">Catalogs</Heading>
                    <Text as="div" size="2" color="gray" mt="1">
                        Browse every catalog, check rarity and see what you are still missing.
                    </Text>
                </Box>
                <TextField.Root
                    size="2"
                    placeholder="Filter catalogs…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ flex: '0 1 240px' }}
                    data-testid="catalogs-search"
                >
                    <TextField.Slot>
                        <MagnifyingGlassIcon />
                    </TextField.Slot>
                </TextField.Root>
            </Flex>

            {!filtered ? (
                <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="3">
                    <Skeleton style={{ height: 90 }} />
                    <Skeleton style={{ height: 90 }} />
                    <Skeleton style={{ height: 90 }} />
                </Grid>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon="📇"
                    title="No matching catalogs"
                    description="Try a different search."
                />
            ) : (
                <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="3">
                    {filtered.map((catalog) => (
                        <Card
                            key={catalog.key}
                            size="3"
                            asChild
                            style={{ textAlign: 'left' }}
                            data-testid="catalog-card"
                        >
                            <Link to={`/supersets/${catalog.key}`}>
                                <Flex direction="column" gap="2">
                                    <Flex align="center" gap="2" wrap="wrap">
                                        <Text size="3" weight="medium">
                                            {catalog.name}
                                        </Text>
                                        {!catalog.complete ? (
                                            <Badge color="amber" variant="soft">
                                                Curated
                                            </Badge>
                                        ) : null}
                                    </Flex>
                                    <Text as="div" size="1" color="gray">
                                        {catalog.titleCount.toLocaleString()} titles ·{' '}
                                        {catalog.variantCount.toLocaleString()} variants
                                    </Text>
                                </Flex>
                            </Link>
                        </Card>
                    ))}
                </Grid>
            )}
        </Flex>
    );
}
