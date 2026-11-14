import { Button } from '../ui'

export function EditError({ error, conflict, onReload, busy }: { error: string; conflict: boolean; onReload: () => void; busy: boolean }) {
  if (!error) return null
  return <div role="alert" className="rounded-control border border-danger/30 bg-danger-soft p-3 text-body-sm text-danger">
    <p>{error}</p>
    {conflict && <Button className="mt-2" variant="secondary" onClick={onReload} disabled={busy}>Reload person</Button>}
  </div>
}
