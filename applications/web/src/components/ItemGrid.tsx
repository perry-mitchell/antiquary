import { Link } from 'react-router-dom'
import { StarFilledIcon, StarIcon } from '@radix-ui/react-icons'
import { Badge, Box, Card, Flex, IconButton, Inset, Text } from '@radix-ui/themes'
import type { ItemListItemDto } from '@antiquary/database'
import { useToast } from './Toast'
import { api } from '../api'
import { timeAgo } from '../lib/format'

export function ItemCard({
  item,
  onChanged,
}: {
  item: ItemListItemDto
  onChanged?: (item: ItemListItemDto) => void
}) {
  const toast = useToast()

  const toggleFavorite = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      const updated = await api.items.update(item.id, { isFavorite: !item.isFavorite })
      onChanged?.({ ...item, isFavorite: updated.isFavorite })
    } catch (error) {
      toast({ title: 'Could not update favorite', description: String(error), variant: 'error' })
    }
  }

  return (
    <Card size="1" asChild style={{ overflow: 'hidden' }}>
      <Link to={`/items/${item.id}`} style={{ textDecoration: 'none' }} data-testid="item-card">
        <Inset clip="padding-box" side="top">
          <Box
            style={{
              aspectRatio: '4 / 3',
              background: 'var(--gray-a3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              position: 'relative',
            }}
          >
            {item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt={item.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span>{item.collectionEmoji ?? '📦'}</span>
            )}
            <Box position="absolute" top="2" right="2">
              <IconButton
                size="1"
                variant={item.isFavorite ? 'solid' : 'soft'}
                color={item.isFavorite ? 'amber' : 'gray'}
                highContrast
                onClick={toggleFavorite}
                aria-label={item.isFavorite ? 'Remove favorite' : 'Mark favorite'}
                data-testid="item-favorite"
              >
                {item.isFavorite ? <StarFilledIcon /> : <StarIcon />}
              </IconButton>
            </Box>
          </Box>
        </Inset>
        <Flex direction="column" gap="1" p="2">
          <Text as="div" size="2" weight="medium" className="clamp-2">
            {item.name}
          </Text>
          <Flex align="center" gap="2" wrap="wrap">
            {item.quantity > 1 ? <Badge color="gray">×{item.quantity}</Badge> : null}
            {item.tags.slice(0, 2).map((tag) => (
              <Badge key={tag.id} color="indigo" variant="soft">
                {tag.name}
              </Badge>
            ))}
          </Flex>
          <Text as="div" size="1" color="gray">
            added {timeAgo(item.createdAt)}
          </Text>
        </Flex>
      </Link>
    </Card>
  )
}
export function ItemGrid({
  items,
  onChanged,
}: {
  items: ItemListItemDto[]
  onChanged?: (item: ItemListItemDto) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--space-3)',
      }}
      data-testid="items-grid"
    >
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onChanged={onChanged} />
      ))}
    </div>
  )
}
