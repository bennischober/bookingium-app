import type { ReactNode } from 'react'
import type { ContractParty } from '../../../../main/api/schemas/contract.schema'

// Building blocks of the publishing and label agreements: numbered sections whose paragraphs
// are numbered "3.1", "3.2" …, as in the templates

export type AgreementParagraph = { key: string; content: ReactNode; unnumbered?: boolean }
export type AgreementSection = { key: string; title: string; paragraphs: AgreementParagraph[] }

/** Sections numbered 1, 2, … and their paragraphs 1.1, 1.2, … (left out ones leave no gap) */
export function NumberedSections({ sections }: { sections: AgreementSection[] }) {
  return (
    <>
      {sections.map((section, index) => {
        let paragraph = 0
        return (
          <div key={section.key} className="mb-4">
            <h3 className="mb-1 text-[11pt] font-bold">
              {index + 1}. {section.title}
            </h3>
            <div className="space-y-2 text-justify text-[10pt] leading-relaxed">
              {section.paragraphs.map((p) =>
                p.unnumbered ? (
                  <div key={p.key} className="pl-8">
                    {p.content}
                  </div>
                ) : (
                  <div key={p.key} className="flex gap-2">
                    <span className="w-8 shrink-0">
                      {index + 1}.{++paragraph}
                    </span>
                    <div className="min-w-0 flex-1">{p.content}</div>
                  </div>
                )
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

export function PartyLines({ party, fallback }: { party: ContractParty | null; fallback: string }) {
  if (!party) return <div className="font-bold">{fallback}</div>
  const street = [party.street, party.streetNumber].filter(Boolean).join(' ')
  const city = [party.zipCode, party.city].filter(Boolean).join(' ')
  return (
    <div className="leading-snug">
      <div className="font-bold">{party.name}</div>
      {street && <div>{street}</div>}
      {city && <div>{city}</div>}
      {party.country && <div>{party.country}</div>}
    </div>
  )
}

/** Two signature blocks side by side: place and date are left to the signing parties */
export function SignatureBlocks({
  left,
  right,
  placeDate
}: {
  left: { role: string; name: string; city: string }
  right: { role: string; name: string; city: string }
  /** "Ort, Datum" / "Place, Date" */
  placeDate: string
}) {
  return (
    <div className="mt-12 flex break-before-avoid break-inside-avoid text-[10pt]">
      {[left, right].map((side) => (
        <div key={side.role} className="w-1/2 pr-8">
          <div>{side.city ? `${side.city}, ____________` : '____________, ____________'}</div>
          <div className="text-[8pt] text-neutral-600">{placeDate}</div>
          <div className="mt-2 h-[15mm]" />
          <div className="mt-2 w-4/5 border-t-2 border-black pt-1">
            {side.role}
            {side.name && <div>{side.name}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
