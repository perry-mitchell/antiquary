import { expect, test } from '@playwright/test';

// Guards mobile layout: no page may scroll horizontally at phone widths.
const PAGES = ['/', '/templates', '/trash', '/settings', '/search?q=book', '/supersets/gb'];

test.describe('mobile layout', () => {
    let collectionId: string;

    test.beforeAll(async ({ request }) => {
        const collection = await request.post('/api/collections', {
            data: { name: 'Mobile shelf', emoji: '📚' },
        });
        collectionId = (await collection.json()).id;
        await request.post('/api/items', {
            data: {
                collectionId,
                name: 'A very long item name that must wrap instead of overflowing the viewport at 375px',
                quantity: 2,
                tags: ['bulky-tag-name', 'second-tag'],
            },
        });
    });

    for (const path of PAGES) {
        test(`${path} has no horizontal overflow`, async ({ page }) => {
            await page.goto(path);
            await expect(page.locator('.nav-label').first()).toBeHidden();
            const delta = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(delta).toBeLessThanOrEqual(1);
        });
    }

    test('collection and item pages have no horizontal overflow', async ({ page }) => {
        await page.goto(`/collections/${collectionId}`);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
        ).toBeLessThanOrEqual(1);

        const itemId = await page.evaluate(
            async (cid) =>
                (await (await fetch(`/api/items?collectionId=${cid}`)).json()).items[0].id,
            collectionId,
        );
        await page.goto(`/items/${itemId}`);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
        ).toBeLessThanOrEqual(1);
    });
});
