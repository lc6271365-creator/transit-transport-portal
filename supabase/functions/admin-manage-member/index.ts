import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Member management is missing Supabase server configuration.");
    return response(503, { error: "Secure account management is not configured yet." });
  }

  try {
    const accessToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return response(401, { error: "Admin sign-in is required." });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData.user?.email_confirmed_at) {
      return response(401, { error: "Verify the Admin email before managing accounts." });
    }

    const body = await request.json();
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const status = body.status;
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) ||
      !/^[a-z0-9._-]{2,50}$/.test(username) ||
      (status !== "active" && status !== "suspended")) {
      return response(400, { error: "Organization, username, or account status is invalid." });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: adminMembership, error: adminError } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", authData.user.id)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle();
    if (adminError) {
      console.error("Admin authorization lookup failed:", adminError.message);
      return response(500, { error: "Unable to authorize this request." });
    }
    if (!adminMembership) {
      return response(403, { error: "Only an active organization Admin can manage member accounts." });
    }

    const { data: target, error: targetError } = await adminClient
      .from("organization_memberships")
      .select("id, user_id, role, status")
      .eq("organization_id", organizationId)
      .eq("login_name", username)
      .maybeSingle();
    if (targetError) {
      console.error("Member lookup failed:", targetError.message);
      return response(500, { error: "Unable to find this account." });
    }
    if (!target || (target.role !== "driver" && target.role !== "student")) {
      return response(404, { error: "Driver or Student account not found." });
    }

    if (status === "suspended" && target.role === "driver") {
      const { data: activeAssignment, error: assignmentError } = await adminClient
        .from("route_assignments")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("driver_user_id", target.user_id)
        .eq("status", "in_progress")
        .maybeSingle();
      if (assignmentError) {
        console.error("Driver assignment check failed:", assignmentError.message);
        return response(500, { error: "Unable to check the driver's current trip." });
      }
      if (activeAssignment) {
        return response(409, { error: "End the driver's active trip before suspending the account." });
      }

      const { error: disableError } = await adminClient
        .from("route_assignments")
        .update({ status: "disabled" })
        .eq("organization_id", organizationId)
        .eq("driver_user_id", target.user_id)
        .eq("status", "assigned");
      if (disableError) {
        console.error("Driver assignment disable failed:", disableError.message);
        return response(500, { error: "Unable to disable the driver's route assignments." });
      }
    }

    const { error: updateError } = await adminClient
      .from("organization_memberships")
      .update({ status })
      .eq("id", target.id);
    if (updateError) {
      console.error("Member status update failed:", updateError.message);
      return response(500, { error: "Unable to update this member account." });
    }

    return response(200, { username, status });
  } catch (error) {
    console.error("Member management failed:", error instanceof Error ? error.message : "Unknown error.");
    return response(400, { error: "Unable to process this account request." });
  }
});
