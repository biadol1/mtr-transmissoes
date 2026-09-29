import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const MAX_PARTICIPANTS = 6;

function cleanRoom(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

function cleanName(value) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, 24);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit ainda não está configurado no servidor.' });
    }

    const roomName = cleanRoom(req.body?.room);
    const displayName = cleanName(req.body?.name);
    if (!roomName || !displayName) return res.status(400).json({ error: 'Nome e sala são obrigatórios.' });

    const httpUrl = LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const rooms = await roomService.listRooms([roomName]);
    if (!rooms.length) {
      try {
        await roomService.createRoom({
          name: roomName,
          maxParticipants: MAX_PARTICIPANTS,
          emptyTimeout: 10 * 60,
          departureTimeout: 30,
        });
      } catch (e) {
        // Outra requisição pode ter criado a mesma sala ao mesmo tempo.
        const check = await roomService.listRooms([roomName]);
        if (!check.length) throw e;
      }
    }

    const participants = await roomService.listParticipants(roomName).catch(() => []);
    if (participants.length >= MAX_PARTICIPANTS) {
      return res.status(409).json({ error: 'Essa sala já está cheia (máximo de 6 pessoas).' });
    }

    const identity = `mtr_${crypto.randomUUID()}`;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name: displayName,
      ttl: '2h',
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    return res.status(200).json({
      token: await token.toJwt(),
      url: LIVEKIT_URL,
      room: roomName,
      maxParticipants: MAX_PARTICIPANTS,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Não foi possível entrar na sala agora.' });
  }
}
