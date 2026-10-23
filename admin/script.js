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

function updateFormStatus(element, message, state = "") {
  element.textContent = message;
  element.dataset.state = state;
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function addFormField(form, title, name, type, required = true) {
  const label = document.createElement("label");
  label.className = "account-field";
  label.append(document.createTextNode(title));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.required = required;
  if (type === "number") {
    input.step = "any";
  }
  label.append(input);
  form.append(label);
  return input;
}

function addSubmitButton(form, text) {
  const button = document.createElement("button");
  button.className = "preview-action";
  button.type = "submit";
  button.textContent = text;
  form.append(button);
}

function loadAdminDashboard(context) {
  const orgId = context.organizationId;
  const stats = [
    ["routes", context.supabase.from("routes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true)],
    ["vehicles", context.supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true)],
    ["students", context.supabase.from("organization_memberships").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("role", "student").eq("status", "active")],
    ["trips", context.supabase.from("trips").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "in_progress")],
  ];
  return Promise.all(stats.map(async ([key, query]) => {
    const { count, error } = await query;
    if (error) {
      throw new Error(`${key} count load nahi hua: ${error.message}`);
    }
    document.querySelector(`[data-stat="${key}"]`).textContent = String(count ?? 0);
  }));
}

function createRouteStopForm(route, stopCount) {
  const form = document.createElement("form");
  form.className = "member-create-form route-stop-form";
  form.dataset.addStop = "";
  form.dataset.routeId = route.id;
  form.dataset.stopOrder = String(stopCount + 1);
  const title = document.createElement("strong");
  title.textContent = `Add stop ${stopCount + 1}`;
  form.append(title);
  addFormField(form, "Stop name", "name", "text");
  const latitude = addFormField(form, "Latitude", "latitude", "number");
  latitude.min = "-90";
  latitude.max = "90";
  const longitude = addFormField(form, "Longitude", "longitude", "number");
  longitude.min = "-180";
  longitude.max = "180";
  const mapHelp = document.createElement("p");
  mapHelp.className = "route-stop-map-help";
  mapHelp.textContent = "Click the map to choose this stop's location.";
  form.append(mapHelp);
  const mapElement = document.createElement("div");
  mapElement.className = "route-stop-map";
  mapElement.dataset.stopMap = "";
  mapElement.setAttribute("role", "application");
  mapElement.setAttribute("aria-label", `Choose location for stop ${stopCount + 1}`);
  form.append(mapElement);
  addFormField(form, "Scheduled time (optional)", "scheduled_time", "time", false);
  addSubmitButton(form, "Add ordered stop");
  const status = document.createElement("p");
  status.className = "account-status";
  status.dataset.stopStatus = "";
  status.setAttribute("role", "status");
  form.append(status);
  return form;
}

async function loadAdminRoutes(context) {
  const list = document.querySelector("[data-route-list]");
  const form = document.querySelector("[data-create-route]");
  const orgId = context.organizationId;
  const stopMaps = new WeakMap();

  function initializeStopMap(stopForm) {
    if (!window.L) {
      throw new Error("Map library load nahi hui; route stop location select nahi ho saki.");
    }
    const element = stopForm.querySelector("[data-stop-map]");
    const latitude = stopForm.elements.latitude;
    const longitude = stopForm.elements.longitude;
    const map = window.L.map(element, { scrollWheelZoom: false }).setView([20.5937, 78.9629], 5);
    stopMaps.set(element, map);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    let marker;
    function selectLocation(point) {
      latitude.value = point.lat.toFixed(6);
      longitude.value = point.lng.toFixed(6);
      if (marker) {
        marker.setLatLng(point);
      } else {
        marker = window.L.marker(point).addTo(map);
      }
    }

    map.on("click", (event) => selectLocation(event.latlng));
    function updateMarkerFromFields() {
      const lat = Number(latitude.value);
      const lng = Number(longitude.value);
      if (!latitude.value || !longitude.value || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return;
      }
      const point = window.L.latLng(lat, lng);
      selectLocation(point);
      map.panTo(point);
    }
    latitude.addEventListener("change", updateMarkerFromFields);
    longitude.addEventListener("change", updateMarkerFromFields);
  }

  async function refreshRoutes() {
    const { data: routes, error } = await context.supabase
      .from("routes")
      .select("id, code, name, is_active, route_stops(id, name, latitude, longitude, stop_order, scheduled_time)")
      .eq("organization_id", orgId)
      .order("name");
    if (error) {
      throw new Error(`Route list load nahi hui: ${error.message}`);
    }
    list.querySelectorAll("[data-stop-map]").forEach((element) => {
      stopMaps.get(element)?.remove();
    });
    list.replaceChildren();
    if (!routes.length) {
      const empty = document.createElement("strong");
      empty.textContent = "No routes added yet";
      list.append(empty);
      return;
    }
    routes.forEach((route) => {
      const card = document.createElement("article");
      card.className = "surface section-card admin-data-card";
      const heading = document.createElement("h3");
      heading.textContent = `${route.name} (${route.code})`;
      card.append(heading);
      const stops = (route.route_stops || []).sort((left, right) => left.stop_order - right.stop_order);
      const stopList = document.createElement("ol");
      stops.forEach((stop) => {
        const item = document.createElement("li");
        item.textContent = `${stop.name} · ${stop.latitude}, ${stop.longitude}${stop.scheduled_time ? ` · ${stop.scheduled_time}` : ""}`;
        stopList.append(item);
      });
      if (stops.length) {
        card.append(stopList);
      } else {
        const empty = document.createElement("p");
        empty.textContent = "No stops added yet.";
        card.append(empty);
      }
      const stopForm = createRouteStopForm(route, stops.length);
      card.append(stopForm);
      list.append(card);
      initializeStopMap(stopForm);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("[type='submit']");
    const status = form.querySelector("[data-route-status]");
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const { error } = await context.supabase.from("routes").insert({
        organization_id: orgId,
        code: String(values.get("code")).trim(),
        name: String(values.get("name")).trim(),
      });
      if (error) {
        throw error;
      }
      form.reset();
      updateFormStatus(status, "Route created.", "success");
      await refreshRoutes();
    } catch (error) {
      updateFormStatus(status, `Route create nahi hui: ${error.message}`, "error");
    } finally {
      submit.disabled = false;
    }
  });

  list.addEventListener("submit", async (event) => {
    const stopForm = event.target.closest("[data-add-stop]");
    if (!stopForm) {
      return;
    }
    event.preventDefault();
    const submit = stopForm.querySelector("[type='submit']");
    const status = stopForm.querySelector("[data-stop-status]");
    submit.disabled = true;
    try {
      const values = new FormData(stopForm);
      const { error } = await context.supabase.from("route_stops").insert({
        organization_id: orgId,
        route_id: stopForm.dataset.routeId,
        stop_order: Number(stopForm.dataset.stopOrder),
        name: String(values.get("name")).trim(),
        latitude: Number(values.get("latitude")),
        longitude: Number(values.get("longitude")),
        scheduled_time: values.get("scheduled_time") || null,
      });
      if (error) {
        throw error;
      }
      await refreshRoutes();
    } catch (error) {
      updateFormStatus(status, `Stop add nahi hua: ${error.message}`, "error");
      submit.disabled = false;
    }
  });

  await refreshRoutes();
}

async function loadAdminFleet(context) {
  const orgId = context.organizationId;
  const vehicleForm = document.querySelector("[data-create-vehicle]");
  const assignmentForm = document.querySelector("[data-create-assignment]");
  const vehicleList = document.querySelector("[data-vehicle-list]");
  const assignmentList = document.querySelector("[data-assignment-list]");
  const routeSelect = assignmentForm.elements.route_id;
  const vehicleSelect = assignmentForm.elements.vehicle_id;
  const driverSelect = assignmentForm.elements.driver_user_id;

  async function refreshVehicles() {
    const { data, error } = await context.supabase.from("vehicles")
      .select("id, registration_number, label, seat_capacity, is_active")
      .eq("organization_id", orgId)
      .order("registration_number");
    if (error) {
      throw new Error(`Vehicle list load nahi hui: ${error.message}`);
    }
    vehicleList.replaceChildren();
    vehicleSelect.replaceChildren();
    appendOption(vehicleSelect, "", "Select a vehicle");
    data.forEach((vehicle) => {
      const item = document.createElement("p");
      item.textContent = `${vehicle.registration_number} · ${vehicle.seat_capacity} seats${vehicle.label ? ` · ${vehicle.label}` : ""}`;
      vehicleList.append(item);
      if (vehicle.is_active) {
        appendOption(vehicleSelect, vehicle.id, `${vehicle.registration_number} · ${vehicle.seat_capacity} seats`);
      }
    });
    if (!data.length) {
      vehicleList.textContent = "No vehicles added yet.";
    }
  }

  async function refreshAssignments() {
    const { data, error } = await context.supabase.from("route_assignments")
      .select("id, status, route_id, vehicle_id, driver_user_id")
      .eq("organization_id", orgId)
      .in("status", ["assigned", "in_progress"])
      .order("assigned_at", { ascending: false });
    if (error) {
      throw new Error(`Assignments load nahi hue: ${error.message}`);
    }
    assignmentList.replaceChildren();
    for (const assignment of data) {
      const [routeResult, vehicleResult, driverResult] = await Promise.all([
        context.supabase.from("routes").select("name").eq("id", assignment.route_id).maybeSingle(),
        context.supabase.from("vehicles").select("registration_number").eq("id", assignment.vehicle_id).maybeSingle(),
        context.supabase.from("organization_memberships").select("login_name").eq("organization_id", orgId).eq("user_id", assignment.driver_user_id).maybeSingle(),
      ]);
      const failed = [routeResult, vehicleResult, driverResult].find((result) => result.error);
      if (failed) {
        throw new Error(`Assignment details load nahi hue: ${failed.error.message}`);
      }
      const item = document.createElement("p");
      item.textContent = `${routeResult.data?.name || "Route"} · ${vehicleResult.data?.registration_number || "Vehicle"} · ${driverResult.data?.login_name || "Driver"} · ${assignment.status}`;
      assignmentList.append(item);
    }
    if (!data.length) {
      assignmentList.textContent = "No active route assignments.";
    }
  }

  async function refreshDrivers() {
    const { data, error } = await context.supabase.from("organization_memberships")
      .select("user_id, login_name, display_name")
      .eq("organization_id", orgId)
      .eq("role", "driver")
      .eq("status", "active")
      .order("login_name");
    if (error) {
      throw new Error(`Driver list load nahi hui: ${error.message}`);
    }
    driverSelect.replaceChildren();
    appendOption(driverSelect, "", "Select a driver");
    data.forEach((driver) => appendOption(
      driverSelect,
      driver.user_id,
      `${driver.display_name || driver.login_name || "Driver"}${driver.login_name ? ` · ${driver.login_name}` : ""}`,
    ));
  }
  const { data: routes, error: routesError } = await context.supabase.from("routes")
    .select("id, code, name")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (routesError) {
    throw new Error(`Route list load nahi hui: ${routesError.message}`);
  }
  routeSelect.replaceChildren();
  appendOption(routeSelect, "", "Select a route");
  routes.forEach((route) => appendOption(routeSelect, route.id, `${route.name} (${route.code})`));
  const refreshDriversOnMemberCreated = (event) => {
    if (event.detail?.role === "driver") {
      refreshDrivers().catch((error) => {
        window.TransitBackend.announce(error.message, "error");
        console.error("Driver list refresh failed:", error);
      });
    }
  };
  window.addEventListener("transit:member-created", refreshDriversOnMemberCreated);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("transit:member-created", refreshDriversOnMemberCreated);
  }, { once: true });

  vehicleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = vehicleForm.querySelector("[type='submit']");
    const status = vehicleForm.querySelector("[data-vehicle-status]");
    submit.disabled = true;
    try {
      const values = new FormData(vehicleForm);
      const { error } = await context.supabase.from("vehicles").insert({
        organization_id: orgId,
        registration_number: String(values.get("registration_number")).trim(),
        label: String(values.get("label") || "").trim() || null,
        seat_capacity: Number(values.get("seat_capacity")),
      });
      if (error) {
        throw error;
      }
      vehicleForm.reset();
      updateFormStatus(status, "Vehicle added.", "success");
      await refreshVehicles();
    } catch (error) {
      updateFormStatus(status, `Vehicle add nahi hui: ${error.message}`, "error");
    } finally {
      submit.disabled = false;
    }
  });

  const periodStart = new Date();
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  assignmentForm.elements.starts_on.value = localDate(periodStart);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 6);
  assignmentForm.elements.ends_on.value = localDate(periodEnd);
  assignmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = assignmentForm.querySelector("[type='submit']");
    const status = assignmentForm.querySelector("[data-assignment-status]");
    submit.disabled = true;
    try {
      const values = new FormData(assignmentForm);
      const startsOn = String(values.get("starts_on"));
      const endsOn = String(values.get("ends_on"));
      if (endsOn < startsOn) {
        throw new Error("Service period end date starts-on date ke baad honi chahiye.");
      }
      const periodName = String(values.get("period_name")).trim();
      let { data: period, error } = await context.supabase.from("service_periods")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", periodName)
        .eq("starts_on", startsOn)
        .eq("ends_on", endsOn)
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!period) {
        const result = await context.supabase.from("service_periods").insert({
          organization_id: orgId,
          name: periodName,
          starts_on: startsOn,
          ends_on: endsOn,
        }).select("id").single();
        if (result.error) {
          throw result.error;
        }
        period = result.data;
      }
      const { error: assignmentError } = await context.supabase.from("route_assignments").insert({
        organization_id: orgId,
        route_id: values.get("route_id"),
        vehicle_id: values.get("vehicle_id"),
        driver_user_id: values.get("driver_user_id"),
        service_period_id: period.id,
        assigned_by: context.user.id,
      });
      if (assignmentError) {
        throw assignmentError;
      }
      updateFormStatus(status, "Route, vehicle, and driver assigned.", "success");
      await refreshAssignments();
    } catch (error) {
      updateFormStatus(status, `Assignment save nahi hui: ${error.message}`, "error");
    } finally {
      submit.disabled = false;
    }
  });

  await Promise.all([refreshVehicles(), refreshAssignments(), refreshDrivers()]);
}

async function loadAdminRiders(context) {
  const orgId = context.organizationId;
  const allocationForm = document.querySelector("[data-create-allocation]");
  const assignmentSelect = allocationForm.elements.route_assignment_id;
  const studentSelect = allocationForm.elements.student_user_id;
  const allocationList = document.querySelector("[data-allocation-list]");
  const [assignmentsResult, vehiclesResult, routesResult, allocationsResult] = await Promise.all([
    context.supabase.from("route_assignments").select("id, route_id, vehicle_id, status").eq("organization_id", orgId).in("status", ["assigned", "in_progress"]),
    context.supabase.from("vehicles").select("id, registration_number, seat_capacity").eq("organization_id", orgId),
    context.supabase.from("routes").select("id, name").eq("organization_id", orgId),
    context.supabase.from("rider_allocations").select("route_assignment_id, student_user_id, seat_number").eq("organization_id", orgId),
  ]);
  const failedQuery = [assignmentsResult, vehiclesResult, routesResult, allocationsResult].find((result) => result.error);
  if (failedQuery) {
    throw new Error(`Rider allocation data load nahi hui: ${failedQuery.error.message}`);
  }
  const routes = new Map(routesResult.data.map((route) => [route.id, route.name]));
  const vehicles = new Map(vehiclesResult.data.map((vehicle) => [vehicle.id, vehicle]));
  const students = new Map();
  const assignments = new Map(assignmentsResult.data.map((assignment) => [assignment.id, assignment]));
  const seatAssignments = allocationsResult.data;

  async function refreshStudents() {
    const { data, error } = await context.supabase.from("organization_memberships")
      .select("user_id, login_name, display_name")
      .eq("organization_id", orgId)
      .eq("role", "student")
      .eq("status", "active")
      .order("login_name");
    if (error) {
      throw new Error(`Student list load nahi hui: ${error.message}`);
    }
    students.clear();
    studentSelect.replaceChildren();
    appendOption(studentSelect, "", "Select a student");
    data.forEach((student) => {
      students.set(student.user_id, student);
      appendOption(
        studentSelect,
        student.user_id,
        `${student.display_name || student.login_name || "Student"}${student.login_name ? ` · ${student.login_name}` : ""}`,
      );
    });
  }

  assignmentSelect.replaceChildren();
  appendOption(assignmentSelect, "", "Select an active route assignment");
  assignmentsResult.data.forEach((assignment) => {
    const vehicle = vehicles.get(assignment.vehicle_id);
    appendOption(
      assignmentSelect,
      assignment.id,
      `${routes.get(assignment.route_id) || "Route"} · ${vehicle?.registration_number || "Vehicle"}`,
    );
  });
  await refreshStudents();
  const refreshStudentsOnMemberCreated = (event) => {
    if (event.detail?.role === "student") {
      refreshStudents().catch((error) => {
        window.TransitBackend.announce(error.message, "error");
        console.error("Student list refresh failed:", error);
      });
    }
  };
  window.addEventListener("transit:member-created", refreshStudentsOnMemberCreated);
  window.addEventListener("pagehide", () => {
    window.removeEventListener("transit:member-created", refreshStudentsOnMemberCreated);
  }, { once: true });

  allocationList.replaceChildren();
  seatAssignments.forEach((allocation) => {
    const assignment = assignments.get(allocation.route_assignment_id);
    const student = students.get(allocation.student_user_id);
    const item = document.createElement("p");
    item.textContent = `${student?.display_name || student?.login_name || "Student"} · ${routes.get(assignment?.route_id) || "Route"} · Seat ${allocation.seat_number}`;
    allocationList.append(item);
  });
  if (!seatAssignments.length) {
    allocationList.textContent = "No allocations for this service period.";
  }

  assignmentSelect.addEventListener("change", () => {
    const assignment = assignments.get(assignmentSelect.value);
    const vehicle = assignment && vehicles.get(assignment.vehicle_id);
    allocationForm.elements.seat_number.max = String(vehicle?.seat_capacity || "");
  });
  allocationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = allocationForm.querySelector("[type='submit']");
    const status = allocationForm.querySelector("[data-allocation-status]");
    submit.disabled = true;
    try {
      const values = new FormData(allocationForm);
      const assignment = assignments.get(String(values.get("route_assignment_id")));
      const vehicle = assignment && vehicles.get(assignment.vehicle_id);
      const seatNumber = Number(values.get("seat_number"));
      if (!vehicle || seatNumber > vehicle.seat_capacity) {
        throw new Error("Seat number assigned vehicle ki capacity ke andar honi chahiye.");
      }
      const { error } = await context.supabase.from("rider_allocations").insert({
        organization_id: orgId,
        route_assignment_id: values.get("route_assignment_id"),
        student_user_id: values.get("student_user_id"),
        seat_number: seatNumber,
        allocated_by: context.user.id,
      });
      if (error) {
        throw error;
      }
      updateFormStatus(status, "Student seat allocated.", "success");
      const student = students.get(String(values.get("student_user_id")));
      const route = routes.get(assignment.route_id);
      const item = document.createElement("p");
      item.textContent = `${student?.display_name || student?.login_name || "Student"} · ${route || "Route"} · Seat ${seatNumber}`;
      allocationList.append(item);
      allocationForm.reset();
      allocationForm.elements.seat_number.removeAttribute("max");
    } catch (error) {
      updateFormStatus(status, `Seat allocate nahi hui: ${error.message}`, "error");
    } finally {
      submit.disabled = false;
    }
  });
}

async function loadAdminAlerts(context) {
  const list = document.querySelector("[data-alert-list]");
  const count = document.querySelector("[data-alert-count]");
  let refreshing = false;

  async function refreshAlerts() {
    if (refreshing) {
      return;
    }
    refreshing = true;
    try {
      const { data: trips, error: tripError } = await context.supabase
        .from("trips")
        .select("id, route_assignment_id, started_at")
        .eq("organization_id", context.organizationId)
        .eq("status", "in_progress");
      if (tripError) {
        throw new Error(`Active trips load nahi hui: ${tripError.message}`);
      }
      list.replaceChildren();
      if (!trips.length) {
        const empty = document.createElement("strong");
        empty.textContent = "No active trips right now.";
        list.append(empty);
        count.textContent = "0 active trips";
        return;
      }
      const tripIds = trips.map((trip) => trip.id);
      const assignmentIds = [...new Set(trips.map((trip) => trip.route_assignment_id))];
      const [locationsResult, assignmentsResult] = await Promise.all([
        context.supabase.from("current_vehicle_locations")
          .select("trip_id, latitude, longitude, accuracy_m, recorded_at")
          .eq("organization_id", context.organizationId)
          .in("trip_id", tripIds),
        context.supabase.from("route_assignments")
          .select("id, route_id, vehicle_id, driver_user_id")
          .eq("organization_id", context.organizationId)
          .in("id", assignmentIds),
      ]);
      if (locationsResult.error || assignmentsResult.error) {
        throw new Error(`GPS status load nahi hua: ${locationsResult.error?.message || assignmentsResult.error?.message}`);
      }
      const routes = new Map();
      const vehicles = new Map();
      const drivers = new Map();
      const routeIds = [...new Set(assignmentsResult.data.map((assignment) => assignment.route_id))];
      const vehicleIds = [...new Set(assignmentsResult.data.map((assignment) => assignment.vehicle_id))];
      const driverIds = [...new Set(assignmentsResult.data.map((assignment) => assignment.driver_user_id))];
      const [routeResult, vehicleResult, driverResult] = await Promise.all([
        context.supabase.from("routes").select("id, name").eq("organization_id", context.organizationId).in("id", routeIds),
        context.supabase.from("vehicles").select("id, registration_number").eq("organization_id", context.organizationId).in("id", vehicleIds),
        context.supabase.from("organization_memberships").select("user_id, login_name").eq("organization_id", context.organizationId).in("user_id", driverIds),
      ]);
      const failedLookup = [routeResult, vehicleResult, driverResult].find((result) => result.error);
      if (failedLookup) {
        throw new Error(`Trip details load nahi hue: ${failedLookup.error.message}`);
      }
      routeResult.data.forEach((route) => routes.set(route.id, route.name));
      vehicleResult.data.forEach((vehicle) => vehicles.set(vehicle.id, vehicle.registration_number));
      driverResult.data.forEach((driver) => drivers.set(driver.user_id, driver.login_name));
      const assignments = new Map(assignmentsResult.data.map((assignment) => [assignment.id, assignment]));
      const locations = new Map(locationsResult.data.map((location) => [location.trip_id, location]));
      const now = Date.now();
      let staleTrips = 0;
      trips.forEach((trip) => {
        const assignment = assignments.get(trip.route_assignment_id);
        const location = locations.get(trip.id);
        const elapsed = location ? now - Date.parse(location.recorded_at) : now - Date.parse(trip.started_at);
        const stale = !location || elapsed > 60000;
        if (stale) {
          staleTrips += 1;
        }
        const item = document.createElement("p");
        const name = routes.get(assignment?.route_id) || "Assigned route";
        const vehicle = vehicles.get(assignment?.vehicle_id) || "Vehicle";
        const driver = drivers.get(assignment?.driver_user_id) || "Driver";
        const gpsStatus = !location
          ? "Waiting for first GPS update"
          : stale
            ? `GPS delayed · last update ${new Date(location.recorded_at).toLocaleTimeString()}`
            : `GPS active · updated ${new Date(location.recorded_at).toLocaleTimeString()}`;
        item.textContent = `${stale ? "⚠ " : "✓ "}${name} · ${vehicle} · ${driver} · ${gpsStatus}`;
        list.append(item);
      });
      count.textContent = staleTrips ? `${staleTrips} GPS alert${staleTrips === 1 ? "" : "s"}` : `${trips.length} active trip${trips.length === 1 ? "" : "s"} · GPS OK`;
    } finally {
      refreshing = false;
    }
  }

  await refreshAlerts();
  const channel = context.supabase
    .channel(`admin-trip-alerts-${context.organizationId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "current_vehicle_locations",
      filter: `organization_id=eq.${context.organizationId}`,
    }, () => refreshAlerts().catch((error) => {
      count.textContent = "Unable to refresh GPS alerts";
      console.error("GPS alert refresh failed:", error);
    }))
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "trips",
      filter: `organization_id=eq.${context.organizationId}`,
    }, () => refreshAlerts().catch((error) => {
      count.textContent = "Unable to refresh trip alerts";
      console.error("Trip alert refresh failed:", error);
    }))
    .subscribe();
  const refreshTimer = window.setInterval(() => {
    refreshAlerts().catch((error) => {
      count.textContent = "Unable to refresh GPS alerts";
      console.error("GPS alert refresh failed:", error);
    });
  }, 30000);
  window.addEventListener("pagehide", () => {
    window.clearInterval(refreshTimer);
    context.supabase.removeChannel(channel);
  }, { once: true });
}

async function loadAdminMaintenance(context) {
  const form = document.querySelector("[data-create-maintenance]");
  const list = document.querySelector("[data-maintenance-list]");
  const vehicleSelect = form.elements.vehicle_id;
  const { data: vehicles, error: vehicleError } = await context.supabase
    .from("vehicles")
    .select("id, registration_number")
    .eq("organization_id", context.organizationId)
    .eq("is_active", true)
    .order("registration_number");
  if (vehicleError) {
    throw new Error(`Maintenance ke liye vehicle list load nahi hui: ${vehicleError.message}`);
  }
  vehicleSelect.replaceChildren();
  appendOption(vehicleSelect, "", "Select a vehicle");
  vehicles.forEach((vehicle) => appendOption(vehicleSelect, vehicle.id, vehicle.registration_number));
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  form.elements.due_on.value = localToday;

  async function refreshRecords() {
    const { data: records, error } = await context.supabase
      .from("fleet_maintenance_records")
      .select("id, vehicle_id, service_type, description, status, due_on, odometer_km, completed_at")
      .eq("organization_id", context.organizationId)
      .order("due_on", { ascending: true })
      .limit(100);
    if (error) {
      throw new Error(`Maintenance records load nahi hue: ${error.message}`);
    }
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("strong");
      empty.textContent = "No service records yet.";
      list.append(empty);
      return;
    }
    const vehicleNames = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registration_number]));
    records.forEach((record) => {
      const item = document.createElement("div");
      item.className = "maintenance-entry";
      const detail = document.createElement("span");
      detail.textContent = `${vehicleNames.get(record.vehicle_id) || "Vehicle"} · ${record.service_type} · due ${record.due_on}${record.odometer_km == null ? "" : ` · ${record.odometer_km} km`}${record.description ? ` · ${record.description}` : ""} · ${record.status}`;
      item.append(detail);
      if (record.status === "scheduled") {
        const completeButton = document.createElement("button");
        completeButton.type = "button";
        completeButton.className = "preview-action";
        completeButton.textContent = "Mark complete";
        completeButton.addEventListener("click", async () => {
          completeButton.disabled = true;
          const { error: updateError } = await context.supabase.from("fleet_maintenance_records")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("organization_id", context.organizationId)
            .eq("id", record.id);
          if (updateError) {
            completeButton.disabled = false;
            const status = form.querySelector("[data-maintenance-status]");
            updateFormStatus(status, `Service complete nahi hui: ${updateError.message}`, "error");
            return;
          }
          try {
            await refreshRecords();
          } catch (error) {
            const status = form.querySelector("[data-maintenance-status]");
            updateFormStatus(status, `Updated but list refresh nahi hui: ${error.message}`, "error");
          }
        });
        item.append(completeButton);
      }
      list.append(item);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("[type='submit']");
    const status = form.querySelector("[data-maintenance-status]");
    submit.disabled = true;
    try {
      const values = new FormData(form);
      const odometer = String(values.get("odometer_km") || "");
      const { error } = await context.supabase.from("fleet_maintenance_records").insert({
        organization_id: context.organizationId,
        vehicle_id: values.get("vehicle_id"),
        service_type: String(values.get("service_type")).trim(),
        description: String(values.get("description") || "").trim() || null,
        due_on: values.get("due_on"),
        odometer_km: odometer ? Number(odometer) : null,
        created_by: context.user.id,
      });
      if (error) {
        throw error;
      }
      form.reset();
      form.elements.due_on.value = localToday;
      updateFormStatus(status, "Maintenance record scheduled.", "success");
      await refreshRecords();
    } catch (error) {
      updateFormStatus(status, `Maintenance schedule nahi hui: ${error.message}`, "error");
    } finally {
      submit.disabled = false;
    }
  });
  await refreshRecords();
}

if (window.TransitBackend && document.querySelector("[data-stat]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminDashboard);
}
if (window.TransitBackend && document.querySelector("[data-route-list]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminRoutes);
}
if (window.TransitBackend && document.querySelector("[data-vehicle-list]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminFleet);
}
if (window.TransitBackend && document.querySelector("[data-allocation-list]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminRiders);
}
if (window.TransitBackend && document.querySelector("[data-alert-list]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminAlerts);
}
if (window.TransitBackend && document.querySelector("[data-maintenance-list]")) {
  window.TransitBackend.withPortal(["owner", "admin"], loadAdminMaintenance);
}

document.querySelectorAll("[data-create-member]").forEach((memberForm) => {
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const statusElement = memberForm.querySelector("[data-member-status]");
    const submit = memberForm.querySelector("[type='submit']");
    const values = new FormData(memberForm);
    submit.disabled = true;
    statusElement.dataset.state = "";
    statusElement.textContent = "Secure account is being created…";

    try {
      const token = sessionStorage.getItem("transit_access_token");
      const organizationId = sessionStorage.getItem("transit_organization_id");
      const config = window.TRANSIT_SUPABASE_CONFIG;
      if (!token || !organizationId) {
        throw new Error("Member account banane se pehle Admin account sign in karein.");
      }
      if (!config?.url || !config?.anonKey) {
        throw new Error("Supabase configuration nahi hai. Admin ko sign in karne ke baad configuration set karein.");
      }
      const response = await fetch(`${config.url.replace(/\/+$/, "")}/functions/v1/admin-create-member`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_id: organizationId,
          role: memberForm.dataset.role,
          username: String(values.get("username") || "").trim(),
          password: String(values.get("password") || ""),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Unable to create account.");
      }
      statusElement.textContent = `${result.role === "student" ? "Student roll number" : "Driver username"} ${result.username} ka account ban gaya. Password privately share karein.`;
      statusElement.dataset.state = "success";
      memberForm.reset();
      window.dispatchEvent(new CustomEvent("transit:member-created", {
        detail: { role: result.role },
      }));
    } catch (error) {
      statusElement.textContent = error.message;
      statusElement.dataset.state = "error";
    } finally {
      submit.disabled = false;
    }
  });
});

document.querySelectorAll("[data-manage-member]").forEach((memberForm) => {
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const statusElement = memberForm.querySelector("[data-member-status]");
    const submit = memberForm.querySelector("[type='submit']");
    const values = new FormData(memberForm);
    submit.disabled = true;
    statusElement.dataset.state = "";
    statusElement.textContent = "Account status is being updated…";

    try {
      const token = sessionStorage.getItem("transit_access_token");
      const organizationId = sessionStorage.getItem("transit_organization_id");
      const config = window.TRANSIT_SUPABASE_CONFIG;
      if (!token || !organizationId || !config?.url || !config?.anonKey) {
        throw new Error("Admin ko sign in karna hoga aur Supabase configuration set honi chahiye.");
      }
      const response = await fetch(`${config.url.replace(/\/+$/, "")}/functions/v1/admin-manage-member`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_id: organizationId,
          username: String(values.get("username") || "").trim(),
          status: values.get("status"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Unable to update this account.");
      }
      statusElement.textContent = `${result.username} account ${result.status === "suspended" ? "suspend" : "reactivate"} ho gaya.`;
      statusElement.dataset.state = "success";
      memberForm.reset();
    } catch (error) {
      statusElement.textContent = error.message;
      statusElement.dataset.state = "error";
    } finally {
      submit.disabled = false;
    }
  });
});

document.querySelector("[data-copy-code]")?.addEventListener("click", async () => {
  const code = document.querySelector("[data-reference-code]")?.value;
  const statusElement = document.querySelector("[data-account-status]");
  if (!code || !statusElement) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    statusElement.textContent = "Organization reference code copied.";
    statusElement.dataset.state = "success";
  } catch {
    statusElement.textContent = "Copy nahi hua. Code select karke manually copy karein.";
    statusElement.dataset.state = "error";
  }
});

document.querySelector("[data-rotate-code]")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const output = document.querySelector("[data-current-code]");
  const statusElement = document.querySelector("[data-code-status]");
  const token = sessionStorage.getItem("transit_access_token");
  const organizationId = sessionStorage.getItem("transit_organization_id");
  const config = window.TRANSIT_SUPABASE_CONFIG;
  button.disabled = true;
  statusElement.dataset.state = "";
  statusElement.textContent = "Checking Admin access…";
  try {
    if (!token || !organizationId || !config?.url || !config?.anonKey) {
      throw new Error("Reference code manage karne ke liye Admin sign in aur Supabase configuration chahiye.");
    }
    const response = await fetch(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/rotate_organization_access_code`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_organization_id: organizationId }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Reference code rotate nahi ho saka.");
    }
    output.textContent = result;
    output.hidden = false;
    document.querySelector("[data-copy-current-code]").hidden = false;
    statusElement.textContent = "Naya code active hai; purana code ab kaam nahi karega.";
    statusElement.dataset.state = "success";
  } catch (error) {
    statusElement.textContent = error.message;
    statusElement.dataset.state = "error";
  } finally {
    button.disabled = false;
  }
});

document.querySelector("[data-copy-current-code]")?.addEventListener("click", async () => {
  const code = document.querySelector("[data-current-code]")?.textContent;
  const statusElement = document.querySelector("[data-code-status]");
  if (!code || !statusElement) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    statusElement.textContent = "Organization reference code copied.";
    statusElement.dataset.state = "success";
  } catch {
    statusElement.textContent = "Copy nahi hua. Code select karke manually copy karein.";
    statusElement.dataset.state = "error";
  }
});
