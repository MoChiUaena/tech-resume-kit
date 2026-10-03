export async function openAdvancedEditor(page) {
  if (!await page.locator('#advanced-editor').evaluate(details => details.open)) await page.locator('#advanced-editor > summary').click();
}
