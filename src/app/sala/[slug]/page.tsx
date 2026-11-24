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
  Eye,
  Tv,
  X,
} from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, Room, ROOM_THEMES } from '@/lib/supabase';
import { LiquidBackground } from '@/components/LiquidBackground';

interface Participant {
  peerId: string;
  username: string;
  color: string;
  isSharing: boolean;
  streamId?: string | null;
}

interface ActiveSharer {
  peerId: string;
  username: string;
  color: string;
  streamId: string;
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

interface InboundConnection {
  sharerId: string;
  streamId: string;
  pc: RTCPeerConnection;
  retried: boolean;
}

type QualityPreset = '1080p60' | '1080p30' | '720p60';
type ConnectionStatus = 'idle' | 'negotiating' | 'connecting' | 'connected' | 'failed';

const QUALITY_CONFIG: Record<
  QualityPreset,
  { label: string; width: number; height: number; fps: number; bitrate: number }
> = {
  '1080p60': { label: '1080p 60fps Ultra', width: 1920, height: 1080, fps: 60, bitrate: 5_000_000 },
  '1080p30': { label: '1080p 30fps Nítido', width: 1920, height: 1080, fps: 30, bitrate: 3_500_000 },
  '720p60': { label: '720p 60fps Leve', width: 1280, height: 720, fps: 60, bitrate: 2_500_000 },
};

function getIceConfig(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
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

  return { iceServers, iceCandidatePoolSize: 4 };
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
  const usernameRef = useRef<string>('');
  const userColorRef = useRef<string>(
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  );

  // UI
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'users'>('chat');
  const [copiedLink, setCopiedLink] = useState(false);
  const [quality, setQuality] = useState<QualityPreset>('1080p60');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Mídia & Multi-Transmissão WebRTC
  const [isSharing, setIsSharing] = useState(false);
  const [activeSharers, setActiveSharers] = useState<ActiveSharer[]>([]);
  const [selectedSharerId, setSelectedSharerId] = useState<string | null>(null);
  const [myViewerCount, setMyViewerCount] = useState(0);
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

  // Refs sincronizadas (evitam closures desatualizados dentro dos listeners Realtime)
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamIdRef = useRef<string | null>(null);
  const qualityRef = useRef<QualityPreset>('1080p60');
  const selectedSharerIdRef = useRef<string | null>(null);
  const activeSharersRef = useRef<ActiveSharer[]>([]);
  const mutedRef = useRef<boolean>(false);
  const volumeRef = useRef<number>(0.9);

  // Conexões WebRTC separadas: envio (outbound) x recebimento (inbound)
  const outboundPCsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingOutboundIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const inboundPCRef = useRef<InboundConnection | null>(null);
  const pendingInboundIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const leaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  useEffect(() => {
    mutedRef.current = muted;
    volumeRef.current = volume;
    if (videoRef.current) {
      videoRef.current.volume = volume;
      const watchingSelf = selectedSharerIdRef.current === peerIdRef.current;
      videoRef.current.muted = watchingSelf ? true : muted;
    }
  }, [volume, muted, selectedSharerId]);

  useEffect(() => {
    peerIdRef.current = crypto.randomUUID();

    const savedNick = localStorage.getItem('corneada_username');
    if (savedNick) {
      setUsername(savedNick);
      usernameRef.current = savedNick;
    }

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

  function setActiveSharersSynced(
    updater: (prev: ActiveSharer[]) => ActiveSharer[]
  ) {
    const next = updater(activeSharersRef.current);
    activeSharersRef.current = next;
    setActiveSharers(next);
    return next;
  }

  function upsertSharer(sharer: ActiveSharer) {
    return setActiveSharersSynced((prev) => {
      const idx = prev.findIndex((s) => s.peerId === sharer.peerId);
      if (idx === -1) return [...prev, sharer];
      const copy = [...prev];
      copy[idx] = sharer;
      return copy;
    });
  }

  function removeSharer(sharerId: string) {
    return setActiveSharersSynced((prev) =>
      prev.filter((s) => s.peerId !== sharerId)
    );
  }

  function attachStreamToVideo(stream: MediaStream | null, muteLocal: boolean) {
    const video = videoRef.current;
    if (!video) return;

    if (stream && video.srcObject === stream) {
      setHasVideoStream(true);
      return;
    }

    video.srcObject = stream;
    setHasVideoStream(Boolean(stream));

    if (stream) {
      video.volume = volumeRef.current;
      video.muted = muteLocal ? true : mutedRef.current;
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

  // --- Gerenciamento de Conexões de ENVIO (quando EU transmito para outros) ---
  function closeOutboundPC(viewerId: string) {
    const pc = outboundPCsRef.current.get(viewerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      outboundPCsRef.current.delete(viewerId);
    }
    pendingOutboundIceRef.current.delete(viewerId);
    setMyViewerCount(outboundPCsRef.current.size);
  }

  function closeAllOutboundPCs() {
    outboundPCsRef.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
    });
    outboundPCsRef.current.clear();
    pendingOutboundIceRef.current.clear();
    setMyViewerCount(0);
  }

  // --- Gerenciamento de Conexão de RECEBIMENTO (a tela que EU estou assistindo) ---
  function closeInboundPC(notifyPreviousSharer = false) {
    const current = inboundPCRef.current;
    if (current) {
      if (notifyPreviousSharer && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'stop-watching',
          payload: { from: peerIdRef.current, to: current.sharerId },
        });
      }
      current.pc.onicecandidate = null;
      current.pc.ontrack = null;
      current.pc.onconnectionstatechange = null;
      current.pc.oniceconnectionstatechange = null;
      current.pc.close();
      inboundPCRef.current = null;
      pendingInboundIceRef.current.delete(current.sharerId);
    }
  }

  async function flushPendingIce(
    map: Map<string, RTCIceCandidateInit[]>,
    key: string,
    pc: RTCPeerConnection
  ) {
    const queued = map.get(key);
    if (!queued || queued.length === 0) return;
    map.delete(key);
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignora candidatos expirados
      }
    }
  }

  // --- Selecionar qual tela assistir (pode ser a minha ou a de qualquer amigo) ---
  function watchSharer(sharerId: string | null, force = false) {
    const myId = peerIdRef.current;

    if (!sharerId) {
      closeInboundPC(true);
      selectedSharerIdRef.current = null;
      setSelectedSharerId(null);
      setConnectionStatus('idle');
      attachStreamToVideo(null, false);
      return;
    }

    // Assistir minha própria prévia local (zero consumo de rede)
    if (sharerId === myId) {
      closeInboundPC(true);
      selectedSharerIdRef.current = myId;
      setSelectedSharerId(myId);
      setConnectionStatus('connected');
      attachStreamToVideo(localStreamRef.current, true);
      return;
    }

    // Evita reconectar se já estiver assistindo ou negociando com esse amigo
    if (
      !force &&
      selectedSharerIdRef.current === sharerId &&
      inboundPCRef.current?.sharerId === sharerId &&
      inboundPCRef.current.pc.connectionState !== 'failed' &&
      inboundPCRef.current.pc.connectionState !== 'closed'
    ) {
      return;
    }

    closeInboundPC(true);
    selectedSharerIdRef.current = sharerId;
    setSelectedSharerId(sharerId);
    setConnectionStatus('negotiating');
    attachStreamToVideo(null, false);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'request-stream',
      payload: { from: myId, to: sharerId, force },
    });
  }

  // --- Transmissor cria oferta dedicada para um espectador ---
  async function createOfferForViewer(viewerId: string, force = false) {
    const stream = localStreamRef.current;
    const streamId = localStreamIdRef.current;
    const channel = channelRef.current;
    if (!stream || !streamId || !channel) return;

    const existing = outboundPCsRef.current.get(viewerId);
    if (
      !force &&
      existing &&
      (existing.connectionState === 'new' ||
        existing.connectionState === 'connecting' ||
        existing.connectionState === 'connected')
    ) {
      return;
    }

    closeOutboundPC(viewerId);
    const pc = new RTCPeerConnection(getIceConfig());
    outboundPCsRef.current.set(viewerId, pc);
    setMyViewerCount(outboundPCsRef.current.size);

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
          // Navegador ajusta automaticamente
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closeOutboundPC(viewerId);
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
            sharerId: peerIdRef.current,
            streamId,
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
        sharerId: peerIdRef.current,
        streamId,
        sdp: { type: offer.type, sdp: offer.sdp },
      },
    });
  }

  // --- Espectador recebe oferta do amigo que está assistindo ---
  async function handleIncomingOffer(
    sharerId: string,
    streamId: string,
    sdp: RTCSessionDescriptionInit
  ) {
    const channel = channelRef.current;
    if (!channel) return;

    // Ignora ofertas de telas que não estão selecionadas no momento
    if (selectedSharerIdRef.current !== sharerId) return;

    setConnectionStatus('connecting');
    closeInboundPC(false);

    const pc = new RTCPeerConnection(getIceConfig());
    const conn: InboundConnection = { sharerId, streamId, pc, retried: false };
    inboundPCRef.current = conn;

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      if (inboundPCRef.current?.pc !== pc) return;

      if (event.streams && event.streams[0]) {
        attachStreamToVideo(event.streams[0], false);
      } else {
        remoteStream.addTrack(event.track);
        attachStreamToVideo(remoteStream, false);
      }
      setConnectionStatus('connected');
    };

    pc.oniceconnectionstatechange = () => {
      if (inboundPCRef.current?.pc !== pc) return;

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setConnectionStatus('connected');
      } else if (pc.iceConnectionState === 'checking') {
        setConnectionStatus('connecting');
      } else if (pc.iceConnectionState === 'failed') {
        // Tenta 1 reconexão automática antes de exibir erro
        if (!conn.retried && selectedSharerIdRef.current === sharerId) {
          conn.retried = true;
          watchSharer(sharerId, true);
        } else {
          setConnectionStatus('failed');
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
            to: sharerId,
            sharerId,
            streamId,
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIce(pendingInboundIceRef.current, sharerId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await channel.send({
        type: 'broadcast',
        event: 'webrtc-answer',
        payload: {
          from: peerIdRef.current,
          to: sharerId,
          sharerId,
          streamId,
          sdp: { type: answer.type, sdp: answer.sdp },
        },
      });
    } catch {
      setConnectionStatus('failed');
    }
  }

  // Trata saída definitiva de um sharer (ou quando ele para de transmitir)
  function handleSharerStopped(sharerId: string) {
    const remaining = removeSharer(sharerId);

    if (selectedSharerIdRef.current === sharerId) {
      closeInboundPC(false);
      // Se outra pessoa ainda estiver transmitindo, alterna automaticamente para ela
      const nextSharer =
        remaining.find((s) => s.peerId !== peerIdRef.current) || remaining[0];
      if (nextSharer) {
        watchSharer(nextSharer.peerId, true);
      } else {
        watchSharer(null);
      }
    }
  }

  // --- Entrar na sala ---
  function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const clean = username.trim();
    if (!clean) return;

    usernameRef.current = clean;
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

        Object.entries(state).forEach(([key, entries]) => {
          if (!entries || entries.length === 0) return;
          // Sempre pega o estado mais recente (evita ler estado antigo durante track())
          const latest = entries[entries.length - 1];
          list.push(latest);

          // Se o peer reapareceu rapidamente (atualização de track), cancela timer de saída
          const timer = leaveTimersRef.current.get(key);
          if (timer) {
            clearTimeout(timer);
            leaveTimersRef.current.delete(key);
          }

          if (latest.isSharing && latest.streamId) {
            upsertSharer({
              peerId: latest.peerId,
              username: latest.username,
              color: latest.color,
              streamId: latest.streamId,
            });
          }
        });

        setParticipants(list);

        // Se ainda não estou assistindo ninguém e apareceu algum amigo transmitindo, conecta
        if (!selectedSharerIdRef.current) {
          const firstFriend = activeSharersRef.current.find(
            (s) => s.peerId !== myId
          );
          if (firstFriend) {
            watchSharer(firstFriend.peerId, false);
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (!key || key === myId) return;

        // Aguarda 2.5s antes de derrubar conexão: no Supabase, channel.track() dispara leave+join!
        const existingTimer = leaveTimersRef.current.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
          leaveTimersRef.current.delete(key);
          const stillPresent = (channel.presenceState()[key]?.length ?? 0) > 0;
          if (!stillPresent) {
            closeOutboundPC(key);
            handleSharerStopped(key);
          }
        }, 2500);

        leaveTimersRef.current.set(key, timer);
      })
      // Novo participante pergunta quem já está transmitindo na sala
      .on('broadcast', { event: 'query-sharers' }, () => {
        if (localStreamRef.current && localStreamIdRef.current) {
          channel.send({
            type: 'broadcast',
            event: 'announce-sharer',
            payload: {
              peerId: myId,
              username: usernameRef.current,
              color: userColorRef.current,
              streamId: localStreamIdRef.current,
            },
          });
        }
      })
      .on('broadcast', { event: 'announce-sharer' }, ({ payload }) => {
        const sharer = payload as ActiveSharer;
        upsertSharer(sharer);
        if (!selectedSharerIdRef.current && sharer.peerId !== myId) {
          watchSharer(sharer.peerId, false);
        }
      })
      .on('broadcast', { event: 'sharer-started' }, ({ payload }) => {
        const sharer = payload as ActiveSharer;
        upsertSharer(sharer);
        // Só entra automaticamente se você não estiver assistindo outra tela no momento
        if (!selectedSharerIdRef.current && sharer.peerId !== myId) {
          watchSharer(sharer.peerId, false);
        }
      })
      .on('broadcast', { event: 'sharer-stopped' }, ({ payload }) => {
        if (payload.peerId) {
          handleSharerStopped(payload.peerId);
        }
      })
      .on('broadcast', { event: 'request-stream' }, ({ payload }) => {
        if (payload.to === myId && localStreamRef.current) {
          createOfferForViewer(payload.from, Boolean(payload.force));
        }
      })
      .on('broadcast', { event: 'stop-watching' }, ({ payload }) => {
        if (payload.to === myId) {
          closeOutboundPC(payload.from);
        }
      })
      .on('broadcast', { event: 'webrtc-offer' }, ({ payload }) => {
        if (payload.to === myId) {
          handleIncomingOffer(payload.sharerId, payload.streamId, payload.sdp);
        }
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (payload.to === myId && payload.sharerId === myId) {
          const pc = outboundPCsRef.current.get(payload.from);
          if (pc && pc.signalingState === 'have-local-offer') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
              await flushPendingIce(pendingOutboundIceRef.current, payload.from, pc);
            } catch {
              // Ignora resposta duplicada
            }
          }
        }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }) => {
        if (payload.to !== myId) return;

        // Roteia o ICE exatamente para a conexão certa (envio vs. recebimento)
        if (payload.sharerId === myId) {
          const pc = outboundPCsRef.current.get(payload.from);
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch {
              // Ignora candidato tardio
            }
          } else {
            const list = pendingOutboundIceRef.current.get(payload.from) || [];
            list.push(payload.candidate);
            pendingOutboundIceRef.current.set(payload.from, list);
          }
        } else {
          const inbound = inboundPCRef.current;
          if (inbound && inbound.sharerId === payload.sharerId && inbound.pc.remoteDescription) {
            try {
              await inbound.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            } catch {
              // Ignora candidato tardio
            }
          } else {
            const list = pendingInboundIceRef.current.get(payload.sharerId) || [];
            list.push(payload.candidate);
            pendingInboundIceRef.current.set(payload.sharerId, list);
          }
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
            streamId: null,
          });

          // Solicita lista de telas ativas imediatamente ao entrar
          await channel.send({
            type: 'broadcast',
            event: 'query-sharers',
            payload: { from: myId },
          });
        }
      });

    channelRef.current = channel;
  }

  // Limpeza ao desmontar
  useEffect(() => {
    return () => {
      leaveTimersRef.current.forEach((timer) => clearTimeout(timer));
      leaveTimersRef.current.clear();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      closeAllOutboundPCs();
      closeInboundPC(true);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  async function startScreenShare() {
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

      const streamId = crypto.randomUUID();
      localStreamRef.current = stream;
      localStreamIdRef.current = streamId;
      setIsSharing(true);
      setShowQualityMenu(false);

      const mySharer: ActiveSharer = {
        peerId: peerIdRef.current,
        username: usernameRef.current,
        color: userColorRef.current,
        streamId,
      };
      upsertSharer(mySharer);

      // Se você não está assistindo ninguém, mostra sua própria prévia.
      // Se já estiver assistindo um amigo, continua assistindo ele e você pode alternar no topo!
      if (!selectedSharerIdRef.current) {
        watchSharer(peerIdRef.current, true);
      }

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      const channel = channelRef.current;
      if (channel) {
        await channel.track({
          peerId: peerIdRef.current,
          username: usernameRef.current,
          color: userColorRef.current,
          isSharing: true,
          streamId,
        });

        await channel.send({
          type: 'broadcast',
          event: 'sharer-started',
          payload: mySharer,
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
    localStreamIdRef.current = null;

    closeAllOutboundPCs();
    setIsSharing(false);

    const remaining = removeSharer(peerIdRef.current);

    // Se você estava olhando a própria prévia, muda para o próximo amigo ou limpa o palco
    if (selectedSharerIdRef.current === peerIdRef.current) {
      const nextFriend = remaining[0];
      watchSharer(nextFriend ? nextFriend.peerId : null, true);
    }

    const channel = channelRef.current;
    if (channel) {
      await channel.track({
        peerId: peerIdRef.current,
        username: usernameRef.current,
        color: userColorRef.current,
        isSharing: false,
        streamId: null,
      });

      await channel.send({
        type: 'broadcast',
        event: 'sharer-stopped',
        payload: { peerId: peerIdRef.current },
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
      username: usernameRef.current,
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
  const selectedSharer =
    activeSharers.find((s) => s.peerId === selectedSharerId) || null;
  const isWatchingSelf = selectedSharerId === peerIdRef.current;

  const sidebarContent = (
    <>
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
                    className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                  >
                    <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px]">
                      <span className="font-bold" style={{ color: msg.color }}>
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

          <form onSubmit={handleSendMessage} className="flex items-center gap-2 p-3">
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
          {participants.map((p) => {
            const sharerEntry = activeSharers.find((s) => s.peerId === p.peerId);
            const isCurrentlyWatched = selectedSharerId === p.peerId;
            return (
              <div
                key={p.peerId}
                className="liquid-pill flex items-center justify-between gap-2 rounded-2xl px-3.5 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white shadow"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold leading-none">
                      {p.username}
                      {p.peerId === peerIdRef.current && (
                        <span className="ml-1.5 text-[10px] opacity-60">(você)</span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] opacity-60">
                      {sharerEntry ? 'Transmitindo tela' : 'Na sala'}
                    </p>
                  </div>
                </div>

                {sharerEntry && (
                  <button
                    onClick={() => {
                      watchSharer(sharerEntry.peerId, false);
                      setMobileDrawerOpen(false);
                    }}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                      isCurrentlyWatched
                        ? 'liquid-btn-accent'
                        : 'liquid-pill hover:brightness-110'
                    }`}
                  >
                    <Tv className="h-3 w-3" />
                    <span>{isCurrentlyWatched ? 'Vendo' : 'Assistir'}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

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
                {participants.length === 1 ? 'online' : 'online'}
                {activeSharers.length > 0 &&
                  ` • ${activeSharers.length} ${
                    activeSharers.length === 1 ? 'tela ao vivo' : 'telas ao vivo'
                  }`}
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

          {/* Toggle chat no Desktop */}
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="liquid-pill hidden h-9 w-9 items-center justify-center rounded-full lg:flex"
            title={sidebarOpen ? 'Modo Teatro (ocultar chat)' : 'Mostrar chat'}
          >
            {sidebarOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>

          {/* Toggle chat no Mobile */}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="liquid-pill flex h-9 w-9 items-center justify-center rounded-full lg:hidden"
            title="Abrir Chat e Participantes"
          >
            <MessageSquare className="h-4 w-4" />
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
          {/* Barra Liquid Glass de Troca de Telas Simultâneas */}
          <AnimatePresence>
            {activeSharers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="pointer-events-none absolute left-4 right-4 top-4 z-20 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="liquid-glass-strong pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full p-1.5">
                  {activeSharers.map((sharer) => {
                    const isSelected = selectedSharerId === sharer.peerId;
                    const isMe = sharer.peerId === peerIdRef.current;
                    return (
                      <button
                        key={sharer.peerId}
                        onClick={() => watchSharer(sharer.peerId, false)}
                        className={`relative flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                          isSelected
                            ? 'text-white'
                            : 'opacity-80 hover:opacity-100'
                        }`}
                      >
                        {isSelected && (
                          <motion.span
                            layoutId="active-screen-pill"
                            transition={{
                              type: 'spring',
                              stiffness: 420,
                              damping: 32,
                            }}
                            className="liquid-btn-accent absolute inset-0 -z-10 rounded-full"
                          />
                        )}
                        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400 shadow-[0_0_10px_#fb7185]" />
                        <span>
                          {isMe ? `${sharer.username} (Você)` : sharer.username}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Contador de quem está vendo a SUA tela */}
                {isSharing && (
                  <div className="liquid-pill pointer-events-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold">
                    <Eye className="h-3.5 w-3.5 text-emerald-400" />
                    <span>
                      {myViewerCount}{' '}
                      {myViewerCount === 1
                        ? 'vendo sua tela'
                        : 'vendo sua tela'}
                    </span>
                  </div>
                )}
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
          <div className="relative flex flex-1 items-center justify-center bg-black/25">
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

                {selectedSharer && !isWatchingSelf ? (
                  <>
                    <h3 className="text-xl font-extrabold sm:text-2xl">
                      {connectionStatus === 'failed'
                        ? 'Falha na conexão de vídeo'
                        : `Conectando à tela de ${selectedSharer.username}...`}
                    </h3>
                    <p className="mt-1.5 max-w-sm text-sm opacity-70">
                      {connectionStatus === 'failed'
                        ? 'A rede bloqueou a conexão direta (NAT/CGNAT). Clique abaixo para tentar de novo ou adicione um servidor TURN.'
                        : 'Estabelecendo transmissão P2P em alta qualidade.'}
                    </p>
                    <button
                      onClick={() => watchSharer(selectedSharer.peerId, true)}
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
                      Clique em <strong>Transmitir Tela</strong> abaixo. Todos
                      podem transmitir ao mesmo tempo e alternar entre as telas
                      no topo.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Botão de desbloqueio de áudio */}
            {needsAudioUnlock && hasVideoStream && !isWatchingSelf && (
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

          {/* Dock Flutuante Liquid Glass */}
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

              {/* Todos podem transmitir simultaneamente! */}
              {!isSharing ? (
                <button
                  onClick={startScreenShare}
                  className="liquid-btn-accent flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold"
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
                  <span>Parar Minha Tela</span>
                </button>
              )}

              {/* Controle de Volume (quando assistindo tela de outro amigo) */}
              {!isWatchingSelf && hasVideoStream && (
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

        {/* Painel Lateral Desktop */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0, x: 20 }}
              animate={{ width: 340, opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="liquid-glass liquid-specular hidden h-full shrink-0 flex-col overflow-hidden rounded-4xl lg:flex"
            >
              {sidebarContent}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Gaveta Liquid Glass para Mobile/Tablet */}
      <AnimatePresence>
        {mobileDrawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 z-50 flex justify-end bg-black/40 p-3 backdrop-blur-sm lg:hidden"
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="liquid-glass-strong liquid-specular flex h-full w-full max-w-sm flex-col overflow-hidden rounded-4xl"
            >
              <div className="flex items-center justify-between px-4 pt-3">
                <span className="text-xs font-bold uppercase tracking-wider opacity-70">
                  Sala ao Vivo
                </span>
                <button
                  onClick={() => setMobileDrawerOpen(false)}
                  className="liquid-pill flex h-8 w-8 items-center justify-center rounded-full"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sidebarContent}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
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