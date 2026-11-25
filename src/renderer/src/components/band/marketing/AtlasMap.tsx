import { useEffect, useMemo, useRef, useState } from 'react'
import type { Layer, Map as LeafletMapType } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MARKETING_STATUS_LABELS,
  MarketingStatus,
  type MarketingItemDto
} from '../../../../../main/api/schemas/marketing.schema'
import { escapeHtml } from '@/components/map/mapDisplay'
import { t } from '../../../../../main/i18n/translate'

/** Status colours of the dots, the same families as the list's left border */
const ATLAS_MAP_COLORS: Record<MarketingStatus, string> = {
  open: '#64748b',
  contacted: '#f59e0b',
  talking: '#d97706',
  positive: '#16a34a',
  active: '#15803d',
  declined: '#a1a1aa'
}

/**
 * The shown atlas entries on a map: the ones linked to a company or venue with a postcode, one
 * dot each in the colour of its status. Entries without a place are counted per country below.
 */
export function AtlasMap({ items }: { items: MarketingItemDto[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMapType | null>(null)
  const layersRef = useRef<Layer[]>([])
  const [ready, setReady] = useState(false)
  const placed = useMemo(() => items.filter((item) => item.location !== null), [items])
  const unplaced = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (item.location) continue
      const key = item.country || t('ohne Land')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false
    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return
      const map = L.map(containerRef.current, { zoomControl: true }).setView([51.0, 10.0], 5)
      map.attributionControl.setPrefix(
        t('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>')
      )
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: t(
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · PLZ-Daten: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, CC BY 4.0'
        )
      }).addTo(map)
      mapRef.current = map
      map.invalidateSize()
      setReady(true)
    })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layersRef.current = []
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let cancelled = false
    void import('leaflet').then((L) => {
      if (cancelled || !mapRef.current) return
      layersRef.current.forEach((layer) => map.removeLayer(layer))
      layersRef.current = placed.map((item) =>
        L.circleMarker([item.location!.lat, item.location!.lng], {
          radius: item.priority === 'A' ? 8 : 6,
          color: '#ffffff',
          weight: 1.5,
          fillColor: ATLAS_MAP_COLORS[item.status],
          fillOpacity: 0.9
        })
          .bindTooltip(
            `<strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(
              [
                t('Priorität {{priority}}', { priority: item.priority }),
                MARKETING_STATUS_LABELS[item.status]
              ].join(' · ')
            )}`
          )
          .addTo(map)
      )
      if (placed.length > 0) {
        map.fitBounds(
          L.latLngBounds(placed.map((item) => [item.location!.lat, item.location!.lng])),
          { padding: [30, 30], maxZoom: 9 }
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [placed, ready])

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-80 w-full overflow-hidden rounded-md border"
        role="region"
        aria-label={t('Karte des Marketing-Atlas')}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {MarketingStatus.options.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: ATLAS_MAP_COLORS[status] }}
            />
            {MARKETING_STATUS_LABELS[status]}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('{{placed}} mit Ort auf der Karte (verknüpfte Kontakte mit Postleitzahl)', {
          placed: placed.length
        })}
        {unplaced.length > 0 && (
          <>
            {' · '}
            {t('ohne Ort:')} {unplaced.map(([country, count]) => `${country} ${count}`).join(', ')}
          </>
        )}
      </p>
    </div>
  )
}
