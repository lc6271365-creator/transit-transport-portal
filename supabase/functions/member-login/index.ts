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
    console.error("Member sign-in is missing Supabase server configuration.");
    return response(503, { error: "Secure sign-in is not configured yet." });
  }

  try {
    const body = await request.json();
    const code = typeof body.organization_code === "string" ? body.organization_code.trim() : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;

    if (!/^[a-f0-9]{32}$/i.test(code) || !/^[a-z0-9._-]{2,50}$/.test(username) || password.length < 10) {
      return response(400, { error: "Check your organization code, username, and password." });
    }
    if (role !== "driver" && role !== "student") {
      return response(400, { error: "Invalid account type." });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: organizationId, error: codeError } = await adminClient.rpc(
      "lookup_organization_by_access_code",
      { code_to_check: code },
    );
    if (codeError) {
      console.error("Organization code lookup failed:", codeError.message);
      return response(500, { error: "Unable to verify organization code." });
    }
    if (!organizationId) {
      return response(401, { error: "Sign-in details are not valid." });
    }

    const { data: membership, error: membershipError } = await adminClient
      .from("organization_memberships")
      .select("user_id, role, status, login_name")
      .eq("organization_id", organizationId)
      .eq("login_name", username)
      .eq("role", role)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) {
      console.error("Member lookup failed:", membershipError.message);
      return response(500, { error: "Unable to sign in at this time." });
    }
    if (!membership) {
      return response(401, { error: "Sign-in details are not valid." });
    }

    const { data: account, error: accountError } = await adminClient.auth.admin.getUserById(membership.user_id);
    if (accountError || !account.user?.email) {
      console.error("Member auth account lookup failed:", accountError?.message || "Missing auth account.");
      return response(500, { error: "Unable to sign in at this time." });
    }

    const memberClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sessionData, error: signInError } = await memberClient.auth.signInWithPassword({
      email: account.user.email,
      password,
    });
    if (signInError || !sessionData.session) {
      return response(401, { error: "Sign-in details are not valid." });
    }

    return response(200, {
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
      organization_id: organizationId,
      role: membership.role,
    });
  } catch (error) {
    console.error("Member sign-in failed:", error instanceof Error ? error.message : "Unknown error.");
    return response(400, { error: "Unable to process this sign-in request." });
  }
});
