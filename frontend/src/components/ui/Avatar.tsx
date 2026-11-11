import { cx } from '../../lib/cx'
import { initialsForName } from '../../lib/initials'

// Soft tints that never match a status tone (amber, green, red) or a role.
// Each pair passes 4.5:1 for the initials.
const TINTS = [
  'bg-[#e8eef6] text-primary',
  'bg-sky-100 text-sky-900',
  'bg-indigo-100 text-indigo-900',
  'bg-violet-100 text-violet-900',
  'bg-cyan-100 text-cyan-900',
  'bg-slate-200 text-slate-800',
  'bg-stone-200 text-stone-800',
] as const

const SIZES = {
  sm: 'size-7 text-caption',
  md: 'size-8 text-caption',
  lg: 'size-12 text-body',
} as const

/** The same name always gets the same tint, on every device. */
function avatarTint(name: string) {
  const key = name.trim().toLowerCase()
  let hash = 5381
  for (let index = 0; index < key.length; index += 1) hash = ((hash * 33) ^ key.charCodeAt(index)) >>> 0
  return TINTS[hash % TINTS.length]
}

export interface AvatarProps {
  name: string
  size?: keyof typeof SIZES
  /** Decorative by default because the name is shown next to it. Set to announce the name instead. */
  label?: string
  className?: string
}

export function Avatar({ name, size = 'md', label, className }: AvatarProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-grid shrink-0 select-none place-items-center rounded-full font-bold', SIZES[size], avatarTint(name), className)}
    >
      {initialsForName(name, '?')}
    </span>
  )
}
