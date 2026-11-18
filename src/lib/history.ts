export interface HistoryEntry {
  layerId: string
  cost: number
}

function entriesCost<T extends HistoryEntry>(entries: T[]): number {
  return entries.reduce((sum, entry) => sum + entry.cost, 0)
}

export class HistoryStore<T extends HistoryEntry> {
  private undoStack: T[] = []
  private redoStack: T[] = []
  private totalCost = 0
  private readonly budget: number

  constructor(budget: number) {
    this.budget = budget
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  get size() { return this.totalCost }

  push(entry: T) {
    this.totalCost -= entriesCost(this.redoStack)
    this.redoStack = []
    this.undoStack.push(entry)
    this.totalCost += entry.cost
    while (this.totalCost > this.budget && this.undoStack.length > 1) {
      this.totalCost -= this.undoStack.shift()!.cost
    }
  }

  undo(): T | undefined {
    const entry = this.undoStack.pop()
    if (entry) this.redoStack.push(entry)
    return entry
  }

  redo(): T | undefined {
    const entry = this.redoStack.pop()
    if (entry) this.undoStack.push(entry)
    return entry
  }

  dropLayer(layerId: string) {
    this.undoStack = this.undoStack.filter(entry => entry.layerId !== layerId)
    this.redoStack = this.redoStack.filter(entry => entry.layerId !== layerId)
    this.totalCost = entriesCost(this.undoStack) + entriesCost(this.redoStack)
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
    this.totalCost = 0
  }
}
