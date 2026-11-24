'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  MonitorUp,
  MonitorOff,
  Send,
  Users,
  MessageSquare,
  Maximize2,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Sparkles,
  Sun,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  RefreshCw,
} from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, Room, ROOM_THEMES } from '@/lib/supabase';
import { LiquidBackground } from '@/components/LiquidBackground';

interface Participant {
  peerId: string;
  username: string;
  color: string;
  isSharing: boolean;
}

interface ChatMessage {
  id: string;
  senderId: string;
  username: string;
  color: string;
  text: string;
  time: string;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  left: number;
}

type QualityPreset = '1080p60' | '1080p30' | '720p60';
type ConnectionStatus = 'idle' | 'negotiating' | 'connecting' | 'connected' | 'failed';

const QUALITY_CONFIG: Record<
  QualityPreset,
  { label: string; width: number; height: number; fps: number; bitrate: number }
> = {
  '1080p60': { label: '1080p 60fps Ultra', width: 1920, height: 1080, fps: 60, bitrate: 7_500_000 },
  '1080p30': { label: '1080p 30fps Nítido', width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '720p60': { label: '720p 60fps Leve', width: 1280, height: 720, fps: 60, bitrate: 3_200_000 },
};

function getIceConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  const turnUrls = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrls && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls.split(',').map((u) => u.trim()),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return { iceServers };
}

const USER_COLORS = [
  '#0ea5e9',
  '#ec4899',
  '#22c55e',
  '#f97316',
  '#8b5cf6',
  '#06b6d4',
  '#eab308',
];

const QUICK_EMOJIS = ['🔥', '😂', '👏', '🤯', '💀'];

function RoomContent() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params.slug || '');

  // Dados da sala
  const [room, setRoom] = useState<Room | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Identidade (sem login)
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const peerIdRef = useRef<string>('');
  const userColorRef = useRef<string>(
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  );

  // UI
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'users'>('chat');
  const [copiedLink, setCopiedLink] = useState(false);
  const [quality, setQuality] = useState<QualityPreset>('1080p60');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Mídia & WebRTC
  const [isSharing, setIsSharing] = useState(false);
  const [activeSharer, setActiveSharer] = useState<Participant | null>(null);
  const [hasVideoStream, setHasVideoStream] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  // Presença, Chat e Reações
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  // Refs críticas de WebRTC e Realtime
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const qualityRef = useRef<QualityPreset>('1080p60');
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const requestedSharerRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  useEffect(() => {
    peerIdRef.current = crypto.randomUUID();

    const savedNick = localStorage.getItem('corneada_username');
    if (savedNick) setUsername(savedNick);

    const savedTheme = localStorage.getItem('corneada_ui_theme') || 'dark';
    const isDark = savedTheme === 'dark';
    setDarkMode(isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

    async function loadRoom() {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('slug', slug)
        .single();

      if (error || !data) {
        setNotFound(true);
      } else {
        setRoom(data as Room);
      }
    }
    if (slug) loadRoom();
  }, [slug]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isSharing ? true : muted;
    }
  }, [volume, muted, isSharing]);

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('corneada_ui_theme', next ? 'dark' : 'light');
  }

  function spawnReaction(emoji: string) {
    const id = crypto.randomUUID();
    const left = 12 + Math.random() * 76;
    setReactions((prev) => [...prev, { id, emoji, left }]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2200);
  }

  function attachStreamToVideo(stream: MediaStream | null, muteLocal: boolean) {
    const video = videoRef.current;
    if (!video) return;

    // Evita reiniciar o player quando vídeo e áudio chegam em eventos separados
    if (stream && video.srcObject === stream) {
      setHasVideoStream(true);
      return;
    }

    video.srcObject = stream;
    setHasVideoStream(Boolean(stream));

    if (stream) {
      video.muted = muteLocal ? true : muted;
      video
        .play()
        .then(() => setNeedsAudioUnlock(false))
        .catch(() => {
          video.muted = true;
          video.play().catch(() => {});
          if (!muteLocal) setNeedsAudioUnlock(true);
        });
    } else {
      setNeedsAudioUnlock(false);
    }
  }

  function closePeerConnection(remoteId: string) {
    const pc = peerConnectionsRef.current.get(remoteId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peerConnectionsRef.current.delete(remoteId);
    }
    pendingCandidatesRef.current.delete(remoteId);
  }

  function closeAllPeerConnections() {
    peerConnectionsRef.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
  }

  async function flushPendingCandidates(remoteId: string, pc: RTCPeerConnection) {
    const queued = pendingCandidatesRef.current.get(remoteId);
    if (!queued || queued.length === 0) return;
    pendingCandidatesRef.current.delete(remoteId);
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignora candidatos expirados
      }
    }
  }

  // Transmissor cria conexão WebRTC dedicada para um espectador
  async function createOfferForViewer(viewerId: string, force = false) {
    const stream = localStreamRef.current;
    const channel = channelRef.current;
    if (!stream || !channel) return;

    // Evita recriar conexão se já houver uma negociação ativa com esse espectador
    const existing = peerConnectionsRef.current.get(viewerId);
    if (
      !force &&
      existing &&
      (existing.connectionState === 'new' ||
        existing.connectionState === 'connecting' ||
        existing.connectionState === 'connected')
    ) {
      return;
    }

    closePeerConnection(viewerId);
    const pc = new RTCPeerConnection(getIceConfig());
    peerConnectionsRef.current.set(viewerId, pc);

    const preset = QUALITY_CONFIG[qualityRef.current];
    let videoSender: RTCRtpSender | null = null;

    stream.getTracks().forEach((track) => {
      if (track.kind === 'video') {
        try {
          track.contentHint = qualityRef.current === '1080p30' ? 'detail' : 'motion';
        } catch {
          // Alguns navegadores não suportam contentHint
        }
      }
      const sender = pc.addTrack(track, stream);
      if (track.kind === 'video') videoSender = sender;
    });

    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === 'connected' && videoSender) {
        try {
          const params = videoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = preset.bitrate;
          params.encodings[0].maxFramerate = preset.fps;
          await videoSender.setParameters(params);
        } catch {
          // Navegador gerencia o bitrate automaticamente
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice',
          payload: {
            from: peerIdRef.current,
            to: viewerId,
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await channel.send({
      type: 'broadcast',
      event: 'webrtc-offer',
      payload: {
        from: peerIdRef.current,
        to: viewerId,
        sdp: { type: offer.type, sdp: offer.sdp },
      },
    });
  }

  // Espectador responde à oferta do transmissor
  async function handleIncomingOffer(
    sharerId: string,
    sdp: RTCSessionDescriptionInit
  ) {
    const channel = channelRef.current;
    if (!channel) return;

    setConnectionStatus('connecting');
    closePeerConnection(sharerId);

    const pc = new RTCPeerConnection(getIceConfig());
    peerConnectionsRef.current.set(sharerId, pc);

    const fallbackStream = new MediaStream();

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        attachStreamToVideo(event.streams[0], false);
      } else {
        fallbackStream.addTrack(event.track);
        attachStreamToVideo(fallbackStream, false);
      }
      setConnectionStatus('connected');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connecting') {
        setConnectionStatus('connecting');
      } else if (pc.connectionState === 'connected') {
        setConnectionStatus('connected');
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        setConnectionStatus('failed');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice',
          payload: {
            from: peerIdRef.current,
            to: sharerId,
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingCandidates(sharerId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await channel.send({
      type: 'broadcast',
      event: 'webrtc-answer',
      payload: {
        from: peerIdRef.current,
        to: sharerId,
        sdp: { type: answer.type, sdp: answer.sdp },
      },
    });
  }

  function requestStreamFromSharer(sharerId: string, force = false) {
    const channel = channelRef.current;
    if (!channel || sharerId === peerIdRef.current) return;
    if (!force && requestedSharerRef.current === sharerId) return;

    requestedSharerRef.current = sharerId;
    setConnectionStatus('negotiating');

    channel.send({
      type: 'broadcast',
      event: 'request-stream',
      payload: { from: peerIdRef.current, to: sharerId, force },
    });
  }

  // Conecta na sala após usuário informar o nome
  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const clean = username.trim();
    if (!clean) return;

    localStorage.setItem('corneada_username', clean);
    setJoined(true);

    const myId = peerIdRef.current;
    const channel = supabase.channel(`corneada-room:${slug}`, {
      config: {
        broadcast: { self: false },
        presence: { key: myId },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Participant>();
        const list: Participant[] = [];
        Object.values(state).forEach((entries) => {
          if (entries[0]) list.push(entries[0]);
        });
        setParticipants(list);

        const sharer = list.find((p) => p.isSharing) || null;
        setActiveSharer(sharer);

        if (sharer && sharer.peerId !== myId) {
          requestStreamFromSharer(sharer.peerId, false);
        }

        if (!sharer && !localStreamRef.current) {
          requestedSharerRef.current = null;
          setConnectionStatus('idle');
          attachStreamToVideo(null, false);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key) {
          closePeerConnection(key);
          if (requestedSharerRef.current === key) {
            requestedSharerRef.current = null;
            setConnectionStatus('idle');
          }
        }
      })
      .on('broadcast', { event: 'request-stream' }, ({ payload }) => {
        if (payload.to === myId && localStreamRef.current) {
          createOfferForViewer(payload.from, Boolean(payload.force));
        }
      })
      .on('broadcast', { event: 'sharer-started' }, ({ payload }) => {
        if (payload.sharerId !== myId) {
          requestStreamFromSharer(payload.sharerId, false);
        }
      })
      .on('broadcast', { event: 'sharer-stopped' }, ({ payload }) => {
        closePeerConnection(payload.sharerId);
        if (requestedSharerRef.current === payload.sharerId) {
          requestedSharerRef.current = null;
        }
        if (!localStreamRef.current) {
          setConnectionStatus('idle');
          attachStreamToVideo(null, false);
        }
      })
      .on('broadcast', { event: 'webrtc-offer' }, ({ payload }) => {
        if (payload.to === myId) {
          handleIncomingOffer(payload.from, payload.sdp);
        }
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (payload.to === myId) {
          const pc = peerConnectionsRef.current.get(payload.from);
          if (pc && pc.signalingState === 'have-local-offer') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
              await flushPendingCandidates(payload.from, pc);
            } catch {
              // Ignora resposta duplicada
            }
          }
        }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }) => {
        if (payload.to !== myId) return;
        const pc = peerConnectionsRef.current.get(payload.from);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {
            // Ignora erro de ICE tardio
          }
        } else {
          const list = pendingCandidatesRef.current.get(payload.from) || [];
          list.push(payload.candidate);
          pendingCandidatesRef.current.set(payload.from, list);
        }
      })
      .on('broadcast', { event: 'chat-message' }, ({ payload }) => {
        setMessages((prev) => [...prev, payload as ChatMessage]);
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        spawnReaction(payload.emoji);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            peerId: myId,
            username: clean,
            color: userColorRef.current,
            isSharing: false,
          });
        }
      });

    channelRef.current = channel;
  }

  // Limpeza ao sair da página
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      closeAllPeerConnections();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  async function startScreenShare() {
    if (activeSharer && activeSharer.peerId !== peerIdRef.current) {
      alert(`${activeSharer.username} já está transmitindo nesta sala.`);
      return;
    }

    const preset = QUALITY_CONFIG[quality];

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.fps, max: 60 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });

      localStreamRef.current = stream;
      setIsSharing(true);
      setShowQualityMenu(false);
      attachStreamToVideo(stream, true);

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      const channel = channelRef.current;
      if (channel) {
        await channel.track({
          peerId: peerIdRef.current,
          username: username.trim(),
          color: userColorRef.current,
          isSharing: true,
        });

        await channel.send({
          type: 'broadcast',
          event: 'sharer-started',
          payload: { sharerId: peerIdRef.current, username: username.trim() },
        });
      }
    } catch {
      // Usuário cancelou a janela de seleção de tela
    }
  }

  async function stopScreenShare() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    closeAllPeerConnections();
    setIsSharing(false);
    setConnectionStatus('idle');
    attachStreamToVideo(null, false);

    const channel = channelRef.current;
    if (channel) {
      await channel.track({
        peerId: peerIdRef.current,
        username: username.trim(),
        color: userColorRef.current,
        isSharing: false,
      });

      await channel.send({
        type: 'broadcast',
        event: 'sharer-stopped',
        payload: { sharerId: peerIdRef.current },
      });
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !channelRef.current) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: peerIdRef.current,
      username: username.trim(),
      color: userColorRef.current,
      text,
      time: new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    setMessages((prev) => [...prev, msg]);
    setChatInput('');

    await channelRef.current.send({
      type: 'broadcast',
      event: 'chat-message',
      payload: msg,
    });
  }

  async function handleSendReaction(emoji: string) {
    spawnReaction(emoji);
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { emoji },
    });
  }

  function handleCopyInvite() {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  function handleFullscreen() {
    if (!stageRef.current) return;
    if (!document.fullscreenElement) {
      stageRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  if (notFound) {
    return (
      <main className="relative flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <LiquidBackground />
        <div className="liquid-glass-strong liquid-specular max-w-md rounded-[36px] p-8">
          <h1 className="text-2xl font-extrabold">Sala não encontrada</h1>
          <p className="mt-2 text-sm opacity-70">
            Essa sala pode ter sido excluída ou o link está incorreto.
          </p>
          <button
            onClick={() => router.push('/')}
            className="liquid-btn-accent mt-6 rounded-full px-6 py-3 text-sm font-bold"
          >
            Voltar ao Lobby
          </button>
        </div>
      </main>
    );
  }

  const theme = room ? ROOM_THEMES[room.theme] || ROOM_THEMES.prism : ROOM_THEMES.prism;

  return (
    <main className="relative flex h-screen flex-col overflow-hidden p-3 sm:p-4">
      <LiquidBackground subtle={joined} />

      {/* Tela de Entrada Rápida (escrever o nome sem login) */}
      <AnimatePresence>
        {!joined && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 24, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: -16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 26 }}
              className="liquid-glass-strong liquid-specular relative w-full max-w-md overflow-hidden rounded-[38px] p-8"
            >
              <div
                className="pointer-events-none absolute -top-8 left-10 right-10 h-16 rounded-full opacity-75 blur-2xl"
                style={{ background: theme.gradient }}
              />

              <button
                onClick={() => router.push('/')}
                className="liquid-pill mb-6 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar às salas
              </button>

              <h1 className="text-3xl font-extrabold tracking-tight">
                {room ? room.name : 'Carregando sala...'}
              </h1>
              <p className="mt-1 text-sm opacity-75">
                {room?.description || 'Tela da Corneada • Qualidade Máxima'}
              </p>

              <form onSubmit={handleJoinRoom} className="mt-7 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider opacity-70">
                    Seu Nome na Sala
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    maxLength={24}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Digite seu apelido..."
                    className="liquid-input w-full rounded-2xl px-4 py-3.5 text-base font-semibold"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!room}
                  className="liquid-btn-accent w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50"
                >
                  Entrar na Sala
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barra Superior Flutuante da Sala */}
      <header className="liquid-glass liquid-specular z-20 flex items-center justify-between rounded-full px-3 py-2 sm:px-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full"
            title="Voltar ao Lobby"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2.5">
            <span
              className="h-3 w-3 rounded-full shadow"
              style={{ background: theme.gradient }}
            />
            <div>
              <h2 className="text-sm font-extrabold leading-tight sm:text-base">
                {room?.name || 'Tela da Corneada'}
              </h2>
              <p className="text-[11px] opacity-65">
                {participants.length}{' '}
                {participants.length === 1 ? 'pessoa online' : 'pessoas online'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyInvite}
            className="liquid-pill flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold"
          >
            {copiedLink ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span className="hidden sm:inline">Link copiado!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Convidar</span>
              </>
            )}
          </button>

          <button
            onClick={toggleTheme}
            className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full"
            title="Alternar tema Claro/Escuro"
          >
            {darkMode ? (
              <Sun className="h-4 w-4 text-amber-300" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </button>

          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full"
            title={sidebarOpen ? 'Modo Teatro (ocultar chat)' : 'Mostrar chat'}
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Área Principal: Palco da Tela + Chat Liquid Glass */}
      <div className="mt-3 flex min-h-0 flex-1 gap-3">
        {/* Palco do Vídeo */}
        <section
          ref={stageRef}
          className="liquid-glass liquid-specular relative flex flex-1 flex-col overflow-hidden rounded-4xl"
        >
          {/* Selo AO VIVO flutuante */}
          <AnimatePresence>
            {activeSharer && (
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="liquid-pill absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold"
              >
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500 shadow-[0_0_12px_#f43f5e]" />
                <span>
                  {activeSharer.peerId === peerIdRef.current
                    ? 'Você está transmitindo'
                    : `${activeSharer.username} está transmitindo`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reações flutuantes sobre o vídeo */}
          <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
            <AnimatePresence>
              {reactions.map((r) => (
                <motion.span
                  key={r.id}
                  initial={{ opacity: 0, y: 40, scale: 0.6 }}
                  animate={{ opacity: [0, 1, 1, 0], y: -260, scale: [0.6, 1.35, 1] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 2.1, ease: 'easeOut' }}
                  style={{ left: `${r.left}%` }}
                  className="absolute bottom-20 text-3xl drop-shadow-lg"
                >
                  {r.emoji}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>

          {/* Vídeo da Tela */}
          <div className="relative flex flex-1 items-center justify-center bg-black/20">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className={`h-full w-full object-contain transition-opacity duration-300 ${
                hasVideoStream ? 'opacity-100' : 'opacity-0'
              }`}
            />

            {/* Estado vazio ou aguardando conexão P2P */}
            {!hasVideoStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                  className="liquid-pill mb-5 flex h-20 w-20 items-center justify-center rounded-full"
                >
                  <Sparkles className="h-8 w-8 opacity-75" />
                </motion.div>

                {activeSharer && activeSharer.peerId !== peerIdRef.current ? (
                  <>
                    <h3 className="text-xl font-extrabold sm:text-2xl">
                      {connectionStatus === 'failed'
                        ? 'Falha na conexão de vídeo'
                        : `Conectando à tela de ${activeSharer.username}...`}
                    </h3>
                    <p className="mt-1.5 max-w-sm text-sm opacity-70">
                      {connectionStatus === 'failed'
                        ? 'A rede bloqueou a conexão direta (NAT/CGNAT). Tente reconectar ou configure o servidor TURN.'
                        : 'Estabelecendo transmissão P2P em alta qualidade.'}
                    </p>
                    <button
                      onClick={() => requestStreamFromSharer(activeSharer.peerId, true)}
                      className="liquid-btn-accent mt-5 flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reconectar Vídeo
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-xl font-extrabold sm:text-2xl">
                      Ninguém telando agora
                    </h3>
                    <p className="mt-1.5 max-w-sm text-sm opacity-70">
                      Clique em <strong>Transmitir Tela</strong> no dock abaixo para
                      compartilhar seu monitor, janela ou jogo em até 1080p 60fps.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Botão de desbloqueio de áudio caso o navegador bloqueie autoplay com som */}
            {needsAudioUnlock && hasVideoStream && !isSharing && (
              <button
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.muted = false;
                    videoRef.current.play().catch(() => {});
                  }
                  setMuted(false);
                  setNeedsAudioUnlock(false);
                }}
                className="liquid-btn-accent absolute bottom-24 z-30 flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold"
              >
                <Volume2 className="h-4 w-4" />
                Ativar Áudio da Transmissão
              </button>
            )}
          </div>

          {/* Dock Flutuante Liquid Glass (Controles da Transmissão) */}
          <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-20 flex justify-center px-3">
            <div className="liquid-glass-strong liquid-specular pointer-events-auto relative flex flex-wrap items-center justify-center gap-2 rounded-full px-3 py-2">
              {!isSharing && (
                <div className="relative">
                  <button
                    onClick={() => setShowQualityMenu((v) => !v)}
                    className="liquid-pill flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold"
                    title="Qualidade da Transmissão"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{quality}</span>
                  </button>

                  <AnimatePresence>
                    {showQualityMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.94 }}
                        className="liquid-glass-strong absolute bottom-14 left-0 w-48 rounded-3xl p-2"
                      >
                        {(Object.keys(QUALITY_CONFIG) as QualityPreset[]).map((q) => (
                          <button
                            key={q}
                            onClick={() => {
                              setQuality(q);
                              setShowQualityMenu(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-bold transition-colors ${
                              quality === q
                                ? 'bg-sky-500/20 text-sky-400'
                                : 'hover:bg-white/10'
                            }`}
                          >
                            <span>{QUALITY_CONFIG[q].label}</span>
                            {quality === q && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {!isSharing ? (
                <button
                  onClick={startScreenShare}
                  disabled={
                    Boolean(activeSharer) &&
                    activeSharer?.peerId !== peerIdRef.current
                  }
                  className="liquid-btn-accent flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold disabled:opacity-45"
                >
                  <MonitorUp className="h-4 w-4" />
                  <span>Transmitir Tela</span>
                </button>
              ) : (
                <button
                  onClick={stopScreenShare}
                  className="flex items-center gap-2 rounded-full border border-white/40 bg-rose-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition hover:scale-105 active:scale-95"
                >
                  <MonitorOff className="h-4 w-4" />
                  <span>Parar Tela</span>
                </button>
              )}

              {!isSharing && hasVideoStream && (
                <div className="liquid-pill flex items-center gap-2 rounded-full px-3 py-1.5">
                  <button
                    onClick={() => setMuted((m) => !m)}
                    className="opacity-85 hover:opacity-100"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-4 w-4 text-rose-400" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      setMuted(false);
                      setVolume(Number(e.target.value));
                    }}
                    className="h-1.5 w-16 cursor-pointer accent-sky-400"
                  />
                </div>
              )}

              <div className="hidden items-center gap-1 sm:flex">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleSendReaction(emoji)}
                    className="liquid-pill flex h-8 w-8 items-center justify-center rounded-full text-sm"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                onClick={handleFullscreen}
                className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full"
                title="Tela Cheia"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Painel Lateral Liquid Glass (Chat + Pessoas na Sala) */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0, x: 20 }}
              animate={{ width: 340, opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="liquid-glass liquid-specular hidden h-full shrink-0 flex-col overflow-hidden rounded-4xl lg:flex"
            >
              <div className="p-3">
                <div className="liquid-input relative grid grid-cols-2 rounded-full p-1">
                  {(['chat', 'users'] as const).map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className="relative z-10 flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold"
                      >
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-tab-pill"
                            transition={{
                              type: 'spring',
                              stiffness: 420,
                              damping: 32,
                            }}
                            className="liquid-pill absolute inset-0 -z-10 rounded-full"
                          />
                        )}
                        {tab === 'chat' ? (
                          <>
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>Chat</span>
                          </>
                        ) : (
                          <>
                            <Users className="h-3.5 w-3.5" />
                            <span>Galera ({participants.length})</span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeTab === 'chat' ? (
                <>
                  <div className="glass-scroll flex-1 space-y-3 overflow-y-auto px-4 py-2">
                    {messages.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center text-center opacity-55">
                        <MessageSquare className="mb-2 h-6 w-6" />
                        <p className="text-xs font-medium">
                          Nenhuma mensagem ainda. Manda um salve!
                        </p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const mine = msg.senderId === peerIdRef.current;
                        return (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            className={`flex flex-col ${
                              mine ? 'items-end' : 'items-start'
                            }`}
                          >
                            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px]">
                              <span
                                className="font-bold"
                                style={{ color: msg.color }}
                              >
                                {mine ? 'Você' : msg.username}
                              </span>
                              <span className="opacity-45">{msg.time}</span>
                            </div>
                            <div
                              className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-sm leading-snug ${
                                mine
                                  ? 'liquid-btn-accent rounded-tr-md'
                                  : 'liquid-pill rounded-tl-md'
                              }`}
                            >
                              {msg.text}
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <form
                    onSubmit={handleSendMessage}
                    className="flex items-center gap-2 p-3"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Escreva no chat..."
                      className="liquid-input flex-1 rounded-full px-4 py-2.5 text-sm"
                    />
                    <button
                      type="submit"
                      className="liquid-btn-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </>
              ) : (
                <div className="glass-scroll flex-1 space-y-2.5 overflow-y-auto px-4 py-2">
                  {participants.map((p) => (
                    <div
                      key={p.peerId}
                      className="liquid-pill flex items-center justify-between rounded-2xl px-3.5 py-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold text-white shadow"
                          style={{ backgroundColor: p.color }}
                        >
                          {p.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold leading-none">
                            {p.username}
                            {p.peerId === peerIdRef.current && (
                              <span className="ml-1.5 text-[10px] opacity-60">
                                (você)
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-[11px] opacity-60">
                            {p.isSharing ? 'Transmitindo tela' : 'Assistindo'}
                          </p>
                        </div>
                      </div>

                      {p.isSharing && (
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500 shadow-[0_0_10px_#f43f5e]" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <main className="relative flex min-h-screen items-center justify-center p-6">
          <LiquidBackground />
          <div className="liquid-glass-strong rounded-full px-6 py-3 text-sm font-bold">
            Carregando sala...
          </div>
        </main>
      }
    >
      <RoomContent />
    </Suspense>
  );
}