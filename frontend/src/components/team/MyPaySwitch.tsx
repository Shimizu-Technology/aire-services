interface MyPaySwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  busy?: boolean
}

// An accessible on/off switch with a 44px touch target.
export default function MyPaySwitch({ checked, onChange, label, disabled = false, busy = false }: MyPaySwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [-webkit-tap-highlight-color:transparent]"
    >
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ${checked ? 'bg-cyan-600' : 'bg-slate-300'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}
