import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Cross2Icon, MagnifyingGlassIcon, PlusIcon } from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Card,
    Checkbox,
    Flex,
    Heading,
    Spinner,
    Switch,
    Text,
    TextArea,
    TextField,
} from '@radix-ui/themes';
import type { CollectionDto, FieldValue, TagDto, TemplateDetailDto } from '@antiquary/database';
import { api, type SupersetEntryDto, type SupersetInfoDto } from '../api';
import { FieldInput } from '../components/FieldInput';
import { useToast } from '../components/Toast';
import { slug } from '../lib/format';

interface DraftField {
    id: string;
    name: string;
    type: string;
    options: string[] | null;
    required: boolean;
    position: number;
}

const CATALOG_FIELD_NAMES: { field: string; pick: (entry: SupersetEntryDto) => FieldValue }[] = [
    { field: 'Region', pick: (e) => e.region },
    { field: 'Serial', pick: (e) => e.serial },
    { field: 'Developer', pick: (e) => e.developer },
    { field: 'Publisher', pick: (e) => e.publisher },
    { field: 'Genre', pick: (e) => e.genre },
    { field: 'Year', pick: (e) => e.year },
];

export function ItemFormPage({ mode }: { mode: 'create' | 'edit' }) {
    const { id = '' } = useParams();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();

    const [collections, setCollections] = useState<CollectionDto[]>([]);
    const [templates, setTemplates] = useState<TemplateDetailDto[]>([]);
    const [tags, setTags] = useState<TagDto[]>([]);
    const [supersets, setSupersets] = useState<SupersetInfoDto[]>([]);
    const [loading, setLoading] = useState(true);

    const [collectionId, setCollectionId] = useState(params.get('collection') ?? '');
    const [name, setName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [notes, setNotes] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [isFavorite, setIsFavorite] = useState(false);
    const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');
    const [saving, setSaving] = useState(false);

    // Gallery photos picked during creation — uploaded right after the item exists
    const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
    const photosInput = useRef<HTMLInputElement>(null);

    // Catalog (superset) matching state
    const [supersetQuery, setSupersetQuery] = useState('');
    const [supersetResults, setSupersetResults] = useState<
        { title: string; variants: SupersetEntryDto[] }[]
    >([]);
    const [expandedTitle, setExpandedTitle] = useState<string | null>(null);
    const [selectedEntry, setSelectedEntry] = useState<SupersetEntryDto | null>(null);
    const [outsideSuperset, setOutsideSuperset] = useState(false);
    const [originalEntryId, setOriginalEntryId] = useState<string | null>(null);
    const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // The template comes from the collection — every item in a collection
    // shares it.
    const activeTemplate = useMemo(
        () =>
            templates.find(
                (t) => t.id === collections.find((c) => c.id === collectionId)?.templateId,
            ) ?? null,
        [templates, collections, collectionId],
    );
    const draftFields: DraftField[] = activeTemplate?.fields ?? [];
    const needsCatalogMatch = Boolean(activeTemplate?.superset);
    // Incomplete catalogs (PC, DOS) are curated, not exhaustive — items may
    // sit outside them when explicitly acknowledged.
    const catalogComplete = useMemo(
        () => supersets.find((s) => s.key === activeTemplate?.superset)?.complete ?? true,
        [supersets, activeTemplate?.superset],
    );

    useEffect(() => {
        const load = async () => {
            const [cols, tpls, tagList, supersetList] = await Promise.all([
                api.collections.list(),
                api.templates.list(),
                api.tags.list(),
                api.supersets.list(),
            ]);
            setCollections(cols);
            setTemplates(tpls);
            setTags(tagList);
            setSupersets(supersetList);

            if (mode === 'edit') {
                const item = await api.items.get(id);
                setName(item.name);
                setNotes(item.notes ?? '');
                setQuantity(item.quantity);
                setIsFavorite(item.isFavorite);
                setCollectionId(item.collectionId);
                setSelectedTags(item.tags.map((t) => t.id));
                const values: Record<string, FieldValue> = {};
                for (const field of item.fields) values[field.id] = field.value;
                setFieldValues(values);
                if (item.superset && item.supersetEntry) {
                    setOriginalEntryId(item.supersetEntry);
                    try {
                        setSelectedEntry(
                            await api.supersets.entry(item.superset, item.supersetEntry),
                        );
                    } catch {
                        /* entry no longer in catalog — leave unmatched */
                    }
                }
            }
            setLoading(false);
        };
        load().catch((error) => {
            toast({ title: 'Could not load form', description: String(error), variant: 'error' });
            navigate('/');
        });
    }, [id, mode, navigate, toast]);

    // Reset the picker when the template (and therefore the catalog) changes.
    useEffect(() => {
        setSupersetQuery('');
        setSupersetResults([]);
        setExpandedTitle(null);
        setSelectedEntry(null);
        setOutsideSuperset(false);
    }, [activeTemplate?.superset, activeTemplate?.id]);

    useEffect(() => {
        if (!needsCatalogMatch) return;
        clearTimeout(searchDebounce.current);
        searchDebounce.current = setTimeout(async () => {
            const q = supersetQuery.trim();
            if (q.length === 0) {
                setSupersetResults([]);
                setExpandedTitle(null);
                return;
            }
            try {
                const { results } = await api.supersets.search(activeTemplate!.superset!, q);
                setSupersetResults(results);
                setExpandedTitle(null);
            } catch {
                setSupersetResults([]);
            }
        }, 250);
        return () => clearTimeout(searchDebounce.current);
    }, [supersetQuery, needsCatalogMatch, activeTemplate]);

    const selectVariant = (entry: SupersetEntryDto) => {
        setSelectedEntry(entry);
        // Fill the title unless the user deliberately wrote one; an emptied
        // field counts as empty so a fresh pick always lands.
        if (!nameTouched || name.trim().length === 0) setName(entry.parentTitle);
        setFieldValues((current) => {
            const next = { ...current };
            const byName = new Map(draftFields.map((f) => [f.name.trim().toLowerCase(), f]));
            for (const def of CATALOG_FIELD_NAMES) {
                const field = byName.get(def.field.toLowerCase());
                if (!field) continue;
                const value = def.pick(entry);
                if (value === null || value === undefined || value === '') continue;
                if (field.type === 'select' && !(field.options ?? []).includes(String(value)))
                    continue;
                next[field.id] = value;
            }
            return next;
        });
    };

    if (loading) {
        return (
            <Flex align="center" justify="center" py="9">
                <Spinner size="3" />
            </Flex>
        );
    }

    const addTag = async () => {
        const trimmed = newTag.trim();
        if (!trimmed) return;
        try {
            const tag = await api.tags.create({ name: trimmed });
            setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedTags((current) => [...current, tag.id]);
            setNewTag('');
        } catch (error) {
            toast({ title: 'Could not create tag', description: String(error), variant: 'error' });
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (!collectionId) {
            toast({ title: 'Pick a collection first', variant: 'error' });
            return;
        }
        setSaving(true);
        const fieldValuesList = draftFields.map((field) => ({
            fieldId: field.id,
            value: fieldValues[field.id] ?? null,
        }));
        try {
            const entryChanged =
                mode === 'create' || (selectedEntry?.id ?? null) !== originalEntryId;
            const body = {
                collectionId,
                // Only send the match on edit when it actually changed — clearing it
                // is only valid together with outsideSuperset on incomplete catalogs.
                supersetEntry: entryChanged ? (selectedEntry?.id ?? null) : undefined,
                outsideSuperset:
                    needsCatalogMatch && !selectedEntry && !catalogComplete
                        ? outsideSuperset
                        : undefined,
                name,
                notes: notes.trim() || null,
                quantity,
                isFavorite,
                fieldValues: fieldValuesList,
                tagIds: selectedTags,
            };
            const saved =
                mode === 'create' ? await api.items.create(body) : await api.items.update(id, body);
            if (mode === 'create' && pendingPhotos.length > 0) {
                try {
                    await api.images.upload(saved.id, pendingPhotos);
                } catch {
                    toast({
                        title: 'Item saved, but photos failed to upload',
                        description: 'You can add them from the item page.',
                        variant: 'error',
                    });
                }
            }
            toast({
                title: mode === 'create' ? `"${saved.name}" added` : 'Changes saved',
                variant: 'success',
            });
            navigate(`/items/${saved.id}`);
        } catch (error) {
            toast({ title: 'Could not save item', description: String(error), variant: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const matchRequired = needsCatalogMatch && !selectedEntry && catalogComplete;
    const canSave =
        !saving &&
        collections.length > 0 &&
        !(needsCatalogMatch && !selectedEntry && !(outsideSuperset && !catalogComplete));

    return (
        <Flex direction="column" gap="4" maxWidth="760px" mx="auto" as="div">
            <Heading size="6">{mode === 'create' ? 'Add item' : 'Edit item'}</Heading>

            <form onSubmit={submit}>
                <Flex direction="column" gap="4">
                    {needsCatalogMatch ? (
                        <Card
                            size="3"
                            style={{ borderColor: selectedEntry ? undefined : 'var(--amber-9)' }}
                        >
                            <Flex direction="column" gap="3">
                                <Flex align="center" gap="2">
                                    <Heading size="4">Match from catalog</Heading>
                                    {selectedEntry ? (
                                        <Badge
                                            color="green"
                                            variant="soft"
                                            data-testid="catalog-match"
                                        >
                                            Matched
                                        </Badge>
                                    ) : catalogComplete ? (
                                        <Badge color="amber" variant="soft">
                                            Required before saving
                                        </Badge>
                                    ) : (
                                        <Badge
                                            color="amber"
                                            variant="soft"
                                            data-testid="catalog-incomplete-badge"
                                        >
                                            Not exhaustive — match or mark outside
                                        </Badge>
                                    )}
                                </Flex>
                                <Text as="div" size="1" color="gray">
                                    Search the {activeTemplate?.superset} catalog, pick the title,
                                    then the variant. Details fill in below — you can still change
                                    anything.
                                </Text>

                                {selectedEntry ? (
                                    <Box data-testid="catalog-selected">
                                        <Flex
                                            gap="3"
                                            align="center"
                                            wrap="wrap"
                                            p="2"
                                            style={{
                                                background: 'var(--grass-a3)',
                                                borderRadius: 'var(--radius-2)',
                                            }}
                                        >
                                            <Text size="3" weight="medium">
                                                {selectedEntry.name}
                                            </Text>
                                            {selectedEntry.region ? (
                                                <Badge color="iris" variant="soft">
                                                    {selectedEntry.region}
                                                </Badge>
                                            ) : null}
                                            {selectedEntry.serial ? (
                                                <Text size="1" color="gray">
                                                    {selectedEntry.serial}
                                                </Text>
                                            ) : null}
                                            {selectedEntry.year ? (
                                                <Text size="1" color="gray">
                                                    {selectedEntry.year}
                                                </Text>
                                            ) : null}
                                            <Box style={{ flexGrow: 1 }} />
                                            <Button
                                                type="button"
                                                size="1"
                                                variant="soft"
                                                color="gray"
                                                onClick={() => {
                                                    setSelectedEntry(null);
                                                    setSupersetQuery('');
                                                    setSupersetResults([]);
                                                }}
                                            >
                                                Change
                                            </Button>
                                        </Flex>
                                    </Box>
                                ) : (
                                    <>
                                        <TextField.Root
                                            data-testid="catalog-search"
                                            placeholder={`Search ${activeTemplate?.superset} titles…`}
                                            value={supersetQuery}
                                            onChange={(e) => setSupersetQuery(e.target.value)}
                                        >
                                            <TextField.Slot>
                                                <MagnifyingGlassIcon />
                                            </TextField.Slot>
                                        </TextField.Root>
                                        {supersetResults.length > 0 ? (
                                            <Flex
                                                direction="column"
                                                gap="1"
                                                style={{ maxHeight: 320, overflowY: 'auto' }}
                                            >
                                                {supersetResults.map((result) => (
                                                    <Box key={result.title}>
                                                        <button
                                                            type="button"
                                                            data-testid={`catalog-title-${slug(result.title)}`}
                                                            onClick={() =>
                                                                setExpandedTitle(
                                                                    expandedTitle === result.title
                                                                        ? null
                                                                        : result.title,
                                                                )
                                                            }
                                                            style={{
                                                                width: '100%',
                                                                textAlign: 'left',
                                                                padding: 'var(--space-2)',
                                                                background:
                                                                    expandedTitle === result.title
                                                                        ? 'var(--accent-a3)'
                                                                        : 'transparent',
                                                                border: 'none',
                                                                borderBottom:
                                                                    '1px solid var(--gray-a4)',
                                                                cursor: 'pointer',
                                                                color: 'var(--gray-12)',
                                                            }}
                                                        >
                                                            <Flex align="center" gap="2">
                                                                <Text size="2" weight="medium">
                                                                    {result.title}
                                                                </Text>
                                                                <Badge color="gray" variant="soft">
                                                                    {result.variants.length} variant
                                                                    {result.variants.length === 1
                                                                        ? ''
                                                                        : 's'}
                                                                </Badge>
                                                            </Flex>
                                                        </button>
                                                        {expandedTitle === result.title
                                                            ? result.variants.map((variant) => (
                                                                  <button
                                                                      key={variant.id}
                                                                      type="button"
                                                                      data-testid={`catalog-variant-${slug(result.title)}`}
                                                                      onClick={() =>
                                                                          selectVariant(variant)
                                                                      }
                                                                      style={{
                                                                          width: '100%',
                                                                          textAlign: 'left',
                                                                          padding:
                                                                              'var(--space-2) var(--space-4)',
                                                                          background: 'transparent',
                                                                          border: 'none',
                                                                          borderBottom:
                                                                              '1px solid var(--gray-a4)',
                                                                          cursor: 'pointer',
                                                                          color: 'var(--gray-12)',
                                                                          display: 'flex',
                                                                          alignItems: 'center',
                                                                          gap: 'var(--space-2)',
                                                                      }}
                                                                  >
                                                                      <Text size="2">
                                                                          {variant.name}
                                                                      </Text>
                                                                      {variant.region ? (
                                                                          <Badge
                                                                              color="iris"
                                                                              variant="soft"
                                                                          >
                                                                              {variant.region}
                                                                          </Badge>
                                                                      ) : null}
                                                                      {variant.serial ? (
                                                                          <Text
                                                                              size="1"
                                                                              color="gray"
                                                                          >
                                                                              {variant.serial}
                                                                          </Text>
                                                                      ) : null}
                                                                      {variant.year ? (
                                                                          <Text
                                                                              size="1"
                                                                              color="gray"
                                                                          >
                                                                              {variant.year}
                                                                          </Text>
                                                                      ) : null}
                                                                  </button>
                                                              ))
                                                            : null}
                                                    </Box>
                                                ))}
                                            </Flex>
                                        ) : supersetQuery.trim().length > 0 ? (
                                            <Text size="2" color="gray">
                                                Nothing matched “{supersetQuery}”.
                                            </Text>
                                        ) : null}
                                    </>
                                )}
                                {!selectedEntry && !catalogComplete ? (
                                    <Flex
                                        gap="2"
                                        align="center"
                                        p="2"
                                        style={{
                                            background: 'var(--amber-a3)',
                                            borderRadius: 'var(--radius-2)',
                                        }}
                                    >
                                        <Checkbox
                                            checked={outsideSuperset}
                                            onCheckedChange={(v) => setOutsideSuperset(v === true)}
                                            data-testid="outside-superset-checkbox"
                                        />
                                        <Text
                                            size="2"
                                            weight={outsideSuperset ? 'medium' : 'regular'}
                                        >
                                            Outside of superset
                                        </Text>
                                        <Text size="1" color="gray">
                                            This catalog is curated, not exhaustive — check this if
                                            the item exists outside it.
                                        </Text>
                                    </Flex>
                                ) : null}
                            </Flex>
                        </Card>
                    ) : null}

                    <Card size="3">
                        <Flex direction="column" gap="3">
                            <Box>
                                <Text as="div" size="1" weight="medium" mb="1">
                                    Name <Text color="red">*</Text>
                                </Text>
                                <TextField.Root
                                    data-testid="item-name-input"
                                    size="2"
                                    placeholder="What is it?"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        setNameTouched(true);
                                    }}
                                    autoFocus={mode === 'create'}
                                    required
                                />
                            </Box>
                            <Flex gap="3" wrap="wrap">
                                <Box style={{ minWidth: 220, flexGrow: 1 }}>
                                    <Text as="div" size="1" weight="medium" mb="1">
                                        Collection
                                    </Text>
                                    {collections.length > 0 ? (
                                        <select
                                            data-testid="item-collection-select"
                                            value={collectionId}
                                            disabled={mode === 'edit'}
                                            onChange={(e) => setCollectionId(e.target.value)}
                                            style={{
                                                width: '100%',
                                                height: 'var(--TextField-height-2)',
                                            }}
                                        >
                                            {collections.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.emoji ?? '📦'} {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <Text size="2" color="red">
                                            Create a collection first.
                                        </Text>
                                    )}
                                    {mode === 'edit' ? (
                                        <Text as="div" size="1" color="gray" mt="1">
                                            Items stay in their collection —{' '}
                                            {activeTemplate?.name ?? 'no template'}.
                                        </Text>
                                    ) : null}
                                </Box>
                                <Box style={{ width: 160 }}>
                                    <Text as="div" size="1" weight="medium" mb="1">
                                        Quantity
                                    </Text>
                                    <TextField.Root
                                        data-testid="item-quantity-input"
                                        size="2"
                                        type="number"
                                        min={1}
                                        value={quantity}
                                        onChange={(e) =>
                                            setQuantity(
                                                Math.max(
                                                    1,
                                                    Number.parseInt(e.target.value || '1', 10),
                                                ),
                                            )
                                        }
                                    />
                                </Box>
                                <Flex align="center" gap="2" mt="4">
                                    <Switch
                                        checked={isFavorite}
                                        onCheckedChange={setIsFavorite}
                                        data-testid="item-favorite-input"
                                    />
                                    <Text size="2" color={isFavorite ? undefined : 'gray'}>
                                        Favorite
                                    </Text>
                                </Flex>
                            </Flex>
                        </Flex>
                    </Card>

                    {draftFields.length > 0 ? (
                        <Card size="3">
                            <Flex direction="column" gap="3">
                                <Flex align="center" gap="2">
                                    <Heading size="4">Details</Heading>
                                    <Badge color="iris" variant="soft">
                                        {activeTemplate?.name}
                                    </Badge>
                                </Flex>
                                {draftFields.map((field) => (
                                    <FieldInput
                                        key={field.id}
                                        field={{
                                            ...field,
                                            type: field.type as never,
                                            templateId: activeTemplate?.id ?? '',
                                        }}
                                        value={fieldValues[field.id] ?? null}
                                        onChange={(value) =>
                                            setFieldValues((current) => ({
                                                ...current,
                                                [field.id]: value,
                                            }))
                                        }
                                    />
                                ))}
                            </Flex>
                        </Card>
                    ) : null}

                    <Card size="3">
                        <Flex direction="column" gap="3">
                            <Heading size="4">Tags</Heading>
                            <Flex gap="2" wrap="wrap">
                                {tags.map((tag) => {
                                    const selected = selectedTags.includes(tag.id);
                                    return (
                                        <Badge
                                            key={tag.id}
                                            asChild
                                            variant={selected ? 'solid' : 'soft'}
                                            color={selected ? 'iris' : 'gray'}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <button
                                                type="button"
                                                data-testid={`tag-toggle-${slug(tag.name)}`}
                                                onClick={() =>
                                                    setSelectedTags((current) =>
                                                        selected
                                                            ? current.filter((t) => t !== tag.id)
                                                            : [...current, tag.id],
                                                    )
                                                }
                                            >
                                                {tag.name}
                                            </button>
                                        </Badge>
                                    );
                                })}
                                {tags.length === 0 ? (
                                    <Text size="2" color="gray">
                                        No tags yet — create one below.
                                    </Text>
                                ) : null}
                            </Flex>
                            <Flex gap="2">
                                <TextField.Root
                                    data-testid="new-tag-input"
                                    size="2"
                                    placeholder="New tag name…"
                                    value={newTag}
                                    onChange={(e) => setNewTag(e.target.value)}
                                    style={{ maxWidth: 220 }}
                                />
                                <Button
                                    type="button"
                                    variant="soft"
                                    onClick={addTag}
                                    data-testid="new-tag-button"
                                >
                                    <PlusIcon /> Add tag
                                </Button>
                            </Flex>
                        </Flex>
                    </Card>

                    {mode === 'create' ? (
                        <Card size="3">
                            <Flex direction="column" gap="3">
                                <Flex align="center" gap="2">
                                    <Heading size="4">Photos</Heading>
                                    {pendingPhotos.length > 0 ? (
                                        <Badge color="gray" variant="soft">
                                            {pendingPhotos.length} queued
                                        </Badge>
                                    ) : null}
                                </Flex>
                                <input
                                    ref={photosInput}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    hidden
                                    data-testid="form-photos-input"
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files ?? []);
                                        setPendingPhotos((current) => [...current, ...files]);
                                        e.target.value = '';
                                    }}
                                />
                                {pendingPhotos.length > 0 ? (
                                    <Flex gap="2" wrap="wrap">
                                        {pendingPhotos.map((file, index) => (
                                            <Box
                                                key={`${file.name}-${index}`}
                                                style={{
                                                    position: 'relative',
                                                    width: 84,
                                                    height: 84,
                                                    borderRadius: 'var(--radius-2)',
                                                    overflow: 'hidden',
                                                    border: '1px solid var(--gray-a5)',
                                                }}
                                            >
                                                <img
                                                    src={URL.createObjectURL(file)}
                                                    alt={file.name}
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        objectFit: 'cover',
                                                    }}
                                                />
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${file.name}`}
                                                    data-testid={`form-photo-remove-${index}`}
                                                    onClick={() =>
                                                        setPendingPhotos((current) =>
                                                            current.filter((_, i) => i !== index),
                                                        )
                                                    }
                                                    style={{
                                                        position: 'absolute',
                                                        top: 4,
                                                        right: 4,
                                                        width: 20,
                                                        height: 20,
                                                        borderRadius: '50%',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        background: 'var(--gray-a12)',
                                                        color: 'var(--gray-1)',
                                                    }}
                                                >
                                                    <Cross2Icon width={12} height={12} />
                                                </button>
                                            </Box>
                                        ))}
                                    </Flex>
                                ) : (
                                    <Text size="2" color="gray">
                                        Add photos now — they upload together with the item. You can
                                        also add or edit them later on the item page.
                                    </Text>
                                )}
                                <Box>
                                    <Button
                                        type="button"
                                        variant="soft"
                                        onClick={() => photosInput.current?.click()}
                                        data-testid="form-photos-button"
                                    >
                                        <PlusIcon /> Add photos
                                    </Button>
                                </Box>
                            </Flex>
                        </Card>
                    ) : null}

                    <Card size="3">
                        <Flex direction="column" gap="2">
                            <Heading size="4">Notes</Heading>
                            <TextArea
                                data-testid="item-notes-input"
                                rows={4}
                                placeholder="Anything worth remembering about this item…"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </Flex>
                    </Card>

                    <Flex gap="3" justify="end" align="center">
                        {matchRequired ? (
                            <Text size="1" color="gray">
                                Pick a catalog match above to enable saving.
                            </Text>
                        ) : needsCatalogMatch && !selectedEntry ? (
                            <Text size="1" color="gray">
                                Match the catalog or check “Outside of superset” to enable saving.
                            </Text>
                        ) : null}
                        <Button
                            type="button"
                            variant="soft"
                            color="gray"
                            onClick={() => navigate(-1)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!canSave} data-testid="save-item-button">
                            {saving ? <Spinner /> : mode === 'create' ? 'Add item' : 'Save changes'}
                        </Button>
                    </Flex>
                </Flex>
            </form>
        </Flex>
    );
}
