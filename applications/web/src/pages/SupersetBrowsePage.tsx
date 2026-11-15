import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Flex,
    Heading,
    IconButton,
    Skeleton,
    Switch,
    Text,
    TextField,
} from '@radix-ui/themes';
import type { CollectionDto } from '@antiquary/database';
import { api } from '../api';
import type { SupersetEntryListResultDto, SupersetInfoDto } from '../api';
import { EmptyState } from '../components/Dialogs';
import { RarityTag } from '../components/RarityTag';
import { useToast } from '../components/Toast';
import { slug } from '../lib/format';

const PAGE_SIZE = 24;

export function SupersetBrowsePage() {
    const { key = '' } = useParams();
    const [searchParams] = useSearchParams();
    const collectionId = searchParams.get('collection');
    const toast = useToast();

    const [info, setInfo] = useState<SupersetInfoDto | null>(null);
    const [collection, setCollection] = useState<CollectionDto | null>(null);
    const [missingCatalog, setMissingCatalog] = useState(false);
    const [result, setResult] = useState<SupersetEntryListResultDto | null>(null);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [missingOnly, setMissingOnly] = useState(false);
    const [page, setPage] = useState(1);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchInput]);

    useEffect(() => {
        setPage(1);
    }, [missingOnly, key]);

    useEffect(() => {
        setMissingCatalog(false);
        api.supersets
            .get(key)
            .then(setInfo)
            .catch(() => setMissingCatalog(true));
    }, [key]);

    useEffect(() => {
        if (!collectionId) {
            setCollection(null);
            return;
        }
        api.collections
            .get(collectionId)
            .then(setCollection)
            .catch(() => setCollection(null));
    }, [collectionId]);

    const loadEntries = useCallback(async () => {
        const res = await api.supersets.entries(key, {
            q: search || undefined,
            ownership: missingOnly ? 'missing' : 'all',
            page,
            limit: PAGE_SIZE,
        });
        setResult(res);
    }, [key, search, missingOnly, page]);

    useEffect(() => {
        loadEntries().catch((error) =>
            toast({
                title: 'Could not load catalog',
                description: String(error),
                variant: 'error',
            }),
        );
    }, [loadEntries, toast]);

    if (missingCatalog) {
        return (
            <EmptyState
                icon="🧭"
                title="Catalog not found"
                description="This superset catalog does not exist."
                action={
                    <Link to="/">
                        <Button variant="soft">Back home</Button>
                    </Link>
                }
            />
        );
    }

    if (!info) {
        return <Skeleton style={{ height: 300 }} />;
    }

    const entries = result?.entries ?? [];
    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));

    return (
        <Flex direction="column" gap="4" data-testid="superset-browse">
            <Flex align="center" gap="3" wrap="wrap">
                <Box style={{ flexGrow: 1 }}>
                    {collection ? (
                        <Text as="div" size="1" color="gray" mb="1">
                            <Link
                                to={`/collections/${collection.id}`}
                                data-testid="back-to-collection"
                                style={{ color: 'inherit' }}
                            >
                                ← {collection.emoji ?? '📦'} {collection.name}
                            </Link>
                        </Text>
                    ) : null}
                    <Flex align="center" gap="2">
                        <Heading size="6" data-testid="superset-title">
                            {info.name}
                        </Heading>
                        <Badge color="iris" variant="soft">
                            {info.titleCount} titles · {info.variantCount} variants
                        </Badge>
                    </Flex>
                    <Text as="div" size="2" color="gray" mt="1" data-testid="superset-owned-count">
                        {result ? `${result.ownedCount} owned · ${result.total} shown` : '…'}
                    </Text>
                </Box>
            </Flex>

            <Flex gap="3" align="center" wrap="wrap">
                <TextField.Root
                    data-testid="superset-search"
                    size="2"
                    placeholder="Search the catalog…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    style={{ flex: '0 1 240px' }}
                >
                    <TextField.Slot>
                        <MagnifyingGlassIcon />
                    </TextField.Slot>
                </TextField.Root>
                <Flex align="center" gap="2">
                    <Switch
                        checked={missingOnly}
                        onCheckedChange={setMissingOnly}
                        data-testid="missing-only"
                    />
                    <Text size="2" color={missingOnly ? undefined : 'gray'}>
                        Missing only
                    </Text>
                </Flex>
            </Flex>

            {entries.length === 0 ? (
                result && (search || missingOnly) ? (
                    <EmptyState
                        icon="🔍"
                        title="No matching entries"
                        description="Try a different search, or clear the filters."
                        action={
                            <Button
                                variant="soft"
                                onClick={() => {
                                    setSearchInput('');
                                    setSearch('');
                                    setMissingOnly(false);
                                }}
                            >
                                Clear filters
                            </Button>
                        }
                    />
                ) : (
                    <EmptyState
                        icon="📇"
                        title="No catalog entries"
                        description="This catalog is empty."
                    />
                )
            ) : (
                <Flex direction="column" data-testid="superset-entries">
                    {entries.map((entry) => (
                        <Flex
                            key={entry.id}
                            align="center"
                            gap="3"
                            wrap="wrap"
                            py="2"
                            style={{ borderBottom: '1px solid var(--gray-a4)' }}
                            data-testid={`superset-entry-${slug(entry.name)}`}
                        >
                            <Box style={{ flexGrow: 1, minWidth: 180 }}>
                                <Text size="2" weight="medium">
                                    {entry.parentTitle}
                                </Text>
                                <Flex align="center" gap="2" wrap="wrap" mt="1">
                                    {entry.region ? (
                                        <Badge color="iris" variant="soft">
                                            {entry.region}
                                        </Badge>
                                    ) : null}
                                    {entry.serial ? (
                                        <Text size="1" color="gray">
                                            {entry.serial}
                                        </Text>
                                    ) : null}
                                    {entry.year ? (
                                        <Text size="1" color="gray">
                                            {entry.year}
                                        </Text>
                                    ) : null}
                                    {entry.genre ? (
                                        <Text size="1" color="gray">
                                            {entry.genre}
                                        </Text>
                                    ) : null}
                                </Flex>
                            </Box>
                            {entry.rarity ? (
                                <RarityTag
                                    rarity={entry.rarity.rarity}
                                    rarityLabel={entry.rarity.rarityLabel}
                                    rarityPercent={entry.rarity.rarityPercent}
                                />
                            ) : null}
                            {entry.owned ? (
                                <Link to={`/items/${entry.itemId}`}>
                                    <Badge color="grass" variant="soft" data-testid="owned-badge">
                                        Owned
                                    </Badge>
                                </Link>
                            ) : (
                                <Badge color="gray" variant="soft" data-testid="missing-badge">
                                    Missing
                                </Badge>
                            )}
                        </Flex>
                    ))}
                </Flex>
            )}

            {totalPages > 1 ? (
                <Flex align="center" gap="3" justify="center">
                    <IconButton
                        variant="soft"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        aria-label="Previous page"
                    >
                        <ChevronLeftIcon />
                    </IconButton>
                    <Text size="2" color="gray">
                        Page {page} of {totalPages} · {result?.total ?? 0} entries
                    </Text>
                    <IconButton
                        variant="soft"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        aria-label="Next page"
                    >
                        <ChevronRightIcon />
                    </IconButton>
                </Flex>
            ) : null}
        </Flex>
    );
}
