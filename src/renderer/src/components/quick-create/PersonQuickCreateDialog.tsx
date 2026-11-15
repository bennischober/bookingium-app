import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuickCreateDialog } from '@/components/quick-create/QuickCreateDialog'
import type { PersonPrefill } from '@/components/quick-create/personPrefill'

/**
 * A person with name and e-mail. Mount it per opening (see the event wizard),
 * so each one starts from its prefill.
 */
export function PersonQuickCreateDialog({
  isOpen,
  prefill,
  onClose,
  onCreated
}: {
  isOpen: boolean
  prefill: PersonPrefill
  onClose: () => void
  onCreated: (id: number, label: string) => void
}) {
  const [firstName, setFirstName] = useState(prefill.firstName)
  const [lastName, setLastName] = useState(prefill.lastName)
  const [email, setEmail] = useState(prefill.email)

  const createPerson = trpcReact.person.create.useMutation({
    onSuccess: (person) => {
      const label = `${person.firstName} ${person.lastName}`
      toast.success(`Person "${label}" erstellt`)
      onCreated(person.id, label)
      onClose()
    },
    onError: (e) => toast.error('Person konnte nicht erstellt werden', { description: e.message })
  })

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim()) return
    createPerson.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      notes: null,
      contact: email ? { email, phone: '', mobilePhone: '', homepage: '' } : undefined
    })
  }

  return (
    <QuickCreateDialog
      isOpen={isOpen}
      title="Neue Person anlegen"
      submitLabel="Anlegen"
      submitDisabled={!firstName.trim() || !lastName.trim() || createPerson.isPending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="person-first">Vorname *</Label>
          <Input
            id="person-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="person-last">Nachname *</Label>
          <Input id="person-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="person-email">E-Mail</Label>
        <Input
          id="person-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="kontakt@example.com"
        />
      </div>
    </QuickCreateDialog>
  )
}
