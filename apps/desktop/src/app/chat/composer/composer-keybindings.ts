/**
 * Pure-DOM helpers for Emacs-style cursor movement and kill actions on
 * the desktop chat composer (contentEditable). The keydown handler in
 * `index.tsx` calls these in response to C-f / M-f / M-b / C-a / C-e / C-k.
 *
 * The range math is testable in jsdom (no Selection.modify needed — that's
 * a browser-only API). The handler in index.tsx wraps each helper with a
 * Selection.modify call for word/char movement, and a synthetic input
 * event for kill so React state stays in sync.
 */

/** Offsets of the line containing `caret` within the editor's plain text. */
export function findLineBounds(
  editor: HTMLDivElement,
  caret: number
): { start: number; end: number } {
  const text = editor.textContent ?? ''
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
  const newlineIdx = text.indexOf('\n', caret)
  const lineEnd = newlineIdx === -1 ? text.length : newlineIdx

  return { start: lineStart, end: lineEnd }
}

/**
 * Place a collapsed caret at `offset` within the editor's text. Returns
 * false (and leaves the selection alone) when the editor is empty.
 */
export function moveCaretTo(
  editor: HTMLDivElement,
  offset: number
): boolean {
  const text = editor.textContent ?? ''

  if (text.length === 0) {
    return false
  }

  const range = document.createRange()

  if (offset <= 0) {
    range.setStart(editor, 0)
    range.collapse(true)
  } else if (offset >= text.length) {
    range.selectNodeContents(editor)
    range.collapse(false)
  } else {
    // Walk text nodes to find the container holding `offset`.
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let node = walker.nextNode() as Text | null

    while (node) {
      const len = node.data.length

      if (consumed + len >= offset) {
        range.setStart(node, offset - consumed)
        range.collapse(true)
        break
      }

      consumed += len
      node = walker.nextNode() as Text | null
    }
  }

  const sel = window.getSelection()

  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }

  return true
}

/**
 * Delete the text from `caret` to the end of the current line, return it.
 * The consumer is responsible for dispatching an `input` event so the
 * React state mirror (`draftRef` / `aui.composer().setText`) re-syncs.
 */
export function killToEndOfLine(
  editor: HTMLDivElement,
  caret: number
): string {
  const { end } = findLineBounds(editor, caret)

  if (end <= caret) {
    return ''
  }

  const sel = window.getSelection()

  if (!sel) {
    return ''
  }

  // Build the start and end text-node positions.
  const startInfo = findTextNodeAt(editor, caret)
  const endInfo = findTextNodeAt(editor, end)

  if (!startInfo || !endInfo) {
    return ''
  }

  const range = document.createRange()
  range.setStart(startInfo.node, startInfo.offset)
  range.setEnd(endInfo.node, endInfo.offset)
  const killed = range.toString()
  range.deleteContents()

  // After deletion, place caret at the kill point.
  moveCaretTo(editor, caret)

  return killed
}

function findTextNodeAt(
  editor: HTMLDivElement,
  offset: number
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let node = walker.nextNode() as Text | null

  while (node) {
    const len = node.data.length

    if (consumed + len >= offset) {
      return { node, offset: offset - consumed }
    }

    consumed += len
    node = walker.nextNode() as Text | null
  }

  return null
}
