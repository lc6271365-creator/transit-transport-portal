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
    console.error("Member provisioning is missing Supabase server configuration.");
    return response(503, { error: "Secure account provisioning is not configured yet." });
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
      return response(401, { error: "Verify the Admin email before creating accounts." });
    }

    const body = await request.json();
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : "";
    const role = body.role;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || (role !== "driver" && role !== "student")) {
      return response(400, { error: "Organization or member role is invalid." });
    }
    if (!/^[a-z0-9._-]{2,50}$/.test(username) || password.length < 10 || password.length > 128) {
      return response(400, { error: "Username must be 2–50 characters and password 10–128 characters." });
    }
    if (displayName.length > 120) {
      return response(400, { error: "Name must be at most 120 characters." });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: adminMembership, error: adminMembershipError } = await adminClient
      .from("organization_memberships")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", authData.user.id)
      .in("role", ["owner", "admin"])
      .eq("status", "active")
      .maybeSingle();
    if (adminMembershipError) {
      console.error("Admin authorization lookup failed:", adminMembershipError.message);
      return response(500, { error: "Unable to authorize this request." });
    }
    if (!adminMembership) {
      return response(403, { error: "Only an active organization Admin can create member accounts." });
    }

    const { data: organization, error: organizationError } = await adminClient
      .from("organizations")
      .select("subscription_status, trial_ends_at")
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError || !organization) {
      return response(404, { error: "Organization not found." });
    }
    if (organization.subscription_status !== "active" && organization.subscription_status !== "trial") {
      return response(403, { error: "This organization is not currently active." });
    }

    const { data: existingMember, error: existingError } = await adminClient
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("login_name", username)
      .maybeSingle();
    if (existingError) {
      console.error("Duplicate account check failed:", existingError.message);
      return response(500, { error: "Unable to create this account." });
    }
    if (existingMember) {
      return response(409, { error: "That username is already used in this organization." });
    }

    const authEmail = `${crypto.randomUUID()}@members.invalid`;
    const { data: createdAccount, error: createAuthError } = await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { account_kind: "organization_member" },
    });
    if (createAuthError || !createdAccount.user) {
      console.error("Member auth account creation failed:", createAuthError?.message || "No user returned.");
      return response(500, { error: "Unable to create the member account." });
    }

    const externalId = role === "student" ? username : null;
    const { error: membershipInsertError } = await adminClient
      .from("organization_memberships")
      .insert({
        organization_id: organizationId,
        user_id: createdAccount.user.id,
        role,
        status: "active",
        login_name: username,
        display_name: displayName || username,
        external_id: externalId,
      });
    if (membershipInsertError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(createdAccount.user.id);
      if (cleanupError) {
        console.error("Could not remove orphaned Auth user:", cleanupError.message);
      }
      if (membershipInsertError.code === "23505") {
        return response(409, { error: "That username is already used in this organization." });
      }
      console.error("Member profile creation failed:", membershipInsertError.message);
      return response(500, { error: "Unable to save the member profile." });
    }

    return response(201, { username, role, message: "Member account created. Share the credentials privately." });
  } catch (error) {
    console.error("Member provisioning failed:", error instanceof Error ? error.message : "Unknown error.");
    return response(400, { error: "Unable to process this account request." });
  }
});
