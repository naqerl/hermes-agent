import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandPalette } from './index'
import { $commandPaletteOpen, closeCommandPalette, openCommandPalette } from '@/store/command-palette'
import { onComposerFocusRequest } from '@/app/chat/composer/focus'

// The CommandPalette queries the Hermes gateway on mount. Mock everything that
// would reach out to the real backend.
vi.mock('@/hermes', () => ({
  getHermesConfigRecord: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 })
}))

// Notifications use nanostores and timers we don't need here.
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

// cmdk uses ResizeObserver + scrollIntoView on mount. jsdom doesn't ship
// either — stub no-op shims. Matches the pattern in tool-approval-group.test.tsx
// and streaming.test.tsx.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0 }
  }
})

/**
 * Mirror the real ChatBar: a contentEditable div that subscribes to the
 * composer-focus event bus. The fix under test wires the CommandPalette to
 * this same bus, so observing the bus is the most direct way to verify
 * the fix's contract — independent of jsdom's spotty focus() behavior on
 * contenteditable elements.
 */
function ComposerSim() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = onComposerFocusRequest(() => {
      ref.current?.focus()
    })
    return unsub
  }, [])

  return (
    <div
      ref={ref}
      contentEditable
      data-testid="composer"
      role="textbox"
      suppressContentEditableWarning
    />
  )
}

function Page({ children }: { children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  $commandPaletteOpen.set(false)
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  $commandPaletteOpen.set(false)
})

/**
 * Helper: open + close the palette, then wait for the bus to fire.
 *
 * The actual close path in jsdom takes a few ticks because Radix waits for
 * the close animation cycle, and the exact timing depends on what was
 * focused when the palette opened. vi.waitFor polls until the assertion
 * passes, so the test is robust across machines and prior-focus scenarios.
 */
async function openAndCloseAndWaitForBusFire(busSpy: ReturnType<typeof vi.fn>) {
  openCommandPalette()
  // Yield to let the Dialog commit the open transition.
  await new Promise(resolve => setTimeout(resolve, 0))
  closeCommandPalette()
  await vi.waitFor(() => expect(busSpy).toHaveBeenCalledWith('main'), { timeout: 2000 })
}

describe('CommandPalette focus restoration', () => {
  it('routes close to the composer-focus bus when the composer was focused before opening', async () => {
    // When the composer was focused before opening, the fix still routes
    // through the bus on close. This is the same code path as every other
    // close — the bus is the single source of truth for "where focus goes
    // after Cmd+K", not whatever element happened to be focused when the
    // palette opened. (We don't assert activeElement here because jsdom's
    // focus() on contenteditable is unreliable; we assert the bus instead,
    // which is the actual unit-under-test.)
    const busSpy = vi.fn()
    const unsub = onComposerFocusRequest(busSpy)

    render(
      <Page>
        <ComposerSim />
        <CommandPalette />
      </Page>
    )

    const composer = document.querySelector('[data-testid="composer"]') as HTMLDivElement
    composer.focus()

    await openAndCloseAndWaitForBusFire(busSpy)

    unsub()
  })

  it('routes close to the composer-focus bus when focus was on a non-composer element', async () => {
    // Regression: the old "save document.activeElement on open, restore on
    // close" approach could route focus to a sidebar button or other
    // non-composer element. The fix dispatches the bus unconditionally, so
    // the bus fires regardless of what was focused when the palette opened.
    const sidebar = document.createElement('button')
    sidebar.setAttribute('data-testid', 'sidebar-button')
    document.body.appendChild(sidebar)

    const busSpy = vi.fn()
    const unsub = onComposerFocusRequest(busSpy)

    render(
      <Page>
        <ComposerSim />
        <CommandPalette />
      </Page>
    )

    sidebar.focus()
    expect(document.activeElement).toBe(sidebar)

    await openAndCloseAndWaitForBusFire(busSpy)

    unsub()
  })

  it('routes close to the composer-focus bus when nothing was focused', async () => {
    // Cmd+K is a global hotkey — it can fire with no element focused.
    const busSpy = vi.fn()
    const unsub = onComposerFocusRequest(busSpy)

    render(
      <Page>
        <ComposerSim />
        <CommandPalette />
      </Page>
    )

    await openAndCloseAndWaitForBusFire(busSpy)

    unsub()
  })

  it('does not dispatch the bus while the palette is still open', async () => {
    // Guard against a regression where the fix dispatches on every render.
    const busSpy = vi.fn()
    const unsub = onComposerFocusRequest(busSpy)

    render(
      <Page>
        <ComposerSim />
        <CommandPalette />
      </Page>
    )

    openCommandPalette()
    // Wait long enough that any spurious bus dispatch would have fired.
    // If this test ever flakes, the bus is being dispatched on open — which
    // is a real bug — so the long wait is the right kind of safety net.
    await new Promise(resolve => setTimeout(resolve, 200))
    unsub()

    expect(busSpy).not.toHaveBeenCalled()
  })
})
