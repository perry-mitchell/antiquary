import type { FieldValue, FieldType, HistoryChange, PriceValue } from '@antiquary/database'

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'url',
  'select',
  'rating',
  'checkbox',
  'image',
  'price',
] as const

export type { FieldType }

/** Currencies offered next to price fields (per item, chosen at entry time). */
export const CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'JPY',
  'CNY',
  'INR',
  'CAD',
  'AUD',
] as const

export function isPriceValue(value: unknown): value is PriceValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as PriceValue).amount === 'number' &&
    typeof (value as PriceValue).currency === 'string'
  )
}

export function formatPrice(value: PriceValue): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency }).format(
      value.amount,
    )
  } catch {
    return `${value.amount.toFixed(2)} ${value.currency}`
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function formatDate(value: string): string {
  return dateFmt.format(new Date(value))
}

export function formatDateTime(value: string): string {
  return dateTimeFmt.format(new Date(value))
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 30) return `${Math.floor(days)}d ago`
  return formatDate(iso)
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function formatFieldValue(type: FieldType, value: FieldValue): string {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'price' && isPriceValue(value)) return formatPrice(value)
  switch (type) {
    case 'date':
      return formatDate(String(value))
    case 'checkbox':
      return value ? 'Yes' : 'No'
    default:
      return String(value)
  }
}

export function formatChangeValue(change: HistoryChange, key: 'from' | 'to'): string {
  const value = change[key]
  if (value === null || value === undefined || value === '') return '∅'
  if (isPriceValue(value)) return formatPrice(value)
  return String(value)
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  url: 'URL',
  select: 'Choice',
  rating: 'Rating (1–5)',
  checkbox: 'Yes / No',
  image: 'Image',
  price: 'Price',
}
