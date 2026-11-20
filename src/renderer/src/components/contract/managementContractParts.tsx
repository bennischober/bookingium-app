import type { ContractParty } from '../../../../main/api/schemas/contract.schema'

// Building blocks shared by the German and English management contract

export function Section({
  number,
  title,
  children
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-[11pt] font-bold">
        § {number} {title}
      </h3>
      <div className="space-y-2 text-[10pt] leading-relaxed text-justify">{children}</div>
    </div>
  )
}

export function PartyBlock({ party, fallback }: { party: ContractParty | null; fallback: string }) {
  if (!party) return <div className="font-bold">{fallback}</div>
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
