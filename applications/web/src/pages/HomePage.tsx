import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, StarIcon, LayersIcon, BoxIcon, BookmarkIcon } from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Card,
    Flex,
    Grid,
    Heading,
    Progress,
    Skeleton,
    Text,
} from '@radix-ui/themes';
import type { CollectionDto, StatsDto } from '@antiquary/database';
import { api } from '../api';
import { CollectionDialog, EmptyState } from '../components/Dialogs';
import { timeAgo } from '../lib/format';

export function HomePage() {
    const [stats, setStats] = useState<StatsDto | null>(null);
    const [collections, setCollections] = useState<CollectionDto[] | null>(null);

    const refresh = useCallback(async () => {
        const [nextStats, nextCollections] = await Promise.all([
            api.stats(),
            api.collections.list(),
        ]);
        setStats(nextStats);
        setCollections(nextCollections);
    }, []);

    useEffect(() => {
        refresh().catch(() => setCollections([]));
    }, [refresh]);

    if (!collections || !stats) {
        return (
            <Flex direction="column" gap="4">
                <Skeleton style={{ height: 88 }} />
                <Grid columns="4" gap="3">
                    {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} style={{ height: 120 }} />
                    ))}
                </Grid>
            </Flex>
        );
    }

    const statCard = (label: string, value: number, icon: React.ReactNode, testId: string) => (
        <Card size="2" data-testid={testId}>
            <Flex align="center" gap="3">
                <Text style={{ fontSize: 22, color: 'var(--accent-11)' }}>{icon}</Text>
                <Box>
                    <Text as="div" size="6" weight="bold">
                        {value}
                    </Text>
                    <Text as="div" size="1" color="gray">
                        {label}
                    </Text>
                </Box>
            </Flex>
        </Card>
    );

    return (
        <Flex direction="column" gap="5">
            {collections.length === 0 ? (
                <EmptyState
                    icon="🗂️"
                    title="Welcome to Antiquary"
                    description="Create your first collection — books, records, games, anything you own. Then add items with custom fields, photos, tags and full change history."
                    action={
                        <CollectionDialog
                            trigger={
                                <Button size="3" data-testid="new-collection-button">
                                    <PlusIcon /> Create your first collection
                                </Button>
                            }
                            onSaved={refresh}
                        />
                    }
                />
            ) : (
                <>
                    <Grid columns={{ initial: '2', sm: '4' }} gap="3">
                        {statCard(
                            'Collections',
                            stats.collectionCount,
                            <LayersIcon />,
                            'stat-collections',
                        )}
                        {statCard('Items', stats.itemCount, <BoxIcon />, 'stat-items')}
                        {statCard('Favorites', stats.favoriteCount, <StarIcon />, 'stat-favorites')}
                        {statCard('Tags', stats.tagCount, <BookmarkIcon />, 'stat-tags')}
                    </Grid>

                    <Flex align="center" justify="between">
                        <Heading size="5">Your collections</Heading>
                        <CollectionDialog
                            trigger={
                                <Button variant="soft" data-testid="new-collection-button">
                                    <PlusIcon /> New collection
                                </Button>
                            }
                            onSaved={refresh}
                        />
                    </Flex>

                    <Grid columns={{ initial: '2', sm: '3', md: '4' }} gap="3">
                        {collections.map((collection) => (
                            <Card
                                key={collection.id}
                                asChild
                                size="2"
                                data-testid="collection-card"
                            >
                                <Link
                                    to={`/collections/${collection.id}`}
                                    style={{
                                        textDecoration: 'none',
                                        display: 'block',
                                        height: '100%',
                                    }}
                                >
                                    <Flex direction="column" gap="2" align="start">
                                        <Text style={{ fontSize: 34, lineHeight: 1 }}>
                                            {collection.emoji ?? '📦'}
                                        </Text>
                                        <Text as="div" size="3" weight="medium" className="clamp-2">
                                            {collection.name}
                                        </Text>
                                        {collection.description ? (
                                            <Text
                                                as="div"
                                                size="1"
                                                color="gray"
                                                className="clamp-2"
                                            >
                                                {collection.description}
                                            </Text>
                                        ) : null}
                                        <Badge color="iris" variant="soft" mt="auto">
                                            {collection.itemCount} item
                                            {collection.itemCount === 1 ? '' : 's'}
                                        </Badge>
                                        {collection.completion ? (
                                            <Box
                                                style={{ width: '100%' }}
                                                data-testid="collection-completion"
                                            >
                                                <Flex justify="between" mb="1">
                                                    <Text size="1" color="gray">
                                                        {collection.completion.owned} /{' '}
                                                        {collection.completion.total} titles
                                                    </Text>
                                                    <Text size="1" weight="medium">
                                                        {collection.completion.percent}%
                                                    </Text>
                                                </Flex>
                                                <Progress
                                                    value={collection.completion.percent}
                                                    size="1"
                                                />
                                            </Box>
                                        ) : null}
                                    </Flex>
                                </Link>
                            </Card>
                        ))}
                    </Grid>

                    {stats.recentItems.length > 0 ? (
                        <Box>
                            <Heading size="4" mb="3">
                                Recently added
                            </Heading>
                            <Flex direction="column" gap="1">
                                {stats.recentItems.map((item) => (
                                    <Flex
                                        key={item.id}
                                        asChild
                                        align="center"
                                        gap="3"
                                        px="3"
                                        py="2"
                                        style={{ borderRadius: 'var(--radius-2)' }}
                                    >
                                        <Link
                                            to={`/items/${item.id}`}
                                            style={{ textDecoration: 'none', color: 'inherit' }}
                                            data-testid="recent-item"
                                        >
                                            <Text style={{ fontSize: 18 }}>
                                                {item.collectionEmoji ?? '📦'}
                                            </Text>
                                            <Text size="2" weight="medium" className="clamp-1">
                                                {item.name}
                                            </Text>
                                            <Text size="1" color="gray">
                                                in {item.collectionName}
                                            </Text>
                                            <Box style={{ flexGrow: 1 }} />
                                            {item.isFavorite ? (
                                                <StarIcon color="var(--amber-9)" />
                                            ) : null}
                                            <Text size="1" color="gray">
                                                {timeAgo(item.createdAt)}
                                            </Text>
                                        </Link>
                                    </Flex>
                                ))}
                            </Flex>
                        </Box>
                    ) : null}
                </>
            )}
        </Flex>
    );
}
