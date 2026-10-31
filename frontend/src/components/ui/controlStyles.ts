import { cx } from '../../lib/cx'

type ControlVariant = 'primary' | 'secondary' | 'destructive' | 'quiet' | 'icon'
const variants: Record<ControlVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  destructive: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  quiet: 'text-slate-700 hover:bg-slate-50',
  icon: "relative items-center justify-center text-slate-600 hover:bg-slate-100 before:absolute before:left-1/2 before:top-1/2 before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
}

/** Dimensions stay at the call site so adopting a recipe cannot rearrange controls. */
export function controlStyles(variant: ControlVariant, className?: string) {
  return cx('font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)
}
