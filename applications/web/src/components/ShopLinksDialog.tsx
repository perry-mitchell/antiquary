import { useState } from 'react';
import { Cross2Icon, ExternalLinkIcon } from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    IconButton,
    Spinner,
    Text,
    TextField,
} from '@radix-ui/themes';
import type { ShopLinkDto } from '@antiquary/database';
import { api } from '../api';
import type { SupersetEntryDto } from '../api';
import { useToast } from './Toast';
import { CURRENCIES, formatPrice, slug } from '../lib/format';

/** Manage the shop links of one catalog entry: list, add and remove listings. */
export function ShopLinksDialog({
    open,
    onOpenChange,
    superset,
    entry,
    links,
    onChanged,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    superset: string;
    entry: SupersetEntryDto;
    links: ShopLinkDto[];
    onChanged: (links: ShopLinkDto[]) => void;
}) {
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [url, setUrl] = useState('');
    const [price, setPrice] = useState('');
    const [currency, setCurrency] = useState<string>('USD');
    const [saving, setSaving] = useState(false);

    const add = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!title.trim() || !url.trim()) return;
        setSaving(true);
        try {
            const created = await api.shopLinks.create({
                superset,
                supersetEntry: entry.id,
                title: title.trim(),
                url: url.trim(),
                price: price.trim() ? Number(price) : null,
                currency: price.trim() ? currency : null,
            });
            onChanged([...links, created]);
            toast({ title: 'Shop link added', variant: 'success' });
            setTitle('');
            setUrl('');
            setPrice('');
        } catch (error) {
            toast({
                title: 'Could not add shop link',
                description: String(error),
                variant: 'error',
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (link: ShopLinkDto) => {
        try {
            await api.shopLinks.remove(link.id);
            onChanged(links.filter((l) => l.id !== link.id));
        } catch (error) {
            toast({
                title: 'Could not remove shop link',
                description: String(error),
                variant: 'error',
            });
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content style={{ maxWidth: 560 }} data-testid="shop-links-dialog">
                <Dialog.Title>Shop links</Dialog.Title>
                <Dialog.Description size="2" color="gray">
                    Listings where <Text weight="medium">{entry.name}</Text> can be bought.
                </Dialog.Description>

                <Flex direction="column" gap="2" mt="4" data-testid="shop-links-list">
                    {links.length === 0 ? (
                        <Text size="2" color="gray" data-testid="shop-links-empty">
                            No listings yet — add one below.
                        </Text>
                    ) : (
                        links.map((link) => (
                            <Flex
                                key={link.id}
                                align="center"
                                gap="3"
                                py="1"
                                style={{ borderBottom: '1px solid var(--gray-a4)' }}
                                data-testid={`shop-link-row-${slug(link.title)}`}
                            >
                                <Box style={{ flexGrow: 1, minWidth: 160 }}>
                                    <a href={link.url} target="_blank" rel="noreferrer">
                                        <Flex align="center" gap="1">
                                            <Text size="2" weight="medium">
                                                {link.title}
                                            </Text>
                                            <ExternalLinkIcon />
                                        </Flex>
                                    </a>
                                    <Text
                                        as="div"
                                        size="1"
                                        color="gray"
                                        style={{ wordBreak: 'break-all' }}
                                    >
                                        {link.url}
                                    </Text>
                                </Box>
                                {link.price !== null && link.currency ? (
                                    <Badge
                                        color="grass"
                                        variant="soft"
                                        data-testid="shop-link-price"
                                    >
                                        {formatPrice({
                                            amount: link.price,
                                            currency: link.currency,
                                        })}
                                    </Badge>
                                ) : null}
                                <IconButton
                                    variant="soft"
                                    color="gray"
                                    size="1"
                                    aria-label="Remove shop link"
                                    title="Remove shop link"
                                    onClick={() => remove(link)}
                                    data-testid={`shop-link-remove-${slug(link.title)}`}
                                >
                                    <Cross2Icon />
                                </IconButton>
                            </Flex>
                        ))
                    )}
                </Flex>

                <form onSubmit={add}>
                    <Flex direction="column" gap="2" mt="4">
                        <Text as="div" size="1" weight="medium">
                            Add a listing
                        </Text>
                        <TextField.Root
                            data-testid="shop-link-title-input"
                            size="2"
                            placeholder="Title — e.g. eBay, eStarland…"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required
                        />
                        <TextField.Root
                            data-testid="shop-link-url-input"
                            size="2"
                            type="url"
                            placeholder="https://…"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            required
                        />
                        <Flex gap="2">
                            <TextField.Root
                                data-testid="shop-link-price-input"
                                size="2"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Price (optional)"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                style={{ flex: 1 }}
                            />
                            <select
                                data-testid="shop-link-currency-select"
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                style={{ flex: '0 0 110px', height: 'var(--TextField-height-2)' }}
                                aria-label="Currency"
                            >
                                {CURRENCIES.map((code) => (
                                    <option key={code} value={code}>
                                        {code}
                                    </option>
                                ))}
                            </select>
                        </Flex>
                        <Flex gap="3" justify="end" mt="1">
                            <Dialog.Close>
                                <Button variant="soft" color="gray" type="button">
                                    Done
                                </Button>
                            </Dialog.Close>
                            <Button
                                type="submit"
                                disabled={saving}
                                data-testid="shop-link-add-button"
                            >
                                {saving ? <Spinner /> : 'Add listing'}
                            </Button>
                        </Flex>
                    </Flex>
                </form>
            </Dialog.Content>
        </Dialog.Root>
    );
}
