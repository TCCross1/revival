export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is off. Turn it on in iPhone Settings → Safari."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Could not read your location. Allow Location for this site.")),
      { enableHighAccuracy: true, timeout: 14000, maximumAge: 8000 },
    );
  });
}

export function watchPosition(onPos, onErr) {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => onPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    onErr,
    { enableHighAccuracy: true, maximumAge: 12000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export function milesBetween(a, b) {
  if (!a || !b) return 0;
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Number(((2 * r * Math.asin(Math.min(1, Math.sqrt(h)))) / 1609.344).toFixed(2));
}

export function insideFence(fence, pos) {
  if (!fence?.lat || !fence?.lng || !pos) return { configured: false, inside: true, distance_m: null };
  const miles = milesBetween({ lat: fence.lat, lng: fence.lng }, pos);
  const distance_m = miles * 1609.344;
  const radius = Number(fence.radius_m || 150);
  return { configured: true, inside: distance_m <= radius, distance_m };
}
