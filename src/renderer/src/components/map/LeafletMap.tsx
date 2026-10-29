import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMapType, Layer } from 'leaflet'
import type { MapMarkerDto } from '../../../../main/api/schemas/map.schema'
import { escapeHtml, markerColor, markerTitle, ringMetres } from './mapDisplay'
import 'leaflet/dist/leaflet.css'

/**
 * The Leaflet map itself: OSM tiles, one circle marker per located marker and
 * a radius ring around each event. React owns the data, Leaflet owns its DOM -
 * the component only keeps the layers in sync with the markers.
 */
export function LeafletMap({
  markers,
  focusMarkerId,
  showRings
}: {
  markers: MapMarkerDto[]
  /** Centre the map on this marker when it changes (the venue picker) */
  focusMarkerId?: number | null
  showRings: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMapType | null>(null)
  const layerRef = useRef<Layer[] | null>(null)
  // Set once the (async created) map exists, so marker and focus effects re-run
  const [mapReady, setMapReady] = useState(false)

  // The map is created once; markers and rings are re-drawn per change
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    void import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return
      const map = L.map(containerRef.current, { zoomControl: true }).setView([51.0, 10.0], 6)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · PLZ-Daten: <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0'
      }).addTo(map)
      mapRef.current = map
      // A hidden container (switch/tab) leaves Leaflet with a wrong size
      map.invalidateSize()
      setMapReady(true)
    })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      setMapReady(false)
    }
  }, [])

  // Keep markers and rings in sync with the data
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    void import('leaflet').then((L) => {
      if (cancelled || !mapRef.current) return
      layerRef.current?.forEach((layer) => map.removeLayer(layer))
      layerRef.current = []

      for (const marker of markers) {
        if (marker.lat === undefined || marker.lng === undefined) continue
        const layers: Layer[] = []
        const color = markerColor(marker)
        const ring = showRings ? ringMetres(marker) : null
        if (ring !== null) {
          layers.push(
            L.circle([marker.lat, marker.lng], {
              radius: ring,
              color,
              weight: 1,
              opacity: 0.4,
              fill: true,
              fillOpacity: 0.06
            })
          )
        }
        // Popups and tooltips render HTML: user data goes in escaped
        layers.push(
          L.circleMarker([marker.lat, marker.lng], {
            radius: marker.type === 'event' ? 6 : 7,
            color,
            weight: 2,
            fill: true,
            fillOpacity: 0.9
          })
            .bindTooltip(escapeHtml(markerTitle(marker)))
            .bindPopup(
              `<strong>${escapeHtml(marker.name)}</strong>${marker.addressLabel ? `<br>${escapeHtml(marker.addressLabel)}` : ''}${
                marker.date
                  ? `<br>${new Date(`${marker.date}T00:00:00`).toLocaleDateString('de-DE')}`
                  : ''
              }`
            )
        )
        layers.forEach((layer) => layer.addTo(map))
        layerRef.current?.push(...layers)
      }
    })

    return () => {
      cancelled = true
    }
  }, [markers, showRings, mapReady])

  // The venue picker: centre on the chosen marker
  useEffect(() => {
    const map = mapRef.current
    if (!map || focusMarkerId == null) return
    const marker = markers.find((candidate) => candidate.id === focusMarkerId)
    if (!marker || marker.lat === undefined || marker.lng === undefined) return
    map.flyTo([marker.lat, marker.lng], 11, { duration: 0.8 })
  }, [focusMarkerId, markers, mapReady])

  // A window resize (sidebar toggle) leaves Leaflet with a stale size
  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return <div ref={containerRef} className="h-full w-full" aria-label="Karte" />
}
