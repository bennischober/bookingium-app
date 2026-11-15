import z from 'zod'

// zod's own messages (wrong type, too short, ...) in German, like the schemas' custom ones.
// Imported for its effect by the router, before any input is parsed.
z.config(z.locales.de())
