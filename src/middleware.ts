import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER?.trim();
  const pass = process.env.BASIC_AUTH_PASS?.trim();

  if (!user || !pass) {
    console.log('[auth] env missing, passthrough');
    return NextResponse.next();
  }

  const header = req.headers.get('authorization') ?? '';
  console.log('[auth] header present:', !!header, 'starts with Basic:', header.startsWith('Basic '));

  if (header.startsWith('Basic ')) {
    const encoded = header.slice(6).trim();
    try {
      const decoded = atob(encoded);
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        const u = decoded.slice(0, idx);
        const p = decoded.slice(idx + 1);
        const userMatch = u === user;
        const passMatch = p === pass;
        console.log('[auth] userMatch:', userMatch, 'passMatch:', passMatch,
          'u.len:', u.length, 'p.len:', p.length,
          'expected u.len:', user.length, 'expected p.len:', pass.length);
        if (userMatch && passMatch) {
          return NextResponse.next();
        }
      } else {
        console.log('[auth] no colon in decoded');
      }
    } catch (e) {
      console.log('[auth] atob failed:', String(e));
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Sync"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
