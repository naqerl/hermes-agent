import { beforeEach, describe, expect, it } from 'vitest'

import {
  findLineBounds,
  killToEndOfLine,
  moveCaretTo
} from './composer-keybindings'

function makeEditor(html: string): HTMLDivElement {
  const div = document.createElement('div')
  div.id = 'ed'
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

beforeEach(() => {
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('findLineBounds', () => {
  it('returns start=0, end=text length for a single-line editor at any caret position', () => {
    const editor = makeEditor('hello world')
    const { start, end } = findLineBounds(editor, 6)

    expect(start).toBe(0)
    expect(end).toBe('hello world'.length)
  })

  it('caps the end at the next newline for mid-line offsets', () => {
    // jsdom's textContent does not normalize <br> to '\n', so use an
    // explicit text node with a real '\n'.
    const editor = document.createElement('div')
    editor.appendChild(document.createTextNode('first\nsecond'))
    document.body.appendChild(editor)

    const { end } = findLineBounds(editor, 2)

    expect(end).toBe(5) // length of "first"
  })
})

describe('moveCaretTo', () => {
  it('returns true and places the caret when the offset is in range', () => {
    const editor = makeEditor('hello')
    const ok = moveCaretTo(editor, 3)

    expect(ok).toBe(true)
    const sel = window.getSelection()!
    expect(sel.rangeCount).toBe(1)
  })

  it('returns false when the editor has no text', () => {
    const editor = makeEditor('')
    expect(moveCaretTo(editor, 0)).toBe(false)
  })
})

describe('killToEndOfLine', () => {
  it('returns the killed text and updates the DOM', () => {
    const editor = makeEditor('hello world')
    // Place caret at offset 6 (between "hello " and "world")
    moveCaretTo(editor, 6)
    const killed = killToEndOfLine(editor, 6)

    expect(killed).toBe('world')
    expect(editor.textContent).toBe('hello ')
  })

  it('returns empty string when caret is at end of line', () => {
    const editor = makeEditor('hello')
    const killed = killToEndOfLine(editor, 5)

    expect(killed).toBe('')
    expect(editor.textContent).toBe('hello')
  })
})
