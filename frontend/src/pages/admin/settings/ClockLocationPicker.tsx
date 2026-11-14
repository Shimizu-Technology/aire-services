import { useEffect, useRef, useState } from 'react'
import { api, type PlaceAutocompleteSuggestion } from '../../../lib/api'
import { Field, Input } from '../../../components/ui'

export default function ClockLocationPicker({
  draft,
  onChange,
}: {
  draft: Record<string, string>
  onChange: (values: Record<string, string>) => void
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PlaceAutocompleteSuggestion[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const token = useRef(crypto.randomUUID())
  useEffect(() => {
    if (query.trim().length < 3) return
    let cancelled = false
    const timeout = setTimeout(() => {
      void api
        .autocompleteAdminClockLocation(query, token.current)
        .then((result) => {
          if (cancelled) return
          setSuggestions(result.data?.suggestions ?? [])
          setError(result.error ?? '')
        })
        .catch(() => {
          if (!cancelled) setError('Could not search locations')
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [query])
  const select = async (suggestion: PlaceAutocompleteSuggestion) => {
    setBusy(true)
    try {
      const result = await api.getAdminClockPlaceDetails(suggestion.place_id, token.current)
      if (!result.data) {
        setError(result.error || 'Could not load location')
        return
      }
      const place = result.data.place
      onChange({
        clock_in_location_latitude: place.latitude,
        clock_in_location_longitude: place.longitude,
        clock_in_location_name:
          draft.clock_in_location_name || place.display_name || suggestion.description,
      })
      setSuggestions([])
      setQuery('')
      token.current = crypto.randomUUID()
    } catch {
      setError('Could not load location')
    } finally {
      setBusy(false)
    }
  }
  const currentLocation = () => {
    if (!navigator.geolocation) {
      setError('This browser does not support location lookup')
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          clock_in_location_latitude: String(position.coords.latitude),
          clock_in_location_longitude: String(position.coords.longitude),
        })
        setBusy(false)
      },
      () => {
        setError('Could not get your location. Allow location access or search by address.')
        setBusy(false)
      },
    )
  }
  const latitude = Number(draft.clock_in_location_latitude)
  const longitude = Number(draft.clock_in_location_longitude)
  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  return (
    <div className="space-y-3 rounded-card border border-line bg-surface p-4">
      <Field label="Find location by address">
        <Input value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
      </Field>
      {error && <p role="alert">{error}</p>}
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.place_id}
          type="button"
          disabled={busy}
          onClick={() => void select(suggestion)}
          className="block min-h-11 text-left text-primary"
        >
          {suggestion.description}
        </button>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={currentLocation}
        className="min-h-11 text-primary"
      >
        Use my current location
      </button>
      {valid && (
        <iframe
          title="Clock-in location preview"
          loading="lazy"
          className="h-56 w-full rounded-card border border-line"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.01},${latitude - 0.01},${longitude + 0.01},${latitude + 0.01}&layer=mapnik&marker=${latitude},${longitude}`}
        />
      )}
    </div>
  )
}
