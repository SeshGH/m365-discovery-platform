import { NextResponse } from "next/server";

function resolvePublicOrigin(req: Request): string {
  const envBase = process.env.PORTAL_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";

  if (host) return `${proto}://${host}`;

  return "http://localhost:3000";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const adminConsent = url.searchParams.get("admin_consent");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const origin = resolvePublicOrigin(req);

  if (error) {
    const message = errorDescription ?? error;
    return NextResponse.redirect(
      `${origin}/tenants?consent=error&reason=${encodeURIComponent(message)}`
    );
  }

  if (adminConsent === "True") {
    return NextResponse.redirect(`${origin}/tenants?consent=granted`);
  }

  return NextResponse.redirect(`${origin}/tenants`);
}