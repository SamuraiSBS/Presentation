const guestUserId = process.env.TEMP_USER_ID || "local-user";

export async function requireUserId() {
  return guestUserId;
}

export async function internalFetch(path: string, init: RequestInit = {}) {
  const userId = await requireUserId();
  const baseUrl = process.env.INTERNAL_API_URL || "http://localhost:4000";
  const response = await fetch(`${baseUrl}/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.headers || {}),
      "x-user-id": userId,
      "x-internal-token": process.env.INTERNAL_API_TOKEN || "",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Internal API failed with ${response.status}`);
  }

  return response.json();
}
