import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  Button,
  Flex,
  Heading,
  Text,
  TextField,
  TextArea,
  Box,
  Spinner,
} from '@radix-ui/themes'
import { useToast } from './Toast'
import { api } from '../api'
import type { CollectionDto, TemplateDetailDto } from '@antiquary/database'

const EMOJI_CHOICES = [
  '📚',
  '🎵',
  '🎮',
  '🎬',
  '🏷️',
  '🪙',
  '🕹️',
  '🎨',
  '📷',
  '🍺',
  '🌱',
  '🏆',
  '🚗',
  '⌚',
  '🎸',
  '🧩',
]
const COLOR_CHOICES = [
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#4f46e5',
]

export function CollectionDialog({
  collection,
  trigger,
  onSaved,
}: {
  collection?: CollectionDto
  trigger: ReactNode
  onSaved?: (collection: CollectionDto) => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [emoji, setEmoji] = useState(collection?.emoji ?? '📚')
  const [color, setColor] = useState(collection?.color ?? COLOR_CHOICES[0]!)
  const [templateId, setTemplateId] = useState(collection?.templateId ?? '')
  const [templates, setTemplates] = useState<TemplateDetailDto[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    api.templates
      .list()
      .then(setTemplates)
      .catch(() => {})
  }, [open])

  const reset = () => {
    setName(collection?.name ?? '')
    setDescription(collection?.description ?? '')
    setEmoji(collection?.emoji ?? '📚')
    setColor(collection?.color ?? COLOR_CHOICES[0]!)
    setTemplateId(collection?.templateId ?? '')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        emoji: emoji || null,
        color,
        templateId: templateId || null,
      }
      const saved = collection
        ? await api.collections.update(collection.id, body)
        : await api.collections.create(body)
      toast({
        title: collection ? 'Collection updated' : `Collection "${saved.name}" created`,
        variant: 'success',
      })
      setOpen(false)
      onSaved?.(saved)
    } catch (error) {
      toast({ title: 'Could not save collection', description: String(error), variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <AlertDialog.Trigger>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Content style={{ maxWidth: 480 }} data-testid="collection-form">
        <AlertDialog.Title>{collection ? 'Edit collection' : 'New collection'}</AlertDialog.Title>
        <AlertDialog.Description size="2" color="gray">
          A collection holds your items. Give it a name, an icon and a color.
        </AlertDialog.Description>
        <form onSubmit={submit}>
          <Box mt="4">
            <label>
              <Text as="div" size="1" weight="medium" mb="1">
                Name
              </Text>
              <TextField.Root
                data-testid="collection-name-input"
                placeholder="Books, vinyl, board games…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </label>
          </Box>
          <Box mt="3">
            <Text as="div" size="1" weight="medium" mb="1">
              Icon
            </Text>
            <Flex gap="2" wrap="wrap">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  data-testid={`emoji-${choice}`}
                  style={{
                    fontSize: 20,
                    cursor: 'pointer',
                    lineHeight: 1,
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-2)',
                    border:
                      emoji === choice ? '2px solid var(--accent-9)' : '1px solid var(--gray-a5)',
                    background: 'var(--color-panel-solid)',
                  }}
                  onClick={() => setEmoji(choice)}
                >
                  {choice}
                </button>
              ))}
            </Flex>
          </Box>
          <Box mt="3">
            <Text as="div" size="1" weight="medium" mb="1">
              Color
            </Text>
            <Flex gap="2">
              {COLOR_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-label={`Use color ${choice}`}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: choice,
                    cursor: 'pointer',
                    border: 'none',
                    outline: color === choice ? '2px solid var(--gray-12)' : 'none',
                    outlineOffset: 2,
                  }}
                  onClick={() => setColor(choice)}
                />
              ))}
            </Flex>
          </Box>
          <Box mt="3">
            <Text as="div" size="1" weight="medium" mb="1">
              Default template <Text color="gray">(optional)</Text>
            </Text>
            {templates.length > 0 ? (
              <select
                data-testid="collection-template-select"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                style={{ width: '100%', height: 'var(--TextField-height-2)' }}
              >
                <option value="">Ask me for each item</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.superset ? ' ⋆ catalog' : ''} ({t.fields.length} fields)
                  </option>
                ))}
              </select>
            ) : (
              <Text size="1" color="gray">
                No templates yet — create one on the Templates page to prefill item fields.
              </Text>
            )}
          </Box>
          <Box mt="3">
            <Text as="div" size="1" weight="medium" mb="1">
              Description <Text color="gray">(optional)</Text>
            </Text>
            <TextArea
              data-testid="collection-description-input"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What belongs in this collection?"
            />
          </Box>
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" type="button">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button type="submit" disabled={saving} data-testid="collection-save-button">
              {saving ? <Spinner /> : collection ? 'Save changes' : 'Create collection'}
            </Button>
          </Flex>
        </form>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  actionLabel,
  onConfirm,
  danger = true,
  testId,
}: {
  trigger: ReactNode
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void> | void
  danger?: boolean
  testId?: string
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Content style={{ maxWidth: 420 }}>
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{description}</AlertDialog.Description>
        <Flex gap="3" justify="end" mt="4">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button
            color={danger ? 'red' : undefined}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
            data-testid={testId}
          >
            {busy ? <Spinner /> : actionLabel}
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Flex direction="column" align="center" gap="3" py="9" data-testid="empty-state">
      <Text style={{ fontSize: 44 }}>{icon}</Text>
      <Heading size="4">{title}</Heading>
      <Text as="div" size="2" color="gray" align="center" style={{ maxWidth: 420 }}>
        {description}
      </Text>
      {action ? <Box mt="2">{action}</Box> : null}
    </Flex>
  )
}
