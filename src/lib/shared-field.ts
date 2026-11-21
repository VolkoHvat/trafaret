import type { Patch } from './field-tiles'

/** Capture original tiles before mutating rho. Commit once per completed operation;
 * cancelled input restores its captured tiles and must not call commit. */
export interface SharedField {
  readonly field: Float64Array
  commit(before: Patch): void
  travel(redo: boolean): void
  readonly canUndo: boolean
  readonly canRedo: boolean
}
