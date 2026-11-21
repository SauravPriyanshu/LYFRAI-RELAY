import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { buildCurlCommand } from '../components/InspectorDrawer'
import { ToastProvider } from '../components/Toasts'

const okBody = (over: Record<string, unknown> = {}) => ({
  session_id: 's-x',
  reply: typeof over.reply === 'string' ? (over.reply as string) : 'The capital of France is Paris.',
  metadata: {
    resolution_source: 'LIVE_INFERENCE',
    model: 'gemini/gemini-2.0-flash',
    latency_ms: 812,
    input_tokens: 42,
    output_tokens: 9,
    key_id: 'key_1',
    fallback_attempts: 0,
    ...over,
  },
})

const defaultHealth = {
  status: 'ok',
  keys_configured: 2,
  cache_enabled: true,
  model: 'gemini/gemini-2.0-flash',
  failure_simulation: true,
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const mount = () =>
  render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/health')) {
      return json(200, defaultHealth)
    }
    return json(200, okBody())
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('chat contract', () => {
  it('sends, clears input and renders every metadata testid', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) return json(200, okBody())
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    await user.type(input, 'What is the capital of France?')
    await user.click(screen.getByTestId('send-button'))
    expect(input.value).toBe('')

    const msg = await screen.findByTestId('assistant-message')
    expect(msg.textContent).toContain('The capital of France is Paris.')
    expect(within(msg).getByTestId('meta-source').textContent).toBe('LIVE_INFERENCE')
    expect(within(msg).getByTestId('meta-model').textContent).toBe('gemini/gemini-2.0-flash')
    expect(within(msg).getByTestId('meta-latency').textContent).toBe('812 ms')
    expect(within(msg).getByTestId('meta-input-tokens').textContent).toBe('42')
    expect(within(msg).getByTestId('meta-output-tokens').textContent).toBe('9')

    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat'))
    expect(chatCall).toBeDefined()
    const [url, init] = chatCall!
    expect(String(url)).toMatch(/\/chat$/)
    const body = JSON.parse(init.body)
    expect(body.message).toBe('What is the capital of France?')
    expect(body.session_id).toMatch(/^s-/)
    expect('system_prompt' in body).toBe(false)
    expect(init.headers['X-Simulate-Failure']).toBeUndefined()
  })

  it('Enter sends, Shift+Enter does not', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()
    const input = screen.getByTestId('chat-input')
    await user.type(input, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))).toHaveLength(0)
    await user.type(input, '{Enter}')
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))).toHaveLength(1),
    )
    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat'))!
    expect(JSON.parse(chatCall[1].body).message).toBe('line one\nline two')
  })

  it('does not send empty or whitespace-only messages', async () => {
    const user = userEvent.setup()
    mount()
    const send = screen.getByTestId('send-button') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    await user.type(screen.getByTestId('chat-input'), '   {Enter}')
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))).toHaveLength(0)
  })

  it('shows cache label and a green toast on LLM_CACHE', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody({ resolution_source: 'LLM_CACHE', key_id: null, latency_ms: 3 }))
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'hi{Enter}')
    const msg = await screen.findByTestId('assistant-message')
    expect(within(msg).getByTestId('meta-source').textContent).toBe('LLM_CACHE')
    expect(await screen.findByTestId('toast-success')).toBeTruthy()
  })

  it('sends system prompt when set', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('system-prompt-input'), 'You are a pirate.')
    await user.type(screen.getByTestId('chat-input'), 'hi{Enter}')
    await screen.findByTestId('assistant-message')

    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat'))!
    const [, init] = chatCall
    expect(JSON.parse(init.body).system_prompt).toBe('You are a pirate.')
  })

  it('reuses one session id across turns and changes it on new session', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'one{Enter}')
    await screen.findByTestId('assistant-message')
    await user.type(screen.getByTestId('chat-input'), 'two{Enter}')
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))).toHaveLength(2),
    )
    const chatCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))
    const ids = chatCalls.map((c) => JSON.parse(c[1].body).session_id)
    expect(ids[0]).toBe(ids[1])

    await user.click(screen.getByRole('button', { name: /new session/i }))
    expect(screen.queryByTestId('assistant-message')).toBeNull()
    expect(screen.getByTestId('session-id').textContent).not.toBe(ids[0])
  })
})

describe('errors', () => {
  it('503 shows a readable inline error and a red toast, with working retry', async () => {
    let chatAttempts = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        chatAttempts++
        if (chatAttempts === 1) {
          return json(503, { detail: 'all providers unavailable' })
        }
        return json(200, okBody())
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'hello{Enter}')
    const err = await screen.findByTestId('chat-error')
    expect(err.textContent).toMatch(/unavailable/i)
    expect(await screen.findByTestId('toast-error')).toBeTruthy()

    await user.click(within(err).getByRole('button', { name: /retry/i }))
    await screen.findByTestId('assistant-message')
    expect(screen.queryByTestId('chat-error')).toBeNull()
    expect(screen.getAllByTestId('user-message')).toHaveLength(1) // retry does not duplicate the bubble
  })

  it('422 array detail is formatted readably', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(422, {
        detail: [
          {
            loc: ['body', 'message'],
            msg: 'Value error, message must be at most 4000 characters',
            type: 'value_error',
          },
        ],
      })
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'x{Enter}')
    const err = await screen.findByTestId('chat-error')
    expect(err.textContent).toContain('message: message must be at most 4000 characters')
  })

  it('network failure shows a readable error instead of a blank screen', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      throw new TypeError('Failed to fetch')
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'x{Enter}')
    const err = await screen.findByTestId('chat-error')
    expect(err.textContent).toMatch(/cannot reach the server/i)
  })

  it('non-JSON error body (proxy page) is handled', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))
    })

    const user = userEvent.setup()
    mount()
    await user.type(screen.getByTestId('chat-input'), 'x{Enter}')
    const err = await screen.findByTestId('chat-error')
    expect(err.textContent).not.toContain('<html>')
  })
})

describe('past sessions & layout enhancements', () => {
  it('persists session to localStorage only after first successful reply', async () => {
    const user = userEvent.setup()
    mount()

    // Initially localStorage has no sessions
    expect(localStorage.getItem('relay.sessions.v1')).toBeNull()

    // Send a message
    await user.type(screen.getByTestId('chat-input'), 'First user inquiry{Enter}')
    await screen.findByTestId('assistant-message')

    // Stored in localStorage
    const raw = localStorage.getItem('relay.sessions.v1')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('First user inquiry')
  })

  it('allows renaming a session and persists the new title to localStorage', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'relay.sessions.v1',
      JSON.stringify([
        {
          id: 'test-session-1',
          title: 'Original Title',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    )
    mount()

    const renameBtn = await screen.findByRole('button', { name: /rename session original title/i })
    await user.click(renameBtn)

    const input = screen.getByRole('textbox', { name: /rename session/i })
    await user.clear(input)
    await user.type(input, 'Updated Session Title{Enter}')

    expect(screen.getByText('Updated Session Title')).toBeTruthy()
    const raw = localStorage.getItem('relay.sessions.v1')
    expect(raw).toContain('Updated Session Title')
  })

  it('loads past session history and gracefully renders missing metadata', async () => {
    const pastSessionId = 's-past-123'
    localStorage.setItem(
      'relay.sessions.v1',
      JSON.stringify([
        {
          id: pastSessionId,
          title: 'Past exploration',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemPrompt: 'Be concise.',
        },
      ]),
    )

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes(`/sessions/${pastSessionId}/messages`)) {
        return json(200, {
          session_id: pastSessionId,
          messages: [
            { role: 'user', content: 'What is 2+2?' },
            {
              role: 'assistant',
              content: '4',
              // Partial metadata with missing latency_ms and input_tokens
              metadata: {
                resolution_source: 'LIVE_INFERENCE',
                model: 'gemini/gemini-2.0-flash',
              },
            },
          ],
        })
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    // Click the past session in the rail
    const pastItem = await screen.findByText('Past exploration')
    await user.click(pastItem)

    // Verify messages loaded
    const userMsg = await screen.findByText('What is 2+2?')
    expect(userMsg).toBeTruthy()
    const assistantMsg = await screen.findByTestId('assistant-message')
    expect(assistantMsg.textContent).toContain('4')

    // Missing fields render as '—' without crashing
    expect(within(assistantMsg).getByTestId('meta-latency').textContent).toBe('—')
    expect(within(assistantMsg).getByTestId('meta-input-tokens').textContent).toBe('—')
    expect(within(assistantMsg).getByTestId('meta-source').textContent).toBe('LIVE_INFERENCE')

    // Restores system prompt
    const promptInput = screen.getByTestId('system-prompt-input') as HTMLTextAreaElement
    expect(promptInput.value).toBe('Be concise.')
  })

  it('handles 404 on past session by removing it from storage and showing toast', async () => {
    const ghostId = 's-ghost-404'
    localStorage.setItem(
      'relay.sessions.v1',
      JSON.stringify([
        {
          id: ghostId,
          title: 'Ghost session',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    )

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes(`/sessions/${ghostId}/messages`)) {
        return json(404, { detail: 'session not found' })
      }
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    const ghostItem = await screen.findByText('Ghost session')
    await user.click(ghostItem)

    // Expect red error toast
    expect(await screen.findByTestId('toast-error')).toBeTruthy()

    // Session was purged from localStorage
    const parsed = JSON.parse(localStorage.getItem('relay.sessions.v1') || '[]')
    expect(parsed.find((s: { id: string }) => s.id === ghostId)).toBeUndefined()
  })

  it('cancels in-flight chat request when Stop waiting is clicked without showing error toast', async () => {
    let abortSignalPassed: AbortSignal | undefined
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        abortSignalPassed = init?.signal as AbortSignal
        return new Promise<Response>((_, reject) => {
          abortSignalPassed?.addEventListener('abort', () => {
            const err = new DOMException('The user aborted a request.', 'AbortError')
            reject(err)
          })
        })
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Long running query{Enter}')

    // Find and click Stop waiting button
    const stopBtn = await screen.findByRole('button', { name: /stop waiting/i })
    await user.click(stopBtn)

    // Inline info message rendered
    const infoBubble = await screen.findByTestId('chat-info')
    expect(infoBubble.textContent).toContain('Request was stopped')

    // No error toast is displayed
    expect(screen.queryByTestId('toast-error')).toBeNull()
  })

  it('shows waking server banner if first health check takes longer than 4s', async () => {
    vi.useFakeTimers()
    try {
      let resolveHealth: (value: Response) => void
      const healthPromise = new Promise<Response>((resolve) => {
        resolveHealth = resolve
      })

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) {
          return healthPromise
        }
        return json(200, okBody())
      })

      render(
        <ToastProvider>
          <App />
        </ToastProvider>,
      )

      // Advance time past 4 seconds inside act
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4100)
      })

      // Waking server banner is visible
      expect(screen.getByText(/waking up the server/i)).toBeTruthy()

      // Now health succeeds
      await act(async () => {
        resolveHealth!(
          new Response(JSON.stringify(defaultHealth), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        await vi.advanceTimersByTimeAsync(100)
      })

      // Waking banner removed
      expect(screen.queryByText(/waking up the server/i)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('instructions bar and system prompt', () => {
  it('typing into system-prompt-input works directly without any click', async () => {
    const user = userEvent.setup()
    mount()

    const input = screen.getByTestId('system-prompt-input') as HTMLTextAreaElement
    expect(input).toBeTruthy()
    await user.type(input, 'You are a poetic assistant.')
    expect(input.value).toBe('You are a poetic assistant.')
  })

  it('clears on Clear button click and respects maxLength', async () => {
    const user = userEvent.setup()
    mount()

    const input = screen.getByTestId('system-prompt-input') as HTMLTextAreaElement
    expect(input.maxLength).toBe(8000)
    await user.type(input, 'Hello Relay')
    expect(input.value).toBe('Hello Relay')

    const clearBtn = screen.getByRole('button', { name: /clear/i })
    await user.click(clearBtn)
    expect(input.value).toBe('')
  })

  it('displays Custom instructions badge next to composer when set', async () => {
    const user = userEvent.setup()
    mount()

    expect(screen.queryByTestId('custom-instructions-badge')).toBeNull()

    const input = screen.getByTestId('system-prompt-input') as HTMLTextAreaElement
    await user.type(input, 'Custom behavior')
    expect(screen.getByTestId('custom-instructions-badge')).toBeTruthy()

    await user.clear(input)
    expect(screen.queryByTestId('custom-instructions-badge')).toBeNull()
  })

  it('persists system prompt per session and resets on new chat', async () => {
    const sessionKey = 's-persisted-1'
    localStorage.setItem(
      'relay.sessions.v1',
      JSON.stringify([
        {
          id: sessionKey,
          title: 'Math session',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          systemPrompt: 'Be a math tutor.',
        },
      ]),
    )

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes(`/sessions/${sessionKey}/messages`)) {
        return json(200, {
          session_id: sessionKey,
          messages: [{ role: 'user', content: 'hello' }],
        })
      }
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    // Switch to past session
    const pastItem = await screen.findByText('Math session')
    await user.click(pastItem)

    // Restores saved system prompt
    const input = screen.getByTestId('system-prompt-input') as HTMLTextAreaElement
    expect(input.value).toBe('Be a math tutor.')

    // Start a new chat -> system prompt resets to empty
    const newChatBtn = screen.getByRole('button', { name: /new session/i })
    await user.click(newChatBtn)
    expect(input.value).toBe('')
  })
})

describe('message redesign and metadata receipt', () => {
  it('renders markdown bold, lists, and provides a working code copy button', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        return json(
          200,
          okBody({
            reply: 'Here is **important** information and a list:\n- First item\n- Second item\n\n```python\nprint("Hello")\n```',
          }),
        )
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Show markdown{Enter}')

    const msg = await screen.findByTestId('assistant-message')
    expect(msg).toBeTruthy()

    // Bold text rendered as <strong>
    const strongEl = screen.getByText('important')
    expect(strongEl.tagName).toBe('STRONG')

    // List items rendered as <li>
    const liEl = screen.getByText('First item')
    expect(liEl.tagName).toBe('LI')

    // Code block copy button
    const copyBtn = screen.getByRole('button', { name: /copy code to clipboard/i })
    expect(copyBtn).toBeTruthy()
    await user.click(copyBtn)

    // Green toast for copied code
    expect(await screen.findByTestId('toast-success')).toBeTruthy()
  })

  it('renders script tags as inert text without executing', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        return json(200, okBody({ reply: "Safe text <script>window.__pwned = true;</script> end" }))
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Test script tag{Enter}')

    const msg = await screen.findByTestId('assistant-message')
    expect(msg.textContent).toContain('Safe text')
    // No script executed
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('displays Key: cache when key_id is null on LLM_CACHE reply', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        return json(
          200,
          okBody({
            resolution_source: 'LLM_CACHE',
            key_id: null,
            latency_ms: 3,
            original_latency_ms: 236,
          }),
        )
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Cached query{Enter}')

    const msg = await screen.findByTestId('assistant-message')
    expect(within(msg).getByTestId('meta-source').textContent).toBe('LLM_CACHE')

    // Key chip shows "Key: cache", never "none" or "null"
    const keyChip = screen.getByTestId('meta-key-chip')
    expect(keyChip.textContent).toBe('Key: cache')
    expect(keyChip.textContent).not.toMatch(/none|null/i)

    // Original latency savings line
    const savingsLine = screen.getByTestId('cache-savings-line')
    expect(savingsLine.textContent).toBe('Served from cache in 3 ms (live call took 236 ms)')
  })

  it('renders long markdown reply with headings, lists, table, hr, and math', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        return json(
          200,
          okBody({
            reply: `# Top Heading\n\n## Subheading\n\nA regular paragraph with **bold** text.\n\n---\n\n- Bullet 1\n- Bullet 2\n\n1. Numbered 1\n2. Numbered 2\n\n| Column A | Column B |\n| --- | --- |\n| Cell 1 | Cell 2 |\n\nInline math $\\frac{1}{2} \\times \\text{base}$ and block math:\n\n$$a + b > c$$\n\n> A blockquote here.\n\n\`\`\`javascript\nconst x = 42;\n\`\`\``,
          }),
        )
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Complex markdown{Enter}')

    const msg = await screen.findByTestId('assistant-message')
    expect(msg).toBeTruthy()

    // Heading elements
    expect(within(msg).getByRole('heading', { level: 1 }).textContent).toBe('Top Heading')
    expect(within(msg).getByRole('heading', { level: 2 }).textContent).toBe('Subheading')

    // Table elements
    expect(within(msg).getByRole('table')).toBeTruthy()
    expect(within(msg).getByText('Cell 1')).toBeTruthy()

    // Math elements (KaTeX renders .katex)
    expect(msg.querySelector('.katex')).toBeTruthy()

    // Blockquote
    expect(msg.querySelector('blockquote')).toBeTruthy()

    // HR
    expect(msg.querySelector('hr')).toBeTruthy()
  })

  it('never shows or computes token totals anywhere in the message or receipt', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes('/chat')) {
        return json(200, okBody({ input_tokens: 100, output_tokens: 50 }))
      }
      return json(404, {})
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Check tokens{Enter}')

    const msg = await screen.findByTestId('assistant-message')
    // Must contain input and output tokens
    expect(within(msg).getByTestId('meta-input-tokens').textContent).toBe('100')
    expect(within(msg).getByTestId('meta-output-tokens').textContent).toBe('50')

    // Must NOT contain any element or text with the word "total"
    expect(msg.textContent?.toLowerCase()).not.toContain('total')
  })
})

describe('inspector drawer', () => {
  it('opens on inspect button click and closes with close button', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Hello inspector{Enter}')
    await screen.findByTestId('assistant-message')

    // Click inspect button
    const inspectBtn = screen.getByRole('button', { name: /inspect reply/i })
    await user.click(inspectBtn)

    // Drawer is visible
    const drawer = screen.getByTestId('inspector-drawer')
    expect(drawer).toBeTruthy()
    expect(within(drawer).getByText('Request Inspector')).toBeTruthy()
    expect(within(drawer).getByText('gemini/gemini-2.0-flash')).toBeTruthy()
    expect(within(drawer).getByText('Hello inspector')).toBeTruthy()

    // Click close button
    const closeBtn = screen.getByRole('button', { name: /close inspector/i })
    await user.click(closeBtn)

    // Drawer is closed
    expect(screen.queryByTestId('inspector-drawer')).toBeNull()
  })

  it('closes on Escape key and returns focus to inspect trigger button', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Esc test{Enter}')
    await screen.findByTestId('assistant-message')

    const inspectBtn = screen.getByRole('button', { name: /inspect reply/i })
    await user.click(inspectBtn)

    expect(screen.getByTestId('inspector-drawer')).toBeTruthy()

    // Press Escape
    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('inspector-drawer')).toBeNull()
    expect(document.activeElement).toBe(inspectBtn)
  })

  it('renders failover steps in route trace and inline chips in receipt', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(
        200,
        okBody({
          key_id: 'key_2',
          fallback_attempts: 1,
          attempts: [
            { key_id: 'key_1', outcome: 'failed', reason: 'simulated_429' },
            { key_id: 'key_2', outcome: 'ok', reason: 'Success' },
          ],
        }),
      )
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Failover query{Enter}')
    await screen.findByTestId('assistant-message')

    // Inline trace chips visible in receipt
    const inlineTrace = screen.getByTestId('inline-trace')
    expect(inlineTrace.textContent).toContain('key_1')
    expect(inlineTrace.textContent).toContain('key_2')

    // Open drawer
    await user.click(screen.getByRole('button', { name: /inspect reply/i }))

    const routeTrace = screen.getByTestId('inspector-route-trace')
    expect(routeTrace.textContent).toContain('key_1')
    expect(routeTrace.textContent).toContain('Simulated rate limit (429)')
    expect(routeTrace.textContent).toContain('key_2')
  })

  it('renders cache step and saved time for cache hits', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(
        200,
        okBody({
          resolution_source: 'LLM_CACHE',
          key_id: null,
          latency_ms: 12,
          original_latency_ms: 350,
          attempts: [],
        }),
      )
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Cache inspect{Enter}')
    await screen.findByTestId('assistant-message')

    await user.click(screen.getByRole('button', { name: /inspect reply/i }))

    const routeTrace = screen.getByTestId('inspector-route-trace')
    expect(routeTrace.textContent).toContain('Cache')
    expect(routeTrace.textContent).toContain('no provider called')

    const savedRow = screen.getByTestId('cache-saved-time')
    expect(savedRow.textContent).toBe('About 338 ms faster than the live call')
  })

  it('copies cURL and JSON with green toasts', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Copy inspect{Enter}')
    await screen.findByTestId('assistant-message')

    await user.click(screen.getByRole('button', { name: /inspect reply/i }))

    // Copy as cURL
    const curlBtn = screen.getByRole('button', { name: /copy as curl/i })
    await user.click(curlBtn)
    expect(await screen.findByText('cURL copied')).toBeTruthy()

    // Copy JSON
    const jsonBtn = screen.getByRole('button', { name: /copy json/i })
    await user.click(jsonBtn)
    expect(await screen.findByText('JSON copied')).toBeTruthy()
  })

  it('buildCurlCommand formats correct curl and omits simulate header when not used', () => {
    const curlNoSim = buildCurlCommand('http://127.0.0.1:8000', {
      sessionId: 's-123',
      message: 'Hello world',
    })
    expect(curlNoSim).toContain('curl -X POST "http://127.0.0.1:8000/chat"')
    expect(curlNoSim).toContain('"session_id":"s-123"')
    expect(curlNoSim).toContain('"message":"Hello world"')
    expect(curlNoSim).not.toContain('X-Simulate-Failure')
    expect(curlNoSim).not.toContain('system_prompt')

    const curlWithSim = buildCurlCommand('http://127.0.0.1:8000', {
      sessionId: 's-456',
      message: 'Sim test',
      systemPromptUsed: 'Be concise',
      simulateHeader: 'key_1=429',
    })
    expect(curlWithSim).toContain('-H "X-Simulate-Failure: key_1=429"')
    expect(curlWithSim).toContain('"system_prompt":"Be concise"')
    // Never contains any API key or bearer secret
    expect(curlWithSim).not.toContain('Authorization')
    expect(curlWithSim).not.toContain('api_key')
    expect(curlWithSim).not.toContain('Bearer')
  })

  it('resilient to missing metadata fields and missing request object', async () => {
    const pastSessionId = 's-legacy-drawer'
    localStorage.setItem(
      'relay.sessions.v1',
      JSON.stringify([
        {
          id: pastSessionId,
          title: 'Legacy message',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    )

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      if (url.includes(`/sessions/${pastSessionId}/messages`)) {
        return json(200, {
          session_id: pastSessionId,
          messages: [
            { role: 'user', content: 'What is life?' },
            {
              role: 'assistant',
              content: '42',
              // completely stripped metadata
              metadata: {},
            },
          ],
        })
      }
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    const item = await screen.findByText('Legacy message')
    await user.click(item)

    await screen.findByText('42')

    // Click inspect
    await user.click(screen.getByRole('button', { name: /inspect reply/i }))

    // Drawer opens without crashing
    const drawer = screen.getByTestId('inspector-drawer')
    expect(drawer).toBeTruthy()
    expect(within(drawer).getByText('Request Inspector')).toBeTruthy()
    // Latency shows '—'
    expect(within(drawer).getByText('Latency')).toBeTruthy()
  })
})

describe('final polish: shortcuts, toasts, empty state, and composer limits', () => {
  it('recalls last sent message when pressing Up arrow in empty composer', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    await user.type(input, 'First sent query{Enter}')
    await screen.findByTestId('assistant-message')
    expect(input.value).toBe('')

    // Press Up arrow in empty composer
    await user.type(input, '{ArrowUp}')
    expect(input.value).toBe('First sent query')
  })

  it('handles Ctrl/Cmd+K for new session and Ctrl/Cmd+/ to focus composer', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Hello session{Enter}')
    await screen.findByTestId('assistant-message')

    const initialId = screen.getByTestId('session-id').textContent

    // Press Ctrl+K
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByTestId('assistant-message')).toBeNull()
    expect(screen.getByTestId('session-id').textContent).not.toBe(initialId)

    // Blur input
    const input = screen.getByTestId('chat-input')
    input.blur()
    expect(document.activeElement).not.toBe(input)

    // Press Ctrl+/
    await user.keyboard('{Control>}/{/Control}')
    expect(document.activeElement).toBe(input)
  })

  it('empty state suggestion buttons populate prompt', async () => {
    const user = userEvent.setup()
    mount()

    const empty = screen.getByTestId('empty-state')

    // Failover suggestion
    const failoverBtn = within(empty).getByRole('button', { name: /explain failover in one sentence/i })
    await user.click(failoverBtn)

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement
    expect(input.value).toBe('Explain failover in one sentence')

    // Cache suggestion
    const cacheBtn = within(empty).getByRole('button', { name: /explain caching in two sentences/i })
    await user.click(cacheBtn)
    expect(input.value).toBe('Explain caching in two sentences')

    // Token comparison suggestion
    const tokenBtn = within(empty).getByRole('button', { name: /compare gemini and claude tokens/i })
    await user.click(tokenBtn)
    expect(input.value).toBe('Compare Gemini and Claude tokens')
  })

  it('de-duplicates identical toasts within 2 seconds', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(200, okBody())
    })

    const user = userEvent.setup()
    mount()

    // Trigger copy reply twice quickly
    await user.type(screen.getByTestId('chat-input'), 'Toast test{Enter}')
    await screen.findByTestId('assistant-message')

    const copyBtn = screen.getByRole('button', { name: /copy reply/i })
    await user.click(copyBtn)
    await user.click(copyBtn)

    // Should only have 1 toast-success element in the DOM
    const successToasts = screen.getAllByTestId('toast-success')
    expect(successToasts).toHaveLength(1)
  })

  it('security: markdown escaping prevents script execution and localStorage stores no secrets', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) return json(200, defaultHealth)
      return json(
        200,
        okBody({
          reply: 'Here is some malicious text: <script>window.__xss = true</script><img src="x" onerror="window.__xss=true" />',
        }),
      )
    })

    const user = userEvent.setup()
    mount()

    await user.type(screen.getByTestId('chat-input'), 'Trigger markdown{Enter}')
    await screen.findByTestId('assistant-message')

    // Confirm no raw <script> tag was inserted into DOM
    expect(document.querySelector('script:not([src])')).toBeNull()
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined()

    // Confirm localStorage relay.sessions.v1 never stores secrets
    const storedRaw = localStorage.getItem('relay.sessions.v1')
    if (storedRaw) {
      expect(storedRaw).not.toContain('api_key')
      expect(storedRaw).not.toContain('key_1')
      expect(storedRaw).not.toContain('secret')
    }
  })

  describe('topbar and sidebar redesign', () => {
    it('displays full session id in data-testid="session-id"', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      mount()
      const sessionSpan = screen.getByTestId('session-id')
      expect(sessionSpan.textContent).toBeTruthy()
      expect(sessionSpan.textContent).toMatch(/^s-[a-z0-9]+$/)
      expect(sessionSpan.textContent).not.toContain('…')
      expect(sessionSpan.textContent).not.toContain('...')
    })

    it('Copy button switches to Copied for 1.5s on click and does NOT show a toast', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      const user = userEvent.setup()
      mount()

      const copyBtn = screen.getByRole('button', { name: /copy session id/i })
      expect(copyBtn.textContent).toBe('Copy')

      await user.click(copyBtn)
      expect(copyBtn.textContent).toBe('Copied')

      // Ensure no toast appeared
      expect(screen.queryByTestId('toast-success')).toBeNull()
      expect(screen.queryByTestId('toast-error')).toBeNull()
    })

    it('only one New chat button is visible depending on sidebar open/collapsed state', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      const user = userEvent.setup()
      mount()

      // By default on desktop, sidebar is open: 1 New chat button in sidebar
      const newChatBtnsOpen = screen.getAllByRole('button', { name: /new session/i })
      expect(newChatBtnsOpen).toHaveLength(1)
      expect(newChatBtnsOpen[0].closest('.sidebar')).toBeTruthy()

      // Toggle sidebar to collapse it
      const toggleBtn = screen.getByRole('button', { name: /toggle sessions navigation/i })
      await user.click(toggleBtn)

      // Now sidebar is collapsed: 1 New chat button in topbar
      const newChatBtnsCollapsed = screen.getAllByRole('button', { name: /new session/i })
      expect(newChatBtnsCollapsed).toHaveLength(1)
      expect(newChatBtnsCollapsed[0].closest('.topbar')).toBeTruthy()
    })

    it('status pill displays Online with tooltip from health info, Connecting, and Offline', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) {
          return json(200, { status: 'ok', keys_configured: 3, cache_enabled: true })
        }
        return json(200, okBody())
      })

      mount()

      await waitFor(() => {
        const statusPill = screen.getByTitle('3 keys, cache on')
        expect(statusPill).toBeTruthy()
        expect(statusPill.textContent).toContain('Online')
      })
    })

    it('shows active indicator for system prompt and omits obsolete helper text', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      const user = userEvent.setup()
      mount()

      // Obsolete helper is never shown
      expect(screen.queryByText(/Used for this chat\. Start a new chat to remove it\./i)).toBeNull()

      // Before entering prompt, Active badge is not shown
      expect(screen.queryByTitle(/Custom system prompt is active/i)).toBeNull()

      // Type prompt -> Active badge appears
      await user.type(screen.getByTestId('system-prompt-input'), 'Be concise.')
      expect(screen.getByTitle(/Custom system prompt is active/i)).toBeTruthy()
    })

    it('request body omits system_prompt when empty', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      const user = userEvent.setup()
      mount()

      await user.type(screen.getByTestId('chat-input'), 'hello{Enter}')
      await screen.findByTestId('assistant-message')

      const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat'))!
      const body = JSON.parse(chatCall[1].body)
      expect(body.system_prompt).toBeUndefined()
    })
  })

  describe('failure simulation feature', () => {
    it('is hidden when failure_simulation is false in health', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) {
          return json(200, { ...defaultHealth, failure_simulation: false })
        }
        return json(200, okBody())
      })

      mount()
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /simulate failure/i })).toBeNull()
      })
    })

    it('popover options produce the exact header values and tag is shown', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(200, okBody())
      })

      const user = userEvent.setup()
      mount()

      const trigger = await screen.findByRole('button', { name: /simulate failure/i })
      await user.click(trigger)

      // Popover should be open
      expect(screen.getByRole('dialog', { name: /simulate failure options/i })).toBeTruthy()

      // Choose "key_1 fails with 429"
      const opt = screen.getByLabelText(/key_1 fails with 429/i)
      await user.click(opt)

      // Popover closes, tag is visible in composer
      expect(screen.queryByRole('dialog', { name: /simulate failure options/i })).toBeNull()
      expect(screen.getByText(/Next message: key_1=429/i)).toBeTruthy()

      // Send a message
      await user.type(screen.getByTestId('chat-input'), 'simulate test{Enter}')
      await screen.findByTestId('assistant-message')

      // Verify the request header had X-Simulate-Failure: key_1=429
      const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat'))!
      expect(chatCall[1].headers['X-Simulate-Failure']).toBe('key_1=429')

      // One-shot reset: tag is gone and next send has no simulate header
      expect(screen.queryByText(/Next message:/i)).toBeNull()

      await user.type(screen.getByTestId('chat-input'), 'next test{Enter}')
      await waitFor(() =>
        expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))).toHaveLength(2),
      )
      const secondCall = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat'))[1]
      expect(secondCall[1].headers['X-Simulate-Failure']).toBeUndefined()
    })

    it('one-shot resets after an error as well', async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/health')) return json(200, defaultHealth)
        return json(503, { detail: 'all providers unavailable' })
      })

      const user = userEvent.setup()
      mount()

      const trigger = await screen.findByRole('button', { name: /simulate failure/i })
      await user.click(trigger)
      await user.click(screen.getByLabelText(/all keys fail with 429/i))

      expect(screen.getByText(/Next message: \*=429/i)).toBeTruthy()

      // Send message inducing 503 error
      await user.type(screen.getByTestId('chat-input'), 'fail please{Enter}')
      await screen.findByTestId('chat-error')

      // Tag must be reset
      expect(screen.queryByText(/Next message:/i)).toBeNull()
    })
  })
})
