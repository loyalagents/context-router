import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

interface DebugTokenPayload {
  token: string | undefined;
  user: unknown;
  tokenLength: number;
  tokenPrefix: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return formatResponse(
        request,
        { error: 'Not authenticated' },
        { status: 401 },
      );
    }

    const tokenResult = await auth0.getAccessToken();
    const accessToken = tokenResult?.token;

    const payload: DebugTokenPayload = {
      token: accessToken,
      user: session.user,
      tokenLength: accessToken?.length ?? 0,
      tokenPrefix: accessToken
        ? `${accessToken.substring(0, 50)}...`
        : '(missing)',
    };

    return formatResponse(request, payload);
  } catch (error) {
    console.error('Error getting token:', error);
    return formatResponse(
      request,
      { error: 'Failed to get token' },
      { status: 500 },
    );
  }
}

function formatResponse(
  request: NextRequest,
  payload: DebugTokenPayload | { error: string },
  init?: ResponseInit,
): Response {
  const format = request.nextUrl.searchParams.get('format');
  const accept = request.headers.get('accept') ?? '';
  const wantsJson = format === 'json' || !accept.includes('text/html');

  if (wantsJson) {
    return NextResponse.json(payload, init);
  }

  return new Response(renderHtml(payload), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  });
}

function renderHtml(payload: DebugTokenPayload | { error: string }): string {
  if ('error' in payload) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Debug Token</title>
    <style>${baseStyles()}</style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <p class="eyebrow">Debug Token</p>
        <h1>Request Failed</h1>
        <p class="error">${escapeHtml(payload.error)}</p>
      </section>
    </main>
  </body>
</html>`;
  }

  const decodedToken = decodeJwt(payload.token);
  const userJson = JSON.stringify(payload.user, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Debug Token</title>
    <style>${baseStyles()}</style>
  </head>
  <body>
    <main class="page">
      <section class="card hero">
        <div>
          <p class="eyebrow">Debug Token</p>
          <h1>Authenticated Access Token</h1>
          <p class="subtle">This view is for local debugging. Use <code>?format=json</code> for the raw JSON response.</p>
        </div>
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Token Length</span>
            <strong>${payload.tokenLength}</strong>
          </div>
          <div class="meta-item">
            <span class="meta-label">Token Prefix</span>
            <strong class="mono">${escapeHtml(payload.tokenPrefix)}</strong>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>Session User</h2>
          <button type="button" class="button" data-copy-target="session-user">Copy JSON</button>
        </div>
        <pre id="session-user">${escapeHtml(userJson)}</pre>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>JWT Header</h2>
          <button type="button" class="button" data-copy-target="jwt-header">Copy JSON</button>
        </div>
        <pre id="jwt-header">${escapeHtml(JSON.stringify(decodedToken.header, null, 2))}</pre>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>JWT Payload</h2>
          <button type="button" class="button" data-copy-target="jwt-payload">Copy JSON</button>
        </div>
        <pre id="jwt-payload">${escapeHtml(JSON.stringify(decodedToken.payload, null, 2))}</pre>
      </section>

      <section class="card">
        <div class="section-header">
          <h2>Raw Access Token</h2>
          <button type="button" class="button" data-copy-target="raw-token">Copy Token</button>
        </div>
        <textarea id="raw-token" readonly>${escapeHtml(payload.token ?? '')}</textarea>
      </section>
    </main>
    <script>
      document.querySelectorAll('[data-copy-target]').forEach((button) => {
        button.addEventListener('click', async () => {
          const targetId = button.getAttribute('data-copy-target');
          const target = targetId ? document.getElementById(targetId) : null;
          if (!target) return;
          const value = 'value' in target ? target.value : target.textContent || '';
          try {
            await navigator.clipboard.writeText(value);
            const previous = button.textContent;
            button.textContent = 'Copied';
            setTimeout(() => {
              button.textContent = previous;
            }, 1200);
          } catch (_error) {
            button.textContent = 'Copy failed';
          }
        });
      });
    </script>
  </body>
</html>`;
}

function decodeJwt(token: string | undefined): {
  header: unknown;
  payload: unknown;
} {
  if (!token) {
    return {
      header: { error: 'No token returned from Auth0' },
      payload: { error: 'No token returned from Auth0' },
    };
  }

  const [encodedHeader, encodedPayload] = token.split('.');

  return {
    header: decodeJwtPart(encodedHeader),
    payload: decodeJwtPart(encodedPayload),
  };
}

function decodeJwtPart(value: string | undefined): unknown {
  if (!value) {
    return { error: 'Missing JWT segment' };
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    );
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return { error: 'Failed to decode JWT segment' };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function baseStyles(): string {
  return `
    :root {
      color-scheme: light;
      --bg: #f4efe6;
      --card: #fffdf8;
      --ink: #1a1a16;
      --muted: #615d56;
      --line: #d8cfbf;
      --accent: #9b5b28;
      --accent-strong: #7a4318;
      --shadow: 0 18px 48px rgba(60, 41, 20, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(155, 91, 40, 0.16), transparent 30%),
        linear-gradient(180deg, #f8f3ea 0%, var(--bg) 100%);
    }

    .page {
      width: min(1080px, calc(100vw - 32px));
      margin: 32px auto 64px;
      display: grid;
      gap: 16px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 24px;
      box-shadow: var(--shadow);
    }

    .hero {
      display: grid;
      gap: 16px;
    }

    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      color: var(--accent);
      font-weight: 700;
    }

    h1, h2 {
      margin: 0;
      font-weight: 700;
      line-height: 1.1;
    }

    h1 {
      font-size: clamp(2rem, 5vw, 3.75rem);
    }

    h2 {
      font-size: 1.25rem;
    }

    .subtle, .meta-label {
      color: var(--muted);
    }

    .meta-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .meta-item {
      padding: 16px;
      border-radius: 14px;
      background: #f8f1e4;
      border: 1px solid #eadcc4;
    }

    .meta-item strong {
      display: block;
      margin-top: 6px;
      overflow-wrap: anywhere;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .button {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      background: var(--accent);
      color: white;
      font: inherit;
      cursor: pointer;
    }

    .button:hover {
      background: var(--accent-strong);
    }

    pre,
    textarea,
    code,
    .mono {
      font-family: "SFMono-Regular", Menlo, Consolas, monospace;
    }

    pre,
    textarea {
      margin: 0;
      padding: 16px;
      border-radius: 14px;
      border: 1px solid #e5dccd;
      background: #f7f3eb;
      color: #2b2822;
      font-size: 13px;
      line-height: 1.5;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    textarea {
      width: 100%;
      min-height: 220px;
      resize: vertical;
    }

    .error {
      color: #8d1f1f;
      font-weight: 600;
    }

    @media (max-width: 720px) {
      .page {
        width: min(100vw - 20px, 1080px);
        margin: 16px auto 32px;
      }

      .card {
        padding: 18px;
        border-radius: 16px;
      }

      .section-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .button {
        width: 100%;
      }
    }
  `;
}
