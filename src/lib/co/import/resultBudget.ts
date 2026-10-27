/** Conservative JSON-sized output budget, not a browser heap guarantee.
 * A UTF-16 code unit needs at most six JSON/UTF-8 bytes (escaped lone surrogate).
 * Counting without stringify/join prevents allocating a rejected serialization.
 */
export const MAX_RESULT_BYTES = 4 * 1024 * 1024

export class ImportBudgetError extends Error {
  constructor(code: 'result_budget' | 'source_text_limit' | 'dereferenced_text_limit') {
    super(code)
  }
}

export class ResultBudget {
  private remaining = MAX_RESULT_BYTES

  reserve(value: unknown, depth = 0): void {
    if (depth > 32) throw new ImportBudgetError('result_budget')
    const charge = (bytes: number) => {
      this.remaining -= bytes
      if (this.remaining < 0) throw new ImportBudgetError('result_budget')
    }
    if (typeof value === 'string') {
      charge(6 * value.length + 3)
    } else if (Array.isArray(value)) {
      charge(2)
      for (const item of value) this.reserve(item, depth + 1)
    } else if (value !== null && typeof value === 'object') {
      charge(2)
      for (const key of Object.keys(value)) {
        charge(6 * key.length + 4)
        this.reserve((value as Record<string, unknown>)[key], depth + 1)
      }
    } else {
      charge(32)
    }
  }
}

export function assertResultBudget(value: unknown): void {
  new ResultBudget().reserve(value)
}
