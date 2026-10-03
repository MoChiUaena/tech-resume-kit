// Playwright serializes this function into the page. Keep the readiness decision
// and its diagnostics in one observation: fit-width redraw can start immediately
// after a successful poll and legitimately clear the rendered marker again.
function observePreview({ expectedText, waiting = false }) {
  const frame = document.querySelector('#pdf-frame'), viewer = frame?.contentDocument;
  const layers = [...(viewer?.querySelectorAll('.textLayer') || [])];
  const parentError = document.querySelector('#preview-error:not([hidden])');
  const viewerError = viewer?.querySelector('#viewer-error:not([hidden])');
  const state = {
    ready: !!viewer?.querySelector('.pdf-page[data-rendered=true]') && (!expectedText || layers.some(layer => layer.textContent.includes(expectedText))),
    parentStatus: document.querySelector('#page-status')?.textContent,
    parentError: parentError?.textContent || '',
    parentErrorVisible: !!parentError,
    viewerUrl: viewer?.URL || '',
    viewerStatus: viewer?.querySelector('#page-number')?.textContent || '',
    viewerError: viewerError?.querySelector('#error-message')?.textContent || '',
    viewerErrorVisible: !!viewerError,
    renderedPages: viewer?.querySelectorAll('.pdf-page[data-rendered=true]').length || 0,
    textLayers: layers.length,
  };
  return waiting && !state.ready && !parentError && !viewerError ? false : state;
}

export async function waitForCanvasPreview(page, expectedText = '') {
  let observation;
  try {
    observation = await page.waitForFunction(observePreview, { expectedText, waiting: true }, { timeout: 90000 });
  } catch (error) {
    const state = await page.evaluate(observePreview, { expectedText });
    throw new Error(`Portable PDF preview timed out: ${JSON.stringify(state)}`, { cause: error });
  }
  try {
    const state = await observation.jsonValue();
    if (!state.ready || state.parentErrorVisible || state.viewerErrorVisible) throw new Error(`Portable PDF preview failed: ${JSON.stringify(state)}`);
  } finally {
    await observation.dispose();
  }
}
