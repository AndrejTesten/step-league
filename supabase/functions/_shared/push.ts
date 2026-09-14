// Shared between nightly-rollup and peek-live-sync — both send Expo pushes
// with the service-role key, so the helpers live here instead of being
// copy-pasted into each function's index.ts.

// Supabase's PostgREST .in() filter and the upsert payload both have
// practical size limits; chunk large id/row lists instead of sending one
// giant request that could time out or get rejected outright.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Expo's push API caps a single request at 100 messages, and has no auth
// requirement for the volume this app is at (an EXPO_ACCESS_TOKEN secret
// could be added later if that ever changes — see
// https://docs.expo.dev/push-notifications/sending-notifications/).
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushMessage = {
  to: string;
  data?: Record<string, unknown>;
  title?: string;
  body?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  _contentAvailable?: boolean;
};

export async function sendExpoPushMessages(messages: PushMessage[]): Promise<void> {
  for (const batch of chunk(messages, 100)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error(`Expo push send failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      console.error(`Expo push send threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
