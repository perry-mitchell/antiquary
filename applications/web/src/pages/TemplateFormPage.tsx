import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowDownIcon, ArrowUpIcon, Cross2Icon, PlusIcon } from '@radix-ui/react-icons'
import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Flex,
  Heading,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import type { FieldType } from '@antiquary/database'
import { api } from '../api'
import { useToast } from '../components/Toast'
import { FIELD_TYPES, FIELD_TYPE_LABELS } from '../lib/format'

interface DraftField {
  id?: string
  name: string
  type: FieldType
  options: string
  required: boolean
}

const EMPTY_FIELD: DraftField = { name: '', type: 'text', options: '', required: false }

export function TemplateFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [superset, setSuperset] = useState('')
  const [supersetOptions, setSupersetOptions] = useState<
    { key: string; name: string; titleCount: number; complete: boolean }[]
  >([])
  const [fields, setFields] = useState<DraftField[]>([{ ...EMPTY_FIELD }])
  const [loading, setLoading] = useState(mode === 'edit')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.supersets
      .list()
      .then((list) =>
        setSupersetOptions(
          list.map((s) => ({
            key: s.key,
            name: s.name,
            titleCount: s.titleCount,
            complete: s.complete,
          })),
        ),
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (mode !== 'edit') return
    api.templates
      .get(id)
      .then((template) => {
        setName(template.name)
        setDescription(template.description ?? '')
        setSuperset(template.superset ?? '')
        setFields(
          template.fields.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            options: (f.options ?? []).join(', '),
            required: f.required,
          })),
        )
        setLoading(false)
      })
      .catch(() => {
        toast({ title: 'Template not found', variant: 'error' })
        navigate('/templates')
      })
  }, [id, mode, navigate, toast])

  if (loading) {
    return (
      <Flex align="center" justify="center" py="9">
        <Spinner size="3" />
      </Flex>
    )
  }

  const updateField = (index: number, patch: Partial<DraftField>) => {
    setFields((current) => current.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  const moveField = (index: number, delta: number) => {
    setFields((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const cleanFields = fields
      .map((f) => ({
        id: f.id,
        name: f.name.trim(),
        type: f.type,
        options:
          f.type === 'select'
            ? f.options
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : null,
        required: f.required,
      }))
      .filter((f) => f.name.length > 0)
    if (cleanFields.some((f) => f.type === 'select' && (f.options ?? []).length === 0)) {
      toast({
        title: 'Choice fields need at least one option',
        description: 'Separate options with commas, e.g. "Mint, Good, Fair".',
        variant: 'error',
      })
      return
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        superset: superset || null,
        fields: cleanFields,
      }
      const saved =
        mode === 'create' ? await api.templates.create(body) : await api.templates.update(id, body)
      toast({ title: `Template "${saved.name}" saved`, variant: 'success' })
      navigate('/templates')
    } catch (error) {
      toast({ title: 'Could not save template', description: String(error), variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Flex direction="column" gap="4" maxWidth="820px" mx="auto" as="div">
      <Heading size="6">{mode === 'create' ? 'New template' : 'Edit template'}</Heading>
      <Text as="div" size="2" color="gray">
        Build the set of fields once, then reuse it for every item in a collection.
      </Text>

      <form onSubmit={submit}>
        <Flex direction="column" gap="4">
          <Card size="3">
            <Flex direction="column" gap="3">
              <Box>
                <Text as="div" size="1" weight="medium" mb="1">
                  Name <Text color="red">*</Text>
                </Text>
                <TextField.Root
                  data-testid="template-name-input"
                  placeholder="e.g. Book details"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus={mode === 'create'}
                  required
                />
              </Box>
              <Box>
                <Text as="div" size="1" weight="medium" mb="1">
                  Superset catalog (optional)
                </Text>
                <select
                  data-testid="template-superset-select"
                  value={superset}
                  onChange={(e) => setSuperset(e.target.value)}
                  style={{ width: '100%', height: 'var(--TextField-height-2)' }}
                >
                  <option value="">None — plain custom fields</option>
                  {supersetOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.name} ({option.titleCount} titles)
                      {option.complete ? '' : ' — not exhaustive'}
                    </option>
                  ))}
                </select>
                <Text as="div" size="1" color="gray" mt="1">
                  {superset
                    ? supersetOptions.find((s) => s.key === superset)?.complete === false
                      ? 'Items match catalog entries when possible; since this catalog is curated rather than exhaustive, items can also be explicitly marked as outside it.'
                      : 'Items using this template must match a catalog entry when created. Fields for Region, Serial, Developer, Publisher, Genre and Year are added automatically if missing.'
                    : 'Pick a catalog to match items against known titles and variants.'}
                </Text>
              </Box>
              <Box>
                <Text as="div" size="1" weight="medium" mb="1">
                  Description (optional)
                </Text>
                <TextArea
                  data-testid="template-description-input"
                  rows={2}
                  placeholder="What is this template for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Box>
            </Flex>
          </Card>

          <Card size="3">
            <Flex direction="column" gap="3">
              <Flex align="center" gap="2">
                <Heading size="4">Fields</Heading>
                <Badge color="gray" variant="soft">
                  {fields.filter((f) => f.name.trim()).length}
                </Badge>
              </Flex>
              {fields.map((field, index) => (
                <Flex
                  key={index}
                  direction="column"
                  gap="2"
                  p="3"
                  style={{ border: '1px solid var(--gray-a5)', borderRadius: 'var(--radius-3)' }}
                  data-testid="template-field-row"
                >
                  <Flex gap="2" align="center" wrap="wrap">
                    <Box style={{ flexGrow: 1, minWidth: 180 }}>
                      <TextField.Root
                        data-testid={`field-name-${index}`}
                        size="2"
                        placeholder="Field name (e.g. Author)"
                        value={field.name}
                        onChange={(e) => updateField(index, { name: e.target.value })}
                      />
                    </Box>
                    <select
                      data-testid={`field-type-${index}`}
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
                      style={{ height: 'var(--TextField-height-2)' }}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {FIELD_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <Flex align="center" gap="2" px="2">
                      <Checkbox
                        checked={field.required}
                        onCheckedChange={(checked) =>
                          updateField(index, { required: checked === true })
                        }
                        data-testid={`field-required-${index}`}
                      />
                      <Text size="2" color="gray">
                        Required
                      </Text>
                    </Flex>
                    <Flex gap="1">
                      <Button
                        type="button"
                        variant="soft"
                        color="gray"
                        size="1"
                        onClick={() => moveField(index, -1)}
                        aria-label="Move up"
                        disabled={index === 0}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="soft"
                        color="gray"
                        size="1"
                        onClick={() => moveField(index, 1)}
                        aria-label="Move down"
                        disabled={index === fields.length - 1}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="soft"
                        color="red"
                        size="1"
                        onClick={() =>
                          setFields((current) => current.filter((_, i) => i !== index))
                        }
                        aria-label="Remove field"
                        data-testid={`field-remove-${index}`}
                        disabled={fields.length === 1}
                      >
                        <Cross2Icon />
                      </Button>
                    </Flex>
                  </Flex>
                  {field.type === 'select' ? (
                    <Box>
                      <Text as="div" size="1" color="gray" mb="1">
                        Options, separated by commas
                      </Text>
                      <TextField.Root
                        data-testid={`field-options-${index}`}
                        size="2"
                        placeholder="Mint, Near mint, Good, Fair"
                        value={field.options}
                        onChange={(e) => updateField(index, { options: e.target.value })}
                      />
                    </Box>
                  ) : null}
                </Flex>
              ))}
              <Button
                type="button"
                variant="soft"
                onClick={() => setFields((current) => [...current, { ...EMPTY_FIELD }])}
                data-testid="add-field-button"
              >
                <PlusIcon /> Add field
              </Button>
            </Flex>
          </Card>

          <Flex gap="3" justify="end">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => navigate('/templates')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} data-testid="save-template-button">
              {saving ? <Spinner /> : mode === 'create' ? 'Create template' : 'Save changes'}
            </Button>
          </Flex>
        </Flex>
      </form>
    </Flex>
  )
}
