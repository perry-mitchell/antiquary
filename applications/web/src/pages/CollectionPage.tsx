import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  GearIcon,
} from '@radix-ui/react-icons'
import {
  Badge,
  Box,
  Button,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Progress,
  Select,
  Skeleton,
  Switch,
  Text,
  TextField,
} from '@radix-ui/themes'
import type { CollectionDto, ItemListItemDto, ItemListResultDto, TagDto } from '@antiquary/database'
import { api } from '../api'
import { CollectionDialog, ConfirmDialog, EmptyState } from '../components/Dialogs'
import { ItemGrid } from '../components/ItemGrid'
import { useToast } from '../components/Toast'

const PAGE_SIZE = 24

export function CollectionPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [collection, setCollection] = useState<CollectionDto | null>(null)
  const [missing, setMissing] = useState(false)
  const [result, setResult] = useState<ItemListResultDto | null>(null)
  const [tags, setTags] = useState<TagDto[]>([])

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'created' | 'updated' | 'name'>('created')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [favorite, setFavorite] = useState(false)
  const [tagId, setTagId] = useState<string>('')
  const [page, setPage] = useState(1)
  const [editOpen, setEditOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchInput])

  useEffect(() => {
    api.collections
      .get(id)
      .then(setCollection)
      .catch(() => setMissing(true))
    api.tags
      .list()
      .then(setTags)
      .catch(() => {})
  }, [id])

  useEffect(() => {
    setPage(1)
  }, [favorite, tagId, sort, order])

  const loadItems = useCallback(async () => {
    const res = await api.items.list({
      collectionId: id,
      search,
      sort,
      order,
      favorite,
      tagId: tagId || undefined,
      page,
      limit: PAGE_SIZE,
    })
    setResult(res)
  }, [id, search, sort, order, favorite, tagId, page])

  useEffect(() => {
    loadItems().catch((error) =>
      toast({ title: 'Could not load items', description: String(error), variant: 'error' }),
    )
  }, [loadItems, toast])

  const items: ItemListItemDto[] = useMemo(() => result?.items ?? [], [result])

  if (missing) {
    return (
      <EmptyState
        icon="🕵️"
        title="Collection not found"
        description="It may have been moved to the trash."
        action={
          <Button variant="soft" onClick={() => navigate('/')}>
            Back home
          </Button>
        }
      />
    )
  }

  if (!collection) {
    return <Skeleton style={{ height: 300 }} />
  }

  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE))

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" gap="3" wrap="wrap">
        <Text style={{ fontSize: 40, lineHeight: 1 }}>{collection.emoji ?? '📦'}</Text>
        <Box style={{ flexGrow: 1 }}>
          <Flex align="center" gap="2">
            <Heading size="6" data-testid="collection-title">
              {collection.name}
            </Heading>
            <Badge color="iris" variant="soft">
              {result?.total ?? collection.itemCount} item
              {(result?.total ?? collection.itemCount) === 1 ? '' : 's'}
            </Badge>
          </Flex>
          {collection.description ? (
            <Text as="div" size="2" color="gray">
              {collection.description}
            </Text>
          ) : null}
          {collection.completion ? (
            <Flex
              align="center"
              gap="3"
              mt="2"
              style={{ maxWidth: 360 }}
              data-testid="collection-completion"
            >
              <Progress value={collection.completion.percent} size="1" style={{ flexGrow: 1 }} />
              <Text
                size="1"
                color="gray"
                style={{ whiteSpace: 'nowrap' }}
                data-testid="collection-completion-text"
              >
                {collection.completion.owned} / {collection.completion.total} titles ·{' '}
                {collection.completion.percent}%
              </Text>
            </Flex>
          ) : null}
        </Box>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              variant="soft"
              aria-label="Collection actions"
              data-testid="collection-menu"
            >
              <GearIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              data-testid="edit-collection-item"
              onSelect={() => setEditOpen(true)}
            >
              Edit details
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              color="red"
              data-testid="delete-collection-item"
              onSelect={() => setTrashOpen(true)}
            >
              <TrashIcon /> Move to trash
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        {/* Dialogs live outside the dropdown so closing the menu cannot
            interrupt their exit animation (which leaves a blocking overlay). */}
        <CollectionDialog
          collection={collection}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={setCollection}
        />
        <ConfirmDialog
          title={`Move "${collection.name}" to trash?`}
          description="The collection and all of its items will be moved to the trash. You can restore them at any time."
          actionLabel="Move to trash"
          testId="confirm-delete-collection"
          open={trashOpen}
          onOpenChange={setTrashOpen}
          onConfirm={async () => {
            try {
              await api.collections.remove(collection.id)
              toast({
                title: 'Collection moved to trash',
                description: 'Restore it any time from the Trash page.',
                variant: 'success',
              })
              navigate('/')
            } catch (error) {
              toast({
                title: 'Could not delete collection',
                description: String(error),
                variant: 'error',
              })
            }
          }}
        />
        <Button
          data-testid="add-item-button"
          onClick={() => navigate(`/items/new?collection=${collection.id}`)}
        >
          <PlusIcon /> Add item
        </Button>
      </Flex>

      {collection.itemCount > 0 || search ? (
        <Flex gap="3" align="center" wrap="wrap">
          <TextField.Root
            data-testid="collection-search"
            size="2"
            placeholder="Search this collection…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ flex: '0 1 240px' }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon />
            </TextField.Slot>
          </TextField.Root>
          <Select.Root
            value={`${sort}:${order}`}
            onValueChange={(v) => {
              const [nextSort, nextOrder] = v.split(':') as [
                'created' | 'updated' | 'name',
                'asc' | 'desc',
              ]
              setSort(nextSort)
              setOrder(nextOrder)
            }}
          >
            <Select.Trigger
              variant="soft"
              data-testid="collection-sort"
              style={{ minWidth: 150 }}
            />
            <Select.Content>
              <Select.Item value="created:desc">Newest first</Select.Item>
              <Select.Item value="created:asc">Oldest first</Select.Item>
              <Select.Item value="name:asc">Name A → Z</Select.Item>
              <Select.Item value="name:desc">Name Z → A</Select.Item>
              <Select.Item value="updated:desc">Recently updated</Select.Item>
            </Select.Content>
          </Select.Root>
          <Flex align="center" gap="2">
            <Switch checked={favorite} onCheckedChange={setFavorite} data-testid="favorites-only" />
            <Text size="2" color={favorite ? undefined : 'gray'}>
              <StarIcon /> Favorites
            </Text>
          </Flex>
          {tags.length > 0 ? (
            <Select.Root value={tagId} onValueChange={setTagId} size="2">
              <Select.Trigger
                variant="soft"
                placeholder="All tags"
                data-testid="tag-filter"
                style={{ minWidth: 130 }}
              />
              <Select.Content>
                <Select.Item value="">All tags</Select.Item>
                {tags.map((tag) => (
                  <Select.Item key={tag.id} value={tag.id}>
                    {tag.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          ) : null}
        </Flex>
      ) : null}

      {items.length === 0 ? (
        result && (search || favorite || tagId) ? (
          <EmptyState
            icon="🔍"
            title="No matching items"
            description="Try a different search, or clear the filters."
            action={
              <Button
                variant="soft"
                onClick={() => {
                  setSearchInput('')
                  setSearch('')
                  setFavorite(false)
                  setTagId('')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={collection.emoji ?? '📦'}
            title="No items yet"
            description="Add your first item to this collection. You can pick a template to give it custom fields."
            action={
              <Button
                data-testid="empty-add-item"
                onClick={() => navigate(`/items/new?collection=${collection.id}`)}
              >
                <PlusIcon /> Add your first item
              </Button>
            }
          />
        )
      ) : (
        <ItemGrid items={items} onChanged={() => loadItems()} />
      )}

      {totalPages > 1 ? (
        <Flex align="center" gap="3" justify="center">
          <IconButton
            variant="soft"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Text size="2" color="gray">
            Page {page} of {totalPages} · {result?.total ?? 0} items
          </Text>
          <IconButton
            variant="soft"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRightIcon />
          </IconButton>
        </Flex>
      ) : null}
    </Flex>
  )
}

export function NotFoundPage() {
  return (
    <EmptyState
      icon="🧭"
      title="Page not found"
      description="The page you were looking for does not exist."
      action={
        <Link to="/">
          <Button variant="soft">Back home</Button>
        </Link>
      }
    />
  )
}
