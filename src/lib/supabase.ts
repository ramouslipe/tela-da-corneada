import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 30,
    },
  },
});

export type RoomTheme = 'prism' | 'ocean' | 'emerald' | 'sunset';

export interface Room {
  id: string;
  name: string;
  slug: string;
  description: string;
  theme: RoomTheme;
  created_by: string;
  created_at: string;
}

export const ROOM_THEMES: Record<
  RoomTheme,
  { label: string; gradient: string; glow: string; pill: string }
> = {
  prism: {
    label: 'Prisma iOS',
    gradient: 'linear-gradient(90deg, #0ea5e9 0%, #ec4899 48%, #f97316 78%, #84cc16 100%)',
    glow: 'rgba(236, 72, 153, 0.35)',
    pill: 'from-sky-500 via-pink-500 to-lime-400',
  },
  ocean: {
    label: 'Azul Elétrico',
    gradient: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 55%, #38bdf8 100%)',
    glow: 'rgba(14, 165, 233, 0.35)',
    pill: 'from-blue-600 via-cyan-500 to-sky-400',
  },
  emerald: {
    label: 'Verde Fluido',
    gradient: 'linear-gradient(90deg, #16a34a 0%, #22c55e 50%, #a3e635 100%)',
    glow: 'rgba(34, 197, 94, 0.35)',
    pill: 'from-green-600 via-emerald-500 to-lime-400',
  },
  sunset: {
    label: 'Solar Neon',
    gradient: 'linear-gradient(90deg, #f43f5e 0%, #fb923c 55%, #facc15 100%)',
    glow: 'rgba(249, 115, 22, 0.35)',
    pill: 'from-rose-500 via-orange-400 to-yellow-400',
  },
};

export function slugifyRoomName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}