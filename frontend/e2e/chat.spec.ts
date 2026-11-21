import { expect, test } from '@playwright/test'

test.describe('Relay Chat E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Default health mock
    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          keys_configured: 2,
          cache_enabled: true,
          model: 'gemini/gemini-2.0-flash',
          failure_simulation: true,
        }),
      })
    })
  })

  test('page load creates a fresh session id each load', async ({ page }) => {
    await page.goto('/')
    const chip1 = page.getByTestId('session-id')
    await expect(chip1).toBeVisible()
    const text1 = await chip1.textContent()

    await page.reload()
    const chip2 = page.getByTestId('session-id')
    await expect(chip2).toBeVisible()
    const text2 = await chip2.textContent()

    expect(text1).toBeTruthy()
    expect(text2).toBeTruthy()
    expect(text1).not.toBe(text2)
  })

  test('send via button and via Enter, clearing chat-input', async ({ page }) => {
    let callCount = 0
    await page.route('**/chat', async (route) => {
      callCount++
      const body = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: body.session_id,
          reply: `Response #${callCount}: echo ${body.message}`,
          metadata: {
            resolution_source: 'LIVE_INFERENCE',
            model: 'gemini/gemini-2.0-flash',
            latency_ms: 120,
            input_tokens: 10,
            output_tokens: 5,
            key_id: 'key_1',
            fallback_attempts: 0,
            attempts: [{ key_id: 'key_1', model: 'gemini/gemini-2.0-flash', outcome: 'ok' }],
          },
        }),
      })
    })

    await page.goto('/')
    const input = page.getByTestId('chat-input')
    const sendBtn = page.getByTestId('send-button')

    // 1. Send via button
    await input.fill('First message')
    await sendBtn.click()
    await expect(input).toHaveValue('')
    await expect(page.getByText('Response #1: echo First message')).toBeVisible()

    // 2. Send via Enter
    await input.fill('Second message')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(page.getByText('Response #2: echo Second message')).toBeVisible()
  })

  test('all required testids present and exact for live reply and cache reply', async ({ page }) => {
    let callCount = 0
    await page.route('**/chat', async (route) => {
      callCount++
      const body = JSON.parse(route.request().postData() || '{}')
      const isCache = callCount > 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: body.session_id,
          reply: 'Paris is the capital of France.',
          metadata: {
            resolution_source: isCache ? 'LLM_CACHE' : 'LIVE_INFERENCE',
            model: 'gemini/gemini-2.0-flash',
            latency_ms: isCache ? 25 : 812,
            input_tokens: 15,
            output_tokens: 7,
            key_id: isCache ? null : 'key_1',
            fallback_attempts: 0,
            original_latency_ms: isCache ? 812 : null,
            attempts: isCache ? [] : [{ key_id: 'key_1', model: 'gemini/gemini-2.0-flash', outcome: 'ok' }],
          },
        }),
      })
    })

    await page.goto('/')

    // System prompt input visible and fillable on page load
    const systemPrompt = page.getByTestId('system-prompt-input')
    await expect(systemPrompt).toBeVisible()
    await expect(systemPrompt).toBeEditable()

    const input = page.getByTestId('chat-input')
    const sendBtn = page.getByTestId('send-button')
    await expect(input).toBeVisible()
    await expect(sendBtn).toBeVisible()

    // Live reply check
    await input.fill('What is the capital of France?')
    await sendBtn.click()

    const liveAssistant = page.getByTestId('assistant-message').first()
    await expect(liveAssistant).toBeVisible()

    const liveSource = liveAssistant.getByTestId('meta-source')
    const liveModel = liveAssistant.getByTestId('meta-model')
    const liveLatency = liveAssistant.getByTestId('meta-latency')
    const liveInTokens = liveAssistant.getByTestId('meta-input-tokens')
    const liveOutTokens = liveAssistant.getByTestId('meta-output-tokens')

    await expect(liveSource).toHaveText('LIVE_INFERENCE')
    await expect(liveModel).toHaveText('gemini/gemini-2.0-flash')
    await expect(liveLatency).toHaveText('812 ms')
    await expect(liveInTokens).toHaveText('15')
    await expect(liveOutTokens).toHaveText('7')

    // Cached reply check
    await input.fill('What is the capital of France?')
    await sendBtn.click()

    const cacheAssistant = page.getByTestId('assistant-message').nth(1)
    await expect(cacheAssistant).toBeVisible()

    const cacheSource = cacheAssistant.getByTestId('meta-source')
    const cacheModel = cacheAssistant.getByTestId('meta-model')
    const cacheLatency = cacheAssistant.getByTestId('meta-latency')
    const cacheInTokens = cacheAssistant.getByTestId('meta-input-tokens')
    const cacheOutTokens = cacheAssistant.getByTestId('meta-output-tokens')

    await expect(cacheSource).toHaveText('LLM_CACHE')
    await expect(cacheModel).toHaveText('gemini/gemini-2.0-flash')
    await expect(cacheLatency).toHaveText('25 ms')
    await expect(cacheInTokens).toHaveText('15')
    await expect(cacheOutTokens).toHaveText('7')
  })

  test('system-prompt-input fillable without clicking anything first', async ({ page }) => {
    let capturedPrompt = ''
    await page.route('**/chat', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      capturedPrompt = body.system_prompt
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: body.session_id,
          reply: 'Arrr, matey!',
          metadata: {
            resolution_source: 'LIVE_INFERENCE',
            model: 'gemini/gemini-2.0-flash',
            latency_ms: 100,
            input_tokens: 12,
            output_tokens: 4,
            key_id: 'key_1',
            fallback_attempts: 0,
          },
        }),
      })
    })

    await page.goto('/')
    const spInput = page.getByTestId('system-prompt-input')
    await spInput.fill('You are a pirate.')

    const input = page.getByTestId('chat-input')
    await input.fill('Ahoy')
    await page.getByTestId('send-button').click()

    await expect(page.getByText('Arrr, matey!')).toBeVisible()
    expect(capturedPrompt).toBe('You are a pirate.')
  })

  test('503 shows inline error + red toast + Retry works', async ({ page }) => {
    let attempts = 0
    await page.route('**/chat', async (route) => {
      attempts++
      const body = JSON.parse(route.request().postData() || '{}')
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'all providers unavailable' }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session_id: body.session_id,
            reply: 'Recovered from 503 on retry!',
            metadata: {
              resolution_source: 'LIVE_INFERENCE',
              model: 'gemini/gemini-2.0-flash',
              latency_ms: 150,
              input_tokens: 10,
              output_tokens: 6,
              key_id: 'key_2',
              fallback_attempts: 1,
            },
          }),
        })
      }
    })

    await page.goto('/')
    await page.getByTestId('chat-input').fill('Test 503 failover')
    await page.getByTestId('send-button').click()

    // 1. Inline error in chat
    const inlineError = page.getByTestId('chat-error')
    await expect(inlineError).toBeVisible()
    await expect(inlineError).toContainText('providers are unavailable')

    // 2. Red toast
    const redToast = page.getByTestId('toast-error')
    await expect(redToast).toBeVisible()

    // 3. Retry button works
    const retryBtn = inlineError.getByRole('button', { name: /retry/i })
    await expect(retryBtn).toBeVisible()
    await retryBtn.click()

    await expect(page.getByText('Recovered from 503 on retry!')).toBeVisible()
  })

  test('422 validation error text is readable inline and in toast', async ({ page }) => {
    await page.route('**/chat', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: [
            {
              loc: ['body', 'message'],
              msg: 'message must be at most 4000 characters',
              type: 'value_error',
            },
          ],
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('chat-input').fill('Trigger 422')
    await page.getByTestId('send-button').click()

    const inlineError = page.getByTestId('chat-error')
    await expect(inlineError).toBeVisible()
    await expect(inlineError).toContainText('message must be at most 4000 characters')

    const redToast = page.getByTestId('toast-error')
    await expect(redToast).toBeVisible()
    await expect(redToast).toContainText('message must be at most 4000 characters')
  })

  test('past session loads and handles 404 removal', async ({ page }) => {
    // Seed localStorage with a past session that no longer exists on backend
    await page.addInitScript(() => {
      localStorage.setItem(
        'relay.sessions.v1',
        JSON.stringify([
          {
            id: 'stale-session-404',
            title: 'Stale Session 404',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      )
    })

    await page.route('**/sessions/stale-session-404/messages', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'session not found' }),
      })
    })

    await page.goto('/')

    const staleItem = page.locator('.rail-item', { hasText: 'Stale Session 404' })
    await expect(staleItem).toBeVisible()
    await staleItem.click()

    // Red toast for 404
    const toast = page.getByTestId('toast-error')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('Session not found')

    // Stale session removed from list
    await expect(staleItem).not.toBeVisible()
  })

  test('no horizontal overflow at 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })

    await page.route('**/chat', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: body.session_id,
          reply: 'Here is a responsive check response with some text and code: `console.log("ok")`',
          metadata: {
            resolution_source: 'LIVE_INFERENCE',
            model: 'gemini/gemini-2.0-flash',
            latency_ms: 123,
            input_tokens: 20,
            output_tokens: 15,
            key_id: 'key_1',
            fallback_attempts: 0,
          },
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('chat-input').fill('Test responsive')
    await page.getByTestId('send-button').click()

    await expect(page.getByTestId('assistant-message')).toBeVisible()

    const hasOverflow = await page.evaluate(() => {
      const doc = document.documentElement
      const body = document.body
      return doc.scrollWidth > doc.clientWidth || body.scrollWidth > body.clientWidth
    })

    expect(hasOverflow).toBe(false)
  })
})
