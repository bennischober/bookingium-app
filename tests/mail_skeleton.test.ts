// S1: core/skeleton.ts over handcrafted BODYSTRUCTURE trees (shaped like imapflow's parse): the
// sections it asks for, the structures it gives up on, the assembly and the size estimates. The
// equivalence with the full message is proven against Dovecot in mail_skeleton_sandbox.test.ts.
import { describe, expect, it } from 'vitest'
import type { MessageStructureObject } from 'imapflow'
import { parseMessage } from '../src/main/mailclient/core/parse'
import {
  buildSkeleton,
  estimatedPartSizes,
  skeletonSections
} from '../src/main/mailclient/core/skeleton'

type Node = Partial<MessageStructureObject> & { type: string }
const s = (n: Node): MessageStructureObject => n as MessageStructureObject

const text = (part: string, extra: Node | object = {}): Node => ({
  part,
  type: 'text/plain',
  encoding: '7bit',
  size: 10,
  ...extra
})
const pdf = (part: string, size = 78_000): Node => ({
  part,
  type: 'application/pdf',
  encoding: 'base64',
  size,
  disposition: 'attachment'
})

describe('skeletonSections', () => {
  it('asks for the body of a single-part text message only', () => {
    expect(skeletonSections(s({ type: 'text/plain', size: 10 }))).toEqual(['TEXT'])
  })

  it('asks for nothing but the header of a single-part attachment', () => {
    expect(skeletonSections(s({ type: 'application/pdf', encoding: 'base64', size: 900 }))).toEqual(
      []
    )
  })

  it('asks for every part header but only the text bodies', () => {
    const root = s({
      type: 'multipart/mixed',
      parameters: { boundary: 'o' },
      childNodes: [
        {
          part: '1',
          type: 'multipart/alternative',
          parameters: { boundary: 'i' },
          childNodes: [text('1.1'), { ...text('1.2'), type: 'text/html' }]
        },
        pdf('2'),
        text('3', { disposition: 'attachment' })
      ] as MessageStructureObject[]
    })
    expect(skeletonSections(root)).toEqual([
      '1.MIME',
      '1.1.MIME',
      '1.1',
      '1.2.MIME',
      '1.2',
      '2.MIME',
      '3.MIME'
    ])
  })

  it('keeps images with a Content-ID, drops images without', () => {
    const root = s({
      type: 'multipart/related',
      parameters: { boundary: 'r' },
      childNodes: [
        { ...text('1'), type: 'text/html' },
        { part: '2', type: 'image/png', id: '<a@example.test>', encoding: 'base64', size: 500 },
        { part: '3', type: 'image/png', encoding: 'base64', size: 500 }
      ] as MessageStructureObject[]
    })
    expect(skeletonSections(root)).toEqual(['1.MIME', '1', '2.MIME', '2', '3.MIME'])
  })

  it('reads an attached message through its header and its text', () => {
    const root = s({
      type: 'multipart/mixed',
      parameters: { boundary: 'o' },
      childNodes: [
        text('1'),
        { part: '2', type: 'message/rfc822', size: 300, childNodes: [text('2')] }
      ] as MessageStructureObject[]
    })
    expect(skeletonSections(root)).toEqual(['1.MIME', '1', '2.MIME', '2.HEADER', '2.TEXT'])
  })

  it('gives up on structures it does not cover', () => {
    // a multipart without a boundary
    expect(skeletonSections(s({ type: 'multipart/mixed', childNodes: [s(text('1'))] }))).toBeNull()
    // a multipart without children
    expect(
      skeletonSections(
        s({ type: 'multipart/mixed', parameters: { boundary: 'o' }, childNodes: [] })
      )
    ).toBeNull()
    // a top-level message/rfc822 (no part number to fetch its header by)
    expect(skeletonSections(s({ type: 'message/rfc822', childNodes: [s(text('1'))] }))).toBeNull()
    // a child without a part number
    expect(
      skeletonSections(
        s({
          type: 'multipart/mixed',
          parameters: { boundary: 'o' },
          childNodes: [s({ type: 'text/plain' })]
        })
      )
    ).toBeNull()
  })
})

describe('buildSkeleton', () => {
  const root = s({
    type: 'multipart/mixed',
    parameters: { boundary: 'o' },
    childNodes: [text('1'), pdf('2')] as MessageStructureObject[]
  })
  const header = Buffer.from(
    'From: a@example.test\r\nSubject: s\r\nContent-Type: multipart/mixed; boundary="o"\r\n\r\n'
  )
  const sections = () =>
    new Map([
      ['1.mime', Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n')],
      ['1', Buffer.from('Hallo')],
      // servers differ in the blank line a header section ends with
      [
        '2.MIME',
        Buffer.from(
          'Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="x.pdf"\r\n'
        )
      ]
    ])

  it('assembles a message mailparser reads, whatever the case of the section keys', async () => {
    const skeleton = buildSkeleton(root, header, sections())
    expect(skeleton).not.toBeNull()
    const parsed = await parseMessage(skeleton!)
    expect(parsed.text?.trim()).toBe('Hallo')
    expect(parsed.attachments.map((a) => [a.partId, a.filename, a.size])).toEqual([
      ['2', 'x.pdf', 0]
    ])
  })

  it('is null when a section is missing', () => {
    const missing = sections()
    missing.delete('1')
    expect(buildSkeleton(root, header, missing)).toBeNull()
  })

  it('is null for a structure it does not cover', () => {
    expect(
      buildSkeleton(s({ type: 'multipart/mixed', childNodes: [] }), header, sections())
    ).toBeNull()
  })
})

describe('estimatedPartSizes', () => {
  it('estimates decoded sizes by part, the attached message by its own size', () => {
    const root = s({
      type: 'multipart/mixed',
      parameters: { boundary: 'o' },
      childNodes: [
        text('1'),
        pdf('2', 78_000),
        {
          part: '3',
          type: 'message/rfc822',
          encoding: '7bit',
          size: 300,
          childNodes: [text('3', { size: 40 })]
        }
      ] as MessageStructureObject[]
    })
    expect([...estimatedPartSizes(root)]).toEqual([
      ['1', 10],
      ['2', 57_000],
      ['3', 300]
    ])
  })

  it("keys a single-part message by '', as ingest stores its missing part id", () => {
    expect([
      ...estimatedPartSizes(s({ type: 'application/pdf', encoding: 'base64', size: 780 }))
    ]).toEqual([['', 570]])
  })
})
