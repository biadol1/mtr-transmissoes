const $ = (id) => document.getElementById(id);
const LK = window.LivekitClient;
let liveRoom = null;
let currentCode = '';
let sharing = false;

function roomCode() {
  return 'MTR-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function normalizeRoom(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

function setMessage(text, inRoom = false) {
  $(inRoom ? 'roomMsg' : 'msg').textContent = text || '';
}

async function enter(create) {
  const name = $('name').value.trim();
  let code = normalizeRoom($('roomCode').value);
  if (!name) return setMessage('Coloque seu nome para continuar.');
  if (create && !code) code = roomCode();
  if (!code) return setMessage('Digite o código da sala.');

  setMessage('Conectando...');
  $('create').disabled = $('join').disabled = true;
  try {
    const response = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, room: code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');

    liveRoom = new LK.Room({ adaptiveStream: true, dynacast: true });
    bindRoomEvents(liveRoom);
    await liveRoom.connect(data.url, data.token);

    currentCode = data.room;
    localStorage.setItem('mtrName', name);
    history.replaceState({}, '', `?room=${encodeURIComponent(currentCode)}`);
    $('roomCode').value = currentCode;
    $('roomTitle').textContent = `Sala ${currentCode}`;
    $('landing').classList.add('hidden');
    $('roomView').classList.remove('hidden');
    setMessage('');
    updatePeople();
  } catch (err) {
    setMessage(err.message || 'Erro ao conectar.');
  } finally {
    $('create').disabled = $('join').disabled = false;
  }
}

function bindRoomEvents(room) {
  room.on(LK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === LK.Track.Kind.Video) attachVideo(track, participant);
    updatePeople();
  });
  room.on(LK.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
    updateStage();
  });
  room.on(LK.RoomEvent.ParticipantConnected, updatePeople);
  room.on(LK.RoomEvent.ParticipantDisconnected, updatePeople);
  room.on(LK.RoomEvent.LocalTrackPublished, (publication) => {
    if (publication.source === LK.Track.Source.ScreenShare) {
      const track = publication.track;
      if (track) attachVideo(track, room.localParticipant, true);
    }
    updateStage();
  });
  room.on(LK.RoomEvent.LocalTrackUnpublished, (_, publication) => {
    if (publication?.source === LK.Track.Source.ScreenShare) removeLocalPreview();
    updateStage();
  });
  room.on(LK.RoomEvent.Disconnected, () => {
    $('status').textContent = 'Desconectado';
  });
}

function attachVideo(track, participant, local = false) {
  const id = `video-${participant.identity}-${track.sid || 'screen'}`.replace(/[^a-zA-Z0-9_-]/g, '');
  if ($(id)) return;
  const wrap = document.createElement('div');
  wrap.className = 'video-card';
  wrap.id = id;
  if (local) wrap.dataset.localPreview = '1';
  const video = track.attach();
  video.autoplay = true;
  video.playsInline = true;
  const label = document.createElement('div');
  label.className = 'video-label';
  label.textContent = `${participant.name || 'Participante'}${local ? ' • você' : ''}`;
  wrap.append(video, label);
  $('videos').appendChild(wrap);
  updateStage();
}

function removeLocalPreview() {
  document.querySelectorAll('[data-local-preview="1"]').forEach((el) => el.remove());
}

function updateStage() {
  $('emptyStage').classList.toggle('hidden', $('videos').children.length > 0);
}

function updatePeople() {
  if (!liveRoom) return;
  const all = [liveRoom.localParticipant, ...liveRoom.remoteParticipants.values()];
  $('count').textContent = `${all.length} / 6 pessoas`;
  $('people').innerHTML = '';
  all.forEach((p) => {
    const chip = document.createElement('span');
    chip.textContent = p === liveRoom.localParticipant ? `${p.name || 'Você'} (você)` : (p.name || 'Participante');
    $('people').appendChild(chip);
  });
}

$('create').onclick = () => enter(true);
$('join').onclick = () => enter(false);

$('share').onclick = async () => {
  if (!liveRoom) return;
  setMessage('', true);
  try {
    sharing = !sharing;
    await liveRoom.localParticipant.setScreenShareEnabled(sharing, { audio: true });
    $('share').textContent = sharing ? 'Parar transmissão' : 'Compartilhar tela';
    if (!sharing) removeLocalPreview();
    updateStage();
  } catch (err) {
    sharing = false;
    $('share').textContent = 'Compartilhar tela';
    setMessage('O compartilhamento foi cancelado ou não pôde ser iniciado.', true);
  }
};

$('invite').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(currentCode)}`;
  try {
    await navigator.clipboard.writeText(url);
    setMessage('Link do convite copiado! Agora é só mandar para a pessoa.', true);
  } catch {
    setMessage(`Convite: ${url}`, true);
  }
};

$('leave').onclick = async () => {
  if (liveRoom) await liveRoom.disconnect();
  location.href = location.pathname;
};

window.addEventListener('beforeunload', () => liveRoom?.disconnect());

$('name').value = localStorage.getItem('mtrName') || '';
const invitedRoom = new URLSearchParams(location.search).get('room');
if (invitedRoom) {
  $('roomCode').value = normalizeRoom(invitedRoom);
  setMessage('Convite carregado. Coloque seu nome e clique em “Entrar na sala”.');
}
