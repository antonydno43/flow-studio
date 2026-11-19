"use client";

/**
 * Typed client API wrapper. All requests use relative paths.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}
export interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      return {
        ok: false,
        error: json?.error ?? { code: "UNKNOWN", message: `Request failed (${res.status})` },
      };
    }
    return json as ApiSuccess<T>;
  } catch (err) {
    return { ok: false, error: { code: "NETWORK", message: (err as Error).message } };
  }
}

export function jget<T>(r: ApiResponse<T>): T | null {
  return r.ok ? r.data : null;
}

export function errMsg(r: ApiResponse<unknown>): string {
  return r.ok ? "" : r.error.message || "Something went wrong";
}
