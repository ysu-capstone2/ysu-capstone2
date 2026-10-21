const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

export async function supabaseRequest(endpoint, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase credentials are missing');
  }

  const cleanUrl = SUPABASE_URL.replace(/\/+$/, '');
  const url = `${cleanUrl}/rest/v1/${endpoint.replace(/^\/+/, '')}`;

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: options.prefer || 'return=representation',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase API error (${response.status}): ${errorText}`);
  }

  return response.json();
}
