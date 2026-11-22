import React, { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import { Site } from '../../types';
import { MapPin, ShieldAlert, Eye, Layers } from 'lucide-react';
import { formatCoordinates } from '../../utils/formatters';

interface SiteMapProps {
  sites: Site[];
  selectedSiteId?: string;
  onSelectSite?: (site: Site) => void;
  className?: string;
}

const createCustomIcon = (isSelected: boolean, isGeneralized: boolean) => {
  const bg = isSelected ? '#34d399' : isGeneralized ? '#d4af37' : '#10b981';
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div style="
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: ${bg};
        border: 2px solid #060907;
        box-shadow: 0 0 12px ${isSelected ? 'rgba(52, 211, 153, 0.8)' : 'rgba(16, 185, 129, 0.4)'};
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: #060907;
        "></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

export const SiteMap: React.FC<SiteMapProps> = ({
  sites,
  selectedSiteId,
  onSelectSite,
  className = '',
}) => {
  const [showGeneralizedBuffers, setShowGeneralizedBuffers] = useState(true);

  // Filter out restricted sites from direct coordinates (respecting location privacy rules)
  const mappableSites = useMemo(() => {
    return sites.filter((site) => {
      if (site.location_sensitivity === 'restricted') return false;
      const lat = site.location_sensitivity === 'generalized' ? (site.generalized_latitude ?? site.latitude) : site.latitude;
      const lon = site.location_sensitivity === 'generalized' ? (site.generalized_longitude ?? site.longitude) : site.longitude;
      return typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon);
    });
  }, [sites]);

  const restrictedSites = useMemo(() => {
    return sites.filter((s) => s.location_sensitivity === 'restricted');
  }, [sites]);

  const center = useMemo<[number, number]>(() => {
    if (mappableSites.length > 0) {
      const selected = mappableSites.find((s) => s.id === selectedSiteId);
      if (selected) {
        const lat = selected.location_sensitivity === 'generalized' ? (selected.generalized_latitude ?? selected.latitude!) : selected.latitude!;
        const lon = selected.location_sensitivity === 'generalized' ? (selected.generalized_longitude ?? selected.longitude!) : selected.longitude!;
        return [lat, lon];
      }
      const first = mappableSites[0];
      const lat = first.location_sensitivity === 'generalized' ? (first.generalized_latitude ?? first.latitude!) : first.latitude!;
      const lon = first.location_sensitivity === 'generalized' ? (first.generalized_longitude ?? first.longitude!) : first.longitude!;
      return [lat, lon];
    }
    return [-1.2921, 36.8219]; // Default African conservation corridor
  }, [mappableSites, selectedSiteId]);

  return (
    <div className={`relative rounded-xl overflow-hidden border border-forest-750 bg-forest-950 flex flex-col ${className}`}>
      {/* Map Header / Layer Controls */}
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2">
        <div className="px-3 py-1.5 rounded-lg bg-forest-950/85 backdrop-blur-md border border-forest-750 text-xs font-mono text-gray-200 flex items-center gap-2 shadow-lg">
          <Layers className="w-3.5 h-3.5 text-bio-emerald" />
          <span>Stations: {mappableSites.length} Active</span>
        </div>

        <button
          onClick={() => setShowGeneralizedBuffers(!showGeneralizedBuffers)}
          className={`px-2.5 py-1.5 rounded-lg backdrop-blur-md border text-xs font-mono flex items-center gap-1.5 transition-colors shadow-lg ${
            showGeneralizedBuffers
              ? 'bg-bio-emerald/20 text-bio-leaf border-bio-emerald/40'
              : 'bg-forest-950/85 text-forest-400 border-forest-750'
          }`}
          title="Toggle ~1.1km generalized privacy buffer circles"
        >
          <Eye className="w-3 h-3" />
          <span>Privacy Buffers</span>
        </button>
      </div>

      {/* Restricted Coordinates Advisory Pill */}
      {restrictedSites.length > 0 && (
        <div className="absolute top-3 right-3 z-[1000]">
          <div className="px-3 py-1.5 rounded-lg bg-rose-950/85 backdrop-blur-md border border-rose-800/50 text-[11px] font-mono text-rose-300 flex items-center gap-1.5 shadow-lg">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{restrictedSites.length} Station(s) Restricted (Coordinates Hidden)</span>
          </div>
        </div>
      )}

      <MapContainer
        center={center}
        zoom={mappableSites.length > 0 ? 5 : 3}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {mappableSites.map((site) => {
          const isSelected = site.id === selectedSiteId;
          const isGeneralized = site.location_sensitivity === 'generalized';
          const lat = isGeneralized ? (site.generalized_latitude ?? site.latitude!) : site.latitude!;
          const lon = isGeneralized ? (site.generalized_longitude ?? site.longitude!) : site.longitude!;

          return (
            <React.Fragment key={site.id}>
              {isGeneralized && showGeneralizedBuffers && (
                <Circle
                  center={[lat, lon]}
                  radius={1100} // ~1.1 km fuzzed privacy radius
                  pathOptions={{
                    color: '#d4af37',
                    fillColor: '#d4af37',
                    fillOpacity: 0.12,
                    dashArray: '4, 4',
                    weight: 1.5,
                  }}
                />
              )}

              <Marker
                position={[lat, lon]}
                icon={createCustomIcon(isSelected, isGeneralized)}
                eventHandlers={{
                  click: () => onSelectSite && onSelectSite(site),
                }}
              >
                <Popup>
                  <div className="p-1 space-y-1.5 font-mono text-xs">
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-bio-leaf" />
                      {site.name}
                    </div>

                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-forest-400">Mode:</span>
                      <span
                        className={`font-bold uppercase ${
                          site.location_sensitivity === 'exact'
                            ? 'text-bio-leaf'
                            : 'text-amber-400'
                        }`}
                      >
                        {site.location_sensitivity}
                      </span>
                    </div>

                    <p className="text-[10px] text-forest-300">
                      {isGeneralized ? 'Fuzzed (~1.1 km blur): ' : 'Exact: '}
                      {formatCoordinates(lat, lon)}
                    </p>

                    {site.description && (
                      <p className="text-[11px] text-gray-300 pt-1 border-t border-forest-800 font-sans">
                        {site.description}
                      </p>
                    )}

                    <button
                      onClick={() => onSelectSite && onSelectSite(site)}
                      className="mt-2 w-full py-1 rounded bg-bio-emerald text-forest-950 font-semibold text-[11px] hover:bg-bio-leaf transition-colors"
                    >
                      Inspect Station Intelligence
                    </button>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
};
