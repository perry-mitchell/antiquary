import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { Badge, Box, Button, Card, Flex, Heading, Skeleton, Text } from '@radix-ui/themes'
import type { TemplateDetailDto } from '@antiquary/database'
import { api } from '../api'
import { ConfirmDialog, EmptyState } from '../components/Dialogs'
import { useToast } from '../components/Toast'

export function TemplatesPage() {
  const toast = useToast()
  const [templates, setTemplates] = useState<TemplateDetailDto[] | null>(null)

  useEffect(() => {
    api.templates
      .list()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  if (!templates) return <Skeleton style={{ height: 200 }} />

  return (
    <Flex direction="column" gap="4">
      <Flex align="center" justify="between">
        <Box>
          <Heading size="6">Templates</Heading>
          <Text as="div" size="2" color="gray">
            Templates define the custom fields items can carry — author, platform, pressing,
            condition…
          </Text>
        </Box>
        <Link to="/templates/new">
          <Button data-testid="new-template-button">
            <PlusIcon /> New template
          </Button>
        </Link>
      </Flex>

      {templates.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No templates yet"
          description="A template is a set of custom fields. Pick one when adding an item and those fields show up on the form — far friendlier than filling everything by hand."
          action={
            <Link to="/templates/new">
              <Button data-testid="new-template-button-empty">
                <PlusIcon /> Create a template
              </Button>
            </Link>
          }
        />
      ) : (
        <Flex direction="column" gap="3">
          {templates.map((template) => (
            <Card key={template.id} size="3" data-testid="template-card">
              <Flex align="center" gap="4" wrap="wrap">
                <Box style={{ flexGrow: 1, minWidth: 240 }}>
                  <Flex align="center" gap="2">
                    <Link to={`/templates/${template.id}/edit`} style={{ textDecoration: 'none' }}>
                      <Text size="4" weight="medium" color="iris">
                        {template.name}
                      </Text>
                    </Link>
                    <Badge color="iris" variant="soft">
                      {template.fields.length} field{template.fields.length === 1 ? '' : 's'}
                    </Badge>
                    <Badge color={template.itemCount > 0 ? 'green' : 'gray'} variant="soft">
                      used by {template.itemCount} item{template.itemCount === 1 ? '' : 's'}
                    </Badge>
                  </Flex>
                  {template.description ? (
                    <Text as="div" size="2" color="gray" mt="1">
                      {template.description}
                    </Text>
                  ) : null}
                  <Flex gap="2" wrap="wrap" mt="2">
                    {template.fields.map((field) => (
                      <Badge key={field.id} color="gray" variant="soft">
                        {field.name}
                        {field.required ? ' *' : ''}
                      </Badge>
                    ))}
                  </Flex>
                </Box>
                <Flex gap="2">
                  <Link to={`/templates/${template.id}/edit`}>
                    <Button variant="soft" data-testid={`edit-template-${template.id}`}>
                      Edit
                    </Button>
                  </Link>
                  <ConfirmDialog
                    title={`Delete template "${template.name}"?`}
                    description={
                      template.itemCount > 0
                        ? `This template is used by ${template.itemCount} item${template.itemCount === 1 ? '' : 's'}, so it cannot be deleted.`
                        : 'The template and its fields will be removed. No items use it.'
                    }
                    actionLabel={template.itemCount > 0 ? 'Delete anyway' : 'Delete template'}
                    onConfirm={async () => {
                      try {
                        await api.templates.remove(template.id)
                        toast({ title: 'Template deleted', variant: 'success' })
                        setTemplates(
                          (current) => current?.filter((t) => t.id !== template.id) ?? null,
                        )
                      } catch (error) {
                        toast({
                          title: 'Could not delete template',
                          description: String(error),
                          variant: 'error',
                        })
                      }
                    }}
                    trigger={
                      <Button
                        variant="soft"
                        color="red"
                        data-testid={`delete-template-${template.id}`}
                      >
                        <TrashIcon /> Delete
                      </Button>
                    }
                  />
                </Flex>
              </Flex>
            </Card>
          ))}
        </Flex>
      )}
    </Flex>
  )
}
