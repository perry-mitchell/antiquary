import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    Link2Icon,
    MagnifyingGlassIcon,
    StarIcon,
} from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Flex,
    Heading,
    IconButton,
    Select,
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
import { ShopLinksDialog } from '../components/ShopLinksDialog';
import { slug } from '../lib/format';
import { PER_PAGE_OPTIONS, usePerPage } from '../lib/usePerPage';
import type { SupersetEntryListItemDto } from '../api';
import type { ShopLinkDto } from '@antiquary/database';

export function SupersetBrowsePage() {
    const { key = '' } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const collectionId = searchParams.get('collection');
    const toast = useToast();

    const [info, setInfo] = useState<SupersetInfoDto | null>(null);
    const [collection, setCollection] = useState<CollectionDto | null>(null);
    const [missingCatalog, setMissingCatalog] = useState(false);
    const [result, setResult] = useState<SupersetEntryListResultDto | null>(null);

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [missingOnly, setMissingOnly] = useState(false);
    const [collectedOnly, setCollectedOnly] = useState(false);
    const [sort, setSort] = useState<'title' | 'rarity-asc' | 'rarity-desc'>('title');
    const [linksFor, setLinksFor] = useState<SupersetEntryListItemDto | null>(null);

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const [perPage, setPerPage] = usePerPage();

    const setPage = (next: number, { replace = false }: { replace?: boolean } = {}) => {
        setSearchParams(
            (prev) => {
                const params = new URLSearchParams(prev);
                if (next <= 1) params.delete('page');
                else params.set('page', String(next));
                return params;
            },
            { replace },
        );
    };

    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearch(searchInput);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchInput]);

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
            ownership: collectedOnly ? 'owned' : missingOnly ? 'missing' : 'all',
            sort,
            page,
            limit: perPage,
        });
        setResult(res);
    }, [key, search, missingOnly, collectedOnly, sort, page, perPage]);

    useEffect(() => {
        loadEntries().catch((error) =>
            toast({
                title: 'Could not load catalog',
                description: String(error),
                variant: 'error',
            }),
        );
    }, [loadEntries, toast]);

    const toggleWanted = async (entry: SupersetEntryListItemDto) => {
        try {
            if (entry.wanted) {
                await api.wanted.remove(key, entry.id);
                toast({ title: 'Removed from wanted', variant: 'success' });
            } else {
                await api.wanted.add({ superset: key, supersetEntry: entry.id });
                toast({ title: 'Added to wanted', variant: 'success' });
            }
            setResult((prev) =>
                prev
                    ? {
                          ...prev,
                          entries: prev.entries.map((e) =>
                              e.id === entry.id ? { ...e, wanted: !entry.wanted } : e,
                          ),
                      }
                    : prev,
            );
        } catch (error) {
            toast({
                title: 'Could not update the wanted list',
                description: String(error),
                variant: 'error',
            });
        }
    };

    const setEntryLinks = (entryId: string, links: ShopLinkDto[]) => {
        setResult((prev) =>
            prev
                ? {
                      ...prev,
                      entries: prev.entries.map((e) =>
                          e.id === entryId ? { ...e, shopLinks: links } : e,
                      ),
                  }
                : prev,
        );
        setLinksFor((prev) => (prev && prev.id === entryId ? { ...prev, shopLinks: links } : prev));
    };

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
    const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / perPage));

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
                    onChange={(e) => {
                        setSearchInput(e.target.value);
                        setPage(1, { replace: true });
                    }}
                    style={{ flex: '0 1 240px' }}
                >
                    <TextField.Slot>
                        <MagnifyingGlassIcon />
                    </TextField.Slot>
                </TextField.Root>
                <Flex align="center" gap="2">
                    <Switch
                        checked={collectedOnly}
                        onCheckedChange={(checked) => {
                            setCollectedOnly(checked);
                            if (checked) setMissingOnly(false);
                            setPage(1, { replace: true });
                        }}
                        data-testid="collected-only"
                    />
                    <Text size="2" color={collectedOnly ? undefined : 'gray'}>
                        Collected only
                    </Text>
                </Flex>
                <Flex align="center" gap="2">
                    <Switch
                        checked={missingOnly}
                        onCheckedChange={(checked) => {
                            setMissingOnly(checked);
                            if (checked) setCollectedOnly(false);
                            setPage(1, { replace: true });
                        }}
                        data-testid="missing-only"
                    />
                    <Text size="2" color={missingOnly ? undefined : 'gray'}>
                        Missing only
                    </Text>
                </Flex>
                <Select.Root
                    value={sort}
                    onValueChange={(value) => {
                        setSort(value as 'title' | 'rarity-asc' | 'rarity-desc');
                        setPage(1, { replace: true });
                    }}
                    size="2"
                >
                    <Select.Trigger
                        variant="soft"
                        data-testid="superset-sort"
                        style={{ minWidth: 170 }}
                    />
                    <Select.Content>
                        <Select.Item value="title">Title A → Z</Select.Item>
                        <Select.Item value="rarity-desc">Rarity high → low</Select.Item>
                        <Select.Item value="rarity-asc">Rarity low → high</Select.Item>
                    </Select.Content>
                </Select.Root>
            </Flex>

            {entries.length === 0 ? (
                result && (search || missingOnly || collectedOnly) ? (
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
                                    setCollectedOnly(false);
                                    setPage(1, { replace: true });
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
                            <IconButton
                                variant={entry.wanted ? 'solid' : 'soft'}
                                color={entry.wanted ? 'amber' : 'gray'}
                                onClick={() => toggleWanted(entry)}
                                aria-label={
                                    entry.wanted ? 'Remove from wanted list' : 'Add to wanted list'
                                }
                                title={entry.wanted ? 'Remove from wanted' : 'Add to wanted'}
                                data-testid="wanted-toggle"
                            >
                                <StarIcon />
                            </IconButton>
                            <Box style={{ position: 'relative' }}>
                                <IconButton
                                    variant="soft"
                                    color="gray"
                                    onClick={() => setLinksFor(entry)}
                                    aria-label="Shop links"
                                    title={
                                        entry.shopLinks && entry.shopLinks.length > 0
                                            ? `Shop links (${entry.shopLinks.length})`
                                            : 'Shop links'
                                    }
                                    data-testid="shop-links-toggle"
                                >
                                    <Link2Icon />
                                </IconButton>
                                {entry.shopLinks && entry.shopLinks.length > 0 ? (
                                    <Badge
                                        color="jade"
                                        variant="solid"
                                        size="1"
                                        style={{ position: 'absolute', top: -6, right: -8 }}
                                        data-testid="shop-links-count"
                                    >
                                        {entry.shopLinks.length}
                                    </Badge>
                                ) : null}
                            </Box>
                        </Flex>
                    ))}
                </Flex>
            )}

            {linksFor ? (
                <ShopLinksDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setLinksFor(null);
                    }}
                    superset={key}
                    entry={linksFor}
                    links={linksFor.shopLinks ?? []}
                    onChanged={(links) => setEntryLinks(linksFor.id, links)}
                />
            ) : null}

            {result && result.total > 0 ? (
                <Flex align="center" gap="3" justify="center" wrap="wrap">
                    <IconButton
                        variant="soft"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                        aria-label="Previous page"
                    >
                        <ChevronLeftIcon />
                    </IconButton>
                    <Text size="2" color="gray" data-testid="pagination-status">
                        Page {page} of {totalPages} · {result.total} entries
                    </Text>
                    <IconButton
                        variant="soft"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                        aria-label="Next page"
                    >
                        <ChevronRightIcon />
                    </IconButton>
                    <Select.Root
                        size="1"
                        value={String(perPage)}
                        onValueChange={(value) => {
                            setPerPage(Number(value));
                            setPage(1, { replace: true });
                        }}
                    >
                        <Select.Trigger
                            variant="soft"
                            aria-label="Entries per page"
                            data-testid="per-page"
                        />
                        <Select.Content>
                            {PER_PAGE_OPTIONS.map((option) => (
                                <Select.Item key={option} value={String(option)}>
                                    {option} per page
                                </Select.Item>
                            ))}
                        </Select.Content>
                    </Select.Root>
                </Flex>
            ) : null}
        </Flex>
    );
}
