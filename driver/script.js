"use strict";

const currentPage = window.location.pathname.split("/").pop() || "index.html";
document.querySelectorAll("[data-page-link]").forEach((link) => {
  const isCurrentPage = link.getAttribute("href") === currentPage;
  link.classList.toggle("is-active", isCurrentPage);
  if (isCurrentPage) {
    link.setAttribute("aria-current", "page");
  } else {
    link.removeAttribute("aria-current");
  }
});

if (document.querySelector("#driver-map")) {
  const startButton = document.querySelector("[data-start-trip]");
  const endButton = document.querySelector("[data-end-trip]");
  const tripState = document.querySelector(".trip-state strong");
  const tripDetail = document.querySelector(".trip-state small");
  const gpsState = document.querySelector(".gps-state");
  const locationPrivacy = document.querySelector(".privacy-note span:last-child");
  const routeHeading = document.querySelector(".route-card .card-heading h2");
  const routeBadge = document.querySelector(".route-card .soft-badge");
  const routeEmpty = document.querySelector(".route-empty");
  const stopList = document.querySelector("[data-stop-list]");
  const status = document.querySelector("[data-backend-status]");
  const tripActionStatus = document.querySelector("[data-trip-action-status]");
  const assignmentHeading = document.querySelector("[data-assignment-heading]");
  const assignmentCopy = document.querySelector("[data-assignment-copy]");
  const assignmentState = document.querySelector("[data-assignment-state]");
  let portal;
  let assignment;
  let tripId;
  let positionWatcher;
  let map;
  let busMarker;
  let roadPoints = [];
  let lastSentAt = 0;
  let roadRoutingAvailable = true;

  function showStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
    tripActionStatus.textContent = message;
    tripActionStatus.dataset.state = state;
    tripActionStatus.hidden = false;
  }

  function updateTripControls(active) {
    startButton.disabled = active || !assignment;
    endButton.disabled = !active;
    tripState.textContent = active ? "Trip in progress" : "No active trip";
    tripDetail.textContent = assignment
      ? `${assignment.route.name} · ${assignment.vehicle.registration_number}`
      : "Waiting for an assigned route";
    gpsState.innerHTML = `<i aria-hidden="true"></i>${active ? "Sharing location" : "Not active"}`;
    locationPrivacy.textContent = active ? "Location sharing is on for this trip" : "Location sharing is off";
    assignmentState.textContent = active ? "Trip in progress" : assignment ? "Route ready" : "Waiting for assignment";
  }

  async function savePosition(position) {
    if (!portal || !tripId) {
      return;
    }
    if (position.coords.accuracy > 100) {
      showStatus(`GPS accuracy is too low (${Math.round(position.coords.accuracy)} m); waiting for a better fix.`, "error");
      return;
    }
    const now = Date.now();
    if (now - lastSentAt < 5000) {
      return;
    }
    lastSentAt = now;
    const point = [position.coords.latitude, position.coords.longitude];
    try {
      const { error } = await portal.supabase.rpc("record_trip_location", {
        target_trip_id: tripId,
        point_latitude: point[0],
        point_longitude: point[1],
        point_speed_kmh: Math.min(300, Math.max(0, (position.coords.speed || 0) * 3.6)),
        point_accuracy_m: position.coords.accuracy,
      });
      if (error) {
        throw error;
      }
      if (busMarker) {
        window.TransitMap.animateOnRoad(busMarker, roadPoints, point, 4500);
      } else {
        busMarker = window.TransitMap.createBusMarker(map, point, roadPoints);
      }
      showStatus("Trip active · GPS location is sharing", "success");
    } catch (error) {
      showStatus(`Location update failed: ${error.message}`, "error");
      console.error("GPS update failed:", error);
    }
  }

  function startLocationSharing() {
    if (!navigator.geolocation) {
      showStatus("This device/browser does not support GPS location.", "error");
      return;
    }
    positionWatcher = navigator.geolocation.watchPosition(
      savePosition,
      (error) => showStatus(`GPS error: ${error.message}`, "error"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }

  async function loadDriverWorkspace(context) {
    portal = context;
    map = window.TransitMap.createMap(document.querySelector("#driver-map"));
    assignment = await window.TransitBackend.findActiveAssignment(
      context.supabase,
      context.user.id,
      context.organizationId,
    );
    if (!assignment) {
      routeEmpty.hidden = false;
      updateTripControls(false);
      showStatus("Signed in · No route assigned", "success");
      return;
    }

    assignment = { ...assignment, ...await window.TransitBackend.loadAssignmentRoute(
      context.supabase,
      context.organizationId,
      assignment,
    ) };
    routeEmpty.hidden = true;
    routeHeading.textContent = assignment.route.name;
    routeBadge.textContent = assignment.vehicle.registration_number;
    assignmentHeading.textContent = `Today’s route: ${assignment.route.name}`;
    assignmentCopy.textContent = `${assignment.vehicle.registration_number} · ${assignment.stops.length} route stops`;
    stopList.textContent = assignment.stops.length
      ? assignment.stops.map((stop, index) => `${index + 1}. ${stop.name}`).join("  ·  ")
      : "Your route has no stops yet.";
    window.TransitMap.addStops(map, assignment.stops);
    if (assignment.stops.length >= 2) {
      try {
        const road = await window.TransitMap.getRoadRoute(assignment.stops);
        roadPoints = road.points;
        window.TransitMap.drawRoad(map, road.points);
        map.fitBounds(road.points, { padding: [24, 24] });
      } catch (error) {
        roadRoutingAvailable = false;
        console.error("Road route loading failed:", error);
        map.fitBounds(assignment.stops.map((stop) => [stop.latitude, stop.longitude]), { padding: [24, 24] });
      }
    } else if (assignment.stops.length === 1) {
      map.setView([assignment.stops[0].latitude, assignment.stops[0].longitude], 15);
    }

    const { data: activeTrip, error: tripError } = await context.supabase
      .from("trips")
      .select("id")
      .eq("organization_id", context.organizationId)
      .eq("route_assignment_id", assignment.id)
      .eq("status", "in_progress")
      .maybeSingle();
    if (tripError) {
      throw new Error(`Trip status load nahi hua: ${tripError.message}`);
    }
    if (activeTrip) {
      tripId = activeTrip.id;
      updateTripControls(true);
      startLocationSharing();
    } else {
      updateTripControls(false);
    }
    showStatus(
      roadRoutingAvailable
        ? "Signed in · Route ready"
        : "Route ready · OSRM unavailable; GPS still shares live positions",
      roadRoutingAvailable ? "success" : "error",
    );
  }

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    showStatus("Checking this device's GPS location…");
    try {
      if (!navigator.geolocation) {
        throw new Error("Trip start karne ke liye GPS-enabled browser zaroori hai.");
      }
      await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      }));
      const { data, error } = await portal.supabase.rpc("start_trip", {
        target_assignment_id: assignment.id,
      });
      if (error) {
        throw new Error(error.message);
      }
      tripId = data;
      updateTripControls(true);
      showStatus("Trip started · Waiting for first GPS update", "success");
      startLocationSharing();
    } catch (error) {
      startButton.disabled = !assignment;
      showStatus(`Trip start nahi hua: ${error.message}`, "error");
    }
  });

  endButton.addEventListener("click", async () => {
    endButton.disabled = true;
    try {
      if (positionWatcher !== undefined) {
        navigator.geolocation.clearWatch(positionWatcher);
        positionWatcher = undefined;
      }
      const { error } = await portal.supabase.rpc("finish_trip", { target_trip_id: tripId });
      if (error) {
        throw new Error(error.message);
      }
      tripId = undefined;
      if (busMarker) {
        map.removeLayer(busMarker);
        busMarker = undefined;
      }
      updateTripControls(false);
      showStatus("Trip complete · GPS sharing stopped", "success");
    } catch (error) {
      endButton.disabled = false;
      showStatus(`Trip end nahi hua: ${error.message}`, "error");
    }
  });

  window.TransitBackend.withPortal(["driver"], loadDriverWorkspace);
}

if (document.querySelector("[data-driver-history-list]")) {
  const list = document.querySelector("[data-driver-history-list]");
  const empty = document.querySelector("[data-driver-history-empty]");
  const count = document.querySelector("[data-trip-count]");

  async function loadDriverHistory(context) {
    const { data: assignments, error: assignmentError } = await context.supabase
      .from("route_assignments")
      .select("id, route_id")
      .eq("organization_id", context.organizationId)
      .eq("driver_user_id", context.user.id);
    if (assignmentError) {
      throw new Error(`Driver assignments load nahi hui: ${assignmentError.message}`);
    }
    if (!assignments.length) {
      count.textContent = "No assignments";
      return;
    }
    const { data: trips, error: tripError } = await context.supabase
      .from("trips")
      .select("id, route_assignment_id, started_at, ended_at")
      .eq("organization_id", context.organizationId)
      .in("route_assignment_id", assignments.map((assignment) => assignment.id))
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(100);
    if (tripError) {
      throw new Error(`Driver trip history load nahi hui: ${tripError.message}`);
    }
    if (!trips.length) {
      count.textContent = "No completed trips";
      return;
    }
    const routeIds = [...new Set(assignments
      .filter((assignment) => trips.some((trip) => trip.route_assignment_id === assignment.id))
      .map((assignment) => assignment.route_id))];
    const { data: routes, error: routeError } = await context.supabase
      .from("routes")
      .select("id, name")
      .eq("organization_id", context.organizationId)
      .in("id", routeIds);
    if (routeError) {
      throw new Error(`Driver history routes load nahi hui: ${routeError.message}`);
    }
    const routeNames = new Map(routes.map((route) => [route.id, route.name]));
    const assignmentRoutes = new Map(assignments.map((assignment) => [assignment.id, assignment.route_id]));
    list.replaceChildren();
    trips.forEach((trip) => {
      const row = document.createElement("article");
      row.className = "driver-history-entry";
      const route = document.createElement("strong");
      route.textContent = routeNames.get(assignmentRoutes.get(trip.route_assignment_id)) || "Completed trip";
      const times = document.createElement("small");
      times.textContent = `${new Date(trip.started_at).toLocaleString()}${trip.ended_at ? ` – ${new Date(trip.ended_at).toLocaleTimeString()}` : ""}`;
      row.append(route, times);
      list.append(row);
    });
    empty.hidden = true;
    list.hidden = false;
    count.textContent = `${trips.length} completed`;
  }

  window.TransitBackend.withPortal(["driver"], loadDriverHistory);
}
