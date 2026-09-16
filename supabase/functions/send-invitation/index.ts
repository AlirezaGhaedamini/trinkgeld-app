/**
 * send-invitation — deliver a workplace invitation by email.
 *
 * TipCrew's invitation flow does not depend on this function. create_invitation()
 * mints the row and returns the raw token exactly once; the manager can always
 * copy the link and hand it over themselves. This is a BEST-EFFORT DELIVERY
 * LAYER on top of that, and every failure path below leaves the invitation
 * itself untouched and still copyable.
 *
 * ── NO SERVICE ROLE ───────────────────────────────────────────────────────
 * Authorisation is done entirely with the CALLER'S OWN JWT against the same RLS
 * the browser is subject to, because that turned out to be sufficient:
 *
 *   · reading the invitation — invitations_select (migration 07) returns the row
 *     to a manager of its workplace. It also returns it to the person whose
 *     profile email matches, so a successful read is NOT on its own proof of
 *     being a manager, which is why the next check exists;
 *   · proving the caller manages THAT workplace — a select on workplace_members
 *     for (workplace_id from the invitation row, auth.uid(), role manager,
 *     status active). RLS filters it to nothing for anybody else.
 *
 * So no elevated privilege is needed and none is used. There is no service-role
 * key in this function, in the frontend, or in the repository.
 *
 * ── AND NO OPEN RELAY ─────────────────────────────────────────────────────
 * The browser sends an invitation id and the raw token, never a URL and never a
 * recipient. The recipient comes from the invitation row, the link is built
 * here from APP_BASE_URL, and the token is checked against the row's stored
 * SHA-256 before anything is sent. A manager therefore cannot use this to mail
 * an arbitrary address or an arbitrary link.
 *
 * ── SECRETS ───────────────────────────────────────────────────────────────
 * RESEND_API_KEY, INVITE_FROM_ADDRESS, APP_BASE_URL — Edge Function secrets,
 * set with `supabase secrets set`. None of them is a VITE_ variable, none is
 * committed, and none is ever logged.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Structured, safe, and the same shape whether it worked or not. */
function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The token create_invitation() mints: 64 hex characters, nothing else. */
function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── the email, in both languages ────────────────────────────────────────── */
/**
 * Which language.
 *
 * The person being invited has no account yet, so nothing about them is known —
 * there is no invitation language column and adding one would be a migration
 * for a preference nobody has expressed. The closest reliable signal is the
 * MANAGER who is inviting them: they picked their own language in the app, it
 * is stored on their profile, and they are the one who knows their team. Read
 * server-side, never taken from the request. Falls back to German, which is the
 * product's market and the default on profiles.locale.
 */
interface Copy {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  expiry: string;
  fallback: string;
  personal: string;
  /** Label for the workplace code — the app's own on-screen wording. */
  codeLabel: string;
  /** What to do with the code, including that the manager confirms it. */
  codeFallback: string;
  signoff: string;
}

function copyFor(locale: string, name: string, workplace: string, days: number): Copy {
  if (locale === 'en') {
    return {
      subject: `You have been invited to ${workplace} on TipCrew`,
      heading: 'Join your team on TipCrew',
      intro: `Hello ${name}, ${workplace} has invited you to join them on TipCrew — where the team's tips are pooled and divided by the rules you all agreed.`,
      cta: 'Join workplace',
      expiry: `This invitation is valid for ${days} days.`,
      fallback: 'If the button does not work, copy this link into your browser:',
      personal: 'The link is personal and can be used once.',
      codeLabel: 'Workplace code',
      codeFallback: `If the link does not work either, open TipCrew, choose Ask to join and enter this code for ${workplace}. Your manager then confirms the request.`,
      signoff: 'TipCrew',
    };
  }
  return {
    subject: `Du wurdest zu ${workplace} bei TipCrew eingeladen`,
    heading: 'Tritt deinem Team bei TipCrew bei',
    intro: `Hallo ${name}, ${workplace} lädt dich zu TipCrew ein — dort wird das Trinkgeld des Teams zusammengelegt und nach den Regeln verteilt, auf die ihr euch geeinigt habt.`,
    cta: 'Arbeitsplatz beitreten',
    expiry: `Diese Einladung ist ${days} Tage gültig.`,
    fallback: 'Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:',
    personal: 'Der Link ist persönlich und kann einmal verwendet werden.',
    codeLabel: 'Betriebs-Code',
    codeFallback: `Falls auch der Link nicht funktioniert, öffne TipCrew, wähle „Beitritt anfragen“ und gib diesen Code für ${workplace} ein. Deine Leitung bestätigt die Anfrage dann.`,
    signoff: 'TipCrew',
  };
}

function renderHtml(c: Copy, link: string, code: string | null): string {
  const safeLink = escapeHtml(link);
  // The email's existing body and secondary-text styles, reused. Only the code
  // itself gets a fixed-width face and a little tracking: it is the one thing
  // here somebody may have to read off one screen and type into another.
  const codeBlock = code
    ? `
    <p style="margin:18px 0 6px;font-size:15px;line-height:1.55;">${escapeHtml(c.codeLabel)}: <strong style="letter-spacing:.08em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(code)}</strong></p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#6b6b66;">${escapeHtml(c.codeFallback)}</p>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;">
    <p style="margin:0 0 20px;font-size:15px;font-weight:600;letter-spacing:.02em;">TipCrew</p>
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;">${escapeHtml(c.heading)}</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55;">${escapeHtml(c.intro)}</p>
    <p style="margin:0 0 22px;">
      <a href="${safeLink}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-size:15px;font-weight:600;">${escapeHtml(c.cta)}</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#6b6b66;">${escapeHtml(c.expiry)} ${escapeHtml(c.personal)}</p>
    <p style="margin:14px 0 6px;font-size:13px;line-height:1.5;color:#6b6b66;">${escapeHtml(c.fallback)}</p>
    <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeLink}" style="color:#3f6d55;">${safeLink}</a></p>${codeBlock}
    <p style="margin:24px 0 0;font-size:13px;color:#6b6b66;">${escapeHtml(c.signoff)}</p>
  </div>
</body></html>`;
}

function renderText(c: Copy, link: string, code: string | null): string {
  return [
    c.heading,
    '',
    c.intro,
    '',
    `${c.cta}: ${link}`,
    '',
    `${c.expiry} ${c.personal}`,
    ...(code ? ['', `${c.codeLabel}: ${code}`, c.codeFallback] : []),
    '',
    c.signoff,
  ].join('\n');
}

/* ── the function ────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { sent: false, reason: 'method_not_allowed' });

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const FROM = Deno.env.get('INVITE_FROM_ADDRESS');
  const APP_BASE_URL = Deno.env.get('APP_BASE_URL');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  if (!RESEND_API_KEY || !FROM || !APP_BASE_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Names only. Never the values.
    console.error('send-invitation: missing configuration');
    return reply(500, { sent: false, reason: 'not_configured' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return reply(401, { sent: false, reason: 'unauthenticated' });
  }

  let body: { invitationId?: unknown; token?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { sent: false, reason: 'bad_request' });
  }
  const invitationId = body.invitationId;
  const token = body.token;
  if (!isUuid(invitationId) || !isToken(token)) {
    return reply(400, { sent: false, reason: 'bad_request' });
  }

  // The caller's own client: every read below is subject to the same RLS the
  // browser is subject to, which is what makes the service-role key unnecessary.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return reply(401, { sent: false, reason: 'unauthenticated' });

  const { data: invitation, error: invitationError } = await supabase
    .from('invitations')
    .select('id, workplace_id, kind, email, token_hash, status, expires_at, member_id')
    .eq('id', invitationId)
    .maybeSingle();
  if (invitationError || !invitation) return reply(404, { sent: false, reason: 'not_found' });

  // The workplace id is taken from the invitation row, never from the request.
  const { data: manager } = await supabase
    .from('workplace_members')
    .select('id, display_name')
    .eq('workplace_id', invitation.workplace_id)
    .eq('user_id', user.id)
    .eq('role', 'manager')
    .eq('status', 'active')
    .maybeSingle();
  if (!manager) return reply(403, { sent: false, reason: 'not_a_manager' });

  if (invitation.kind !== 'invite') return reply(400, { sent: false, reason: 'not_an_invitation' });
  if (invitation.status !== 'pending') return reply(409, { sent: false, reason: 'not_pending' });
  if (!invitation.email) return reply(400, { sent: false, reason: 'no_recipient' });
  const expiresAt = new Date(invitation.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    return reply(409, { sent: false, reason: 'expired' });
  }

  // The token has to be the one this invitation was minted with. Without this a
  // manager could have the function mail any link at all.
  if (!invitation.token_hash || (await sha256Hex(token)) !== invitation.token_hash) {
    return reply(400, { sent: false, reason: 'token_mismatch' });
  }

  const { data: workplace } = await supabase
    .from('workplaces')
    .select('name, join_code, join_code_enabled')
    .eq('id', invitation.workplace_id)
    .maybeSingle();

  /**
   * The workplace code, as a second way in — and only when it is one.
   *
   * Safe to put in an email because it is not a credential. request_join()
   * (migration 07) turns a code into a PENDING join request and nothing more: the
   * role is hard-coded to employee, and only approve_join_request(), which
   * requires a manager of that workplace, turns a request into a membership. It
   * is also meant to be passed around: its alphabet drops I, O, 0 and 1 because
   * it "gets read out over the phone in a loud room", and the invite screen
   * already shows it to managers with a Copy button. Members read it under
   * workplaces_select_member, so nothing is added to what this caller may see.
   *
   * Left out when join_code_enabled is off, because request_join() refuses a
   * disabled code and printing it would send the person to a dead end. The
   * one-time invitation link is untouched and stays the primary action.
   */
  const joinCode =
    workplace?.join_code_enabled === true &&
    typeof workplace.join_code === 'string' &&
    /^[A-Za-z0-9]{4,12}$/.test(workplace.join_code)
      ? workplace.join_code.toUpperCase()
      : null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('locale')
    .eq('id', user.id)
    .maybeSingle();

  const { data: invitedMember } = invitation.member_id
    ? await supabase
        .from('workplace_members')
        .select('display_name')
        .eq('id', invitation.member_id)
        .maybeSingle()
    : { data: null };

  const days = Math.max(
    1,
    Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  const copy = copyFor(
    profile?.locale === 'en' ? 'en' : 'de',
    invitedMember?.display_name ?? '',
    workplace?.name ?? 'TipCrew',
    days,
  );

  // Built here, from a secret, so the browser cannot choose where the email
  // points. Matches joinLinkFor() in src/team/types.ts.
  const link = `${APP_BASE_URL.replace(/\/+$/, '')}/#/join?token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // One invitation, one email. A retry after a timeout that the provider
        // had in fact accepted does not send a second copy.
        'Idempotency-Key': `tipcrew-invitation-${invitation.id}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [invitation.email],
        subject: copy.subject,
        html: renderHtml(copy, link, joinCode),
        text: renderText(copy, link, joinCode),
      }),
    });

    if (!response.ok) {
      // Status only. The provider's body can quote the recipient back, and the
      // link is not something to write into a log either.
      console.error('send-invitation: provider refused', response.status);
      return reply(502, { sent: false, reason: 'provider_error' });
    }
    return reply(200, { sent: true });
  } catch {
    console.error('send-invitation: provider unreachable');
    return reply(502, { sent: false, reason: 'provider_unreachable' });
  }
});
