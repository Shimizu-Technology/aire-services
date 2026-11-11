import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Minus } from 'lucide-react'
import { DataList, type DataListColumn } from '../../components/ui/DataList'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusPill } from '../../components/ui/StatusPill'
import { api, type AccessGuideResponse, type AccessGuideRoleCard, type AccessGuideRow, type AccessGuideSettingEffect } from '../../lib/api'
import { cx } from '../../lib/cx'
import { ROLE_DETAILS, isUserRole } from '../../lib/roles'

// Roles & access: what each role can do, read from GET /api/v1/access_guide,
// which builds it from User::ROLE_CAPABILITIES and the role rules. Owners
// and admins see who holds each role; everyone else gets a read-only
// "What can I do?" view with their own role first.

const MEMBER_PREVIEW = 8

function rolePhrase(roles: string[]) {
  const plurals = roles.map((role, index) => {
    const plural = isUserRole(role) ? ROLE_DETAILS[role].plural : role
    return index === 0 ? plural : plural.toLowerCase()
  })
  if (plurals.length <= 1) return plurals[0] ?? 'Nobody'
  return `${plurals.slice(0, -1).join(', ')} and ${plurals.at(-1)}`
}

function FootnoteMarks({ ids, numbers }: { ids: string[]; numbers: Map<string, { n: number; label: string }> }) {
  if (ids.length === 0) return null
  return (
    <>
      {ids.map((id) => {
        const note = numbers.get(id)
        if (!note) return null
        return (
          <a
            key={id}
            href={`#setting-${id}`}
            aria-label={`Note ${note.n}: ${note.label}`}
            className="ml-0.5 align-super text-caption font-semibold text-cyan-800 hover:underline"
          >
            {note.n}
          </a>
        )
      })}
    </>
  )
}

function Cell({ row, role, numbers }: { row: AccessGuideRow; role: string; numbers: Map<string, { n: number; label: string }> }) {
  const cell = row.cells[role]
  if (!cell) return null
  const allowed = cell.value !== 'no'
  return (
    <span className="inline-flex items-start gap-1.5">
      {allowed
        ? <Check aria-hidden="true" className={cx('mt-0.5 size-4 shrink-0', cell.value === 'limited' ? 'text-amber-700' : 'text-emerald-700')} />
        : <Minus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-subtle" />}
      <span className="min-w-0">
        <span className={allowed ? 'text-ink' : 'text-ink-muted'}>{cell.value === 'yes' ? 'Yes' : cell.value === 'no' ? 'No' : 'Limited'}</span>
        {cell.note && <span className="block text-caption text-ink-muted">{cell.note}</span>}
      </span>
      <FootnoteMarks ids={cell.footnotes ?? []} numbers={numbers} />
    </span>
  )
}

function Members({ members }: { members: { id: number; name: string }[] }) {
  if (members.length === 0) return <p className="text-body-sm text-ink-muted">Nobody yet.</p>
  const preview = members.slice(0, MEMBER_PREVIEW)
  const rest = members.slice(MEMBER_PREVIEW)
  return (
    <div className="text-body-sm text-ink">
      <p className="[overflow-wrap:anywhere]">{preview.map((member) => member.name).join(', ')}</p>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-cyan-800 pointer-fine:min-h-0 pointer-fine:py-0">and {rest.length} more</summary>
          <p className="mt-1 [overflow-wrap:anywhere]">{rest.map((member) => member.name).join(', ')}</p>
        </details>
      )}
    </div>
  )
}

function RoleCard({ card, rows, numbers, mine, showMembers }: {
  card: AccessGuideRoleCard
  rows: Map<string, AccessGuideRow>
  numbers: Map<string, { n: number; label: string }>
  mine: boolean
  showMembers: boolean
}) {
  const item = (key: string) => {
    const row = rows.get(key)
    if (!row) return null
    const cell = row.cells[card.key]
    return (
      <li key={key} className="break-inside-avoid py-0.5">
        <span className="text-ink">{row.label}</span>
        {cell?.note && <span className="text-ink-muted">: {cell.note}</span>}
        <FootnoteMarks ids={cell?.footnotes ?? []} numbers={numbers} />
      </li>
    )
  }
  return (
    <article
      id={`role-${card.key}`}
      aria-labelledby={`role-${card.key}-title`}
      className={cx('scroll-mt-6 rounded-card border bg-surface p-5', mine ? 'border-primary ring-2 ring-primary/15' : 'border-line')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`role-${card.key}-title`} className="text-title font-semibold text-ink">{card.label}</h3>
        {mine && <StatusPill tone="info">Your role</StatusPill>}
      </div>
      <p className="mt-1 text-body-sm text-ink-muted">{card.summary}</p>

      <dl className="mt-4 space-y-3 text-body-sm">
        {showMembers && card.members && (
          <div>
            <dt className="text-caption font-semibold text-ink-muted">Who has it ({card.members.length})</dt>
            <dd className="mt-0.5"><Members members={card.members} /></dd>
          </div>
        )}
        <div>
          <dt className="text-caption font-semibold text-ink-muted">Who can give this role</dt>
          <dd className="mt-0.5 text-ink">{card.assigned_by.length > 0 ? rolePhrase(card.assigned_by) : 'Nobody'}</dd>
        </div>
        <div>
          <dt className="text-caption font-semibold text-ink-muted">Sign-in</dt>
          <dd className="mt-0.5 text-ink">{card.signs_in_personally ? 'Always signs in personally' : 'Signs in personally, or uses the kiosk only'}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-body-sm font-semibold text-ink">
            <Check aria-hidden="true" className="size-4 text-emerald-700" />Can
          </h4>
          {card.can.length > 0
            ? <ul className="mt-1 text-body-sm">{card.can.map(item)}</ul>
            : <p className="mt-1 text-body-sm text-ink-muted">Only what everyone can do.</p>}
        </div>
        <div>
          <h4 className="flex items-center gap-1.5 text-body-sm font-semibold text-ink">
            <Minus aria-hidden="true" className="size-4 text-ink-subtle" />Can't
          </h4>
          {card.cannot.length > 0
            ? <ul className="mt-1 text-body-sm text-ink-muted">{card.cannot.map(item)}</ul>
            : <p className="mt-1 text-body-sm text-ink-muted">Nothing on this list.</p>}
        </div>
      </div>
    </article>
  )
}

function SettingNote({ effect, n, canChange }: { effect: AccessGuideSettingEffect; n: number; canChange: boolean }) {
  return (
    <li id={`setting-${effect.id}`} className="scroll-mt-6 flex gap-3 py-3">
      <span aria-hidden="true" className="w-5 shrink-0 text-body-sm font-semibold text-cyan-800">{n}</span>
      <div className="min-w-0 text-body-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{effect.label}</span>
          <StatusPill tone={effect.enabled ? 'approved' : 'off'}>{effect.enabled ? 'On' : 'Off'}</StatusPill>
        </p>
        <p className="mt-1 text-ink">
          {effect.effect}
          {effect.individual_count !== undefined && !effect.enabled && ` ${effect.individual_count} ${effect.individual_count === 1 ? 'person has' : 'people have'} it on individually.`}
        </p>
        <p className="mt-1 text-ink-muted">
          {canChange
            ? <>Change it in <Link to={effect.path} className="font-semibold text-cyan-800 underline-offset-2 hover:underline">{effect.change_in}</Link>.</>
            : <>{effect.who} change this in {effect.change_in}.</>}
        </p>
      </div>
    </li>
  )
}

export default function RolesAccess() {
  const [guide, setGuide] = useState<AccessGuideResponse | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    api.getAccessGuide().then((response) => {
      if (cancelled) return
      if (response.data) { setGuide(response.data); setError('') }
      else setError(response.error || 'Roles & access could not be loaded.')
    })
    return () => { cancelled = true }
  }, [attempt])

  const fullView = Boolean(guide?.viewer.can_see_members)
  const title = fullView ? 'Roles & access' : 'What can I do?'

  useEffect(() => {
    document.title = `${title} | AIRE Ops`
  }, [title])

  if (!guide) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} />
        {error ? (
          <div role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-body-sm text-red-800">
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 min-h-11 rounded-control border border-red-300 bg-surface px-4 font-semibold">Try again</button>
          </div>
        ) : (
          <p role="status" className="rounded-card border border-line bg-surface px-5 py-10 text-center text-body-sm text-ink-muted">Loading roles…</p>
        )}
      </div>
    )
  }

  const rows = new Map(guide.rows.map((row) => [row.key, row]))
  const numbers = new Map(guide.settings.map((effect, index) => [effect.id, { n: index + 1, label: effect.label }]))
  const viewerRole = guide.viewer.role
  const cards = fullView
    ? guide.roles
    : [...guide.roles.filter((card) => card.key === viewerRole), ...guide.roles.filter((card) => card.key !== viewerRole)]

  const columns: DataListColumn<AccessGuideRow>[] = [
    {
      id: 'label',
      header: 'What',
      primary: true,
      className: 'min-w-56 max-w-72',
      cell: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.label}</span>
          <span className="block text-caption font-normal text-ink-muted">{row.detail}</span>
        </span>
      ),
    },
    ...guide.roles.map((card) => ({
      id: card.key,
      header: card.label,
      className: 'min-w-36 align-top',
      cell: (row: AccessGuideRow) => <Cell row={row} role={card.key} numbers={numbers} />,
    })),
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title={title}
        description={fullView
          ? 'What each role can do in AIRE, who has it, and who can give it. This is read from the same rules the app enforces.'
          : `You're ${/^[aeiou]/i.test(cards[0]?.label ?? '') ? 'an' : 'a'} ${cards[0]?.label ?? 'team member'}. Here's what that lets you do. Owners and admins change roles on the Team page.`}
      >
        {guide.viewer.can_change_settings && (
          <Link to="/admin/settings" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-cyan-800 hover:underline pointer-fine:min-h-0">
            <ArrowLeft aria-hidden="true" className="size-4" />Back to Settings
          </Link>
        )}
      </PageHeader>

      <nav aria-label="On this page" className="flex flex-wrap gap-2">
        {cards.map((card) => (
          <a key={card.key} href={`#role-${card.key}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body-sm font-medium text-ink hover:bg-surface-muted pointer-fine:min-h-9">
            {card.label}
          </a>
        ))}
        <a href="#side-by-side" className="hidden min-h-9 items-center rounded-full border border-line bg-surface px-4 text-body-sm font-medium text-ink hover:bg-surface-muted lg:inline-flex">Side by side</a>
        <a href="#settings-that-change" className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-body-sm font-medium text-ink hover:bg-surface-muted pointer-fine:min-h-9">Settings that change this</a>
      </nav>

      <section aria-labelledby="everyone-title" className="rounded-card border border-line bg-surface-muted p-5">
        <h2 id="everyone-title" className="text-body font-semibold text-ink">Everyone who signs in can</h2>
        <ul className="mt-2 grid gap-1 text-body-sm text-ink sm:grid-cols-3">
          {guide.everyone_can.map((text) => (
            <li key={text} className="flex items-start gap-1.5"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" />{text}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="roles-title" className="space-y-4">
        <h2 id="roles-title" className="text-title font-semibold text-ink">{fullView ? 'Roles' : 'Your role and the others'}</h2>
        <div className="grid gap-4 xl:grid-cols-2">
          {cards.map((card) => (
            <RoleCard key={card.key} card={card} rows={rows} numbers={numbers} mine={card.key === viewerRole} showMembers={fullView} />
          ))}
        </div>
      </section>

      <section id="side-by-side" aria-labelledby="side-by-side-title" className="hidden scroll-mt-6 space-y-3 lg:block">
        <h2 id="side-by-side-title" className="text-title font-semibold text-ink">Side by side</h2>
        <DataList label="What each role can do" rows={guide.rows} columns={columns} getRowKey={(row) => row.key} />
      </section>

      <section id="settings-that-change" aria-labelledby="settings-that-change-title" className="scroll-mt-6 rounded-card border border-line bg-surface p-5">
        <h2 id="settings-that-change-title" className="text-title font-semibold text-ink">Settings that change these answers</h2>
        <p className="mt-1 text-body-sm text-ink-muted">The numbers above point here. These show how AIRE is set right now.</p>
        <ol className="mt-2 divide-y divide-line">
          {guide.settings.map((effect, index) => (
            <SettingNote key={effect.id} effect={effect} n={index + 1} canChange={guide.viewer.can_change_settings} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="rules-title" className="rounded-card border border-line bg-surface p-5">
        <h2 id="rules-title" className="text-title font-semibold text-ink">Rules that always apply</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-ink">
          {guide.rules.map((rule) => <li key={rule.key}>{rule.text}</li>)}
        </ul>
      </section>
    </div>
  )
}
