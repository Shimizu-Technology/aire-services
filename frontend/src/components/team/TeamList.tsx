import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AdminUser } from '../../lib/api'
import { employeeWorkspaceHref } from '../../lib/employeeWorkspace'
import { personName, teamLine, teamState } from '../person/personFormat'
import { Avatar, ListGroup, ListRow, StatusPill } from '../ui'

interface TeamListProps {
  users: AdminUser[]
  /** People with an open clock right now. */
  onTheClock: Set<number>
  /** The Team URL, so the person page's back link returns to the same search and filters. */
  returnTo: string
  /** The inline My Pay switch (desktop only); left out on phones and for viewers who can't change it. */
  myPay?: (user: AdminUser) => ReactNode
}

/**
 * Team rows: avatar, name, "Employee · Ops/Maint · kiosk only" and at most one
 * state someone acts on. The whole row opens the person.
 */
export function TeamList({ users, onTheClock, returnTo, myPay }: TeamListProps) {
  const navigate = useNavigate()

  return (
    <ListGroup label="Team members" className="overflow-hidden rounded-card border border-line bg-surface">
      {users.map((user) => {
        const name = personName(user)
        const href = employeeWorkspaceHref(user.id, { returnTo })
        const state = teamState(user, onTheClock.has(user.id))
        return (
          <ListRow
            key={user.id}
            leading={<Avatar name={name} />}
            title={(
              <Link
                to={href}
                className="line-clamp-2 whitespace-normal hover:underline [overflow-wrap:anywhere]"
              >
                {name}
              </Link>
            )}
            meta={teamLine(user)}
            trailing={(state || myPay) ? (
              <>
                {state && <StatusPill tone={state.tone}>{state.label}</StatusPill>}
                {myPay && (
                  <span className="flex w-36 items-center justify-end gap-2 text-ink-muted">
                    <span aria-hidden="true">My Pay</span>
                    {myPay(user)}
                  </span>
                )}
              </>
            ) : undefined}
            onOpen={() => navigate(href)}
          />
        )
      })}
    </ListGroup>
  )
}
