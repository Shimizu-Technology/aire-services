import { Link } from 'react-router-dom'
import { ChevronLeft, Send } from 'lucide-react'
import type { AdminUser } from '../../lib/api'
import { Avatar, Button, Menu, StatusPill, type MenuItem } from '../ui'
import { employmentPill, headerLine, personName, signInLabel } from './personFormat'

interface PersonHeaderProps {
  user: AdminUser
  /** Whether My Pay is on for this person, counting "On for everyone". Null while unknown. */
  myPayOn: boolean | null
  backTo: string
  backLabel: string
  /** Opens the Send stub dialog; left out when the viewer can't send stubs. */
  onSendStub?: () => void
  menuItems: MenuItem[]
}

/** Avatar, name, one line about the person, their state, and the page's actions. */
export function PersonHeader({ user, myPayOn, backTo, backLabel, onSendStub, menuItems }: PersonHeaderProps) {
  const name = personName(user)
  const status = employmentPill(user)
  const line = headerLine(user)

  return (
    <header className="space-y-3">
      <Link
        to={backTo}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {backLabel}
      </Link>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-heading font-semibold text-ink [overflow-wrap:anywhere]">{name}</h1>
            {line && <p className="mt-0.5 text-body-sm text-ink-muted [overflow-wrap:anywhere]">{line}</p>}
            <ul aria-label="Status" className="mt-2 flex flex-wrap gap-1.5">
              <li className="max-w-full"><StatusPill tone={status.tone} className="[&>span:last-child]:whitespace-normal!">{status.label}</StatusPill></li>
              {myPayOn && <li className="max-w-full"><StatusPill tone="info" className="[&>span:last-child]:whitespace-normal!">My Pay on</StatusPill></li>}
              <li className="max-w-full"><StatusPill tone="off" className="[&>span:last-child]:whitespace-normal!">{signInLabel(user)}</StatusPill></li>
            </ul>
          </div>
        </div>
        {(onSendStub || menuItems.length > 0) && (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {onSendStub && (
              <Button
                variant="secondary"
                icon={<Send className="size-4" />}
                onClick={onSendStub}
              >
                Send stub
              </Button>
            )}
            {menuItems.length > 0 && <Menu label={`More for ${name}`} items={menuItems} triggerVariant="secondary" />}
          </div>
        )}
      </div>
    </header>
  )
}
