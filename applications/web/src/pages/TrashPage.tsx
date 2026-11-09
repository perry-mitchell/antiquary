import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResetIcon, TrashIcon } from '@radix-ui/react-icons'
import { Badge, Box, Button, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes'
import type { TrashDto } from '@antiquary/database'
import { api } from '../api'
import { ConfirmDialog, EmptyState } from '../components/Dialogs'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../lib/format'

export function TrashPage() {
  const toast = useToast()
  const [trash, setTrash] = useState<TrashDto | null>(null)

  const load = useCallback(() => {
    api
      .trash()
      .then(setTrash)
      .catch(() => setTrash({ items: [], collections: [] }))
  }, [])

  useEffect(load, [load])

  if (!trash) return <Skeleton style={{ height: 200 }} />

  const restoreItem = async (id: string, name: string) => {
    try {
      await api.items.restore(id)
      toast({ title: `"${name}" restored`, variant: 'success' })
      load()
    } catch (error) {
      toast({ title: 'Could not restore item', description: String(error), variant: 'error' })
    }
  }

  const purgeItem = async (id: string, name: string) => {
    try {
      await api.items.purge(id)
      toast({ title: `"${name}" deleted forever`, variant: 'success' })
      load()
    } catch (error) {
      toast({ title: 'Could not delete item', description: String(error), variant: 'error' })
    }
  }

  const restoreCollection = async (id: string, name: string) => {
    try {
      await api.collections.restore(id)
      toast({ title: `"${name}" restored — its items are back too`, variant: 'success' })
      load()
    } catch (error) {
      toast({ title: 'Could not restore collection', description: String(error), variant: 'error' })
    }
  }

  const purgeCollection = async (id: string, name: string) => {
    try {
      await api.collections.purge(id)
      toast({ title: `"${name}" deleted forever`, variant: 'success' })
      load()
    } catch (error) {
      toast({ title: 'Could not delete collection', description: String(error), variant: 'error' })
    }
  }

  const isEmpty = trash.collections.length === 0 && trash.items.length === 0

  return (
    <Flex direction="column" gap="4">
      <Box>
        <Heading size="6">Trash</Heading>
        <Text as="div" size="2" color="gray">
          Deleted items and collections are kept here with their full history. Restore them, or
          delete them forever.
        </Text>
      </Box>

      {isEmpty ? (
        <EmptyState
          icon="🗑️"
          title="Trash is empty"
          description="When you delete an item or collection it lands here first, so nothing is ever lost by accident."
          action={
            <Link to="/">
              <Button variant="soft">Back to collections</Button>
            </Link>
          }
        />
      ) : (
        <>
          {trash.collections.length > 0 ? (
            <Flex direction="column" gap="2">
              <Heading size="4">Collections</Heading>
              {trash.collections.map((collection) => (
                <Card key={collection.id} size="2" data-testid="trash-collection">
                  <Flex align="center" gap="3" wrap="wrap">
                    <Text style={{ fontSize: 22 }}>{collection.emoji ?? '📦'}</Text>
                    <Box style={{ flexGrow: 1, minWidth: 180 }}>
                      <Text size="3" weight="medium">
                        {collection.name}
                      </Text>
                      <Text as="div" size="1" color="gray">
                        deleted {formatDateTime(collection.deletedAt)} · includes{' '}
                        {collection.itemCount} item
                        {collection.itemCount === 1 ? '' : 's'}
                      </Text>
                    </Box>
                    <Button
                      variant="soft"
                      onClick={() => restoreCollection(collection.id, collection.name)}
                      data-testid="restore-collection-button"
                    >
                      <ResetIcon /> Restore
                    </Button>
                    <ConfirmDialog
                      title={`Delete "${collection.name}" forever?`}
                      description="This permanently removes the collection and every item inside it, including photos and history. This cannot be undone."
                      actionLabel="Delete forever"
                      onConfirm={() => purgeCollection(collection.id, collection.name)}
                      trigger={
                        <Button variant="soft" color="red" data-testid="purge-collection-button">
                          <TrashIcon /> Delete forever
                        </Button>
                      }
                    />
                  </Flex>
                </Card>
              ))}
            </Flex>
          ) : null}

          {trash.items.length > 0 ? (
            <Flex direction="column" gap="2">
              <Heading size="4">Items</Heading>
              {trash.items.map((item) => (
                <Card key={item.id} size="2" data-testid="trash-item">
                  <Flex align="center" gap="3" wrap="wrap">
                    <Box style={{ flexGrow: 1, minWidth: 180 }}>
                      <Text size="3" weight="medium">
                        {item.name}
                      </Text>
                      <Text as="div" size="1" color="gray">
                        from {item.collectionName} · deleted {formatDateTime(item.deletedAt)}
                      </Text>
                    </Box>
                    <Badge color="gray" variant="soft">
                      {item.collectionName}
                    </Badge>
                    <Button
                      variant="soft"
                      onClick={() => restoreItem(item.id, item.name)}
                      data-testid="restore-item-button"
                    >
                      <ResetIcon /> Restore
                    </Button>
                    <ConfirmDialog
                      title={`Delete "${item.name}" forever?`}
                      description="This permanently removes the item, its photos and its history. This cannot be undone."
                      actionLabel="Delete forever"
                      onConfirm={() => purgeItem(item.id, item.name)}
                      trigger={
                        <Button variant="soft" color="red" data-testid="purge-item-button">
                          <TrashIcon /> Delete forever
                        </Button>
                      }
                    />
                  </Flex>
                </Card>
              ))}
            </Flex>
          ) : null}
        </>
      )}
    </Flex>
  )
}
