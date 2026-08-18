import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const rawSecret = process.env.JWT_SECRET ?? "";
const JWT_SECRET = new TextEncoder().encode(rawSecret);

// Routes that require authentication
const PROTECTED_PATTERNS = [
  /^\/chat(\/.*)?$/,
  /^\/documents(\/.*)?$/,
  /^\/knowledge(\/.*)?$/,
  /^\/experiences(\/.*)?$/,
  /^\/search(\/.*)?$/,
  /^\/admin(\/.*)?$/,
  /^\/profile(\/.*)?$/,
  /^\/api\/chat(\/.*)?$/,
  /^\/api\/documents(\/.*)?$/,
  /^\/api\/knowledge(\/.*)?$/,
  /^\/api\/experiences(\/.*)?$/,
  /^\/api\/search(\/.*)?$/,
  /^\/api\/admin(\/.*)?$/,
  /^\/api\/audit(\/.*)?$/,
];

// Routes that are always public
const PUBLIC_PATTERNS = [
  /^\/login$/,
  /^\/setup(\/.*)?$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/api\/health$/,
  /^\/api\/setup(\/.*)?$/,
  /^\/_next(\/.*)?$/,
  /^\/favicon\.ico$/,
];

function isProtected(pathname: string): boolean {
  if (PUBLIC_PATTERNS.some((p) => p.test(pathname))) return false;
  return PROTECTED_PATTERNS.some((p) => p.test(pathname));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  // Validate JWT token
  const token = request.cookies.get("access_token")?.value;
  if (!token) {
    // API routes return 401; page routes redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "احراز هویت الزامی است", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    // Token invalid or expired
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "جلسه منقضی شده است", code: "SESSION_EXPIRED" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("access_token");
    return response;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
