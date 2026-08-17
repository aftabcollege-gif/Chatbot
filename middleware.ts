import {NextRequest,NextResponse} from 'next/server';
export function middleware(req:NextRequest){
 const protectedRoutes=['/admin','/chat','/resources','/knowledge'];
 if(protectedRoutes.some(r=>req.nextUrl.pathname.startsWith(r))){
  const token=req.cookies.get('access_token');
  if(!token) return NextResponse.redirect(new URL('/login',req.url));
 }
 return NextResponse.next();
}
export const config={matcher:['/admin/:path*','/chat/:path*','/resources/:path*','/knowledge/:path*']};
