import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeftIcon,
    CheckCircledIcon,
    CrossCircledIcon,
    FileMinusIcon,
    ImageIcon,
    Link2Icon,
    Pencil2Icon,
    PlusIcon,
    StarFilledIcon,
    StarIcon,
    TrashIcon,
} from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Card,
    DataList,
    DropdownMenu,
    Flex,
    Heading,
    IconButton,
    Separator,
    Spinner,
    Text,
    TextField,
} from '@radix-ui/themes';
import type { HistoryEventDto, ItemDetailDto } from '@antiquary/database';
import { api } from '../api';
import { ConfirmDialog, EmptyState } from '../components/Dialogs';
import { FieldValueBadge } from '../components/FieldInput';
import { useToast } from '../components/Toast';
import {
    formatChangeValue,
    formatDateTime,
    formatPrice,
    isPriceValue,
    timeAgo,
} from '../lib/format';

const ACTION_LABELS: Record<string, string> = {
    created: 'Created',
    updated: 'Updated',
    deleted: 'Moved to trash',
    restored: 'Restored from trash',
    image_added: 'Photo added',
    image_removed: 'Photo removed',
};

export function ItemPage() {
    const { id = '' } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const fileInput = useRef<HTMLInputElement>(null);

    const [item, setItem] = useState<ItemDetailDto | null>(null);
    const [missing, setMissing] = useState(false);
    const [history, setHistory] = useState<HistoryEventDto[]>([]);
    const [selectedImage, setSelectedImage] = useState(0);
    const [caption, setCaption] = useState('');

    const load = useCallback(async () => {
        try {
            const detail = await api.items.get(id);
            setItem(detail);
            setCaption(detail.images[0]?.caption ?? '');
            setSelectedImage(0);
            const h = await api.items.history(id);
            setHistory(h.events);
        } catch {
            setMissing(true);
        }
    }, [id]);

    useEffect(() => {
        load();
    }, [load]);

    const selectImage = (index: number) => {
        setSelectedImage(index);
        setCaption(item?.images[index]?.caption ?? '');
    };

    if (missing) {
        return (
            <EmptyState
                icon="🕵️"
                title="Item not found"
                description="It may have been moved to the trash — check there to restore it."
                action={
                    <Button variant="soft" onClick={() => navigate('/')}>
                        Back home
                    </Button>
                }
            />
        );
    }

    if (!item) {
        return <Spinner size="3" />;
    }

    const cover = item.images[selectedImage] ?? item.images[0];

    const upload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        try {
            await api.images.upload(item.id, Array.from(files));
            toast({
                title: `Uploaded ${files.length} photo${files.length === 1 ? '' : 's'}`,
                variant: 'success',
            });
            await load();
        } catch (error) {
            toast({ title: 'Upload failed', description: String(error), variant: 'error' });
        }
    };

    const removeImage = async (imageId: string) => {
        try {
            await api.images.remove(imageId);
            setSelectedImage(0);
            await load();
        } catch (error) {
            toast({
                title: 'Could not remove photo',
                description: String(error),
                variant: 'error',
            });
        }
    };

    const saveCaption = async () => {
        if (!cover) return;
        try {
            await api.images.update(cover.id, { caption: caption.trim() || null });
            toast({ title: 'Caption saved', variant: 'success' });
            await load();
        } catch (error) {
            toast({
                title: 'Could not save caption',
                description: String(error),
                variant: 'error',
            });
        }
    };

    const setCover = async () => {
        if (!cover) return;
        try {
            await api.images.update(cover.id, { isCover: true });
            await load();
        } catch (error) {
            toast({ title: 'Could not set cover', description: String(error), variant: 'error' });
        }
    };

    const toggleFavorite = async () => {
        const updated = await api.items.update(item.id, { isFavorite: !item.isFavorite });
        setItem({ ...item, isFavorite: updated.isFavorite });
    };

    return (
        <Flex direction="column" gap="5">
            <Flex align="center" gap="2" wrap="wrap">
                <Link to={`/collections/${item.collectionId}`} style={{ textDecoration: 'none' }}>
                    <Flex align="center" gap="1" data-testid="breadcrumb-collection">
                        <ArrowLeftIcon />
                        <Text size="2" color="gray">
                            {item.collectionEmoji ?? '📦'} {item.collectionName}
                        </Text>
                    </Flex>
                </Link>
                <Text size="2" color="gray">
                    /
                </Text>
                <Text size="2" className="clamp-1">
                    {item.name}
                </Text>
            </Flex>

            <Box
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)',
                    gap: 'var(--space-4)',
                }}
                className="responsive-two-col"
            >
                <Flex direction="column" gap="3">
                    <Box
                        style={{
                            aspectRatio: '4 / 3',
                            background: 'var(--gray-a3)',
                            borderRadius: 'var(--radius-3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            position: 'relative',
                        }}
                        data-testid="item-cover"
                    >
                        {cover ? (
                            <img
                                src={cover.url}
                                alt={cover.caption ?? item.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        ) : (
                            <Text style={{ fontSize: 56 }}>{item.collectionEmoji ?? '📦'}</Text>
                        )}
                    </Box>
                    {item.images.length > 1 ? (
                        <Flex gap="2" wrap="wrap">
                            {item.images.map((image, index) => (
                                <Box
                                    key={image.id}
                                    style={{
                                        width: 56,
                                        height: 56,
                                        borderRadius: 'var(--radius-2)',
                                        overflow: 'hidden',
                                        border:
                                            index === selectedImage
                                                ? '2px solid var(--accent-9)'
                                                : '1px solid var(--gray-a5)',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => selectImage(index)}
                                >
                                    <img
                                        src={image.url}
                                        alt={image.caption ?? ''}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                        }}
                                    />
                                </Box>
                            ))}
                        </Flex>
                    ) : null}
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        data-testid="file-input"
                        onChange={(e) => {
                            upload(e.target.files);
                            e.target.value = '';
                        }}
                    />
                    <Flex gap="2" wrap="wrap" align="center">
                        <Button
                            variant="soft"
                            onClick={() => fileInput.current?.click()}
                            data-testid="add-photos-button"
                        >
                            <ImageIcon /> Add photos
                        </Button>
                        {cover && !cover.isCover ? (
                            <Button
                                variant="soft"
                                color="gray"
                                onClick={setCover}
                                data-testid="set-cover-button"
                            >
                                Use as cover
                            </Button>
                        ) : null}
                        {cover ? (
                            <Button
                                variant="soft"
                                color="gray"
                                onClick={() => removeImage(cover.id)}
                                data-testid="remove-photo-button"
                            >
                                <TrashIcon /> Remove photo
                            </Button>
                        ) : null}
                    </Flex>
                    {cover ? (
                        <Flex gap="2" align="center" wrap="wrap">
                            <TextField.Root
                                size="2"
                                placeholder="Caption for this photo…"
                                value={caption}
                                onChange={(e) => setCaption(e.target.value)}
                                style={{ maxWidth: 320 }}
                                data-testid="photo-caption-input"
                            />
                            <Button
                                size="2"
                                variant="soft"
                                onClick={saveCaption}
                                data-testid="photo-caption-save"
                            >
                                Save caption
                            </Button>
                            {cover.isCover ? (
                                <Badge color="iris" variant="soft">
                                    Cover
                                </Badge>
                            ) : null}
                        </Flex>
                    ) : null}
                </Flex>

                <Flex direction="column" gap="3">
                    <Flex align="center" gap="2">
                        <Heading size="7" className="clamp-2" data-testid="item-title">
                            {item.name}
                        </Heading>
                        <IconButton
                            variant={item.isFavorite ? 'solid' : 'soft'}
                            color={item.isFavorite ? 'amber' : 'gray'}
                            onClick={toggleFavorite}
                            aria-label="Toggle favorite"
                            data-testid="item-favorite"
                        >
                            {item.isFavorite ? <StarFilledIcon /> : <StarIcon />}
                        </IconButton>
                        <Box style={{ flexGrow: 1 }} />
                        <Button
                            variant="soft"
                            onClick={() => navigate(`/items/${item.id}/edit`)}
                            data-testid="edit-item-button"
                        >
                            <Pencil2Icon /> Edit
                        </Button>
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                                <IconButton
                                    variant="soft"
                                    aria-label="More actions"
                                    data-testid="item-menu"
                                >
                                    ⋯
                                </IconButton>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content align="end">
                                <ConfirmDialog
                                    title={`Move "${item.name}" to trash?`}
                                    description="The item will be moved to the trash and can be restored at any time. Its full history is kept."
                                    actionLabel="Move to trash"
                                    testId="confirm-delete-item"
                                    onConfirm={async () => {
                                        try {
                                            await api.items.remove(item.id);
                                            toast({
                                                title: `"${item.name}" moved to trash`,
                                                variant: 'success',
                                            });
                                            navigate(`/collections/${item.collectionId}`);
                                        } catch (error) {
                                            toast({
                                                title: 'Could not delete item',
                                                description: String(error),
                                                variant: 'error',
                                            });
                                        }
                                    }}
                                    trigger={
                                        <DropdownMenu.Item
                                            color="red"
                                            data-testid="delete-item-button"
                                            onSelect={(e) => e.preventDefault()}
                                        >
                                            <TrashIcon /> Move to trash
                                        </DropdownMenu.Item>
                                    }
                                />
                            </DropdownMenu.Content>
                        </DropdownMenu.Root>
                    </Flex>

                    <Flex gap="2" wrap="wrap" align="center">
                        {item.quantity > 1 ? (
                            <Badge color="gray">Quantity ×{item.quantity}</Badge>
                        ) : null}
                        {item.templateName ? (
                            <Badge color="iris" variant="soft">
                                {item.templateName}
                            </Badge>
                        ) : null}
                        {item.supersetLabel ? (
                            <Badge color="green" variant="soft" data-testid="superset-badge">
                                {item.supersetLabel}
                            </Badge>
                        ) : item.superset ? (
                            <Badge color="gray" variant="soft" data-testid="outside-superset-badge">
                                Outside of superset
                            </Badge>
                        ) : null}
                        {item.tags.map((tag) => (
                            <Badge key={tag.id} color="indigo" variant="soft">
                                {tag.name}
                            </Badge>
                        ))}
                    </Flex>

                    {item.fields.length > 0 ? (
                        <Card size="2">
                            <DataList.Root>
                                {item.fields.map((field) => (
                                    <DataList.Item key={field.id} align="center">
                                        <DataList.Label minWidth="28%">
                                            <Text size="1" color="gray">
                                                {field.name}
                                            </Text>
                                        </DataList.Label>
                                        <DataList.Value>
                                            <FieldValueBadge
                                                type={field.type}
                                                value={field.value}
                                            />
                                        </DataList.Value>
                                    </DataList.Item>
                                ))}
                            </DataList.Root>
                        </Card>
                    ) : null}

                    {item.notes ? (
                        <Card size="2">
                            <Text as="div" size="1" color="gray" mb="1">
                                Notes
                            </Text>
                            <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
                                {item.notes}
                            </Text>
                        </Card>
                    ) : null}

                    <Text size="1" color="gray">
                        Added {formatDateTime(item.createdAt)} · Updated{' '}
                        {formatDateTime(item.updatedAt)}
                    </Text>
                </Flex>
            </Box>

            <Separator size="4" />

            <Box data-testid="history-section">
                <Flex align="center" gap="2" mb="3">
                    <Heading size="4">History</Heading>
                    <Badge color="gray" variant="soft">
                        {history.length} event{history.length === 1 ? '' : 's'}
                    </Badge>
                </Flex>
                {history.length === 0 ? (
                    <Text size="2" color="gray">
                        No history yet.
                    </Text>
                ) : (
                    <Flex direction="column" gap="3">
                        {history.map((event) => (
                            <Box
                                key={event.id}
                                p="3"
                                style={{
                                    border: '1px solid var(--gray-a5)',
                                    borderRadius: 'var(--radius-3)',
                                    background: 'var(--color-panel-transparent)',
                                }}
                                data-testid="history-event"
                            >
                                <Flex align="center" gap="2" wrap="wrap">
                                    {event.action === 'created' || event.action === 'restored' ? (
                                        <CheckCircledIcon color="var(--grass-9)" />
                                    ) : event.action === 'deleted' ||
                                      event.action === 'image_removed' ? (
                                        <CrossCircledIcon color="var(--red-9)" />
                                    ) : event.action.startsWith('image') ? (
                                        <ImageIcon />
                                    ) : (
                                        <FileMinusIcon />
                                    )}
                                    <Text size="2" weight="medium">
                                        {ACTION_LABELS[event.action] ?? event.action}
                                    </Text>
                                    <Box style={{ flexGrow: 1 }} />
                                    <Text size="1" color="gray">
                                        {formatDateTime(event.createdAt)} ·{' '}
                                        {timeAgo(event.createdAt)}
                                    </Text>
                                </Flex>
                                {event.changes && event.changes.length > 0 ? (
                                    <Box mt="2" style={{ paddingLeft: 26 }}>
                                        <Flex direction="column" gap="1">
                                            {event.changes.map((change) => (
                                                <Flex
                                                    key={`${change.field}-${change.label}`}
                                                    gap="2"
                                                    align="center"
                                                    wrap="wrap"
                                                    data-testid="history-change"
                                                >
                                                    <Text size="1" weight="medium" color="gray">
                                                        {change.label}
                                                    </Text>
                                                    {change.field === 'url' ? <Link2Icon /> : null}
                                                    <Text size="1" color="gray">
                                                        <s>{formatChangeValue(change, 'from')}</s>
                                                    </Text>
                                                    <Text size="1" color="gray">
                                                        →
                                                    </Text>
                                                    <Text size="1" weight="medium">
                                                        {formatChangeValue(change, 'to')}
                                                    </Text>
                                                </Flex>
                                            ))}
                                        </Flex>
                                    </Box>
                                ) : null}
                                <details style={{ marginTop: 8 }}>
                                    <summary
                                        style={{
                                            cursor: 'pointer',
                                            fontSize: 11,
                                            color: 'var(--gray-10)',
                                        }}
                                    >
                                        Snapshot at this point
                                    </summary>
                                    <Box
                                        mt="2"
                                        p="2"
                                        style={{
                                            background: 'var(--gray-a3)',
                                            borderRadius: 'var(--radius-2)',
                                        }}
                                    >
                                        <Text size="1" as="div">
                                            Name: {event.snapshot.name}
                                        </Text>
                                        <Text size="1" as="div">
                                            Quantity: {event.snapshot.quantity} · Favorite:{' '}
                                            {event.snapshot.isFavorite ? 'yes' : 'no'} · Photos:{' '}
                                            {event.snapshot.imageCount}
                                        </Text>
                                        {event.snapshot.tags.length > 0 ? (
                                            <Text size="1" as="div">
                                                Tags: {event.snapshot.tags.join(', ')}
                                            </Text>
                                        ) : null}
                                        {event.snapshot.fields.map((field) => (
                                            <Text
                                                size="1"
                                                as="div"
                                                key={field.fieldId}
                                                color="gray"
                                            >
                                                {field.name}:{' '}
                                                {field.value === null
                                                    ? '—'
                                                    : isPriceValue(field.value)
                                                      ? formatPrice(field.value)
                                                      : String(field.value)}
                                            </Text>
                                        ))}
                                    </Box>
                                </details>
                            </Box>
                        ))}
                    </Flex>
                )}
            </Box>

            <Box>
                <Button
                    variant="soft"
                    onClick={() => navigate(`/items/new?collection=${item.collectionId}`)}
                    data-testid="add-similar-button"
                >
                    <PlusIcon /> Add another item to {item.collectionName}
                </Button>
            </Box>
        </Flex>
    );
}
