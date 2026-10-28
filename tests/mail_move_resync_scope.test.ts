// G2/L3b: a move resyncs the folders it touched, not the whole mailbox.
//
// Every write used to fire a full syncAll() afterwards. That pass does detectCapabilities plus a
// STATUS per folder with a 150 ms pause between each (requestDelayMs, tuned for IONOS), so a
// ten-folder mailbox paid roughly 1.5 seconds of pure sleeping after every single click.
//
// The decision - which folders to resync - is pure, and tested directly. The failure mode is
// silent: asking for one folder too many just brings the delay back, and nothing else notices.
import { describe, expect, it } from 'vitest'
import { foldersToResync } from '../src/main/mailclient/core/resync_scope'

describe('G2/L3b: which folders a move resyncs', () => {
  it('asks for the source and the target of a move', () => {
    expect(foldersToResync([{ folder_path: 'INBOX', target_folder_path: 'Trash' }])).toEqual([
      'INBOX',
      'Trash'
    ])
  })

  it('never asks for a folder the move did not touch', () => {
    // The regression: a full sync asked for every folder, which is what cost the 150 ms pauses
    const paths = foldersToResync([{ folder_path: 'INBOX', target_folder_path: 'Trash' }])
    expect(paths).not.toContain('Archive')
    expect(paths).not.toContain('Sent')
    expect(paths).toHaveLength(2)
  })

  it('asks once for a folder that is both source and target of different ops', () => {
    // Two moves, INBOX->Trash and Trash->Archive: Trash is both a target and a source
    const paths = foldersToResync([
      { folder_path: 'INBOX', target_folder_path: 'Trash' },
      { folder_path: 'Trash', target_folder_path: 'Archive' }
    ])
    expect(paths).toEqual(['INBOX', 'Trash', 'Archive'])
  })

  it('handles a batch that has no target folder', () => {
    // A flag op touches only its source folder
    expect(foldersToResync([{ folder_path: 'INBOX' }])).toEqual(['INBOX'])
  })

  it('ignores a missing folder path instead of asking for ""', () => {
    expect(foldersToResync([{ folder_path: null, target_folder_path: 'Trash' }])).toEqual(['Trash'])
    expect(foldersToResync([{}])).toEqual([])
  })

  it('asks for nothing when no op ran', () => {
    expect(foldersToResync([])).toEqual([])
  })
})
