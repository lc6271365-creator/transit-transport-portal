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

if (document.querySelector("#student-map")) {
  const mapElement = document.querySelector("#student-map");
  const emptyMessage = document.querySelector("[data-map-empty]");
  const attribution = document.querySelector("[data-map-attribution]");
  const backendStatus = document.querySelector("[data-backend-status]");
  const assignmentCard = document.querySelector(".assignment-card");
  const rideStatus = assignmentCard.querySelector("[data-ride-status]");
  const assignmentEmpty = assignmentCard.querySelector(".compact-empty");
  const stopCopy = document.querySelector(".stops-card .stops-empty p");
  const etaStatus = document.querySelector(".eta-card .status-pill");
  const etaCopy = document.querySelector(".eta-copy");
  const etaDetail = document.querySelector(".eta-placeholder small");
  const accountLink = document.querySelector(".account-header-link");
  let map;
  let busMarker;
  let roadPoints = [];
  let liveChannel;
  let tripChannel;
  let assignmentChannel;
  let supabaseClient;
  let activeTripId;
  let lastLocationTimestamp = 0;
  let rideLabel = "No assignment";

  function setBackendStatus(message, state = "") {
    backendStatus.textContent = message;
    backendStatus.dataset.state = state;
  }

  function stopRealtime() {
    if (liveChannel) {
      supabaseClient.removeChannel(liveChannel);
      liveChannel = undefined;
    }
    if (tripChannel) {
      supabaseClient.removeChannel(tripChannel);
      tripChannel = undefined;
    }
  }

  function waitForChannel(channel, name) {
    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          setBackendStatus(`${name} is taking longer than expected to connect.`, "error");
          resolve(false);
        }
      }, 5000);
      channel.subscribe((state) => {
        if (state === "SUBSCRIBED" && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(true);
        } else if ((state === "CHANNEL_ERROR" || state === "TIMED_OUT") && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          setBackendStatus(`${name} connection failed; live updates may be delayed.`, "error");
          resolve(false);
        }
      });
    });
  }

  function setNoRide(message, rideLabel = "No assignment") {
    emptyMessage.hidden = false;
    emptyMessage.querySelector("h3").textContent = message;
    attribution.textContent = "OpenStreetMap · No live location";
    rideStatus.textContent = rideLabel;
    etaStatus.textContent = "Not available";
    etaStatus.classList.add("status-neutral");
    etaCopy.textContent = "Stop-by-stop arrival estimates will appear when your assigned vehicle is sharing live GPS.";
    etaDetail.textContent = "No active trip or location data";
    if (busMarker) {
      map.removeLayer(busMarker);
      busMarker = undefined;
    }
  }

  function showLocation(location) {
    const recordedAt = Date.parse(location.recorded_at);
    if (Number.isFinite(recordedAt) && recordedAt < lastLocationTimestamp) {
      return;
    }
    if (Number.isFinite(recordedAt)) {
      lastLocationTimestamp = recordedAt;
    }
    const point = [location.latitude, location.longitude];
    if (busMarker) {
      window.TransitMap.animateOnRoad(busMarker, roadPoints, point);
    } else {
      busMarker = window.TransitMap.createBusMarker(map, point, roadPoints);
      map.setView(busMarker.getLatLng(), 15);
    }
    emptyMessage.hidden = true;
    attribution.textContent = `OpenStreetMap · Updated ${new Date(location.recorded_at).toLocaleTimeString()}`;
    etaStatus.textContent = "Live";
    etaStatus.classList.remove("status-neutral");
    etaCopy.textContent = "Your assigned vehicle is sharing a live location.";
    etaDetail.textContent = `Last update ${new Date(location.recorded_at).toLocaleTimeString()}`;
    rideStatus.textContent = "Bus on route";
  }

  async function connectToTrip(context, trip) {
    if (activeTripId === trip.id) {
      return;
    }
    stopRealtime();
    activeTripId = trip.id;
    lastLocationTimestamp = 0;
    rideStatus.textContent = rideLabel;
    liveChannel = context.supabase
      .channel(`student-location-${trip.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "current_vehicle_locations",
        filter: `trip_id=eq.${trip.id}`,
      }, (payload) => {
        if (payload.new?.latitude != null && payload.new?.longitude != null) {
          showLocation(payload.new);
        }
      })
      .subscribe((state) => {
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setBackendStatus("Live GPS connection lost; retrying…", "error");
        }
      });

    tripChannel = context.supabase
      .channel(`student-trip-${trip.id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "trips",
        filter: `id=eq.${trip.id}`,
      }, (payload) => {
        if (payload.new.status !== "in_progress" && activeTripId === trip.id) {
          activeTripId = undefined;
          stopRealtime();
          setNoRide("This trip has ended.", "Trip complete");
          setBackendStatus("Trip complete · Waiting for the next trip", "success");
        }
      })
      .subscribe();

    const { data: currentLocation, error: locationError } = await context.supabase
      .from("current_vehicle_locations")
      .select("latitude, longitude, speed_kmh, recorded_at")
      .eq("organization_id", context.organizationId)
      .eq("trip_id", trip.id)
      .maybeSingle();
    if (locationError) {
      throw new Error(`Bus location load nahi hui: ${locationError.message}`);
    }
    if (activeTripId !== trip.id) {
      return;
    }
    if (currentLocation) {
      showLocation(currentLocation);
      setBackendStatus("Live GPS connected", "success");
    } else if (!busMarker) {
      emptyMessage.hidden = false;
      emptyMessage.querySelector("h3").textContent = "Waiting for the driver's first GPS update";
      const bounds = roadPoints.length ? roadPoints : [];
      if (bounds.length) {
        map.fitBounds(bounds, { padding: [28, 28] });
      }
      setBackendStatus("Live trip connected · Waiting for GPS", "success");
    } else {
      setBackendStatus("Live GPS connected", "success");
    }
  }

  async function loadStudentRide(context) {
    map = window.TransitMap.createMap(mapElement);
    supabaseClient = context.supabase;
    accountLink.textContent = "Signed in";
    accountLink.href = "account.html";
    const { data: allocation, error: allocationError } = await context.supabase
      .from("rider_allocations")
      .select("route_assignment_id, seat_number")
      .eq("organization_id", context.organizationId)
      .eq("student_user_id", context.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (allocationError) {
      throw new Error(`Seat assignment load nahi hui: ${allocationError.message}`);
    }
    if (!allocation) {
      setNoRide("Your transport assignment is not ready yet.");
      return;
    }

    const { data: assignment, error: assignmentError } = await context.supabase
      .from("route_assignments")
      .select("id, route_id, vehicle_id, status")
      .eq("organization_id", context.organizationId)
      .eq("id", allocation.route_assignment_id)
      .in("status", ["assigned", "in_progress"])
      .maybeSingle();
    if (assignmentError) {
      throw new Error(`Route assignment load nahi hui: ${assignmentError.message}`);
    }
    if (!assignment) {
      setNoRide("Your transport assignment is no longer available.");
      return;
    }

    const { route, stops, vehicle } = await window.TransitBackend.loadAssignmentRoute(
      context.supabase,
      context.organizationId,
      assignment,
    );
    assignmentEmpty.hidden = true;
    assignmentCard.querySelector("#ride-title").textContent = route.name;
    rideStatus.textContent = `${vehicle.registration_number} · Seat ${allocation.seat_number}`;
    stopCopy.textContent = stops.length
      ? stops.map((stop, index) => `${index + 1}. ${stop.name}`).join("  ·  ")
      : "Your route has no stops yet.";
    window.TransitMap.addStops(map, stops);
    if (stops.length > 1) {
      try {
        const road = await window.TransitMap.getRoadRoute(stops);
        roadPoints = road.points;
        window.TransitMap.drawRoad(map, road.points);
        map.fitBounds(road.points, { padding: [28, 28] });
      } catch (error) {
        console.error("Road route loading failed:", error);
        window.TransitMap.drawRoad(map, stops.map((stop) => [stop.latitude, stop.longitude]), {
          color: "#8a91a4",
          weight: 4,
          opacity: 0.65,
        });
        roadPoints = [];
        attribution.textContent = "OpenStreetMap · Road routing unavailable";
      }
    } else if (stops.length === 1) {
      map.setView([stops[0].latitude, stops[0].longitude], 15);
    }

    rideLabel = `${vehicle.registration_number} · Seat ${allocation.seat_number}`;
    assignmentChannel = context.supabase
      .channel(`student-assignment-${assignment.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "trips",
        filter: `route_assignment_id=eq.${assignment.id}`,
      }, (payload) => {
        if (payload.new?.status === "in_progress") {
          connectToTrip(context, payload.new).catch((error) => {
            setBackendStatus(error.message, "error");
            console.error("Live trip connection failed:", error);
          });
        }
      });
    await waitForChannel(assignmentChannel, "Trip updates");

    const { data: trip, error: tripError } = await context.supabase
      .from("trips")
      .select("id, status")
      .eq("organization_id", context.organizationId)
      .eq("route_assignment_id", assignment.id)
      .eq("status", "in_progress")
      .maybeSingle();
    if (tripError) {
      throw new Error(`Live trip load nahi hui: ${tripError.message}`);
    }
    if (!trip) {
      setNoRide("Your driver has not started a trip yet.", rideLabel);
      return;
    }
    await connectToTrip(context, trip);
  }

  window.addEventListener("pagehide", () => {
    stopRealtime();
    if (assignmentChannel) {
      supabaseClient.removeChannel(assignmentChannel);
    }
  }, { once: true });

  window.TransitBackend.withPortal(["student"], loadStudentRide);
}

if (document.querySelector("[data-history-list]")) {
  const historyList = document.querySelector("[data-history-list]");
  const historyEmpty = document.querySelector("[data-history-empty]");
  const status = document.querySelector("[data-backend-status]");

  async function loadStudentHistory(context) {
    const { data: allocations, error: allocationError } = await context.supabase
      .from("rider_allocations")
      .select("route_assignment_id")
      .eq("organization_id", context.organizationId)
      .eq("student_user_id", context.user.id);
    if (allocationError) {
      throw new Error(`Ride history access load nahi hui: ${allocationError.message}`);
    }
    const assignmentIds = allocations.map((allocation) => allocation.route_assignment_id);
    if (!assignmentIds.length) {
      status.textContent = "No seat allocation found";
      return;
    }

    const { data: trips, error: tripError } = await context.supabase
      .from("trips")
      .select("id, route_assignment_id, status, started_at, ended_at")
      .eq("organization_id", context.organizationId)
      .in("route_assignment_id", assignmentIds)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(100);
    if (tripError) {
      throw new Error(`Trip history load nahi hui: ${tripError.message}`);
    }
    if (!trips.length) {
      status.textContent = "No completed trips yet";
      return;
    }

    const { data: assignments, error: assignmentError } = await context.supabase
      .from("route_assignments")
      .select("id, route_id")
      .eq("organization_id", context.organizationId)
      .in("id", [...new Set(trips.map((trip) => trip.route_assignment_id))]);
    if (assignmentError) {
      throw new Error(`History routes load nahi hue: ${assignmentError.message}`);
    }
    const routeIds = [...new Set(assignments.map((assignment) => assignment.route_id))];
    const { data: routes, error: routeError } = await context.supabase
      .from("routes")
      .select("id, name")
      .eq("organization_id", context.organizationId)
      .in("id", routeIds);
    if (routeError) {
      throw new Error(`History route names load nahi hue: ${routeError.message}`);
    }
    const routeNames = new Map(routes.map((route) => [route.id, route.name]));
    const assignmentRoutes = new Map(assignments.map((assignment) => [assignment.id, assignment.route_id]));

    historyList.replaceChildren();
    trips.forEach((trip) => {
      const entry = document.createElement("article");
      entry.className = "history-entry";
      const route = document.createElement("strong");
      route.textContent = routeNames.get(assignmentRoutes.get(trip.route_assignment_id)) || "Completed trip";
      const timing = document.createElement("p");
      timing.textContent = `${new Date(trip.started_at).toLocaleString()}${trip.ended_at ? ` – ${new Date(trip.ended_at).toLocaleTimeString()}` : ""}`;
      entry.append(route, timing);
      historyList.append(entry);
    });
    historyEmpty.hidden = true;
    historyList.hidden = false;
    status.textContent = `${trips.length} completed trip${trips.length === 1 ? "" : "s"}`;
  }

  window.TransitBackend.withPortal(["student"], loadStudentHistory);
}

if (document.querySelector("[data-pass-route]")) {
  const status = document.querySelector("[data-backend-status]");

  async function loadStudentPass(context) {
    const { data: allocation, error: allocationError } = await context.supabase
      .from("rider_allocations")
      .select("route_assignment_id, seat_number")
      .eq("organization_id", context.organizationId)
      .eq("student_user_id", context.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (allocationError) {
      throw new Error(`Pass allocation load nahi hui: ${allocationError.message}`);
    }
    if (!allocation) {
      status.textContent = "No current seat allocation";
      return;
    }

    const { data: assignment, error: assignmentError } = await context.supabase
      .from("route_assignments")
      .select("id, route_id, service_period_id, status")
      .eq("organization_id", context.organizationId)
      .eq("id", allocation.route_assignment_id)
      .in("status", ["assigned", "in_progress"])
      .maybeSingle();
    if (assignmentError) {
      throw new Error(`Pass route assignment load nahi hui: ${assignmentError.message}`);
    }
    if (!assignment) {
      status.textContent = "No active route assignment";
      return;
    }

    const [routeResult, periodResult, memberResult] = await Promise.all([
      context.supabase.from("routes").select("name").eq("organization_id", context.organizationId).eq("id", assignment.route_id).single(),
      context.supabase.from("service_periods").select("name, starts_on, ends_on").eq("organization_id", context.organizationId).eq("id", assignment.service_period_id).single(),
      context.supabase.from("organization_memberships").select("display_name, login_name, external_id").eq("organization_id", context.organizationId).eq("user_id", context.user.id).single(),
    ]);
    const failedResult = [routeResult, periodResult, memberResult].find((result) => result.error);
    if (failedResult) {
      throw new Error(`Bus pass details load nahi hue: ${failedResult.error.message}`);
    }
    document.querySelector("[data-pass-student]").textContent =
      `${memberResult.data.display_name || memberResult.data.login_name || memberResult.data.external_id || "Student"} · Student pass`;
    document.querySelector("[data-pass-copy]").textContent = `Organization-issued transport pass · ${periodResult.data.name}`;
    document.querySelector("[data-pass-route]").textContent = routeResult.data.name;
    document.querySelector("[data-pass-seat]").textContent = String(allocation.seat_number);
    document.querySelector("[data-pass-period]").textContent =
      `${periodResult.data.starts_on} – ${periodResult.data.ends_on}`;
    status.textContent = "Pass details connected · QR boarding is not enabled";
  }

  window.TransitBackend.withPortal(["student"], loadStudentPass);
}
