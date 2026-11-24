'use client';

import { motion } from 'framer-motion';

export function LiquidBackground({ subtle = false }: { subtle?: boolean }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    >
      {/* Faixa prismática superior direita (referência direta ao Liquid Glass) */}
      <motion.div
        animate={{
          x: [0, 35, -20, 0],
          y: [0, -25, 18, 0],
          rotate: [-12, -8, -15, -12],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute -right-24 top-16 h-24 w-[520px] rounded-full blur-2xl ${
          subtle ? 'opacity-30' : 'opacity-65'
        }`}
        style={{
          background:
            'linear-gradient(90deg, #0ea5e9 0%, #ec4899 45%, #f97316 76%, #84cc16 100%)',
        }}
      />

      {/* Cápsula azul elétrica à esquerda */}
      <motion.div
        animate={{
          x: [0, -24, 28, 0],
          y: [0, 32, -16, 0],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute -left-24 top-1/3 h-28 w-[420px] rounded-full blur-2xl ${
          subtle ? 'opacity-25' : 'opacity-55'
        }`}
        style={{
          background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)',
        }}
      />

      {/* Cápsula verde fluida central-esquerda */}
      <motion.div
        animate={{
          x: [0, 42, -18, 0],
          y: [0, -28, 22, 0],
          scale: [1, 1.08, 0.96, 1],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute left-[18%] top-[14%] h-32 w-56 rounded-full blur-3xl ${
          subtle ? 'opacity-20' : 'opacity-45'
        }`}
        style={{
          background: 'linear-gradient(135deg, #22c55e 0%, #84cc16 100%)',
        }}
      />

      {/* Orbe prismático inferior */}
      <motion.div
        animate={{
          x: [0, -35, 30, 0],
          y: [0, -20, 25, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
        className={`absolute -bottom-28 right-[18%] h-72 w-72 rounded-full blur-3xl ${
          subtle ? 'opacity-20' : 'opacity-45'
        }`}
        style={{
          background:
            'radial-gradient(circle, rgba(236,72,153,0.75) 0%, rgba(14,165,233,0.45) 60%, transparent 100%)',
        }}
      />

      {/* Grade óptica ultra sutil */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />
    </div>
  );
}