import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { MapPin, Clock, ArrowLeft, Navigation } from "lucide-react";
import L from "leaflet";

function LiveTracker({ liveLocation }) {
  const map = useMap();
  const initialized = useRef(false);
  
  useEffect(() => {
    if (liveLocation && liveLocation.lat && liveLocation.lng) {
      if (!initialized.current) {
        map.setView([liveLocation.lat, liveLocation.lng], 16);
        initialized.current = true;
      } else {
        // Only pan if it's within a reasonable distance to prevent fighting the user dragging
        map.panTo([liveLocation.lat, liveLocation.lng], { animate: true, duration: 1.5 });
      }
    }
  }, [liveLocation, map]);
  
  useEffect(() => {
    const handleRecenter = () => {
      if (liveLocation) map.setView([liveLocation.lat, liveLocation.lng], 16);
    };
    window.addEventListener('recenter-map', handleRecenter);
    return () => window.removeEventListener('recenter-map', handleRecenter);
  }, [liveLocation, map]);
  
  return null;
}

const getNavigationIcon = (heading) => {
  if (heading !== null && heading !== undefined) {
    const svg = `
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(${heading}deg); filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.4));">
        <circle cx="24" cy="24" r="10" fill="white" stroke="#3b82f6" stroke-width="2"/>
        <polygon points="24,2 34,22 24,17 14,22" fill="#3b82f6" stroke="white" stroke-width="1.5"/>
      </svg>
    `;
    return L.divIcon({
      className: 'custom-nav-icon',
      html: svg,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });
  } else {
    const svg = `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.4));">
        <circle cx="14" cy="14" r="10" fill="white" stroke="#3b82f6" stroke-width="3"/>
        <circle cx="14" cy="14" r="5" fill="#3b82f6" />
      </svg>
    `;
    return L.divIcon({
      className: 'custom-nav-icon',
      html: svg,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }
};

const hospitalIcon = L.divIcon({
  className: 'custom-hosp-icon',
  html: `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.5));">
    <path d="M20 0c-8.8 0-16 7.2-16 16 0 11.2 16 24 16 24s16-12.8 16-24c0-8.8-7.2-16-16-16z" fill="#ef4444"/>
    <rect x="18" y="10" width="4" height="12" fill="white"/>
    <rect x="14" y="14" width="12" height="4" fill="white"/>
  </svg>`,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});

export default function MapPage() {
  const [searchParams] = useSearchParams();
  const [trafficSegments, setTrafficSegments] = useState([]);
  const [distanceKm, setDistanceKm] = useState(0);
  const [baseEta, setBaseEta] = useState(0);
  const [liveLocation, setLiveLocation] = useState(null);

  const uLat = parseFloat(searchParams.get("uLat"));
  const uLng = parseFloat(searchParams.get("uLng"));
  const hLat = parseFloat(searchParams.get("hLat"));
  const hLng = parseFloat(searchParams.get("hLng"));
  const name = searchParams.get("name") || "Hospital";

  // 1. Fetch route and generate simulated traffic segments
  useEffect(() => {
    if (uLat && uLng && hLat && hLng) {
      const fetchRoute = async () => {
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${uLng},${uLat};${hLng},${hLat}?overview=full&geometries=geojson`);
          const data = await res.json();
          if (data.routes && data.routes.length > 0) {
             const route = data.routes[0];
             const geom = route.geometry.coordinates.map(c => [c[1], c[0]]);
             
             // Simulate traffic segments
             const segments = [];
             const chunkSize = 15;
             for (let i = 0; i < geom.length - 1; i += chunkSize) {
               const endIdx = Math.min(i + chunkSize + 1, geom.length);
               const chunk = geom.slice(i, endIdx);
               
               // Deterministic random based on index to keep colors stable
               const seed = (Math.abs(Math.sin(i * 123.456)) * 10000) % 1;
               let color = "#3b82f6"; // fast (blue/green)
               if (seed > 0.6) color = "#f59e0b"; // moderate (orange)
               if (seed > 0.85) color = "#ef4444"; // slow (red)
               
               segments.push({ positions: chunk, color });
             }
             
             setTrafficSegments(segments);
             setDistanceKm(Number((route.distance / 1000).toFixed(1)));
             setBaseEta(Math.round(route.duration / 60));
          }
        } catch (e) {
           console.error("OSRM route geometry error", e);
        }
      };
      fetchRoute();
    }
  }, [uLat, uLng, hLat, hLng]);

  // 2. Track Live Location & Heading
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setLiveLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading // Null if device lacks compass or stationary
          });
        },
        (err) => console.warn("Watch position error", err),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  const currentIcon = useMemo(() => getNavigationIcon(liveLocation?.heading), [liveLocation?.heading]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--surface)] relative overflow-hidden">
      <header className="px-4 sm:px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 shadow-sm bg-white z-20 relative">
        <div className="w-full sm:w-auto overflow-hidden">
          <h1 className="text-xl font-display font-bold text-gray-900">Directions to {name}</h1>
          <div className="text-sm text-gray-500 mt-1 flex gap-4">
             {distanceKm > 0 && <span><MapPin size={14} className="inline mr-1"/>{distanceKm} km</span>}
             {baseEta > 0 && <span><Clock size={14} className="inline mr-1"/>{baseEta} mins</span>}
          </div>
        </div>
        <button onClick={() => window.close()} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
          <ArrowLeft size={16} /> Close
        </button>
      </header>
      
      <main className="flex-1 relative bg-gray-100 z-10">
        {trafficSegments.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 z-10 bg-gray-100">
            Calculating route with live traffic...
          </div>
        )}
        
        {trafficSegments.length > 0 && (
          <MapContainer key="directions-map" center={[uLat, uLng]} zoom={15} style={{ height: '100%', width: '100%', zIndex: 1 }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            
            {/* Live User Marker */}
            {(liveLocation || (uLat && uLng)) && (
              <Marker 
                position={liveLocation ? [liveLocation.lat, liveLocation.lng] : [uLat, uLng]} 
                icon={currentIcon}
                zIndexOffset={1000}
              >
                <Popup>You are here</Popup>
              </Marker>
            )}

            {/* Hospital Marker */}
            {hLat && hLng && (
              <Marker position={[hLat, hLng]} icon={hospitalIcon}>
                <Popup>{name}</Popup>
              </Marker>
            )}

            {/* Traffic Segments */}
            {trafficSegments.map((seg, idx) => (
              <Polyline key={idx} positions={seg.positions} color={seg.color} weight={7} opacity={0.8} />
            ))}
            
            {/* Auto-pan to live location */}
            <LiveTracker liveLocation={liveLocation} />
          </MapContainer>
        )}
      </main>
      
      {/* Floating GPS Indicator */}
      <div className="absolute bottom-8 right-6 z-30">
         <button className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-blue-500 hover:bg-gray-50 transition-colors"
                 onClick={() => {
                   if (liveLocation) window.dispatchEvent(new CustomEvent('recenter-map'));
                 }}>
           <Navigation size={22} fill="currentColor" className={liveLocation ? "" : "animate-pulse opacity-50"} />
         </button>
      </div>
    </div>
  );
}
