import { test, expect } from '@playwright/test';

test.describe('Amazon search and add first Samsung Galaxy S25 result to cart', () => {
  test('Search for Samsung Galaxy S25 and add the first result to the cart', async ({ page }) => {
    // 1. Navigate to https://www.amazon.in/ and verify the Amazon.in home page is visible.
    await page.goto('https://www.amazon.in/');
    await expect(page.getByRole('searchbox', { name: 'Search Amazon.in' })).toBeVisible();

    // 2. Search for "Samsung Galaxy S25" using the main search field and submit the search.
    const searchBox = page.getByRole('searchbox', { name: 'Search Amazon.in' });
    await searchBox.fill('Samsung Galaxy S25');
    await searchBox.press('Enter');
    await expect(page).toHaveTitle(/Samsung Galaxy S25/);
    await expect(page.getByRole('heading', { name: /results for "Samsung Galaxy S25"/i, level: 2 })).toBeVisible();

    // 3. Identify the first product result and record its visible product title.
    const firstResult = page.locator('[data-component-type="s-search-result"]').filter({ hasText: 'Galaxy S25' }).first();
    await expect(firstResult).toBeVisible();
    const firstResultTitle = firstResult.locator('a.s-line-clamp-2');
    await expect(firstResultTitle).toContainText('Galaxy S25');

    // 4. Add the first result to the cart and verify Amazon confirms the cart action.
    const productPagePromise = page.waitForEvent('popup');
    await firstResultTitle.click();
    const productPage = await productPagePromise;
    await expect(productPage.getByRole('heading', { name: /Samsung Galaxy S25 5G/i })).toBeVisible();
    await productPage.locator('#add-to-cart-button').click();

    // 5. Open the cart and verify it contains the same first-result Samsung Galaxy S25 item.
    await expect(productPage).toHaveURL(/\/cart\//);
    await expect(productPage.getByRole('link', { name: /Samsung Galaxy S25 5G \(Navy, 12GB RAM, 128GB Storage\)/i })).toBeVisible();
  });
});
