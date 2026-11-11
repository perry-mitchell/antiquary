import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Heading, Text, Spinner, Flex } from '@radix-ui/themes';
import type { ItemListResultDto } from '@antiquary/database';
import { api } from '../api';
import { ItemGrid } from '../components/ItemGrid';

export function SearchPage() {
    const [params] = useSearchParams();
    const query = params.get('q') ?? '';
    const [result, setResult] = useState<ItemListResultDto | null>(null);

    useEffect(() => {
        setResult(null);
        if (query) {
            api.items
                .list({ search: query, limit: 60 })
                .then(setResult)
                .catch(() => setResult({ items: [], total: 0, page: 1, limit: 60 }));
        } else {
            setResult({ items: [], total: 0, page: 1, limit: 60 });
        }
    }, [query]);

    return (
        <Flex direction="column" gap="4">
            <Flex align="baseline" gap="3">
                <Heading size="6">Search</Heading>
                <Text size="2" color="gray" data-testid="search-summary">
                    {result
                        ? `${result.total} result${result.total === 1 ? '' : 's'} for “${query}”`
                        : `Searching “${query}”…`}
                </Text>
            </Flex>
            {!result ? (
                <Flex align="center" gap="2" py="6">
                    <Spinner />
                </Flex>
            ) : result.items.length === 0 ? (
                <Text size="2" color="gray">
                    Nothing matched. Search covers item names, notes and custom field values.
                </Text>
            ) : (
                <ItemGrid items={result.items} />
            )}
        </Flex>
    );
}
