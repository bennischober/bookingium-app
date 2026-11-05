import { toast as sonnerToast, type ExternalToast } from 'sonner'

// How long a toast stays. Every toast has a close button (see components/ui/sonner.tsx), and
// sonner pauses the countdown while the pointer is on a toast or the window is in the background.
//   success, info, loading: sonner's 4 seconds, they only confirm what just happened
//   warning: 8 seconds, there is something to read
//   error: until closed, its text says what failed and often what to do about it
// A toast's own `duration` wins, as the new-mail popup's and an undo action's do.

export const WARNING_TOAST_DURATION = 8000
export const ERROR_TOAST_DURATION = Infinity

type Message = Parameters<typeof sonnerToast.error>[0]

/** sonner's `toast` with the durations above; the app imports it from here, not from sonner */
export const toast = Object.assign(
  (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) => sonnerToast(message, data),
  sonnerToast,
  {
    warning: (message: Message, data?: ExternalToast) =>
      sonnerToast.warning(message, { duration: WARNING_TOAST_DURATION, ...data }),
    error: (message: Message, data?: ExternalToast) =>
      sonnerToast.error(message, { duration: ERROR_TOAST_DURATION, ...data })
  }
)
