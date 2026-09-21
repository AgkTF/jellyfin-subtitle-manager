let csrfTokenPromise: Promise<string> | undefined;

function readCsrfCookie(): string | undefined {
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("subtitle_csrf="));
  return cookie?.slice("subtitle_csrf=".length);
}

export async function ensureCsrfToken(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing !== undefined && existing.length > 0) return existing;
  if (csrfTokenPromise !== undefined) return csrfTokenPromise;

  csrfTokenPromise = fetch("/api/csrf-token", {
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) throw new Error(`CSRF token request failed with ${response.status}`);
    await response.text();
    const token = readCsrfCookie();
    if (token === undefined || token.length === 0) throw new Error("CSRF token cookie was not set");
    return token;
  }).catch((error: unknown) => {
    csrfTokenPromise = undefined;
    throw error;
  });
  return csrfTokenPromise;
}

export async function protectedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await ensureCsrfToken();
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", token);
  return fetch(input, { ...init, credentials: "same-origin", headers });
}
