export function WorkChips({
  categories,
  value,
  onChange,
  disabled = false,
  dark = false,
}: {
  categories: Array<{ id: number; name: string }>
  value: number | null
  onChange: (id: number) => void
  dark?: boolean
  disabled?: boolean
}) {
  if (categories.length < 2) return null
  return (
    <fieldset disabled={disabled}>
      <legend className={`mb-3 text-body-sm font-medium ${dark ? 'text-slate-200' : 'text-ink'}`}>
        What are you working on?
      </legend>
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <label
            key={category.id}
            className="relative flex min-h-[52px] cursor-pointer items-center"
          >
            <input
              type="radio"
              name="work-category"
              value={category.id}
              checked={category.id === value}
              onChange={() => onChange(category.id)}
              className="peer sr-only"
            />
            <span className={`flex min-h-[52px] items-center rounded-control border border-line-strong bg-surface px-4 text-body font-medium text-ink peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-50 active:scale-[.97] ${dark ? 'bg-slate-950! text-slate-100! peer-checked:border-cyan-300! peer-checked:bg-cyan-400/15! peer-checked:text-cyan-100!' : ''}` }>
              {category.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
