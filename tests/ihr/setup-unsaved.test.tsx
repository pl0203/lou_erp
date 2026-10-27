import { StrictMode, useLayoutEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useSetupUnsaved } from '../../src/pages/ihr/leave/useSetupUnsaved'

afterEach(cleanup)

function warned() {
 const event = new Event('beforeunload', { cancelable: true })
 window.dispatchEvent(event)
 return event.defaultPrevented
}

// Observe the committed draft before passive effects run. Waiting for them
// would hide the interval in which the visible form and unload guard disagree.
function CommitProbe({ dirty, observed }: { dirty: boolean; observed: boolean[] }) {
 useSetupUnsaved(dirty)
 useLayoutEffect(() => { observed.push(warned()) }, [dirty, observed])
 return <p>{dirty ? 'Unsaved draft' : 'Saved draft'}</p>
}

test('a committed clean draft immediately releases the unload warning', () => {
 const observed: boolean[] = []
 const view = render(<CommitProbe dirty={true} observed={observed} />)
 expect(warned()).toBe(true)
 observed.length = 0
 view.rerender(<CommitProbe dirty={false} observed={observed} />)
 expect(observed).toEqual([false])
 expect(warned()).toBe(false)
})

test('a committed dirty draft is immediately protected before passive effects', () => {
 const observed: boolean[] = []
 const view = render(<CommitProbe dirty={false} observed={observed} />)
 expect(warned()).toBe(false)
 observed.length = 0
 view.rerender(<CommitProbe dirty={true} observed={observed} />)
 expect(observed).toEqual([true])
 expect(warned()).toBe(true)
})

test('strict-mode remounts and unmounts leave no stale unload guard', () => {
 const observed: boolean[] = []
 const view = render(<StrictMode><CommitProbe dirty={true} observed={observed} /></StrictMode>)
 expect(warned()).toBe(true)
 view.unmount()
 expect(warned()).toBe(false)
})

test('saving one editor does not remove another editor’s unload guard', () => {
 const observed: boolean[] = []
 const view = render(<><CommitProbe dirty={true} observed={observed} /><CommitProbe dirty={true} observed={observed} /></>)
 view.rerender(<><CommitProbe dirty={false} observed={observed} /><CommitProbe dirty={true} observed={observed} /></>)
 expect(warned()).toBe(true)
 view.rerender(<><CommitProbe dirty={false} observed={observed} /><CommitProbe dirty={false} observed={observed} /></>)
 expect(warned()).toBe(false)
})
