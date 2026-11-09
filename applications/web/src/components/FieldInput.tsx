import { useRef, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Dialog,
  Flex,
  Select,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes'
import type { FieldValue, TemplateFieldDto } from '@antiquary/database'
import { StarRating } from './StarRating'
import { CURRENCIES, formatPrice, isPriceValue, slug } from '../lib/format'
import { api } from '../api'

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateFieldDto
  value: FieldValue
  onChange: (value: FieldValue) => void
}) {
  const testId = `field-input-${slug(field.name)}`
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const label = (
    <Text as="div" size="1" weight="medium" mb="1">
      {field.name}
      {field.required ? (
        <Text color="red" ml="1">
          *
        </Text>
      ) : null}
    </Text>
  )

  const uploadImage = async (file: File) => {
    setUploading(true)
    try {
      const uploaded = await api.images.uploadStandalone(file)
      onChange(uploaded.url)
    } finally {
      setUploading(false)
    }
  }

  switch (field.type) {
    case 'text':
      return (
        <Box>
          {label}
          <TextField.Root
            data-testid={testId}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      )
    case 'textarea':
      return (
        <Box>
          {label}
          <TextArea
            data-testid={testId}
            rows={3}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      )
    case 'number':
      return (
        <Box>
          {label}
          <TextField.Root
            data-testid={testId}
            type="number"
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => {
              const parsed = Number.parseFloat(e.target.value)
              onChange(e.target.value === '' || Number.isNaN(parsed) ? null : parsed)
            }}
          />
        </Box>
      )
    case 'date':
      return (
        <Box>
          {label}
          <TextField.Root
            data-testid={testId}
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      )
    case 'url':
      return (
        <Box>
          {label}
          <TextField.Root
            data-testid={testId}
            type="url"
            placeholder="https://…"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </Box>
      )
    case 'select':
      return (
        <Box>
          {label}
          <Select.Root
            value={typeof value === 'string' && value !== '' ? value : undefined}
            onValueChange={onChange}
          >
            <Select.Trigger
              data-testid={testId}
              placeholder="Pick one…"
              style={{ width: '100%' }}
            />
            <Select.Content>
              {(field.options ?? []).map((option) => (
                <Select.Item key={option} value={option}>
                  {option}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
      )
    case 'rating':
      return (
        <Box>
          {label}
          <StarRating value={typeof value === 'number' ? value : 0} onChange={onChange} />
        </Box>
      )
    case 'checkbox':
      return (
        <Flex align="center" gap="2" mt="3">
          <Checkbox
            data-testid={testId}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Text size="2">{field.name}</Text>
        </Flex>
      )
    case 'image':
      return (
        <Box>
          {label}
          {typeof value === 'string' && value !== '' ? (
            <Box mb="2">
              <img
                src={value}
                alt={field.name}
                data-testid={`field-image-${slug(field.name)}`}
                style={{
                  maxHeight: 120,
                  maxWidth: '100%',
                  objectFit: 'contain',
                  borderRadius: 'var(--radius-2)',
                  border: '1px solid var(--gray-a5)',
                }}
              />
            </Box>
          ) : null}
          <Flex gap="2" align="center">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              data-testid={testId}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadImage(file)
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              size="1"
              variant="soft"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Spinner /> : null}
              {value ? 'Replace image' : 'Upload image'}
            </Button>
            {typeof value === 'string' && value !== '' ? (
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                onClick={() => onChange(null)}
              >
                Remove
              </Button>
            ) : null}
          </Flex>
        </Box>
      )
    case 'price': {
      const price = isPriceValue(value) ? value : null
      const setPrice = (next: { amount: number; currency: string } | null) => onChange(next)
      return (
        <Box>
          {label}
          <Flex gap="2" align="center">
            <TextField.Root
              data-testid={testId}
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              style={{ width: 150 }}
              value={price ? String(price.amount) : ''}
              onChange={(e) => {
                const raw = e.target.value
                const amount = Number.parseFloat(raw)
                setPrice(
                  raw === '' || Number.isNaN(amount)
                    ? null
                    : { amount, currency: price?.currency ?? 'EUR' },
                )
              }}
            />
            <select
              data-testid={`field-currency-${slug(field.name)}`}
              aria-label={`${field.name} currency`}
              value={price?.currency ?? 'EUR'}
              onChange={(e) => {
                if (price) setPrice({ ...price, currency: e.target.value })
              }}
              style={{ height: 'var(--TextField-height-2)', minWidth: 90 }}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Flex>
        </Box>
      )
    }
  }
}

export function FieldValueBadge({
  type,
  value,
}: {
  type: TemplateFieldDto['type']
  value: FieldValue
}) {
  if (type === 'rating') {
    return <StarRating value={typeof value === 'number' ? value : 0} />
  }
  if (type === 'price') {
    if (!isPriceValue(value)) {
      return (
        <Text size="2" color="gray">
          —
        </Text>
      )
    }
    return (
      <Text size="2" weight="medium">
        {formatPrice(value)}
      </Text>
    )
  }
  if (type === 'image') {
    if (typeof value !== 'string' || value === '') {
      return (
        <Text size="2" color="gray">
          —
        </Text>
      )
    }
    return (
      <Dialog.Root>
        <Dialog.Trigger>
          <img
            src={value}
            alt=""
            data-testid="field-image"
            style={{
              maxHeight: 88,
              maxWidth: '100%',
              objectFit: 'contain',
              borderRadius: 'var(--radius-2)',
              cursor: 'zoom-in',
            }}
          />
        </Dialog.Trigger>
        <Dialog.Content maxWidth="840px" aria-label="Image">
          <img
            src={value}
            alt=""
            data-testid="field-image-dialog"
            style={{ width: '100%', height: 'auto', borderRadius: 'var(--radius-2)' }}
          />
          <Flex justify="end" mt="3">
            <Dialog.Close>
              <Button variant="soft" color="gray" data-testid="field-image-close">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    )
  }
  if (type === 'checkbox') {
    return (
      <Badge color={value ? 'green' : 'gray'} variant="soft">
        {value ? 'Yes' : 'No'}
      </Badge>
    )
  }
  if (value === null || value === undefined || value === '') {
    return (
      <Text size="2" color="gray">
        —
      </Text>
    )
  }
  return <Text size="2">{String(value)}</Text>
}
