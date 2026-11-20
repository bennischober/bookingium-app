// #254: sets the UI language before any other renderer module is evaluated, so label maps that
// call t() at module level already get the chosen language. main.tsx imports this first.
import { isLanguage, setLanguage } from '../../main/i18n/translate'

// Without the preload (component tests) the UI stays German
const stored = window.api?.getLanguage?.()
if (isLanguage(stored)) {
  setLanguage(stored)
  document.documentElement.lang = stored
}
