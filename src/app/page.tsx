'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  MonitorPlay,
  ArrowUpRight,
  Sparkles,
  Trash2,
  Sun,
  Moon,
  Search,
  X,
  Radio,
} from 'lucide-react';
import {
  supabase,
  Room,
  RoomTheme,
  ROOM_THEMES,
  slugifyRoomName,
} from '@/lib/supabase';
import { LiquidBackground } from '@/components/LiquidBackground';

export default function HomePage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [darkMode, setDarkMode] = useState(false);

  // Modal de nova sala
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTheme, setNewTheme] = useState<RoomTheme>('prism');
  const [creatorName, setCreatorName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const savedTheme = localStorage.getItem('corneada_ui_theme');
    if (savedTheme === 'dark') {
      setDarkMode(true);
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    const savedNick = localStorage.getItem('corneada_username');
    if (savedNick) setCreatorName(savedNick);

    fetchRooms();

    // Atualiza lista em tempo real se um amigo criar ou apagar sala
    const channel = supabase
      .channel('lobby-rooms-sync')
      .on('broadcast', { event: 'rooms-updated' }, () => {
        fetchRooms();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchRooms() {
    setLoading(true);
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRooms(data as Room[]);
    }
    setLoading(false);
  }

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('corneada_ui_theme', next ? 'dark' : 'light');
  }

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    const cleanName = newName.trim();
    if (cleanName.length < 2) {
      setErrorMsg('Escolha um nome com pelo menos 2 caracteres.');
      return;
    }

    const slug = slugifyRoomName(cleanName);
    if (!slug) {
      setErrorMsg('Use letras ou números no nome da sala.');
      return;
    }

    setCreating(true);
    const author = creatorName.trim() || 'Anônimo';
    if (creatorName.trim()) {
      localStorage.setItem('corneada_username', creatorName.trim());
    }

    const { data, error } = await supabase
      .from('rooms')
      .insert([
        {
          name: cleanName,
          slug,
          description: newDesc.trim() || 'Transmissão de tela em alta qualidade',
          theme: newTheme,
          created_by: author,
        },
      ])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        setErrorMsg('Já existe uma sala com esse nome. Escolha outro!');
      } else {
        setErrorMsg('Não foi possível criar a sala. Tente novamente.');
      }
      setCreating(false);
      return;
    }

    // Notifica quem está no lobby
    await supabase.channel('lobby-rooms-sync').send({
      type: 'broadcast',
      event: 'rooms-updated',
      payload: {},
    });

    setCreating(false);
    setIsModalOpen(false);
    setNewName('');
    setNewDesc('');
    router.push(`/sala/${(data as Room).slug}`);
  }

  async function handleDeleteRoom(e: React.MouseEvent, room: Room) {
    e.stopPropagation();
    const ok = window.confirm(`Apagar a sala "${room.name}" permanentemente?`);
    if (!ok) return;

    await supabase.from('rooms').delete().eq('id', room.id);
    setRooms((prev) => prev.filter((r) => r.id !== room.id));
    await supabase.channel('lobby-rooms-sync').send({
      type: 'broadcast',
      event: 'rooms-updated',
      payload: {},
    });
  }

  const filteredRooms = rooms.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="relative min-h-screen px-4 pb-20 pt-6 sm:px-8">
      <LiquidBackground />

      {/* Header flutuante em Cápsula Liquid Glass */}
      <motion.header
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="liquid-glass liquid-specular mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-3 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full liquid-pill">
            <span
              className="absolute inset-1 rounded-full opacity-80 blur-[3px]"
              style={{ background: ROOM_THEMES.prism.gradient }}
            />
            <MonitorPlay className="relative h-5 w-5 text-white drop-shadow" />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight sm:text-lg">
              Tela da Corneada
            </h1>
            <p className="hidden text-xs opacity-65 sm:block">
              1080p 60fps • Sem login • Salas permanentes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Interruptor estilo cápsula verde/vidro do iOS */}
          <button
            onClick={toggleTheme}
            title={darkMode ? 'Ativar Liquid Studio (Claro)' : 'Ativar Cinema Glass (Escuro)'}
            className="liquid-pill flex h-10 w-10 items-center justify-center rounded-full"
          >
            {darkMode ? (
              <Sun className="h-4 w-4 text-amber-300" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="liquid-btn-accent flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold sm:px-5"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span>Nova Sala</span>
          </button>
        </div>
      </motion.header>

      {/* Hero Compacto & Chamativo */}
      <section className="mx-auto mt-12 max-w-6xl">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col justify-between gap-6 md:flex-row md:items-end"
        >
          <div className="max-w-2xl">
            <div className="liquid-pill mb-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_10px_#22c55e]" />
              <span>Transmissão P2P Ultra Fluida</span>
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Destinado à{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: ROOM_THEMES.prism.gradient }}
              >
                Tropinha do Banho Coletivo do Dudu
              </span>
              .
            </h2>
            <p className="mt-3 text-base opacity-75 sm:text-lg">
              O ponto oficial da tropa para telar em Full HD 60fps com áudio.
              Escolha uma sala salva abaixo ou crie a sua, entre só com seu nome
              e troque ideia no chat ao vivo.
            </p>
          </div>

          {/* Barra de busca em cápsula */}
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar sala..."
              className="liquid-input w-full rounded-full py-3 pl-11 pr-4 text-sm font-medium"
            />
          </div>
        </motion.div>

        {/* Grade de Salas */}
        <div className="mt-10">
          {loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="liquid-glass h-52 animate-pulse rounded-[32px]"
                />
              ))}
            </div>
          ) : filteredRooms.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="liquid-glass liquid-specular flex flex-col items-center justify-center rounded-[36px] px-6 py-16 text-center"
            >
              <div className="liquid-pill mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                <Sparkles className="h-7 w-7 opacity-70" />
              </div>
              <h3 className="text-xl font-bold">Nenhuma sala encontrada</h3>
              <p className="mt-1 max-w-md text-sm opacity-70">
                Crie a primeira sala agora e ela ficará salva aqui para quando a galera quiser colar.
              </p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="liquid-btn-accent mt-6 flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
              >
                <Plus className="h-4 w-4" />
                Criar Primeira Sala
              </button>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {filteredRooms.map((room, idx) => {
                const theme = ROOM_THEMES[room.theme] || ROOM_THEMES.prism;
                return (
                  <motion.div
                    key={room.id}
                    layout
                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: idx * 0.05,
                      type: 'spring',
                      stiffness: 300,
                      damping: 26,
                    }}
                    whileHover={{ y: -6, scale: 1.015 }}
                    onClick={() => router.push(`/sala/${room.slug}`)}
                    className="liquid-glass liquid-specular group relative cursor-pointer overflow-hidden rounded-[32px] p-6 transition-shadow"
                  >
                    {/* Faixa prismática refratada atrás da borda superior */}
                    <div
                      className="pointer-events-none absolute -top-6 left-6 right-6 h-14 rounded-full opacity-70 blur-xl transition-opacity duration-300 group-hover:opacity-100"
                      style={{ background: theme.gradient }}
                    />
                    <div
                      className="relative mb-5 h-2 w-24 rounded-full shadow-sm"
                      style={{ background: theme.gradient }}
                    />

                    <div className="relative flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-extrabold tracking-tight">
                          {room.name}
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-sm opacity-70">
                          {room.description || 'Sala pronta para transmissão.'}
                        </p>
                      </div>

                      <button
                        onClick={(e) => handleDeleteRoom(e, room)}
                        title="Excluir sala"
                        className="liquid-pill flex h-9 w-9 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </button>
                    </div>

                    <div className="relative mt-8 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium opacity-70">
                        <Radio className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Por {room.created_by || 'Anônimo'}</span>
                      </div>

                      <div className="liquid-pill flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold">
                        <span>Entrar</span>
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      </section>

      {/* Modal Liquid Glass para criar nova sala */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-md"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="liquid-glass-strong liquid-specular relative w-full max-w-md overflow-hidden rounded-[36px] p-7"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-extrabold tracking-tight">
                    Criar Nova Sala
                  </h3>
                  <p className="text-xs opacity-70">
                    Ela ficará salva permanentemente no site.
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider opacity-70">
                    Nome da Sala
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Telinha do CS, Filmes de Sexta..."
                    className="liquid-input w-full rounded-2xl px-4 py-3 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider opacity-70">
                    Descrição Curta (opcional)
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="O que vai rolar nessa sala?"
                    className="liquid-input w-full rounded-2xl px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider opacity-70">
                    Seu Apelido (opcional)
                  </label>
                  <input
                    type="text"
                    maxLength={24}
                    value={creatorName}
                    onChange={(e) => setCreatorName(e.target.value)}
                    placeholder="Como a galera te chama?"
                    className="liquid-input w-full rounded-2xl px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider opacity-70">
                    Refração Cromática da Sala
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(Object.keys(ROOM_THEMES) as RoomTheme[]).map((key) => {
                      const active = newTheme === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setNewTheme(key)}
                          className={`liquid-pill flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs font-bold ${
                            active ? 'ring-2 ring-sky-400' : 'opacity-80'
                          }`}
                        >
                          <span
                            className="h-4 w-4 shrink-0 rounded-full shadow-inner"
                            style={{ background: ROOM_THEMES[key].gradient }}
                          />
                          <span>{ROOM_THEMES[key].label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {errorMsg && (
                  <p className="rounded-2xl bg-rose-500/15 px-4 py-2.5 text-xs font-semibold text-rose-500">
                    {errorMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={creating}
                  className="liquid-btn-accent mt-2 w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-60"
                >
                  {creating ? 'Criando sala...' : 'Criar e Entrar Agora'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}