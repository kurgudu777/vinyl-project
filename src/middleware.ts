import { NextRequest, NextResponse } from 'next/server';

/**
 * Basic-auth для всего сайта.
 *
 * Env (обязательны на продакшене):
 *   BASIC_AUTH_USER
 *   BASIC_AUTH_PASS
 *
 * Если переменные не заданы — middleware пропускает всё (удобно в dev).
 */
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // Нет env — не защищаем (локальная разработка)
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header) {
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      // atob доступен в edge runtime
      const decoded = atob(encoded);
      const idx = decoded.indexOf(':');
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Синхронизация"',
    },
  });
}

export const config = {
  // Защищаем всё, кроме Next-статики и favicon
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
