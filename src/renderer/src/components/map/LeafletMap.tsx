import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMapType, Layer } from 'leaflet'
import type { MapMarkerDto } from '../../../../main/api/schemas/map.schema'
import {
  escapeHtml,
  groupByPoint,
  MARKER_COLORS,
  markerColor,
  pointPopupHtml,
  pointRings,
  pointTitle
} from './mapDisplay'
import 'leaflet/dist/leaflet.css'

/** The Leaflet pane the radius rings are drawn in, below the dots */
const RING_PANE = 'rings'

/**
 * The Leaflet map itself: OSM tiles, one dot pair per map point (venue, events)
 * and radius rings around the events. React owns the data, Leaflet owns its DOM -
 * the component only keeps the layers in sync with the markers.
 */
export function LeafletMap({
  markers,
  focusVenueId,
  showRings
}: {
  markers: MapMarkerDto[]
  /** Centre the map on this venue marker when it changes (the venue picker) */
  focusVenueId?: number | null
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
      // The links open in the browser (target=_blank reaches the window open
      // handler); a plain link would try to replace the app and be dropped
      map.attributionControl.setPrefix(
        '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>'
      )
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · PLZ-Daten: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, CC BY 4.0'
      }).addTo(map)
      // Rings get a pane of their own below the dots (overlayPane is z-index 400). In the shared
      // overlay SVG a ring drawn after a dot painted over it and its fill caught the hover, so a
      // venue inside an event's ring showed no tooltip.
      map.createPane(RING_PANE).style.zIndex = '350'
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

      // One dot pair, one ring per size and one popup per point: an event sits on its venue's
      // postcode point, and every event at a venue on the same spot
      for (const point of groupByPoint(markers)) {
        const layers: Layer[] = []
        // Rings under every dot (their own pane), in the venue kind's colour. They are only a
        // backdrop: not interactive, so the mouse always reaches the dots inside them.
        if (showRings) {
          for (const ring of pointRings(point)) {
            layers.push(
              L.circle([point.lat, point.lng], {
                pane: RING_PANE,
                interactive: false,
                radius: ring.metres,
                color: ring.color,
                weight: 2,
                opacity: 0.8,
                fill: true,
                fillOpacity: 0.08
              })
            )
          }
        }
        // Popups and tooltips render HTML: the helpers escape user data. The venue dot is the
        // larger one; an event dot on top gets a white halo so both read.
        const tooltip = escapeHtml(pointTitle(point))
        const popup = pointPopupHtml(point)
        const venue = point.venues[0]
        if (venue) {
          const color = markerColor(venue)
          layers.push(
            L.circleMarker([point.lat, point.lng], {
              radius: point.events.length > 0 ? 9 : 7,
              color,
              weight: 1,
              fill: true,
              fillColor: color,
              fillOpacity: 0.9
            })
              .bindTooltip(tooltip)
              .bindPopup(popup)
          )
        }
        if (point.events.length > 0) {
          layers.push(
            L.circleMarker([point.lat, point.lng], {
              radius: venue ? 4 : 6,
              color: '#ffffff',
              weight: 2,
              fill: true,
              fillColor: MARKER_COLORS.event,
              fillOpacity: 0.9
            })
              .bindTooltip(tooltip)
              .bindPopup(popup)
          )
        }
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
    if (!map || focusVenueId == null) return
    // Event and venue ids are separate sequences: an event can share the venue's id
    const marker = markers.find(
      (candidate) => candidate.type === 'venue' && candidate.id === focusVenueId
    )
    if (!marker || marker.lat === undefined || marker.lng === undefined) return
    map.flyTo([marker.lat, marker.lng], 11, { duration: 0.8 })
  }, [focusVenueId, markers, mapReady])

  // A window resize (sidebar toggle) leaves Leaflet with a stale size
  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return <div ref={containerRef} className="h-full w-full" aria-label="Karte" />
}
