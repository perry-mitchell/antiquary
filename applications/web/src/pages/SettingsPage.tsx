import { useCallback, useEffect, useRef, useState } from 'react';
import {
    CheckIcon,
    ClockIcon,
    CopyIcon,
    DownloadIcon,
    GearIcon,
    LockClosedIcon,
    TrashIcon,
    UploadIcon,
} from '@radix-ui/react-icons';
import {
    Badge,
    Box,
    Button,
    Card,
    Flex,
    Heading,
    Spinner,
    Switch,
    Text,
    TextField,
} from '@radix-ui/themes';
import type { ApiKeyDto, ImportSummaryDto } from '@antiquary/database';
import { api } from '../api';
import { ConfirmDialog, EmptyState } from '../components/Dialogs';
import { useToast } from '../components/Toast';
import { formatDateTime, timeAgo } from '../lib/format';

export function SettingsPage() {
    const toast = useToast();
    const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
    const [name, setName] = useState('');
    const [readonly, setReadonly] = useState(false);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState<{ apiKey: ApiKeyDto; key: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);

    const load = useCallback(() => {
        api.settings.apiKeys
            .list()
            .then(setKeys)
            .catch(() => setKeys([]));
    }, []);

    useEffect(load, [load]);

    const create = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            const result = await api.settings.apiKeys.create({ name: name.trim(), readonly });
            setCreated(result);
            setCopied(false);
            setName('');
            toast({
                title: `Key "${result.apiKey.name}" created`,
                description: 'Copy it now — it is shown only once.',
                variant: 'success',
            });
            load();
        } catch (error) {
            toast({ title: 'Could not create key', description: String(error), variant: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const copyKey = async () => {
        if (!created) return;
        await navigator.clipboard.writeText(created.key);
        setCopied(true);
    };

    const revoke = async (key: ApiKeyDto) => {
        try {
            await api.settings.apiKeys.revoke(key.id);
            toast({ title: `Key "${key.name}" revoked`, variant: 'success' });
            load();
        } catch (error) {
            toast({ title: 'Could not revoke key', description: String(error), variant: 'error' });
        }
    };

    const runExport = async () => {
        setExporting(true);
        try {
            const { blob, filename } = await api.transfer.exportZip();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            toast({ title: 'Export failed', description: String(error), variant: 'error' });
        } finally {
            setExporting(false);
        }
    };

    const runImport = async (file: File) => {
        setImporting(true);
        try {
            const summary = await api.transfer.importZip(file);
            const parts = describeImport(summary);
            toast({
                title: 'Import complete',
                description: parts.length > 0 ? parts.join(', ') : 'Nothing new to import.',
                variant: 'success',
            });
        } catch (error) {
            toast({ title: 'Import failed', description: String(error), variant: 'error' });
        } finally {
            setImporting(false);
            if (importInputRef.current) importInputRef.current.value = '';
        }
    };

    return (
        <Flex direction="column" gap="5" maxWidth="820px">
            <Box>
                <Heading size="6">Settings</Heading>
                <Text as="div" size="2" color="gray">
                    Manage external access to your collection.
                </Text>
            </Box>

            <Card size="3">
                <Flex direction="column" gap="4">
                    <Box>
                        <Heading size="4">MCP access</Heading>
                        <Text as="div" size="2" color="gray" mt="1">
                            Let AI clients (Claude, Cursor, …) work with your collection over the
                            Model Context Protocol. Point them at{' '}
                            <Text as="span" weight="medium">
                                {typeof window !== 'undefined'
                                    ? `${window.location.origin}/mcp`
                                    : '/mcp'}
                            </Text>{' '}
                            with an API key below (as a Bearer token). Read-only keys are
                            non-destructive: the MCP API drops every deletion action for them.
                        </Text>
                    </Box>

                    <form onSubmit={create}>
                        <Flex gap="3" align="center" wrap="wrap">
                            <Box style={{ minWidth: 220, flexGrow: 1, maxWidth: 340 }}>
                                <TextField.Root
                                    data-testid="api-key-name-input"
                                    placeholder="Key name (e.g. Claude desktop)"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </Box>
                            <Flex align="center" gap="2">
                                <Switch
                                    checked={readonly}
                                    onCheckedChange={setReadonly}
                                    data-testid="api-key-readonly-input"
                                />
                                <Text size="2" color={readonly ? undefined : 'gray'}>
                                    <LockClosedIcon /> Read-only (non-destructive)
                                </Text>
                            </Flex>
                            <Button
                                type="submit"
                                disabled={saving || !name.trim()}
                                data-testid="api-key-create-button"
                            >
                                {saving ? <Spinner /> : null}
                                Create key
                            </Button>
                        </Flex>
                    </form>

                    {!keys ? (
                        <Spinner />
                    ) : keys.length === 0 ? (
                        <EmptyState
                            icon="🔑"
                            title="No API keys yet"
                            description="Create a key to connect an MCP client. Read-only keys can browse everything but cannot change or delete anything."
                        />
                    ) : (
                        <Flex direction="column" gap="2">
                            {keys.map((key) => (
                                <Flex
                                    key={key.id}
                                    align="center"
                                    gap="3"
                                    wrap="wrap"
                                    p="2"
                                    style={{
                                        border: '1px solid var(--gray-a5)',
                                        borderRadius: 'var(--radius-2)',
                                    }}
                                    data-testid="api-key-row"
                                >
                                    <GearIcon />
                                    <Text size="2" weight="medium">
                                        {key.name}
                                    </Text>
                                    <Badge
                                        color={
                                            key.revokedAt ? 'gray' : key.readonly ? 'blue' : 'amber'
                                        }
                                        variant="soft"
                                    >
                                        {key.revokedAt
                                            ? 'Revoked'
                                            : key.readonly
                                              ? 'Read-only'
                                              : 'Full access'}
                                    </Badge>
                                    <Text size="1" color="gray">
                                        created {timeAgo(key.createdAt)}
                                    </Text>
                                    <Text size="1" color="gray">
                                        <ClockIcon />{' '}
                                        {key.lastUsedAt
                                            ? `last used ${timeAgo(key.lastUsedAt)}`
                                            : 'never used'}
                                    </Text>
                                    <Box style={{ flexGrow: 1 }} />
                                    {!key.revokedAt ? (
                                        <ConfirmDialog
                                            title={`Revoke key "${key.name}"?`}
                                            description="Clients using this key immediately lose access. This cannot be undone."
                                            actionLabel="Revoke key"
                                            onConfirm={() => revoke(key)}
                                            trigger={
                                                <Button
                                                    size="1"
                                                    variant="soft"
                                                    color="red"
                                                    data-testid="api-key-revoke"
                                                >
                                                    <TrashIcon /> Revoke
                                                </Button>
                                            }
                                        />
                                    ) : null}
                                </Flex>
                            ))}
                        </Flex>
                    )}
                </Flex>
            </Card>

            <Card size="3" data-testid="transfer-card">
                <Flex direction="column" gap="4">
                    <Box>
                        <Heading size="4">Import &amp; export</Heading>
                        <Text as="div" size="2" color="gray" mt="1">
                            Back up everything — collections, templates, items and images — to a zip
                            archive, or restore one. Imports are idempotent: existing records are
                            matched by id and only updated, so importing the same archive twice
                            changes nothing. Unrecognised content is ignored.
                        </Text>
                    </Box>
                    <Flex gap="3" align="center" wrap="wrap">
                        <Button
                            onClick={runExport}
                            disabled={exporting || importing}
                            data-testid="export-button"
                        >
                            {exporting ? <Spinner /> : <DownloadIcon />}
                            {exporting ? 'Preparing export…' : 'Export everything'}
                        </Button>
                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            hidden
                            data-testid="import-input"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void runImport(file);
                            }}
                        />
                        <Button
                            variant="soft"
                            onClick={() => importInputRef.current?.click()}
                            disabled={exporting || importing}
                            data-testid="import-button"
                        >
                            {importing ? <Spinner /> : <UploadIcon />}
                            {importing ? 'Importing…' : 'Import archive'}
                        </Button>
                    </Flex>
                </Flex>
            </Card>

            {created ? (
                <Card
                    size="3"
                    style={{ borderColor: 'var(--amber-9)' }}
                    data-testid="api-key-dialog"
                >
                    <Flex direction="column" gap="3">
                        <Flex align="center" gap="2">
                            <Heading size="4">Copy your key now</Heading>
                            <Badge color="amber">Shown only once</Badge>
                        </Flex>
                        <Text size="2" color="gray">
                            This is the only time the full key for “{created.apiKey.name}” is
                            displayed. It is stored hashed and cannot be recovered.
                        </Text>
                        <Flex gap="2" align="center" wrap="wrap">
                            <Box
                                p="2"
                                style={{
                                    fontFamily: 'var(--code-font-family, monospace)',
                                    fontSize: 12,
                                    background: 'var(--gray-a3)',
                                    borderRadius: 'var(--radius-2)',
                                    wordBreak: 'break-all',
                                    flexGrow: 1,
                                    minWidth: 260,
                                }}
                                data-testid="api-key-value"
                            >
                                {created.key}
                            </Box>
                            <Button onClick={copyKey} data-testid="api-key-copy">
                                {copied ? <CheckIcon /> : <CopyIcon />}
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                            <Button
                                variant="soft"
                                color="gray"
                                onClick={() => setCreated(null)}
                                data-testid="api-key-dismiss"
                            >
                                Done
                            </Button>
                        </Flex>
                        <Text size="1" color="gray">
                            Use it as a Bearer token:{' '}
                            <code>Authorization: Bearer {created.key.slice(0, 12)}…</code> (created{' '}
                            {formatDateTime(created.apiKey.createdAt)})
                        </Text>
                    </Flex>
                </Card>
            ) : null}
        </Flex>
    );
}

function describeImport(summary: ImportSummaryDto): string[] {
    return (
        [
            ['collections', summary.collections, 'collection'],
            ['items', summary.items, 'item'],
            ['templates', summary.templates, 'template'],
            ['images', summary.images, 'image'],
            ['tags', summary.tags, 'tag'],
        ] as const
    )
        .filter(([, count]) => count > 0)
        .map(([, count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`);
}
