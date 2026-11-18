import { describe, expect, it } from 'vitest'
import { HistoryStore } from './history'

function entry(id: string, cost: number, layerId = 'layer-1') {
  return { id, layerId, cost }
}

describe('HistoryStore', () => {
  it('evicts old entries and preserves the shared cost across undo and redo', () => {
    const history = new HistoryStore<ReturnType<typeof entry>>(100)
    const first = entry('first', 60)
    const second = entry('second', 50)
    history.push(first)
    history.push(second)

    expect(history.size).toBe(50)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe(second)
    expect(history.size).toBe(50)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.redo()).toBe(second)
    expect(history.size).toBe(50)
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
  })

  it('discards redo cost on a new entry before applying the budget', () => {
    const history = new HistoryStore<ReturnType<typeof entry>>(100)
    const first = entry('first', 60)
    const second = entry('second', 50)
    const third = entry('third', 40)
    const fourth = entry('fourth', 30)
    history.push(first)
    history.push(second)
    history.push(third)
    expect(history.undo()).toBe(third)
    expect(history.size).toBe(90)

    history.push(fourth)

    expect(history.size).toBe(80)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe(fourth)
    expect(history.undo()).toBe(second)
    expect(history.undo()).toBeUndefined()
    expect(history.size).toBe(80)
  })

  it('always keeps one entry even when it exceeds the budget', () => {
    const history = new HistoryStore<ReturnType<typeof entry>>(100)
    const large = entry('large', 500)
    history.push(large)

    expect(history.size).toBe(500)
    expect(history.undo()).toBe(large)
    expect(history.canRedo).toBe(true)
  })

  it('drops matching entries from both stacks and recomputes the cost', () => {
    const history = new HistoryStore<ReturnType<typeof entry>>(1000)
    const first = entry('first', 30, 'layer-1')
    const second = entry('second', 40, 'layer-2')
    const third = entry('third', 50, 'layer-1')
    history.push(first)
    history.push(second)
    history.push(third)
    expect(history.undo()).toBe(third)

    history.dropLayer('layer-1')

    expect(history.size).toBe(40)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe(second)
    expect(history.undo()).toBeUndefined()
  })

  it('clears both stacks and the cost when the document changes', () => {
    const history = new HistoryStore<ReturnType<typeof entry>>(100)
    history.push(entry('first', 60))
    expect(history.undo()).toBeDefined()

    history.clear()

    expect(history.size).toBe(0)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBeUndefined()
  })
})
