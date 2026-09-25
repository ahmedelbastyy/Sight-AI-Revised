import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const iosKey = Deno.env.get('REVENUECAT_IOS_API_KEY') ?? '';

    return new Response(
      JSON.stringify({ ios_key: iosKey }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('get-rc-config error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get config' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
