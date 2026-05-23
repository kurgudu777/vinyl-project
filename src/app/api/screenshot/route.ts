import { NextRequest, NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function parseViewport(v: string | null): { width: number; height: number } {
  if (!v) return { width: 1280, height: 800 };
  if (v === 'mobile') return { width: 390, height: 844 };
  if (v === 'desktop') return { width: 1440, height: 900 };
  const m = v.match(/^(\d+)x(\d+)$/);
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { width: 1280, height: 800 };
}

export async function GET(req: NextRequest) {
  const token = process.env.SCREENSHOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'SCREENSHOT_TOKEN env not set' }, { status: 500 });
  }
  const provided =
    req.nextUrl.searchParams.get('token') ||
    req.headers.get('x-screenshot-token') ||
    '';
  if (provided !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  const viewport = parseViewport(req.nextUrl.searchParams.get('viewport'));
  const waitParam = req.nextUrl.searchParams.get('wait') || 'networkidle2';
  const selector = req.nextUrl.searchParams.get('selector');
  const fullPage = req.nextUrl.searchParams.get('full_page') === '1';
  const authUser = req.nextUrl.searchParams.get('auth_user');
  const authPass = req.nextUrl.searchParams.get('auth_pass');

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: viewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();

    if (authUser && authPass) {
      await page.authenticate({ username: authUser, password: authPass });
    }

    const waitUntil = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(waitParam)
      ? (waitParam as 'networkidle2')
      : 'networkidle2';

    await page.goto(url, { waitUntil, timeout: 45000 });

    const waitMs = parseInt(waitParam, 10);
    if (!isNaN(waitMs) && waitMs > 0 && waitMs <= 15000) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    let pngBuffer: Buffer;
    if (selector) {
      const el = await page.$(selector);
      if (!el) {
        await browser.close();
        return NextResponse.json({ error: 'selector not found' }, { status: 404 });
      }
      pngBuffer = (await el.screenshot({ type: 'png' })) as Buffer;
    } else {
      pngBuffer = (await page.screenshot({ type: 'png', fullPage })) as Buffer;
    }

    await browser.close();

    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: unknown) {
    if (browser) await browser.close().catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'screenshot_failed', detail: msg }, { status: 500 });
  }
}
