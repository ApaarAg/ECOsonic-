import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Site } from '../../types';
import { MapPin, Navigation } from 'lucide-react';
import { formatCoordinates } from '../../utils/formatters';

interface SiteMapProps {
  sites: Site[];
  selectedSiteId?: string;
  onSelectSite?: (site: Site) => void;
  className?: string;
}

// Custom dark forest pulsed map pin icon
const createCustomIcon = (isSelected: boolean) => {
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div style="
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background-color: ${isSelected ? '#34d399' : '#10b981'};
        border: 2px solid #060907;
        box-shadow: 0 0 12px ${isSelected ? 'rgba(52, 211, 153, 0.8)' : 'rgba(16, 185, 129, 0.5)'};
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
  // Determine center from sites or default to world center
  const center = useMemo<[number, number]>(() => {
    if (sites.length > 0) {
      const selected = sites.find((s) => s.id === selectedSiteId);
      if (selected) return [selected.latitude, selected.longitude];
      return [sites[0].latitude, sites[0].longitude];
    }
    return [0, 20]; // Default equatorial view
  }, [sites, selectedSiteId]);

  return (
    <div className={`relative rounded-xl overflow-hidden border border-forest-750 bg-forest-950 ${className}`}>
      <MapContainer
        center={center}
        zoom={sites.length > 0 ? 4 : 2}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {sites.map((site) => {
          const isSelected = site.id === selectedSiteId;
          return (
            <Marker
              key={site.id}
              position={[site.latitude, site.longitude]}
              icon={createCustomIcon(isSelected)}
              eventHandlers={{
                click: () => onSelectSite && onSelectSite(site),
              }}
            >
              <Popup>
                <div className="p-1 space-y-1 font-mono text-xs">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-bio-leaf" />
                    {site.name}
                  </div>
                  <p className="text-[10px] text-forest-300">
                    {formatCoordinates(site.latitude, site.longitude)}
                  </p>
                  {site.description && (
                    <p className="text-[11px] text-gray-300 pt-1 border-t border-forest-800 font-sans">
                      {site.description}
                    </p>
                  )}
                  <button
                    onClick={() => onSelectSite && onSelectSite(site)}
                    className="mt-2 w-full px-2 py-1 bg-forest-800 hover:bg-forest-750 text-bio-leaf text-[10px] rounded border border-forest-700 font-mono transition-colors"
                  >
                    Select Station
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Floating GPS Legend Overlay */}
      <div className="absolute top-3 right-3 z-[1000] bg-forest-950/80 backdrop-blur-md p-2.5 rounded-lg border border-forest-750 text-[11px] font-mono text-forest-300 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold text-white">
          <Navigation className="w-3 h-3 text-bio-leaf" />
          <span>Active Stations: {sites.length}</span>
        </div>
      </div>
    </div>
  );
};
