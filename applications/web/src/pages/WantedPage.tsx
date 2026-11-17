import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cross2Icon } from '@radix-ui/react-icons';
import { Badge, Box, Button, Flex, Heading, IconButton, Skeleton, Text } from '@radix-ui/themes';
import { api } from '../api';
import type { WantedListItemDto } from '../api';
import { EmptyState } from '../components/Dialogs';
import { RarityTag } from '../components/RarityTag';
import { useToast } from '../components/Toast';
import { slug } from '../lib/format';

export function WantedPage() {
    const toast = useToast();
    const [items, setItems] = useState<WantedListItemDto[] | null>(null);

    const load = useCallback(async () => {
        setItems(await api.wanted.list());
    }, []);

    useEffect(() => {
        load().catch((error) =>
            toast({
                title: 'Could not load the wanted list',
                description: String(error),
                variant: 'error',
            }),
        );
    }, [load, toast]);

    const remove = async (item: WantedListItemDto) => {
        try {
            await api.wanted.remove(item.superset, item.supersetEntry);
            setItems((prev) => prev?.filter((w) => w.id !== item.id) ?? null);
            toast({ title: 'Removed from wanted', variant: 'success' });
        } catch (error) {
            toast({
                title: 'Could not remove from wanted',
                description: String(error),
                variant: 'error',
            });
        }
    };

    if (!items) {
        return <Skeleton style={{ height: 300 }} />;
    }

    return (
        <Flex direction="column" gap="4" data-testid="wanted-page">
            <Flex align="center" gap="2">
                <Heading size="6">Wanted list</Heading>
                <Badge color="amber" variant="soft" data-testid="wanted-count">
                    {items.length}
                </Badge>
            </Flex>
            <Text as="div" size="2" color="gray">
                Catalog entries you are hunting for, across every collection.
            </Text>

            {items.length === 0 ? (
                <EmptyState
                    icon="⭐"
                    title="Nothing on the wanted list yet"
                    description="Browse a collection's catalog and star the entries you are hunting for."
                    action={
                        <Link to="/">
                            <Button variant="soft">Browse collections</Button>
                        </Link>
                    }
                />
            ) : (
                <Flex direction="column" data-testid="wanted-entries">
                    {items.map((item) => {
                        const rowId = slug(item.entry?.name ?? item.supersetEntry);
                        return (
                            <Flex
                                key={item.id}
                                align="center"
                                gap="3"
                                wrap="wrap"
                                py="2"
                                style={{ borderBottom: '1px solid var(--gray-a4)' }}
                                data-testid={`wanted-entry-${rowId}`}
                            >
                                <Box style={{ flexGrow: 1, minWidth: 180 }}>
                                    <Text size="2" weight="medium">
                                        {item.entry?.name ?? item.supersetEntry}
                                    </Text>
                                    <Flex align="center" gap="2" wrap="wrap" mt="1">
                                        <Badge color="iris" variant="soft">
                                            {item.supersetName ?? item.superset}
                                        </Badge>
                                        {item.entry?.region ? (
                                            <Badge color="iris" variant="soft">
                                                {item.entry.region}
                                            </Badge>
                                        ) : null}
                                        {item.entry?.serial ? (
                                            <Text size="1" color="gray">
                                                {item.entry.serial}
                                            </Text>
                                        ) : null}
                                        {item.entry?.year ? (
                                            <Text size="1" color="gray">
                                                {item.entry.year}
                                            </Text>
                                        ) : null}
                                        {item.entry?.genre ? (
                                            <Text size="1" color="gray">
                                                {item.entry.genre}
                                            </Text>
                                        ) : null}
                                    </Flex>
                                </Box>
                                {item.entry?.rarity ? (
                                    <RarityTag
                                        rarity={item.entry.rarity.rarity}
                                        rarityLabel={item.entry.rarity.rarityLabel}
                                        rarityPercent={item.entry.rarity.rarityPercent}
                                    />
                                ) : null}
                                {item.owned ? (
                                    <Link to={`/items/${item.ownedItemId}`}>
                                        <Badge
                                            color="grass"
                                            variant="soft"
                                            data-testid="owned-badge"
                                        >
                                            Owned
                                        </Badge>
                                    </Link>
                                ) : (
                                    <Badge color="gray" variant="soft" data-testid="missing-badge">
                                        Missing
                                    </Badge>
                                )}
                                <IconButton
                                    variant="soft"
                                    color="gray"
                                    aria-label="Remove from wanted list"
                                    title="Remove from wanted list"
                                    onClick={() => remove(item)}
                                    data-testid={`wanted-remove-${rowId}`}
                                >
                                    <Cross2Icon />
                                </IconButton>
                            </Flex>
                        );
                    })}
                </Flex>
            )}
        </Flex>
    );
}
