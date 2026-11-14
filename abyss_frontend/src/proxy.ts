import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = ["/", "/home", "/about-trench"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = !!request.cookies.get("a_token")?.value;
  const isAuthRoute = pathname.startsWith("/auth");
  // Public pages anyone can open signed out.
  const isLandingRoute = PUBLIC_ROUTES.includes(pathname);

  if (!isAuthenticated && !isAuthRoute && !isLandingRoute) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  if (isAuthenticated && isAuthRoute) {
    return NextResponse.redirect(new URL("/agents", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // preview-runtime: static, public files the sandboxed live-preview frame
    // loads without cookies (see lib/code-preview.ts) -- never redirect them.
    "/((?!_next/static|_next/image|favicon.ico|preview-runtime/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
