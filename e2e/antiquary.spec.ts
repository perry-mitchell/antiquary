import { expect, test } from '@playwright/test'

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005050201edb5ca9f0000000049454e44ae426082',
  'hex',
)

test.describe.serial('collector journey', () => {
  test('homepage loads with empty state', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('Antiquary')
    await expect(page.getByTestId('empty-state')).toContainText('Welcome to Antiquary')
    await expect(page.getByTestId('nav-templates')).toBeVisible()
    await expect(page.getByTestId('nav-trash')).toBeVisible()
  })

  test('creates a collection', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-collection-button').click()
    await page.getByTestId('collection-name-input').fill('Books')
    await page.getByTestId('collection-description-input').fill('Sci-fi and fantasy')
    await page.getByTestId('emoji-📚').click()
    await page.getByTestId('collection-save-button').click()
    await expect(page.getByTestId('toast-success').last()).toBeVisible()
    await expect(page.getByTestId('collection-card')).toContainText('Books')
    await expect(page.getByTestId('collection-card')).toContainText('0 items')
  })

  test('creates a template with fields', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('nav-templates').click()
    await page.getByTestId('new-template-button').click()
    await page.getByTestId('template-name-input').fill('Book details')
    await page.getByTestId('template-description-input').fill('Fields for novels')

    await page.getByTestId('field-name-0').fill('Author')
    await page.getByTestId('field-required-0').click()

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-1').fill('Rating')
    await page.getByTestId('field-type-1').selectOption('rating')

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-2').fill('Genre')
    await page.getByTestId('field-type-2').selectOption('select')
    await page.getByTestId('field-options-2').fill('Sci-Fi, Fantasy, Non-fiction')

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-3').fill('Pages')
    await page.getByTestId('field-type-3').selectOption('number')

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-4').fill('Published')
    await page.getByTestId('field-type-4').selectOption('date')

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-5').fill('Cover art')
    await page.getByTestId('field-type-5').selectOption('image')

    await page.getByTestId('add-field-button').click()
    await page.getByTestId('field-name-6').fill('Purchase price')
    await page.getByTestId('field-type-6').selectOption('price')

    await page.getByTestId('save-template-button').click()
    await expect(page.getByTestId('template-card')).toContainText('Book details')
    await expect(page.getByTestId('template-card')).toContainText('7 fields')
    await expect(page.getByTestId('template-card')).toContainText('Author')
  })

  test('adds an item with template fields and a tag', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await expect(page.getByTestId('collection-title')).toContainText('Books')
    await page.getByTestId('empty-add-item').click()

    await page.getByTestId('item-name-input').fill('Dune')
    await page.getByTestId('item-quantity-input').fill('2')
    await page.getByTestId('item-template-select').selectOption({ index: 1 })

    await page.getByTestId('field-input-author').fill('Frank Herbert')
    await page.getByTestId('rating-star-5').click()
    await page.getByTestId('field-input-genre').click()
    await page.getByRole('option', { name: 'Sci-Fi' }).click()
    await page.getByTestId('field-input-pages').fill('412')
    await page.getByTestId('field-input-published').fill('1965-08-01')

    await page.getByTestId('field-input-cover-art').setInputFiles({
      name: 'cover-art.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    })
    await expect(page.getByTestId('field-image-cover-art')).toBeVisible()

    await page.getByTestId('field-input-purchase-price').fill('8.99')
    await page.getByTestId('field-currency-purchase-price').selectOption('EUR')

    await page.getByTestId('new-tag-input').fill('classic')
    await page.getByTestId('new-tag-button').click()
    // creating a tag auto-selects it on the item

    await page.getByTestId('item-favorite-input').click()

    // Photos can be attached during creation
    await page.getByTestId('form-photos-input').setInputFiles({
      name: 'creation-photo.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    })
    await expect(page.getByTestId('form-photo-remove-0')).toBeVisible()

    await page.getByTestId('save-item-button').click()

    await expect(page.getByTestId('item-title')).toContainText('Dune')
    await expect(page.getByTestId('history-event').filter({ hasText: 'Created' })).toHaveCount(1)
    await expect(page.getByTestId('item-favorite')).toBeVisible()
    // the creation-time photo landed on the item
    await expect(page.getByTestId('item-cover').locator('img')).toBeVisible()
  })

  test('shows template values on the item page', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('item-card').click()
    await expect(page.getByTestId('item-title')).toContainText('Dune')
    await expect(page.getByTestId('history-section')).toContainText('Frank Herbert')
    await expect(page.getByTestId('history-section')).toContainText('Sci-Fi')
    await expect(page.getByTestId('history-section')).toContainText('classic')
    await expect(page.getByTestId('history-section')).toContainText('€8.99')
    await expect(page.locator('img[src^="/uploads/"]').first()).toBeVisible()

    // Custom-property images open in a dialog
    await page.locator('img[data-testid="field-image"]').first().click()
    await expect(page.getByTestId('field-image-dialog')).toBeVisible()
    await expect(page.getByTestId('field-image-dialog')).toHaveAttribute('src', /\/uploads\//)
    await page.getByTestId('field-image-close').click()
    await expect(page.getByTestId('field-image-dialog')).toHaveCount(0)

    // Photo captions can be edited
    await page.getByTestId('photo-caption-input').fill('First edition cover')
    await page.getByTestId('photo-caption-save').click()
    await expect(page.getByTestId('toast-success').last()).toContainText('Caption saved')

    await expect(page.getByTestId('breadcrumb-collection')).toContainText('Books')
  })

  test('uploads a photo which becomes the cover', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('item-card').click()
    await page.getByTestId('file-input').setInputFiles({
      name: 'dune.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    })
    await expect(page.getByTestId('toast-success').last()).toContainText('Uploaded 1 photo')
    await expect(page.getByTestId('item-cover').locator('img')).toBeVisible()
    await expect(page.getByTestId('history-event').first()).toContainText('Photo added')

    const img = page.getByTestId('item-cover').locator('img')
    await expect(img).toHaveAttribute('src', /\/uploads\/.+\.png/)
    const res = await page.request.get(await img.getAttribute('src'))
    expect(res.status()).toBe(200)
  })

  test('editing an item records a history diff', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('item-card').click()
    await page.getByTestId('edit-item-button').click()

    await page.getByTestId('item-name-input').fill('Dune Messiah')
    await page.getByTestId('field-input-pages').fill('256')
    await page.getByTestId('save-item-button').click()

    await expect(page.getByTestId('item-title')).toContainText('Dune Messiah')
    const updated = page.getByTestId('history-event').filter({ hasText: 'Updated' }).first()
    await expect(updated).toBeVisible()
    await expect(updated.getByTestId('history-change').filter({ hasText: 'Name' })).toContainText(
      'Dune',
    )
    await expect(updated.getByTestId('history-change').filter({ hasText: 'Pages' })).toContainText(
      '256',
    )
  })

  test('global search finds items by name and field value', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('global-search').fill('messiah')
    await page.getByTestId('global-search').press('Enter')
    await expect(page.getByTestId('search-summary')).toContainText('1 result')
    await expect(page.getByTestId('item-card')).toContainText('Dune Messiah')

    await page.goto('/')
    await page.getByTestId('global-search').fill('Frank Herbert')
    await page.getByTestId('global-search').press('Enter')
    await expect(page.getByTestId('item-card')).toContainText('Dune Messiah')
  })

  test('collection search and favorites filter work', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('collection-search').fill('messiah')
    await expect(page.getByTestId('items-grid')).toContainText('Dune Messiah')
    await page.getByTestId('collection-search').fill('zzzz-nothing')
    await expect(page.getByTestId('empty-state')).toContainText('No matching items')
    await page.getByTestId('collection-search').fill('')
    await page.getByTestId('favorites-only').click()
    await expect(page.getByTestId('items-grid')).toContainText('Dune Messiah')
  })

  test('moves an item to trash and restores it', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('item-card').click()
    await page.getByTestId('item-menu').click()
    await page.getByTestId('delete-item-button').click()
    await page.getByTestId('confirm-delete-item').click()

    await expect(page.getByTestId('toast-success').last()).toContainText('moved to trash')
    await expect(page.getByTestId('collection-title')).toContainText('Books')

    await page.getByTestId('nav-trash').click()
    await expect(page.getByTestId('trash-item')).toContainText('Dune Messiah')
    await page.getByTestId('restore-item-button').click()
    await expect(page.getByTestId('toast-success').last()).toContainText('restored')

    await page.getByTestId('nav-collections').click()
    await page.getByTestId('collection-card').click()
    await expect(page.getByTestId('item-card')).toContainText('Dune Messiah')
  })

  test('deleting a collection trashes its items and both restore together', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('collection-menu').click()
    await page.getByTestId('delete-collection-item').click()
    await page.getByTestId('confirm-delete-collection').click()

    await expect(page.getByTestId('toast-success').last()).toContainText('moved to trash')
    await expect(page.getByTestId('empty-state')).toBeVisible()

    await page.getByTestId('nav-trash').click()
    await expect(page.getByTestId('trash-collection')).toContainText('Books')
    await page.getByTestId('restore-collection-button').click()
    await expect(page.getByTestId('toast-success').last()).toContainText('restored')

    await page.getByTestId('nav-collections').click()
    await page.getByTestId('collection-card').click()
    await expect(page.getByTestId('item-card')).toContainText('Dune Messiah')
  })

  test('permanently deletes a trashed item', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('collection-card').click()
    await page.getByTestId('add-item-button').click()
    await page.getByTestId('item-name-input').fill('Scratch item')
    await page.getByTestId('save-item-button').click()
    await expect(page.getByTestId('item-title')).toContainText('Scratch item')

    await page.getByTestId('item-menu').click()
    await page.getByTestId('delete-item-button').click()
    await page.getByTestId('confirm-delete-item').click()

    await page.getByTestId('nav-trash').click()
    const row = page.getByTestId('trash-item').filter({ hasText: 'Scratch item' })
    await row.getByTestId('purge-item-button').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete forever' }).click()
    await expect(page.getByTestId('toast-success').last()).toContainText('deleted forever')
    await expect(page.getByTestId('trash-item').filter({ hasText: 'Scratch item' })).toHaveCount(0)
  })

  test('template in use cannot be deleted', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('nav-templates').click()
    await page
      .getByTestId('template-card')
      .first()
      .getByTestId(/delete-template-/)
      .click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /Delete/ })
      .first()
      .click()
    await expect(page.getByTestId('toast-error').last()).toContainText('used by')
    await expect(page.getByTestId('template-card')).toContainText('Book details')
  })

  test('superset workflow: template → collection → matched item', async ({ page }) => {
    // 1. Template with custom field + SNES superset
    await page.goto('/')
    await page.getByTestId('nav-templates').click()
    await page.getByTestId('new-template-button').click()
    await page.getByTestId('template-name-input').fill('SNES games')
    await page.getByTestId('field-name-0').fill('Condition')
    await page.getByTestId('template-superset-select').selectOption('snes')
    await page.getByTestId('save-template-button').click()
    const card = page.getByTestId('template-card').filter({ hasText: 'SNES games' })
    await expect(card).toContainText('7 fields')
    await expect(card).toContainText('Region')

    // 2. Collection using that template as its default
    await page.goto('/')
    await page.getByTestId('new-collection-button').click()
    await page.getByTestId('collection-name-input').fill('SNES shelf')
    await page
      .getByTestId('collection-template-select')
      .selectOption({ label: 'SNES games ⋆ catalog (7 fields)' })
    await page.getByTestId('collection-save-button').click()
    await expect(page.getByTestId('toast-success').last()).toContainText('created')

    // 3. Add item — catalog matcher is required before saving
    await page.getByTestId('collection-card').filter({ hasText: 'SNES shelf' }).click()
    await page.getByTestId('empty-add-item').click()
    await expect(page.getByTestId('catalog-search')).toBeVisible()
    await expect(page.getByTestId('item-template-select')).toHaveValue(/\S+/)
    await expect(page.getByTestId('save-item-button')).toBeDisabled()

    // Type then clear the title — picking a catalog match must still fill it
    await page.getByTestId('item-name-input').fill('My copy')
    await page.getByTestId('item-name-input').fill('')

    // 4. Search title, pick the USA variant
    await page.getByTestId('catalog-search').fill('chrono trigger')
    await page.getByTestId('catalog-title-chrono-trigger').click()
    await page.getByTestId('catalog-variant-chrono-trigger').filter({ hasText: '(USA)' }).click()
    await expect(page.getByTestId('catalog-match')).toBeVisible()
    await expect(page.getByTestId('item-name-input')).toHaveValue('Chrono Trigger')
    await expect(page.getByTestId('save-item-button')).toBeEnabled()

    // 5. Save — item page shows the match and the prefilled catalog fields
    await page.getByTestId('save-item-button').click()
    await expect(page.getByTestId('item-title')).toContainText('Chrono Trigger')
    await expect(page.getByTestId('superset-badge')).toContainText('Chrono Trigger (USA)')
    await expect(page.getByTestId('history-section')).toContainText('SNS-ACTE-USA')
    await expect(page.getByTestId('history-section')).toContainText('Square')
    await expect(page.getByTestId('history-section')).toContainText('1995')

    // 6. Completion shows on the collection card and the collection page
    await page.goto('/')
    const shelfCard = page.getByTestId('collection-card').filter({ hasText: 'SNES shelf' })
    await expect(shelfCard.getByTestId('collection-completion')).toBeVisible()
    await shelfCard.click()
    await expect(page.getByTestId('collection-completion-text')).toContainText(
      /1 \/ \d+ titles · 0(\.\d+)?%/,
    )
  })

  test('settings: create, copy and revoke an MCP key', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('empty-state')).toContainText('No API keys yet')

    // create a read-only key
    await page.getByTestId('api-key-name-input').fill('Claude desktop')
    await page.getByTestId('api-key-readonly-input').click()
    await page.getByTestId('api-key-create-button').click()

    const dialog = page.getByTestId('api-key-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('api-key-value')).toContainText(/^mcp_[0-9a-f]{64}$/)
    await page.getByTestId('api-key-copy').click()
    await expect(page.getByTestId('api-key-copy')).toContainText('Copied')
    await page.getByTestId('api-key-dismiss').click()
    await expect(dialog).toHaveCount(0)

    // listed with its scope, then revoked
    const row = page.getByTestId('api-key-row').filter({ hasText: 'Claude desktop' })
    await expect(row).toContainText('Read-only')
    await expect(row).toContainText('never used')
    await row.getByTestId('api-key-revoke').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke key' }).click()
    await expect(page.getByTestId('toast-success').last()).toContainText('revoked')
    await expect(
      page.getByTestId('api-key-row').filter({ hasText: 'Claude desktop' }),
    ).toContainText('Revoked')
  })

  test('dark mode toggle switches appearance', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('collection-card').first()).toBeVisible()
    await page.getByTestId('theme-toggle').click()
    await page.waitForSelector('.radix-themes.dark')
    const darkBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.radix-themes')!).backgroundColor,
    )
    await page.getByTestId('theme-toggle').click()
    await page.waitForSelector('.radix-themes:not(.dark)')
    const lightBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.radix-themes')!).backgroundColor,
    )
    expect(darkBg).not.toBe(lightBg)
  })
})
