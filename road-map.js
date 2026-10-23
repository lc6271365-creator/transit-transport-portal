"use strict";

(() => {
  const mapScript = [...document.scripts].find((script) => script.src.endsWith("/road-map.js"));
  const busLogoUrl = mapScript ? new URL("assets/bus-logo.svg", mapScript.src).href : "assets/bus-logo.svg";
  const animations = new WeakMap();
  const busIcon = window.L?.divIcon({
    className: "transit-bus-marker",
    html: `<img src="${busLogoUrl}" alt="">`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });

  function createMap(element, initial = [20.5937, 78.9629], zoom = 6) {
    if (!window.L) {
      throw new Error("Leaflet map library load nahi hui.");
    }
    const map = L.map(element, { scrollWheelZoom: false }).setView(initial, zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    return map;
  }

  async function getRoadRoute(stops) {
    if (stops.length < 2) {
      return null;
    }
    const coordinates = stops.map(({ latitude, longitude }) => `${longitude},${latitude}`).join(";");
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    );
    if (!response.ok) {
      throw new Error(`Road route request failed (${response.status}).`);
    }
    const result = await response.json();
    const route = result.routes?.[0];
    if (!route || route.geometry.coordinates.length < 2) {
      throw new Error("Road route geometry is not available for these stops.");
    }
    return {
      points: route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
      distance: route.distance,
      duration: route.duration,
    };
  }

  function addStops(map, stops) {
    return stops.map((stop, index) => L.marker([stop.latitude, stop.longitude])
      .addTo(map)
      .bindTooltip(`${index + 1}. ${stop.name}`));
  }

  function drawRoad(map, points, options = {}) {
    return L.polyline(points, {
      color: options.color || "#5148dd",
      weight: options.weight || 6,
      opacity: options.opacity || 0.85,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
  }

  function createBusMarker(map, position, routePoints = []) {
    return L.marker(snapToRoute(position, routePoints), { icon: busIcon, zIndexOffset: 1000 }).addTo(map);
  }

  function animateOnRoad(marker, routePoints, target, duration = 4500) {
    const current = marker.getLatLng();
    const currentPoint = [current.lat, current.lng];
    const road = routePoints?.length > 1 ? routePoints : [currentPoint, target];
    const targetPoint = snapToRoute(target, road);
    const startPoint = snapToRoute(currentPoint, road);
    const startIndex = nearestRoadIndex(startPoint, road);
    const endIndex = nearestRoadIndex(targetPoint, road);
    const direction = endIndex >= startIndex ? 1 : -1;
    const path = [startPoint];
    for (let i = startIndex; i !== endIndex; i += direction) {
      path.push(road[i + direction]);
    }
    path.push(targetPoint);
    const lengths = path.slice(1).map((point, i) => distanceMeters(path[i], point));
    const totalDistance = lengths.reduce((sum, length) => sum + length, 0);
    if (!totalDistance) {
      return;
    }
    const previousAnimation = animations.get(marker);
    if (previousAnimation) {
      cancelAnimationFrame(previousAnimation);
    }
    let frameId;
    const started = performance.now();
    const step = (time) => {
      const progress = Math.min(1, (time - started) / duration);
      const remaining = totalDistance * progress;
      let traveled = 0;
      for (let i = 0; i < lengths.length; i += 1) {
        if (traveled + lengths[i] >= remaining || i === lengths.length - 1) {
          const segmentProgress = lengths[i] ? (remaining - traveled) / lengths[i] : 1;
          marker.setLatLng([
            path[i][0] + (path[i + 1][0] - path[i][0]) * segmentProgress,
            path[i][1] + (path[i + 1][1] - path[i][1]) * segmentProgress,
          ]);
          break;
        }
        traveled += lengths[i];
      }
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
        animations.set(marker, frameId);
      } else {
        animations.delete(marker);
      }
    };
    frameId = requestAnimationFrame(step);
    animations.set(marker, frameId);
  }

  function nearestRoadIndex(point, line) {
    let nearestIndex = 0;
    let smallest = Infinity;
    line.forEach((candidate, index) => {
      const distance = distanceMeters(point, candidate);
      if (distance < smallest) {
        smallest = distance;
        nearestIndex = index;
      }
    });
    return nearestIndex;
  }

  function nearestRoadPoint(point, line) {
    let bestPoint = line[0];
    let smallest = Infinity;
    for (let index = 0; index < line.length - 1; index += 1) {
      const segment = nearestOnSegment(point, line[index], line[index + 1]);
      const distance = distanceMeters(point, segment);
      if (distance < smallest) {
        smallest = distance;
        bestPoint = segment;
      }
    }
    return bestPoint;
  }

  function snapToRoute(point, line) {
    if (!line || line.length < 2) {
      return point;
    }
    const nearest = nearestRoadPoint(point, line);
    return distanceMeters(point, nearest) <= 120 ? nearest : point;
  }

  function nearestOnSegment(point, start, end) {
    const latitudeScale = 111320;
    const longitudeScale = latitudeScale * Math.cos(point[0] * Math.PI / 180);
    const px = (point[1] - start[1]) * longitudeScale;
    const py = (point[0] - start[0]) * latitudeScale;
    const dx = (end[1] - start[1]) * longitudeScale;
    const dy = (end[0] - start[0]) * latitudeScale;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
  }

  function distanceMeters(a, b) {
    const latitudeScale = 111320;
    const longitudeScale = latitudeScale * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
    return Math.hypot((b[0] - a[0]) * latitudeScale, (b[1] - a[1]) * longitudeScale);
  }

  window.TransitMap = { addStops, animateOnRoad, createBusMarker, createMap, drawRoad, getRoadRoute };
})();
