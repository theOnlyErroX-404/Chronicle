import { SESSION_COOKIE } from '@/modules/shared/auth';

export const runtime = 'nodejs';

export async function POST() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return new Response(null, {
    status: 204,
    headers: {
      'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    },
  });
}
