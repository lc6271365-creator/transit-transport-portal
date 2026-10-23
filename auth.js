"use strict";

const config = window.TRANSIT_SUPABASE_CONFIG || {};
const form = document.querySelector("[data-account-form]");
const status = document.querySelector("[data-account-status]");
const submitButton = form?.querySelector("[type='submit']");

function setStatus(message, state = "") {
  status.textContent = message;
  status.dataset.state = state;
}

function getBaseUrl() {
  const url = config.url?.replace(/\/+$/, "");
  if (!url || !config.anonKey) {
    throw new Error("Supabase URL aur anon key configure nahi hain. supabase-config.js mein project ki public settings add karein.");
  }
  return url;
}

async function request(path, body, accessToken = "") {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken || config.anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.msg || result.message || result.error_description || result.error || "Request failed. Please try again.");
  }
  return result;
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    submitButton.disabled = true;
    setStatus("Connecting securely…");

    try {
      const mode = form.dataset.mode;
      if (mode === "admin") {
        const email = String(formData.get("email") || "").trim();
        const token = String(formData.get("code") || "").trim();
        const organizationName = String(formData.get("organization") || "").trim();
        const slug = String(formData.get("slug") || "").trim().toLowerCase();

        if (!token) {
          if (formData.get("intent") === "signup" &&
            (!organizationName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 63)) {
            throw new Error("Organization name aur 3–63 character ka valid URL slug bharna zaroori hai.");
          }
          await request("/auth/v1/otp", { email, create_user: formData.get("intent") === "signup" });
          form.querySelector("[data-verification-step]").hidden = false;
          form.querySelector("[name='code']").focus();
          setStatus("Verification code sent. Check the email inbox and enter the code here.", "success");
          return;
        }

        const session = await request("/auth/v1/verify", { email, token, type: "email" });
        sessionStorage.setItem("transit_access_token", session.access_token);
        sessionStorage.setItem("transit_refresh_token", session.refresh_token);
        if (formData.get("intent") === "signup") {
          if (!organizationName || !slug) {
            throw new Error("Organization name aur URL slug dono bharna zaroori hai.");
          }
          const createdOrganization = await callRpc("create_organization_with_access_code", {
            organization_name: organizationName,
            organization_slug: slug,
          }, session.access_token);
          sessionStorage.setItem("transit_organization_id", createdOrganization.organization_id);
          const output = document.querySelector("[data-reference-code]");
          output.closest("[data-code-result]").hidden = false;
          output.value = createdOrganization.access_code;
          output.hidden = false;
          document.querySelector("[data-dashboard-link]").hidden = false;
          setStatus("Email verified. Aapka 3-day trial shuru ho gaya. Organization reference code save/share karein.", "success");
          return;
        }

        async function callRpc(name, body, accessToken) {
          const response = await fetch(`${getBaseUrl()}/rest/v1/rpc/${name}`, {
            method: "POST",
            headers: {
              apikey: config.anonKey,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          const result = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(result?.message || `Supabase ${name} request failed.`);
          }
          return result;
        }

        const membershipsResponse = await fetch(
          `${getBaseUrl()}/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(session.user.id)}&status=eq.active&select=organization_id,role`,
          {
            headers: {
              apikey: config.anonKey,
              Authorization: `Bearer ${session.access_token}`,
            },
          },
        );
        const memberships = await membershipsResponse.json().catch(() => []);
        if (!membershipsResponse.ok || !Array.isArray(memberships)) {
          throw new Error("Admin organization load nahi ho saki.");
        }
        const organization = memberships.find((membership) => ["owner", "admin"].includes(membership.role));
        if (!organization) {
          throw new Error("Is email se koi active Admin workspace nahi mila.");
        }
        sessionStorage.setItem("transit_organization_id", organization.organization_id);
        setStatus("Email verified. Admin portal khul raha hai.", "success");
        window.location.assign("index.html");
        return;
      }

      const payload = {
        organization_code: String(formData.get("organization_code") || "").trim(),
        username: String(formData.get("username") || "").trim(),
        password: String(formData.get("password") || ""),
        role: mode,
      };
      const result = await request("/functions/v1/Member-login", payload);
      sessionStorage.setItem("transit_access_token", result.access_token);
      sessionStorage.setItem("transit_refresh_token", result.refresh_token);
      sessionStorage.setItem("transit_organization_id", result.organization_id);
      window.location.assign(mode === "student" ? "../index.html" : "../driver/index.html");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

document.querySelector("[data-copy-code]")?.addEventListener("click", async () => {
  const code = document.querySelector("[data-reference-code]")?.value;
  if (!code) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    setStatus("Organization reference code copied.", "success");
  } catch (error) {
    setStatus("Copy nahi hua. Code select karke manually copy karein.", "error");
  }
});

document.querySelectorAll("button[data-intent]").forEach((button) => {
  button.addEventListener("click", () => {
    form.dataset.intent = button.dataset.intent;
    form.querySelector("[name='intent']").value = button.dataset.intent;
    document.querySelectorAll("button[data-intent]").forEach((item) => {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    });
    form.querySelector("[data-organization-fields]").hidden = button.dataset.intent !== "signup";
    form.querySelector("[data-verification-step]").hidden = true;
    form.querySelector("[name='code']").value = "";
    form.querySelector("[type='submit']").textContent = "Email me a verification code";
    setStatus("");
  });
});
