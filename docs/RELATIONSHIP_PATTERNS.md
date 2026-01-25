# Handling Referenced/Nested Data - Pattern Guide

This document outlines patterns for handling different types of relationships in forms.

## 1. Required Foreign Keys (1-to-1 or Many-to-1)

**Example**: `band.company_id` (band MUST belong to a company)

### Pattern: Select Dropdown

```typescript
// In Form Component
const companies = trpcReact.company.getListItems.useQuery()

<form.Field
  name="companyId"
  validators={{
    onChange: ({ value }) => {
      if (!value || value === 0) return 'Company is required'
      return undefined
    }
  }}
>
  {(field) => (
    <div className="space-y-2">
      <Label>Company <span className="text-destructive">*</span></Label>
      <Select
        value={field.state.value.toString()}
        onValueChange={(value) => field.handleChange(parseInt(value))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a company" />
        </SelectTrigger>
        <SelectContent>
          {companies.data?.map((company) => (
            <SelectItem key={company.id} value={company.id.toString()}>
              {company.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
      )}
    </div>
  )}
</form.Field>
```

**Router Pattern**: Provide lightweight `getListItems` endpoint
```typescript
// In company.router.ts
getListItems: t.procedure.query(async () => {
  const companies = await companyService.getAllCompanies()
  return CompanyMapper.toListItemList(companies)
}),
```

**Schema Pattern**: Create simplified DTO
```typescript
export const CompanyListItemDto = z.object({
  id: z.number(),
  name: z.string()
})
```

---

## 2. Optional Foreign Keys (Nullable References)

**Example**: `person.contact_id` (person MAY have contact info)

### Pattern A: Select with "None" Option

```typescript
<form.Field name="contactId">
  {(field) => (
    <div className="space-y-2">
      <Label>Contact</Label>
      <Select
        value={field.state.value?.toString() || '0'}
        onValueChange={(value) => field.handleChange(value === '0' ? null : parseInt(value))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select contact (optional)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">No contact</SelectItem>
          {contacts.data?.map((contact) => (
            <SelectItem key={contact.id} value={contact.id.toString()}>
              {contact.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )}
</form.Field>
```

### Pattern B: Inline Creation (Advanced)

For complex nested objects like `contact` or `address`, you might want inline creation:

```typescript
const [showInlineContact, setShowInlineContact] = useState(false)

{!showInlineContact ? (
  <Button onClick={() => setShowInlineContact(true)}>
    + Create New Contact
  </Button>
) : (
  <div className="border p-4 rounded space-y-4">
    <h4>Contact Information</h4>
    {/* Inline contact fields */}
    <Input placeholder="Email" />
    <Input placeholder="Phone" />
    <Button onClick={handleSaveInlineContact}>Save Contact</Button>
  </div>
)}
```

---

## 3. Many-to-Many Relationships

**Example**: `band_member` (bands have many persons, persons have many bands)

### Pattern: Multi-Select or List Management

#### Option A: Simple Multi-Select

```typescript
<form.Field name="memberIds">
  {(field) => (
    <div className="space-y-2">
      <Label>Band Members</Label>
      <MultiSelect
        value={field.state.value}
        onChange={field.handleChange}
        options={persons.data || []}
      />
    </div>
  )}
</form.Field>
```

#### Option B: List with Add/Remove (Better UX)

```typescript
const [selectedMembers, setSelectedMembers] = useState<number[]>([])

<div className="space-y-3">
  <Label>Band Members</Label>
  
  {/* Current members list */}
  <div className="space-y-2">
    {selectedMembers.map((memberId) => {
      const member = persons.data?.find(p => p.id === memberId)
      return (
        <div key={memberId} className="flex items-center justify-between p-2 border rounded">
          <span>{member?.name}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMembers(prev => prev.filter(id => id !== memberId))}
          >
            Remove
          </Button>
        </div>
      )
    })}
  </div>

  {/* Add member */}
  <Select onValueChange={(value) => {
    const id = parseInt(value)
    if (!selectedMembers.includes(id)) {
      setSelectedMembers(prev => [...prev, id])
    }
  }}>
    <SelectTrigger>
      <SelectValue placeholder="Add a member" />
    </SelectTrigger>
    <SelectContent>
      {persons.data?.filter(p => !selectedMembers.includes(p.id)).map((person) => (
        <SelectItem key={person.id} value={person.id.toString()}>
          {person.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

**Backend Pattern**: Handle M2M in separate mutations or within create/update

```typescript
// Option 1: Separate endpoint
updateBandMembers: t.procedure
  .input(z.object({
    bandId: z.number(),
    memberIds: z.array(z.number())
  }))
  .mutation(async ({ input }) => {
    // Delete existing
    await db.delete(schema.band_member).where(eq(schema.band_member.band_id, input.bandId))
    
    // Insert new
    if (input.memberIds.length > 0) {
      await db.insert(schema.band_member).values(
        input.memberIds.map(personId => ({
          band_id: input.bandId,
          person_id: personId
        }))
      )
    }
  })

// Option 2: Include in create/update
create: t.procedure.input(
  CreateBandInput.extend({
    memberIds: z.array(z.number()).optional()
  })
).mutation(async ({ input }) => {
  const band = await bandService.createBand(input)
  
  if (input.memberIds && input.memberIds.length > 0) {
    await db.insert(schema.band_member).values(
      input.memberIds.map(personId => ({
        band_id: band.id,
        person_id: personId
      }))
    )
  }
  
  return band
})
```

---

## 4. Reusable Nested Objects (Contact, Address)

For objects like `contact` and `address` that are reused across many entities:

### Pattern: Separate Creation Flow

1. **Simple**: Require users to create contact/address first, then select
2. **Advanced**: Provide "Create & Select" button that opens a nested sheet

```typescript
const [showContactSheet, setShowContactSheet] = useState(false)

<div className="flex items-center gap-2">
  <Select value={field.state.value} onValueChange={field.handleChange}>
    {/* Contact options */}
  </Select>
  <Button onClick={() => setShowContactSheet(true)}>
    + New
  </Button>
</div>

<FormSheet
  isOpen={showContactSheet}
  onClose={setShowContactSheet(false)}
  title="Create Contact"
>
  <ContactForm
    onSubmit={(newContact) => {
      field.handleChange(newContact.id)
      setShowContactSheet(false)
    }}
  />
</FormSheet>
```

---

## Summary

| Relationship Type | Best Pattern | Example |
|-------------------|-------------|---------|
| Required FK | Select dropdown | band → company |
| Optional FK (simple) | Select with "None" | person → contact |
| Optional FK (complex) | Inline creation or separate sheet | person → address |
| Many-to-Many | List with add/remove | band ↔ persons |
| Reusable nested | Create first, then select | contact, address |

---

## Implementation Checklist

For each relationship:
- [ ] Create lightweight DTO for dropdowns (e.g., `CompanyListItemDto`)
- [ ] Add `getListItems` endpoint to router
- [ ] Add mapper method for list items
- [ ] Add form field with appropriate UI component
- [ ] Add validation if required
- [ ] Handle null values correctly in mapper
- [ ] Test create/edit with referenced data
