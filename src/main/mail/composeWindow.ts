/** C1: what the pop-out editor is opened with */
export type ComposeDraft = {
  to: string
  /** #235: further addresses, comma-separated (the contact on site of an advancing mail) */
  cc?: string
  subject: string
  body: string
}

/** C1: what the compose window reports back */
export type ComposeResult = { sent: boolean; messageId?: string }
