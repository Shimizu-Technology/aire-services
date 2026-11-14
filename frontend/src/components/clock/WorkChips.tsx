export function WorkChips({
  categories,
  value,
  onChange,
  disabled = false,
}: {
  categories: Array<{ id: number; name: string }>
  value: number | null
  onChange: (id: number) => void
  disabled?: boolean
}) {
  if (categories.length < 2) return null
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-3 text-body-sm font-medium text-ink">
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
            <span className="flex min-h-[52px] items-center rounded-control border border-line-strong bg-surface px-4 text-body font-medium text-ink peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-50 active:scale-[.97]">
              {category.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
