"use strict";

(() => {
  const config = window.TRANSIT_SUPABASE_CONFIG || {};
  const organizationId = sessionStorage.getItem("transit_organization_id");
  const accessToken = sessionStorage.getItem("transit_access_token");
  const refreshToken = sessionStorage.getItem("transit_refresh_token");
  const statusNode = document.querySelector("[data-backend-status]");
  let client;
  let initialized;

  function announce(message, state = "") {
    if (!statusNode) {
      return;
    }
    statusNode.textContent = message;
    statusNode.dataset.state = state;
  }

  function requireClient() {
    if (!config.url || !config.anonKey) {
      throw new Error("Supabase URL/anon key supabase-config.js mein configure nahi hain.");
    }
    if (!window.supabase?.createClient) {
      throw new Error("Supabase client load nahi hua. Internet connection aur CDN access check karein.");
    }
    if (!client) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 8 } },
      });
      client.auth.onAuthStateChange((event, session) => {
        if (session) {
          sessionStorage.setItem("transit_access_token", session.access_token);
          sessionStorage.setItem("transit_refresh_token", session.refresh_token);
        } else if (event === "SIGNED_OUT") {
          sessionStorage.removeItem("transit_access_token");
          sessionStorage.removeItem("transit_refresh_token");
          sessionStorage.removeItem("transit_organization_id");
        }
      });
    }
    return client;
  }

  async function initialize(allowedRoles = []) {
    if (initialized) {
      return initialized;
    }
    initialized = (async () => {
      if (!accessToken || !refreshToken || !organizationId) {
        throw new Error("Admin/portal account se sign in karein.");
      }
      const supabase = requireClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        throw new Error(`Session restore nahi ho saka: ${sessionError.message}`);
      }
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        throw new Error(userError?.message || "Signed-in account verify nahi hua.");
      }
      const { data: memberships, error: membershipError } = await supabase
        .from("organization_memberships")
        .select("organization_id, role, status")
        .eq("organization_id", organizationId)
        .eq("user_id", userData.user.id)
        .eq("status", "active");
      if (membershipError) {
        throw new Error(`Organization membership load nahi hui: ${membershipError.message}`);
      }
      const membership = memberships.find((item) => allowedRoles.length === 0 || allowedRoles.includes(item.role));
      if (!membership) {
        throw new Error("Is portal ke liye active organization access nahi hai.");
      }
      return { supabase, user: userData.user, membership, organizationId };
    })();
    try {
      return await initialized;
    } catch (error) {
      initialized = undefined;
      throw error;
    }
  }

  async function withPortal(allowedRoles, callback) {
    try {
      announce("Supabase se connect ho raha hai…");
      const context = await initialize(allowedRoles);
      announce("Supabase connected", "success");
      await callback(context);
    } catch (error) {
      announce(error.message, "error");
      console.error("Portal backend error:", error);
    }
  }

  async function findActiveAssignment(supabase, userId, orgId) {
    const { data, error } = await supabase
      .from("route_assignments")
      .select("id, route_id, vehicle_id, status, service_period_id")
      .eq("organization_id", orgId)
      .eq("driver_user_id", userId)
      .in("status", ["assigned", "in_progress"])
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Driver assignment load nahi hui: ${error.message}`);
    }
    return data;
  }

  async function loadStops(supabase, orgId, routeId) {
    const { data, error } = await supabase
      .from("route_stops")
      .select("id, name, latitude, longitude, stop_order, scheduled_time")
      .eq("organization_id", orgId)
      .eq("route_id", routeId)
      .order("stop_order");
    if (error) {
      throw new Error(`Route stops load nahi hue: ${error.message}`);
    }
    return data;
  }

  async function loadAssignmentRoute(supabase, orgId, assignment) {
    const [{ data: route, error: routeError }, stops, { data: vehicle, error: vehicleError }] = await Promise.all([
      supabase.from("routes").select("id, name, code").eq("organization_id", orgId).eq("id", assignment.route_id).single(),
      loadStops(supabase, orgId, assignment.route_id),
      supabase.from("vehicles").select("id, registration_number, label, seat_capacity").eq("organization_id", orgId).eq("id", assignment.vehicle_id).single(),
    ]);
    if (routeError || vehicleError) {
      throw new Error(`Route ya vehicle details load nahi hue: ${routeError?.message || vehicleError?.message}`);
    }
    return { route, stops, vehicle };
  }

  window.TransitBackend = {
    announce,
    findActiveAssignment,
    initialize,
    loadAssignmentRoute,
    loadStops,
    requireClient,
    withPortal,
  };
})();
