import type { ContractParty } from '../../../../main/api/schemas/contract.schema'

// Building blocks shared by the German and English concert contract

// ========================================
// Section primitives
// ========================================

export function Section({
  number,
  title,
  children
}: {
  /** Null: the optional section is not printed (see contractSectionNumbers) */
  number: number | null
  title: string
  children: React.ReactNode
}) {
  if (number === null) return null
  return (
    <div className="mb-3">
      <h3 className="font-bold text-[12pt] underline mb-1">
        {number}. {title}
      </h3>
      <div className="space-y-2 text-[10pt] leading-relaxed text-justify">{children}</div>
    </div>
  )
}

export function AddressLines({ party }: { party: ContractParty }) {
  return (
    <div className="leading-snug">
      <div className="font-bold">{party.name}</div>
      {(party.street || party.streetNumber) && (
        <div>
          {party.street} {party.streetNumber}
        </div>
      )}
      {(party.zipCode || party.city) && (
        <div>
          {party.zipCode} {party.city}
        </div>
      )}
    </div>
  )
}
