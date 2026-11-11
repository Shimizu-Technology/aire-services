import { createContext, useContext } from 'react'

export interface FieldContextValue {
  id: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(FieldContext)
}
