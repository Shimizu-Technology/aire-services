import { useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import {
  AttentionItem,
  Button,
  ChecklistItem,
  LiveTimer,
  PeriodStepper,
  PersonPicker,
  ProgressSplit,
  StepList,
  Switch,
  Tabs,
  UnsavedChangesBar,
  useUnsavedChanges,
} from '../components/ui'
import { currentPayPeriod, type PayPeriod } from '../lib/payPeriods'

// A Storybook-free page that puts the pages-and-forms kit together the way
// the person page, Today and the pay period page will. Rendered by
// UiKitPagesFixture.test.tsx inside a data router.

const PEOPLE = [
  { id: 1, name: 'Ethan Cruz', meta: 'CFI · Employee' },
  { id: 2, name: 'Caleb Perez', meta: 'CFI · Employee' },
  { id: 3, name: 'Tåsi Leon Guerrero-Santos', meta: 'Ops/Maint · Employee' },
]

export function UiKitPagesFixture({ now = new Date() }: { now?: Date }) {
  const [period, setPeriod] = useState<PayPeriod>(() => currentPayPeriod(now))
  const [savedMyPay, setSavedMyPay] = useState(false)
  const [myPay, setMyPay] = useState(false)
  const [person, setPerson] = useState<number | null>(null)
  const dirty = myPay !== savedMyPay
  const unsaved = useUnsavedChanges({
    dirty,
    what: 'Access',
    summary: `My Pay: ${savedMyPay ? 'On' : 'Off'} → ${myPay ? 'On' : 'Off'}`,
    onSave: () => setSavedMyPay(myPay),
    onDiscard: () => setMyPay(savedMyPay),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-heading font-semibold text-ink">Ethan Cruz</h1>
      <Tabs label="Ethan Cruz" items={[{ value: 'overview', label: 'Overview' }, { value: 'access', label: 'Access' }]} aliases={{ setup: 'access' }}>
        {(tab) => tab === 'overview' ? (
          <div className="space-y-4">
            <PeriodStepper period={period} onChange={setPeriod} now={now} />
            <ProgressSplit parts={[{ label: 'approved', value: 51.5, tone: 'approved' }, { label: 'waiting', value: 11.5, tone: 'waiting' }]} />
            <ul aria-label="Needs attention" className="divide-y divide-line rounded-card border border-line bg-surface">
              <AttentionItem tone="bad" icon={<Clock />} meta="Since Tue, Nov 10, 7:02 AM" action={<Button size="sm" variant="secondary">Fix clock-out</Button>}>
                <b>Caleb Perez</b> still clocked in
              </AttentionItem>
              <AttentionItem tone="warn" icon={<AlertTriangle />}><b>6.0h overtime</b> waiting</AttentionItem>
            </ul>
            <ul aria-label="Before it locks" className="divide-y divide-line rounded-card border border-line bg-surface">
              <ChecklistItem status="todo" meta="27 ordinary · 4 need a look">31 shifts waiting for approval</ChecklistItem>
              <ChecklistItem status="done">Every shift has a work category</ChecklistItem>
            </ul>
            <StepList label="Hand-off to Cornerstone Payroll" current="locked" steps={[{ id: 'open', label: 'Open' }, { id: 'locked', label: 'Locked' }, { id: 'paid', label: 'Paid' }]} />
            <p className="text-body-sm text-ink-muted">On the clock <LiveTimer since={new Date(now.getTime() - 3_723_000)} label="On the clock for about an hour" /></p>
          </div>
        ) : (
          <div className="space-y-4">
            <Switch checked={myPay} onChange={setMyPay} label="My Pay" description="Ethan sees his own paychecks." />
            <PersonPicker label="Who worked" people={PEOPLE} value={person} onChange={(chosen) => setPerson(Number(chosen.id))} recentIds={[2]} />
          </div>
        )}
      </Tabs>
      <UnsavedChangesBar {...unsaved.barProps} />
      {unsaved.guard}
    </div>
  )
}
